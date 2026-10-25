import { useCallback, useRef, useEffect, useState } from 'react';
import { ResizeConfig } from '../types/artifact.types';

interface UseResizeOptions {
  initialWidth: number;
  config: ResizeConfig;
  onWidthChange: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

interface UseResizeReturn {
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  isResizing: boolean;
}

export function useResize({
  initialWidth,
  config,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
}: UseResizeOptions): UseResizeReturn {
  const resizeState = useRef({
    isActive: false,
    startX: 0,
    startWidth: 0,
  });
  const [isResizing, setIsResizing] = useState(false);

  const constrainWidth = useCallback((width: number): number => {
    return Math.min(Math.max(width, config.minWidth), config.maxWidth);
  }, [config.minWidth, config.maxWidth]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle left mouse button
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    // Capture the pointer
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    // Initialize resize state
    resizeState.current = {
      isActive: true,
      startX: e.clientX,
      startWidth: initialWidth,
    };
    setIsResizing(true);

    // Set cursor style
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    onResizeStart?.();
  }, [initialWidth, onResizeStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeState.current.isActive) return;

    e.preventDefault();

    // Calculate new width (dragging left increases width, right decreases)
    const deltaX = resizeState.current.startX - e.clientX;
    const newWidth = resizeState.current.startWidth + deltaX;
    const constrainedWidth = constrainWidth(newWidth);

    onWidthChange(constrainedWidth);
  }, [constrainWidth, onWidthChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizeState.current.isActive) return;

    e.preventDefault();

    // Release pointer capture
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);

    // Reset resize state
    resizeState.current.isActive = false;
    setIsResizing(false);

    // Reset cursor style
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    onResizeEnd?.();
  }, [onResizeEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resizeState.current.isActive) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizeState.current.isActive = false;
        setIsResizing(false);
      }
    };
  }, []);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isResizing,
  };
}
