'use client';

import React, { useState, useCallback } from 'react';
import { X, Copy, Check, Download, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SupportedLanguage, FileToDownload } from './types/artifact.types';
import { 
  extractFilesFromHTML, 
  createSingleFile, 
  downloadFile,
  downloadMultipleFiles 
} from './utils/file-extractors';

interface ActionToolbarProps {
  code: string;
  language: SupportedLanguage;
  onClose: () => void;
  onShowDownloadModal?: (files: FileToDownload[]) => void;
  className?: string;
}

export function ActionToolbar({
  code,
  language,
  onClose,
  onShowDownloadModal,
  className,
}: ActionToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!code.trim()) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackError) {
        console.error('Clipboard fallback failed:', fallbackError);
      }
    }
  }, [code]);

  const handleDownload = useCallback(async () => {
    if (!code.trim() || isDownloading) return;

    setIsDownloading(true);

    try {
      if (language === 'html') {
        const files = extractFilesFromHTML(code);
        
        if (files.length > 1) {
          // Multiple files - show modal or download all
          if (onShowDownloadModal) {
            onShowDownloadModal(files);
          } else {
            downloadMultipleFiles(files);
          }
        } else {
          // Single HTML file
          downloadFile(files[0]);
        }
      } else {
        // Single file for other languages
        const file = createSingleFile(code, language);
        downloadFile(file);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setTimeout(() => setIsDownloading(false), 500);
    }
  }, [code, language, isDownloading, onShowDownloadModal]);

  const canCopy = code.trim().length > 0;
  const canDownload = code.trim().length > 0 && !isDownloading;

  return (
    <div className={cn(
      "px-4 py-3 border-t border-gray-200 dark:border-gray-800",
      "bg-gray-50 dark:bg-gray-800",
      "flex items-center justify-between gap-3",
      className
    )}>
      {/* Close button */}
      <button
        onClick={onClose}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
        aria-label="Close preview"
      >
        <X size={16} />
        <span className="hidden sm:inline">Close</span>
      </button>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {/* Copy button */}
        <button
          onClick={handleCopy}
          disabled={!canCopy}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium",
            "focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500",
            canCopy
              ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
              : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
          )}
          aria-label={copied ? "Code copied!" : "Copy code to clipboard"}
        >
          {copied ? (
            <Check size={16} className="text-green-600 dark:text-green-400" />
          ) : (
            <Copy size={16} />
          )}
          <span className="hidden sm:inline">
            {copied ? 'Copied!' : 'Copy'}
          </span>
        </button>

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={!canDownload}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium",
            "focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500",
            canDownload
              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/30"
              : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
          )}
          aria-label="Download code files"
        >
          <Download 
            size={16} 
            className={cn(
              "transition-transform",
              isDownloading && "animate-bounce"
            )}
          />
          <span className="hidden sm:inline">
            {isDownloading ? 'Downloading...' : 'Download'}
          </span>
        </button>

        {/* External link button (for future use) */}
        <button
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 opacity-50 cursor-not-allowed"
          disabled
          aria-label="Open in external editor (coming soon)"
          title="Open in external editor (coming soon)"
        >
          <ExternalLink size={16} />
          <span className="hidden lg:inline">Open</span>
        </button>
      </div>
    </div>
  );
} 