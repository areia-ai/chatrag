import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getNango, isNangoEnabled } from '@/lib/nango/client';
import { syncDocumentsForConnection } from '@/lib/nango/sync-manager';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for large syncs

/**
 * POST /api/nango/sync
 * Manually trigger a sync for a connection
 */
export async function POST(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { connectionId, provider, syncAll } = await request.json() as {
      connectionId?: string;
      provider?: SupportedProvider;
      syncAll?: boolean;
    };

    const supabaseAdmin = getSupabaseAdmin();
    const nango = getNango();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (syncAll) {
      // Sync all connected providers for this user
      const { data: connections } = await supabaseAdmin
        .from('nango_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'connected');

      const results = [];
      for (const conn of connections || []) {
        try {
          // Trigger Nango sync first (only if configured)
          const providerConfig = PROVIDER_CONFIG[conn.provider as SupportedProvider];
          const integrationId = providerConfig?.integrationId || conn.provider;

          if (providerConfig?.syncName) {
            try {
              await nango.triggerSync(integrationId, [conn.connection_id], providerConfig.syncName);
            } catch (e) {
              console.warn(`[Nango] Could not trigger Nango sync for ${conn.provider}:`, e);
            }
          }

          // Process documents
          const stats = await syncDocumentsForConnection(
            conn.connection_id,
            conn.provider
          );
          results.push({ provider: conn.provider, ...stats });
        } catch (e) {
          results.push({
            provider: conn.provider,
            error: e instanceof Error ? e.message : 'Sync failed',
          });
        }
      }

      return NextResponse.json({ results });
    }

    if (!connectionId || !provider) {
      return NextResponse.json(
        { error: 'connectionId and provider are required' },
        { status: 400 }
      );
    }

    // Verify user owns this connection
    const { data: connRecord } = await supabaseAdmin
      .from('nango_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('connection_id', connectionId)
      .single();

    if (!connRecord) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    // Trigger Nango sync first (only if configured)
    const providerConfig = PROVIDER_CONFIG[provider];
    const integrationId = providerConfig?.integrationId || provider;

    if (providerConfig?.syncName) {
      try {
        await nango.triggerSync(integrationId, [connectionId], providerConfig.syncName);
      } catch (e) {
        console.warn(`[Nango] Could not trigger Nango sync for ${provider}:`, e);
      }
    }

    // Then process documents
    const stats = await syncDocumentsForConnection(connectionId, provider);

    // Update last sync time
    await supabaseAdmin
      .from('nango_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('connection_id', connectionId);

    return NextResponse.json(stats);

  } catch (error) {
    console.error('[Nango] Sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    );
  }
}
