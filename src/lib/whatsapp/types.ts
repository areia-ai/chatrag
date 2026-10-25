// WhatsApp Integration Types

export interface WhatsAppSession {
  id: string;
  userId: string;
  phoneNumber: string;
  sessionId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'qr_pending' | 'failed';
  qrCode?: string;
  qrExpiresAt?: Date;
  koyebSessionData?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppConversation {
  id: string;
  chatId: string;
  whatsappJid: string;
  phoneNumber: string;
  contactName?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  whatsappMessageId: string;
  direction: 'incoming' | 'outgoing';
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string;
  createdAt: Date;
}

// Koyeb API Types
export interface KoyebSessionRequest {
  userId: string;
  metadata?: Record<string, any>;
}

export interface KoyebSessionResponse {
  sessionId: string;
  status: string;
  qrCode?: string;
  expiresAt?: string;
}

export interface KoyebMessagePayload {
  sessionId: string;
  to: string;
  message: {
    text?: string;
    image?: {
      url: string;
      caption?: string;
    };
    document?: {
      url: string;
      filename: string;
      caption?: string;
    };
    audio?: {
      url: string;
    };
    video?: {
      url: string;
      caption?: string;
    };
  };
}

export interface KoyebWebhookPayload {
  sessionId: string;
  event: 'message' | 'status' | 'qr' | 'connected' | 'disconnected';
  data: {
    // For message events
    messageId?: string;
    from?: string;
    to?: string;
    // Baileys-specific message structure
    key?: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
      senderLid?: string;
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
        contextInfo?: any;
      };
      imageMessage?: {
        url: string;
        caption?: string;
      };
      documentMessage?: {
        url: string;
        fileName: string;
      };
      audioMessage?: {
        url: string;
      };
      videoMessage?: {
        url: string;
        caption?: string;
      };
      messageContextInfo?: any;
    };
    messageTimestamp?: number;
    pushName?: string;
    // For status events
    status?: 'sent' | 'delivered' | 'read' | 'failed';
    error?: string;
    // For QR events
    qr?: string;
    // For connection events
    isConnected?: boolean;
    phoneNumber?: string;
  };
  timestamp: string;
}

export interface WhatsAppMediaUploadResponse {
  mediaId: string;
  url: string;
  type: string;
  size: number;
}

// Baileys Message Types (simplified)
export interface BaileysMessage {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
    };
    imageMessage?: {
      url?: string;
      caption?: string;
      mimetype?: string;
    };
    documentMessage?: {
      url?: string;
      fileName?: string;
      mimetype?: string;
    };
    audioMessage?: {
      url?: string;
      mimetype?: string;
      seconds?: number;
    };
    videoMessage?: {
      url?: string;
      caption?: string;
      mimetype?: string;
      seconds?: number;
    };
  };
  messageTimestamp?: number;
  status?: number;
}

// Error types
export class WhatsAppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export const WhatsAppErrorCodes = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXISTS: 'SESSION_EXISTS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  KOYEB_API_ERROR: 'KOYEB_API_ERROR',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  INVALID_STATE: 'INVALID_STATE',
  MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED',
  WEBHOOK_VALIDATION_FAILED: 'WEBHOOK_VALIDATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MEDIA_ERROR: 'MEDIA_ERROR'
} as const;