// MCP Configuration Management for Config UI
class McpConfigManager {
  constructor() {
    this.servers = [];
    this.builtinCount = 0;
    this.customCount = 0;
    this.totalCount = 0;
    this.isLoading = false;
    this.currentEditingServer = null;
    this.init();
  }

  async init() {
    console.log('[MCP Config] Initializing MCP configuration manager');
    await this.loadServers();
    this.renderServerList();
    this.attachEventListeners();
    // Update stats after initialization
    if (typeof updateMcpStats === 'function') {
      updateMcpStats();
    }
  }

  async loadServers() {
    try {
      this.isLoading = true;
      this.updateLoadingState();

      const response = await fetch('../api/mcp/servers');
      if (!response.ok) {
        throw new Error(`Failed to load servers: ${response.status}`);
      }

      const data = await response.json();
      this.servers = data.servers || [];
      this.builtinCount = data.builtinCount || 0;
      this.customCount = data.customCount || 0;
      this.totalCount = data.totalCount || this.servers.length;

      console.log(`[MCP Config] Loaded ${this.totalCount} servers (${this.builtinCount} built-in, ${this.customCount} custom)`);
    } catch (error) {
      console.error('[MCP Config] Error loading servers:', error);
      this.showError('Failed to load MCP servers');
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
    }
  }

