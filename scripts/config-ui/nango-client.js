/**
 * Nango Client Wrapper for Config UI
 * 
 * Provides a vanilla JavaScript wrapper around the Nango SDK for OAuth connections,
 * connection management, and document syncing.
 * Uses Connect Sessions (recommended by Nango) instead of public keys.
 */

class NangoClientWrapper {
    constructor() {
        this.nango = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the Nango client (SDK check only)
     * Actual session creation happens per provider during connect()
     */
    async init() {
        try {
            console.log('[Nango] Initializing Nango SDK...');

            // Wait for Nango SDK to load via ES module
            if (typeof window.Nango === 'undefined') {
                // Wait for the nango-ready event if not already loaded
                if (!window.nangoReady) {
                    console.log('[Nango] Waiting for ES module to load...');
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Nango SDK load timeout'));
                        }, 10000); // 10 second timeout

                        window.addEventListener('nango-ready', () => {
                            clearTimeout(timeout);
                            resolve();
                        }, { once: true });
                    });
                }
            }

            if (typeof window.Nango === 'undefined') {
                throw new Error('Nango SDK not loaded. Check network connectivity.');
            }

            // SDK is loaded, we'll create session tokens per provider
            this.isInitialized = true;
            console.log('[Nango] Nango SDK ready (session tokens created per provider)');
            return true;
        } catch (error) {
            console.error('[Nango] Initialization failed:', error);
            this.isInitialized = false;
            throw error;
        }
    }

    /**
     * Create a connect session for a specific provider
     * @private
     */
    async _createConnectSession(provider) {
        try {
            const sessionResponse = await fetch('/api/nango/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer admin'
                },
                body: JSON.stringify({ provider }),
            });

            if (!sessionResponse.ok) {
                const errorData = await sessionResponse.json();
                throw new Error(errorData.error || `Failed to create session for ${provider}`);
            }

            const sessionData = await sessionResponse.json();
            return sessionData.connectSessionToken;
        } catch (error) {
            console.error(`[Nango] Failed to create session for ${provider}:`, error);
            throw error;
        }
    }

    /**
     * Check if Nango client is initialized
     */
    checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('Nango client not initialized. Call init() first.');
        }
    }

    /**
     * Connect to a provider via OAuth using Nango Connect UI
     * @param {string} provider - Provider name (e.g., 'google-drive', 'notion', 'dropbox')
     * @returns {Promise<object>} Connection data from successful OAuth flow
     */
    async connect(provider) {
        this.checkInitialized();

        try {
            console.log(`[Nango] Starting OAuth flow for ${provider}`);

            // Step 1: Create connect session via backend API
            const connectSessionToken = await this._createConnectSession(provider);

            // Step 2: Initialize Nango with this session token
            const nango = new window.Nango({ connectSessionToken });

            // Step 3: Open Connect UI with event-based callbacks (per Nango docs)
            console.log(`[Nango] Opening Connect UI for ${provider}`);

            return new Promise((resolve, reject) => {
                const connectUI = nango.openConnectUI({
                    onEvent: (event) => {
                        console.log(`[Nango] Connect UI event:`, event);

                        if (event.type === 'close') {
                            // Modal was closed without completing
                            console.log('[Nango] Connect UI closed');
                            reject(new Error('OAuth flow was cancelled'));
                        } else if (event.type === 'connect') {
                            // Connection successful!
                            const connectionId = event.payload?.connectionId || event.connectionId;
                            console.log(`[Nango] OAuth successful. Connection ID: ${connectionId}`);

                            // Register the connection in our database
                            this._registerConnection(provider, connectionId)
                                .then(() => {
                                    console.log(`[Nango] Connection registered in database`);
                                    resolve({
                                        connectionId,
                                        provider,
                                    });
                                })
                                .catch((err) => {
                                    console.error(`[Nango] Failed to register connection:`, err);
                                    // Still resolve since OAuth succeeded
                                    resolve({
                                        connectionId,
                                        provider,
                                    });
                                });
                        }
                    },
                });

                // Set the session token (required per docs)
                connectUI.setSessionToken(connectSessionToken);
            });

        } catch (error) {
            console.error(`[Nango] Connection failed for ${provider}:`, error);
            throw error;
        }
    }

    /**
     * Register a connection in our database after successful OAuth
     * @private
     */
    async _registerConnection(provider, connectionId) {
        const response = await fetch('/api/nango/connections', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer admin'
            },
            body: JSON.stringify({ provider, connectionId }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to register connection');
        }

        return response.json();
    }

    /**
     * Disconnect from a provider
     * @param {string} provider - Provider name
     */
    async disconnect(provider) {
        try {
            console.log(`[Nango] Disconnecting ${provider}`);

            const response = await fetch('/api/nango/connections', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer admin'
                },
                body: JSON.stringify({ provider }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to disconnect');
            }

            console.log(`[Nango] Disconnected from ${provider}`);
            return true;
        } catch (error) {
            console.error(`[Nango] Disconnect failed for ${provider}:`, error);
            throw error;
        }
    }

    /**
     * Trigger document sync for a provider
     * @param {string} provider - Provider name
     * @param {string} connectionId - Connection ID
     * @returns {Promise<Object>} Sync statistics
     */
    async sync(provider, connectionId) {
        try {
            console.log(`[Nango] Starting sync for ${provider}`);

            const response = await fetch('/api/nango/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer admin'
                },
                body: JSON.stringify({ provider, connectionId }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Sync failed');
            }

            const stats = await response.json();
            console.log(`[Nango] Sync completed:`, stats);

            return stats;
        } catch (error) {
            console.error(`[Nango] Sync failed for ${provider}:`, error);
            throw error;
        }
    }

    /**
     * Get list of user's connections
     * @returns {Promise<Array>} Array of connection records
     */
    async getConnections() {
        try {
            const response = await fetch('/api/nango/connections', {
                headers: { 'Authorization': 'Bearer admin' }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch connections');
            }

            const data = await response.json();
            return data.connections || [];
        } catch (error) {
            console.error('[Nango] Failed to fetch connections:', error);
            throw error;
        }
    }

    /**
     * Update connection settings (folder, files, etc.)
     * @param {string} provider - Provider name
     * @param {Object} settings - Settings to update
     */
    async updateConnection(provider, settings) {
        try {
            const response = await fetch('/api/nango/connections', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer admin'
                },
                body: JSON.stringify({
                    provider,
                    ...settings,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update connection');
            }

            return await response.json();
        } catch (error) {
            console.error('[Nango] Failed to update connection:', error);
            throw error;
        }
    }
}

// Create singleton instance
const nangoClient = new NangoClientWrapper();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        nangoClient.init().catch(err => {
            console.error('[Nango] Auto-initialization failed:', err);
        });
    });
} else {
    nangoClient.init().catch(err => {
        console.error('[Nango] Auto-initialization failed:', err);
    });
}
