// Document Processing Status Monitor
// Real-time status updates and progress tracking

class DocumentStatusMonitor {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.processor = null;
    this.isInitialized = false;
  }

  // Initialize the status monitor
  init(documentProcessor) {
    this.processor = documentProcessor;
    this.setupStatusDisplay();
    this.bindEvents();
    this.isInitialized = true;
    console.log('Document status monitor initialized');
  }

  // Set up the status display UI
  setupStatusDisplay() {
    if (!this.container) {
      console.error('Status monitor container not found');
      return;
    }

    this.container.innerHTML = `
      <div class="status-monitor">
        <div class="status-header">
          <h3>📊 Processing Status</h3>
          <div class="status-actions">
            <button id="refreshStatus" class="btn btn-secondary btn-sm">🔄 Refresh</button>
            <button id="clearCompleted" class="btn btn-secondary btn-sm">🗑️ Clear Completed</button>
          </div>
        </div>

        <div class="status-overview">
          <div class="stat-card">
            <div class="stat-number" id="totalFiles">0</div>
            <div class="stat-label">Total Files</div>
          </div>
          <div class="stat-card">
            <div class="stat-number" id="queuedFiles">0</div>
            <div class="stat-label">Queued</div>
          </div>
          <div class="stat-card processing">
            <div class="stat-number" id="processingFiles">0</div>
            <div class="stat-label">Processing</div>
          </div>
          <div class="stat-card success">
            <div class="stat-number" id="completedFiles">0</div>
            <div class="stat-label">Completed</div>
          </div>
          <div class="stat-card error">
            <div class="stat-number" id="failedFiles">0</div>
            <div class="stat-label">Failed</div>
          </div>
        </div>

        <div class="current-processing" id="currentProcessing" style="display: none;">
          <div class="processing-file">
            <div class="file-info">
              <span class="file-name" id="currentFileName">-</span>
              <span class="file-size" id="currentFileSize">-</span>
            </div>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill" id="currentProgress" style="width: 0%;"></div>
              </div>
              <span class="progress-text" id="progressText">0%</span>
            </div>
          </div>
        </div>

        <div class="processing-queue" id="processingQueue">
          <h4>📋 Processing Queue</h4>
          <div class="queue-list" id="queueList">
            <div class="empty-queue">No files in queue</div>
          </div>
        </div>

        <div class="rag-status" id="ragStatus">
          <h4>⚙️ RAG Configuration</h4>
          <div class="rag-config-display" id="ragConfigDisplay">
            <div class="config-loading">Loading configuration...</div>
          </div>
        </div>
      </div>
    `;

    this.updateStatDisplay();
  }

  // Bind event listeners
  bindEvents() {
    // Refresh button
    const refreshBtn = document.getElementById('refreshStatus');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshStatus());
    }

    // Clear completed button
    const clearBtn = document.getElementById('clearCompleted');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearCompleted());
    }

    // Processor status updates
    if (this.processor) {
      this.processor.onStatusUpdate((event, data) => {
        this.handleStatusUpdate(event, data);
      });
    }
  }

  // Handle status updates from processor
  handleStatusUpdate(event, data) {
    switch (event) {
      case 'config_loaded':
        this.updateRagConfig(data);
        break;
      case 'queue_updated':
        this.updateQueueDisplay(data.queue);
        this.updateStatDisplay();
        break;
      case 'batch_started':
        console.log('Batch processing started:', data);
        this.updateStatDisplay();
        break;
      case 'file_started':
        this.updateCurrentProcessing(data);
        this.updateStatDisplay();
        break;
      case 'file_completed':
        this.updateFileStatus(data);
        this.updateStatDisplay();
        break;
      case 'file_failed':
        this.updateFileStatus(data);
        this.updateStatDisplay();
        break;
      case 'batch_completed':
        this.hideCurrentProcessing();
        this.updateStatDisplay();
        this.showBatchResult(data);
        break;
      case 'queue_cleared':
        this.updateQueueDisplay(data.queue);
        this.updateStatDisplay();
        break;
    }
  }

  // Update statistics display
  updateStatDisplay() {
    if (!this.processor) return;

    const stats = this.processor.getStats();
    
    document.getElementById('totalFiles').textContent = stats.total;
    document.getElementById('queuedFiles').textContent = stats.queued;
    document.getElementById('processingFiles').textContent = stats.processing;
    document.getElementById('completedFiles').textContent = stats.completed;
    document.getElementById('failedFiles').textContent = stats.failed;
  }

  // Update current processing display
  updateCurrentProcessing(fileItem) {
    const currentDiv = document.getElementById('currentProcessing');
    const fileName = document.getElementById('currentFileName');
    const fileSize = document.getElementById('currentFileSize');
    
    if (currentDiv && fileName && fileSize) {
      currentDiv.style.display = 'block';
      fileName.textContent = fileItem.file.name;
      fileSize.textContent = this.formatFileSize(fileItem.file.size);
      
      // Start progress animation
      this.animateProgress(fileItem);
    }
  }

  // Hide current processing display
  hideCurrentProcessing() {
    const currentDiv = document.getElementById('currentProcessing');
    if (currentDiv) {
      currentDiv.style.display = 'none';
    }
  }

  // Animate progress bar (simulated progress for now)
  animateProgress(fileItem) {
    const progressFill = document.getElementById('currentProgress');
    const progressText = document.getElementById('progressText');
    
    if (!progressFill || !progressText) return;

    let progress = 0;
    const interval = setInterval(() => {
      if (fileItem.status !== 'processing') {
        clearInterval(interval);
        if (fileItem.status === 'completed') {
          progressFill.style.width = '100%';
          progressText.textContent = '100%';
        }
        return;
      }

      progress += Math.random() * 10;
      progress = Math.min(progress, 95); // Never reach 100% until actually complete
      
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `${Math.round(progress)}%`;
    }, 500);
  }

  // Update queue display
  updateQueueDisplay(queue) {
    const queueList = document.getElementById('queueList');
    if (!queueList) return;

    if (queue.length === 0) {
      queueList.innerHTML = '<div class="empty-queue">No files in queue</div>';
      return;
    }

    queueList.innerHTML = queue.map(item => `
      <div class="queue-item ${item.status}" data-id="${item.id}">
        <div class="queue-file-info">
          <span class="queue-file-name">${item.file.name}</span>
          <span class="queue-file-size">${this.formatFileSize(item.file.size)}</span>
        </div>
        <div class="queue-status">
          <span class="status-badge ${item.status}">${this.getStatusIcon(item.status)} ${item.status}</span>
          ${item.error ? `<span class="error-msg">${item.error}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  // Update file status in queue
  updateFileStatus(fileItem) {
    const queueItem = document.querySelector(`[data-id="${fileItem.id}"]`);
    if (queueItem) {
      queueItem.className = `queue-item ${fileItem.status}`;
      const statusBadge = queueItem.querySelector('.status-badge');
      if (statusBadge) {
        statusBadge.innerHTML = `${this.getStatusIcon(fileItem.status)} ${fileItem.status}`;
        statusBadge.className = `status-badge ${fileItem.status}`;
      }
      
      if (fileItem.error) {
        const errorMsg = queueItem.querySelector('.error-msg');
        if (errorMsg) {
          errorMsg.textContent = fileItem.error;
        } else {
          const statusDiv = queueItem.querySelector('.queue-status');
          statusDiv.innerHTML += `<span class="error-msg">${fileItem.error}</span>`;
        }
      }
    }
  }

  // Update RAG configuration display
  updateRagConfig(config) {
    const configDisplay = document.getElementById('ragConfigDisplay');
    if (!configDisplay) return;

    configDisplay.innerHTML = `
      <div class="rag-config-item">
        <span class="config-label">Chunk Strategy:</span>
        <span class="config-value">${config.chunkStrategy}</span>
      </div>
      <div class="rag-config-item">
        <span class="config-label">Chunk Size:</span>
        <span class="config-value">${config.chunkSize}</span>
      </div>
      <div class="rag-config-item">
        <span class="config-label">Chunk Overlap:</span>
        <span class="config-value">${config.chunkOverlap}</span>
      </div>
      <div class="rag-config-item">
        <span class="config-label">Multimodal:</span>
        <span class="config-value">${config.multimodal ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div class="rag-config-item">
        <span class="config-label">Embedding Model:</span>
        <span class="config-value">${config.embeddingModel}</span>
      </div>
    `;
  }

  // Show batch completion result
  showBatchResult(data) {
    const notification = document.createElement('div');
    notification.className = 'batch-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <h4>✅ Batch Processing Completed</h4>
        <p>Processed: ${data.processed} files</p>
        ${data.failed > 0 ? `<p>Failed: ${data.failed} files</p>` : ''}
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  // Utility methods
  getStatusIcon(status) {
    switch (status) {
      case 'queued': return '⏳';
      case 'processing': return '⚙️';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '❓';
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Manual refresh
  refreshStatus() {
    this.updateStatDisplay();
    if (this.processor) {
      this.updateQueueDisplay(this.processor.processingQueue);
    }
  }

  // Clear completed files
  clearCompleted() {
    if (this.processor) {
      this.processor.clearProcessed();
    }
  }
}

// Export for use in config UI
window.DocumentStatusMonitor = DocumentStatusMonitor;

console.log('Document status monitor script loaded'); 