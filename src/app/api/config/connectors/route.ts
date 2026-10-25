import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { NextRequest } from 'next/server';

interface ConnectorStats {
  connected_users: number;
  last_sync: string | null;
  total_syncs: number;
  failed_syncs: number;
}

interface UserConnection {
  connected: boolean;
  connection_id: string;
  status: string;
  connected_at: string | null;
  last_sync_at: string | null;
  sync_folder_id: string | null;
  sync_folder_name: string | null;
  sync_folder_path: string | null;
  sync_file_ids: string[] | null;
  sync_file_names: string[] | null;
  sync_enabled: boolean;
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
  user_connection?: UserConnection | null;
}

interface ConnectorConfigResponse {
  feature_enabled: boolean;
  show_on_dashboard: boolean;
  providers: ConnectorProvider[];
}

// Initialize Supabase client
function getSupabaseClient() {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

// In-memory store for feature settings (in production, would use a database table)
const featureSettingsStore: Record<string, boolean> = {
  feature_enabled: true,
  show_on_dashboard: true,
};

// GET /api/config/connectors - Fetch all connector configurations
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // Note: This endpoint is accessed by the Config UI (admin panel) which doesn't have user context.
    // Instead of requiring auth, we return representative connection data for all providers.
    // This shows admins the connection status and stats.

    // Get connector configurations
    const { data: configs, error: configError } = await supabase
      .from('connector_config')
      .select('*')
      .order('provider', { ascending: true });

    if (configError) throw configError;

    // Get connection statistics (all users)
    const { data: connections, error: connError } = await supabase
      .from('nango_connections')
      .select('provider, user_id, last_sync_at, status')
      .order('provider', { ascending: true });

    if (connError) throw connError;

    // Get first connected user per provider (for Config UI admin view)
    // This shows representative connection data for each provider
    const userConnections: any[] = [];
    const { data: firstConnections, error: firstConnError } = await supabase
      .from('nango_connections')
      .select('*')
      .eq('status', 'connected')
      .order('connected_at', { ascending: false });

    if (!firstConnError && firstConnections && firstConnections.length > 0) {
      // Get first connection per provider
      const seenProviders = new Set<string>();
      for (const conn of firstConnections) {
        if (!seenProviders.has(conn.provider)) {
          userConnections.push(conn);
          seenProviders.add(conn.provider);
        }
      }
    }

    // Build stats for each provider
    const statsMap: Record<string, ConnectorStats> = {};

    if (connections) {
      for (const conn of connections) {
        if (!statsMap[conn.provider]) {
          statsMap[conn.provider] = {
            connected_users: 0,
            last_sync: null,
            total_syncs: 0,
            failed_syncs: 0,
          };
        }

        statsMap[conn.provider].connected_users += 1;
        if (conn.last_sync_at && new Date(conn.last_sync_at) > new Date(statsMap[conn.provider].last_sync || 0)) {
          statsMap[conn.provider].last_sync = conn.last_sync_at;
        }
        if (conn.status === 'error') {
          statsMap[conn.provider].failed_syncs += 1;
        }
        statsMap[conn.provider].total_syncs += 1;
      }
    }

    // Build user connection map
    const userConnectionMap: Record<string, any> = {};
    for (const conn of userConnections) {
      userConnectionMap[conn.provider] = {
        connected: conn.status === 'connected',
        connection_id: conn.connection_id,
        status: conn.status,
        connected_at: conn.connected_at,
        last_sync_at: conn.last_sync_at,
        sync_folder_id: conn.sync_folder_id,
        sync_folder_name: conn.sync_folder_name,
        sync_folder_path: conn.sync_folder_path,
        sync_file_ids: conn.sync_file_ids,
        sync_file_names: conn.sync_file_names,
        sync_enabled: conn.sync_enabled,
      };
    }

    // Build response - only include supported providers
    const supportedProviders = ['google-drive', 'dropbox', 'notion'];
    const providers: any[] = (configs || [])
      .filter((config: any) => supportedProviders.includes(config.provider))
      .map((config: any) => ({
        provider: config.provider,
        enabled: config.enabled,
        show_on_dashboard: config.show_on_dashboard,
        button_label: config.button_label,
        description: config.description,
        supported_file_types: config.supported_file_types || [],
        max_files_per_sync: config.max_files_per_sync || 100,
        stats: statsMap[config.provider] || {
          connected_users: 0,
          last_sync: null,
          total_syncs: 0,
          failed_syncs: 0,
        },
        // Include user connection data (either authenticated user or representative connection for admin view)
        user_connection: userConnectionMap[config.provider] || null,
      }));

    const response: any = {
      feature_enabled: featureSettingsStore.feature_enabled,
      show_on_dashboard: featureSettingsStore.show_on_dashboard,
      providers,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error fetching connector config:', error);
    return Response.json({ error: 'Failed to fetch connector configuration' }, { status: 500 });
  }
}

// PUT /api/config/connectors - Update connector configurations
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = getSupabaseClient();

    // Verify admin access - for local dev, any auth header is accepted
    // In production, this should validate the token properly
    const authHeader = request.headers.get('authorization');
    if (!authHeader && process.env.NODE_ENV === 'production') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Update each provider configuration
    if (body.providers && Array.isArray(body.providers)) {
      for (const provider of body.providers) {
        const { error } = await supabase
          .from('connector_config')
          .update({
            enabled: provider.enabled,
            show_on_dashboard: provider.show_on_dashboard,
            button_label: provider.button_label,
            description: provider.description,
            supported_file_types: provider.supported_file_types,
            max_files_per_sync: provider.max_files_per_sync,
            updated_at: new Date().toISOString(),
          })
          .eq('provider', provider.provider);

        if (error) throw error;
      }
    }

    // Update global feature settings if provided
    if (typeof body.feature_enabled !== 'undefined' || typeof body.show_on_dashboard !== 'undefined') {
      if (typeof body.feature_enabled !== 'undefined') {
        featureSettingsStore.feature_enabled = body.feature_enabled;
      }
      if (typeof body.show_on_dashboard !== 'undefined') {
        featureSettingsStore.show_on_dashboard = body.show_on_dashboard;
      }

      console.log('Feature settings updated:', featureSettingsStore);
    }

    return Response.json({ success: true, message: 'Connector configuration updated' });
  } catch (error) {
    console.error('Error updating connector config:', error);
    return Response.json({ error: 'Failed to update connector configuration' }, { status: 500 });
  }
}
