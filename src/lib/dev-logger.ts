/**
 * Development logging utility
 * Provides conditional logging that can be easily disabled in production
 */

const IS_DEV = process.env.NODE_ENV === 'development';
const ENABLE_VERBOSE_LOGGING = process.env.NEXT_PUBLIC_VERBOSE_LOGGING === 'true';

export const devLog = {
  /**
   * Standard development logging - shows in dev mode only
   */
  log: (...args: any[]) => {
    if (IS_DEV) {
      console.log(...args);
    }
  },

  /**
   * Verbose logging - only shows when explicitly enabled
   * Use for detailed debugging that's too noisy for regular development
   */
  verbose: (...args: any[]) => {
    if (IS_DEV && ENABLE_VERBOSE_LOGGING) {
      console.log(...args);
    }
  },

  /**
   * Error logging - always shows (even in production for critical issues)
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Warning logging - shows in development
   */
  warn: (...args: any[]) => {
    if (IS_DEV) {
      console.warn(...args);
    }
  },

  /**
   * Performance logging - for tracking performance metrics
   */
  perf: (label: string, fn: () => void) => {
    if (IS_DEV && ENABLE_VERBOSE_LOGGING) {
      console.time(label);
      fn();
      console.timeEnd(label);
    } else {
      fn();
    }
  },

  /**
   * Component lifecycle logging - very verbose, disabled by default
   */
  lifecycle: (...args: any[]) => {
    if (IS_DEV && ENABLE_VERBOSE_LOGGING && process.env.NEXT_PUBLIC_LOG_LIFECYCLE === 'true') {
      console.log('[LIFECYCLE]', ...args);
    }
  }
};

export default devLog;