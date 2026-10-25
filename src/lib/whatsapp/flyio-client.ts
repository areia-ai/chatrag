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
 * Fly.io Baileys API Client
 * Handles communication with the Fly.io-hosted Baileys WhatsApp instance
 */
export class FlyioWhatsAppClient extends BaseWhatsAppClient {
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private activeConnections = new Map<string, NodeJS.Timeout>();
  private sessionReconnectAttempts = new Map<string, number>();
  private maxReconnectAttempts = 3;
  private reconnectDelay = 5000; // 5 seconds

  constructor() {
    super(
      env.FLYIO_BAILEYS_URL || '',
      env.FLYIO_API_KEY,
      env.WHATSAPP_WEBHOOK_SECRET
    );

    if (!this.baseUrl) {
      throw new Error('FLYIO_BAILEYS_URL is not configured');
    }

    logger.info('FlyioWhatsAppClient', `Initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Make authenticated request to Fly.io API
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

    // Get timeout from environment or use default (30 seconds)
    const timeout = parseInt(env.FLYIO_REQUEST_TIMEOUT || '30000', 10);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const responseText = await response.text();

      if (!response.ok) {
        let error: WhatsAppError;
        try {
          const errorData = JSON.parse(responseText);
          error = new WhatsAppError(
            errorData.error || `Request failed with status ${response.status}`,
            errorData.code || WhatsAppErrorCodes.CONNECTION_ERROR,
            response.status
          );
        } catch {
          error = new WhatsAppError(
            `Request failed with status ${response.status}: ${responseText}`,
            WhatsAppErrorCodes.CONNECTION_ERROR,
            response.status
          );
        }
        throw error;
      }

      if (!responseText) {
        return {} as T;
      }

      try {
        return JSON.parse(responseText);
      } catch {
        return responseText as unknown as T;
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error instanceof WhatsAppError) {
        throw error;
      }
      
      // Handle timeout errors specifically
      if (error.name === 'AbortError') {
        logger.error('FlyioWhatsAppClient', `Request to ${endpoint} timed out after ${timeout}ms`);
        throw new WhatsAppError(
          `Request timeout after ${timeout}ms`,
          WhatsAppErrorCodes.CONNECTION_ERROR,
          504
        );
      }
      
      // Handle connection errors
      if (error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
        logger.error('FlyioWhatsAppClient', `Connection timeout to Fly.io instance at ${this.baseUrl}`);
        throw new WhatsAppError(
          'Unable to connect to Fly.io WhatsApp service. Please verify the instance is running.',
          WhatsAppErrorCodes.CONNECTION_ERROR,
          503
        );
      }
      
      logger.error('FlyioWhatsAppClient', 'Request failed:', error);
      throw new WhatsAppError(
        error.message || 'Failed to connect to Fly.io WhatsApp service',
        WhatsAppErrorCodes.CONNECTION_ERROR,
        500
      );
    }
  }

  /**
   * Create a new WhatsApp session
   */
  async createSession(
    userId: string,
    metadata?: Record<string, any>
  ): Promise<KoyebSessionResponse> {
    logger.info('FlyioWhatsAppClient', `Creating session for user: ${userId}`);
    
    // Generate a session ID from userId
    const sessionId = `flyio_${userId}_${Date.now()}`;
    
    const payload: KoyebSessionRequest = {
      userId,
      metadata
    };
    
    const response = await this.request<KoyebSessionResponse>('/api/sessions/create', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        ...payload
      })
    });
    
    // Ensure the response includes sessionId
    return {
      ...response,
      sessionId: response.sessionId || sessionId
    };
  }

  /**
   * Get QR code for session authentication
   */
  async getQRCode(sessionId: string): Promise<{ qrCode: string; expiresAt: string }> {
    logger.debug('FlyioWhatsAppClient', `Fetching QR code for session: ${sessionId}`);
    
    const response = await this.request<{ qr?: string; qrCode?: string; expiresAt?: string }>(
      `/api/sessions/${sessionId}/qr`
    );
    
    // Handle both 'qr' and 'qrCode' property names from the API
    return {
      qrCode: response.qr || response.qrCode || '',
      expiresAt: response.expiresAt || new Date(Date.now() + 60000).toISOString()
    };
  }
  
  /**
   * Legacy method for compatibility
   */
  async getSessionQR(sessionId: string): Promise<{ qr: string }> {
    logger.info('FlyioWhatsAppClient', `Getting QR for session: ${sessionId}`);
    
    return this.request<{ qr: string }>(
      `/api/sessions/${sessionId}/qr`
    );
  }

  /**
   * Get session status
   */
  async getSessionStatus(sessionId: string): Promise<{ 
    status: string; 
    isConnected: boolean; 
    phoneNumber?: string 
  }> {
    logger.info('FlyioWhatsAppClient', `Getting status for session: ${sessionId}`);
    
    const response = await this.request<{
      status: 'connected' | 'disconnected' | 'connecting' | 'qr' | 'pairing';
      phoneNumber?: string;
    }>(`/api/sessions/${sessionId}/status`);
    
    return {
      status: response.status,
      isConnected: response.status === 'connected',
      phoneNumber: response.phoneNumber
    };
  }

  /**
   * Disconnect and remove session
   */
  async disconnectSession(sessionId: string): Promise<void> {
    logger.info('FlyioWhatsAppClient', `Disconnecting session: ${sessionId}`);
    
    await this.request<void>(`/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
    
    logger.info('FlyioWhatsAppClient', `Session disconnected: ${sessionId}`);
  }

  /**
   * Register webhook for receiving messages
   */
  async registerWebhook(sessionId: string, webhookUrl: string): Promise<void> {
    logger.info('FlyioWhatsAppClient', `Registering webhook for session: ${sessionId}`);
    
    // Check if webhookUrl is provided
    if (!webhookUrl) {
      logger.warn('FlyioWhatsAppClient', 'No webhook URL provided, skipping webhook registration');
      throw new WhatsAppError(
        'Webhook URL required',
        WhatsAppErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    
    try {
      await this.request<void>('/api/webhook/register', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          url: webhookUrl,  // Fly.io backend expects 'url' not 'webhookUrl'
          secret: this.webhookSecret
        })
      });
      
      logger.info('FlyioWhatsAppClient', `Webhook registered successfully for session: ${sessionId}`);
    } catch (error) {
      logger.error('FlyioWhatsAppClient', 'Webhook registration failed:', error);
      throw error;
    }
  }

