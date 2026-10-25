'use client';

import { useState, useEffect, useCallback } from 'react';

interface FirecrawlConfig {
    isEnabled: boolean;
    showOnDashboard: boolean;
}

interface UseFirecrawlConfigReturn {
    config: FirecrawlConfig | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useFirecrawlConfig(): UseFirecrawlConfigReturn {
    const [config, setConfig] = useState<FirecrawlConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchConfig = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('/api/config/firecrawl');
            if (!response.ok) {
                throw new Error('Failed to fetch firecrawl configuration');
            }

            const data = await response.json();
            setConfig(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            console.error('Error fetching firecrawl config:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConfig();

        // Poll for changes every 2 seconds to keep in sync with config UI changes
        const intervalId = setInterval(fetchConfig, 2000);

        return () => clearInterval(intervalId);
    }, [fetchConfig]);

    return {
        config,
        loading,
        error,
        refetch: fetchConfig,
    };
}
