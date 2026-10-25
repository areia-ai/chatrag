/**
 * Folder Picker Modal for Config UI
 * 
 * Provides folder selection UI for Google Drive, Dropbox, and similar providers.
 * Features:
 * - Hierarchical folder tree
 * - Expand/collapse folders
 * - Single or multi folder selection (configurable)
 * - Search/filter functionality
 */

class FolderPickerModal extends Modal {
    constructor(provider, connectionId, options = {}) {
        super({
            id: `folder-picker-${provider}`,
            title: `Select Folder${options.multiSelect ? 's' : ''} - ${provider}`,
            size: 'lg',
            closeOnEscape: true,
            closeOnBackdrop: true,
        });

        this.provider = provider;
        this.connectionId = connectionId;
        this.multiSelect = options.multiSelect || false; // Enable multi-select mode
        this.folders = [];
        this.expandedFolders = new Set();
        this.selectedFolder = null; // For single-select backwards compatibility
        this.selectedFolders = new Set(); // For multi-select mode
        this.onSelectCallback = null;
        this.resolvePromise = null; // Store the promise resolver
    }

    /**
     * Open the folder picker
     * @param {Function} onSelect - Callback function when folder is selected
     * @returns {Promise} Resolves when picker is closed
     */
    openPicker(onSelect) {
        return new Promise((resolve) => {
            this.resolvePromise = resolve; // Store the resolver for later

            this.onSelectCallback = (folderId, folderName, folderPath) => {
                // Call the original callback
                if (onSelect) {
                    onSelect(folderId, folderName, folderPath);
                }
            };

            // Create initial loading content
            const loadingContent = `
      <div class="flex flex-col items-center justify-center py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="mt-4 text-base-content/70">Loading folders...</p>
      </div>
    `;

            this.open(loadingContent);

            // Fetch folders
            this.fetchFolders()
                .then(() => {
                    this.renderFolderTree();
                })
                .catch((error) => {
                    console.error('[FolderPicker] Failed to load folders:', error);
                    this.showError(`Failed to load folders: ${error.message}`);
                });
        });
    }

