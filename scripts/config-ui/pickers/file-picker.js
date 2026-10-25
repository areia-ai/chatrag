/**
 * File Picker Modal for Config UI
 * 
 * Provides file selection UI for Google Drive, Dropbox, and similar providers.
 * Features:
 * - Multi-select file selection with checkboxes
 * - File type icons (PDF, DOCX, images, etc.)
 * - Search/filter functionality
 * - Select All / Deselect All
 * - File metadata display (size, modified date)
 */

class FilePickerModal extends Modal {
    constructor(provider, connectionId, folderId = null) {
        super({
            id: `file-picker-${provider}`,
            title: `Select Files - ${provider}`,
            size: 'lg',
            closeOnEscape: true,
            closeOnBackdrop: true,
        });

        this.provider = provider;
        this.connectionId = connectionId;
        this.folderId = folderId; // Optional: filter files by folder
        this.files = [];
        this.selectedFiles = new Set(); // Store file IDs
        this.onSelectCallback = null;
        this.resolvePromise = null; // Store the promise resolver
    }

    /**
     * Open the file picker
     * @param {Function} onSelect - Callback function when files are selected
     * @returns {Promise} Resolves when picker is closed
     */
    openPicker(onSelect) {
        return new Promise((resolve) => {
            this.resolvePromise = resolve; // Store the resolver for later
            
            this.onSelectCallback = (fileIds, fileNames) => {
                // Call the original callback
                if (onSelect) {
                    onSelect(fileIds, fileNames);
                }
            };

            // Create initial loading content
            const loadingContent = `
       <div class="flex flex-col items-center justify-center py-12">
         <span class="loading loading-spinner loading-lg text-primary"></span>
         <p class="mt-4 text-base-content/70">Loading files...</p>
       </div>
     `;

            this.open(loadingContent);

            // Fetch files
            this.fetchFiles()
                .then(() => {
                    this.renderFileList();
                })
                .catch((error) => {
                    console.error('[FilePicker] Failed to load files:', error);
                    this.showError(`Failed to load files: ${error.message}`);
                });
        });
    }

