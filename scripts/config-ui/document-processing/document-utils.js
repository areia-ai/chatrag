// Document Processing Utilities
// Shared functions and helpers for document processing

class DocumentUtils {
  static validDocumentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  static maxFileSize = 20 * 1024 * 1024; // 20MB

  // Validate if file is a supported document type
  static isValidDocument(file) {
    if (!file || !file.type) return false;
    
    return this.validDocumentTypes.includes(file.type) && 
           file.size <= this.maxFileSize;
  }

  // Get file extension from filename
  static getFileExtension(filename) {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  // Get document type from file
  static getDocumentType(file) {
    const extension = this.getFileExtension(file.name);
    
    switch (file.type) {
      case 'application/pdf':
        return 'pdf';
      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return 'doc';
      case 'text/plain':
        return 'txt';
      default:
        // Fallback to extension
        return ['pdf', 'doc', 'docx', 'txt'].includes(extension) ? extension : 'unknown';
    }
  }

  // Format file size in human-readable format
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Format duration in human-readable format
  static formatDuration(startTime, endTime) {
    const duration = endTime - startTime;
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Generate unique ID
  static generateId(prefix = 'doc') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Validate RAG configuration
  static validateRagConfig(config) {
    const errors = [];

    if (!config.chunkSize || config.chunkSize < 100 || config.chunkSize > 3500) {
      errors.push('Chunk size must be between 100 and 3500');
    }

    if (!config.chunkOverlap || config.chunkOverlap < 0 || config.chunkOverlap >= config.chunkSize) {
      errors.push('Chunk overlap must be between 0 and chunk size');
    }

    const validStrategies = ['sentence', 'paragraph', 'character'];
    if (!validStrategies.includes(config.chunkStrategy)) {
      errors.push('Invalid chunk strategy');
    }

    return { isValid: errors.length === 0, errors };
  }

  // Get file info summary
  static getFileInfo(file) {
    return {
      name: file.name,
      size: file.size,
      type: this.getDocumentType(file),
      formattedSize: this.formatFileSize(file.size),
      lastModified: file.lastModified ? new Date(file.lastModified) : null,
      isValid: this.isValidDocument(file),
      extension: this.getFileExtension(file.name)
    };
  }

  // Create file preview info
  static createFilePreview(file) {
    const info = this.getFileInfo(file);
    
    return {
      ...info,
      preview: {
        icon: this.getFileIcon(info.type),
        description: this.getFileDescription(info.type),
        estimatedProcessingTime: this.estimateProcessingTime(file.size)
      }
    };
  }

  // Get file icon based on type
  static getFileIcon(type) {
    switch (type) {
      case 'pdf': return '📄';
      case 'doc':
      case 'docx': return '📝';
      case 'txt': return '📃';
      default: return '📄';
    }
  }

  // Get file description
  static getFileDescription(type) {
    switch (type) {
      case 'pdf': return 'PDF Document';
      case 'doc': return 'Word Document';
      case 'docx': return 'Word Document';
      case 'txt': return 'Text Document';
      default: return 'Document';
    }
  }

  // Estimate processing time based on file size
  static estimateProcessingTime(sizeInBytes) {
    // Rough estimates based on file size
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    if (sizeInMB < 1) return '< 1 minute';
    if (sizeInMB < 5) return '1-3 minutes';
    if (sizeInMB < 10) return '3-5 minutes';
    if (sizeInMB < 20) return '5-10 minutes';
    return '10+ minutes';
  }

  // Sanitize filename for storage
  static sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();
  }

  // Create processing summary
  static createProcessingSummary(results) {
    const total = results.length;
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const processingTime = results.reduce((total, result) => {
      if (result.startedAt && result.completedAt) {
        return total + (result.completedAt - result.startedAt);
      }
      return total;
    }, 0);

    return {
      total,
      completed,
      failed,
      successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      averageProcessingTime: processingTime / Math.max(completed, 1),
      totalProcessingTime: processingTime,
      formattedTotalTime: this.formatDuration(0, processingTime)
    };
  }

  // Download processing results as JSON
  static downloadResults(results, filename = 'processing-results.json') {
    const summary = this.createProcessingSummary(results);
    const exportData = {
      summary,
      timestamp: new Date().toISOString(),
      results: results.map(result => ({
        filename: result.file.name,
        fileSize: result.file.size,
        status: result.status,
        error: result.error,
        documentId: result.result?.id,
        processedAt: result.completedAt,
        processingDuration: result.completedAt && result.startedAt ? 
          result.completedAt - result.startedAt : null
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Local storage helpers for persisting queue state
  static saveQueueState(queue) {
    try {
      const queueState = queue.map(item => ({
        id: item.id,
        fileName: item.file.name,
        fileSize: item.file.size,
        fileType: item.file.type,
        status: item.status,
        error: item.error,
        addedAt: item.addedAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt
      }));
      
      localStorage.setItem('documentProcessingQueue', JSON.stringify(queueState));
    } catch (error) {
      console.warn('Failed to save queue state:', error);
    }
  }

  static loadQueueState() {
    try {
      const queueState = localStorage.getItem('documentProcessingQueue');
      return queueState ? JSON.parse(queueState) : [];
    } catch (error) {
      console.warn('Failed to load queue state:', error);
      return [];
    }
  }

  static clearQueueState() {
    try {
      localStorage.removeItem('documentProcessingQueue');
    } catch (error) {
      console.warn('Failed to clear queue state:', error);
    }
  }

  // Error handling helpers
  static getErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (error?.message) return error.message;
    return 'An unknown error occurred';
  }

  static isRetryableError(error) {
    const retryableErrors = [
      'network error',
      'timeout',
      'rate limit',
      'server error',
      'connection'
    ];
    
    const errorMessage = this.getErrorMessage(error).toLowerCase();
    return retryableErrors.some(keyword => errorMessage.includes(keyword));
  }

  // Progress tracking utilities
  static createProgressTracker() {
    return {
      startTime: Date.now(),
      files: new Map(),
      
      startFile(fileId, fileName) {
        this.files.set(fileId, {
          name: fileName,
          startTime: Date.now(),
          status: 'processing'
        });
      },
      
      completeFile(fileId, success = true, error = null) {
        const file = this.files.get(fileId);
        if (file) {
          file.endTime = Date.now();
          file.duration = file.endTime - file.startTime;
          file.status = success ? 'completed' : 'failed';
          file.error = error;
        }
      },
      
      getProgress() {
        const files = Array.from(this.files.values());
        return {
          total: files.length,
          completed: files.filter(f => f.status === 'completed').length,
          failed: files.filter(f => f.status === 'failed').length,
          processing: files.filter(f => f.status === 'processing').length,
          totalDuration: Date.now() - this.startTime,
          files
        };
      }
    };
  }
}

// Export for use in config UI
window.DocumentUtils = DocumentUtils;

console.log('Document utilities script loaded'); 