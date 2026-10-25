import { Nango } from '@nangohq/node';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Nango Client Singleton
 * Manages the Nango Node SDK instance for server-side operations
 */
class NangoClientManager {
  private static instance: NangoClientManager;
  private client: Nango | null = null;
  private initialized = false;

  private constructor() {
    this.initialize();
  }

  static getInstance(): NangoClientManager {
    if (!NangoClientManager.instance) {
      NangoClientManager.instance = new NangoClientManager();
    }
    return NangoClientManager.instance;
  }

  private initialize() {
    if (this.initialized) return;

    // Skip initialization during build phase
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (isBuildPhase) {
      logger.debug('Nango', 'Skipping initialization during build phase');
      this.initialized = true;
      return;
    }

    // Check if Nango is enabled
    const nangoEnabled = env.NEXT_PUBLIC_NANGO_ENABLED === 'true';
    if (!nangoEnabled) {
      logger.debug('Nango', 'Integration disabled via NEXT_PUBLIC_NANGO_ENABLED');
      this.initialized = true;
      return;
    }

    if (env.NANGO_SECRET_KEY) {
      try {
        this.client = new Nango({
          secretKey: env.NANGO_SECRET_KEY,
          host: env.NANGO_HOST || 'https://api.nango.dev',
        });
        logger.startup('Nango', 'Client initialized successfully');
      } catch (error) {
        logger.error('Nango', 'Failed to initialize client', error);
      }
    } else {
      logger.warn('Nango', 'NANGO_SECRET_KEY not set - integration disabled');
    }

    this.initialized = true;
  }

  getClient(): Nango {
    if (!this.client) {
      throw new Error('Nango client not initialized - check NANGO_SECRET_KEY and NEXT_PUBLIC_NANGO_ENABLED');
    }
    return this.client;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }
}

// Export singleton accessors
let manager: NangoClientManager | null = null;

export function getNango(): Nango {
  if (!manager) {
    manager = NangoClientManager.getInstance();
  }
  return manager.getClient();
}

export function isNangoEnabled(): boolean {
  if (!manager) {
    manager = NangoClientManager.getInstance();
  }
  return manager.isEnabled();
}

/**
 * Verify a webhook signature from Nango
 * Uses HMAC-SHA256 for signature verification
 */
export function verifyWebhookSignature(
  signature: string | null,
  payload: string
): boolean {
  if (!signature || !env.NANGO_WEBHOOK_SECRET) {
    return false;
  }

  try {
    // Import crypto for HMAC verification
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', env.NANGO_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    // Compare signatures in constant time to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.error('Nango', 'Webhook signature verification failed', error);
    return false;
  }
}
