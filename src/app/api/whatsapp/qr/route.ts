import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionManager } from '@/lib/whatsapp/session-manager';
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
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    logger.info('WhatsApp QR', `Fetching QR code for session: ${sessionId}`);

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

    // Refresh QR code if needed
    if (session.status === 'qr_pending' && !session.qrCode) {
      const qrData = await sessionManager.refreshQRCode(sessionId);
      return NextResponse.json({
        qrCode: qrData.qrCode,
        expiresAt: qrData.expiresAt,
        status: 'qr_pending'
      });
    }

    return NextResponse.json({
      qrCode: session.qrCode,
      expiresAt: session.qrExpiresAt,
      status: session.status
    });
  } catch (error: any) {
    logger.error('WhatsApp QR', 'Failed to fetch QR code:', error);

    return NextResponse.json(
      { error: 'Failed to fetch QR code' },
      { status: 500 }
    );
  }
}