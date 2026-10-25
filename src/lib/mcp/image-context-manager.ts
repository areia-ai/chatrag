import { uploadFile, uploadFiles, type UploadResult } from '@/lib/upload-utils';
import { logger } from '@/lib/logger';

/**
 * Image Context Manager for MCP Tool Compatibility
 * 
 * Manages persistent image context storage and URL retrieval for MCP tools.
 * Converts attached images to downloadable URLs for Zapier MCP compatibility.
 */

export interface ImageContext {
  sessionId: string;
  images: ImageRecord[];
  createdAt: string;
  lastAccessed: string;
}

export interface ImageRecord {
  id: string;
  fileName: string;
  originalName: string;
  downloadUrl: string;
  filePath: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export interface AttachedImage {
  file?: File;
  dataUrl?: string;
  name?: string;
}

class ImageContextManager {
  private static instance: ImageContextManager;
  private contexts = new Map<string, ImageContext>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Cache cleanup settings
  private readonly CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CONTEXT_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

  private constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): ImageContextManager {
    if (!ImageContextManager.instance) {
      ImageContextManager.instance = new ImageContextManager();
    }
    return ImageContextManager.instance;
  }

  /**
   * Process attached images and return downloadable URLs for MCP tools
   */
  async processAttachedImages(
    sessionId: string, 
    attachedImages: AttachedImage[]
  ): Promise<string[]> {
    if (!attachedImages || attachedImages.length === 0) {
      logger.warn('ImageContext', 'No attached images provided');
      return [];
    }

    logger.debug('ImageContext', `Processing ${attachedImages.length} attached images for session: ${sessionId}`);
    console.log('ImageContext', 'Attached images data:', attachedImages.map(img => ({
      name: img.name,
      hasFile: !!img.file,
      hasDataUrl: !!img.dataUrl,
      dataUrlLength: img.dataUrl?.length
    })));

    try {
      // Convert attached images to File objects if needed
      const files: File[] = [];
      
      for (const attachedImage of attachedImages) {
        if (attachedImage.file) {
          files.push(attachedImage.file);
          logger.debug('ImageContext', `Added existing File object: ${attachedImage.file.name}`);
        } else if (attachedImage.dataUrl && attachedImage.name) {
          try {
            // Convert data URL to File object
            const file = this.dataUrlToFile(attachedImage.dataUrl, attachedImage.name);
            files.push(file);
            logger.debug('ImageContext', `Converted data URL to File: ${attachedImage.name} (${file.size} bytes)`);
          } catch (conversionError) {
            logger.error('ImageContext', `Failed to convert data URL for ${attachedImage.name}:`, conversionError);
          }
        } else {
          logger.warn('ImageContext', `Skipping invalid image: missing dataUrl or name`, attachedImage);
        }
      }

      if (files.length === 0) {
        logger.warn('ImageContext', 'No valid files to process');
        return [];
      }

      // Upload files to Supabase Storage
      const uploadResults = await uploadFiles(files, sessionId);
      
      // Filter successful uploads and store in context
      const imageRecords: ImageRecord[] = [];
      const downloadUrls: string[] = [];

      for (let i = 0; i < uploadResults.length; i++) {
        const result = uploadResults[i];
        
        if (result.success && result.downloadUrl) {
          const imageRecord: ImageRecord = {
            id: `${sessionId}-${Date.now()}-${i}`,
            fileName: result.fileName || files[i].name,
            originalName: files[i].name,
            downloadUrl: result.downloadUrl,
            filePath: result.filePath || '',
            size: files[i].size,
            type: files[i].type,
            uploadedAt: new Date().toISOString()
          };

          imageRecords.push(imageRecord);
          downloadUrls.push(result.downloadUrl);

          logger.debug('ImageContext', `Successfully processed: ${files[i].name} -> ${result.downloadUrl}`);
        } else {
          logger.error('ImageContext', `Failed to upload: ${files[i].name} - ${result.error}`);
        }
      }

      // Store context
      if (imageRecords.length > 0) {
        this.storeImageContext(sessionId, imageRecords);
      }

      logger.debug('ImageContext', `Processed ${downloadUrls.length}/${attachedImages.length} images successfully`);
      return downloadUrls;

    } catch (error) {
      logger.error('ImageContext', 'Error processing attached images:', error);
      return [];
    }
  }

  /**
   * Store image context for a session
   */
  private storeImageContext(sessionId: string, newImages: ImageRecord[]): void {
    const now = new Date().toISOString();
    
    let context = this.contexts.get(sessionId);
    
    if (context) {
      // Add new images to existing context
      context.images.push(...newImages);
      context.lastAccessed = now;
    } else {
      // Create new context
      context = {
        sessionId,
        images: newImages,
        createdAt: now,
        lastAccessed: now
      };
    }

    this.contexts.set(sessionId, context);
    logger.debug('ImageContext', `Stored context for session ${sessionId}: ${context.images.length} images`);
  }

  /**
   * Get image context for a session
   */
  getImageContext(sessionId: string): ImageContext | null {
    logger.debug('ImageContext', `🔍 [LOOKUP] Searching for session: ${sessionId}`);
    logger.debug('ImageContext', `🔍 [LOOKUP] Available sessions: ${Array.from(this.contexts.keys()).join(', ')}`);
    
    const context = this.contexts.get(sessionId);
    
    if (context) {
      // Update last accessed time
      context.lastAccessed = new Date().toISOString();
      this.contexts.set(sessionId, context);
      logger.debug('ImageContext', `✅ [LOOKUP] Found context for session ${sessionId}: ${context.images.length} images`);
      return context;
    }
    
    logger.warn('ImageContext', `❌ [LOOKUP] No context found for session: ${sessionId}`);
    return null;
  }

