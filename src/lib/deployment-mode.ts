/**
 * Deployment Mode Configuration
 * Manages single-tenant vs multi-tenant deployment modes for ChatRAG
 */

import { env } from './env';

export type DeploymentMode = 'single-tenant' | 'multi-tenant';

/**
 * Get the current deployment mode from environment configuration
 * @returns The current deployment mode (defaults to 'single-tenant')
 */
export function getDeploymentMode(): DeploymentMode {
  // Use NEXT_PUBLIC_ version for client-side, fallback to server-side version
  const mode = (env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE || env.CHATRAG_DEPLOYMENT_MODE || 'single-tenant') as DeploymentMode;
  return mode;
}

/**
 * Check if the application is running in single-tenant mode
 * @returns true if in single-tenant mode
 */
export function isSingleTenant(): boolean {
  return getDeploymentMode() === 'single-tenant';
}

/**
 * Check if the application is running in multi-tenant mode
 * @returns true if in multi-tenant mode
 */
export function isMultiTenant(): boolean {
  return getDeploymentMode() === 'multi-tenant';
}

/**
 * Throws an error if not in multi-tenant mode
 * Use this to guard multi-tenant-only features
 * @throws Error if not in multi-tenant mode
 */
export function requireMultiTenant(): void {
  if (!isMultiTenant()) {
    throw new Error('This feature requires multi-tenant mode. Set CHATRAG_DEPLOYMENT_MODE=multi-tenant in your environment configuration.');
  }
}

/**
 * Throws an error if not in single-tenant mode
 * Use this to guard single-tenant-only features
 * @throws Error if not in single-tenant mode
 */
export function requireSingleTenant(): void {
  if (!isSingleTenant()) {
    throw new Error('This feature requires single-tenant mode. Set CHATRAG_DEPLOYMENT_MODE=single-tenant in your environment configuration.');
  }
}

/**
 * Get feature flags based on deployment mode
 * @returns Object with feature availability flags
 */
export function getFeatureFlags() {
  const mode = getDeploymentMode();
  const isMulti = mode === 'multi-tenant';

  return {
    // Organizations features (multi-tenant only)
    enableOrganizations: isMulti && (env.ENABLE_ORGANIZATIONS ?? true),
    enableTeamInvites: isMulti && (env.ENABLE_TEAM_INVITES ?? true),
    enableStorageQuotas: isMulti && (env.ENABLE_STORAGE_QUOTAS ?? true),
    enableUsageAnalytics: isMulti && (env.ENABLE_USAGE_ANALYTICS ?? true),

    // Shared features
    enableDocumentSharing: true,
    enableChatHistory: true,
    enableRAG: true,

    // Deployment mode info
    deploymentMode: mode,
    isSingleTenant: !isMulti,
    isMultiTenant: isMulti,
  };
}

/**
 * Log deployment mode information at startup
 * @param logger Optional logger function (defaults to console.log)
 */
export function logDeploymentMode(logger: (message: string) => void = console.log): void {
  const mode = getDeploymentMode();
  const features = getFeatureFlags();

  logger(`[ChatRAG] Deployment Mode: ${mode.toUpperCase()}`);

  if (features.isMultiTenant) {
    logger('[ChatRAG] Multi-tenant features:');
    logger(`  - Organizations: ${features.enableOrganizations ? 'Enabled' : 'Disabled'}`);
    logger(`  - Team Invites: ${features.enableTeamInvites ? 'Enabled' : 'Disabled'}`);
    logger(`  - Storage Quotas: ${features.enableStorageQuotas ? 'Enabled' : 'Disabled'}`);
    logger(`  - Usage Analytics: ${features.enableUsageAnalytics ? 'Enabled' : 'Disabled'}`);
  } else {
    logger('[ChatRAG] Single-tenant mode: Shared knowledge base, user-isolated chats');
  }
}
