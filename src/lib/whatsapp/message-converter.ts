import { ExtendedMessage, ContentPart, Attachment } from '@/types/chat';
import { BaileysMessage, KoyebWebhookPayload } from './types';
import { nanoid } from 'nanoid';
import { logger } from '@/lib/logger';

/**
 * Converts messages between WhatsApp and ChatRAG formats
 */
export class WhatsAppMessageConverter {
  /**
   * Convert WhatsApp message to ChatRAG format
   */
  static toChatRAGMessage(
    whatsappMsg: KoyebWebhookPayload,
    userId: string
  ): ExtendedMessage | null {
    if (whatsappMsg.event !== 'message' || !whatsappMsg.data.message) {
      return null;
    }

    const { from, message } = whatsappMsg.data;
    const content: ContentPart[] = [];

    // Extract text content
    if (message.conversation) {
      content.push({
        type: 'text',
        text: message.conversation
      });
    } else if (message.extendedTextMessage) {
      content.push({
        type: 'text',
        text: message.extendedTextMessage.text
      });
    }

    // Extract image content
    if (message.imageMessage) {
      content.push({
        type: 'image_url',
        image_url: {
          url: message.imageMessage.url || ''
        }
      });
      if (message.imageMessage.caption) {
        content.push({
          type: 'text',
          text: message.imageMessage.caption
        });
      }
    }

    // Extract document content
    if (message.documentMessage) {
      content.push({
        type: 'document',
        document: {
          type: this.getDocumentType(message.documentMessage.fileName || ''),
          name: message.documentMessage.fileName || 'document',
          text: '', // Will need to be processed separately
          id: nanoid()
        }
      });
    }

    // Extract video content
    if (message.videoMessage) {
      content.push({
        type: 'text',
        text: `[Video${message.videoMessage.caption ? `: ${message.videoMessage.caption}` : ''}]`
      });
    }

    // Extract audio content
    if (message.audioMessage) {
      content.push({
        type: 'text',
        text: '[Audio message]'
      });
    }

    if (content.length === 0) {
      logger.warn('WhatsAppMessageConverter', 'No content extracted from WhatsApp message');
      return null;
    }

    return {
      id: nanoid(),
      role: 'user',
      content: content.length === 1 && content[0].type === 'text' ? content[0].text! : content,
      createdAt: new Date(whatsappMsg.timestamp),
      name: from // Store the WhatsApp JID as the name
    };
  }

  /**
   * Convert ChatRAG message to WhatsApp payload
   */
  static toWhatsAppPayload(
    message: string | ContentPart[],
    mediaUrls?: string[]
  ): any {
    // If it's a simple string message
    if (typeof message === 'string') {
      return { text: message };
    }

    // If it's an array of content parts
    const textParts: string[] = [];
    let imageUrl: string | undefined;
    let documentUrl: string | undefined;
    let documentName: string | undefined;

    for (const part of message) {
      switch (part.type) {
        case 'text':
          if (part.text) {
            textParts.push(part.text);
          }
          break;

        case 'generated_image':
          if (part.generated_images && part.generated_images.length > 0) {
            imageUrl = part.generated_images[0];
            textParts.push('[Generated image]');
          }
          break;

        case 'generated_video':
          if (part.generated_videos && part.generated_videos.length > 0) {
            textParts.push('[Generated video - please view in ChatRAG]');
          }
          break;

        case 'generated_3d_model':
          textParts.push('[3D model generated - please view in ChatRAG]');
          break;

        case 'document_reference':
          if (part.documents && part.documents.length > 0) {
            textParts.push(`Referenced documents: ${part.documents.map(d => d.name).join(', ')}`);
          }
          break;

        case 'tool_result':
          textParts.push('[Tool execution result - see ChatRAG for details]');
          break;

        default:
          break;
      }
    }

    // Combine all text parts
    const text = textParts.join('\n\n');

    // Return appropriate message format
    if (imageUrl) {
      return {
        image: {
          url: imageUrl,
          caption: text || undefined
        }
      };
    } else if (documentUrl && documentName) {
      return {
        document: {
          url: documentUrl,
          filename: documentName,
          caption: text || undefined
        }
      };
    } else {
      return { text: text || 'No content to display' };
    }
  }

  /**
   * Extract media attachments from WhatsApp message
   */
  static extractMediaFromMessage(payload: KoyebWebhookPayload): Attachment[] {
    const attachments: Attachment[] = [];

    if (payload.event !== 'message' || !payload.data.message) {
      return attachments;
    }

    const { message } = payload.data;

    if (message.imageMessage?.url) {
      attachments.push({
        url: message.imageMessage.url,
        name: 'image.jpg',
        contentType: 'image/jpeg'
      });
    }

    if (message.documentMessage?.url) {
      attachments.push({
        url: message.documentMessage.url,
        name: message.documentMessage.fileName || 'document',
        contentType: 'application/octet-stream'
      });
    }

    if (message.videoMessage?.url) {
      attachments.push({
        url: message.videoMessage.url,
        name: 'video.mp4',
        contentType: 'video/mp4'
      });
    }

    if (message.audioMessage?.url) {
      attachments.push({
        url: message.audioMessage.url,
        name: 'audio.mp3',
        contentType: 'audio/mpeg'
      });
    }

    return attachments;
  }

