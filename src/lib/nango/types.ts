/**
 * Nango Integration Types
 * Type definitions for document connector integrations
 */

/**
 * Supported document storage providers
 */
/**
 * Supported document storage providers
 */
export type SupportedProvider =
  | 'google-drive'
  | 'notion'
  | 'dropbox'
  | 'box'
  | 'confluence';

/**
 * Provider display configuration
 * fileModel: The Nango sync model name for listing records
 * See: https://docs.nango.dev/integrations
 */
export const PROVIDER_CONFIG: Record<SupportedProvider, {
  displayName: string;
  icon: string;
  description: string;
  fileModel: string;
  syncName?: string;
  integrationId: string;
}> = {
  'google-drive': {
    displayName: 'Google Drive',
    icon: '/connectors/google-drive.svg',
    description: 'Connect your Google Drive to import documents',
    fileModel: 'documents', // Nango's Google Drive uses 'documents' model
    syncName: 'documents',
    integrationId: 'google-drive',
  },
  'notion': {
    displayName: 'Notion',
    icon: '/connectors/notion-svgrepo-com.svg',
    description: 'Import pages from your Notion workspace',
    fileModel: 'pages',
    integrationId: 'notion',
  },
  'dropbox': {
    displayName: 'Dropbox',
    icon: '/connectors/dropbox.svg',
    description: 'Sync documents from Dropbox',
    fileModel: 'files',
    integrationId: 'dropbox',
  },
  'box': {
    displayName: 'Box',
    icon: '/icons/connectors/box.svg',
    description: 'Import files from Box',
    fileModel: 'files',
    integrationId: 'box',
  },
  'confluence': {
    displayName: 'Confluence',
    icon: '/icons/connectors/confluence.svg',
    description: 'Sync Confluence pages and spaces',
    fileModel: 'pages',
    integrationId: 'confluence',
  },
};

/**
 * Nango connection record from our database
 */
export interface NangoConnectionRecord {
  id: string;
  user_id: string;
  connection_id: string;
  provider: SupportedProvider;
  status: 'pending' | 'connected' | 'error' | 'disconnected';
  connected_at: string | null;
  last_sync_at: string | null;
  sync_enabled: boolean;
  sync_folder_id: string | null;
  sync_folder_name: string | null;
  sync_folder_path: string | null;
  sync_file_ids: string[] | null;
  sync_file_names: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Nango sync record for tracking individual files
 */
export interface NangoSyncRecord {
  id: string;
  user_id: string;
  connection_id: string;
  provider: SupportedProvider;
  file_id: string;
  file_name: string;
  document_id: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'disconnected';
  last_synced_at: string | null;
  error_message: string | null;
  metadata: {
    path?: string;
    mime_type?: string;
    size?: number;
    modified_at?: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Nango webhook payload types
 */
export type NangoWebhookType =
  | 'sync.success'
  | 'sync.error'
  | 'auth.token_expired'
  | 'forward';

export interface NangoWebhookPayload {
  type: NangoWebhookType;
  connectionId: string;
  providerConfigKey: string;
  syncName?: string;
  model?: string;
  modifiedAfter?: string;
  responseResults?: {
    added: number;
    updated: number;
    deleted: number;
  };
  error?: {
    message: string;
    type: string;
  };
}

/**
 * File record from Nango sync
 */
export interface NangoFileRecord {
  id: string;
  name: string;
  path?: string;
  mime_type?: string;
  size?: number;
  modified_at?: string;
  parent_id?: string;
  web_url?: string;
}

/**
 * Sync statistics returned after processing
 */
export interface SyncStats {
  processed: number;
  failed: number;
  skipped: number;
  deleted: number;
}

/**
 * Connection with validity status
 */
export interface NangoConnectionWithValidity extends NangoConnectionRecord {
  is_valid: boolean;
}
