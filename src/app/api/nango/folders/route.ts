import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getNango, isNangoEnabled } from '@/lib/nango/client';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

export const runtime = 'nodejs';

interface GoogleDriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

/**
 * GET /api/nango/folders
 * List folders from a connected provider (Google Drive, Dropbox, etc.)
 * Query params:
 *   - provider: The provider (e.g., 'google-drive')
 *   - parentId: Optional parent folder ID (omit for root)
 */
export async function GET(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    // Allow access without auth for Config UI, but if user is available use their connection
    // If not authenticated, we'll use the first available connection for the provider
    const userId: string | undefined = user?.id;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') as SupportedProvider;
    const parentId = searchParams.get('parentId') || 'root';

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get the user's connection for this provider
    let query = supabaseAdmin
      .from('nango_connections')
      .select('connection_id')
      .eq('provider', provider)
      .eq('status', 'connected');

    // If user is authenticated, get their specific connection
    // If not, get any available connection for the provider
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: connections } = await query;

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        { error: 'No connected account found for this provider' },
        { status: 404 }
      );
    }

    // Use the first connection (admin view)
    const connection = connections[0];

    const nango = getNango();

    // Provider-specific folder listing
    if (provider === 'google-drive') {
      const folders = await listGoogleDriveFolders(
        nango,
        connection.connection_id,
        parentId
      );
      return NextResponse.json({ folders, parentId });
    }

    if (provider === 'dropbox') {
      const folders = await listDropboxFolders(
        nango,
        connection.connection_id,
        parentId
      );
      return NextResponse.json({ folders, parentId });
    }

    // For other providers, return empty array for now
    return NextResponse.json(
      { error: `Folder listing not supported for ${provider}` },
      { status: 400 }
    );

  } catch (error) {
    console.error('[Nango] Error listing folders:', error);
    return NextResponse.json(
      { error: 'Failed to list folders' },
      { status: 500 }
    );
  }
}

/**
 * List folders from Google Drive
 */
async function listGoogleDriveFolders(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  parentId: string
): Promise<Array<{ id: string; name: string; hasChildren: boolean }>> {
  // Query for folders only
  let query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";

  // For root, first try without parent filter to see if we get any folders
  // Some Google accounts have folders in different locations
  if (parentId === 'root') {
    // First, test the connection by calling the /about endpoint
    console.log('[Nango] Testing Google Drive connection...');
    try {
      const aboutResponse = await nango.proxy({
        providerConfigKey: 'google-drive',
        connectionId: connectionId,
        method: 'GET',
        endpoint: '/drive/v3/about',
        params: {
          fields: 'user(displayName,emailAddress)',
        },
      });
      console.log('[Nango] DEBUG - About response:', JSON.stringify(aboutResponse.data, null, 2));
    } catch (aboutErr) {
      console.error('[Nango] DEBUG - Error calling /about:', aboutErr);
    }

    // DEBUG: Try to list ALL files (not just folders) without any filters
    console.log('[Nango] DEBUG - Attempting to list ALL files (no filter)...');
    try {
      const allFilesResponse = await nango.proxy({
        providerConfigKey: 'google-drive',
        connectionId: connectionId,
        method: 'GET',
        endpoint: '/drive/v3/files',
        params: {
          pageSize: '20',
          fields: 'files(id,name,mimeType,parents)',
        },
      });
      console.log('[Nango] DEBUG - ALL files response:', JSON.stringify(allFilesResponse.data, null, 2));
    } catch (allErr) {
      console.error('[Nango] DEBUG - Error listing all files:', allErr);
    }

    // DEBUG: Try listing with trashed=false only
    console.log('[Nango] DEBUG - Attempting to list files with trashed=false only...');
    try {
      const notTrashedResponse = await nango.proxy({
        providerConfigKey: 'google-drive',
        connectionId: connectionId,
        method: 'GET',
        endpoint: '/drive/v3/files',
        params: {
          q: "trashed = false",
          pageSize: '20',
          fields: 'files(id,name,mimeType,parents)',
        },
      });
      console.log('[Nango] DEBUG - Not trashed files response:', JSON.stringify(notTrashedResponse.data, null, 2));
    } catch (notTrashedErr) {
      console.error('[Nango] DEBUG - Error listing not trashed files:', notTrashedErr);
    }

    // Get root level folders (folders in "My Drive" root)
    query += " and 'root' in parents";
  } else {
    // Get folders inside the specified parent
    query += ` and '${parentId}' in parents`;
  }

  try {
    console.log('[Nango] Listing Google Drive folders with query:', query);
    console.log('[Nango] Connection ID:', connectionId);

    const response = await nango.proxy({
      providerConfigKey: 'google-drive',
      connectionId: connectionId,
      method: 'GET',
      endpoint: '/drive/v3/files',
      params: {
        q: query,
        pageSize: '100',
        fields: 'files(id,name,mimeType,parents)',
        orderBy: 'name',
      },
    });

    console.log('[Nango] Google Drive API response status:', response.status);
    console.log('[Nango] Google Drive API response data:', JSON.stringify(response.data, null, 2));

    const data = response.data as { files?: GoogleDriveFolder[] };
    const folders = data.files || [];

    console.log('[Nango] Found folders:', folders.length);

    // Check each folder for children (to show expand arrow)
    const foldersWithChildInfo = await Promise.all(
      folders.map(async (folder) => {
        // Quick check if folder has subfolders
        const hasChildren = await checkFolderHasChildren(nango, connectionId, folder.id);
        return {
          id: folder.id,
          name: folder.name,
          hasChildren,
        };
      })
    );

    return foldersWithChildInfo;
  } catch (error) {
    console.error('[Nango] Failed to list Google Drive folders:', error);
    throw error;
  }
}