  /**
   * Format phone number to WhatsApp JID
   */
  static formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-numeric characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if not present (assuming US for now)
    const withCountryCode = cleaned.startsWith('1') ? cleaned : `1${cleaned}`;
    
    // Format as WhatsApp JID
    return `${withCountryCode}@s.whatsapp.net`;
  }

  /**
   * Extract phone number from WhatsApp JID
   */
  static extractPhoneNumber(jid: string): string {
    return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
  }

  /**
   * Determine document type from filename
   */
  private static getDocumentType(filename: string): 'pdf' | 'doc' | 'docx' | 'txt' {
    const extension = filename.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'pdf':
        return 'pdf';
      case 'doc':
        return 'doc';
      case 'docx':
        return 'docx';
      case 'txt':
        return 'txt';
      default:
        return 'txt'; // Default to text
    }
  }

  /**
   * Split long messages for WhatsApp (max 4096 characters)
   */
  static splitLongMessage(message: string, maxLength: number = 4096): string[] {
    if (message.length <= maxLength) {
      return [message];
    }

    const parts: string[] = [];
    let currentPart = '';

    const lines = message.split('\n');
    
    for (const line of lines) {
      if (currentPart.length + line.length + 1 > maxLength) {
        parts.push(currentPart.trim());
        currentPart = line;
      } else {
        currentPart += (currentPart ? '\n' : '') + line;
      }
    }

    if (currentPart) {
      parts.push(currentPart.trim());
    }

    return parts;
  }

  /**
   * Format ChatRAG response as plain text for WhatsApp - preserves all numbers correctly
   * This removes ALL formatting to ensure numbers are preserved
   */
  static formatPlainTextForWhatsApp(response: string): string {
    logger.info('WhatsAppMessageConverter', `[DEBUG] formatPlainTextForWhatsApp input (first 500 chars): ${response.substring(0, 500)}`);

    // Strip ALL markdown and formatting, keep only plain text
    const plainText = response
      // Remove code blocks but keep the code
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```\w*\n?/g, '').trim();
        return '\n' + code + '\n';
      })
      // Remove markdown links but keep the text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Convert headers to plain text with line breaks
      .replace(/#{1,6}\s(.+)/gm, '\n$1\n')
      // Remove bold markdown
      .replace(/\*\*(.+?)\*\*/g, '$1')
      // Remove italic markdown
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // Remove strikethrough
      .replace(/~~(.+?)~~/g, '$1')
      // Remove underline
      .replace(/__(.+?)__/g, '$1')
      // Convert bullet points to simple dashes
      .replace(/^[•·▪▫◦‣⁃]\s/gm, '- ')
      // Convert numbered lists to plain format
      .replace(/^\d+\.\s/gm, (match) => match)
      // Remove any remaining markdown syntax
      .replace(/^>\s/gm, '')  // Remove blockquotes
      .replace(/\|/g, ' ')     // Remove table pipes
      // Normalize whitespace
      .replace(/\n{3,}/g, '\n\n')  // Max 2 line breaks
      .replace(/[ \t]+/g, ' ')      // Normalize spaces
      .trim();

    logger.info('WhatsAppMessageConverter', `[DEBUG] formatPlainTextForWhatsApp output (first 500 chars): ${plainText.substring(0, 500)}`);

    // Verify numbers are preserved
    const numberMatches = plainText.match(/\d+([,.]?\d+)*/g);
    const currencyMatches = plainText.match(/\$[\d,]+/g);
    const percentageMatches = plainText.match(/\d+\.?\d*%/g);

    logger.info('WhatsAppMessageConverter', `[PLAIN TEXT] Found numbers: ${JSON.stringify(numberMatches?.slice(0, 5))}`);
    logger.info('WhatsAppMessageConverter', `[PLAIN TEXT] Found currency: ${JSON.stringify(currencyMatches?.slice(0, 5))}`);
    logger.info('WhatsAppMessageConverter', `[PLAIN TEXT] Found percentages: ${JSON.stringify(percentageMatches?.slice(0, 5))}`);

    return plainText;
  }
  
  /**
   * Alternative formatter that makes text readable even with visible \n
   */
  static formatForReadability(response: string): string {
    // If newlines are showing as \n, format the text to be readable anyway
    const formatted = response
      .replace(/#{1,6}\s(.+)/gm, '[$1]') // Headers in brackets
      .replace(/\*\*(.+?)\*\*/g, '*$1*') // Bold
      .replace(/^- /gm, '• ') // Lists
      .replace(/\n\n\n+/g, ' | ') // Multiple breaks become separator
      .replace(/\n\n/g, ' | ') // Double breaks become separator  
      .replace(/\n/g, ' ') // Single breaks become space
      .trim();
    
    return formatted;
  }
}