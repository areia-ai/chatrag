'use client';

import { useState, useEffect, useCallback } from 'react';

interface ConnectorStats {
  connected_users: number;
  last_sync: string | null;
  total_syncs: number;
  failed_syncs: number;
}

interface ConnectorProvider {
  provider: string;
  enabled: boolean;
  show_on_dashboard: boolean;
  button_label: string;
  description: string;
  supported_file_types: string[];
  max_files_per_sync: number;
  stats: ConnectorStats;
}

interface ConnectorConfig {
  feature_enabled: boolean;
  show_on_dashboard: boolean;
  providers: ConnectorProvider[];
}

interface UseConnectorConfigReturn {
  config: ConnectorConfig | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateConfig: (updates: Partial<ConnectorConfig>) => Promise<void>;
}

export function useConnectorConfig(): UseConnectorConfigReturn {
  const [config, setConfig] = useState<ConnectorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/config/connectors');
      if (!response.ok) {
        throw new Error('Failed to fetch connector configuration');
      }

      const data = await response.json();
      setConfig(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('Error fetching connector config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    async (updates: Partial<ConnectorConfig>) => {
      try {
        setError(null);

        const response = await fetch('/api/config/connectors', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error('Failed to update connector configuration');
        }

        // Refetch after update
        await fetchConfig();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('Error updating connector config:', err);
        throw err;
      }
    },
    [fetchConfig]
  );

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Listen for config updates from other tabs/windows or the config UI
  useEffect(() => {
    const handleConfigUpdate = () => {
      fetchConfig();
    };

    window.addEventListener('connectorConfigUpdated', handleConfigUpdate);
    return () => {
      window.removeEventListener('connectorConfigUpdated', handleConfigUpdate);
    };
  }, [fetchConfig]);

  return {
    config,
    loading,
    error,
    refetch: fetchConfig,
    updateConfig,
  };
}
