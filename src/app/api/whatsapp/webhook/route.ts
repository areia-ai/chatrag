import { NextRequest, NextResponse } from 'next/server';
import { getWebhookHandler } from '@/lib/whatsapp/webhook-handler';
import { getWhatsAppClient } from '@/lib/whatsapp/client-factory';
import { KoyebWebhookPayload } from '@/lib/whatsapp/types';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Validate webhook signature
    const signature = request.headers.get('x-webhook-signature');
    const rawBody = await request.text();

    if (env.WHATSAPP_WEBHOOK_SECRET) {
      const whatsappClient = getWhatsAppClient();
      const isValid = !!signature && whatsappClient.verifyWebhookSignature(rawBody, signature);

      if (!isValid) {
        logger.warn('WhatsApp Webhook', 'Invalid webhook signature');
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    }

    // Parse payload
    let payload: KoyebWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      logger.error('WhatsApp Webhook', 'Failed to parse webhook payload:', error);
      return NextResponse.json(
        { error: 'Invalid payload' },
        { status: 400 }
      );
    }

    logger.info('WhatsApp Webhook', `Received webhook event: ${payload.event}`);
    
    // Log the full payload for debugging message structure
    if (payload.event === 'message') {
      logger.info('WhatsApp Webhook', 'Message payload:', JSON.stringify(payload, null, 2));
    }

    // Process webhook
    const webhookHandler = getWebhookHandler();
    await webhookHandler.handleWebhook(payload);

    return NextResponse.json({
      success: true,
      received: true
    });
  } catch (error: any) {
    logger.error('WhatsApp Webhook', 'Webhook processing failed:', error);

    // Return success to avoid retries from Koyeb
    return NextResponse.json({
      success: false,
      error: error.message
    });
  }
}

// Handle GET requests for webhook verification
export async function GET(request: NextRequest) {
  // Some webhook systems send a GET request to verify the endpoint
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge');

  if (challenge) {
    // Echo back the challenge for verification
    return new Response(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }

  return NextResponse.json({
    status: 'ok',
    endpoint: 'WhatsApp webhook'
  });
}