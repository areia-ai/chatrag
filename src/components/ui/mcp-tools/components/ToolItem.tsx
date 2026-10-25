'use client';

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from '../styles/mcp-tools.module.css';

interface MCPTool {
  name: string;
  description: string;
  server: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

interface ToolItemProps {
  tool: MCPTool;
  index: number;
  isDarkMode: boolean;
  style?: React.CSSProperties; // For virtual scrolling positioning
}

// Clean component - let React 19 compiler optimize
export function ToolItem({ tool, index, isDarkMode, style }: ToolItemProps) {
  const isEnabled = tool.enabled !== false;
  
  return (
    <div
      className={cn(
        styles.toolItem,
        isDarkMode && styles.dark,
        !isEnabled && styles.disabled
      )}
      style={{
        ...style,
        '--index': index
      } as React.CSSProperties}
    >
      <div className={styles.toolHeader}>
        <h4 className={cn(styles.toolName, isDarkMode && styles.dark)}>
          {tool.name}
        </h4>
        {isEnabled && (
          <CheckCircle2 className={styles.enabledIcon} />
        )}
      </div>
      
      <p className={cn(styles.toolDescription, isDarkMode && styles.dark)}>
        {tool.description}
      </p>
      
      {!isEnabled && (
        <span className={cn(styles.disabledBadge, isDarkMode && styles.dark)}>
          Unavailable
        </span>
      )}
    </div>
  );
}