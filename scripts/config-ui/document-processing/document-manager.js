/**
 * Document Manager for handling document list and operations
 * Supports multi-tenant mode with workspace filtering
 */
class DocumentManager {
    constructor() {
        this.documents = [];
        this.filteredDocuments = [];
        this.searchQuery = '';
        this.isLoading = false;
        this.isRendering = false;
        this.rerenderTimeout = null;

        // Multi-tenant workspace context
        this.currentOrganizationId = null; // null = flat personal workspace

        // DOM elements
        this.elements = {
            container: null,
            loading: null,
            emptyState: null,
            tableContainer: null,
            tableBody: null,
            searchInput: null,
            refreshBtn: null,
            workspaceSelector: null
        };
    }

    init() {
        console.log('DocumentManager: Initializing...');

        this.cacheElements();
        if (!this.elements.container) {
            console.error('DocumentManager: Container element not found!');
            return;
        }

        // Set up mutation observer to catch any unwanted changes
        this.setupMutationObserver();

        this.attachEventListeners();

        // Sync with existing workspace selection (from document processor)
        if (this.elements.workspaceSelector) {
            this.currentOrganizationId = this.elements.workspaceSelector.value || null;
            console.log('DocumentManager: Initial workspace:', this.currentOrganizationId || 'Default Workspace');
        }

        // Also sync with document processor's workspace state if available
        if (window.documentProcessor && window.documentProcessor.workspaces) {
            this.currentOrganizationId = window.documentProcessor.workspaces.currentSelection || null;
            console.log('DocumentManager: Synced with document processor workspace:', this.currentOrganizationId || 'Default Workspace');
        }

        this.loadDocuments();
    }

    setupMutationObserver() {
        // DISABLED: Mutation observer was causing infinite loops
        // The root cause needs to be fixed in the table rendering itself
        console.log('DocumentManager: Mutation observer disabled to prevent infinite loops');
        return;

        // Original code commented out to prevent loops
        /*
        if (!this.elements.container) return;
        
        const observer = new MutationObserver((mutations) => {
            // Don't trigger re-renders if we're currently rendering or loading
            if (this.isLoading || this.isRendering) {
                return;
            }
            
            let shouldRerender = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    // Check for added nodes - only care about non-standard elements
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // Element node
                            // Check if this is a simple list element
                            const nodeText = node.textContent || '';
                            const isSimpleList = (
                                node.id !== 'documents-loading' && 
                                node.id !== 'documents-empty-state' && 
                                node.id !== 'documents-table-container' &&
                                // Only consider it a simple list if it contains document-like text
                                (nodeText.includes('Unknown size') || 
                                 nodeText.includes('Document Name') ||
                                 (nodeText.includes('.pdf') && !node.closest('table')) ||
                                 (nodeText.includes('.txt') && !node.closest('table')) ||
                                 (nodeText.includes('.doc') && !node.closest('table')))
                            );
                            
                            if (isSimpleList) {
                                console.warn('DocumentManager: Detected and removing simple list element:', node);
                                node.remove();
                                shouldRerender = true;
                            }
                        }
                    });
                    
                    // Only check for removed table rows if we have documents and we're not currently rendering
                    if (this.filteredDocuments && this.filteredDocuments.length > 0 && !this.isRendering) {
                        mutation.removedNodes.forEach(node => {
                            // Only care about removed TR elements that were in our table body
                            if (node.nodeType === 1 && 
                                node.tagName === 'TR' && 
                                mutation.target === this.elements.tableBody) {
                                console.warn('DocumentManager: Table row was removed from table body');
                                shouldRerender = true;
                            }
                        });
                    }
                }
                
                // Also check for attribute changes that might hide our table
                if (mutation.type === 'attributes' && 
                    mutation.target === this.elements.tableContainer &&
                    this.filteredDocuments && this.filteredDocuments.length > 0 && 
                    !this.isLoading && !this.isRendering) {
                    // Force table to be visible if it was hidden
                    if (this.elements.tableContainer.classList.contains('hidden') || 
                        this.elements.tableContainer.style.display === 'none') {
                        console.warn('DocumentManager: Table was hidden, making it visible again');
                        this.elements.tableContainer.classList.remove('hidden');
                        this.elements.tableContainer.style.display = 'block';
                    }
                }
                
                // Check if table body was cleared but we have documents to show
                if (mutation.target === this.elements.tableBody && 
                    mutation.type === 'childList' && 
                    this.elements.tableBody.children.length === 0 && 
                    this.filteredDocuments && this.filteredDocuments.length > 0 &&
                    !this.isLoading && !this.isRendering) {
                    console.warn('DocumentManager: Table body was cleared but we have documents');
                    shouldRerender = true;
                }
            });
            
            // Re-render if needed, but with a delay to avoid loops and debouncing
            if (shouldRerender && this.documents && this.documents.length > 0 && !this.isLoading && !this.isRendering) {
                console.log('DocumentManager: Scheduling re-render after DOM mutation');
                clearTimeout(this.rerenderTimeout);
                this.rerenderTimeout = setTimeout(() => {
                    // Double-check we still need to render and we're not in a render cycle
                    if (!this.isRendering && !this.isLoading) {
                        console.log('DocumentManager: Executing scheduled re-render');
                        this.renderDocuments();
                    }
                }, 500); // Longer delay to avoid loops
            }
        });
        
        observer.observe(this.elements.container, { 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        */
    }

