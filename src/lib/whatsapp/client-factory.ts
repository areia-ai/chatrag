import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { BaseWhatsAppClient } from './base-client';
import { KoyebWhatsAppClient } from './koyeb-client';
import { FlyioWhatsAppClient } from './flyio-client';

/**
 * Factory for creating WhatsApp client instances based on configured provider
 */
class WhatsAppClientFactory {
  private static instance: BaseWhatsAppClient | null = null;

  /**
   * Get the WhatsApp client instance based on configured provider
   */
  static getClient(): BaseWhatsAppClient {
    // Check if provider has changed
    const currentProvider = env.WHATSAPP_PROVIDER || 'koyeb';
    
    // Reset instance if provider has changed or no instance exists
    if (this.instance) {
      const instanceType = this.instance.constructor.name;
      const expectedType = currentProvider.toLowerCase() === 'flyio' || currentProvider.toLowerCase() === 'fly.io' 
        ? 'FlyioWhatsAppClient' 
        : 'KoyebWhatsAppClient';
      
      if (instanceType !== expectedType) {
        logger.info('WhatsAppClientFactory', `Provider changed from ${instanceType} to ${expectedType}, resetting client`);
        this.instance = null;
      }
    }
    
    // Return existing instance if available
    if (this.instance) {
      return this.instance;
    }

    // Create new instance based on provider
    logger.info('WhatsAppClientFactory', `Creating ${currentProvider} client (WHATSAPP_PROVIDER=${currentProvider})`);

    switch (currentProvider.toLowerCase()) {
      case 'flyio':
      case 'fly.io':
        logger.info('WhatsAppClientFactory', 'Initializing Fly.io WhatsApp client');
        this.instance = new FlyioWhatsAppClient();
        break;
      
      case 'koyeb':
      default:
        logger.info('WhatsAppClientFactory', 'Initializing Koyeb WhatsApp client');
        this.instance = new KoyebWhatsAppClient();
        break;
    }

    return this.instance;
  }

  /**
   * Reset the client instance (useful for testing or provider switching)
   */
  static reset(): void {
    this.instance = null;
  }

  /**
   * Get provider name
   */
  static getProviderName(): string {
    return env.WHATSAPP_PROVIDER || 'koyeb';
  }
  
  /**
   * Get current provider details for debugging
   */
  static getProviderInfo(): { 
    provider: string; 
    configured: boolean; 
    baseUrl?: string;
    hasApiKey: boolean;
  } {
    const provider = this.getProviderName();
    
    if (provider.toLowerCase() === 'flyio' || provider.toLowerCase() === 'fly.io') {
      return {
        provider: 'flyio',
        configured: !!env.FLYIO_BAILEYS_URL,
        baseUrl: env.FLYIO_BAILEYS_URL,
        hasApiKey: !!env.FLYIO_API_KEY
      };
    }
    
    return {
      provider: 'koyeb',
      configured: !!env.KOYEB_BAILEYS_URL,
      baseUrl: env.KOYEB_BAILEYS_URL,
      hasApiKey: !!env.KOYEB_API_KEY
    };
  }

  /**
   * Check if WhatsApp is enabled
   */
  static isEnabled(): boolean {
    return env.NEXT_PUBLIC_WHATSAPP_ENABLED === 'true';
  }
}

// Export singleton getter
export function getWhatsAppClient(): BaseWhatsAppClient {
  return WhatsAppClientFactory.getClient();
}

// Export factory for advanced usage
export { WhatsAppClientFactory };