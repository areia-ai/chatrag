/**
 * Smart Centralized Logging System
 * Implements request deduplication, log levels, and environment awareness
 */

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN', 
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

class SmartLogger {
  private logCache = new Map<string, { timestamp: number; count: number }>();
  private readonly isDev = process.env.NODE_ENV === 'development';
  private readonly cacheExpiry = 30000; // 30 seconds
  private readonly maxDuplicates = 2; // Only show same log 2 times max

  /**
   * Log with deduplication to prevent spam
   */
  private logWithDeduplication(level: LogLevel, prefix: string, message: string, data?: any) {
    if (!this.isDev && level === LogLevel.DEBUG) return;
    if (!this.isDev && level === LogLevel.INFO && prefix.includes('ENV')) return;

    const logKey = `${prefix}:${message}`;
    const now = Date.now();
    
    // Check if we've seen this log recently
    const cached = this.logCache.get(logKey);
    if (cached) {
      // If within cache expiry and under max duplicates
      if (now - cached.timestamp < this.cacheExpiry && cached.count >= this.maxDuplicates) {
        return; // Skip duplicate log
      }
      
      // Update count
      cached.count++;
      cached.timestamp = now;
    } else {
      // New log entry
      this.logCache.set(logKey, { timestamp: now, count: 1 });
    }

    // Clean old cache entries periodically
    if (this.logCache.size > 100) {
      this.cleanCache();
    }

    // Format and output log
    const formattedMessage = `${prefix}: ${message}`;
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, data || '');
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, data || '');
        break;
      case LogLevel.INFO:
        console.log(formattedMessage, data || '');
        break;
      case LogLevel.DEBUG:
        console.log(formattedMessage, data || '');
        break;
    }
  }

  /**
   * Clean expired cache entries
   */
  private cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.logCache.entries()) {
      if (now - value.timestamp > this.cacheExpiry) {
        this.logCache.delete(key);
      }
    }
  }

  /**
   * Log startup/initialization events (only once per process)
   */
  startup(component: string, message: string, data?: any) {
    this.logWithDeduplication(LogLevel.INFO, `STARTUP[${component}]`, message, data);
  }

  /**
   * Log environment/config loading (cached to prevent spam)
   */
  env(message: string, data?: any) {
    this.logWithDeduplication(LogLevel.DEBUG, 'ENV', message, data);
  }

  /**
   * Log database operations (limited frequency)
   */
  db(message: string, data?: any) {
    this.logWithDeduplication(LogLevel.DEBUG, 'DB', message, data);
  }

  /**
   * Log MCP discovery/tools (cached)
   */
  mcp(message: string, data?: any) {
    this.logWithDeduplication(LogLevel.INFO, 'MCP', message, data);
  }

  /**
   * Log admin operations
   */
  admin(message: string, data?: any) {
    this.logWithDeduplication(LogLevel.DEBUG, 'ADMIN', message, data);
  }

  /**
   * Log API requests (minimal, only errors and slow requests in production)
   */
  api(method: string, path: string, status: number, duration?: number) {
    if (this.isDev) {
      const message = duration ? `${method} ${path} ${status} in ${duration}ms` : `${method} ${path} ${status}`;
      this.logWithDeduplication(LogLevel.DEBUG, 'API', message);
    } else if (status >= 400 || (duration && duration > 2000)) {
      const message = duration ? `${method} ${path} ${status} in ${duration}ms` : `${method} ${path} ${status}`;
      this.logWithDeduplication(LogLevel.WARN, 'API', message);
    }
  }

  /**
   * Log errors (always shown)
   */
  error(component: string, message: string, error?: any) {
    console.error(`ERROR[${component}]: ${message}`, error || '');
  }

  /**
   * Log warnings
   */
  warn(component: string, message: string, data?: any) {
    this.logWithDeduplication(LogLevel.WARN, `WARN[${component}]`, message, data);
  }

  /**
   * General info logs
   */
  info(component: string, message: string, data?: any) {
    this.logWithDeduplication(LogLevel.INFO, `INFO[${component}]`, message, data);
  }

  /**
   * Development-only debug logs
   */
  debug(component: string, message: string, data?: any) {
    if (this.isDev) {
      this.logWithDeduplication(LogLevel.DEBUG, `DEBUG[${component}]`, message, data);
    }
  }

  /**
   * Clear the log cache (useful for testing)
   */
  clearCache() {
    this.logCache.clear();
  }
}

// Export singleton instance
export const logger = new SmartLogger();

// Helper functions for backwards compatibility
export const logStartup = (component: string, message: string, data?: any) => logger.startup(component, message, data);
export const logEnv = (message: string, data?: any) => logger.env(message, data);
export const logDb = (message: string, data?: any) => logger.db(message, data);
export const logMcp = (message: string, data?: any) => logger.mcp(message, data);
export const logAdmin = (message: string, data?: any) => logger.admin(message, data);
export const logApi = (method: string, path: string, status: number, duration?: number) => logger.api(method, path, status, duration);
export const logError = (component: string, message: string, error?: any) => logger.error(component, message, error);
export const logWarn = (component: string, message: string, data?: any) => logger.warn(component, message, data);
export const logInfo = (component: string, message: string, data?: any) => logger.info(component, message, data);
export const logDebug = (component: string, message: string, data?: any) => logger.debug(component, message, data); 