import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

/**
 * URL Validation and Preprocessing for MCP Tool Compatibility
 * 
 * Ensures URLs are properly formatted and accessible for Zapier MCP tools,
 * with special handling for Supabase Storage URLs and download parameters.
 */

export interface URLValidationResult {
  isValid: boolean;
  processedUrl?: string;
  originalUrl: string;
  error?: string;
  urlType: 'supabase-storage' | 'external' | 'data-url' | 'blob' | 'unknown';
  isDownloadable: boolean;
}

export interface URLProcessingOptions {
  ensureDownloadParam?: boolean;
  validateAccessibility?: boolean;
  allowDataUrls?: boolean;
  allowBlobUrls?: boolean;
  timeout?: number; // for accessibility checks
}

const DEFAULT_OPTIONS: URLProcessingOptions = {
  ensureDownloadParam: true,
  validateAccessibility: false, // Don't validate by default to avoid delays
  allowDataUrls: false,
  allowBlobUrls: false,
  timeout: 5000
};

/**
 * Validate and preprocess a URL for MCP tool compatibility
 */
export async function validateAndProcessUrl(
  url: string, 
  options: URLProcessingOptions = {}
): Promise<URLValidationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  logger.debug('URLValidator', `Processing URL: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);

  try {
    // Initial validation
    if (!url || typeof url !== 'string') {
      return {
        isValid: false,
        originalUrl: url,
        error: 'URL is required and must be a string',
        urlType: 'unknown',
        isDownloadable: false
      };
    }

    // Detect URL type
    const urlType = detectUrlType(url);
    
    // Check if URL type is allowed
    if (urlType === 'data-url' && !opts.allowDataUrls) {
      return {
        isValid: false,
        originalUrl: url,
        error: 'Data URLs are not allowed for MCP tools',
        urlType,
        isDownloadable: false
      };
    }

    if (urlType === 'blob' && !opts.allowBlobUrls) {
      return {
        isValid: false,
        originalUrl: url,
        error: 'Blob URLs are not accessible to external MCP tools',
        urlType,
        isDownloadable: false
      };
    }

    // Process URL based on type
    let processedUrl = url;
    let isDownloadable = false;

    switch (urlType) {
      case 'supabase-storage':
        const supabaseResult = processSupabaseStorageUrl(url, opts);
        processedUrl = supabaseResult.processedUrl;
        isDownloadable = supabaseResult.isDownloadable;
        break;
        
      case 'external':
        const externalResult = processExternalUrl(url, opts);
        processedUrl = externalResult.processedUrl;
        isDownloadable = externalResult.isDownloadable;
        break;
        
      default:
        // For unknown types, assume they might be downloadable
        isDownloadable = urlType !== 'data-url' && urlType !== 'blob';
    }

    // Validate accessibility if requested
    if (opts.validateAccessibility && isDownloadable) {
      const accessibilityResult = await validateUrlAccessibility(processedUrl, opts.timeout);
      if (!accessibilityResult.isAccessible) {
        return {
          isValid: false,
          originalUrl: url,
          error: `URL is not accessible: ${accessibilityResult.error}`,
          urlType,
          isDownloadable: false
        };
      }
    }

    logger.debug('URLValidator', `✅ URL processed successfully: ${urlType} -> ${isDownloadable ? 'downloadable' : 'not downloadable'}`);

    return {
      isValid: isDownloadable,
      processedUrl,
      originalUrl: url,
      urlType,
      isDownloadable,
      error: isDownloadable ? undefined : 'URL is not downloadable for MCP tools'
    };

  } catch (error) {
    logger.error('URLValidator', 'Error processing URL:', error);
    
    return {
      isValid: false,
      originalUrl: url,
      error: error instanceof Error ? error.message : 'Unknown error processing URL',
      urlType: 'unknown',
      isDownloadable: false
    };
  }
}

/**
 * Process multiple URLs for MCP compatibility
 */
export async function validateAndProcessUrls(
  urls: string[], 
  options: URLProcessingOptions = {}
): Promise<URLValidationResult[]> {
  logger.info('URLValidator', `Processing ${urls.length} URLs for MCP compatibility`);

  const results = await Promise.all(
    urls.map(url => validateAndProcessUrl(url, options))
  );

  const validCount = results.filter(r => r.isValid).length;
  logger.info('URLValidator', `Processed ${validCount}/${urls.length} URLs successfully`);

  return results;
}

/**
 * Extract only valid, downloadable URLs from validation results
 */
export function extractValidUrls(results: URLValidationResult[]): string[] {
  return results
    .filter(result => result.isValid && result.processedUrl)
    .map(result => result.processedUrl!);
}

/**
 * Detect the type of URL
 */
function detectUrlType(url: string): URLValidationResult['urlType'] {
  try {
    if (url.startsWith('data:')) {
      return 'data-url';
    }
    
    if (url.startsWith('blob:')) {
      return 'blob';
    }

    const parsedUrl = new URL(url);
    
    // Check if it's a Supabase Storage URL
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && parsedUrl.origin === new URL(supabaseUrl).origin && 
        parsedUrl.pathname.includes('/storage/v1/object/')) {
      return 'supabase-storage';
    }
    
    return 'external';
  } catch {
    return 'unknown';
  }
}

/**
 * Process Supabase Storage URLs for MCP compatibility
 */
function processSupabaseStorageUrl(url: string, options: URLProcessingOptions): {
  processedUrl: string;
  isDownloadable: boolean;
} {
  try {
    const parsedUrl = new URL(url);
    
    // Ensure the URL has the download parameter if requested
    if (options.ensureDownloadParam && !parsedUrl.searchParams.has('download')) {
      parsedUrl.searchParams.set('download', '');
      logger.debug('URLValidator', 'Added download parameter to Supabase Storage URL');
    }
    
    // Supabase Storage URLs are downloadable
    return {
      processedUrl: parsedUrl.toString(),
      isDownloadable: true
    };
  } catch (error) {
    logger.warn('URLValidator', 'Error processing Supabase Storage URL:', error);
    return {
      processedUrl: url,
      isDownloadable: false
    };
  }
}

/**
 * Process external URLs for MCP compatibility
 */
function processExternalUrl(url: string, options: URLProcessingOptions): {
  processedUrl: string;
  isDownloadable: boolean;
} {
  try {
    const parsedUrl = new URL(url);
    
    // Check if URL looks like a direct file URL
    const pathname = parsedUrl.pathname.toLowerCase();
    const isDirectFile = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|txt)$/i.test(pathname);
    
    // External URLs are considered downloadable if they point to files directly
    // or if they're from known file hosting services
    const isKnownFileHost = isKnownFileHostingDomain(parsedUrl.hostname);
    
    return {
      processedUrl: url,
      isDownloadable: isDirectFile || isKnownFileHost
    };
  } catch (error) {
    logger.warn('URLValidator', 'Error processing external URL:', error);
    return {
      processedUrl: url,
      isDownloadable: false
    };
  }
}

/**
 * Check if domain is a known file hosting service
 */
function isKnownFileHostingDomain(hostname: string): boolean {
  const knownHosts = [
    'drive.google.com',
    'docs.google.com',
    'dropbox.com',
    'amazonaws.com',
    'cloudfront.net',
    'imgur.com',
    'github.com',
    'raw.githubusercontent.com'
  ];
  
  return knownHosts.some(host => hostname.includes(host));
}

/**
 * Validate URL accessibility (optional, as it can be slow)
 */
async function validateUrlAccessibility(url: string, timeout: number = 5000): Promise<{
  isAccessible: boolean;
  error?: string;
}> {
  try {
    logger.debug('URLValidator', `Checking accessibility: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ChatRAG-MCP-Validator/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return { isAccessible: true };
    } else {
      return { 
        isAccessible: false, 
        error: `HTTP ${response.status}: ${response.statusText}` 
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { 
        isAccessible: false, 
        error: 'Request timeout' 
      };
    }
    
    return { 
      isAccessible: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Helper function to quickly check if a URL is MCP-compatible
 */
export function isUrlMcpCompatible(url: string): boolean {
  const urlType = detectUrlType(url);
  return urlType !== 'data-url' && urlType !== 'blob' && urlType !== 'unknown';
}

/**
 * Helper function to convert blob URLs to downloadable URLs (requires upload)
 */
export function requiresUploadForMcp(url: string): boolean {
  const urlType = detectUrlType(url);
  return urlType === 'blob' || urlType === 'data-url';
}