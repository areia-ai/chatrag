'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Hammer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { env } from '@/lib/env';
import { CollapsibleButton } from './collapsible-button';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import React from 'react';
import ReactMarkdown from 'react-markdown';

// Create a custom dialog content without the default close button
const CustomDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/50 z-50 backdrop-blur-[1px]"
      aria-hidden="true"
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
CustomDialogContent.displayName = "CustomDialogContent";

interface MCPTool {
  name: string;
  description: string;
  server: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

interface MCPToolsButtonProps {
  disabled?: boolean;
  isActive?: boolean;
  className?: string;
}

/**
 * Debounced API Manager for MCP Tools
 * Prevents multiple simultaneous API calls through debouncing and caching
 */
class McpToolsApiManager {
  private static instance: McpToolsApiManager;
  private cache: { data: any; timestamp: number; ttl: number } | null = null;
  private fetchPromise: Promise<any> | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly cacheTTL = 15000; // 15 seconds
  private readonly debounceDelay = 250; // 250ms debounce

  static getInstance(): McpToolsApiManager {
    if (!McpToolsApiManager.instance) {
      McpToolsApiManager.instance = new McpToolsApiManager();
    }
    return McpToolsApiManager.instance;
  }

  async fetchTools(forceRefresh = false): Promise<any> {
    // Check cache first (unless forced refresh)
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.cache.ttl) {
      return this.cache.data;
    }

    // If already fetching, return the existing promise
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Create and store the fetch promise
    this.fetchPromise = this.performFetch();

