'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, FileText, Compass } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { motion, AnimatePresence } from 'framer-motion';
import { useSources } from '../providers/sources-provider';

interface Source {
  title: string;
  url?: string;
  content?: string;
  snippet?: string;
  date?: string;
  favicon?: string;
  provider?: string;
  type: 'web' | 'document' | 'tool_link';
  uploadedAt?: string;
  documentId?: string;
  explicitly_referenced?: boolean;
  toolName?: string;
  toolResultId?: string;
}

interface SourcesSidebarProps {
  sources: Source[];
}

// Component to handle web source icons with fallback
function WebSourceIcon({ favicon }: { favicon?: string }) {
  const [imageError, setImageError] = useState(false);

  // If no favicon provided or if image failed to load, show compass icon
  if (!favicon || imageError) {
    return <Compass className="w-4 h-4 mt-1 text-gray-600 dark:text-gray-400" />;
  }

  return (
    <>
      <Image
        src={favicon}
        alt=""
        width={16}
        height={16}
        className="w-4 h-4 mt-1"
        unoptimized
        onError={() => setImageError(true)}
      />
    </>
  );
}

export function SourcesSidebar({
  sources
}: SourcesSidebarProps) {
  const { resolvedTheme } = useTheme();
  const { isSourcesOpen, trackedSetIsSourcesOpen } = useSources();
  const [width, setWidth] = useState(400);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  // Debug: Track isSourcesOpen state changes
  useEffect(() => {
    // Debug: isSourcesOpen state changed
  }, [isSourcesOpen]);
  
  // Add event listeners for both close and open events
  useEffect(() => {
    const handleForcedClose = (e: CustomEvent) => {
      // Debug: Received forceSidebarClose event
      // Only act on user-triggered close events or explicit programmatic closes
      if (e.detail?.caller?.includes('USER_CLICK') || e.detail?.caller?.includes('SELF_CLOSE')) {
        trackedSetIsSourcesOpen(false, 'SourcesSidebar_ForcedClose');
      }
    };
    
    const handleForcedOpen = (e: CustomEvent) => {
      // Debug: Received forceSidebarOpen event
      // Only act on user-triggered open events (from the Sources button)
      if (e.detail?.caller?.includes('USER_CLICK')) {
        trackedSetIsSourcesOpen(true, 'SourcesSidebar_ForcedOpen');
      }
    };
    
    window.addEventListener('forceSidebarClose', handleForcedClose as EventListener);
    window.addEventListener('forceSidebarOpen', handleForcedOpen as EventListener);
    
    return () => {
      window.removeEventListener('forceSidebarClose', handleForcedClose as EventListener);
      window.removeEventListener('forceSidebarOpen', handleForcedOpen as EventListener);
    };
  }, [trackedSetIsSourcesOpen]);

  // Make the close handler more robust with additional logging
  const handleClose = React.useCallback((e?: React.MouseEvent | MouseEvent) => {
    // Prevent default and stop propagation if event provided
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Debug: Close handler called
    
    // Directly force the state to false, regardless of current state
    trackedSetIsSourcesOpen(false, 'SourcesSidebar_CloseHandler');

    // Also dispatch a global event as a backup
    setTimeout(() => {
      const closeEvent = new CustomEvent('forceSidebarClose', { 
        detail: { caller: 'SourcesSidebar_SELF_CLOSE' } 
      });
      window.dispatchEvent(closeEvent);
    }, 10);
  }, [trackedSetIsSourcesOpen]);
  
  // Add a function specifically for testing toggle
  const testToggle = React.useCallback(() => {
    const newState = !isSourcesOpen;
    // Debug: Test toggle called
    trackedSetIsSourcesOpen(newState, 'SourcesSidebar_TestToggle');
  }, [isSourcesOpen, trackedSetIsSourcesOpen]);
  
  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSourcesOpen) {
        // Debug: Escape key pressed, closing sidebar
        trackedSetIsSourcesOpen(false, 'SourcesSidebar_EscapeKey');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSourcesOpen, trackedSetIsSourcesOpen]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-sources-toggle="true"]')) {
        return;
      }

      if (isSourcesOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        // Debug: Click outside detected, closing sidebar
        trackedSetIsSourcesOpen(false, 'SourcesSidebar_ClickOutside');
      }
    };

    if (isSourcesOpen) {
      // Add a small delay to prevent immediate closing when opening
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isSourcesOpen, trackedSetIsSourcesOpen]);

  // Debug: Process and validate source data
  useEffect(() => {
    // Debug: Received sources for processing
    
    // Validate and filter sources to ensure they have proper types
    const validSources = sources.filter(s => {
      // Check if source has a valid type
      if (s.type === 'document' || s.type === 'web' || s.type === 'tool_link') {
        return true;
      }
      // Log invalid sources for debugging
      console.warn('[SourcesSidebar] Source missing valid type, filtering out:', s);
      return false;
    });
    
    // Count document vs web sources
    const docSources = validSources.filter(s => s.type === 'document');
    const webSources = validSources.filter(s => s.type === 'web');
    const toolSources = validSources.filter(s => s.type === 'tool_link');
    // Debug: Source breakdown calculated
    
    // Debug: Document details processed
    
    // Debug when we have sources but they might not be rendering
    if (sources.length > 0 && validSources.length === 0) {
      console.error('[SourcesSidebar] WARNING: All sources filtered out due to invalid types:', sources);
    }
    
    // Dispatch a custom event for debugging
    if (typeof window !== 'undefined' && sources.length > 0) {
      window.dispatchEvent(new CustomEvent('sourcesLoaded', { 
        detail: { count: sources.length, types: { doc: docSources.length, web: webSources.length, tool: toolSources.length } }
      }));
    }
  }, [sources]);

  return (
    <>
      {/* Custom scrollbar styles */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.5);
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(75, 85, 99, 0.4);
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(75, 85, 99, 0.6);
        }
      `}</style>
      
      <AnimatePresence>
        {isSourcesOpen && (
          <motion.aside
            ref={sidebarRef}
            className="fixed right-2 top-4 bottom-4 z-[60] bg-[#FFF1E5]/60 dark:bg-[#212121]/75 backdrop-blur-md border border-[#FFE0D0]/60 dark:border-[#2F2F2F]/60 rounded-l-2xl overflow-hidden shadow-[0_10px_25px_-5px_rgba(0,0,0,0.2),0_4px_10px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_6px_15px_-2px_rgba(0,0,0,0.3),0_2px_6px_-1px_rgba(0,0,0,0.15)]"
            style={{ width: `${width}px` }}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { type: 'spring', stiffness: 300, damping: 30, mass: 1 } }}
            exit={{ x: '100%', transition: { type: 'spring', stiffness: 400, damping: 40, mass: 0.8 } }}
          >
            <div className="flex h-full flex-col">
              {/* Header - Modern design */}
              <div className="flex items-center justify-between px-6 py-4 bg-[#FFF1E5]/30 dark:bg-[#212121]/30 backdrop-blur-sm border-b border-[#FFE0D0]/40 dark:border-[#2F2F2F]/40">
                <h2 className="text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                  Sources
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClose}
                    className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 bg-[#EFE1D5]/25 hover:bg-[#FFE0D0]/50 dark:bg-black/10 dark:hover:bg-black/20 backdrop-blur-none border border-[#FFE0D0]/40 hover:border-[#FFE0D0]/70 dark:border-white/10 dark:hover:border-white/20 transition-all duration-200 hover:scale-105"
                  >
                    <X className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
                  </button>
                </div>
              </div>

              {/* Drag handle for resizing - Modern subtle design */}
              <div
                className="absolute left-0 top-8 bottom-8 w-3 cursor-ew-resize opacity-0 hover:opacity-100 bg-gradient-to-r from-blue-500/20 to-blue-600/20 rounded-r-full transition-all duration-200"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startWidth = width;
                  function handleMouseMove(moveEvent: MouseEvent) {
                    const newWidth = Math.max(300, Math.min(800, startWidth - (moveEvent.clientX - startX)));
                    setWidth(newWidth);
                  }
                  function handleMouseUp() {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                    document.body.style.cursor = '';
                  }
                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                  document.body.style.cursor = 'ew-resize';
                }}
              />

              {/* Sources List - Modern scrollable design */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
                {sources && Array.isArray(sources) && sources.length > 0 ? (
                  /* We have sources to display */
                  sources.filter(s => s.type === 'document' || s.type === 'web' || s.type === 'tool_link').map((source, index) => {
                    // Debug: Rendering source item
                    
                    // Determine if this source has a clickable URL
                    const hasUrl = Boolean(source.url);
                    
                    // Create the content for the source card
                    const sourceContent = (
                      <div className="flex items-start gap-3">
                        {source.type === 'web' && (
                          <WebSourceIcon favicon={source.favicon} />
                        )}
                        {source.type === 'document' && (
                          <FileText className="w-4 h-4 mt-1 text-gray-600 dark:text-gray-400" />
                        )}
                        {source.type === 'tool_link' && (
                          <ExternalLink className="w-4 h-4 mt-1 text-blue-500 dark:text-blue-400" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-medium text-sm line-clamp-2">
                              {source.title || (source.documentId ? `Document ${source.documentId.substring(0, 8)}...` : 'Unknown Source')}
                              {source.explicitly_referenced && (
                                <span className="ml-1 px-1 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-sm">
                                  Referenced
                                </span>
                              )}
                            </h3>
                            {/* Only show external icon if not making the whole card clickable */}
                            {!hasUrl && source.type === 'web' && source.url && (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                title={`Open source: ${source.url}`}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                          {source.type === 'web' && source.date && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {new Date(source.date).toLocaleDateString()}
                            </p>
                          )}
                          {source.type === 'document' && source.uploadedAt && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Uploaded: {new Date(source.uploadedAt).toLocaleDateString()}
                            </p>
                          )}
                          {(source.snippet || source.content) && (
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                              {source.snippet || source.content || "No content preview available"}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            {source.type === 'document' ? 'Document Source' : source.provider || 'Unknown Source'}
                          </p>
                        </div>
                      </div>
                    );
                    
                    // Wrap in a clickable element if it has a URL
                    return (
                      <div key={`source-${index}-${source.documentId || source.url || index}-${source.favicon || 'noicon'}`} data-source-item data-source-type={source.type} data-source-id={source.documentId || source.url}>
                        {hasUrl ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-2xl bg-white/25 hover:bg-white/40 dark:bg-black/20 dark:hover:bg-black/30 backdrop-blur-sm border border-[#FFE0D0]/60 hover:border-[#FFE0D0]/80 dark:border-white/10 dark:hover:border-white/20 p-5 hover:scale-[1.02] transition-all duration-300 cursor-pointer group"
                          >
                            {sourceContent}
                          </a>
                        ) : (
                          <div className="rounded-2xl bg-white/25 dark:bg-black/20 backdrop-blur-sm border border-[#FFE0D0]/60 dark:border-white/10 p-5">
                            {sourceContent}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  /* No sources available */
                  <div className="flex flex-col items-center justify-center h-32 rounded-2xl bg-white/20 dark:bg-black/15 backdrop-blur-sm border border-[#FFE0D0]/40 dark:border-white/10 text-gray-500 dark:text-gray-400">
                    <Compass className="w-8 h-8 mb-3 opacity-50" />
                    <p className="font-medium">No sources referenced</p>
                    <p className="text-xs mt-1 text-center px-4">This response was generated using the AI&apos;s training knowledge.</p>
                    
                    {/* Debug information - more elaborate debug data */}
                    {process.env.NODE_ENV === 'development' && (
                      <div className="mt-4 p-3 border border-gray-200 dark:border-gray-700 rounded text-xs">
                        <p className="font-semibold">Debug Info:</p>
                        <p>Sources Provider Status: {isSourcesOpen ? 'Open' : 'Closed'}</p>
                        <p>Sources Count: {sources?.length || 0}</p>
                        <p>Sources Data Type: {typeof sources}</p>
                        <p>Is Array: {Array.isArray(sources) ? 'Yes' : 'No'}</p>
                        {sources && sources.length > 0 && (
                          <div className="mt-2">
                            <p>First Source: {JSON.stringify(sources[0])}</p>
                          </div>
                        )}
                        <button 
                          onClick={testToggle}
                          className="mt-2 px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded"
                        >
                          Test Toggle Sidebar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
} 
