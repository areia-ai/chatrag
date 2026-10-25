import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionManager } from '@/lib/whatsapp/session-manager';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
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

    // Get session ID from body
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    logger.info('WhatsApp Disconnect', `User ${user.id} disconnecting session: ${sessionId}`);

    // Disconnect session
    const sessionManager = getSessionManager();
    await sessionManager.disconnectSession(sessionId, user.id);

    return NextResponse.json({
      success: true,
      message: 'WhatsApp session disconnected successfully'
    });
  } catch (error: any) {
    logger.error('WhatsApp Disconnect', 'Disconnection failed:', error);

    if (error.code === 'UNAUTHORIZED') {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      );
    }

    if (error.code === 'SESSION_NOT_FOUND') {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to disconnect WhatsApp session' },
      { status: 500 }
    );
  }
}