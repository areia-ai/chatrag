// Connectors Configuration Manager
class ConnectorsConfigManager {
  constructor() {
    this.config = null;
    this.init();
  }

  async init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupUI());
    } else {
      this.setupUI();
    }
  }

  setupUI() {
    // Load configuration when tab is clicked
    const connectorLink = document.querySelector('[data-tab="connectors"]');
    if (connectorLink) {
      connectorLink.addEventListener('click', () => this.loadConfiguration());
    }

    // Setup feature enabled toggle
    const featureToggle = document.getElementById('feature-enabled-toggle');
    if (featureToggle) {
      featureToggle.addEventListener('change', (e) => {
        if (this.config) {
          this.config.feature_enabled = e.target.checked;
        }
      });
    }

    // Setup dashboard visibility toggle
    const dashboardToggle = document.getElementById('dashboard-visibility-toggle');
    if (dashboardToggle) {
      dashboardToggle.addEventListener('change', (e) => {
        if (this.config) {
          this.config.show_on_dashboard = e.target.checked;
        }
      });
    }

    // Setup save button
    const saveBtn = document.getElementById('save-connectors-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveConfiguration());
    }

    // Setup reset button
    const resetBtn = document.getElementById('reset-connectors-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetToDefaults());
    }
  }

  async loadConfiguration() {
    try {
      this.showLoading(true);
      this.showError(null);

      const response = await fetch('/api/config/connectors');
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      this.config = await response.json();
      this.renderConfiguration();
      this.showLoading(false);
    } catch (error) {
      console.error('Error loading connector config:', error);
      this.showError(`Failed to load configuration: ${error.message}`);
      this.showLoading(false);
    }
  }

  renderConfiguration() {
    if (!this.config) return;

    // Render feature toggles
    const featureToggle = document.getElementById('feature-enabled-toggle');
    if (featureToggle) {
      featureToggle.checked = this.config.feature_enabled;
    }

    const dashboardToggle = document.getElementById('dashboard-visibility-toggle');
    if (dashboardToggle) {
      dashboardToggle.checked = this.config.show_on_dashboard;
    }

    // Render providers list
    this.renderProvidersList();

    // Render connections table
    this.renderConnectionsTable();
  }

  renderProvidersList() {
    const container = document.getElementById('providers-list');
    if (!container || !this.config) return;

    container.innerHTML = this.config.providers
      .map(provider => this.createProviderElement(provider))
      .join('');

    // Add event listeners to toggles
    this.config.providers.forEach(provider => {
      const enableToggle = document.getElementById(
        `provider-enabled-${provider.provider}`
      );
      if (enableToggle) {
        enableToggle.addEventListener('change', e => {
          const updatedProvider = this.config.providers.find(
            p => p.provider === provider.provider
          );
          if (updatedProvider) {
            updatedProvider.enabled = e.target.checked;
          }
        });
      }

      const dashboardToggle = document.getElementById(
        `provider-dashboard-${provider.provider}`
      );
      if (dashboardToggle) {
        dashboardToggle.addEventListener('change', e => {
          const updatedProvider = this.config.providers.find(
            p => p.provider === provider.provider
          );
          if (updatedProvider) {
            updatedProvider.show_on_dashboard = e.target.checked;
          }
        });
      }
    });
  }

  createProviderElement(provider) {
    const isConnected = provider.user_connection && provider.user_connection.connected;
    const connectionStatus = isConnected ? 'Connected' : 'Not Connected';
    const statusIcon = isConnected ? ' ✓' : '○';
    const statusColor = isConnected ? 'text-success' : 'text-base-content/50';

    // Build connection info display
    let connectionInfo = '';
    if (isConnected && provider.user_connection) {
      const conn = provider.user_connection;

      if (conn.sync_folder_name) {
        connectionInfo += `
          <div class="mt-2 text-sm">
            <span class="text-base-content/70">Folder:</span>
            <span class="font-medium text-success">${conn.sync_folder_name}</span>
          </div>
        `;
      }

      if (conn.sync_file_ids && conn.sync_file_ids.length > 0) {
        connectionInfo += `
          <div class="mt-1 text-sm">
            <span class="text-base-content/70">Files:</span>
            <span class="font-medium text-success">${conn.sync_file_ids.length} selected</span>
          </div>
        `;
      }

      if (conn.last_sync_at) {
        const lastSync = new Date(conn.last_sync_at).toLocaleDateString();
        connectionInfo += `
          <div class="mt-1 text-xs text-base-content/60">
            Last synced: ${lastSync}
          </div>
        `;
      }
    }

    return `
      <div class="card bg-base-300 shadow ${isConnected ? 'border border-success/30' : ''}">
        <div class="card-body p-4">
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 flex-1">
              <span class="text-xl ${statusColor}">${statusIcon}</span>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="font-semibold">${provider.button_label}</h4>
                  <span class="badge badge-sm ${isConnected ? 'badge-success' : 'badge-ghost'}">
                    ${connectionStatus}
                  </span>
                </div>
                <p class="text-sm text-base-content/70">${provider.stats.connected_users} total user${provider.stats.connected_users !== 1 ? 's' : ''}</p>
                ${connectionInfo}
              </div>
            </div>
            <div class="flex items-center gap-2">
              ${isConnected ? `
                <button
                  class="btn btn-sm btn-error btn-outline"
                  onclick="connectorsConfig.handleDisconnect('${provider.provider}')"
                  title="Disconnect from ${provider.button_label}"
                  aria-label="Disconnect from ${provider.button_label}"
                >
                  Disconnect
                </button>
                <button
                  class="btn btn-sm btn-primary"
                  onclick="connectorsConfig.handleSync('${provider.provider}')"
                  title="Sync documents from ${provider.button_label}"
                  aria-label="Sync documents from ${provider.button_label}${!provider.user_connection.sync_folder_id && !provider.user_connection.sync_file_ids?.length ? ' (select folder or files first)' : ''}"
                  ${!provider.user_connection.sync_folder_id && !provider.user_connection.sync_file_ids?.length ? 'disabled' : ''}
                >
                  Sync
                </button>
              ` : `
                <button
                  class="btn btn-sm btn-primary"
                  onclick="connectorsConfig.handleConnect('${provider.provider}')"
                  title="Connect to ${provider.button_label}"
                  aria-label="Connect to ${provider.button_label} provider"
                >
                  Connect
                </button>
              `}
              <button
                class="btn btn-sm btn-ghost"
                onclick="document.getElementById('provider-details-${provider.provider}').classList.toggle('hidden')"
                aria-label="Toggle ${provider.button_label} settings"
                aria-expanded="false"
                aria-controls="provider-details-${provider.provider}"
              >
                Settings
              </button>
            </div>
          </div>

          <!-- Folder/File Selection (for connected Google Drive/Dropbox) -->
          ${isConnected && (provider.provider === 'google-drive' || provider.provider === 'dropbox') ? `
            <div class="mt-3 space-y-2">
              <button
                class="w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors border border-dashed ${provider.user_connection.sync_folder_id ? 'border-success/30 bg-success/5 hover:bg-success/10' : 'border-base-300 hover:bg-base-200'}" 
                onclick="connectorsConfig.openFolderPicker('${provider.provider}')"
                aria-label="Select folder to sync from ${provider.button_label}"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${provider.user_connection.sync_folder_id ? 'text-success' : 'text-base-content/50'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span class="${provider.user_connection.sync_folder_id ? 'text-success font-medium' : 'text-base-content/70'}">
                  ${provider.user_connection.sync_folder_name || 'Select Folder to Sync'}
                </span>
              </button>
              <button
                class="w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors border border-dashed ${provider.user_connection.sync_file_ids?.length > 0 ? 'border-success/30 bg-success/5 hover:bg-success/10' : 'border-base-300 hover:bg-base-200'}" 
                onclick="connectorsConfig.openFilePicker('${provider.provider}')"
                aria-label="Select files to sync from ${provider.button_label}"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${provider.user_connection.sync_file_ids?.length > 0 ? 'text-success' : 'text-base-content/50'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span class="${provider.user_connection.sync_file_ids?.length > 0 ? 'text-success font-medium' : 'text-base-content/70'}">
                  ${provider.user_connection.sync_file_ids?.length > 0 ? `${provider.user_connection.sync_file_ids.length} file${provider.user_connection.sync_file_ids.length > 1 ? 's' : ''} selected` : 'Select Files to Sync'}
                </span>
              </button>
            </div>
          ` : ''}

          <!-- Notion Page Selection (for connected Notion) -->
          ${isConnected && provider.provider === 'notion' ? `
            <div class="mt-3 space-y-2">
              <button
                class="w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors border border-dashed ${provider.user_connection.sync_folder_id ? 'border-success/30 bg-success/5 hover:bg-success/10' : 'border-base-300 hover:bg-base-200'}" 
                onclick="connectorsConfig.openNotionPagePicker('top-level')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${provider.user_connection.sync_folder_id ? 'text-success' : 'text-base-content/50'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span class="${provider.user_connection.sync_folder_id ? 'text-success font-medium' : 'text-base-content/70'}">
                  ${provider.user_connection.sync_folder_name || 'Select Top-Level Pages'}
                </span>
              </button>
              <button
                class="w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors border border-dashed ${provider.user_connection.sync_file_ids?.length > 0 ? 'border-success/30 bg-success/5 hover:bg-success/10' : 'border-base-300 hover:bg-base-200'}" 
                onclick="connectorsConfig.openNotionPagePicker('subpages')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${provider.user_connection.sync_file_ids?.length > 0 ? 'text-success' : 'text-base-content/50'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span class="${provider.user_connection.sync_file_ids?.length > 0 ? 'text-success font-medium' : 'text-base-content/70'}">
                  ${provider.user_connection.sync_file_ids?.length > 0 ? `${provider.user_connection.sync_file_ids.length} subpage${provider.user_connection.sync_file_ids.length > 1 ? 's' : ''} selected` : 'Select Subpages'}
                </span>
              </button>
            </div>
          ` : ''}

          <!-- Provider Details (Hidden by default) -->
          <div id="provider-details-${provider.provider}" class="hidden mt-4 pt-4 border-t border-base-100 space-y-3">
            <div class="flex items-center justify-between">
              <label class="label cursor-pointer flex items-center gap-2">
                <input
                  type="checkbox"
                  id="provider-enabled-${provider.provider}"
                  class="checkbox checkbox-sm"
                  ${provider.enabled ? 'checked' : ''}
                />
                <span class="label-text text-sm">Enable Provider</span>
              </label>
            </div>

            <div class="flex items-center justify-between">
              <label class="label cursor-pointer flex items-center gap-2">
                <input
                  type="checkbox"
                  id="provider-dashboard-${provider.provider}"
                  class="checkbox checkbox-sm"
                  ${provider.show_on_dashboard ? 'checked' : ''}
                />
                <span class="label-text text-sm">Show on Dashboard</span>
              </label>
            </div>

            <div class="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p class="text-base-content/70">File Types</p>
                <p class="font-mono text-xs">${provider.supported_file_types.join(', ')}</p>
              </div>
              <div>
                <p class="text-base-content/70">Max Files</p>
                <p class="font-mono text-xs">${provider.max_files_per_sync}</p>
              </div>
            </div>

            <!-- Stats Grid -->
            <div class="grid grid-cols-2 gap-2 mt-3">
              <div class="stat bg-base-100 rounded p-2">
                <p class="stat-title text-xs">Total Syncs</p>
                <p class="stat-value text-lg">${provider.stats.total_syncs}</p>
              </div>
              <div class="stat bg-base-100 rounded p-2">
                <p class="stat-title text-xs">Failed</p>
                <p class="stat-value text-lg text-error">${provider.stats.failed_syncs}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderConnectionsTable() {
    const tbody = document.getElementById('connections-table-body');
    if (!tbody || !this.config) return;

    tbody.innerHTML = this.config.providers
      .map(provider => {
        const successRate =
          provider.stats.total_syncs > 0
            ? Math.round(
              ((provider.stats.total_syncs - provider.stats.failed_syncs) /
                provider.stats.total_syncs) *
              100
            )
            : 0;

        const lastSync = provider.stats.last_sync
          ? new Date(provider.stats.last_sync).toLocaleString()
          : 'Never';

        return `
          <tr>
            <td>${provider.button_label}</td>
            <td>${provider.stats.connected_users}</td>
            <td class="text-sm">${lastSync}</td>
            <td>
              <span class="badge ${successRate === 100 ? 'badge-success' : 'badge-warning'}">
                ${successRate}%
              </span>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async saveConfiguration() {
    if (!this.config) return;

    try {
      const saveBtn = document.getElementById('save-connectors-btn');
      if (saveBtn) saveBtn.disabled = true;

      // Prepare update payload
      const providers = {};
      this.config.providers.forEach(provider => {
        providers[provider.provider] = {
          enabled: provider.enabled,
          show_on_dashboard: provider.show_on_dashboard,
        };
      });

      // Get auth token from localStorage or session
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || 'admin';

      const response = await fetch('/api/config/connectors', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          feature_enabled: this.config.feature_enabled,
          show_on_dashboard: this.config.show_on_dashboard,
          providers,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      // Show success message
      const notification = document.createElement('div');
      notification.className = 'alert alert-success';
      notification.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>Connector configuration saved successfully!</span>
      `;
      const container = document.getElementById('connectors-config-container');
      if (container) {
        container.insertBefore(notification, container.firstChild);
        setTimeout(() => notification.remove(), 3000);
      }

      // Reload configuration
      await this.loadConfiguration();

      // Notify the app that connector config was updated
      window.dispatchEvent(new Event('connectorConfigUpdated'));
    } catch (error) {
      console.error('Error saving config:', error);
      this.showError(`Failed to save: ${error.message}`);
    } finally {
      const saveBtn = document.getElementById('save-connectors-btn');
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async resetToDefaults() {
    if (!confirm('Are you sure you want to reset all connectors to their default configuration?')) {
      return;
    }

    // Reset all providers to default values (first 3 enabled, rest disabled)
    const defaults = {
      'google-drive': true,
      'notion': true,
      'dropbox': true,
      'onedrive': false,
      'box': false,
      'confluence': false,
    };

    this.config.providers.forEach(provider => {
      provider.enabled = defaults[provider.provider] ?? true;
      provider.show_on_dashboard = true;
    });

    this.renderConfiguration();
    await this.saveConfiguration();
  }

  showLoading(show) {
    const loadingDiv = document.getElementById('connectors-loading');
    const container = document.getElementById('connectors-config-container');

    if (loadingDiv) {
      loadingDiv.style.display = show ? 'block' : 'none';
    }

    // Hide content while loading
    const cards = container?.querySelectorAll('.card:not(#connectors-loading)');
    if (cards) {
      cards.forEach(card => {
        card.style.display = show ? 'none' : 'block';
      });
    }
  }

  showError(message) {
    const errorDiv = document.getElementById('connectors-error');
    const errorText = document.getElementById('connectors-error-text');

    if (message) {
      if (errorText) errorText.textContent = message;
      if (errorDiv) errorDiv.classList.remove('hidden');
    } else {
      if (errorDiv) errorDiv.classList.add('hidden');
    }
  }

  /**
   * Connection Management Methods
   */

  async handleConnect(provider) {
    try {
      console.log(`[Connectors] Connecting to ${provider}...`);

      // Use the Nango client wrapper to initiate OAuth flow
      if (!nangoClient || !nangoClient.isInitialized) {
        throw new Error('Nango client not initialized. Please refresh the page.');
      }

      // Show loading in the provider card
      this.showNotification(`Connecting to ${provider}...`, 'info');

      // Trigger OAuth flow
      const connectionId = await nangoClient.connect(provider);

      console.log(`[Connectors] Successfully connected to ${provider}:`, connectionId);

      // Show success message
      this.showNotification(`Successfully connected to ${provider}!`, 'success');

      // Reload configuration to update UI
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to connect to ${provider}:`, error);
      this.showNotification(`Failed to connect: ${error.message}`, 'error');
    }
  }

  async handleDisconnect(provider) {
    const confirmed = await this.showConfirmationDialog(
      'Disconnect Provider?',
      `Are you sure you want to disconnect from ${provider}? This will stop syncing documents from this provider.`,
      'Disconnect',
      'Cancel'
    );
    if (!confirmed) return;

    try {
      console.log(`[Connectors] Disconnecting from ${provider}...`);

      // Use the Nango client wrapper to disconnect
      await nangoClient.disconnect(provider);

      console.log(`[Connectors] Successfully disconnected from ${provider}`);

      // Show success message
      this.showNotification(`Successfully disconnected from ${provider}`, 'success');

      // Reload configuration to update UI
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to disconnect from ${provider}:`, error);
      this.showNotification(`Failed to disconnect: ${error.message}`, 'error');
    }
  }

  async handleSync(provider) {
    try {
      console.log(`[Connectors] Starting sync for ${provider}...`);

      // Get the provider's connection
      const providerData = this.config.providers.find(p => p.provider === provider);
      if (!providerData || !providerData.user_connection) {
        throw new Error('No connection found for this provider');
      }

      const connectionId = providerData.user_connection.connection_id;
      const fileCount = providerData.user_connection.sync_file_ids?.length || 0;

      // Check if large sync (>50 files) and ask for confirmation
      if (fileCount > 50) {
        const confirmed = await this.showConfirmationDialog(
          'Large Sync Operation',
          `You're about to sync ${fileCount} files. This may take several minutes. Continue?`,
          'Start Sync',
          'Cancel'
        );
        if (!confirmed) return;
      }

      // Get sync button and add loading animation
      const syncButton = document.querySelector(`[onclick="connectorsConfig.handleSync('${provider}')"]`);
      if (syncButton) {
        syncButton.disabled = true;
        syncButton.classList.add('loading');
        syncButton.innerHTML = 'Syncing...';
      }

      // Show loading notification
      this.showNotification(`Syncing documents from ${provider}...`, 'info');

      // Trigger sync via Nango client
      const stats = await nangoClient.sync(provider, connectionId);

      console.log(`[Connectors] Sync completed for ${provider}:`, stats);

      // Show success message with detailed stats
      const message = `✓ Sync completed! Processed: ${stats.processed || 0}, Deleted: ${stats.deleted || 0}, Skipped: ${stats.skipped || 0}`;
      this.showNotification(message, 'success');

      // Reload configuration to update last sync time and reset button
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to sync ${provider}:`, error);
      this.showNotification(`Sync failed: ${error.message}`, 'error');

      // Reset button on error
      const syncButton = document.querySelector(`[onclick="connectorsConfig.handleSync('${provider}')"]`);
      if (syncButton) {
        syncButton.disabled = false;
        syncButton.classList.remove('loading');
        syncButton.innerHTML = 'Sync';
      }
    }
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('connectors-config-container');
    if (!container) return;

    // Remove any existing notifications
    const existingNotification = container.querySelector('.notification-banner');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification-banner alert alert-${type} mb-4`;
    notification.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        ${type === 'success' ? `
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        ` : type === 'error' ? `
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        ` : `
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        `}
      </svg>
      <span>${message}</span>
      <button class="btn btn-sm btn-ghost" onclick="this.parentElement.remove()">✕</button>
    `;

    container.insertBefore(notification, container.firstChild);

    // Add report button for error messages (Phase 7: Enhanced error handling)
    if (type === 'error') {
      const reportBtn = document.createElement('button');
      reportBtn.className = 'btn btn-xs btn-ghost ml-2';
      reportBtn.setAttribute('aria-label', 'Report this issue');
      reportBtn.innerHTML = '📋 Report';
      reportBtn.addEventListener('click', () => {
        const issueText = encodeURIComponent(`Config UI Error: ${message}`);
        const issueUrl = `https://github.com/areia-ai/chatrag/issues/new?title=${issueText}`;
        window.open(issueUrl, '_blank');
      });

      // Insert report button before close button
      const closeBtn = notification.querySelector('button:last-child');
      if (closeBtn) {
        closeBtn.parentElement.insertBefore(reportBtn, closeBtn);
      }
    }

    // Auto-dismiss success and info messages after 5 seconds
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 5000);
    }
  }

  /**
   * Show custom confirmation dialog for Phase 7 UX enhancement
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {string} confirmText - Confirm button text
   * @param {string} cancelText - Cancel button text
   * @returns {Promise<boolean>} - User's choice
   */
  showConfirmationDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'modal modal-open';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'dialog-title');
      dialog.setAttribute('aria-describedby', 'dialog-message');

      dialog.innerHTML = `
        <div class="modal-box max-w-sm">
          <h3 id="dialog-title" class="font-bold text-lg mb-4">${title}</h3>
          <p id="dialog-message" class="py-4 text-base-content/70">${message}</p>
          <div class="modal-action gap-2">
            <button 
              class="btn btn-ghost" 
              aria-label="Cancel dialog"
              onclick="this.closest('.modal').remove()"
            >
              ${cancelText}
            </button>
            <button 
              class="btn btn-primary" 
              aria-label="Confirm action"
              onclick="this.closest('.modal').remove()"
            >
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      // Handle button clicks
      const buttons = dialog.querySelectorAll('button');
      buttons[0].addEventListener('click', () => {
        dialog.remove();
        resolve(false);
      });
      buttons[1].addEventListener('click', () => {
        dialog.remove();
        resolve(true);
      });

      // Handle ESC key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          dialog.remove();
          document.removeEventListener('keydown', handleEscape);
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEscape);

      // Focus confirm button for accessibility
      buttons[1].focus();
    });
  }

  /**
   * Folder/File Picker Methods
   */

  async openFolderPicker(provider) {
    try {
      console.log(`[Connectors] Opening folder picker for ${provider}...`);

      // Get the provider's connection
      const providerData = this.config.providers.find(p => p.provider === provider);
      if (!providerData || !providerData.user_connection) {
        throw new Error('No connection found for this provider');
      }

      const connectionId = providerData.user_connection.connection_id;

      // Create folder picker modal with multi-select enabled
      const folderPicker = new FolderPickerModal(provider, connectionId, { multiSelect: true });

      // Open picker with callback (receives arrays in multi-select mode)
      await folderPicker.openPicker((folderIds, folderNames, folderPaths) => {
        this.handleFolderSelect(provider, folderIds, folderNames, folderPaths);
      });

    } catch (error) {
      console.error(`[Connectors] Failed to open folder picker:`, error);
      this.showNotification(`Failed to open folder picker: ${error.message}`, 'error');
    }
  }

  async handleFolderSelect(provider, folderIds, folderNames, folderPaths) {
    try {
      // Handle both single and array formats (backwards compatibility)
      const ids = Array.isArray(folderIds) ? folderIds : [folderIds];
      const names = Array.isArray(folderNames) ? folderNames : [folderNames];
      const paths = Array.isArray(folderPaths) ? folderPaths : [folderPaths];

      console.log(`[Connectors] Folders selected for ${provider}:`, { ids, names, paths });

      // Use same pattern as Notion: store folder IDs in sync_file_ids with marker
      const updateData = {
        syncFileIds: ids,
        syncFileNames: names,
        syncFolderId: ids.length > 1 ? 'multi-folder-mode' : ids[0],
        syncFolderName: ids.length > 1
          ? `${ids.length} folders selected`
          : names[0],
        syncFolderPath: paths.join(', '),
      };

      // Update connection via Nango client
      await nangoClient.updateConnection(provider, updateData);

      console.log(`[Connectors] Folder selection saved`);

      // Show success message
      const folderCount = ids.length;
      this.showNotification(
        folderCount > 1
          ? `${folderCount} folders selected successfully!`
          : `Folder "${names[0]}" selected successfully!`,
        'success'
      );

      // Reload configuration to update UI
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to save folder selection:`, error);
      this.showNotification(`Failed to save folder selection: ${error.message}`, 'error');
    }
  }

  async openFilePicker(provider) {
    try {
      console.log(`[Connectors] Opening file picker for ${provider}...`);

      // Get the provider's connection
      const providerData = this.config.providers.find(p => p.provider === provider);
      if (!providerData || !providerData.user_connection) {
        throw new Error('No connection found for this provider');
      }

      const connectionId = providerData.user_connection.connection_id;
      // For Dropbox, always load from root folder for now (the sync_folder_id is for which folder to sync)
      // File selection happens from root, then we decide which folder to sync
      const folderId = provider === 'dropbox' ? null : (providerData.user_connection.sync_folder_id || null);

      console.log(`[Connectors] File picker params - provider: ${provider}, folderId: ${folderId}, sync_folder_id: ${providerData.user_connection.sync_folder_id}`);

      // Create file picker modal
      const filePicker = new FilePickerModal(provider, connectionId, folderId);

      // Open picker with callback
      await filePicker.openPicker((fileIds, fileNames) => {
        this.handleFileSelect(provider, fileIds, fileNames);
      });

    } catch (error) {
      console.error(`[Connectors] Failed to open file picker:`, error);
      this.showNotification(`Failed to open file picker: ${error.message}`, 'error');
    }
  }

  async handleFileSelect(provider, fileIds, fileNames) {
    try {
      console.log(`[Connectors] Files selected for ${provider}:`, { fileIds, fileNames });

      // Update connection via Nango client
      await nangoClient.updateConnection(provider, {
        syncFileIds: fileIds,
        syncFileNames: fileNames,
      });

      console.log(`[Connectors] File selection saved`);

      // Show success message
      const fileCount = fileIds.length;
      this.showNotification(`${fileCount} file${fileCount > 1 ? 's' : ''} selected successfully!`, 'success');

      // Reload configuration to update UI
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to save file selection:`, error);
      this.showNotification(`Failed to save file selection: ${error.message}`, 'error');
    }
  }

  async openNotionPagePicker(mode) {
    try {
      console.log(`[Connectors] Opening Notion page picker in ${mode} mode...`);

      // Get the provider's connection
      const providerData = this.config.providers.find(p => p.provider === 'notion');
      if (!providerData || !providerData.user_connection) {
        throw new Error('No connection found for Notion');
      }

      const connectionId = providerData.user_connection.connection_id;

      // Create Notion page picker modal
      const notionPagePicker = new NotionPagePickerModal('notion', connectionId, mode);

      // Open picker with callback
      await notionPagePicker.openPicker((pageIds, pageNames, selectedMode) => {
        this.handleNotionPageSelect(pageIds, pageNames, selectedMode);
      });

    } catch (error) {
      console.error(`[Connectors] Failed to open Notion page picker:`, error);
      this.showNotification(`Failed to open page picker: ${error.message}`, 'error');
    }
  }

  async handleNotionPageSelect(pageIds, pageNames, mode) {
    try {
      console.log(`[Connectors] Notion pages selected in ${mode} mode:`, { pageIds, pageNames });

      // Store mode-dependent data:
      // - top-level mode: Use sync_folder_id for the selected page (single selection)
      // - subpages mode: Use sync_file_ids for multiple selected pages
      const updateData = {};

      if (mode === 'top-level') {
        // Top-level mode: store all selected pages in sync_file_ids
        // Each page will be synced with all its children
        updateData.syncFileIds = pageIds;
        updateData.syncFileNames = pageNames;
        // Use special marker to indicate top-level mode (vs subpages mode)
        updateData.syncFolderId = 'top-level-mode';
        updateData.syncFolderName = pageNames.length > 1
          ? `${pageNames.length} pages selected`
          : pageNames[0];
        updateData.syncFolderPath = pageNames.join(', ');
      } else {
        // Subpages: multiple page selection
        updateData.syncFileIds = pageIds;
        updateData.syncFileNames = pageNames;
        // Clear folder ID if switching from top-level mode
        updateData.syncFolderId = null;
        updateData.syncFolderName = null;
        updateData.syncFolderPath = null;
      }

      // Log the exact data being sent for debugging
      console.log(`[Connectors] Notion updateData:`, JSON.stringify(updateData, null, 2));

      // Update connection via Nango client
      await nangoClient.updateConnection('notion', updateData);

      console.log(`[Connectors] Notion page selection saved`);

      // Show success message
      const pageCount = pageIds.length;
      const modeLabel = mode === 'top-level' ? 'top-level page' : `${pageCount} subpage${pageCount > 1 ? 's' : ''}`;
      this.showNotification(`Selected ${modeLabel} successfully!`, 'success');

      // Reload configuration to update UI
      await this.loadConfiguration();

    } catch (error) {
      console.error(`[Connectors] Failed to save Notion page selection:`, error);
      this.showNotification(`Failed to save page selection: ${error.message}`, 'error');
    }
  }
}

// Initialize when script loads
window.connectorsConfig = new ConnectorsConfigManager();
