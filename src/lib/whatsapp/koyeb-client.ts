import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  KoyebSessionRequest,
  KoyebSessionResponse,
  KoyebMessagePayload,
  WhatsAppError,
  WhatsAppErrorCodes,
  WhatsAppMediaUploadResponse
} from './types';
import { BaseWhatsAppClient } from './base-client';

/**
 * Koyeb Baileys API Client
 * Handles communication with the Koyeb-hosted Baileys WhatsApp instance
 */
export class KoyebWhatsAppClient extends BaseWhatsAppClient {
  constructor() {
    super(
      env.KOYEB_BAILEYS_URL || '',
      env.KOYEB_API_KEY,
      env.WHATSAPP_WEBHOOK_SECRET
    );

    if (!this.baseUrl) {
      throw new Error('KOYEB_BAILEYS_URL is not configured');
    }

    logger.info('KoyebWhatsAppClient', `Initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Make authenticated request to Koyeb API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Log the full request details for debugging
    // logger.info('KoyebWhatsAppClient', 'Making request:', {
    //   url,
    //   method: options.method,
    //   headers,
    //   bodyLength: options.body ? options.body.length : 0,
    //   bodyPreview: options.body ? options.body.substring(0, 200) + '...' : 'no body'
    // });
    
    // Log if body contains escaped newlines (in stringified JSON, \n becomes \\n)
    if (options.body && options.body.includes('\\\\n')) {
      logger.warn('KoyebWhatsAppClient', 'Request body contains double-escaped newlines');
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error('KoyebWhatsAppClient', 'Koyeb API error:', {
          status: response.status,
          statusText: response.statusText,
          url: url,
          method: options.method,
          body: options.body,
          error: data
        });
        
        throw new WhatsAppError(
          data.message || 'Koyeb API request failed',
          WhatsAppErrorCodes.KOYEB_API_ERROR,
          response.status,
          data
        );
      }

      return data;
    } catch (error) {
      if (error instanceof WhatsAppError) {
        throw error;
      }

      logger.error('KoyebWhatsAppClient', 'Request failed:', error);
      throw new WhatsAppError(
        'Failed to communicate with Koyeb API',
        WhatsAppErrorCodes.KOYEB_API_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Create a new WhatsApp session
   */
  async createSession(userId: string, metadata?: Record<string, any>): Promise<KoyebSessionResponse> {
    logger.info('KoyebWhatsAppClient', `Creating session for user: ${userId}`);

    const payload: KoyebSessionRequest = {
      userId,
      metadata
    };

    const response = await this.request<KoyebSessionResponse>(
      '/api/sessions/create',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );

    logger.info('KoyebWhatsAppClient', `Session created: ${response.sessionId}`);
    return response;
  }

  /**
   * Get QR code for session authentication
   */
  async getQRCode(sessionId: string): Promise<{ qrCode: string; expiresAt: string }> {
    logger.debug('KoyebWhatsAppClient', `Fetching QR code for session: ${sessionId}`);

    const response = await this.request<{ qr?: string; qrCode?: string; expiresAt: string }>(
      `/api/sessions/${sessionId}/qr`,
      {
        method: 'GET'
      }
    );

    // Handle both 'qr' and 'qrCode' property names from the API
    return {
      qrCode: response.qr || response.qrCode || '',
      expiresAt: response.expiresAt
    };
  }

  /**
   * Get session status
   */
  async getSessionStatus(sessionId: string): Promise<{ status: string; isConnected: boolean; phoneNumber?: string }> {
    logger.debug('KoyebWhatsAppClient', `Checking status for session: ${sessionId}`);

    const response = await this.request<{ 
      status: string; 
      isConnected?: boolean; 
      connected?: boolean; 
      phoneNumber?: string 
    }>(
      `/api/sessions/${sessionId}/status`,
      {
        method: 'GET'
      }
    );

    // Handle both 'connected' and 'isConnected' property names from the API
    return {
      status: response.status,
      isConnected: response.isConnected !== undefined ? response.isConnected : (response.connected || false),
      phoneNumber: response.phoneNumber
    };
  }

  /**
   * Disconnect and remove session
   */
  async disconnectSession(sessionId: string): Promise<void> {
    logger.info('KoyebWhatsAppClient', `Disconnecting session: ${sessionId}`);

    await this.request<void>(
      `/api/sessions/${sessionId}`,
      {
        method: 'DELETE'
      }
    );

    logger.info('KoyebWhatsAppClient', `Session disconnected: ${sessionId}`);
  }

  /**
   * Send a message via WhatsApp
   */
  async sendMessage(payload: KoyebMessagePayload): Promise<{ messageId: string; status: string }> {
    logger.info('KoyebWhatsAppClient', `Sending message to: ${payload.to}`);
    
    // Log the payload before stringifying to see the actual content
    logger.info('KoyebWhatsAppClient', 'Message payload:', {
      sessionId: payload.sessionId,
      to: payload.to,
      messageTextLength: payload.message.text?.length,
      messageTextPreview: payload.message.text?.substring(0, 100) + '...'
    });

    // If the message only contains text, send it as a string
    if (payload.message.text && !payload.message.image && !payload.message.document) {
      logger.info('KoyebWhatsAppClient', 'Text-only message detected, using string format');
      const simplifiedPayload = {
        sessionId: payload.sessionId,
        to: payload.to,
        message: payload.message.text  // Send text as 'message' string
      };
      
      const response = await this.request<{ messageId: string; status: string }>(
        '/api/messages/send',
        {
          method: 'POST',
          body: JSON.stringify(simplifiedPayload)
        }
      );

      logger.info('KoyebWhatsAppClient', `Message sent: ${response.messageId}`);
      return response;
    }

    // For complex messages, use the original format
    const response = await this.request<{ messageId: string; status: string }>(
      '/api/messages/send',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );

    logger.info('KoyebWhatsAppClient', `Message sent: ${response.messageId}`);
    return response;
  }
  
  /**
   * Send text message with Baileys-compatible format
   * This method tries to match the exact format Baileys expects
   */
  async sendBaileysFormatMessage(sessionId: string, to: string, text: string): Promise<{ messageId: string; status: string }> {
    logger.info('KoyebWhatsAppClient', 'Sending message in Baileys format');
    
    // Try the format that matches Baileys documentation:
    // await sock.sendMessage(jid, { text: 'Hello World' })
    const baileysPayload = {
      sessionId,
      to,
      text  // Just 'text' field, not 'message'
    };
    
    logger.info('KoyebWhatsAppClient', 'Baileys format payload:', {
      sessionId,
      to,
      textLength: text.length,
      textPreview: text.substring(0, 50).replace(/\n/g, '[NL]') + '...'
    });
    
    return this.request<{ messageId: string; status: string }>(
      '/api/messages/send',
      {
        method: 'POST',
        body: JSON.stringify(baileysPayload)
      }
    );
  }

  /**
   * Register webhook for receiving messages
   */
  async registerWebhook(sessionId: string, webhookUrl: string): Promise<void> {
    logger.info('KoyebWhatsAppClient', `Registering webhook for session: ${sessionId}`);

    await this.request<void>(
      '/api/webhook/register',
      {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          webhookUrl,
          secret: this.webhookSecret
        })
      }
    );

    logger.info('KoyebWhatsAppClient', `Webhook registered for session: ${sessionId}`);
  }

  /**
   * Upload media to Koyeb for sending
   */
  async uploadMedia(
    sessionId: string,
    file: Buffer | ArrayBuffer,
    filename: string,
    mimeType: string
  ): Promise<WhatsAppMediaUploadResponse> {
    logger.info('KoyebWhatsAppClient', `Uploading media: ${filename}`);

    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('file', new Blob([file], { type: mimeType }), filename);

    const response = await fetch(`${this.baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new WhatsAppError(
        'Media upload failed',
        WhatsAppErrorCodes.KOYEB_API_ERROR,
        response.status,
        error
      );
    }

    const data = await response.json();
    logger.info('KoyebWhatsAppClient', `Media uploaded: ${data.mediaId}`);
    return data;
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(signature: string, payload: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('KoyebWhatsAppClient', 'No webhook secret configured');
      return false;
    }

    // Simple HMAC validation
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Send text message helper
   */
  async sendTextMessage(sessionId: string, to: string, text: string): Promise<{ messageId: string; status: string }> {
    // Baileys server expects 'message' field as a string, not 'text'
    // logger.info('KoyebWhatsAppClient', 'Sending text message with correct format');
    
    // Log to see if we have actual newlines
    // logger.info('KoyebWhatsAppClient', 'Text analysis:', {
    //   hasActualNewlines: text.includes('\n'),
    //   hasEscapedNewlines: text.includes('\\n'),
    //   newlineCount: (text.match(/\n/g) || []).length,
    //   sample: text.substring(0, 100).replace(/\n/g, '[NL]')
    // });
    
    // Important: Don't try to "fix" newlines here - they should already be correct
    // The text should contain actual \n characters, not escaped \\n
    
    const payload = {
      sessionId,
      to,
      message: text  // Send text as-is, JSON.stringify will handle encoding
    };
    
    // Create the JSON string to see what we're actually sending
    const jsonPayload = JSON.stringify(payload);
    
    // logger.info('KoyebWhatsAppClient', 'Message payload analysis:', {
    //   sessionId,
    //   to,
    //   messageLength: text.length,
    //   messagePreview: text.substring(0, 50) + '...',
    //   jsonPreview: jsonPayload.substring(0, 200) + '...',
    //   jsonHasDoubleBackslash: jsonPayload.includes('\\\\n')
    // });
    
    return this.request<{ messageId: string; status: string }>(
      '/api/messages/send',
      {
        method: 'POST',
        body: jsonPayload
      }
    );
  }

  /**
   * Send image message helper
   */
  async sendImageMessage(
    sessionId: string,
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<{ messageId: string; status: string }> {
    return this.sendMessage({
      sessionId,
      to,
      message: {
        image: {
          url: imageUrl,
          caption
        }
      }
    });
  }

  /**
   * Send document message helper
   */
  async sendDocumentMessage(
    sessionId: string,
    to: string,
    documentUrl: string,
    filename: string,
    caption?: string
  ): Promise<{ messageId: string; status: string }> {
    return this.sendMessage({
      sessionId,
      to,
      message: {
        document: {
          url: documentUrl,
          filename,
          caption
        }
      }
    });
  }

  /**
   * Health check for Koyeb instance
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      logger.error('KoyebWhatsAppClient', 'Health check failed:', error);
      return false;
    }
  }
}