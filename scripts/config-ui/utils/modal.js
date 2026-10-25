/**
 * Base Modal Class for Config UI
 * 
 * Provides a reusable modal system with:
 * - Show/hide animations
 * - Focus trap
 * - Keyboard navigation (ESC to close)
 * - Click outside to close
 */

class Modal {
    constructor(options = {}) {
        this.id = options.id || `modal-${Date.now()}`;
        this.title = options.title || '';
        this.size = options.size || 'lg'; // sm, md, lg, xl
        this.closeOnEscape = options.closeOnEscape !== false;
        this.closeOnBackdrop = options.closeOnBackdrop !== false;
        this.onClose = options.onClose || null;

        this.modalElement = null;
        this.isOpen = false;
        this.previouslyFocusedElement = null;
    }

    /**
     * Create the modal DOM structure
     * @param {string} content - HTML content for modal body
     * @returns {HTMLElement} Modal element
     */
    createModal(content) {
        const sizeClasses = {
            sm: 'max-w-sm',
            md: 'max-w-md',
            lg: 'max-w-2xl',
            xl: 'max-w-4xl',
        };

        const modal = document.createElement('div');
        modal.id = this.id;
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', `${this.id}-title`);

        modal.innerHTML = `
      <div class="modal-box ${sizeClasses[this.size]} max-h-[90vh] overflow-hidden flex flex-col">
        ${this.title ? `
          <div class="flex items-center justify-between mb-4 pb-4 border-b border-base-300">
            <h3 id="${this.id}-title" class="text-lg font-bold">${this.title}</h3>
            <button 
              class="btn btn-sm btn-circle btn-ghost"
              aria-label="Close modal"
              data-modal-close
            >
              ✕
            </button>
          </div>
        ` : ''}
        <div class="modal-content overflow-y-auto flex-1">
          ${content}
        </div>
      </div>
      <div class="modal-backdrop" data-modal-backdrop></div>
    `;

        this.modalElement = modal;
        this.setupEventListeners();

        return modal;
    }

    /**
     * Set up event listeners for modal interactions
     */
    setupEventListeners() {
        if (!this.modalElement) return;

        // Close button
        const closeBtn = this.modalElement.querySelector('[data-modal-close]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Click outside (backdrop)
        if (this.closeOnBackdrop) {
            const backdrop = this.modalElement.querySelector('[data-modal-backdrop]');
            if (backdrop) {
                backdrop.addEventListener('click', () => this.close());
            }
        }

        // Escape key
        if (this.closeOnEscape) {
            this.handleEscape = (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            };
            document.addEventListener('keydown', this.handleEscape);
        }

        // Phase 7: Focus trap - cycle focus within modal on Tab key
        this.handleTabKey = (e) => {
            if (!this.isOpen || e.key !== 'Tab') return;

            const focusableElements = this.modalElement.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );

            if (focusableElements.length === 0) return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;

            // Shift+Tab - move focus backward
            if (e.shiftKey) {
                if (activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } 
            // Tab - move focus forward
            else {
                if (activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };
        document.addEventListener('keydown', this.handleTabKey);
    }

    /**
     * Open the modal
     * @param {string} content - HTML content for modal body (optional, uses existing if not provided)
     */
    open(content) {
        // Store currently focused element to restore later
        this.previouslyFocusedElement = document.activeElement;

        // Create or update modal
        if (content) {
            if (this.modalElement && document.body.contains(this.modalElement)) {
                // Update existing modal content
                const contentContainer = this.modalElement.querySelector('.modal-content');
                if (contentContainer) {
                    contentContainer.innerHTML = content;
                }
            } else {
                // Create new modal
                this.createModal(content);
                document.body.appendChild(this.modalElement);
            }
        } else if (!this.modalElement) {
            console.error('[Modal] No content provided and modal not created');
            return;
        }

        // Open modal with animation
        this.modalElement.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;

        // Focus trap
        this.focusFirstElement();
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.isOpen || !this.modalElement) return;

        // Close modal
        this.modalElement.classList.remove('modal-open');
        document.body.style.overflow = '';
        this.isOpen = false;

        // Restore focus
        if (this.previouslyFocusedElement) {
            this.previouslyFocusedElement.focus();
        }

        // Call onClose callback
        if (this.onClose) {
            this.onClose();
        }

        // Clean up after animation
        setTimeout(() => {
            if (this.modalElement && document.body.contains(this.modalElement)) {
                document.body.removeChild(this.modalElement);
            }
        }, 200);
    }

    /**
     * Focus the first focusable element in the modal
     */
    focusFirstElement() {
        if (!this.modalElement) return;

        const focusableElements = this.modalElement.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
    }

    /**
     * Update modal content without closing
     * @param {string} content - New HTML content
     */
    updateContent(content) {
        if (!this.modalElement) return;

        const contentContainer = this.modalElement.querySelector('.modal-content');
        if (contentContainer) {
            contentContainer.innerHTML = content;
        }
    }

    /**
     * Show loading state in modal
     */
    showLoading(message = 'Loading...') {
        const loadingHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="mt-4 text-base-content/70">${message}</p>
      </div>
    `;
        this.updateContent(loadingHTML);
    }

    /**
     * Show error state in modal
     */
    showError(message) {
        const errorHTML = `
      <div class="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>${message}</span>
      </div>
    `;
        this.updateContent(errorHTML);
    }

    /**
     * Destroy the modal and clean up
     */
    destroy() {
        // Remove event listeners
        if (this.handleEscape) {
            document.removeEventListener('keydown', this.handleEscape);
        }

        // Remove focus trap listener (Phase 7)
        if (this.handleTabKey) {
            document.removeEventListener('keydown', this.handleTabKey);
        }

        // Close if open
        if (this.isOpen) {
            this.close();
        }

        // Remove from DOM
        if (this.modalElement && document.body.contains(this.modalElement)) {
            document.body.removeChild(this.modalElement);
        }

        this.modalElement = null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Modal;
}
