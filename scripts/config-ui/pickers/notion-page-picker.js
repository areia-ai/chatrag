/**
 * Notion Page Picker Modal for Config UI
 * 
 * Provides Notion page selection UI with two modes:
 * - Top-Level Mode: Select root pages (syncs page + all subpages)
 * - Subpages Mode: Select specific child pages (syncs only selected pages)
 * 
 * Features:
 * - Hierarchical page tree
 * - Expand/collapse pages
 * - Mode-dependent selection (root vs. child pages)
 * - Visual distinction between selectable and non-selectable pages
 * - Auto-expand in subpages mode
 */

class NotionPagePickerModal extends Modal {
    constructor(provider, connectionId, mode = 'top-level') {
        const modeTitle = mode === 'top-level' ? 'Top-Level Pages' : 'Subpages';
        super({
            id: `notion-page-picker-${mode}`,
            title: `Select ${modeTitle} - Notion`,
            size: 'lg',
            closeOnEscape: true,
            closeOnBackdrop: true,
        });

        this.provider = provider;
        this.connectionId = connectionId;
        this.mode = mode; // 'top-level' or 'subpages'
        this.pages = [];
        this.expandedPages = new Set();
        this.selectedPages = new Set(); // Store page IDs
        this.onSelectCallback = null;
        this.childrenCache = new Map(); // Cache loaded children
        this.resolvePromise = null; // Store the promise resolver
    }

    /**
     * Open the page picker
     * @param {Function} onSelect - Callback function when pages are selected
     * @returns {Promise} Resolves when picker is closed
     */
    openPicker(onSelect) {
        return new Promise((resolve) => {
            this.resolvePromise = resolve; // Store the resolver for later
            
            this.onSelectCallback = (pageIds, pageNames, mode) => {
                // Call the original callback
                if (onSelect) {
                    onSelect(pageIds, pageNames, mode);
                }
            };

            // Create initial loading content
            const loadingContent = `
      <div class="flex flex-col items-center justify-center py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="mt-4 text-base-content/70">Loading Notion pages...</p>
      </div>
    `;

            this.open(loadingContent);

            // Fetch pages
            this.fetchPages()
                .then(() => {
                    this.renderPageTree();
                })
                .catch((error) => {
                    console.error('[NotionPagePicker] Failed to load pages:', error);
                    this.showError(`Failed to load pages: ${error.message}`);
                });
        });
    }

