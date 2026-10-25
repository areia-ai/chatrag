'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hammer, X, RefreshCw, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';

interface MCPTool {
  name: string;
  description: string;
  server: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

interface MobileMCPToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileMCPToolsModal({ isOpen, onClose }: MobileMCPToolsModalProps) {
  const { t } = useLanguage();
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/mcp/tools');
      if (!response.ok) {
        throw new Error(`Failed to fetch tools: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Handle the new grouped format from API
      if (data && data.success && data.toolsByServer) {
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
        setLastUpdated(new Date());
        
        // Show helpful message about server connections
        if (data.metadata?.servers) {
          const connectedServers = data.metadata.servers.filter((s: any) => s.connected).length;
          const totalServers = data.metadata.servers.length;
          
          if (connectedServers < totalServers) {
            setError(`Connected to ${connectedServers}/${totalServers} MCP servers. Some servers may be temporarily unavailable.`);
          }
        }
      } else if (data && !data.success) {
        // Handle error response
        setTools([]);
        setError(data?.error?.message || 'No MCP tools are currently available. Please check your MCP server configuration.');
      } else {
        // Unexpected response format
        console.error('Unexpected API response format:', data);
        setTools([]);
        setError('Unexpected response format from MCP tools API');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tools');
      console.error('Error fetching MCP tools:', err);
      setTools([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Always fetch fresh data when modal opens
      setTools([]); // Clear existing tools
      setError(null); // Clear any previous errors
      fetchTools();
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Group tools by server
  const toolsByServer = tools.reduce((acc, tool) => {
    if (!acc[tool.server]) {
      acc[tool.server] = [];
    }
    acc[tool.server].push(tool);
    return acc;
  }, {} as Record<string, MCPTool[]>);

  // Create server display info with proper icons and names
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-[100]"
        onClick={handleBackdropClick}
      >
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2, type: "spring", damping: 25, stiffness: 400 }}
          className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1A1A1A] rounded-t-3xl shadow-2xl max-h-[80vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              MCP Tools
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchTools}
                disabled={loading}
                className={cn(
                  "mcp-modal-close-btn rounded-full transition-all duration-200 shadow-sm",
                  loading
                    ? "bg-gray-100 dark:bg-gray-800 cursor-not-allowed opacity-50"
                    : "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
                aria-label="Refresh tools"
              >
                <RefreshCw
                  className={cn(
                    "mcp-modal-close-icon text-gray-600 dark:text-gray-300",
                    loading && "animate-spin"
                  )}
                />
              </button>
              <button
                onClick={onClose}
                className="mcp-modal-close-btn rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 shadow-sm transition-all duration-200 focus:outline-none cursor-pointer"
                aria-label={t('closeSidebar') || 'Close'}
              >
                <X
                  className="mcp-modal-close-icon"
                />
                <span className="sr-only">{t('closeSidebar')}</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
            <div className="p-6">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 text-gray-500 dark:text-gray-400 animate-spin mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">Loading tools...</p>
                </div>
              </div>
            )}

            {error && !loading && tools.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <AlertCircle className="h-8 w-8 text-red-500 dark:text-red-400 mx-auto mb-3" />
                  <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                  <button
                    onClick={fetchTools}
                    className="mt-3 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {error && !loading && tools.length > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-600 dark:text-yellow-400">
                {error}
              </div>
            )}

            {!loading && tools.length === 0 && !error && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Hammer className="h-8 w-8 text-gray-400 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">No tools available</p>
                </div>
              </div>
            )}

            {!loading && Object.keys(toolsByServer).length > 0 && (
              <div className="space-y-6">
                {Object.entries(toolsByServer).map(([server, serverTools]) => {
                  const serverInfo = getServerDisplayInfo(server);
                  const enabledTools = serverTools.filter(t => t.enabled !== false);
                  
                  return (
                    <div key={server} className="space-y-3">
                      <h3 className={`text-sm font-medium ${serverInfo.color} flex items-center gap-2`}>
                        <span>{serverInfo.icon}</span>
                        <span>{serverInfo.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({enabledTools.length} tool{enabledTools.length !== 1 ? 's' : ''})
                        </span>
                      </h3>
                    <div className="space-y-2">
                      {serverTools.map((tool, index) => (
                        <motion.div
                          key={`${server}-${tool.name}-${index}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className={cn(
                            "p-4 rounded-xl border transition-colors",
                            tool.enabled !== false
                              ? "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/70"
                              : "bg-gray-100 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                  {tool.name}
                                </h4>
                                {tool.enabled !== false && (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                )}
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                {tool.description}
                              </p>
                              {tool.enabled === false && (
                                <div className="mt-2">
                                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                    Unavailable
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                );
                })}

                {lastUpdated && (
                  <p className="text-center text-xs text-gray-500 dark:text-gray-500 pt-4 border-t border-gray-200 dark:border-gray-700">
                    Last updated: {lastUpdated.toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}

            </div>
          </div>
          
          {/* Safe area padding for mobile devices */}
          <div className="h-[env(safe-area-inset-bottom)] bg-white dark:bg-[#1A1A1A]" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}