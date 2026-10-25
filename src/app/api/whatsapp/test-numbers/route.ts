import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppClient } from '@/lib/whatsapp/client-factory';
import { logger } from '@/lib/logger';

/**
 * Test endpoint to send a message with numbers to WhatsApp
 * Use this to diagnose the numbers stripping issue
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, phoneNumber, testType = 'simple' } = body;

    if (!sessionId || !phoneNumber) {
      return NextResponse.json(
        { error: 'sessionId and phoneNumber are required' },
        { status: 400 }
      );
    }

    const whatsappClient = getWhatsAppClient();

    // Format phone number as WhatsApp JID
    const to = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

    let testMessage = '';

    switch (testType) {
      case 'simple':
        testMessage = 'Test message with numbers: $39,669 million and 28.0% increase';
        break;

      case 'formatted':
        testMessage = '*Revenue Report:*\n\n' +
                     '- Q1: $39,669 million\n' +
                     '- Q2: $49,856 million (28.0% increase)\n' +
                     '- Q3: $37,542 million';
        break;

      case 'plain':
        testMessage = 'Numbers without formatting: 39669 49856 37542 28 24 2.3 90.8';
        break;

      case 'unicode':
        // Test with different number formats
        testMessage = 'Testing different formats:\n' +
                     'ASCII: $39,669\n' +
                     'No comma: $39669\n' +
                     'Percentage: 28.0%\n' +
                     'Decimal: 2.3\n' +
                     'Large: $70,000,000';
        break;

      case 'escaped':
        // Test with escaped characters
        testMessage = 'Testing escaped: \\$39,669 million and 28.0\\% increase';
        break;

      case 'plaintext':
        // Test with plain text format (new formatter)
        testMessage = '*Apple iPhone Revenue Analysis*\n\n' +
                     'Revenue Overview:\n' +
                     'Apple revenue from iPhone sales has shown fluctuations.\n\n' +
                     'Quarterly Data:\n' +
                     '- Q1 2024: iPhone revenue was $39,669 million\n' +
                     '- Q2 2024: iPhone revenue was $49,856 million (28.0% increase)\n' +
                     '- Q3 2024: iPhone revenue decreased to $37,542 million\n' +
                     '- Q4 2024: Revenue was $45,000 million (5% decline)\n\n' +
                     'These numbers show quarterly trends with percentages.';
        break;

      case 'json':
        // Send as JSON string to see if it helps
        testMessage = JSON.stringify({
          revenue: "$39,669 million",
          increase: "28.0%"
        });
        break;

      default:
        testMessage = body.customMessage || 'Test: $39,669 million';
    }

    logger.info('WhatsAppTestNumbers', `Sending test message type: ${testType}`);
    logger.info('WhatsAppTestNumbers', `Test message: ${testMessage}`);

    // Send the test message
    const result = await whatsappClient.sendTextMessage(sessionId, to, testMessage);

    // Check what was actually sent by requesting it back (if possible)
    logger.info('WhatsAppTestNumbers', 'Message sent successfully:', result);

    return NextResponse.json({
      success: true,
      testType,
      messageSent: testMessage,
      messageId: result.messageId,
      status: result.status,
      debug: {
        sessionId,
        to,
        messageLength: testMessage.length,
        containsDollarSign: testMessage.includes('$'),
        containsComma: testMessage.includes(','),
        containsPercentage: testMessage.includes('%')
      }
    });

  } catch (error: any) {
    logger.error('WhatsAppTestNumbers', 'Test failed:', error);
    return NextResponse.json(
      {
        error: error.message || 'Test failed',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}