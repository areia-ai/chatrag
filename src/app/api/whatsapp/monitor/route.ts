import { NextResponse } from 'next/server';
import { startGlobalMonitoring, stopGlobalMonitoring, getConnectionMonitor } from '@/lib/whatsapp/connection-monitor';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

/**
 * API endpoint to control WhatsApp connection monitoring
 */

export async function GET() {
  try {
    // Check if WhatsApp is enabled
    if (env.NEXT_PUBLIC_WHATSAPP_ENABLED !== 'true') {
      return NextResponse.json({
        enabled: false,
        message: 'WhatsApp integration is disabled'
      });
    }

    const monitor = getConnectionMonitor();
    return NextResponse.json({
      enabled: true,
      status: 'running',
      message: 'WhatsApp connection monitor is active'
    });
  } catch (error) {
    logger.error('WhatsAppMonitor', 'Failed to get monitor status:', error);
    return NextResponse.json(
      { error: 'Failed to get monitor status' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    // Check if WhatsApp is enabled
    if (env.NEXT_PUBLIC_WHATSAPP_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'WhatsApp integration is disabled' },
        { status: 400 }
      );
    }

    if (action === 'start') {
      startGlobalMonitoring();
      logger.info('WhatsAppMonitor', 'Started global monitoring');
      return NextResponse.json({
        status: 'started',
        message: 'WhatsApp connection monitoring started'
      });
    } else if (action === 'stop') {
      stopGlobalMonitoring();
      logger.info('WhatsAppMonitor', 'Stopped global monitoring');
      return NextResponse.json({
        status: 'stopped',
        message: 'WhatsApp connection monitoring stopped'
      });
    } else if (action === 'force_reconnect' && body.sessionId) {
      const monitor = getConnectionMonitor();
      await monitor.forceReconnect(body.sessionId);
      return NextResponse.json({
        status: 'reconnecting',
        message: `Force reconnecting session: ${body.sessionId}`
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "start", "stop", or "force_reconnect"' },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('WhatsAppMonitor', 'Monitor control error:', error);
    return NextResponse.json(
      { error: 'Failed to control monitor' },
      { status: 500 }
    );
  }
}