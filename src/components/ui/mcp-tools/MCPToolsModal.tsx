'use client';

import React, { useEffect, useRef } from 'react';
import { X, RefreshCw, Hammer, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { useMCPToolsModal } from './hooks/useMCPToolsModal';
import { SearchBar } from './components/SearchBar';
import { ServerSection } from './components/ServerSection';
import { ToolsList } from './components/ToolsList';
import styles from './styles/mcp-tools.module.css';

interface MCPToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MCPToolsModal({ isOpen, onClose }: MCPToolsModalProps) {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  const { t } = useLanguage();
  const contentRef = useRef<HTMLDivElement>(null);
  
  const {
    tools,
    loading,
    error,
    lastUpdated,
    searchTerm,
    filteredTools,
    toolsByServer,
    fetchTools,
    setSearchTerm,
    handleDialogOpenChange,
  } = useMCPToolsModal(isOpen, onClose);

  // Fetch tools when modal opens
  useEffect(() => {
    if (isOpen) {
      // Use cached data first, then fetch fresh data
      fetchTools();
    }
  }, [isOpen, fetchTools]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleDialogOpenChange(false);
    }
  };

  const handleRefresh = () => {
    fetchTools(true); // Force refresh
  };

  if (!isOpen) return null;

  const hasTools = filteredTools.length > 0;
  const showVirtualList = filteredTools.length > 20; // Use virtual scrolling for 20+ tools

  return (
    <div
      className={cn(styles.modalBackdrop, isDarkMode && styles.dark)}
      onClick={handleBackdropClick}
    >
      <div
        className={cn(styles.modalContent, isDarkMode && styles.dark)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={cn(styles.header, isDarkMode && styles.dark)}>
          <h2 className={cn(styles.headerTitle, isDarkMode && styles.dark)}>
            MCP Tools
          </h2>
          <div className={styles.headerActions}>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={cn(styles.iconButton, isDarkMode && styles.dark)}
              aria-label="Refresh tools"
            >
              <RefreshCw className={cn("h-4 w-4 lg:h-3.5 lg:w-3.5", loading && styles.spinning)} />
            </button>
            <button
              onClick={() => handleDialogOpenChange(false)}
              className={cn(styles.iconButton, isDarkMode && styles.dark)}
              aria-label={t('closeSidebar') || 'Close'}
            >
              <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={styles.content} ref={contentRef}>
          {/* Search Bar */}
          {tools.length > 5 && (
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              isDarkMode={isDarkMode}
              placeholder="Search tools..."
            />
          )}

          {/* Loading State */}
          {loading && tools.length === 0 && (
            <div className={styles.loadingContainer}>
              <div className={styles.loadingContent}>
                <RefreshCw className={cn(styles.loadingIcon, isDarkMode && styles.dark)} />
                <p className={cn(styles.loadingText, isDarkMode && styles.dark)}>
                  Loading tools...
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !loading && tools.length === 0 && (
            <div className={styles.errorContainer}>
              <div className={styles.errorContent}>
                <AlertCircle className={cn(styles.errorIcon, isDarkMode && styles.dark)} />
                <p className={cn(styles.errorText, isDarkMode && styles.dark)}>
                  {error}
                </p>
                <button
                  onClick={handleRefresh}
                  className={cn(styles.retryButton, isDarkMode && styles.dark)}
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Warning Banner */}
          {error && !loading && tools.length > 0 && (
            <div className={cn(styles.warningBanner, isDarkMode && styles.dark)}>
              {error}
            </div>
          )}

          {/* Empty State */}
          {!loading && tools.length === 0 && !error && (
            <div className={styles.emptyContainer}>
              <div className={styles.emptyContent}>
                <Hammer className={cn(styles.emptyIcon, isDarkMode && styles.dark)} />
                <p className={cn(styles.emptyText, isDarkMode && styles.dark)}>
                  No tools available
                </p>
              </div>
            </div>
          )}

          {/* Tools List */}
          {!loading && hasTools && (
            <>
              {showVirtualList ? (
                // Use virtual scrolling for large lists
                <ToolsList tools={filteredTools} isDarkMode={isDarkMode} />
              ) : (
                // Regular rendering for small lists
                <div>
                  {Object.entries(toolsByServer).map(([server, serverTools]) => {
                    // Calculate start index for animation delays
                    const startIndex = filteredTools.findIndex(
                      t => t.server === server
                    );
                    
                    return (
                      <ServerSection
                        key={server}
                        serverName={server}
                        tools={serverTools}
                        isDarkMode={isDarkMode}
                        startIndex={startIndex}
                      />
                    );
                  })}
                </div>
              )}

              {/* Footer */}
              {lastUpdated && (
                <div className={cn(styles.footer, isDarkMode && styles.dark)}>
                  <p className={cn(styles.lastUpdated, isDarkMode && styles.dark)}>
                    Last updated: {lastUpdated.toLocaleTimeString()}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Safe area padding for mobile devices */}
        <div className={cn(styles.safeArea, isDarkMode && styles.dark)} />
      </div>
    </div>
  );
}