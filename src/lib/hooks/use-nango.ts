'use client';

import { useState, useCallback } from 'react';
import Nango from '@nangohq/frontend';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

const NANGO_ENABLED = process.env.NEXT_PUBLIC_NANGO_ENABLED === 'true';

interface UseNangoReturn {
  connect: (provider: SupportedProvider) => Promise<string | null>;
  isConnecting: boolean;
  error: string | null;
  clearError: () => void;
}

// Type for Nango auth result
interface NangoAuthResult {
  connectionId?: string;
  providerConfigKey?: string;
}

/**
 * Hook for connecting to third-party document providers via Nango
 * Uses Connect Sessions - no public key needed, session token comes from backend
 */
export function useNango(): UseNangoReturn {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (provider: SupportedProvider): Promise<string | null> => {
    if (!NANGO_ENABLED) {
      setError('Nango integration not enabled');
      return null;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Get connect session from our backend
      const sessionResponse = await fetch('/api/nango/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });

      if (!sessionResponse.ok) {
        const data = await sessionResponse.json();
        throw new Error(data.error || 'Failed to create session');
      }

      const { connectSessionToken } = await sessionResponse.json();

      // Initialize Nango frontend SDK with session token
      const nango = new Nango({ connectSessionToken });

      // Get the correct integration ID (e.g. 'one-drive-personal' instead of 'onedrive')
      const integrationId = PROVIDER_CONFIG[provider]?.integrationId || provider;

      // Open OAuth flow - cast result to handle TypeScript types
      const result = await nango.auth(integrationId) as NangoAuthResult;

      if (result.connectionId) {
        // Register the connection in our database
        const registerResponse = await fetch('/api/nango/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            connectionId: result.connectionId,
          }),
        });

        if (!registerResponse.ok) {
          const data = await registerResponse.json();
          throw new Error(data.error || 'Failed to register connection');
        }

        return result.connectionId;
      } else {
        throw new Error('Authentication failed - no connection ID returned');
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    connect,
    isConnecting,
    error,
    clearError,
  };
}
