// Browser-compatible document processing script
// Converted from TypeScript for config UI integration

class DocumentProcessor {
  constructor() {
    this.processingQueue = [];
    this.currentProcessing = null;
    this.statusCallbacks = [];
    this.ragConfig = null;
  }

  // Initialize with RAG configuration
  async init() {
    try {
      await this.loadRagConfig();
      this.setupEventListeners();
      console.log('Document processor initialized');
    } catch (error) {
      console.error('Failed to initialize document processor:', error);
    }
  }

  // Load RAG configuration from API
  async loadRagConfig() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      
      this.ragConfig = {
        chunkStrategy: data.config.LLAMACLOUD_CHUNK_STRATEGY || 'sentence',
        chunkSize: parseInt(data.config.LLAMACLOUD_CHUNK_SIZE) || 1500,
        chunkOverlap: parseInt(data.config.LLAMACLOUD_CHUNK_OVERLAP) || 100,
        multimodal: data.config.LLAMACLOUD_MULTIMODAL_PARSING === 'true',
        embeddingModel: data.config.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
      };
      
      this.notifyStatusUpdate('config_loaded', this.ragConfig);
    } catch (error) {
      console.error('Failed to load RAG config:', error);
      this.ragConfig = {
        chunkStrategy: 'sentence',
        chunkSize: 1500,
        chunkOverlap: 100,
        multimodal: true,
        embeddingModel: 'text-embedding-3-small'
      };
    }
  }

  // Add files to processing queue
  addToQueue(files) {
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    const validFiles = fileArray.filter(file => this.isValidDocumentFile(file));
    
    validFiles.forEach(file => {
      const id = this.generateId();
      this.processingQueue.push({
        id,
        file,
        status: 'queued',
        progress: 0,
        error: null,
        result: null,
        addedAt: new Date()
      });
    });

    this.notifyStatusUpdate('queue_updated', {
      queue: this.processingQueue,
      totalFiles: this.processingQueue.length
    });

    return validFiles.length;
  }

  // Process all files in queue
  async processQueue() {
    if (this.currentProcessing) {
      console.log('Processing already in progress');
      return;
    }

    this.notifyStatusUpdate('batch_started', {
      totalFiles: this.processingQueue.length
    });

    for (const fileItem of this.processingQueue) {
      if (fileItem.status === 'queued') {
        await this.processFile(fileItem);
        
        // Add delay between files to prevent rate limiting
        if (this.processingQueue.indexOf(fileItem) < this.processingQueue.length - 1) {
          await this.delay(2000);
        }
      }
    }

    this.notifyStatusUpdate('batch_completed', {
      processed: this.processingQueue.filter(item => item.status === 'completed').length,
      failed: this.processingQueue.filter(item => item.status === 'failed').length
    });
  }

  // Process individual file
  async processFile(fileItem) {
    this.currentProcessing = fileItem;
    fileItem.status = 'processing';
    fileItem.startedAt = new Date();

    this.notifyStatusUpdate('file_started', fileItem);

    try {
      const formData = new FormData();
      formData.append('file', fileItem.file);
      formData.append('isTemporary', 'false');

      const response = await fetch('/api/process-document', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      
      fileItem.status = 'completed';
      fileItem.result = result;
      fileItem.completedAt = new Date();
      fileItem.progress = 100;

      this.notifyStatusUpdate('file_completed', fileItem);

    } catch (error) {
      fileItem.status = 'failed';
      fileItem.error = error.message;
      fileItem.completedAt = new Date();
      
      this.notifyStatusUpdate('file_failed', fileItem);
      console.error(`Failed to process ${fileItem.file.name}:`, error);
    } finally {
      this.currentProcessing = null;
    }
  }

  // Clear completed/failed items from queue
  clearProcessed() {
    this.processingQueue = this.processingQueue.filter(
      item => item.status === 'queued' || item.status === 'processing'
    );
    
    this.notifyStatusUpdate('queue_cleared', {
      queue: this.processingQueue
    });
  }

  // Get processing statistics
  getStats() {
    return {
      total: this.processingQueue.length,
      queued: this.processingQueue.filter(item => item.status === 'queued').length,
      processing: this.processingQueue.filter(item => item.status === 'processing').length,
      completed: this.processingQueue.filter(item => item.status === 'completed').length,
      failed: this.processingQueue.filter(item => item.status === 'failed').length
    };
  }

  // Register status callback
  onStatusUpdate(callback) {
    this.statusCallbacks.push(callback);
  }

  // Remove status callback
  offStatusUpdate(callback) {
    const index = this.statusCallbacks.indexOf(callback);
    if (index > -1) {
      this.statusCallbacks.splice(index, 1);
    }
  }

  // Notify all status callbacks
  notifyStatusUpdate(event, data) {
    this.statusCallbacks.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Error in status callback:', error);
      }
    });
  }

  // Utility methods
  isValidDocumentFile(file) {
    const validTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    const maxSize = 20 * 1024 * 1024; // 20MB
    
    return validTypes.includes(file.type) && file.size <= maxSize;
  }

  generateId() {
    return 'doc_' + Math.random().toString(36).substr(2, 9);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  setupEventListeners() {
    // Handle page visibility changes to pause/resume processing
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.currentProcessing) {
        console.log('Page hidden, processing continues in background');
      }
    });
  }
}

// Export for use in config UI
window.DocumentProcessor = DocumentProcessor;

console.log('Document processor script loaded'); 