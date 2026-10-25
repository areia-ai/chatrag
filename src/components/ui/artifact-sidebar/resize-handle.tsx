'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useResize } from './hooks/use-resize';
import { ResizeConfig } from './types/artifact.types';

interface ResizeHandleProps {
  width: number;
  config: ResizeConfig;
  onWidthChange: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  className?: string;
}

export function ResizeHandle({
  width,
  config,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
  className,
}: ResizeHandleProps) {
  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isResizing,
  } = useResize({
    initialWidth: width,
    config,
    onWidthChange,
    onResizeStart,
    onResizeEnd,
  });

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 w-4 cursor-ew-resize transition-colors",
        "hover:bg-[#FF6417]/10 dark:hover:bg-[#FF8A4D]/10",
        isResizing && "bg-[#FF6417]/20 dark:bg-[#FF8A4D]/20",
        className
      )}
      style={{ 
        left: -4,
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={config.minWidth}
      aria-valuemax={config.maxWidth}
      aria-valuenow={width}
    >
      {/* Subtle divider line */}
      <div className={cn(
        "absolute inset-y-0 right-0 w-px transition-opacity",
        "bg-gray-200 dark:bg-gray-700",
        "opacity-0 group-hover:opacity-60",
        isResizing && "opacity-80"
      )} />
      
      {/* Drag indicator dots */}
      <div className={cn(
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        "h-16 w-4 flex flex-col items-center justify-center gap-1.5",
        "rounded-full transition-opacity duration-200",
        "opacity-0 group-hover:opacity-60",
        isResizing && "opacity-80"
      )}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full bg-[#FF6417]/70 dark:bg-[#FF8A4D]/70"
          />
        ))}
      </div>
      
      {/* Touch-friendly resize area for mobile */}
      <div 
        className="absolute inset-0 w-8 -left-2 md:w-4 md:-left-0"
        aria-hidden="true"
      />
    </div>
  );
} 