/**
 * Check if a folder has child folders
 */
async function checkFolderHasChildren(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  folderId: string
): Promise<boolean> {
  try {
    const response = await nango.proxy({
      providerConfigKey: 'google-drive',
      connectionId: connectionId,
      method: 'GET',
      endpoint: '/drive/v3/files',
      params: {
        q: `mimeType = 'application/vnd.google-apps.folder' and '${folderId}' in parents and trashed = false`,
        pageSize: '1',
        fields: 'files(id)',
      },
    });

    const data = response.data as { files?: Array<{ id: string }> };
    return (data.files?.length || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * List folders from Dropbox
 */
async function listDropboxFolders(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  parentId: string
): Promise<Array<{ id: string; name: string; hasChildren: boolean }>> {
  try {
    const path = parentId === 'root' ? '' : parentId;

    const response = await nango.proxy({
      providerConfigKey: 'dropbox',
      connectionId: connectionId,
      method: 'POST',
      endpoint: '/2/files/list_folder',
      data: {
        path: path,
        limit: 100,
      },
    });

    const data = response.data as { entries?: Array<{ '.tag': string; id: string; name: string; path_display: string }> };
    const entries = data.entries || [];

    // Filter to folders only
    const folders = entries.filter(entry => entry['.tag'] === 'folder');

    // Check each folder for children
    const foldersWithChildInfo = await Promise.all(
      folders.map(async (folder) => {
        const hasChildren = await checkDropboxFolderHasChildren(nango, connectionId, folder.path_display);
        return {
          id: folder.path_display, // Dropbox uses path as ID
          name: folder.name,
          hasChildren,
        };
      })
    );

    return foldersWithChildInfo;
  } catch (error) {
    console.error('[Nango] Failed to list Dropbox folders:', error);
    throw error;
  }
}

/**
 * Check if a Dropbox folder has child folders
 */
async function checkDropboxFolderHasChildren(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  folderPath: string
): Promise<boolean> {
  try {
    const response = await nango.proxy({
      providerConfigKey: 'dropbox',
      connectionId: connectionId,
      method: 'POST',
      endpoint: '/2/files/list_folder',
      data: {
        path: folderPath,
        limit: 1,
      },
    });

    const data = response.data as { entries?: Array<{ '.tag': string }> };
    const entries = data.entries || [];
    return entries.some(entry => entry['.tag'] === 'folder');
  } catch {
    return false;
  }
}


