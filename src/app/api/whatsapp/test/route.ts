import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppClient } from '@/lib/whatsapp/client-factory';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, to, message } = await request.json();

    if (!sessionId || !to || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, to, message' },
        { status: 400 }
      );
    }

    logger.info('WhatsApp Test', 'Testing direct message send');
    logger.info('WhatsApp Test', 'Message details:', {
      hasNewlines: message.includes('\n'),
      hasEscapedNewlines: message.includes('\\n'),
      message: message.replace(/\n/g, '[NL]')
    });

    const whatsappClient = getWhatsAppClient();
    
    // Test 1: Send message as provided
    const result1 = await whatsappClient.sendTextMessage(sessionId, to, message);
    
    // Test 2: Send message with explicit newlines
    const testMessage = 'Test message line 1\nTest message line 2\nTest message line 3';
    const result2 = await whatsappClient.sendTextMessage(sessionId, to, testMessage);
    
    // Test 3: Send message with unicode line separator
    const unicodeMessage = 'Unicode line 1\u2028Unicode line 2\u2028Unicode line 3';
    const result3 = await whatsappClient.sendTextMessage(sessionId, to, unicodeMessage);
    
    // Test 4: Send another message with different formatting
    const formattedMessage = 'Formatted test\nLine 2\nLine 3';
    const result4 = await whatsappClient.sendTextMessage(sessionId, to, formattedMessage);

    return NextResponse.json({
      success: true,
      tests: {
        originalMessage: {
          result: result1,
          messageAnalysis: {
            hasNewlines: message.includes('\n'),
            hasEscapedNewlines: message.includes('\\n'),
            preview: message.substring(0, 100)
          }
        },
        explicitNewlines: {
          result: result2,
          message: testMessage
        },
        unicodeLineSeparator: {
          result: result3,
          message: unicodeMessage
        },
        formattedMessage: {
          result: result4,
          message: formattedMessage,
          description: 'Message with explicit newlines'
        }
      }
    });
  } catch (error: any) {
    logger.error('WhatsApp Test', 'Test failed:', error);
    return NextResponse.json(
      { error: error.message || 'Test failed' },
      { status: 500 }
    );
  }
}