    /**
     * Fetch pages from API based on mode
     */
    async fetchPages() {
        try {
            // Determine API mode based on picker mode
            // - top-level: fetch root pages only (lazy load children)
            // - subpages: fetch full tree (all pages with children pre-loaded)
            const apiMode = this.mode === 'top-level' ? 'root' : 'tree';
            const url = `/api/nango/notion/pages?mode=${apiMode}`;

            const response = await fetch(url);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch pages');
            }

            const data = await response.json();
            this.pages = data.pages || [];

            console.log(`[NotionPagePicker] Loaded ${this.pages.length} pages in ${this.mode} mode`);

            // Auto-expand all pages in subpages mode
            if (this.mode === 'subpages') {
                this.autoExpandAll(this.pages);
            }
        } catch (error) {
            console.error('[NotionPagePicker] Fetch error:', error);
            throw error;
        }
    }

    /**
     * Auto-expand all pages with children (for subpages mode)
     */
    autoExpandAll(pages) {
        pages.forEach(page => {
            if (page.hasChildren) {
                this.expandedPages.add(page.id);
            }
            if (page.children && page.children.length > 0) {
                this.autoExpandAll(page.children);
            }
        });
    }

    /**
     * Fetch children for a specific page (lazy loading for top-level mode)
     */
    async fetchChildren(pageId) {
        try {
            const url = `/api/nango/notion/pages?mode=children&parentId=${pageId}`;
            const response = await fetch(url);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch child pages');
            }

            const data = await response.json();
            const children = data.pages || [];

            console.log(`[NotionPagePicker] Loaded ${children.length} children for page ${pageId}`);
            return children;
        } catch (error) {
            console.error('[NotionPagePicker] Failed to fetch children:', error);
            return [];
        }
    }

    /**
     * Render the page tree
     */
    renderPageTree() {
        const modeDescription = this.mode === 'top-level'
            ? 'Select a top-level page to sync it and all its subpages.'
            : 'Select specific subpages to sync. Root pages cannot be selected in this mode.';

        const content = `
      <div class="space-y-4">
        <!-- Mode description -->
        <div class="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span class="text-sm">${modeDescription}</span>
        </div>

        <!-- Selection info -->
        <div class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
          <span class="text-sm text-base-content/70">
            <span id="selected-count-${this.mode}">${this.selectedPages.size}</span> page${this.selectedPages.size !== 1 ? 's' : ''} selected
          </span>
          ${this.selectedPages.size > 0 ? `
            <button
              class="btn btn-xs btn-ghost"
              id="clear-selection-btn-${this.mode}"
            >
              Clear Selection
            </button>
          ` : ''}
        </div>

        <!-- Page tree -->
        <div class="border border-base-300 rounded-lg max-h-96 overflow-y-auto" id="page-tree-container-${this.mode}">
          ${this.renderPageNodes(this.pages, 0)}
        </div>

        <!-- Action buttons -->
        <div class="flex justify-end gap-2 pt-4 border-t border-base-300">
          <button
            class="btn btn-ghost"
            id="page-cancel-btn-${this.mode}"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            id="page-select-btn-${this.mode}"
            ${this.selectedPages.size === 0 ? 'disabled' : ''}
          >
            Select ${this.selectedPages.size > 0 ? `${this.selectedPages.size} Page${this.selectedPages.size > 1 ? 's' : ''}` : 'Pages'}
          </button>
        </div>
      </div>
    `;

        this.updateContent(content);

        // Store reference globally so event listeners can access it
        window[`notionPagePicker_${this.mode}`] = this;
        
        // Attach event listeners using event delegation
        this.attachEventListeners();
    }

    /**
     * Attach event listeners using event delegation
     */
    attachEventListeners() {
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (!modalContent) return;

        // Page tree container - event delegation for page actions
        const treeContainer = modalContent.querySelector(`#page-tree-container-${this.mode}`);
        if (treeContainer) {
            treeContainer.addEventListener('click', (e) => {
                // Check if clicked on expand/collapse button
                const expandBtn = e.target.closest('[data-action="expand-page"]');
                if (expandBtn) {
                    e.stopPropagation();
                    const pageId = expandBtn.dataset.pageId;
                    if (pageId) this.toggleExpand(pageId);
                    return;
                }

                // Check if clicked on page selection
                const pageDiv = e.target.closest('[data-page-id]');
                if (pageDiv && pageDiv.dataset.isSelectable === 'true') {
                    const pageId = pageDiv.dataset.pageId;
                    const pageName = pageDiv.dataset.pageName;
                    if (pageId) this.togglePage(pageId, pageName);
                    return;
                }
            });
        }

        // Clear Selection button
        const clearBtn = modalContent.querySelector(`#clear-selection-btn-${this.mode}`);
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSelection());
        }

        // Button listeners
        const selectBtn = modalContent.querySelector(`#page-select-btn-${this.mode}`);
        const cancelBtn = modalContent.querySelector(`#page-cancel-btn-${this.mode}`);

        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.confirmSelection());
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancel());
        }
    }

    /**
     * Render page nodes recursively
     */
    renderPageNodes(pages, level = 0) {
        if (!pages || pages.length === 0) {
            return '<p class="text-sm text-base-content/50 p-4">No pages found</p>';
        }

        return pages.map(page => {
            const hasChildren = page.hasChildren || (page.children && page.children.length > 0);
            const isExpanded = this.expandedPages.has(page.id);
            const isSelected = this.selectedPages.has(page.id);

            // Determine if page is selectable based on mode and level
            // Top-level mode: only root pages (level 0) are selectable
            // Subpages mode: only child pages (level > 0) are selectable
            const isSelectable = this.mode === 'top-level' ? level === 0 : level > 0;

            // Get cached children if available
            const children = page.children || this.childrenCache.get(page.id) || [];

            return `
            <div class="page-node">
            <div 
            class="flex items-center gap-2 py-2 px-2 rounded-md transition-colors ${isSelectable ? 'cursor-pointer hover:bg-base-200' : 'cursor-default opacity-50'
                } ${isSelected ? 'bg-primary/20 ring-1 ring-primary' : ''}"
            style="padding-left: ${level * 16 + 8}px;"
            data-page-id="${this.escapeHtml(page.id)}"
            data-page-name="${this.escapeHtml(page.name)}"
            data-is-selectable="${isSelectable}"
            >
            <!-- Expand/collapse button -->
            <div
              class="w-5 h-5 flex items-center justify-center rounded hover:bg-base-300 flex-shrink-0 cursor-pointer ${!hasChildren ? 'invisible' : ''}"
              data-action="expand-page"
              data-page-id="${this.escapeHtml(page.id)}"
            >
              ${hasChildren ? (isExpanded ? '▼' : '▶') : ''}
            </div>

            <!-- Page icon -->
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0 ${isSelectable ? 'text-base-content/70' : 'text-base-content/30'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>

            <!-- Page name -->
            <span class="text-sm truncate flex-1 select-none ${isSelectable ? 'text-base-content' : 'text-base-content/40'}">
              ${this.escapeHtml(page.name)}
            </span>

            <!-- Selected indicator -->
            ${isSelected ? `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            ` : ''}
          </div>

          <!-- Children -->
          ${isExpanded && children.length > 0 ? `
            <div class="page-children">
              ${this.renderPageNodes(children, level + 1)}
            </div>
          ` : ''}
        </div>
      `;
        }).join('');
    }

    /**
     * Toggle page selection
     */
    togglePage(pageId, pageName) {
        if (this.selectedPages.has(pageId)) {
            this.selectedPages.delete(pageId);
        } else {
            this.selectedPages.add(pageId);
        }

        // Update UI
        this.updateSelectionUI();
    }

    /**
     * Toggle page expand/collapse
     */
    async toggleExpand(pageId) {
        if (this.expandedPages.has(pageId)) {
            this.expandedPages.delete(pageId);
        } else {
            this.expandedPages.add(pageId);

            // If in top-level mode and children not loaded, fetch them
            if (this.mode === 'top-level' && !this.childrenCache.has(pageId)) {
                const page = this.findPageById(this.pages, pageId);
                if (page && page.hasChildren && !page.children) {
                    // Show loading indicator
                    const container = document.getElementById(`page-tree-container-${this.mode}`);
                    if (container) {
                        const loadingMsg = document.createElement('div');
                        loadingMsg.className = 'text-sm text-base-content/50 p-2';
                        loadingMsg.textContent = 'Loading children...';
                        loadingMsg.id = `loading-${pageId}`;
                        container.appendChild(loadingMsg);
                    }

                    // Fetch children
                    const children = await this.fetchChildren(pageId);
                    this.childrenCache.set(pageId, children);

                    // Remove loading message
                    const loadingMsg = document.getElementById(`loading-${pageId}`);
                    if (loadingMsg) loadingMsg.remove();
                }
            }
        }

        // Update UI without full re-render
        this.updateSelectionUI();
    }

    /**
     * Find a page by ID in the tree
     */
    findPageById(pages, pageId) {
        for (const page of pages) {
            if (page.id === pageId) return page;
            if (page.children) {
                const found = this.findPageById(page.children, pageId);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedPages.clear();
        this.updateSelectionUI();
    }

    /**
     * Update selection UI without full re-render
     */
    updateSelectionUI() {
        // Find the modal content container
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (!modalContent) {
            console.warn('[NotionPagePicker] Modal content not found');
            return;
        }

        // Update selected count
        const countEl = modalContent.querySelector(`#selected-count-${this.mode}`);
        if (countEl) {
            countEl.textContent = this.selectedPages.size;
        }

        // Update select button
        const selectBtn = modalContent.querySelector(`#page-select-btn-${this.mode}`);
        if (selectBtn) {
            selectBtn.disabled = this.selectedPages.size === 0;
            selectBtn.textContent = `Select ${this.selectedPages.size > 0 ? `${this.selectedPages.size} Page${this.selectedPages.size > 1 ? 's' : ''}` : 'Pages'}`;
        }

        // Re-render tree to update selection styling
        const container = modalContent.querySelector(`#page-tree-container-${this.mode}`);
        if (container) {
            container.innerHTML = this.renderPageNodes(this.pages, 0);
        }

        // Re-establish global reference
        window[`notionPagePicker_${this.mode}`] = this;
    }

    /**
     * Confirm page selection
     */
    confirmSelection() {
        if (this.selectedPages.size === 0) return;

        // Get selected page names
        const pageIds = Array.from(this.selectedPages);
        const pageNames = pageIds.map(id => {
            const page = this.findPageById(this.pages, id);
            return page ? page.name : 'Unknown';
        });

        if (this.onSelectCallback) {
            this.onSelectCallback(pageIds, pageNames, this.mode);
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
        delete window[`notionPagePicker_${this.mode}`];
        super.destroy();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotionPagePickerModal;
}
