/**
 * Nango Integration Module
 * Provides document connector functionality for third-party services
 */

// Client and configuration
export { getNango, isNangoEnabled, verifyWebhookSignature } from './client';

// Types
export type {
  SupportedProvider,
  NangoConnectionRecord,
  NangoConnectionWithValidity,
  NangoSyncRecord,
  NangoWebhookType,
  NangoWebhookPayload,
  NangoFileRecord,
  SyncStats,
} from './types';

export { PROVIDER_CONFIG } from './types';

// Sync operations
export { syncDocumentsForConnection, syncAllUserConnections } from './sync-manager';

// File operations
export { fetchFileContent } from './file-fetcher';

// Document processing
export { processDocumentWithMetadata, type ProcessDocumentOptions } from './document-adapter';