    /**
     * Fetch files from API
     */
    async fetchFiles() {
        try {
            let url = `/api/nango/files?provider=${this.provider}`;
            if (this.folderId) {
                url += `&folderId=${this.folderId}`;
            }

            console.log(`[FilePicker] Fetching from: ${url}`);
            const response = await fetch(url);

            console.log(`[FilePicker] Response status: ${response.status}`);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch files');
            }

            const data = await response.json();
            this.files = data.files || [];

            console.log(`[FilePicker] Raw response data:`, JSON.stringify(data).substring(0, 300));
            console.log(`[FilePicker] Loaded ${this.files.length} files for ${this.provider}`);
        } catch (error) {
            console.error('[FilePicker] Fetch error:', error);
            throw error;
        }
    }

    /**
     * Get file icon based on MIME type
     */
    getFileIcon(mimeType) {
        if (!mimeType) return '📄';

        if (mimeType.includes('pdf')) return '📕';
        if (mimeType.includes('image')) return '🖼️';
        if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
        if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
        if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
        if (mimeType.includes('text')) return '📄';
        if (mimeType.includes('video')) return '🎥';
        if (mimeType.includes('audio')) return '🎵';
        if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';

        return '📄';
    }

    /**
     * Format file size
     */
    formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Format date
     */
    formatDate(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return '';
        }
    }

    /**
     * Render the file list
     */
    renderFileList() {
        const content = `
      <div class="space-y-4">
        <!-- Search box -->
        <div class="form-control">
          <input
            type="text"
            placeholder="Search files..."
            class="input input-bordered w-full"
            id="file-search-${this.provider}"
          />
        </div>

        <!-- Selection controls -->
        <div class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
          <div class="flex items-center gap-2">
            <button
              class="btn btn-xs btn-ghost"
              id="select-all-btn-${this.provider}"
            >
              Select All
            </button>
            <button
              class="btn btn-xs btn-ghost"
              id="deselect-all-btn-${this.provider}"
            >
              Deselect All
            </button>
          </div>
          <span class="text-sm text-base-content/70">
            <span id="selected-count-${this.provider}">${this.selectedFiles.size}</span> / ${this.files.length} selected
          </span>
        </div>

        <!-- File list -->
        <div class="border border-base-300 rounded-lg max-h-96 overflow-y-auto" id="file-list-container-${this.provider}">
          ${this.renderFileItems(this.files)}
        </div>

        <!-- Action buttons -->
        <div class="flex justify-end gap-2 pt-4 border-t border-base-300">
          <button
            class="btn btn-ghost"
            id="file-cancel-btn-${this.provider}"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            id="file-select-btn-${this.provider}"
            ${this.selectedFiles.size === 0 ? 'disabled' : ''}
          >
            Select ${this.selectedFiles.size > 0 ? `${this.selectedFiles.size} File${this.selectedFiles.size > 1 ? 's' : ''}` : 'Files'}
          </button>
        </div>
      </div>
    `;

        this.updateContent(content);

        // Store reference globally so event listeners can access it
        window[`filePicker_${this.provider}`] = this;
        
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
        const searchInput = modalContent.querySelector(`#file-search-${this.provider}`);
        if (searchInput) {
            searchInput.addEventListener('keyup', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Select All / Deselect All buttons
        const selectAllBtn = modalContent.querySelector(`#select-all-btn-${this.provider}`);
        const deselectAllBtn = modalContent.querySelector(`#deselect-all-btn-${this.provider}`);

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => this.selectAll());
        }
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', () => this.deselectAll());
        }

        // File list container - event delegation for file selection
        const fileContainer = modalContent.querySelector(`#file-list-container-${this.provider}`);
        if (fileContainer) {
            fileContainer.addEventListener('click', (e) => {
                // Check if clicked on file row or checkbox
                const fileEl = e.target.closest('[data-file-id]');
                if (fileEl) {
                    const fileId = fileEl.dataset.fileId;
                    if (fileId) this.toggleFile(fileId);
                    return;
                }
            });
        }

        // Button listeners
        const selectBtn = modalContent.querySelector(`#file-select-btn-${this.provider}`);
        const cancelBtn = modalContent.querySelector(`#file-cancel-btn-${this.provider}`);

        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.confirmSelection());
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancel());
        }
    }

    /**
     * Render file items
     */
    renderFileItems(files) {
        if (!files || files.length === 0) {
            return '<p class="text-sm text-base-content/50 p-4">No files found</p>';
        }

        return files.map(file => {
            const isSelected = this.selectedFiles.has(file.id);
            const icon = this.getFileIcon(file.mimeType);
            const size = this.formatFileSize(file.size);
            const modifiedDate = this.formatDate(file.modifiedTime);

            return `
        <div
          class="flex items-center gap-3 p-3 hover:bg-base-200 cursor-pointer transition-colors ${isSelected ? 'bg-primary/20 ring-1 ring-primary' : ''}"
          data-file-id="${this.escapeHtml(file.id)}"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-primary"
            ${isSelected ? 'checked' : ''}
            onclick="event.stopPropagation()"
          />
          <span class="text-2xl">${icon}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">${this.escapeHtml(file.name)}</p>
            <div class="flex items-center gap-2 text-xs text-base-content/60">
              ${size ? `<span>${size}</span>` : ''}
              ${size && modifiedDate ? '<span>•</span>' : ''}
              ${modifiedDate ? `<span>Modified ${modifiedDate}</span>` : ''}
            </div>
          </div>
          ${isSelected ? `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          ` : ''}
        </div>
      `;
        }).join('');
    }

    /**
     * Toggle file selection
     */
    toggleFile(fileId) {
        if (this.selectedFiles.has(fileId)) {
            this.selectedFiles.delete(fileId);
        } else {
            this.selectedFiles.add(fileId);
        }

        // Update UI
        this.updateSelectionUI();
    }

    /**
     * Select all files
     */
    selectAll() {
        this.files.forEach(file => this.selectedFiles.add(file.id));
        this.updateSelectionUI();
    }

    /**
     * Deselect all files
     */
    deselectAll() {
        this.selectedFiles.clear();
        this.updateSelectionUI();
    }

    /**
     * Update selection UI without full re-render
     */
    updateSelectionUI() {
        // Find the modal content container
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (!modalContent) {
            console.warn('[FilePicker] Modal content not found');
            return;
        }

        // Update selected count
        const countEl = modalContent.querySelector(`#selected-count-${this.provider}`);
        if (countEl) {
            countEl.textContent = this.selectedFiles.size;
        }

        // Update select button
        const selectBtn = modalContent.querySelector(`#file-select-btn-${this.provider}`);
        if (selectBtn) {
            selectBtn.disabled = this.selectedFiles.size === 0;
            selectBtn.textContent = `Select ${this.selectedFiles.size > 0 ? `${this.selectedFiles.size} File${this.selectedFiles.size > 1 ? 's' : ''}` : 'Files'}`;
        }

        // Re-render file list to update checkboxes and styling
        const container = modalContent.querySelector(`#file-list-container-${this.provider}`);
        if (container) {
            container.innerHTML = this.renderFileItems(this.files);
        }

        // Re-establish global reference
        window[`filePicker_${this.provider}`] = this;
    }

    /**
     * Confirm file selection
     */
    confirmSelection() {
        if (this.selectedFiles.size === 0) return;

        const selectedFileObjects = this.files.filter(f => this.selectedFiles.has(f.id));
        const fileIds = selectedFileObjects.map(f => f.id);
        const fileNames = selectedFileObjects.map(f => f.name);

        if (this.onSelectCallback) {
            this.onSelectCallback(fileIds, fileNames);
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

        let filteredFiles;
        if (!normalizedQuery) {
            filteredFiles = this.files;
        } else {
            filteredFiles = this.files.filter(file =>
                file.name.toLowerCase().includes(normalizedQuery)
            );
        }

        // Update file list
        const modalContent = this.modalElement?.querySelector('.modal-content');
        if (modalContent) {
            const container = modalContent.querySelector(`#file-list-container-${this.provider}`);
            if (container) {
                container.innerHTML = this.renderFileItems(filteredFiles);
            }
        }

        // Re-establish global reference
        window[`filePicker_${this.provider}`] = this;
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
        delete window[`filePicker_${this.provider}`];
        super.destroy();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FilePickerModal;
}
