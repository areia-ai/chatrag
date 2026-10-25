import {
  KoyebSessionRequest,
  KoyebSessionResponse,
  KoyebMessagePayload,
  WhatsAppMediaUploadResponse,
  WhatsAppError
} from './types';

/**
 * Base interface for WhatsApp client implementations
 * All provider-specific clients must implement this interface
 */
export abstract class BaseWhatsAppClient {
  protected baseUrl: string;
  protected apiKey?: string;
  protected webhookSecret: string;

  constructor(baseUrl: string, apiKey?: string, webhookSecret?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.webhookSecret = webhookSecret || '';
  }

  /**
   * Create a new WhatsApp session
   */
  abstract createSession(
    userId: string,
    metadata?: Record<string, any>
  ): Promise<KoyebSessionResponse>;

  /**
   * Get QR code for session authentication
   */
  abstract getQRCode(sessionId: string): Promise<{ qrCode: string; expiresAt: string }>;

  /**
   * Get session status
   */
  abstract getSessionStatus(sessionId: string): Promise<{ 
    status: string; 
    isConnected: boolean; 
    phoneNumber?: string 
  }>;

  /**
   * Disconnect and remove session
   */
  abstract disconnectSession(sessionId: string): Promise<void>;

  /**
   * Register webhook for receiving messages
   */
  abstract registerWebhook(sessionId: string, webhookUrl: string): Promise<void>;

  /**
   * Send a message via WhatsApp
   */
  abstract sendMessage(payload: KoyebMessagePayload): Promise<{ messageId: string; status: string }>;

  /**
   * Send a simple text message
   */
  abstract sendTextMessage(
    sessionId: string,
    to: string,
    text: string
  ): Promise<{ messageId: string }>;

  /**
   * Send a media message
   */
  abstract sendMedia(
    sessionId: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    mimeType?: string
  ): Promise<{ messageId: string }>;

  /**
   * Upload media to provider for sending
   */
  abstract uploadMedia(
    sessionId: string,
    file: Buffer | ArrayBuffer,
    filename: string,
    mimeType: string
  ): Promise<WhatsAppMediaUploadResponse>;

  /**
   * Validate webhook signature
   */
  abstract validateWebhookSignature(signature: string, payload: string): boolean;

  /**
   * Send image message helper
   */
  abstract sendImageMessage(
    sessionId: string,
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<{ messageId: string; status: string }>;

  /**
   * Send document message helper
   */
  abstract sendDocumentMessage(
    sessionId: string,
    to: string,
    documentUrl: string,
    filename: string,
    caption?: string
  ): Promise<{ messageId: string; status: string }>;
  
  /**
   * Health check for provider instance
   */
  abstract healthCheck(): Promise<boolean>;
}