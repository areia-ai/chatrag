'use client';

import React, { useState } from 'react';
import { useConnectorConfig } from '@/lib/hooks/use-connector-config';
import { ProviderToggle } from './provider-toggle';
import { ConnectionStats } from './connection-stats';
import styles from './styles.module.css';

export function ConnectorsSection() {
  const { config, loading, error, updateConfig } = useConnectorConfig();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleToggleProvider = async (provider: string, enabled: boolean) => {
    if (!config) return;

    try {
      setIsSaving(true);
      const updatedProviders = config.providers.map(p =>
        p.provider === provider ? { ...p, enabled } : p
      );

      await updateConfig({
        ...config,
        providers: updatedProviders,
      });

      setSaveMessage({ type: 'success', text: 'Provider updated' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Failed to update provider' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDashboardVisibility = async (provider: string, show: boolean) => {
    if (!config) return;

    try {
      setIsSaving(true);
      const updatedProviders = config.providers.map(p =>
        p.provider === provider ? { ...p, show_on_dashboard: show } : p
      );

      await updateConfig({
        ...config,
        providers: updatedProviders,
      });

      setSaveMessage({ type: 'success', text: 'Dashboard visibility updated' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Failed to update visibility' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleFeatureEnabled = async (enabled: boolean) => {
    if (!config) return;

    try {
      setIsSaving(true);
      await updateConfig({
        ...config,
        feature_enabled: enabled,
      });

      setSaveMessage({ type: 'success', text: 'Feature setting updated' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Failed to update feature setting' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDashboardDisplay = async (show: boolean) => {
    if (!config) return;

    try {
      setIsSaving(true);
      await updateConfig({
        ...config,
        show_on_dashboard: show,
      });

      setSaveMessage({ type: 'success', text: 'Dashboard display setting updated' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Failed to update display setting' });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>Loading connector configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <p>Error loading connector configuration: {error}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>No configuration available</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Connectors Configuration</h2>
        <p>Manage which document connectors are available to users</p>
      </div>

      {saveMessage && (
        <div className={`${styles.message} ${styles[saveMessage.type]}`}>
          {saveMessage.text}
        </div>
      )}

      {/* Feature Status Section */}
      <div className={styles.section}>
        <h3>Feature Status</h3>
        <div className={styles.featureToggles}>
          <div className={styles.toggleItem}>
            <label>Enable Connectors Feature</label>
            <input
              type="checkbox"
              checked={config.feature_enabled}
              onChange={e => handleToggleFeatureEnabled(e.target.checked)}
              disabled={isSaving}
            />
          </div>
          <div className={styles.toggleItem}>
            <label>Show Connectors on Document Dashboard</label>
            <input
              type="checkbox"
              checked={config.show_on_dashboard}
              onChange={e => handleToggleDashboardDisplay(e.target.checked)}
              disabled={isSaving}
            />
          </div>
        </div>
      </div>

      {/* Supported Connectors Section */}
      <div className={styles.section}>
        <h3>Supported Connectors</h3>
        <div className={styles.connectorsList}>
          {config.providers.map(provider => (
            <div key={provider.provider} className={styles.connectorItem}>
              <div
                className={styles.connectorHeader}
                onClick={() =>
                  setExpandedProvider(
                    expandedProvider === provider.provider ? null : provider.provider
                  )
                }
              >
                <div className={styles.connectorInfo}>
                  <span className={styles.icon}>
                    {provider.enabled ? '✓' : '○'}
                  </span>
                  <div>
                    <span className={styles.providerName}>
                      {provider.button_label}
                    </span>
                    <span className={styles.connectedUsers}>
                      {provider.stats.connected_users > 0
                        ? `${provider.stats.connected_users} user${provider.stats.connected_users !== 1 ? 's' : ''} connected`
                        : 'Not connected'}
                    </span>
                  </div>
                </div>
                <span className={styles.expandIcon}>
                  {expandedProvider === provider.provider ? '▼' : '▶'}
                </span>
              </div>

              {expandedProvider === provider.provider && (
                <div className={styles.connectorDetails}>
                  <ProviderToggle
                    provider={provider}
                    onToggleEnabled={enabled =>
                      handleToggleProvider(provider.provider, enabled)
                    }
                    onToggleDashboard={show =>
                      handleToggleDashboardVisibility(provider.provider, show)
                    }
                    isSaving={isSaving}
                  />
                  <ConnectionStats stats={provider.stats} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active Connections Stats Section */}
      <div className={styles.section}>
        <h3>Active Connections (Last 30 days)</h3>
        <div className={styles.statsTable}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Connected Users</th>
                <th>Last Sync</th>
              </tr>
            </thead>
            <tbody>
              {config.providers.map(provider => (
                <tr key={provider.provider}>
                  <td>{provider.button_label}</td>
                  <td>{provider.stats.connected_users}</td>
                  <td>
                    {provider.stats.last_sync
                      ? new Date(provider.stats.last_sync).toLocaleString()
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.saveButton} disabled={isSaving}>
          Save Changes
        </button>
        <button className={styles.resetButton} disabled={isSaving}>
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