  /**
   * Get all downloadable URLs for a session
   */
  getDownloadableUrls(sessionId: string): string[] {
    logger.debug('ImageContext', `🔗 [URLS] Getting downloadable URLs for session: ${sessionId}`);
    const context = this.getImageContext(sessionId);
    const urls = context ? context.images.map(img => img.downloadUrl) : [];
    logger.debug('ImageContext', `🔗 [URLS] Found ${urls.length} URLs for session ${sessionId}`);
    return urls;
  }

  /**
   * Get the most recent image URL for a session (useful for single image tools)
   */
  getMostRecentImageUrl(sessionId: string): string | null {
    const context = this.getImageContext(sessionId);
    
    if (!context || context.images.length === 0) {
      return null;
    }

    // Return the most recently uploaded image
    const sortedImages = context.images.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    return sortedImages[0].downloadUrl;
  }

  /**
   * Clear image context for a session
   */
  clearImageContext(sessionId: string): void {
    const deleted = this.contexts.delete(sessionId);
    if (deleted) {
      logger.debug('ImageContext', `Cleared context for session: ${sessionId}`);
    }
  }

  /**
   * Get summary of all contexts (for debugging)
   */
  getContextSummary(): { sessionId: string; imageCount: number; lastAccessed: string }[] {
    return Array.from(this.contexts.entries()).map(([sessionId, context]) => ({
      sessionId,
      imageCount: context.images.length,
      lastAccessed: context.lastAccessed
    }));
  }

  /**
   * Find session with most recent images (fallback method)
   */
  getMostRecentSession(): string | null {
    let mostRecent: { sessionId: string; timestamp: number } | null = null;
    
    for (const [sessionId, context] of this.contexts.entries()) {
      if (context.images.length > 0) {
        const lastImageTime = Math.max(...context.images.map(img => 
          new Date(img.uploadedAt).getTime()
        ));
        
        if (!mostRecent || lastImageTime > mostRecent.timestamp) {
          mostRecent = { sessionId, timestamp: lastImageTime };
        }
      }
    }
    
    logger.debug('ImageContext', `🔍 [FALLBACK] Most recent session: ${mostRecent?.sessionId || 'none'}`);
    return mostRecent?.sessionId || null;
  }

  /**
   * Enhanced lookup with multiple fallback strategies
   */
  findImagesWithFallback(sessionId: string): string[] {
    logger.debug('ImageContext', `🔍 [ENHANCED] Starting enhanced lookup for session: ${sessionId}`);
    
    // Strategy 1: Direct session ID lookup
    let urls = this.getDownloadableUrls(sessionId);
    if (urls.length > 0) {
      logger.debug('ImageContext', `✅ [ENHANCED] Direct lookup successful: ${urls.length} URLs`);
      return urls;
    }
    
    // Strategy 2: Try most recent session as fallback
    const mostRecentSession = this.getMostRecentSession();
    if (mostRecentSession && mostRecentSession !== sessionId) {
      logger.debug('ImageContext', `🔄 [ENHANCED] Trying fallback to most recent session: ${mostRecentSession}`);
      urls = this.getDownloadableUrls(mostRecentSession);
      if (urls.length > 0) {
        logger.debug('ImageContext', `✅ [ENHANCED] Fallback successful: ${urls.length} URLs`);
        return urls;
      }
    }
    
    // Strategy 3: Try any session with images
    for (const [sid, context] of this.contexts.entries()) {
      if (context.images.length > 0) {
        logger.debug('ImageContext', `🔄 [ENHANCED] Trying any available session: ${sid}`);
        urls = context.images.map(img => img.downloadUrl);
        if (urls.length > 0) {
          logger.debug('ImageContext', `✅ [ENHANCED] Any-session fallback successful: ${urls.length} URLs`);
          return urls;
        }
      }
    }
    
    logger.warn('ImageContext', `❌ [ENHANCED] All strategies failed for session: ${sessionId}`);
    return [];
  }

  /**
   * Convert data URL to File object
   */
  private dataUrlToFile(dataUrl: string, filename: string): File {
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
   * Start cleanup timer to remove expired contexts
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredContexts();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug('ImageContext', 'Cleanup timer started');
  }

  /**
   * Clean up expired contexts
   */
  private cleanupExpiredContexts(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, context] of this.contexts.entries()) {
      const lastAccessedTime = new Date(context.lastAccessed).getTime();
      
      if (now - lastAccessedTime > this.CONTEXT_EXPIRY_MS) {
        this.contexts.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('ImageContext', `Cleaned up ${cleanedCount} expired image contexts`);
    }
  }

  /**
   * Stop cleanup timer (for testing or shutdown)
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('ImageContext', 'Cleanup timer stopped');
    }
  }
}

// Export singleton instance
export const imageContextManager = ImageContextManager.getInstance();

// Export convenience functions
export const processAttachedImages = (sessionId: string, images: AttachedImage[]) => 
  imageContextManager.processAttachedImages(sessionId, images);

export const getDownloadableUrls = (sessionId: string) => 
  imageContextManager.getDownloadableUrls(sessionId);

export const getMostRecentImageUrl = (sessionId: string) => 
  imageContextManager.getMostRecentImageUrl(sessionId);

export const findImagesWithFallback = (sessionId: string) => 
  imageContextManager.findImagesWithFallback(sessionId);

export const clearImageContext = (sessionId: string) => 
  imageContextManager.clearImageContext(sessionId);