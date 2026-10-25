import { logger } from './logger';

/**
 * Upload utilities for file handling across the application
 */

/**
 * Get the base URL for API requests, handling both client and server contexts
 */
function getBaseUrl(): string {
  // Check if we're running in a browser environment
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  // Server-side: use environment variable or localhost fallback
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return baseUrl;
}

/**
 * Get the absolute URL for an API endpoint
 */
function getApiUrl(endpoint: string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}${endpoint}`;
}

export interface UploadResult {
  success: boolean;
  downloadUrl?: string;
  fileName?: string;
  filePath?: string;
  error?: string;
}

export interface FileValidationOptions {
  maxSize?: number; // in bytes
  allowedTypes?: string[];
}

// Default configuration
export const DEFAULT_UPLOAD_CONFIG = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]
};

/**
 * Validate a file before upload
 */
export function validateFile(file: File, options: FileValidationOptions = {}): { valid: boolean; error?: string } {
  const config = { ...DEFAULT_UPLOAD_CONFIG, ...options };
  
  // Check file size
  if (file.size > config.maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${config.maxSize / 1024 / 1024}MB`
    };
  }
  
  // Check file type
  if (!config.allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type}`
    };
  }
  
  return { valid: true };
}

/**
 * Upload a single file to the dedicated upload endpoint
 */
export async function uploadFile(file: File, sessionId?: string): Promise<UploadResult> {
  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Prepare FormData
    const formData = new FormData();
    formData.append('files', file);
    if (sessionId) {
      formData.append('sessionId', sessionId);
    }

    logger.debug('UploadUtils', `Uploading file: ${file.name} (${file.size} bytes)`);

    // Upload to API endpoint
    const response = await fetch(getApiUrl('/api/upload'), {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Upload failed with status ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || result.files.length === 0) {
      throw new Error(result.errors?.[0] || 'Upload failed');
    }

    const uploadedFile = result.files[0];
    
    logger.debug('UploadUtils', `Successfully uploaded: ${file.name} -> ${uploadedFile.downloadUrl}`);

    return {
      success: true,
      downloadUrl: uploadedFile.downloadUrl,
      fileName: uploadedFile.fileName,
      filePath: uploadedFile.filePath
    };

  } catch (error) {
    logger.error('UploadUtils', `Upload failed for ${file.name}:`, error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Upload multiple files to the dedicated upload endpoint
 */
export async function uploadFiles(files: File[], sessionId?: string): Promise<UploadResult[]> {
  try {
    // Validate all files first
    const validationResults = files.map(file => ({
      file,
      validation: validateFile(file)
    }));

    // Return early results for invalid files
    const results: UploadResult[] = validationResults.map(({ file, validation }) => {
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }
      return { success: true }; // Placeholder for valid files
    });

    // Get only valid files for upload
    const validFiles = validationResults
      .filter(({ validation }) => validation.valid)
      .map(({ file }) => file);

    if (validFiles.length === 0) {
      return results;
    }

    // Prepare FormData
    const formData = new FormData();
    validFiles.forEach(file => {
      formData.append('files', file);
    });
    if (sessionId) {
      formData.append('sessionId', sessionId);
    }

    logger.debug('UploadUtils', `Uploading ${validFiles.length} files`);

    // Upload to API endpoint
    const response = await fetch(getApiUrl('/api/upload'), {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Upload failed with status ${response.status}`);
    }

    const result = await response.json();

    // Map successful uploads back to results array
    let uploadIndex = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].success && results[i].error === undefined) {
        if (uploadIndex < result.files.length) {
          const uploadedFile = result.files[uploadIndex];
          results[i] = {
            success: true,
            downloadUrl: uploadedFile.downloadUrl,
            fileName: uploadedFile.fileName,
            filePath: uploadedFile.filePath
          };
          uploadIndex++;
        } else {
          results[i] = {
            success: false,
            error: 'Upload failed'
          };
        }
      }
    }

    // Handle any upload errors
    if (result.errors && result.errors.length > 0) {
      logger.warn('UploadUtils', 'Some files failed to upload:', result.errors);
    }

    logger.debug('UploadUtils', `Upload complete: ${result.uploaded}/${validFiles.length} files uploaded`);

    return results;

  } catch (error) {
    logger.error('UploadUtils', 'Batch upload failed:', error);
    
    // Return error for all files
    return files.map(() => ({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    }));
  }
}

/**
 * Convert base64 data URL to File object
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  
  return new File([u8arr], filename, { type: mime });
}

/**
 * Convert File object to base64 data URL
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Extract file type and size information
 */
export function getFileInfo(file: File): {
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  isDocument: boolean;
} {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    isImage: file.type.startsWith('image/'),
    isDocument: file.type.includes('pdf') || 
                file.type.includes('document') || 
                file.type.includes('text/')
  };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}