  /**
   * Send a message via WhatsApp with automatic retry on session disconnection
   */
  async sendMessage(payload: KoyebMessagePayload): Promise<{ messageId: string; status: string }> {
    logger.info('FlyioWhatsAppClient', `Sending message to: ${payload.to}`);

    // Try to send with retry logic
    return this.sendWithRetry(async () => {
      // If the message only contains text, send it as a string
      if (payload.message.text && !payload.message.image && !payload.message.document) {
        const simplifiedPayload = {
          sessionId: payload.sessionId,
          to: payload.to,
          message: payload.message.text
        };

        const response = await this.request<{ messageId: string; status?: string }>(
          '/api/messages/send',
          {
            method: 'POST',
            body: JSON.stringify(simplifiedPayload)
          }
        );

        return {
          messageId: response.messageId,
          status: response.status || 'sent'
        };
      }

      // For complex messages, use the original format
      const response = await this.request<{ messageId: string; status?: string }>(
        '/api/messages/send',
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );

      return {
        messageId: response.messageId,
        status: response.status || 'sent'
      };
    }, payload.sessionId);
  }

  /**
   * Send text message helper
   */
  async sendTextMessage(
    sessionId: string,
    to: string,
    text: string
  ): Promise<{ messageId: string; status: string }> {
    logger.info('FlyioWhatsAppClient', 'Sending text message with correct format');
    logger.info('FlyioWhatsAppClient', `[DEBUG] Text to send (first 500 chars): ${text.substring(0, 500)}`);

    // Check for number patterns in the text
    const numberMatches = text.match(/\d+([,.]?\d+)*/g);
    const currencyMatches = text.match(/\$[\d,]+/g);
    const percentageMatches = text.match(/\d+\.?\d*%/g);

    logger.info('FlyioWhatsAppClient', `[DEBUG] Found numbers: ${JSON.stringify(numberMatches)}`);
    logger.info('FlyioWhatsAppClient', `[DEBUG] Found currency: ${JSON.stringify(currencyMatches)}`);
    logger.info('FlyioWhatsAppClient', `[DEBUG] Found percentages: ${JSON.stringify(percentageMatches)}`);

    const payload = {
      sessionId,
      to,
      message: text  // Send text as-is, JSON.stringify will handle encoding
    };

    const jsonPayload = JSON.stringify(payload);
    logger.info('FlyioWhatsAppClient', `[DEBUG] JSON payload (first 500 chars): ${jsonPayload.substring(0, 500)}`);

    // Log the exact bytes being sent for debugging
    const bytes = Buffer.from(jsonPayload, 'utf8');
    logger.info('FlyioWhatsAppClient', `[DEBUG] Payload size: ${bytes.length} bytes`);

    return this.request<{ messageId: string; status: string }>(
      '/api/messages/send',
      {
        method: 'POST',
        body: jsonPayload
      }
    );
  }

