import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionManager } from '@/lib/whatsapp/session-manager';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Check if WhatsApp is enabled
    if (env.NEXT_PUBLIC_WHATSAPP_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'WhatsApp integration is not enabled' },
        { status: 400 }
      );
    }

    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    logger.info('WhatsApp Connect', `User ${user.id} initiating WhatsApp connection`);

    // Create session
    const sessionManager = getSessionManager();
    const session = await sessionManager.createSession(user.id);

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        sessionId: session.sessionId,
        status: session.status,
        phoneNumber: session.phoneNumber,
        qrCode: session.qrCode,
        qrExpiresAt: session.qrExpiresAt
      }
    });
  } catch (error: any) {
    logger.error('WhatsApp Connect', 'Connection failed:', error);

    if (error.code === 'SESSION_EXISTS') {
      // Get the existing session instead of failing
      const sessionManager = getSessionManager();
      const existingSession = await sessionManager.getActiveSession(user.id);
      
      if (existingSession) {
        return NextResponse.json(
          { 
            error: error.message,
            session: {
              id: existingSession.id,
              sessionId: existingSession.sessionId,
              status: existingSession.status,
              phoneNumber: existingSession.phoneNumber,
              qrCode: existingSession.qrCode,
              qrExpiresAt: existingSession.qrExpiresAt
            }
          },
          { status: 409 }
        );
      }
      
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }

    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create WhatsApp session' },
      { status: 500 }
    );
  }
}