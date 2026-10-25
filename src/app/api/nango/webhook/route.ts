import { NextRequest, NextResponse } from 'next/server';
import { isNangoEnabled, verifyWebhookSignature } from '@/lib/nango/client';
import { syncDocumentsForConnection } from '@/lib/nango/sync-manager';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { NangoWebhookPayload } from '@/lib/nango/types';

export const runtime = 'nodejs';

/**
 * POST /api/nango/webhook
 * Receives webhook notifications from Nango
 */
export async function POST(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json({ error: 'Nango not enabled' }, { status: 503 });
  }

  try {
    const signature = request.headers.get('x-nango-signature');
    const body = await request.text();

    // Verify webhook signature
    const isValid = verifyWebhookSignature(signature, body);

    if (!isValid) {
      console.error('[Nango Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload: NangoWebhookPayload = JSON.parse(body);

    console.log('[Nango Webhook] Received:', {
      type: payload.type,
      connectionId: payload.connectionId,
      provider: payload.providerConfigKey,
      syncName: payload.syncName,
    });

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      console.error('[Nango Webhook] Supabase admin not available');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    switch (payload.type) {
      case 'sync.success':
        // Sync completed successfully - process new/updated files
        console.log('[Nango Webhook] Sync success:', payload.responseResults);

        // Process documents in the background
        syncDocumentsForConnection(
          payload.connectionId,
          payload.providerConfigKey
        ).catch(error => {
          console.error('[Nango Webhook] Background sync failed:', error);
        });

        // Update last sync time
        await supabaseAdmin
          .from('nango_connections')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('connection_id', payload.connectionId);
        break;

      case 'sync.error':
        console.error('[Nango Webhook] Sync error:', payload.error);

        await supabaseAdmin
          .from('nango_connections')
          .update({
            status: 'error',
            metadata: { last_error: payload.error?.message },
          })
          .eq('connection_id', payload.connectionId);
        break;

      case 'auth.token_expired':
        console.warn('[Nango Webhook] Token expired for:', payload.connectionId);

        await supabaseAdmin
          .from('nango_connections')
          .update({ status: 'error', metadata: { error: 'Token expired' } })
          .eq('connection_id', payload.connectionId);
        break;

      default:
        console.log('[Nango Webhook] Unhandled type:', payload.type);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('[Nango Webhook] Error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
