import { createClient } from '@supabase/supabase-js';

interface ConnectorProvider {
  provider: string;
  enabled: boolean;
  show_on_dashboard: boolean;
  button_label: string;
  description: string;
  supported_file_types: string[];
  max_files_per_sync: number;
}

interface ConnectorConfig {
  feature_enabled: boolean;
  show_on_dashboard: boolean;
  providers: ConnectorProvider[];
}

let cachedConfig: ConnectorConfig | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function loadConnectorConfig(
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<ConnectorConfig> {
  // Check cache
  if (cachedConfig && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedConfig;
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get connector configurations
    const { data: configs, error } = await supabase
      .from('connector_config')
      .select('*')
      .order('provider', { ascending: true });

    if (error) throw error;

    const providers: ConnectorProvider[] = (configs || []).map((config: any) => ({
      provider: config.provider,
      enabled: config.enabled ?? true,
      show_on_dashboard: config.show_on_dashboard ?? true,
      button_label: config.button_label || `Connect ${config.provider}`,
      description: config.description || '',
      supported_file_types: config.supported_file_types || ['pdf', 'doc', 'docx', 'txt'],
      max_files_per_sync: config.max_files_per_sync || 100,
    }));

    cachedConfig = {
      feature_enabled: true,
      show_on_dashboard: true,
      providers,
    };

    cacheTimestamp = Date.now();
    return cachedConfig;
  } catch (error) {
    console.error('Error loading connector config:', error);
    // Return default config if database query fails
    return {
      feature_enabled: true,
      show_on_dashboard: true,
      providers: [
        {
          provider: 'google-drive',
          enabled: true,
          show_on_dashboard: true,
          button_label: 'Connect Google Drive',
          description: 'Import files from your Google Drive',
          supported_file_types: ['pdf', 'doc', 'docx', 'txt'],
          max_files_per_sync: 100,
        },
      ],
    };
  }
}

export function clearConnectorCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
}

export function isConnectorEnabled(config: ConnectorConfig, provider: string): boolean {
  const connectorProvider = config.providers.find(p => p.provider === provider);
  return connectorProvider?.enabled ?? false;
}

export function shouldShowOnDashboard(config: ConnectorConfig, provider: string): boolean {
  if (!config.feature_enabled || !config.show_on_dashboard) {
    return false;
  }
  const connectorProvider = config.providers.find(p => p.provider === provider);
  return connectorProvider?.show_on_dashboard ?? false;
}

export function getEnabledConnectors(config: ConnectorConfig): ConnectorProvider[] {
  if (!config.feature_enabled) {
    return [];
  }
  return config.providers.filter(p => p.enabled && p.show_on_dashboard);
}
