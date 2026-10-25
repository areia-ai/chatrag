import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getNango, isNangoEnabled } from '@/lib/nango/client';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

export const runtime = 'nodejs';

interface GoogleDriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
}

interface DropboxFile {
    id: string;
    name: string;
    '.tag': string;
    size?: number;
    client_modified?: string;
}

/**
 * GET /api/nango/files
 * List files from a connected provider (Google Drive, Dropbox)
 * Query params:
 *   - provider: The provider (e.g., 'google-drive')
 *   - folderId: Optional folder ID to list files from (defaults to root)
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
        const userId: string | undefined = user?.id;

        const { searchParams } = new URL(request.url);
        const provider = searchParams.get('provider') as SupportedProvider;
        const folderId = searchParams.get('folderId') || 'root';

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

        // Provider-specific file listing
         let files;
         if (provider === 'google-drive') {
             files = await listGoogleDriveFiles(nango, connection.connection_id, folderId);
         } else if (provider === 'dropbox') {
             files = await listDropboxFiles(nango, connection.connection_id, folderId);
         } else if (provider === 'notion') {
             files = await listNotionFiles(nango, connection.connection_id);
         } else {
             return NextResponse.json(
                 { error: `File listing not supported for ${provider}` },
                 { status: 400 }
             );
         }

        return NextResponse.json({ files });

    } catch (error) {
        console.error('[Nango] Error listing files:', error);
        return NextResponse.json(
            { error: 'Failed to list files' },
            { status: 500 }
        );
    }
}

/**
 * List files from Google Drive
 */
async function listGoogleDriveFiles(
    nango: ReturnType<typeof getNango>,
    connectionId: string,
    folderId: string
): Promise<Array<{ id: string; name: string; mimeType: string; size?: number; modifiedTime?: string }>> {
    // Query for files only (not folders)
    let query = "mimeType != 'application/vnd.google-apps.folder' and trashed = false";

    if (folderId === 'root') {
        query += " and 'root' in parents";
    } else {
        query += ` and '${folderId}' in parents`;
    }

    try {
        const response = await nango.proxy({
            providerConfigKey: 'google-drive',
            connectionId: connectionId,
            method: 'GET',
            endpoint: '/drive/v3/files',
            params: {
                q: query,
                pageSize: '100',
                fields: 'files(id,name,mimeType,size,modifiedTime)',
                orderBy: 'name',
            },
        });

        const data = response.data as { files?: GoogleDriveFile[] };
        const files = data.files || [];

        return files.map(file => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size ? parseInt(file.size) : undefined,
            modifiedTime: file.modifiedTime,
        }));
    } catch (error) {
        console.error('[Nango] Failed to list Google Drive files:', error);
        throw error;
    }
}

/**
 * List files from Dropbox
 */
async function listDropboxFiles(
    nango: ReturnType<typeof getNango>,
    connectionId: string,
    folderId: string
): Promise<Array<{ id: string; name: string; mimeType: string; size?: number; modifiedTime?: string }>> {
    try {
        const path = folderId === 'root' ? '' : folderId;

        console.log(`[Nango] Listing Dropbox files with path: "${path}"`);

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

        console.log(`[Nango] Dropbox API response:`, JSON.stringify(response.data, null, 2));

        const data = response.data as { entries?: DropboxFile[] };
        const entries = data.entries || [];

        console.log(`[Nango] Total Dropbox entries: ${entries.length}, Entries:`, entries);

        // Filter to files only (not folders)
        const files = entries.filter(entry => entry['.tag'] === 'file');

        console.log(`[Nango] Filtered Dropbox files: ${files.length}`);

        return files.map(file => ({
            id: file.id,
            name: file.name,
            mimeType: getMimeTypeFromFilename(file.name),
            size: file.size,
            modifiedTime: file.client_modified,
        }));
    } catch (error) {
        console.error('[Nango] Failed to list Dropbox files:', error);
        throw error;
    }
    }
    
    /**
    * List files from Notion (pages and databases)
    */
    async function listNotionFiles(
    nango: ReturnType<typeof getNango>,
    connectionId: string
    ): Promise<Array<{ id: string; name: string; mimeType: string; size?: number; modifiedTime?: string }>> {
    try {
        const response = await nango.proxy({
            providerConfigKey: 'notion',
            connectionId: connectionId,
            method: 'GET',
            endpoint: '/contents',
        });
    
        const contents = response.data as Array<{
            id: string;
            name: string;
            type?: 'page' | 'database';
            url?: string;
            last_edited_time?: string;
        }>;
    
        if (!contents || !Array.isArray(contents)) {
            console.warn('[Nango] No contents returned from Notion /contents endpoint');
            return [];
        }
    
        return contents.map(content => ({
            id: content.id,
            name: content.name,
            mimeType: 'text/plain', // Notion pages are converted to text
            modifiedTime: content.last_edited_time,
        }));
    } catch (error) {
        console.error('[Nango] Failed to list Notion files:', error);
        throw error;
    }
    }
    
    /**
    * Helper to guess MIME type from filename extension
    */
    function getMimeTypeFromFilename(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        txt: 'text/plain',
        md: 'text/markdown',
        html: 'text/html',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
}