  /**
   * Send media message
   */
  async sendMedia(
    sessionId: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    mimeType?: string
  ): Promise<{ messageId: string }> {
    logger.info('FlyioWhatsAppClient', `Sending media to: ${to}`);
    
    const messagePayload: any = {};
    
    // Determine media type based on mimeType
    if (mimeType?.startsWith('image/')) {
      messagePayload.image = { url: mediaUrl };
      if (caption) messagePayload.image.caption = caption;
    } else if (mimeType?.startsWith('video/')) {
      messagePayload.video = { url: mediaUrl };
      if (caption) messagePayload.video.caption = caption;
    } else if (mimeType?.startsWith('audio/')) {
      messagePayload.audio = { url: mediaUrl };
    } else {
      // Default to document for other types
      messagePayload.document = { 
        url: mediaUrl, 
        filename: mediaUrl.split('/').pop() || 'document'
      };
      if (caption) messagePayload.document.caption = caption;
    }
    
    const payload = {
      sessionId,
      to,
      message: messagePayload
    };
    
    const response = await this.request<{ messageId: string; status?: string }>(
      '/api/messages/send',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
    
    return {
      messageId: response.messageId
    };
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
   * Upload media to provider for sending
   */
  async uploadMedia(
    sessionId: string,
    file: Buffer | ArrayBuffer,
    filename: string,
    mimeType: string
  ): Promise<WhatsAppMediaUploadResponse> {
    logger.info('FlyioWhatsAppClient', `Uploading media for session: ${sessionId}`);
    
    const formData = new FormData();
    const blob = new Blob([file], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('sessionId', sessionId);

    const response = await fetch(`${this.baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: this.apiKey ? {
        'Authorization': `Bearer ${this.apiKey}`
      } : {},
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new WhatsAppError(
        `Media upload failed: ${errorText}`,
        WhatsAppErrorCodes.MEDIA_ERROR,
        response.status
      );
    }

    return response.json();
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(signature: string, payload: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('FlyioWhatsAppClient', 'No webhook secret configured');
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
   * Verify webhook signature (alias for validateWebhookSignature)
   * Required by BaseWhatsAppClient interface
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Note: parameter order is swapped compared to validateWebhookSignature
    return this.validateWebhookSignature(signature, payload);
  }

  /**
   * Health check for provider instance
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      logger.error('FlyioWhatsAppClient', 'Health check failed:', error);
      return false;
    }
  }

  /**
   * Start keep-alive for a session during long operations
   */
  startKeepAlive(sessionId: string): void {
    // Clear any existing keep-alive for this session
    this.stopKeepAlive(sessionId);

    logger.info('FlyioWhatsAppClient', `Starting keep-alive for session: ${sessionId}`);

    // Send a ping every 10 seconds to maintain connection
    const interval = setInterval(async () => {
      try {
        // Send a lightweight status check to keep connection active
        await this.request<any>(`/api/sessions/${sessionId}/ping`, {
          method: 'POST',
          body: JSON.stringify({ timestamp: new Date().toISOString() })
        }).catch(() => {
          // If ping fails, try a status check instead
          return this.getSessionStatus(sessionId);
        });

        logger.debug('FlyioWhatsAppClient', `Keep-alive ping sent for session: ${sessionId}`);
      } catch (error) {
        logger.error('FlyioWhatsAppClient', `Keep-alive ping failed for session ${sessionId}:`, error);
      }
    }, 10000); // Every 10 seconds

    this.activeConnections.set(sessionId, interval);
  }

  /**
   * Stop keep-alive for a session
   */
  stopKeepAlive(sessionId: string): void {
    const interval = this.activeConnections.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.activeConnections.delete(sessionId);
      logger.info('FlyioWhatsAppClient', `Stopped keep-alive for session: ${sessionId}`);
    }
  }

  /**
   * Stop all keep-alive connections
   */
  stopAllKeepAlive(): void {
    this.activeConnections.forEach((interval, sessionId) => {
      clearInterval(interval);
      logger.info('FlyioWhatsAppClient', `Stopped keep-alive for session: ${sessionId}`);
    });
    this.activeConnections.clear();
  }

  /**
   * Send message with keep-alive support
   */
  async sendMessageWithKeepAlive(payload: KoyebMessagePayload): Promise<{ messageId: string; status: string }> {
    // Start keep-alive during message sending
    this.startKeepAlive(payload.sessionId);

    try {
      const result = await this.sendMessage(payload);
      return result;
    } finally {
      // Stop keep-alive after message is sent
      this.stopKeepAlive(payload.sessionId);
    }
  }

  /**
   * Send with retry logic for handling session disconnections
   */
  private async sendWithRetry<T>(
    operation: () => Promise<T>,
    sessionId: string,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info('FlyioWhatsAppClient', `Attempt ${attempt}/${maxRetries} for session ${sessionId}`);

        // Check session status before sending
        const status = await this.getSessionStatus(sessionId).catch(() => null);

        if (status && !status.isConnected) {
          logger.warn('FlyioWhatsAppClient', `Session ${sessionId} not connected, attempting reconnection`);
          await this.attemptReconnection(sessionId);
        }

        // Try the operation
        const result = await operation();

        // Success - reset retry counter
        this.sessionReconnectAttempts.set(sessionId, 0);
        return result;

      } catch (error: any) {
        lastError = error;
        logger.error('FlyioWhatsAppClient', `Attempt ${attempt} failed:`, error);

        // Check if it's a session-related error
        if (this.isSessionError(error)) {
          logger.warn('FlyioWhatsAppClient', `Session error detected for ${sessionId}`);

          if (attempt < maxRetries) {
            // Wait before retry with exponential backoff
            const delay = this.reconnectDelay * Math.pow(2, attempt - 1);
            logger.info('FlyioWhatsAppClient', `Waiting ${delay}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // Try to reconnect the session
            await this.attemptReconnection(sessionId);
          }
        } else {
          // Non-session error, don't retry
          throw error;
        }
      }
    }

    // All retries exhausted
    logger.error('FlyioWhatsAppClient', `All ${maxRetries} attempts failed for session ${sessionId}`);
    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Check if error is session-related
   */
  private isSessionError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code;

    return (
      errorMessage.includes('session not connected') ||
      errorMessage.includes('session expired') ||
      errorMessage.includes('session not found') ||
      errorMessage.includes('connection closed') ||
      errorMessage.includes('disconnected') ||
      errorCode === 'SESSION_ERROR' ||
      errorCode === 'CONNECTION_ERROR'
    );
  }

