'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/theme-provider';

// Components
import { ResizeHandle } from './resize-handle';
import { PreviewPanel } from './preview-panel';
import { ActionToolbar } from './action-toolbar';
import { DownloadModal } from './download-modal';

// Hooks
import { useSidebarState } from './hooks/use-sidebar-state';
import { usePreview } from './hooks/use-preview';

// Types and utilities
import { ArtifactSidebarProps, FileToDownload } from './types/artifact.types';

export function ArtifactSidebar({
  isOpen,
  onClose,
  code,
  language,
  title = 'Code Preview',
  config = {},
}: ArtifactSidebarProps) {
  const { resolvedTheme } = useTheme();
  
  // Local state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadFiles, setDownloadFiles] = useState<FileToDownload[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Sidebar state management
  const {
    state: sidebarState,
    actions: sidebarActions,
    config: resizeConfig,
    isAnimating,
    hasError,
  } = useSidebarState(config.resize);

  // Preview generation
  const {
    preview,
    isLoading: isPreviewLoading,
    error: previewError,
    regenerate: regeneratePreview,
    clearError: clearPreviewError,
  } = usePreview({
    code,
    language,
    config: config.preview,
    debounceMs: 300,
  });

  // Effect to sync external isOpen state with internal state
  useEffect(() => {
    if (isOpen && sidebarState.status === 'closed') {
      sidebarActions.open();
    } else if (!isOpen && sidebarState.status !== 'closed') {
      sidebarActions.close();
    }
  }, [isOpen, sidebarState.status, sidebarActions]);

  // Effect to call external onClose when sidebar closes
  useEffect(() => {
    if (sidebarState.status === 'closed' && isOpen) {
      onClose();
    }
  }, [sidebarState.status, isOpen, onClose]);

  // Body class management for layout
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('artifact-sidebar-open');
      
      // Check if any dialog is open
      const hasDialog = document.body.classList.contains('dialog-open');
      if (hasDialog) {
        return;
      }
    } else {
      document.body.classList.remove('artifact-sidebar-open');
    }
    
    return () => {
      document.body.classList.remove('artifact-sidebar-open');
    };
  }, [isOpen]);

  // Dialog detection for hiding sidebar when dialogs are open
  useEffect(() => {
    const checkForDialogs = () => {
      setIsDialogOpen(document.body.classList.contains('dialog-open'));
    };
    
    checkForDialogs();
    
    const observer = new MutationObserver(checkForDialogs);
    observer.observe(document.body, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });
    
    return () => observer.disconnect();
  }, []);

  // Handle resize callbacks
  const handleResizeStart = useCallback(() => {
    sidebarActions.startResize(sidebarState.width);
  }, [sidebarActions, sidebarState.width]);

  const handleResizeEnd = useCallback(() => {
    sidebarActions.endResize();
  }, [sidebarActions]);

  const handleWidthChange = useCallback((width: number) => {
    sidebarActions.updateResize(width);
  }, [sidebarActions]);

  // Handle download modal
  const handleShowDownloadModal = useCallback((files: FileToDownload[]) => {
    setDownloadFiles(files);
    setShowDownloadModal(true);
  }, []);

  const handleCloseDownloadModal = useCallback(() => {
    setShowDownloadModal(false);
    setDownloadFiles([]);
  }, []);

  // Handle sidebar close
  const handleClose = useCallback(() => {
    clearPreviewError();
    sidebarActions.close();
  }, [clearPreviewError, sidebarActions]);

  // Handle retry
  const handleRetry = useCallback(() => {
    clearPreviewError();
    regeneratePreview();
  }, [clearPreviewError, regeneratePreview]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && !isDialogOpen && (
          <>
            {/* Click-to-close overlay */}
            <motion.div
              key="artifact-backdrop-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="fixed inset-0 z-40"
              onClick={handleClose}
              aria-label="Close sidebar overlay"
            />
            
            {/* Visual backdrop for mobile */}
            <motion.div
              key="artifact-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="fixed inset-0 bg-black/20 dark:bg-black/50 lg:hidden z-45"
              aria-hidden="true"
            />
          </>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {isOpen && !isDialogOpen && (
          <motion.div
            key="artifact-sidebar"
            initial={{ x: sidebarState.width }}
            animate={{ x: 0 }}
            exit={{ x: sidebarState.width }}
            transition={{ 
              type: 'spring', 
              damping: 30, 
              stiffness: 300,
              duration: isAnimating ? 0.3 : 0.1,
            }}
            className={cn(
              "fixed right-0 top-0 bottom-0 bg-white dark:bg-[#212121] shadow-lg z-50",
              "flex flex-col group overflow-hidden",
              hasError && "border-l-4 border-red-500"
            )}
            style={{ width: `${sidebarState.width}px` }}
            data-artifact-sidebar="true"
          >
            {/* Resize Handle */}
            <ResizeHandle
              width={sidebarState.width}
              config={resizeConfig}
              onWidthChange={handleWidthChange}
              onResizeStart={handleResizeStart}
              onResizeEnd={handleResizeEnd}
            />
            
            {/* Content - Preview Panel */}
            <PreviewPanel
              preview={preview}
              isLoading={isPreviewLoading}
              error={previewError}
              language={language}
              onRetry={handleRetry}
              className="flex-1"
            />
            
            {/* Footer - Action Toolbar */}
            <ActionToolbar
              code={code}
              language={language}
              onClose={handleClose}
              onShowDownloadModal={handleShowDownloadModal}
            />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Download Modal */}
      <DownloadModal
        isOpen={showDownloadModal}
        onClose={handleCloseDownloadModal}
        files={downloadFiles}
        projectName={title}
      />
    </>
  );
}

// Re-export types for convenience
export type { ArtifactSidebarProps, FileToDownload, SupportedLanguage } from './types/artifact.types'; 