    try {
      const result = await this.fetchPromise;
      
      // Cache the result
      this.cache = {
        data: result,
        timestamp: Date.now(),
        ttl: this.cacheTTL
      };

      return result;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async performFetch(): Promise<any> {
    try {
      const response = await fetch('/api/mcp/tools', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch tools: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching MCP tools:', error);
      throw error;
    }
  }

  async refreshTools(): Promise<any> {
    return this.fetchTools(true);
  }

  clearCache(): void {
    this.cache = null;
  }
}

export function MCPToolsButton({ 
  disabled = false, 
  isActive = false,
  className
}: MCPToolsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  // Get API manager instance
  const apiManager = useMemo(() => McpToolsApiManager.getInstance(), []);

  // Debounced fetch function
  const debouncedFetchTools = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiManager.fetchTools();
      
      if (data && data.success && data.toolsByServer) {
        // Convert the new grouped format back to a flat array for compatibility
        const allTools: MCPTool[] = [];
        
        for (const [serverName, serverTools] of Object.entries(data.toolsByServer)) {
          if (Array.isArray(serverTools)) {
            serverTools.forEach((tool: any) => {
              allTools.push({
                name: tool.name,
                description: tool.description,
                server: serverName,
                requiresApproval: tool.requiresApproval ?? true,
                enabled: tool.enabled ?? true
              });
            });
          }
        }
        
        setTools(allTools);
        setToolCount(allTools.length);
        
        // Show helpful message about server connections
        if (data.metadata?.servers) {
          const connectedServers = data.metadata.servers.filter((s: any) => s.connected).length;
          const totalServers = data.metadata.servers.length;
          
          if (connectedServers < totalServers) {
            setError(`Connected to ${connectedServers}/${totalServers} MCP servers. Some servers may be temporarily unavailable.`);
          }
        }
      } else {
        setTools([]);
        setToolCount(0);
        setError(data?.error?.message || 'No MCP tools are currently available. Please check your MCP server configuration.');
      }
    } catch (fetchError) {
      setTools([]);
      setToolCount(0);
      setError(`Unable to fetch tools from MCP servers: ${(fetchError as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [apiManager]);

  // Fetch tools on mount with debouncing
  useEffect(() => {
    debouncedFetchTools();
  }, [debouncedFetchTools]);

  // Group tools by server with better server name mapping
  const groupedTools = useMemo(() => {
    return tools.reduce((groups, tool) => {
      const serverKey = tool.server;
      
      if (!groups[serverKey]) {
        groups[serverKey] = [];
      }
      groups[serverKey].push(tool);
      return groups;
    }, {} as Record<string, typeof tools>);
  }, [tools]);

  // Create server display info with proper icons and names
  const getServerDisplayInfo = useCallback((serverId: string) => {
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
      color: 'text-neutral-800 dark:text-neutral-200' 
    };
  }, []);

  // Helper function to clean and render tool descriptions with markdown support
  const renderToolDescription = useCallback((description: string) => {
    // Clean up common markdown formatting issues
    const cleanDescription = description
      .replace(/\*\*([^*]+)\*\*/g, '**$1**') // Ensure proper bold formatting
      .trim();

    // Check if description contains markdown formatting
    const hasMarkdown = cleanDescription.includes('**') || 
                       cleanDescription.includes('*') || 
                       cleanDescription.includes('[') ||
                       cleanDescription.includes('#');

    if (hasMarkdown) {
      return (
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 prose prose-xs max-w-none prose-p:my-0 prose-strong:text-neutral-600 dark:prose-strong:text-neutral-300">
          <ReactMarkdown
            components={{
              // Remove paragraph margins for inline descriptions
              p: ({ children }) => <span>{children}</span>,
              // Style bold text appropriately
              strong: ({ children }) => (
                <strong className="font-medium text-neutral-600 dark:text-neutral-300">
                  {children}
                </strong>
              ),
            }}
          >
            {cleanDescription}
          </ReactMarkdown>
        </div>
      );
    } else {
      // Fallback to plain text for descriptions without markdown
      return (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          {cleanDescription}
        </p>
      );
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  // Optimized refresh function
  const handleRefresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiManager.refreshTools();
      
      if (data.tools) {
        setTools(data.tools);
        setToolCount(data.tools.length);
        
        // Show server connection status
        if (data.serverConnections) {
          const connectedServers = Object.values(data.serverConnections).filter((s: any) => s.status === 'connected').length;
          const totalServers = Object.keys(data.serverConnections).length;
          
          if (connectedServers < totalServers) {
            setError(`Refreshed tools from ${connectedServers}/${totalServers} connected servers.`);
          } else {
            setError(null); // Clear any previous errors on full success
          }
        }
      }
    } catch (err) {
      setError('Failed to refresh tools: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiManager]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <div className="relative mt-1.5">
        <CollapsibleButton
          icon={<Hammer className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
          text={t('mcpToolsButton')}
          onClick={() => setIsOpen(true)}
          isActive={isOpen || isActive}
          disabled={disabled}
          className={className}
        />
      </div>

      <DialogContent
        ref={dialogRef}
        className="p-0 gap-0 max-w-md w-full bg-white dark:bg-zinc-950 border-neutral-200 dark:border-neutral-800 shadow-lg"
      >
        <DialogTitle className="sr-only">{t('availableMcpTools')}</DialogTitle>

        <div className="flex flex-col max-h-[80vh]">
          <div className="relative px-6 py-6 border-b border-neutral-200 dark:border-neutral-800">
            {/* Close button - positioned absolute within the header */}
            <DialogPrimitive.Close
              className="absolute left-auto right-2 top-2 rounded-full p-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer z-10 flex items-center justify-center w-8 h-8 lg:w-7 lg:h-7"
              style={{
                position: 'absolute',
                left: 'auto',
                right: '0.5rem',
                top: '0.5rem'
              }}
            >
              <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              <span className="sr-only">{t('closeSidebar')}</span>
            </DialogPrimitive.Close>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 pr-10">{t('availableMcpTools')}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              ChatRAG can use tools provided by specialized servers using Model Context Protocol. 
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">{t('learnMore')}</a>
            </p>
          </div>
          
          <div className="overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-5 w-5 border-2 border-purple-600 dark:border-purple-400 border-r-transparent rounded-full animate-spin"></div>
                <span className="ml-3 text-sm text-neutral-600 dark:text-neutral-400">{t('loadingTools')}</span>
              </div>
            ) : error ? (
              <div className="space-y-4">
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-600 dark:text-yellow-400">
                  {error}
                </div>
                {/* Still show tools even if there's an error */}
                {tools.length > 0 && (
                  <div className="space-y-6">
                    {Object.entries(groupedTools).map(([serverId, serverTools]) => {
                      const serverInfo = getServerDisplayInfo(serverId);
                      const enabledTools = serverTools.filter(t => t.enabled !== false);
                      
                      return (
                        <div key={serverId} className="space-y-2">
                          <h3 className={`text-sm font-medium ${serverInfo.color} mb-2 flex items-center gap-2`}>
                            <span>{serverInfo.icon}</span>
                            <span>{serverInfo.name}</span>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">
                              ({enabledTools.length} tool{enabledTools.length !== 1 ? 's' : ''})
                            </span>
                          </h3>
                          <div className="grid gap-2">
                            {serverTools.map((tool) => (
                              <div 
                                key={tool.name} 
                                className={`group relative overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 p-3 transition-colors ${
                                  tool.enabled !== false 
                                    ? 'hover:bg-neutral-100 dark:hover:bg-neutral-900' 
                                    : 'opacity-60 bg-neutral-50 dark:bg-neutral-900/50'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                      {tool.name}
                                    </h4>
                                    {renderToolDescription(tool.description)}
                                  </div>
                                  {tool.enabled === false && (
                                    <span className="text-xs text-red-500 dark:text-red-400 font-medium">
                                      Unavailable
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Add refresh button */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="px-3 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-md hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Refresh Tools
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedTools).map(([serverId, serverTools]) => {
                  const serverInfo = getServerDisplayInfo(serverId);
                  const enabledTools = serverTools.filter(t => t.enabled !== false);
                  
                  return (
                    <div key={serverId} className="space-y-2">
                      <h3 className={`text-sm font-medium ${serverInfo.color} mb-2 flex items-center gap-2`}>
                        <span>{serverInfo.icon}</span>
                        <span>{serverInfo.name}</span>
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          ({enabledTools.length} tool{enabledTools.length !== 1 ? 's' : ''})
                        </span>
                      </h3>
                      <div className="grid gap-2">
                        {serverTools.map((tool) => (
                          <div 
                            key={tool.name} 
                            className={`group relative overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 p-3 transition-colors ${
                              tool.enabled !== false 
                                ? 'hover:bg-neutral-100 dark:hover:bg-neutral-900' 
                                : 'opacity-60 bg-neutral-50 dark:bg-neutral-900/50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                  {tool.name}
                                </h4>
                                {renderToolDescription(tool.description)}
                              </div>
                              {tool.enabled === false && (
                                <span className="text-xs text-red-500 dark:text-red-400 font-medium">
                                  Unavailable
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Always show refresh button with better loading state */}
                <div className="flex justify-center pt-2 border-t border-neutral-200 dark:border-neutral-800">
                  <button
                    onClick={handleRefresh} 
                    disabled={loading}
                    className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-md hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {loading && (
                      <div className="h-3 w-3 border-2 border-white border-r-transparent rounded-full animate-spin"></div>
                    )}
                    {loading ? 'Refreshing...' : 'Refresh Tools'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 