  renderServerList() {
    const container = document.getElementById('mcp-servers-list');
    if (!container) {
      console.error('[MCP Config] Server list container not found');
      return;
    }

    if (this.servers.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔧</div>
          <h3>No MCP Servers Configured</h3>
          <p>Add your first MCP server to enable advanced tool integrations.</p>
          <button class="btn btn-primary" onclick="mcpConfig.showAddServerDialog()">
            Add MCP Server
          </button>
        </div>
      `;
      return;
    }

    const builtinServers = this.servers.filter(s => s.id === 'zapier');
    const customServers = this.servers.filter(s => s.id !== 'zapier');

    let html = '';

    // Built-in servers section
    if (builtinServers.length > 0) {
      html += `
        <div class="server-section">
          <h3>Built-in Servers</h3>
          <div class="server-list">
            ${builtinServers.map(server => this.renderServerCard(server, true)).join('')}
          </div>
        </div>
      `;
    }

    // Custom servers section
    html += `
      <div class="server-section">
        <div class="section-header">
          <h3>Custom Servers</h3>
          <button class="btn btn-primary btn-sm" onclick="mcpConfig.showAddServerDialog()">
            <span class="icon">+</span> Add Server
          </button>
        </div>
        <div class="server-list">
          ${customServers.length > 0 ? 
            customServers.map(server => this.renderServerCard(server, false)).join('') :
            '<div class="no-custom-servers">No custom servers configured yet.</div>'
          }
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  renderServerCard(server, isBuiltin) {
    const statusIcon = this.getServerStatusIcon(server);
    const statusClass = this.getServerStatusClass(server);
    
    return `
      <div class="server-card ${statusClass}" data-server-id="${server.id}">
        <div class="server-header">
          <div class="server-info">
            <div class="server-name">
              ${statusIcon} ${server.name}
              ${isBuiltin ? '<span class="builtin-badge">Built-in</span>' : ''}
            </div>
            <div class="server-description">${server.description || 'No description'}</div>
          </div>
          <div class="server-actions">
            ${isBuiltin ? `
              <button class="btn btn-sm btn-secondary" onclick="mcpConfig.configureBuiltinServer('${server.id}')">
                Configure
              </button>
            ` : `
              <button class="btn btn-sm btn-secondary" onclick="mcpConfig.testConnection('${server.id}')">
                Test
              </button>
              <button class="btn btn-sm btn-primary" onclick="mcpConfig.editServer('${server.id}')">
                Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="mcpConfig.deleteServer('${server.id}')">
                Delete
              </button>
            `}
          </div>
        </div>
        <div class="server-details">
          <div class="server-endpoint">
            <strong>Endpoint:</strong> ${server.endpoint}
          </div>
          <div class="server-stats">
            <span class="stat">Type: ${server.type?.toUpperCase() || 'HTTP'}</span>
            ${server.settings?.enabledInChat ? '<span class="stat enabled">Chat Enabled</span>' : '<span class="stat disabled">Chat Disabled</span>'}
            ${server.settings?.enabledInEmbed ? '<span class="stat enabled">Embed Enabled</span>' : '<span class="stat disabled">Embed Disabled</span>'}
            ${server.settings?.yoloMode ? '<span class="stat yolo">⚡ YOLO Mode</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  getServerStatusIcon(server) {
    if (!server.enabled) return '⚫';
    // For now, assume enabled servers are healthy
    // In a real implementation, you'd check the last health check result
    return '🟢';
  }

  getServerStatusClass(server) {
    if (!server.enabled) return 'server-disabled';
    return 'server-enabled';
  }

  showAddServerDialog() {
    this.currentEditingServer = null;
    this.showServerDialog({
      id: '',
      name: '',
      description: '',
      endpoint: '',
      type: 'http',
      authentication: {
        type: 'none',
        credentials: {}
      },
      settings: {
        timeout: 30000,
        retryAttempts: 3,
        enabledInChat: true,
        enabledInEmbed: false
      },
      enabled: true
    });
  }

  async editServer(serverId) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      this.showError('Server not found');
      return;
    }
    
    this.currentEditingServer = server;
    this.showServerDialog(server);
  }

  showServerDialog(server) {
    const isEditing = !!this.currentEditingServer;
    const title = isEditing ? 'Edit MCP Server' : 'Add MCP Server';
    
    const dialogHtml = `
      <div class="modal-overlay" id="server-dialog-overlay">
        <div class="modal-dialog">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="modal-close" onclick="mcpConfig.closeServerDialog()">&times;</button>
          </div>
          <div class="modal-body">
            <form id="server-form">
              <div class="form-group">
                <label for="server-id">Server ID</label>
                <input type="text" id="server-id" value="${server.id}" ${isEditing ? 'readonly' : ''} 
                       placeholder="unique-server-id" required>
                <small>Unique identifier for this server (lowercase, no spaces)</small>
              </div>
              
              <div class="form-group">
                <label for="server-name">Server Name</label>
                <input type="text" id="server-name" value="${server.name}" 
                       placeholder="My Custom MCP Server" required>
              </div>
              
              <div class="form-group">
                <label for="server-description">Description</label>
                <textarea id="server-description" placeholder="What this server provides...">${server.description || ''}</textarea>
              </div>
              
              <div class="form-group">
                <label for="server-endpoint">Endpoint URL</label>
                <input type="url" id="server-endpoint" value="${server.endpoint}" 
                       placeholder="https://api.example.com/mcp" required>
              </div>
              
              <div class="form-group">
                <label for="server-type">Connection Type</label>
                <select id="server-type">
                  <option value="http" ${server.type === 'http' ? 'selected' : ''}>HTTP</option>
                  <option value="sse" ${server.type === 'sse' ? 'selected' : ''}>Server-Sent Events (SSE)</option>
                </select>
              </div>
              
              <div class="form-section">
                <h4>Authentication</h4>
                <div class="form-group">
                  <label for="auth-type">Authentication Type</label>
                  <select id="auth-type" onchange="mcpConfig.updateAuthFields()">
                    <option value="none" ${server.authentication?.type === 'none' ? 'selected' : ''}>None</option>
                    <option value="bearer" ${server.authentication?.type === 'bearer' ? 'selected' : ''}>Bearer Token</option>
                    <option value="api-key" ${server.authentication?.type === 'api-key' ? 'selected' : ''}>API Key</option>
                    <option value="basic" ${server.authentication?.type === 'basic' ? 'selected' : ''}>Basic Auth</option>
                  </select>
                </div>
                
                <div id="auth-fields">
                  ${this.renderAuthFields(server.authentication)}
                </div>
              </div>
              
              <div class="form-section">
                <h4>Settings</h4>
                <div class="form-row">
                  <div class="form-group">
                    <label for="timeout">Timeout (ms)</label>
                    <input type="number" id="timeout" value="${server.settings?.timeout || 30000}" min="1000" max="120000">
                  </div>
                  <div class="form-group">
                    <label for="retry-attempts">Retry Attempts</label>
                    <input type="number" id="retry-attempts" value="${server.settings?.retryAttempts || 3}" min="0" max="10">
                  </div>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="enabled-in-chat" ${server.settings?.enabledInChat ? 'checked' : ''}>
                    Enable in Chat
                  </label>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="enabled-in-embed" ${server.settings?.enabledInEmbed ? 'checked' : ''}>
                    Enable in Embed Widget
                  </label>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="server-enabled" ${server.enabled ? 'checked' : ''}>
                    Server Enabled
                  </label>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="yolo-mode" ${server.settings?.yoloMode ? 'checked' : ''}>
                    YOLO Mode (Auto-Approve All Tool Executions)
                  </label>
                  <small class="text-muted">⚠️ Warning: This will automatically approve all MCP tool executions without prompting. Use with caution.</small>
                </div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="mcpConfig.testConnectionDialog()">
              Test Connection
            </button>
            <button type="button" class="btn btn-secondary" onclick="mcpConfig.discoverTools()">
              Discover Tools
            </button>
            <button type="button" class="btn btn-secondary" onclick="mcpConfig.closeServerDialog()">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" onclick="mcpConfig.saveServer()">
              ${isEditing ? 'Update' : 'Add'} Server
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dialogHtml);
  }

  renderAuthFields(auth) {
    const authType = auth?.type || 'none';
    const credentials = auth?.credentials || {};
    
    switch (authType) {
      case 'bearer':
        return `
          <div class="form-group">
            <label for="bearer-token">Bearer Token</label>
            <input type="password" id="bearer-token" value="${credentials.token || ''}" 
                   placeholder="your-bearer-token">
          </div>
        `;
      case 'api-key':
        return `
          <div class="form-group">
            <label for="api-key">API Key</label>
            <input type="password" id="api-key" value="${credentials.apiKey || ''}" 
                   placeholder="your-api-key">
          </div>
        `;
      case 'basic':
        return `
          <div class="form-row">
            <div class="form-group">
              <label for="basic-username">Username</label>
              <input type="text" id="basic-username" value="${credentials.username || ''}" 
                     placeholder="username">
            </div>
            <div class="form-group">
              <label for="basic-password">Password</label>
              <input type="password" id="basic-password" value="${credentials.password || ''}" 
                     placeholder="password">
            </div>
          </div>
        `;
      default:
        return '<div class="auth-none">No authentication required.</div>';
    }
  }

  updateAuthFields() {
    const authType = document.getElementById('auth-type').value;
    const authFieldsContainer = document.getElementById('auth-fields');
    
    authFieldsContainer.innerHTML = this.renderAuthFields({ type: authType, credentials: {} });
  }

  async testConnectionDialog() {
    const serverData = this.getServerDataFromForm();
    if (!serverData) return;
    
    try {
      const response = await fetch(`../api/mcp/servers/${serverData.id}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'test',
          ...serverData
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.showSuccess(`Connection successful! Latency: ${result.latency}ms`);
      } else {
        this.showError(`Connection failed: ${result.message}`);
      }
    } catch (error) {
      console.error('[MCP Config] Test connection error:', error);
      this.showError('Failed to test connection');
    }
  }

  async discoverTools() {
    const serverData = this.getServerDataFromForm();
    if (!serverData) return;
    
    try {
      const response = await fetch(`../api/mcp/servers/${serverData.id}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'discover',
          ...serverData
        }),
      });
      
