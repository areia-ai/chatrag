'use client';

import React from 'react';
import styles from './styles.module.css';

interface ProviderToggleProps {
  provider: {
    provider: string;
    enabled: boolean;
    show_on_dashboard: boolean;
    button_label: string;
    description: string;
    supported_file_types: string[];
    max_files_per_sync: number;
  };
  onToggleEnabled: (enabled: boolean) => void;
  onToggleDashboard: (show: boolean) => void;
  isSaving: boolean;
}

export function ProviderToggle({
  provider,
  onToggleEnabled,
  onToggleDashboard,
  isSaving,
}: ProviderToggleProps) {
  return (
    <div className={styles.settingsPanel}>
      <div className={styles.setting}>
        <label>
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={e => onToggleEnabled(e.target.checked)}
            disabled={isSaving}
          />
        </label>
        <p className={styles.description}>Enable this provider for all users</p>
      </div>

      <div className={styles.setting}>
        <label>
          <span>Show in Document Dashboard</span>
          <input
            type="checkbox"
            checked={provider.show_on_dashboard}
            onChange={e => onToggleDashboard(e.target.checked)}
            disabled={isSaving}
          />
        </label>
        <p className={styles.description}>
          Show this provider in the Document Dashboard when enabled
        </p>
      </div>

      <div className={styles.setting}>
        <label>
          <span>Button Label</span>
          <input
            type="text"
            value={provider.button_label}
            placeholder="e.g., Connect Google Drive"
            disabled={isSaving}
            readOnly
          />
        </label>
        <p className={styles.description}>Display name for this provider</p>
      </div>

      <div className={styles.setting}>
        <label>
          <span>Description</span>
          <textarea
            value={provider.description}
            placeholder="e.g., Import files from your Google Drive"
            disabled={isSaving}
            readOnly
            rows={2}
          />
        </label>
        <p className={styles.description}>Description shown to users</p>
      </div>

      <div className={styles.setting}>
        <label>
          <span>Supported File Types</span>
          <input
            type="text"
            value={provider.supported_file_types.join(', ')}
            disabled={isSaving}
            readOnly
          />
        </label>
        <p className={styles.description}>File types that will be synced from this provider</p>
      </div>

      <div className={styles.setting}>
        <label>
          <span>Max Files Per Sync</span>
          <input
            type="number"
            value={provider.max_files_per_sync}
            disabled={isSaving}
            readOnly
          />
        </label>
        <p className={styles.description}>Maximum number of files to sync in one operation</p>
      </div>
    </div>
  );
}
