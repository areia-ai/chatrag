'use client';

import React from 'react';
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

interface ServerSectionProps {
  serverName: string;
  tools: MCPTool[];
  isDarkMode: boolean;
  startIndex: number; // For animation delay calculation
}

// Server display info mapping
const getServerDisplayInfo = (serverId: string) => {
  const serverMap: Record<string, { name: string; icon: string; color: string }> = {
    'zapier': { name: 'Zapier', icon: '⚡', color: 'text-purple-600 dark:text-purple-400' },
    'coingecko-mcp': { name: 'CoinGecko MCP', icon: '🦎', color: 'text-green-600 dark:text-green-400' },
    'brave-search': { name: 'Brave Search', icon: '🔍', color: 'text-orange-600 dark:text-orange-400' },
    'supabase': { name: 'Supabase', icon: '🗄️', color: 'text-emerald-600 dark:text-emerald-400' },
    'context7': { name: 'Context7', icon: '📚', color: 'text-indigo-600 dark:text-indigo-400' },
    '21st-dev-magic-mcp': { name: '21st.dev Magic', icon: '✨', color: 'text-pink-600 dark:text-pink-400' }
  };
  
  return serverMap[serverId] || { 
    name: serverId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), 
    icon: '🔧', 
    color: 'text-gray-600 dark:text-gray-400' 
  };
};

// Clean component - let React 19 compiler optimize
export function ServerSection({ serverName, tools, isDarkMode, startIndex }: ServerSectionProps) {
  const serverInfo = getServerDisplayInfo(serverName);
  const enabledTools = tools.filter(t => t.enabled !== false);
  
  return (
    <div className={styles.serverSection}>
      <div className={styles.serverHeader}>
        <span className={styles.serverIcon}>{serverInfo.icon}</span>
        <span className={`${styles.serverName} ${serverInfo.color}`}>
          {serverInfo.name}
        </span>
        <span className={cn(styles.serverCount, isDarkMode && styles.dark)}>
          ({enabledTools.length} tool{enabledTools.length !== 1 ? 's' : ''})
        </span>
      </div>
      
      <div>
        {tools.map((tool, index) => (
          <ToolItem
            key={`${serverName}-${tool.name}-${index}`}
            tool={tool}
            index={startIndex + index}
            isDarkMode={isDarkMode}
          />
        ))}
      </div>
    </div>
  );
}