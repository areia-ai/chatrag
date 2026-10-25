'use client';

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import styles from '../styles/mcp-tools.module.css';
import { ToolItem } from './ToolItem';

interface MCPTool {
  name: string;
  description: string;
  server: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

interface ToolsListProps {
  tools: MCPTool[];
  isDarkMode: boolean;
}

// Virtual scrolling for large tool lists
export function ToolsList({ tools, isDarkMode }: ToolsListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  // TanStack Virtual configuration
  const virtualizer = useVirtualizer({
    count: tools.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Estimated height of each tool item
    overscan: 5, // Render 5 items above/below viewport for smooth scrolling
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div 
      ref={parentRef} 
      className={styles.content}
      style={{
        height: '400px', // Fixed height for virtual scrolling
        overflow: 'auto'
      }}
    >
      <div
        className={styles.virtualContainer}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        <div
          className={styles.virtualList}
          style={{
            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
          }}
        >
          {virtualItems.map((virtualItem) => {
            const tool = tools[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
              >
                <ToolItem
                  tool={tool}
                  index={virtualItem.index}
                  isDarkMode={isDarkMode}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}