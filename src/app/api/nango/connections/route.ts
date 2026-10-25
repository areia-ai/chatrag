import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getNango, isNangoEnabled } from '@/lib/nango/client';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

export const runtime = 'nodejs';

/**
 * GET /api/nango/connections
 * List user's connected providers
 */
export async function GET(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json({ connections: [], enabled: false });
  }

  try {
    // Check if request comes from config-ui (has admin auth header)
    const authHeader = request.headers.get('authorization');
    const isConfigUI = authHeader?.startsWith('Bearer ');

    let userId: string;

    if (isConfigUI) {
      // Config-UI admin access - get first valid user for representative view
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
      }

      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      userId = users?.users?.[0]?.id || '';

      if (!userId) {
        // No users yet, return empty connections
        return NextResponse.json({ connections: [], enabled: true });
      }
    } else {
      // Normal user authentication via Next.js session
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      userId = user.id;
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get connections from our database
    const { data: connections, error } = await supabaseAdmin
      .from('nango_connections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Optionally verify with Nango that connections are still valid
    // This can be slow, so we may want to do this in the background
    let validConnectionIds = new Set<string>();
    try {
      const nango = getNango();
      const nangoConnections = await nango.listConnections();

      interface NangoConnection {
        connection_id: string;
        end_user?: { id?: string };
      }

      validConnectionIds = new Set(
        (nangoConnections.connections as NangoConnection[])
          .filter((c) => c.end_user?.id === userId)
          .map((c) => c.connection_id)
      );
    } catch (e) {
      // If Nango API fails, assume all connections are valid
      console.warn('[Nango] Could not verify connections:', e);
      validConnectionIds = new Set(
        connections?.map((c: { connection_id: string }) => c.connection_id) || []
      );
    }

    // Map Nango connection status to our records
    const enrichedConnections = connections?.map((conn: { connection_id: string }) => ({
      ...conn,
      is_valid: validConnectionIds.has(conn.connection_id),
    })) || [];

    return NextResponse.json({
      connections: enrichedConnections,
      enabled: true,
    });

  } catch (error) {
    console.error('[Nango] Error fetching connections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/nango/connections
 * Register a new connection after OAuth completes
 */
export async function POST(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    // Check if request comes from config-ui (has admin auth header)
    const authHeader = request.headers.get('authorization');
    const isConfigUI = authHeader?.startsWith('Bearer ');

    let userId: string;

    if (isConfigUI) {
      // Config-UI admin access - get first valid user for representative view
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
      }

      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      userId = users?.users?.[0]?.id || '';

      if (!userId) {
        return NextResponse.json(
          { error: 'No users found - create a user first' },
          { status: 404 }
        );
      }
    } else {
      // Normal user authentication via Next.js session
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      userId = user.id;
    }

    const { provider, connectionId } = await request.json() as {
      provider: SupportedProvider;
      connectionId: string;
    };

    if (!provider || !connectionId) {
      return NextResponse.json(
        { error: 'Provider and connectionId are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Verify the connection exists in Nango
    const nango = getNango();
    const integrationId = PROVIDER_CONFIG[provider]?.integrationId || provider;
    try {
      await nango.getConnection(integrationId, connectionId);
    } catch (e) {
      return NextResponse.json(
        { error: 'Connection not found in Nango' },
        { status: 404 }
      );
    }

    // Upsert connection record
    const { data, error } = await supabaseAdmin
      .from('nango_connections')
      .upsert({
        user_id: userId,
        connection_id: connectionId,
        provider: provider,
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,provider',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Trigger initial sync in the background
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    fetch(`${siteUrl}/api/nango/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ connectionId, provider }),
    }).catch(e => {
      console.warn('[Nango] Background sync trigger failed:', e);
    });

    return NextResponse.json({ connection: data });

  } catch (error) {
    console.error('[Nango] Error registering connection:', error);
    return NextResponse.json(
      { error: 'Failed to register connection' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/nango/connections
 * Update connection settings (e.g., folder selection or file selection)
 */
export async function PATCH(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    // Check if request comes from config-ui (has admin auth header)
    const authHeader = request.headers.get('authorization');
    const isConfigUI = authHeader?.startsWith('Bearer ');

    let userId: string;

    if (isConfigUI) {
      // Config-UI admin access - get first valid user for representative view
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
      }

      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      userId = users?.users?.[0]?.id || '';

      if (!userId) {
        return NextResponse.json(
          { error: 'No users found - create a user first' },
          { status: 404 }
        );
      }
    } else {
      // Normal user authentication via Next.js session
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      userId = user.id;
    }

    const body = await request.json() as {
      provider: SupportedProvider;
      syncFolderId?: string;
      syncFolderName?: string;
      syncFolderPath?: string;
      syncFileIds?: string[];
      syncFileNames?: string[];
    };

    const { provider, syncFolderId, syncFolderName, syncFolderPath, syncFileIds, syncFileNames } = body;

    // Debug logging for multi-folder troubleshooting
    console.log('[PATCH connections] Received:', JSON.stringify({
      provider,
      syncFolderId,
      syncFolderName,
      syncFileIds,
      hasBothFields: syncFolderId !== undefined && syncFileIds !== undefined
    }));

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Build update object based on what's provided
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Check if BOTH folder and file data are provided (multi-folder/multi-page mode)
    const hasBothFields = syncFolderId !== undefined && syncFileIds !== undefined;

    if (hasBothFields) {
      // Multi-folder/multi-page mode: keep both fields
      updateData.sync_folder_id = syncFolderId;
      updateData.sync_folder_name = syncFolderName;
      updateData.sync_folder_path = syncFolderPath;
      updateData.sync_file_ids = syncFileIds;
      updateData.sync_file_names = syncFileNames;
    } else if (syncFolderId !== undefined) {
      // Single folder mode: update folder fields and clear file fields
      updateData.sync_folder_id = syncFolderId;
      updateData.sync_folder_name = syncFolderName;
      updateData.sync_folder_path = syncFolderPath;
      updateData.sync_file_ids = null;
      updateData.sync_file_names = null;
    } else if (syncFileIds !== undefined) {
      // File-only mode: update file fields and clear folder fields
      updateData.sync_file_ids = syncFileIds;
      updateData.sync_file_names = syncFileNames;
      updateData.sync_folder_id = null;
      updateData.sync_folder_name = null;
      updateData.sync_folder_path = null;
    }

    // Update the connection
    const { data, error } = await supabaseAdmin
      .from('nango_connections')
      .update(updateData)
      .eq('user_id', userId)
      .eq('provider', provider)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ connection: data });

  } catch (error) {
    console.error('[Nango] Error updating connection:', error);
    return NextResponse.json(
      { error: 'Failed to update connection' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/nango/connections
 * Disconnect a provider
 */
export async function DELETE(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    // Check if request comes from config-ui (has admin auth header)
    const authHeader = request.headers.get('authorization');
    const isConfigUI = authHeader?.startsWith('Bearer ');

    let userId: string;

    if (isConfigUI) {
      // Config-UI admin access - get first valid user for representative view
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
      }

      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      userId = users?.users?.[0]?.id || '';

      if (!userId) {
        return NextResponse.json(
          { error: 'No users found - create a user first' },
          { status: 404 }
        );
      }
    } else {
      // Normal user authentication via Next.js session
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      userId = user.id;
    }

    const { provider } = await request.json() as { provider: SupportedProvider };

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get the connection record
    const { data: connRecord } = await supabaseAdmin
      .from('nango_connections')
      .select('connection_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (connRecord) {
      // Delete from Nango
      const nango = getNango();
      const integrationId = PROVIDER_CONFIG[provider]?.integrationId || provider;
      try {
        await nango.deleteConnection(integrationId, connRecord.connection_id);
      } catch (e) {
        console.warn('[Nango] Connection may already be deleted from Nango:', e);
      }
    }

    // Delete from our database
    await supabaseAdmin
      .from('nango_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    // Mark synced files as disconnected (don't delete documents)
    await supabaseAdmin
      .from('nango_sync_records')
      .update({ status: 'disconnected' })
      .eq('user_id', userId)
      .eq('provider', provider);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[Nango] Error disconnecting provider:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
