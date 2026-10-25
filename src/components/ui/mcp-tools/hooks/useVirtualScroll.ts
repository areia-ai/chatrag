import { useVirtualizer } from '@tanstack/react-virtual';
import { RefObject } from 'react';

interface UseVirtualScrollOptions {
  items: any[];
  parentRef: RefObject<HTMLElement>;
  estimateSize?: number;
  overscan?: number;
  horizontal?: boolean;
}

export function useVirtualScroll({
  items,
  parentRef,
  estimateSize = 80, // Default tool item height
  overscan = 5, // Render 5 items above/below viewport
  horizontal = false
}: UseVirtualScrollOptions) {
   
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    horizontal,
    // Enable smooth scrolling
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });

  return {
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
  };
}
