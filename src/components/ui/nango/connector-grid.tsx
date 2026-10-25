'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  CloudOff,
  Folder,
  FolderOpen,
  FileText,
} from 'lucide-react';
import { useNango } from '@/lib/hooks/use-nango';
import { useConnectorConfig } from '@/lib/hooks/use-connector-config';
import { PROVIDER_CONFIG, type SupportedProvider, type NangoConnectionRecord, type SyncStats } from '@/lib/nango/types';
import { cn } from '@/lib/utils';
import { FolderPicker } from './folder-picker';
import { FilePicker } from './file-picker';
import { NotionPagePicker } from './notion-page-picker';
import { useLanguage } from '@/components/providers/language-provider';
import type { TranslationKeys } from '@/translations';

interface SyncResult {
  provider: SupportedProvider;
  stats: SyncStats | null;
  timestamp: Date;
}

const ALL_PROVIDERS: SupportedProvider[] = [
  'google-drive',
  'dropbox',
  'notion',
];

interface NangoConnectionWithValidity extends NangoConnectionRecord {
  is_valid: boolean;
}

interface ConnectorGridProps {
  onConnectionChange?: () => void;
}

export function ConnectorGrid({ onConnectionChange }: ConnectorGridProps) {
  const [connections, setConnections] = useState<NangoConnectionWithValidity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnabled, setIsEnabled] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerProvider, setFolderPickerProvider] = useState<SupportedProvider | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerProvider, setFilePickerProvider] = useState<SupportedProvider | null>(null);
  const [notionPagePickerOpen, setNotionPagePickerOpen] = useState(false);
  const [notionPagePickerMode, setNotionPagePickerMode] = useState<'top-level' | 'subpages'>('top-level');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const { connect, isConnecting, error, clearError } = useNango();
  const { config: connectorConfig, loading: configLoading } = useConnectorConfig();

  const { t } = useLanguage();
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  const formatTemplate = useCallback((template: string, values: Record<string, string | number>) => {
    return Object.entries(values).reduce(
      (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
      template
    );
  }, []);

  const formatCountLabel = useCallback(
    (key: TranslationKeys, count: number) => formatTemplate(t(key), { count }),
    [formatTemplate, t]
  );

  const fetchConnections = useCallback(async () => {
    try {
      const response = await fetch('/api/nango/connections');
      const data = await response.json();
      setConnections(data.connections || []);
      setIsEnabled(data.enabled);
    } catch (err) {
      console.error('Failed to fetch connections:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleConnect = async (provider: SupportedProvider) => {
    clearError();
    const connectionId = await connect(provider);
    if (connectionId) {
      await fetchConnections();
      onConnectionChange?.();
    }
  };

  const handleDisconnect = async (provider: SupportedProvider) => {
    try {
      await fetch('/api/nango/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      await fetchConnections();
      onConnectionChange?.();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const handleSync = async (provider: SupportedProvider, connectionId: string) => {
    setSyncingProvider(provider);
    setSyncError(null);
    setLastSyncResult(null);
    try {
      const response = await fetch('/api/nango/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, connectionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSyncError(data.error || t('connectorSyncFailed'));
        return;
      }
      // Store sync result to display to user
      setLastSyncResult({
        provider,
        stats: data as SyncStats,
        timestamp: new Date(),
      });
      await fetchConnections();
      onConnectionChange?.();
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncError(t('connectorSyncFailedRetry'));
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleOpenFolderPicker = (provider: SupportedProvider) => {
    setFolderPickerProvider(provider);
    setFolderPickerOpen(true);
  };

  const handleFolderSelect = async (
    folderIds: string | string[],
    folderNames: string | string[],
    folderPaths: string | string[]
  ) => {
    if (!folderPickerProvider) return;

    try {
      // Check if multi-folder selection (arrays)
      const isMultiFolder = Array.isArray(folderIds) && folderIds.length > 1;

      const response = await fetch('/api/nango/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: folderPickerProvider,
          // Multi-folder mode: use marker and store IDs in syncFileIds
          syncFolderId: isMultiFolder ? 'multi-folder-mode' : (Array.isArray(folderIds) ? folderIds[0] : folderIds),
          syncFolderName: isMultiFolder
            ? `${(folderIds as string[]).length} folders selected`
            : (Array.isArray(folderNames) ? folderNames[0] : folderNames),
          syncFolderPath: isMultiFolder
            ? (Array.isArray(folderPaths) ? folderPaths.join(', ') : folderPaths)
            : (Array.isArray(folderPaths) ? folderPaths[0] : folderPaths),
          // For multi-folder, store folder IDs in syncFileIds
          syncFileIds: isMultiFolder ? folderIds : undefined,
          syncFileNames: isMultiFolder ? folderNames : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('connectorFolderSaveError'));
      }

      await fetchConnections();
      setSyncError(null);
    } catch (err) {
      console.error('Failed to save folder:', err);
      setSyncError(t('connectorFolderSaveError'));
    }
  };

  const handleOpenFilePicker = (provider: SupportedProvider) => {
    setFilePickerProvider(provider);
    setFilePickerOpen(true);
  };

  const handleFileSelect = async (fileIds: string[], fileNames: string[]) => {
    if (!filePickerProvider) return;

    try {
      const response = await fetch('/api/nango/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: filePickerProvider,
          syncFileIds: fileIds,
          syncFileNames: fileNames,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('connectorFileSaveError'));
      }

      await fetchConnections();
      setSyncError(null);
    } catch (err) {
      console.error('Failed to save files:', err);
      setSyncError(t('connectorFileSaveError'));
    }
  };

  const handleNotionPageSelect = async (pageIds: string[], pageNames: string[]) => {
    try {
      // For top-level mode: use 'top-level-mode' marker and store ALL page IDs in syncFileIds
      // For subpages mode: store page IDs in syncFileIds without the marker
      const isTopLevel = notionPagePickerMode === 'top-level';

      const response = await fetch('/api/nango/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'notion',
          // For top-level: use marker. For subpages: clear folder fields
          syncFolderId: isTopLevel ? 'top-level-mode' : null,
          syncFolderName: isTopLevel
            ? (pageNames.length > 1 ? `${pageNames.length} pages selected` : pageNames[0])
            : null,
          syncFolderPath: isTopLevel ? pageNames.join(', ') : null,
          // Store ALL page IDs in syncFileIds for both modes
          syncFileIds: pageIds,
          syncFileNames: pageNames,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('connectorPageSaveError'));
      }

      await fetchConnections();
      setSyncError(null);
      setNotionPagePickerOpen(false);
    } catch (err) {
      console.error('Failed to save Notion pages:', err);
      setSyncError(t('connectorPageSaveError'));
    }
  };

  // Helper to check if provider needs folder selection
  const needsFolderSelection = (provider: SupportedProvider): boolean => {
    return provider === 'google-drive' || provider === 'dropbox' || provider === 'box';
  };

  // Check if connectors feature is disabled in config
  if (!configLoading && connectorConfig && !connectorConfig.feature_enabled && !demoMode) {
    return null;
  }


  if (isLoading || configLoading) {
    return (
      <Card className="bg-transparent border-0 shadow-none">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="relative">
            <Loader2 className="w-8 h-8 animate-spin text-[#FF6417] dark:text-[#FF8A4D]" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('loading') || 'Loading connectors...'}</p>
        </CardContent>
      </Card>
    );
  }

  if (!isEnabled && !demoMode) {
    return (
      <Card className="bg-transparent border-0 shadow-none">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <CloudOff className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">{t('documentConnectorsUnavailableTitle')}</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {t('documentConnectorsUnavailableDescription')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const connectedProviders = new Map(
    connections
      .filter(c => c.status === 'connected')
      .map(c => [c.provider, c])
  );

  return (
    <Card className="bg-transparent border-0 shadow-none">
      <CardHeader>

        <CardDescription className="text-gray-700 dark:text-gray-200">
          {t('documentConnectorsDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(error || syncError) && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error || syncError}</span>
            <button
              onClick={() => { clearError(); setSyncError(null); }}
              className="ml-auto text-red-500/70 hover:text-red-500"
            >
              {t('dismiss')}
            </button>
          </div>
        )}

        {/* Sync Results Banner */}
        {lastSyncResult && lastSyncResult.stats && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="flex flex-wrap gap-1">
              <strong>{PROVIDER_CONFIG[lastSyncResult.provider].displayName}</strong>
              <span>{t('connectorSyncCompletePrefix')}</span>
              {(() => {
                const parts: ReactNode[] = [];
                if (lastSyncResult.stats.processed > 0) {
                  parts.push(
                    <span key="processed" className="font-medium">
                      {formatCountLabel('connectorSyncProcessedLabel', lastSyncResult.stats.processed)}
                    </span>
                  );
                }
                if (lastSyncResult.stats.deleted > 0) {
                  parts.push(
                    <span key="deleted" className="font-medium">
                      {formatCountLabel('connectorSyncDeletedLabel', lastSyncResult.stats.deleted)}
                    </span>
                  );
                }
                if (lastSyncResult.stats.skipped > 0) {
                  parts.push(
                    <span key="skipped" className="text-green-600/70 dark:text-green-500/70">
                      {formatCountLabel('connectorSyncSkippedLabel', lastSyncResult.stats.skipped)}
                    </span>
                  );
                }
                if (parts.length === 0) {
                  return <span>{t('connectorSyncNoChanges')}</span>;
                }
                return parts.reduce<ReactNode[]>((acc, part, index) => {
                  if (index === 0) return [part];
                  return [...acc, <span key={`sep-${index}`}>, </span>, part];
                }, []);
              })()}
            </span>
            <button
              onClick={() => setLastSyncResult(null)}
              className="ml-auto text-green-600/70 hover:text-green-600"
            >
              {t('dismiss')}
            </button>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ALL_PROVIDERS.map((provider) => {
            // Check if provider is enabled in config
            const providerConfig = connectorConfig?.providers.find(p => p.provider === provider);
            if (!demoMode && (!providerConfig?.enabled || !providerConfig?.show_on_dashboard)) {
              return null;
            }

            const config = PROVIDER_CONFIG[provider];
            const connection = connectedProviders.get(provider);
            const isConnected = !!connection;
            const isSyncing = syncingProvider === provider;

            return (
              <div
                key={provider}
                className={cn(
                  "flex flex-col p-4 rounded-lg border transition-colors",
                  isConnected
                    ? "border-blue-500/30 bg-blue-500/5"
                    : "border-border hover:border-border/80"
                )}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    <img
                      src={config.icon}
                      alt={config.displayName}
                      className="w-6 h-6"
                      onError={(e) => {
                        // Fallback to a generic icon on error
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium truncate">{config.displayName}</h4>
                      {isConnected && (
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {t('connectorStatusConnected')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {config.description}
                    </p>
                  </div>
                </div>

                {/* Folder/File selection for Google Drive, Dropbox, Box */}
                {isConnected && needsFolderSelection(provider) && (
                  <div className="mb-3 space-y-2">
                    {/* Folder sync option */}
                    <button
                      onClick={() => handleOpenFolderPicker(provider)}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                        "border border-dashed",
                        connection.sync_folder_id
                          ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                          : "border-border/50 hover:bg-muted/50"
                      )}
                    >
                      {connection.sync_folder_id ? (
                        <>
                          <FolderOpen className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <span className="truncate text-blue-700 dark:text-blue-400">
                            {connection.sync_folder_name || t('connectorSelectedFolderFallback')}
                          </span>
                        </>
                      ) : (
                        <>
                          <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">
                            Select folder
                          </span>
                        </>
                      )}
                    </button>

                    {/* File sync option */}
                    <button
                      onClick={() => handleOpenFilePicker(provider)}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                        "border border-dashed",
                        connection.sync_file_ids?.length
                          ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                          : "border-border/50 hover:bg-muted/50"
                      )}
                    >
                      {connection.sync_file_ids?.length ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <span className="truncate text-blue-700 dark:text-blue-400">
                            {connection.sync_file_ids.length === 1
                              ? formatCountLabel('connectorFileSelected', 1)
                              : formatCountLabel('connectorFilesSelected', connection.sync_file_ids.length)}
                          </span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">
                            Select files
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Page selection for Notion */}
                {isConnected && provider === 'notion' && (
                  <div className="mb-3 space-y-2">
                    {/* Top-level pages button */}
                    <button
                      onClick={() => {
                        setNotionPagePickerMode('top-level');
                        setNotionPagePickerOpen(true);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                        "border border-dashed",
                        connection.sync_folder_id === 'top-level-mode' && connection.sync_file_ids?.length
                          ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                          : "border-border/50 hover:bg-muted/50"
                      )}
                    >
                      {connection.sync_folder_id === 'top-level-mode' && connection.sync_file_ids?.length ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <span className="truncate text-blue-700 dark:text-blue-400">
                            {connection.sync_file_ids.length === 1
                              ? (connection.sync_file_names?.[0] || t('notionTopLevelPageSelected'))
                              : formatCountLabel('notionTopLevelPagesSelected', connection.sync_file_ids.length)}
                          </span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">
                            Select top-level pages
                          </span>
                        </>
                      )}
                    </button>

                    {/* Subpages button */}
                    <button
                      onClick={() => {
                        setNotionPagePickerMode('subpages');
                        setNotionPagePickerOpen(true);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                        "border border-dashed",
                        connection.sync_file_ids?.length && connection.sync_folder_id !== 'top-level-mode'
                          ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                          : "border-border/50 hover:bg-muted/50"
                      )}
                    >
                      {connection.sync_file_ids?.length && connection.sync_folder_id !== 'top-level-mode' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <span className="truncate text-blue-700 dark:text-blue-400">
                            {connection.sync_file_ids.length === 1
                              ? t('notionSubpageSelected')
                              : formatCountLabel('notionSubpagesSelected', connection.sync_file_ids.length)}
                          </span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">
                            Select subpages
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {isConnected && connection.last_sync_at && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {t('connectorLastSyncedLabel')} {new Date(connection.last_sync_at).toLocaleDateString()}
                  </p>
                )}

                <div className="flex gap-2 mt-auto">
                  {isConnected ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleSync(provider, connection.connection_id)}
                        disabled={isSyncing || (needsFolderSelection(provider) && !connection.sync_folder_id && !connection.sync_file_ids?.length)}
                        title={needsFolderSelection(provider) && !connection.sync_folder_id && !connection.sync_file_ids?.length ? t('connectorSelectFolderOrFilesFirst') : ''}
                      >
                        {isSyncing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            {t('syncAction')}
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(provider)}
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => handleConnect(provider)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Link2 className="w-4 h-4 mr-2" />
                      )}
                      {t('connectAction')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Folder Picker Modal */}
      {folderPickerProvider && (
        <FolderPicker
          open={folderPickerOpen}
          onOpenChange={setFolderPickerOpen}
          provider={folderPickerProvider}
          providerName={PROVIDER_CONFIG[folderPickerProvider].displayName}
          currentFolderId={connectedProviders.get(folderPickerProvider)?.sync_folder_id}
          currentFolderName={connectedProviders.get(folderPickerProvider)?.sync_folder_name}
          multiSelect={true}
          onSelect={handleFolderSelect}
        />
      )}

      {/* File Picker Modal */}
      {filePickerProvider && (
        <FilePicker
          open={filePickerOpen}
          onOpenChange={setFilePickerOpen}
          provider={filePickerProvider}
          providerName={PROVIDER_CONFIG[filePickerProvider].displayName}
          onSelect={handleFileSelect}
        />
      )}

      {/* Notion Page Picker Modal */}
      <NotionPagePicker
        open={notionPagePickerOpen}
        onOpenChange={setNotionPagePickerOpen}
        mode={notionPagePickerMode}
        currentPageIds={
          // For top-level mode: use sync_file_ids if in multi-page mode
          // For subpages mode: use sync_file_ids only if not in top-level-mode
          notionPagePickerMode === 'top-level'
            ? (connectedProviders.get('notion')?.sync_folder_id === 'top-level-mode'
              ? connectedProviders.get('notion')?.sync_file_ids ?? undefined
              : undefined)
            : (connectedProviders.get('notion')?.sync_folder_id !== 'top-level-mode'
              ? connectedProviders.get('notion')?.sync_file_ids ?? undefined
              : undefined)
        }
        currentPageNames={
          notionPagePickerMode === 'top-level'
            ? (connectedProviders.get('notion')?.sync_folder_id === 'top-level-mode'
              ? connectedProviders.get('notion')?.sync_file_names ?? undefined
              : undefined)
            : (connectedProviders.get('notion')?.sync_folder_id !== 'top-level-mode'
              ? connectedProviders.get('notion')?.sync_file_names ?? undefined
              : undefined)
        }
        onSelect={handleNotionPageSelect}
      />
    </Card>
  );
}
