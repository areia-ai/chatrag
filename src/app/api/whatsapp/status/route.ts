import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionManager } from '@/lib/whatsapp/session-manager';
import { getWhatsAppClient } from '@/lib/whatsapp/client-factory';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get session ID from query params
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      // Return all active sessions for user
      const sessionManager = getSessionManager();
      const sessions = await sessionManager.getUserSessions(user.id);
      
      return NextResponse.json({
        sessions: sessions.map(s => ({
          id: s.id,
          sessionId: s.sessionId,
          status: s.status,
          phoneNumber: s.phoneNumber,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
      });
    }

    logger.info('WhatsApp Status', `Checking status for session: ${sessionId}`);

    // Get session and verify ownership
    const sessionManager = getSessionManager();
    const session = await sessionManager.getSessionById(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    if (session.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Check real-time status from WhatsApp provider
    try {
      const whatsappClient = getWhatsAppClient();
      const providerStatus = await whatsappClient.getSessionStatus(sessionId);

      // Update local status if different
      if (providerStatus.isConnected && session.status !== 'connected') {
        await sessionManager.updateSessionStatus(sessionId, 'connected', {
          phoneNumber: providerStatus.phoneNumber
        });
      } else if (!providerStatus.isConnected && session.status === 'connected') {
        await sessionManager.updateSessionStatus(sessionId, 'disconnected');
      }

      return NextResponse.json({
        id: session.id,
        sessionId: session.sessionId,
        status: providerStatus.status || (providerStatus.isConnected ? 'connected' : 'disconnected'),
        phoneNumber: providerStatus.phoneNumber || session.phoneNumber,
        isConnected: providerStatus.isConnected,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      });
    } catch (error: any) {
      // If provider check fails, assume disconnected - NEVER return stale "connected"

      // If session not found (404), don't log as warning - it's expected for disconnected sessions
      if (error?.statusCode === 404 || error?.message?.includes('Session not found')) {
        logger.debug('WhatsApp Status', `Session ${sessionId} not found on provider (already disconnected)`);
      } else {
        logger.warn('WhatsApp Status', 'Provider status check failed, marking as disconnected', error);
      }

      // Update database to reflect disconnected status
      if (session.status === 'connected') {
        await sessionManager.updateSessionStatus(sessionId, 'disconnected');
      }

      return NextResponse.json({
        id: session.id,
        sessionId: session.sessionId,
        status: 'disconnected',
        phoneNumber: session.phoneNumber,
        isConnected: false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        error: 'Unable to verify connection with WhatsApp provider'
      });
    }
  } catch (error: any) {
    logger.error('WhatsApp Status', 'Failed to check status:', error);

    return NextResponse.json(
      { error: 'Failed to check WhatsApp status' },
      { status: 500 }
    );
  }
}