      const result = await response.json();
      
      if (result.success && result.tools) {
        this.showSuccess(`Discovered ${result.tools.length} tools: ${result.tools.map(t => t.name || t.id).join(', ')}`);
      } else {
        this.showError(`Tool discovery failed: ${result.message}`);
      }
    } catch (error) {
      console.error('[MCP Config] Discover tools error:', error);
      this.showError('Failed to discover tools');
    }
  }

  getServerDataFromForm() {
    const form = document.getElementById('server-form');
    if (!form) return null;
    
    const authType = document.getElementById('auth-type').value;
    const credentials = {};
    
    if (authType === 'bearer') {
      credentials.token = document.getElementById('bearer-token').value;
    } else if (authType === 'api-key') {
      credentials.apiKey = document.getElementById('api-key').value;
    } else if (authType === 'basic') {
      credentials.username = document.getElementById('basic-username').value;
      credentials.password = document.getElementById('basic-password').value;
    }
    
    return {
      id: document.getElementById('server-id').value,
      name: document.getElementById('server-name').value,
      description: document.getElementById('server-description').value,
      endpoint: document.getElementById('server-endpoint').value,
      type: document.getElementById('server-type').value,
      authentication: {
        type: authType,
        credentials
      },
      settings: {
        timeout: parseInt(document.getElementById('timeout').value),
        retryAttempts: parseInt(document.getElementById('retry-attempts').value),
        enabledInChat: document.getElementById('enabled-in-chat').checked,
        enabledInEmbed: document.getElementById('enabled-in-embed').checked,
        yoloMode: document.getElementById('yolo-mode').checked
      },
      enabled: document.getElementById('server-enabled').checked
    };
  }

  async saveServer() {
    const serverData = this.getServerDataFromForm();
    if (!serverData) return;
    
    // Basic validation
    if (!serverData.id || !serverData.name || !serverData.endpoint) {
      this.showError('Please fill in all required fields');
      return;
    }
    
    try {
      const isEditing = !!this.currentEditingServer;
      const url = isEditing ? `../api/mcp/servers/${serverData.id}` : '../api/mcp/servers';
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serverData),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        this.showSuccess(result.message || 'Server saved successfully');
        this.closeServerDialog();
        await this.loadServers();
        this.renderServerList();
        // Update stats after saving
        if (typeof updateMcpStats === 'function') {
          updateMcpStats();
        }
      } else {
        this.showError(result.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('[MCP Config] Save server error:', error);
      this.showError('Failed to save server');
    }
  }

  closeServerDialog() {
    const overlay = document.getElementById('server-dialog-overlay');
    if (overlay) {
      overlay.remove();
    }
    this.currentEditingServer = null;
  }

  async deleteServer(serverId) {
    if (!confirm('Are you sure you want to delete this server? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(`../api/mcp/servers/${serverId}`, {
        method: 'DELETE',
      });
      
      const result = await response.json();
      
      if (response.ok) {
        this.showSuccess('Server deleted successfully');
        await this.loadServers();
        this.renderServerList();
        // Update stats after deletion
        if (typeof updateMcpStats === 'function') {
          updateMcpStats();
        }
      } else {
        this.showError(result.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('[MCP Config] Delete server error:', error);
      this.showError('Failed to delete server');
    }
  }

  async testConnection(serverId) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) return;
    
    try {
      const response = await fetch(`../api/mcp/servers/${serverId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'test' }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.showSuccess(`Connection to ${server.name} successful! Latency: ${result.latency}ms`);
      } else {
        this.showError(`Connection to ${server.name} failed: ${result.message}`);
      }
    } catch (error) {
      console.error('[MCP Config] Test connection error:', error);
      this.showError('Failed to test connection');
    }
  }

  async configureBuiltinServer(serverId) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      this.showError('Built-in server not found');
      return;
    }
    
    this.showBuiltinServerDialog(serverId, server);
  }

  showBuiltinServerDialog(serverId, server) {
    const serverConfig = {
      zapier: {
        title: 'Configure Zapier MCP Server',
        description: 'Configure Zapier integration for Gmail, Calendar, and productivity tools',
        envVar: 'MCP_ZAPIER_ENDPOINT',
        placeholder: 'https://your-zapier-mcp-server.com',
        defaultEndpoint: 'https://zapier-mcp.example.com'
      }
    };

    const config = serverConfig[serverId];
    if (!config) {
      this.showError('Unknown built-in server');
      return;
    }

    const currentEndpoint = server.endpoint !== config.defaultEndpoint ? server.endpoint : '';

    const dialogHtml = `
      <div class="modal-overlay" id="builtin-server-dialog-overlay">
        <div class="modal-dialog">
          <div class="modal-header">
            <h2>${config.title}</h2>
            <button class="modal-close" onclick="mcpConfig.closeBuiltinServerDialog()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="builtin-server-config">
              <div class="config-description">
                <p>${config.description}</p>
                <div class="env-var-info">
                  <strong>Environment Variable:</strong> <code>${config.envVar}</code>
                </div>
              </div>
              
              <form id="builtin-server-form">
                <div class="form-group">
                  <label for="builtin-endpoint">Server Endpoint URL</label>
                  <input type="url" id="builtin-endpoint" value="${currentEndpoint}" 
                         placeholder="${config.placeholder}" required>
                  <small>Enter the URL of your ${serverId} MCP server endpoint</small>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="builtin-enabled" ${server.enabled ? 'checked' : ''}>
                    Enable ${server.name}
                  </label>
                  <small>When enabled, this server will be available in chat and other integrations</small>
                </div>

                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="builtin-chat-enabled" ${server.settings?.enabledInChat ? 'checked' : ''}>
                    Enable in Chat
                  </label>
                </div>

                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="builtin-embed-enabled" ${server.settings?.enabledInEmbed ? 'checked' : ''}>
                    Enable in Embed Widget
                  </label>
                </div>
                
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="builtin-yolo-mode" ${server.settings?.yoloMode ? 'checked' : ''}>
                    YOLO Mode (Auto-Approve All Tool Executions)
                  </label>
                  <small class="text-muted">⚠️ Warning: This will automatically approve all MCP tool executions without prompting. Use with caution.</small>
                </div>
              </form>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="mcpConfig.testBuiltinConnection('${serverId}')">
              Test Connection
            </button>
            <button type="button" class="btn btn-secondary" onclick="mcpConfig.closeBuiltinServerDialog()">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" onclick="mcpConfig.saveBuiltinServer('${serverId}')">
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dialogHtml);
  }

  async saveBuiltinServer(serverId) {
    const endpoint = document.getElementById('builtin-endpoint').value;
    const enabled = document.getElementById('builtin-enabled').checked;
    const chatEnabled = document.getElementById('builtin-chat-enabled').checked;
    const embedEnabled = document.getElementById('builtin-embed-enabled').checked;
    const yoloMode = document.getElementById('builtin-yolo-mode').checked;

    if (!endpoint.trim()) {
      this.showError('Please enter a valid endpoint URL');
      return;
    }

    try {
      const envVarMap = {
        zapier: 'MCP_ZAPIER_ENDPOINT'
      };

      const envVar = envVarMap[serverId];
      if (!envVar) {
        this.showError('Unknown server type');
        return;
      }

      // Save to environment via config API
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [envVar]: enabled ? endpoint : '',
          [`${envVar}_CHAT_ENABLED`]: chatEnabled,
          [`${envVar}_EMBED_ENABLED`]: embedEnabled,
          NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED: yoloMode
        }),
      });

      if (response.ok) {
        this.showSuccess(`${serverId} MCP server configured successfully!`);
        this.closeBuiltinServerDialog();
        
        // Reload servers to reflect changes
        setTimeout(() => {
          this.loadServers();
          this.renderServerList();
        }, 1000);
      } else {
        throw new Error('Failed to save configuration');
      }
    } catch (error) {
      console.error('[MCP Config] Save builtin server error:', error);
      this.showError('Failed to save configuration');
    }
  }

  async testBuiltinConnection(serverId) {
    const endpoint = document.getElementById('builtin-endpoint').value;
    
    if (!endpoint.trim()) {
      this.showError('Please enter an endpoint URL first');
      return;
    }

    try {
      const response = await fetch(`../api/mcp/servers/${serverId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'test',
          endpoint: endpoint,
          type: 'http'
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.showSuccess(`Connection successful! Latency: ${result.latency}ms`);
      } else {
        this.showError(`Connection failed: ${result.message}`);
      }
    } catch (error) {
      console.error('[MCP Config] Test builtin connection error:', error);
      this.showError('Failed to test connection');
    }
  }

  closeBuiltinServerDialog() {
    const overlay = document.getElementById('builtin-server-dialog-overlay');
    if (overlay) {
      overlay.remove();
    }
  }

  updateLoadingState() {
    const container = document.getElementById('mcp-servers-list');
    if (!container) return;
    
    if (this.isLoading) {
      container.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading MCP servers...</p>
        </div>
      `;
    }
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showInfo(message) {
    this.showNotification(message, 'info');
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <span class="notification-message">${message}</span>
      <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    // Add to page
    const container = document.getElementById('notification-container') || document.body;
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  attachEventListeners() {
    // Handle escape key to close dialog
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeServerDialog();
      }
    });
  }
}

// Initialize the MCP config manager when the page loads
let mcpConfig;
document.addEventListener('DOMContentLoaded', () => {
  mcpConfig = new McpConfigManager();
});

// Export for use in HTML onclick handlers
window.mcpConfig = mcpConfig; 