    cacheElements() {
        this.elements.container = document.getElementById('document-management-container');
        this.elements.loading = document.getElementById('documents-loading');
        this.elements.emptyState = document.getElementById('documents-empty-state');
        this.elements.tableContainer = document.getElementById('documents-table-container');
        this.elements.tableBody = document.getElementById('documents-table-body');
        this.elements.searchInput = document.getElementById('document-search');
        this.elements.refreshBtn = document.getElementById('refresh-documents-btn');
        this.elements.workspaceSelector = document.getElementById('workspace-selector');
    }

    attachEventListeners() {
        // Search functionality
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterDocuments();
            });
        }

        // Refresh button
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', () => {
                this.loadDocuments();
            });
        }

        // Workspace selector - reload documents when workspace changes
        if (this.elements.workspaceSelector) {
            this.elements.workspaceSelector.addEventListener('change', (e) => {
                this.currentOrganizationId = e.target.value || null;
                console.log('DocumentManager: Workspace changed to:', this.currentOrganizationId || 'Default Workspace');
                this.loadDocuments();
            });
        }
    }

    // Method to set workspace externally (from document processor)
    setWorkspace(organizationId) {
        this.currentOrganizationId = organizationId || null;
        console.log('DocumentManager: Workspace set to:', this.currentOrganizationId || 'Default Workspace');
        this.loadDocuments();
    }

    async readResponseError(response) {
        const fallback = `Failed to load documents: ${response.status} ${response.statusText}`;
        const responseText = await response.text().catch(() => '');

        if (!responseText) {
            return fallback;
        }

        try {
            const data = JSON.parse(responseText);
            return data.error || data.details || data.message || fallback;
        } catch (_) {
            return responseText || fallback;
        }
    }

    getMainAppUrl() {
        if (window.getConfiguredChatRagAppUrl) {
            return window.getConfiguredChatRagAppUrl();
        }

        const configuredUrl =
            document.getElementById('CHATRAG_APP_URL')?.value ||
            document.getElementById('NEXT_PUBLIC_SITE_URL')?.value;

        if (configuredUrl && configuredUrl.trim()) {
            return configuredUrl.trim().replace(/\/+$/, '');
        }

        if (window.location.port === '3333') {
            return `${window.location.protocol}//${window.location.hostname}:3000`;
        }

        return window.location.origin;
    }

    async loadDocuments() {
        if (this.isLoading) return;

        this.isLoading = true;
        this.showLoading();

        try {
            // Build URL with organization_id for multi-tenant filtering
            let url = '/api/documents';
            if (this.currentOrganizationId !== null) {
                url += `?organization_id=${encodeURIComponent(this.currentOrganizationId)}`;
            }
            // If currentOrganizationId is null, we're in flat personal workspace mode
            // The API will filter by user_id only (no org_id)

            console.log('DocumentManager: Fetching documents from:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin' // Include cookies for auth
            });

            if (!response.ok) {
                let errorMessage = await this.readResponseError(response);

                if (response.status === 401) {
                    errorMessage += `. In multi-tenant mode, sign in to the main ChatRAG app at ${this.getMainAppUrl()} in this browser, then refresh this dashboard.`;
                }

                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log('DocumentManager: API Response:', data);

            // Handle both possible response formats
            this.documents = data.documents || data || [];
            if (!Array.isArray(this.documents)) {
                this.documents = [];
            }
            // Always set filteredDocuments to a fresh copy
            this.filteredDocuments = [...this.documents];
            this.isLoading = false;
            // Always force a full re-render after loading
            this.renderDocuments();
        } catch (error) {
            console.error('DocumentManager: Error loading documents:', error);
            this.isLoading = false;
            this.showError(error.message || 'Failed to load documents');
        }
    }

    filterDocuments() {
        if (!this.searchQuery) {
            this.filteredDocuments = [...this.documents];
        } else {
            this.filteredDocuments = this.documents.filter(doc =>
                doc.filename.toLowerCase().includes(this.searchQuery)
            );
        }
        this.renderDocuments();
    }

    renderDocuments() {
        console.log('DocumentManager: Rendering', this.filteredDocuments.length, 'documents');

        // Defensive: If table body exists and has only one column, force a full re-render
        if (this.elements.tableBody && this.elements.tableBody.children.length > 0) {
            const firstRow = this.elements.tableBody.children[0];
            if (firstRow && firstRow.children.length === 1) {
                console.warn('DocumentManager: Detected simple list view, forcing full re-render');
                this.elements.tableBody.innerHTML = '';
            }
        }

        // Set rendering flag to prevent mutation observer interference
        this.isRendering = true;

        // Hide loading state
        this.hideLoading();

        if (this.filteredDocuments.length === 0) {
            this.showEmptyState();
            this.isRendering = false;
            return;
        }

        // Show the table
        this.showTable();

        if (!this.elements.tableBody) {
            console.error('DocumentManager: Table body not found!');
            this.isRendering = false;
            return;
        }

        // Always clear existing content
        this.elements.tableBody.innerHTML = '';

        // Sort documents by upload date (newest first)
        const sortedDocs = [...this.filteredDocuments].sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        // Render each document
        sortedDocs.forEach(doc => {
            const row = this.createDocumentRow(doc);
            this.elements.tableBody.appendChild(row);
        });

        console.log('DocumentManager: Rendered', sortedDocs.length, 'document rows');

        // Clear rendering flag
        this.isRendering = false;

        // Force table to be visible with aggressive CSS
        this.forceTableDisplay();

        // Force cleanup after a short delay to catch any late DOM modifications
        setTimeout(() => {
            if (!this.isRendering) {
                this.cleanupContainer();
            }
        }, 100);

        // And again after a longer delay to be extra sure
        setTimeout(() => {
            if (!this.isRendering) {
                this.cleanupContainer();
            }
        }, 500);
    }

    createDocumentRow(doc) {
        const row = document.createElement('tr');
        row.className = 'hover';

        // Format date
        let uploadDate = 'Unknown date';
        if (doc.created_at) {
            try {
                uploadDate = new Date(doc.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {
                console.error('Error formatting date:', e);
            }
        }

        // Get status styling
        const statusClass = this.getStatusClass(doc.status);
        const statusText = this.getStatusText(doc.status);

        // Get URL status
        const hasUrl = doc.metadata?.external_url;
        const urlButtonText = hasUrl ? '🔗 Edit URL' : '🔗 + URL';
        const urlButtonClass = hasUrl ? 'btn-outline btn-warning' : 'btn-outline';
        const sourceBadge = doc.source_provider === 'firecrawl'
            ? `<div class="badge badge-outline badge-xs mt-1" title="${this.escapeHtml(doc.source_file_id || '')}">Firecrawl</div>`
            : '';

        row.innerHTML = `
            <td class="w-2/5 min-w-0">
                <div class="font-medium truncate whitespace-nowrap overflow-hidden">${this.escapeHtml(doc.filename)}</div>
                <div class="text-xs text-base-content/50">${this.formatFileSize(doc.size)}</div>
                ${sourceBadge}
            </td>
            <td class="w-1/6 text-center text-sm">${uploadDate}</td>
            <td class="w-1/6 text-center">
                <div class="badge ${statusClass} badge-sm">${statusText}</div>
            </td>
            <td class="w-1/12 text-center">${doc.chunk_count}</td>
            <td class="w-1/6 text-center">
                <button class="btn ${urlButtonClass} btn-sm mr-2" onclick="window.documentManager.addUrl('${doc.id}', '${this.escapeHtml(doc.metadata?.external_url || '').replace(/'/g, "\\'")}')">
                    ${urlButtonText}
                </button>
                <button class="btn btn-error btn-sm" onclick="window.documentManager.confirmDelete('${doc.id}', '${this.escapeHtml(doc.filename).replace(/'/g, "\\'")}')">
                    🗑️ Delete
                </button>
            </td>
        `;

        return row;
    }

    getStatusClass(status) {
        switch (status) {
            case 'ready':
                return 'badge-success';
            case 'processing':
                return 'badge-warning';
            case 'failed':
                return 'badge-error';
            case 'partial':
                return 'badge-info';
            default:
                return 'badge-ghost';
        }
    }

    getStatusText(status) {
        switch (status) {
            case 'ready':
                return '✅ Ready';
            case 'processing':
                return '⏳ Processing';
            case 'failed':
                return '❌ Failed';
            case 'partial':
                return '⚠️ Partial';
            default:
                return status || 'Unknown';
        }
    }

    confirmDelete(docId, docName) {
        const modal = document.createElement('div');
        modal.className = 'modal modal-open';
        modal.innerHTML = `
            <div class="modal-box">
                <h3 class="font-bold text-lg">Delete Document</h3>
                <p class="py-4">Are you sure you want to delete "${docName}"? This action cannot be undone and will remove all associated chunks from the vector database.</p>
                <div class="modal-action">
                    <button class="btn btn-ghost" onclick="this.closest('.modal').remove()">Cancel</button>
                    <button class="btn btn-error" onclick="window.documentManager.deleteDocument('${docId}'); this.closest('.modal').remove();">
                        Delete
                    </button>
                </div>
            </div>
            <div class="modal-backdrop" onclick="this.closest('.modal').remove()"></div>
        `;
        document.body.appendChild(modal);
    }

    async deleteDocument(docId) {
        try {
            const response = await fetch(`/api/documents/${docId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete document');
            }

            // Remove from local array
            this.documents = this.documents.filter(doc => doc.id !== docId);
            this.filterDocuments();
            this.renderDocuments();

            this.showToast('Document deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting document:', error);
            this.showToast('Failed to delete document', 'error');
        }
    }

    // URL management methods
    async addUrl(docId, currentUrl) {
        const url = prompt(
            currentUrl ? 'Edit document URL:' : 'Add document URL:',
            currentUrl
        );

        if (url === null) {
            // User cancelled
            return;
        }

        // Validate URL if not empty
        if (url.trim() !== '') {
            try {
                new URL(url.trim());
            } catch (e) {
                alert('Please enter a valid URL (must start with http:// or https://)');
                return;
            }
        }

        await this.saveUrl(docId, url.trim());
    }

    async saveUrl(docId, url) {
        try {
            const response = await fetch(`/api/documents/${docId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ external_url: url }),
            });

            if (!response.ok) {
                throw new Error('Failed to update document URL');
            }

            // Update local document
            const doc = this.documents.find(d => d.id === docId);
            if (doc) {
                if (!doc.metadata) {
                    doc.metadata = {};
                }
                doc.metadata.external_url = url;
            }

            // Re-render to show updated button state
            this.renderDocuments();

            this.showToast('Document URL updated successfully', 'success');
        } catch (error) {
            console.error('Error updating document URL:', error);
            this.showToast('Failed to update document URL', 'error');
        }
    }

    showLoading() {
        if (this.elements.loading) {
            this.elements.loading.classList.remove('hidden');
        }
        if (this.elements.emptyState) {
            this.elements.emptyState.classList.add('hidden');
        }
        if (this.elements.tableContainer) {
            this.elements.tableContainer.classList.add('hidden');
        }
    }

    hideLoading() {
        if (this.elements.loading) {
            this.elements.loading.classList.add('hidden');
        }
    }

    showEmptyState() {
        if (this.elements.emptyState) {
            this.elements.emptyState.classList.remove('hidden');
        }
        if (this.elements.tableContainer) {
            this.elements.tableContainer.classList.add('hidden');
        }
    }

    showTable() {
        console.log('DocumentManager: Showing table');

        // First, remove any non-standard content from the container
        if (this.elements.container) {
            const children = Array.from(this.elements.container.children);
            children.forEach(child => {
                // Remove any element that's not one of our known elements
                if (child.id !== 'documents-loading' &&
                    child.id !== 'documents-empty-state' &&
                    child.id !== 'documents-table-container') {
                    console.warn('DocumentManager: Removing unexpected element:', child);
                    child.remove();
                }
            });
        }

        if (this.elements.emptyState) {
            this.elements.emptyState.classList.add('hidden');
        }
        if (this.elements.loading) {
            this.elements.loading.classList.add('hidden');
        }
        if (this.elements.tableContainer) {
            // Remove hidden class and ensure table is visible
            this.elements.tableContainer.classList.remove('hidden');
            this.elements.tableContainer.style.display = 'block';
            console.log('DocumentManager: Table container is now visible');
        }
    }

    showError(message) {
        this.hideLoading();
        this.showEmptyState();

        if (this.elements.emptyState) {
            const safeMessage = this.escapeHtml(String(message));
            this.elements.emptyState.innerHTML = `
                <div class="text-4xl mb-4">❌</div>
                <p class="text-base-content/70 mb-2">${safeMessage}</p>
                <button class="btn btn-sm btn-primary mt-2" onclick="window.documentManager.loadDocuments()">
                    Try Again
                </button>
            `;
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `alert alert-${type} fixed bottom-4 right-4 w-auto max-w-sm z-50`;
        toast.innerHTML = `<span>${message}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Method to refresh documents after upload
    refresh() {
        this.loadDocuments();
    }

    // Force the table view to be shown (public method)
    forceTableView() {
        console.log('DocumentManager: Forcing table view');

        // Remove any simple list elements
        this.cleanupContainer();

        // If we have documents, re-render the table
        if (this.documents.length > 0) {
            this.filteredDocuments = [...this.documents];
            this.renderDocuments();
        }
    }

    cleanupContainer() {
        if (!this.elements.container) return;

        console.log('DocumentManager: Running container cleanup');

        // Find and remove any simple list elements
        const children = Array.from(this.elements.container.children);
        children.forEach(child => {
            // Keep only our known elements
            if (child.id !== 'documents-loading' &&
                child.id !== 'documents-empty-state' &&
                child.id !== 'documents-table-container') {
                console.warn('DocumentManager: Removing unexpected element during cleanup:', child);
                child.remove();
            }
        });

        // Force table to be visible with aggressive CSS
        if (this.filteredDocuments && this.filteredDocuments.length > 0) {
            this.forceTableDisplay();
        }
    }

    // Aggressive method to force table display
    forceTableDisplay() {
        const tableContainer = this.elements.tableContainer;
        const tableBody = this.elements.tableBody;

        if (!tableContainer || !tableBody) return;

        console.log('DocumentManager: Forcing table display with aggressive CSS');

        // Apply aggressive CSS to ensure table is visible
        tableContainer.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            top: auto !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            width: auto !important;
            height: auto !important;
            overflow: visible !important;
            z-index: auto !important;
        `;

        // Remove any hiding classes
        tableContainer.classList.remove('hidden', 'invisible', 'opacity-0');
        tableContainer.classList.add('block');

        // Ensure the table itself is properly styled
        const table = tableContainer.querySelector('table');
        if (table) {
            table.style.cssText = `
                display: table !important;
                visibility: visible !important;
                opacity: 1 !important;
                width: 100% !important;
            `;
        }

        // Force table body to be visible
        tableBody.style.cssText = `
            display: table-row-group !important;
            visibility: visible !important;
            opacity: 1 !important;
        `;

        // Force all table rows to be visible
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            row.style.cssText = `
                display: table-row !important;
                visibility: visible !important;
                opacity: 1 !important;
            `;
        });

        console.log('DocumentManager: Forced table display applied to', rows.length, 'rows');
    }

    debugDOMState() {
        console.log('DocumentManager: Current DOM State');
        console.log('Container exists:', !!this.elements.container);
        console.log('Loading element:', this.elements.loading ?
            `exists, hidden=${this.elements.loading.classList.contains('hidden')}` : 'missing');
        console.log('Empty state element:', this.elements.emptyState ?
            `exists, hidden=${this.elements.emptyState.classList.contains('hidden')}` : 'missing');
        console.log('Table container:', this.elements.tableContainer ?
            `exists, hidden=${this.elements.tableContainer.classList.contains('hidden')}, display=${this.elements.tableContainer.style.display}` : 'missing');
        console.log('Table body:', this.elements.tableBody ?
            `exists, rows=${this.elements.tableBody.children.length}` : 'missing');

        // Log all children of the container
        if (this.elements.container) {
            console.log('Container children:');
            Array.from(this.elements.container.children).forEach((child, index) => {
                console.log(`  Child ${index}: tag=${child.tagName}, id="${child.id}", class="${child.className}", text preview="${(child.textContent || '').substring(0, 50)}..."`);
            });
        }

        console.log('Documents count:', this.documents.length);
        console.log('Filtered documents count:', this.filteredDocuments.length);
    }

    // Diagnostic method to check why documents aren't showing
    diagnoseTableIssue() {
        console.log('🔍 Diagnosing Document Table Issue');
        console.log('=================================');

        // Check documents
        console.log('Documents loaded:', this.documents.length);
        console.log('Filtered documents:', this.filteredDocuments.length);
        console.log('Is loading:', this.isLoading);

        // Check DOM elements
        console.log('\nDOM Elements:');
        console.log('Table container exists:', !!this.elements.tableContainer);
        console.log('Table body exists:', !!this.elements.tableBody);

        if (this.elements.tableContainer) {
            console.log('Table container visible:', !this.elements.tableContainer.classList.contains('hidden'));
            console.log('Table container display:', this.elements.tableContainer.style.display);
        }

        if (this.elements.tableBody) {
            console.log('Table body rows:', this.elements.tableBody.children.length);
            console.log('Table body HTML preview:', this.elements.tableBody.innerHTML.substring(0, 200) + '...');
        }

        // Try to manually render one document
        if (this.documents.length > 0) {
            console.log('\nTrying to manually render first document:');
            const firstDoc = this.documents[0];
            console.log('First document:', firstDoc);
            const row = this.createDocumentRow(firstDoc);
            console.log('Created row:', row);
            console.log('Row HTML:', row.outerHTML);
        }

        // Check if something is clearing the table
        console.log('\nChecking for interference...');
        this.testTablePersistence();
    }

    // Test if table rows persist after being added
    testTablePersistence() {
        if (!this.elements.tableBody || this.documents.length === 0) {
            console.log('Cannot test persistence - no table body or documents');
            return;
        }

        // Add a test row
        const testRow = document.createElement('tr');
        testRow.innerHTML = '<td colspan="5" style="background: yellow;">TEST ROW - This should stay visible</td>';
        testRow.id = 'test-persistence-row';
        this.elements.tableBody.appendChild(testRow);

        console.log('Added test row to table body');

        // Check if it's still there after a delay
        setTimeout(() => {
            const stillThere = document.getElementById('test-persistence-row');
            if (stillThere) {
                console.log('✅ Test row persisted - table is working');
                stillThere.remove();
                // If test row persists, try rendering documents again
                console.log('Re-rendering documents...');
                this.renderDocuments();
            } else {
                console.log('❌ Test row was removed - something is clearing the table!');
            }
        }, 1000);
    }

    // Manual fix method that can be called from console
    emergencyTableFix() {
        console.log('🚨 DocumentManager: Emergency table fix activated');

        // Stop any ongoing operations
        this.isLoading = false;
        this.isRendering = false;

        // Clear any timeouts
        if (this.rerenderTimeout) {
            clearTimeout(this.rerenderTimeout);
            this.rerenderTimeout = null;
        }

        // Force aggressive table display
        this.forceTableDisplay();

        // Force cleanup
        this.cleanupContainer();

        // If no documents are showing, try to reload them
        if (!this.documents || this.documents.length === 0) {
            console.log('🔄 No documents found, reloading...');
            this.loadDocuments();
        } else {
            console.log('✅ Emergency fix applied to', this.documents.length, 'documents');
        }
    }
}

// Create global instance
window.documentManager = new DocumentManager();

console.log('Document Manager loaded');
