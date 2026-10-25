import React from 'react';

// Performance monitoring utilities for React components

interface PerformanceMetrics {
  renderCount: number;
  lastRenderTime: number;
  avgRenderTime: number;
  totalRenderTime: number;
  slowRenders: number;
}

class ComponentPerformanceMonitor {
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private isEnabled: boolean = false;

  constructor() {
    // Enable only when explicitly opted in to avoid console spam and overhead
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_ENABLE_PERF_MONITOR === 'true') {
      this.isEnabled = true;
      // Expose to window for debugging
      (window as any).__performanceMonitor = this;
      (window as any).perfReport = () => this.logReport();
      (window as any).perfReset = () => this.reset();
      console.log('[Performance Monitor] Enabled. Use window.perfReport() to see metrics.');
    }
  }

  startRender(componentName: string): number | null {
    if (!this.isEnabled) return null;
    return performance.now();
  }

  endRender(componentName: string, startTime: number | null) {
    if (!this.isEnabled || startTime === null) return;

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    const existing = this.metrics.get(componentName) || {
      renderCount: 0,
      lastRenderTime: 0,
      avgRenderTime: 0,
      totalRenderTime: 0,
      slowRenders: 0,
    };

    const newCount = existing.renderCount + 1;
    const newTotal = existing.totalRenderTime + renderTime;
    const newAvg = newTotal / newCount;
    const isSlowRender = renderTime > 16; // Slower than 60fps

    this.metrics.set(componentName, {
      renderCount: newCount,
      lastRenderTime: renderTime,
      avgRenderTime: newAvg,
      totalRenderTime: newTotal,
      slowRenders: existing.slowRenders + (isSlowRender ? 1 : 0),
    });

    // Log slow renders
    if (isSlowRender) {
      console.warn(`[Performance] Slow render in ${componentName}: ${renderTime.toFixed(2)}ms`);
    }
  }

  getReport(): Record<string, PerformanceMetrics> {
    const report: Record<string, PerformanceMetrics> = {};
    this.metrics.forEach((value, key) => {
      report[key] = { ...value };
    });
    return report;
  }

  logReport() {
    if (!this.isEnabled) return;

    console.group('Performance Report');
    this.metrics.forEach((metrics, componentName) => {
      console.group(componentName);
      console.log(`Render count: ${metrics.renderCount}`);
      console.log(`Average render time: ${metrics.avgRenderTime.toFixed(2)}ms`);
      console.log(`Last render time: ${metrics.lastRenderTime.toFixed(2)}ms`);
      console.log(`Slow renders (>16ms): ${metrics.slowRenders}`);
      console.log(`Slow render percentage: ${((metrics.slowRenders / metrics.renderCount) * 100).toFixed(1)}%`);
      console.groupEnd();
    });
    console.groupEnd();
  }

  reset() {
    this.metrics.clear();
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
  }
}

// Create singleton instance
export const performanceMonitor = new ComponentPerformanceMonitor();

// React hook for performance monitoring
export function usePerformanceMonitor(componentName: string) {
  const startTime = performanceMonitor.startRender(componentName);

  React.useEffect(() => {
    if (startTime === null) {
      return;
    }

    performanceMonitor.endRender(componentName, startTime);
  }, [componentName, startTime]);
}

// HOC for performance monitoring
export function withPerformanceMonitoring<P extends object>(
  Component: React.ComponentType<P>,
  componentName: string
): React.ComponentType<P> {
  const MonitoredComponent = React.memo((props: P) => {
    usePerformanceMonitor(componentName);
    return <Component {...props} />;
  });

  MonitoredComponent.displayName = `withPerformanceMonitoring(${Component.displayName ?? Component.name ?? 'Component'})`;

  return MonitoredComponent;
}

// Utility to measure specific operations
export function measurePerformance<T>(
  operationName: string,
  operation: () => T
): T {
  const start = performance.now();
  const result = operation();
  const end = performance.now();
  const duration = end - start;

  if (duration > 10) {
    console.warn(`[Performance] Slow operation "${operationName}": ${duration.toFixed(2)}ms`);
  }

  return result;
}
