import { useEffect, useRef } from 'react';

interface PerformanceMetrics {
  renderTime: number;
  mountTime: number;
  interactionTime: number;
  memoryUsage?: number;
}

export function usePerformanceMonitor(componentName: string, enabled = false) {
  const mountTimeRef = useRef<number>(0);
  const renderCountRef = useRef<number>(0);
  const lastRenderTimeRef = useRef<number>(0);
  const metricsRef = useRef<PerformanceMetrics>({
    renderTime: 0,
    mountTime: 0,
    interactionTime: 0,
  });

  useEffect(() => {
    // Only run monitoring logic if enabled, but always have consistent hook structure
    if (enabled) {
      // Track mount time
      const mountStart = performance.now();
      
      // Check if Performance Memory API is available
      const checkMemory = () => {
        if ('memory' in performance) {
          const memInfo = (performance as any).memory;
          metricsRef.current.memoryUsage = memInfo.usedJSHeapSize / 1048576; // Convert to MB
        }
      };

      // Use requestIdleCallback for non-blocking monitoring
      const measurePerformance = () => {
        const now = performance.now();
        
        if (mountTimeRef.current === 0) {
          mountTimeRef.current = now - mountStart;
          metricsRef.current.mountTime = mountTimeRef.current;
          
          if (process.env.NODE_ENV === 'development') {
            console.log(`[Performance] ${componentName} mounted in ${mountTimeRef.current.toFixed(2)}ms`);
          }
        }
        
        // Track render time
        const renderTime = now - lastRenderTimeRef.current;
        if (lastRenderTimeRef.current > 0) {
          metricsRef.current.renderTime = renderTime;
          
          if (process.env.NODE_ENV === 'development' && renderTime > 16) {
            console.warn(`[Performance] ${componentName} slow render: ${renderTime.toFixed(2)}ms`);
          }
        }
        
        lastRenderTimeRef.current = now;
        renderCountRef.current++;
        
        // Check memory usage
        checkMemory();
        
        // Log metrics periodically in development
        if (process.env.NODE_ENV === 'development' && renderCountRef.current % 10 === 0) {
          console.log(`[Performance] ${componentName} metrics:`, {
            renderCount: renderCountRef.current,
            avgRenderTime: `${metricsRef.current.renderTime.toFixed(2)}ms`,
            mountTime: `${metricsRef.current.mountTime.toFixed(2)}ms`,
            memoryUsage: metricsRef.current.memoryUsage 
              ? `${metricsRef.current.memoryUsage.toFixed(2)}MB` 
              : 'N/A'
          });
        }
      };

      // Use requestIdleCallback if available, otherwise use setTimeout
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(measurePerformance);
      } else {
        setTimeout(measurePerformance, 0);
      }
    }

    // Always return cleanup function for consistent hook structure
    const cleanupRenderCount = renderCountRef.current;

    return () => {
      if (enabled && process.env.NODE_ENV === 'development') {
        console.log(`[Performance] ${componentName} unmounted after ${cleanupRenderCount} renders`);
      }
    };
  }, [componentName, enabled]);

  // Track user interactions
  const trackInteraction = (interactionName: string) => {
    if (!enabled) return;
    
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      metricsRef.current.interactionTime = duration;
      
      if (process.env.NODE_ENV === 'development' && duration > 100) {
        console.warn(`[Performance] ${componentName} slow interaction (${interactionName}): ${duration.toFixed(2)}ms`);
      }
    };
  };

  return {
    trackInteraction,
    getMetrics: () => metricsRef.current,
  };
}

// Performance observer for tracking long tasks
export function usePerformanceObserver(enabled = false) {
  useEffect(() => {
    // Only create observer if enabled and PerformanceObserver is available
    let observer: PerformanceObserver | null = null;
    
    if (enabled && typeof PerformanceObserver !== 'undefined') {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'measure' || entry.entryType === 'navigation') {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[Performance] ${entry.name}: ${entry.duration.toFixed(2)}ms`);
            }
          }
          
          // Track long tasks (>50ms)
          if (entry.entryType === 'longtask' && entry.duration > 50) {
            if (process.env.NODE_ENV === 'development') {
              console.warn(`[Performance] Long task detected: ${entry.duration.toFixed(2)}ms`);
            }
          }
        }
      });

      // Observe different performance entry types
      try {
        observer.observe({ entryTypes: ['measure', 'navigation'] });
        
        // Only observe longtask if supported
        if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
          observer.observe({ entryTypes: ['longtask'] });
        }
      } catch (e) {
        // Some entry types might not be supported
        console.log('[Performance] Some performance observers not supported');
      }
    }

    // Always return cleanup function for consistent hook structure
    return () => {
      if (observer) {
        observer.disconnect();
      }
    };
  }, [enabled]);
}