  /**
   * Attempt to reconnect a session
   */
  private async attemptReconnection(sessionId: string): Promise<boolean> {
    const attempts = this.sessionReconnectAttempts.get(sessionId) || 0;

    if (attempts >= this.maxReconnectAttempts) {
      logger.error('FlyioWhatsAppClient', `Max reconnection attempts reached for session ${sessionId}`);
      return false;
    }

    this.sessionReconnectAttempts.set(sessionId, attempts + 1);
    logger.info('FlyioWhatsAppClient', `Reconnection attempt ${attempts + 1}/${this.maxReconnectAttempts} for session ${sessionId}`);

    try {
      // First, try to get current status
      const status = await this.getSessionStatus(sessionId).catch(() => null);

      if (status?.isConnected) {
        logger.info('FlyioWhatsAppClient', `Session ${sessionId} is already connected`);
        return true;
      }

      // Try to reinitialize the session
      logger.info('FlyioWhatsAppClient', `Attempting to reinitialize session ${sessionId}`);
      await this.request<any>(`/api/sessions/${sessionId}/reconnect`, {
        method: 'POST',
        body: JSON.stringify({ force: true })
      }).catch(async (error) => {
        // If reconnect endpoint doesn't exist, try re-creating the session
        logger.warn('FlyioWhatsAppClient', `Reconnect failed, attempting session refresh: ${error.message}`);

        // Try to refresh the session by sending a status request
        await this.request<any>(`/api/sessions/${sessionId}/refresh`, {
          method: 'POST'
        }).catch(() => {
          // Fallback: just check status to trigger any auto-reconnect
          return this.getSessionStatus(sessionId);
        });
      });

      // Wait a moment for reconnection to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify connection
      const newStatus = await this.getSessionStatus(sessionId).catch(() => null);

      if (newStatus?.isConnected) {
        logger.info('FlyioWhatsAppClient', `Session ${sessionId} successfully reconnected`);
        this.sessionReconnectAttempts.set(sessionId, 0);
        return true;
      }

      logger.warn('FlyioWhatsAppClient', `Session ${sessionId} reconnection failed`);
      return false;

    } catch (error) {
      logger.error('FlyioWhatsAppClient', `Error during reconnection attempt for session ${sessionId}:`, error);
      return false;
    }
  }

}