    /**
     * Fetch folders from API
     */
    async fetchFolders() {
        try {
            const response = await fetch(`/api/nango/folders?provider=${this.provider}`);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch folders');
            }

            const data = await response.json();
            this.folders = data.folders || [];

            console.log(`[FolderPicker] Loaded ${this.folders.length} folders for ${this.provider}`);
        } catch (error) {
            console.error('[FolderPicker] Fetch error:', error);
            throw error;
        }
    }

    /**
     * Render the folder tree
     */
    renderFolderTree() {
        const selectionCount = this.multiSelect ? this.selectedFolders.size : (this.selectedFolder ? 1 : 0);
        const selectionText = this.multiSelect
            ? `${selectionCount} folder${selectionCount !== 1 ? 's' : ''} selected`
            : (this.selectedFolder?.name || 'No folder selected');

        const content = `
      <div class="space-y-4">
        <!-- Search box -->
        <div class="form-control">
          <input
            type="text"
            placeholder="Search folders..."
            class="input input-bordered w-full"
            id="folder-search-${this.provider}"
          />
        </div>

        <!-- Folder tree -->
        <div class="border border-base-300 rounded-lg max-h-96 overflow-y-auto p-2" id="folder-tree-container-${this.provider}">
          ${this.renderFolderNodes(this.folders)}
        </div>

        <!-- Selected folder display -->
        <div class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
          <span class="text-sm text-base-content/70">
            ${selectionText}
          </span>
          ${selectionCount > 0 && this.multiSelect ? `
            <button
              class="btn btn-xs btn-ghost"
              id="clear-selection-btn-${this.provider}"
            >
              Clear Selection
            </button>
          ` : ''}
        </div>

        <!-- Action buttons -->
        <div class="flex justify-end gap-2 pt-4 border-t border-base-300">
          <button
            class="btn btn-ghost"
            id="folder-cancel-btn-${this.provider}"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            id="folder-select-btn-${this.provider}"
            ${selectionCount === 0 ? 'disabled' : ''}
          >
            Select ${this.multiSelect && selectionCount > 0 ? `${selectionCount} Folder${selectionCount > 1 ? 's' : ''}` : 'Folder'}
          </button>
        </div>
      </div>
    `;

        this.updateContent(content);

        // Store reference globally so event listeners can access it
        window[`folderPicker_${this.provider}`] = this;

        // Attach event listeners using event delegation
        this.attachEventListeners();
    }

    /**
     * Attach event listeners using event delegation
     */
    attachEventListeners() {
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (!modalContent) return;

        // Search input listener
        const searchInput = modalContent.querySelector(`#folder-search-${this.provider}`);
        if (searchInput) {
            searchInput.addEventListener('keyup', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Tree container - event delegation for folder actions
        const treeContainer = modalContent.querySelector(`#folder-tree-container-${this.provider}`);
        if (treeContainer) {
            treeContainer.addEventListener('click', (e) => {
                // Check if clicked on expand/collapse button
                const expandBtn = e.target.closest('[data-action="expand-folder"]');
                if (expandBtn) {
                    e.stopPropagation();
                    const folderId = expandBtn.dataset.folderId;
                    if (folderId) this.toggleFolder(folderId);
                    return;
                }

                // Check if clicked on folder selection
                const folderDiv = e.target.closest('[data-folder-id]');
                if (folderDiv) {
                    const folderId = folderDiv.dataset.folderId;
                    const folderName = folderDiv.dataset.folderName;
                    const folderPath = folderDiv.dataset.folderPath;
                    if (folderId) this.selectFolder(folderId, folderName, folderPath);
                    return;
                }
            });
        }

        // Clear selection button (for multi-select)
        const clearBtn = modalContent.querySelector(`#clear-selection-btn-${this.provider}`);
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSelection());
        }

        // Button listeners
        const selectBtn = modalContent.querySelector(`#folder-select-btn-${this.provider}`);
        const cancelBtn = modalContent.querySelector(`#folder-cancel-btn-${this.provider}`);

        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.confirmSelection());
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancel());
        }
    }

    /**
     * Render folder nodes recursively
     */
    renderFolderNodes(folders, level = 0) {
        if (!folders || folders.length === 0) {
            return '<p class="text-sm text-base-content/50 p-4">No folders found</p>';
        }

        return folders.map(folder => {
            const hasChildren = folder.children && folder.children.length > 0;
            const isExpanded = this.expandedFolders.has(folder.id);
            // Support both single and multi-select
            const isSelected = this.multiSelect
                ? this.selectedFolders.has(folder.id)
                : this.selectedFolder?.id === folder.id;

            return `
        <div class="folder-node" style="margin-left: ${level * 16}px;">
          <div class="flex items-center gap-2 py-1 px-2 rounded hover:bg-base-200 cursor-pointer ${isSelected ? 'bg-primary/20 ring-1 ring-primary' : ''}">
            ${hasChildren ? `
              <button
                class="btn btn-xs btn-ghost p-0 w-6 h-6 cursor-pointer"
                data-action="expand-folder"
                data-folder-id="${this.escapeHtml(folder.id)}"
              >
                ${isExpanded ? '▼' : '▶'}
              </button>
            ` : '<span class="w-6"></span>'}
            
            <div
              class="flex-1 flex items-center gap-2 cursor-pointer"
              data-folder-id="${this.escapeHtml(folder.id)}"
              data-folder-name="${this.escapeHtml(folder.name)}"
              data-folder-path="${this.escapeHtml(folder.path || '')}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span class="text-sm">${this.escapeHtml(folder.name)}</span>
            </div>
            
            <!-- Selected indicator -->
            ${isSelected ? `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            ` : ''}
          </div>
          
          ${hasChildren && isExpanded ? `
            <div class="folder-children">
              ${this.renderFolderNodes(folder.children, level + 1)}
            </div>
          ` : ''}
        </div>
      `;
        }).join('');
    }

    /**
     * Toggle folder expand/collapse
     */
    toggleFolder(folderId) {
        if (this.expandedFolders.has(folderId)) {
            this.expandedFolders.delete(folderId);
        } else {
            this.expandedFolders.add(folderId);
        }
        // Only update the tree, not the entire modal
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (modalContent) {
            const treeContainer = modalContent.querySelector('.border');
            if (treeContainer) {
                treeContainer.innerHTML = this.renderFolderNodes(this.folders);
            }
        }
        // Re-establish global reference
        window[`folderPicker_${this.provider}`] = this;
    }

    /**
     * Select a folder (toggle in multi-select mode)
     */
    selectFolder(folderId, folderName, folderPath) {
        if (this.multiSelect) {
            // Toggle selection in multi-select mode
            if (this.selectedFolders.has(folderId)) {
                this.selectedFolders.delete(folderId);
            } else {
                this.selectedFolders.add(folderId);
            }
            // Store folder metadata for later retrieval
            if (!this.folderMetadata) this.folderMetadata = new Map();
            this.folderMetadata.set(folderId, { id: folderId, name: folderName, path: folderPath });
        } else {
            // Single selection mode
            this.selectedFolder = { id: folderId, name: folderName, path: folderPath };
        }

        // Update UI
        this.updateSelectionUI();
    }

    /**
     * Clear all selections (multi-select mode)
     */
    clearSelection() {
        this.selectedFolders.clear();
        this.selectedFolder = null;
        this.updateSelectionUI();
    }

    /**
     * Update selection UI without full re-render
     */
    updateSelectionUI() {
        // Find the modal content container
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (!modalContent) {
            console.warn('[FolderPicker] Modal content not found');
            return;
        }

        // Re-render the entire tree view since we changed the display logic
        this.renderFolderTree();
    }

    /**
     * Confirm folder selection
     */
    confirmSelection() {
        if (this.multiSelect) {
            // Multi-select mode
            if (this.selectedFolders.size === 0) return;

            const folderIds = Array.from(this.selectedFolders);
            const folderNames = folderIds.map(id => this.folderMetadata?.get(id)?.name || 'Unknown');
            const folderPaths = folderIds.map(id => this.folderMetadata?.get(id)?.path || '');

            if (this.onSelectCallback) {
                this.onSelectCallback(folderIds, folderNames, folderPaths);
            }
        } else {
            // Single-select mode (backwards compatibility)
            if (!this.selectedFolder) return;

            if (this.onSelectCallback) {
                this.onSelectCallback(
                    this.selectedFolder.id,
                    this.selectedFolder.name,
                    this.selectedFolder.path
                );
            }
        }

        this.close();

        // Resolve the promise after close
        if (this.resolvePromise) {
            setTimeout(() => this.resolvePromise(), 200); // Wait for close animation
        }
    }

    /**
     * Cancel selection
     */
    cancel() {
        this.close();

        // Resolve the promise after close (cancel doesn't call callback)
        if (this.resolvePromise) {
            setTimeout(() => this.resolvePromise(), 200); // Wait for close animation
        }
    }

    /**
     * Handle search
     */
    handleSearch(query) {
        const normalizedQuery = query.toLowerCase().trim();

        let foldersToDraw = this.folders;

        if (normalizedQuery) {
            // Filter folders by name
            const filterFolders = (folders) => {
                return folders
                    .map(folder => {
                        const matchesQuery = folder.name.toLowerCase().includes(normalizedQuery);
                        const filteredChildren = folder.children ? filterFolders(folder.children) : [];

                        // Include folder if it matches OR has matching children
                        if (matchesQuery || filteredChildren.length > 0) {
                            return {
                                ...folder,
                                children: filteredChildren,
                            };
                        }
                        return null;
                    })
                    .filter(Boolean);
            };

            foldersToDraw = filterFolders(this.folders);

            // Expand all folders when searching
            const expandAll = (folders) => {
                folders.forEach(folder => {
                    this.expandedFolders.add(folder.id);
                    if (folder.children) expandAll(folder.children);
                });
            };
            expandAll(foldersToDraw);
        }

        // Update tree container
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (modalContent) {
            const treeContainer = modalContent.querySelector('.border');
            if (treeContainer) {
                treeContainer.innerHTML = this.renderFolderNodes(foldersToDraw);
            }
        }

        // Re-establish global reference
        window[`folderPicker_${this.provider}`] = this;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Clean up when modal is destroyed
     */
    destroy() {
        // Remove global reference
        delete window[`folderPicker_${this.provider}`];
        super.destroy();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FolderPickerModal;
}
