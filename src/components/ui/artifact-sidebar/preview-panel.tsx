'use client';

import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { PreviewResult, SupportedLanguage } from './types/artifact.types';
import { SANDBOX_PERMISSIONS } from './utils/preview-generators';

interface PreviewPanelProps {
  preview: PreviewResult | null;
  isLoading: boolean;
  error: string | null;
  language: SupportedLanguage;
  onRetry?: () => void;
  className?: string;
}

function PreviewPanelComponent({
  preview,
  isLoading,
  error,
  language,
  onRetry,
  className,
}: PreviewPanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className={cn(
        "flex-1 flex items-center justify-center",
        "bg-gray-50 dark:bg-gray-900",
        className
      )}>
        <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Generating preview...</p>
          <div className="w-32 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-[#FF6417] rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !preview) {
    return (
      <div className={cn(
        "flex-1 flex items-center justify-center p-6",
        "bg-red-50 dark:bg-red-950/20",
        className
      )}>
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            Preview Error
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4">
            {error}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // No preview available
  if (!preview) {
    return (
      <div className={cn(
        "flex-1 flex items-center justify-center p-6",
        "bg-gray-50 dark:bg-gray-900",
        className
      )}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-gray-400 dark:text-gray-500">
              {getLanguageIcon(language)}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Preview Available
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add some code to see a live preview
          </p>
        </div>
      </div>
    );
  }

  // Preview with error warning
  if (preview.error && preview.error.recoverable) {
    return (
      <div className={cn("flex-1 flex flex-col", className)}>
        {/* Error banner */}
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-200 dark:border-yellow-800/30">
          <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Preview Warning</span>
          </div>
          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
            {preview.error.message}
          </p>
        </div>
        
        {/* Preview content */}
        <div className="flex-1">
          <PreviewIframe
            content={preview.content}
            language={language}
            hasError={!!preview.error}
          />
        </div>
      </div>
    );
  }

  // Normal preview
  return (
    <div className={cn("flex-1", className)}>
      <PreviewIframe
        content={preview.content}
        language={language}
        hasError={false}
      />
    </div>
  );
}

interface PreviewIframeProps {
  content: string;
  language: SupportedLanguage;
  hasError: boolean;
}

function PreviewIframe({ content, language, hasError }: PreviewIframeProps) {
  return (
    <iframe
      srcDoc={content}
      title={`${language.toUpperCase()} Preview`}
      className={cn(
        "w-full h-full border-0 bg-white",
        hasError && "opacity-80"
      )}
      sandbox={SANDBOX_PERMISSIONS}
      loading="lazy"
      style={{ backgroundColor: 'white' }}
      data-theme-isolated="true"
      allow="clipboard-read; clipboard-write"
    />
  );
}

function getLanguageIcon(language: SupportedLanguage): string {
  const icons: Record<SupportedLanguage, string> = {
    html: '🌐',
    css: '🎨',
    js: '⚡',
    javascript: '⚡',
    jsx: '⚛️',
    tsx: '⚛️',
    svg: '🖼️',
    json: '📋',
    markdown: '📝',
    yaml: '📄',
    xml: '📄',
    python: '🐍',
    bash: '💻',
    shell: '💻',
  };
  
  return icons[language] || '📄';
}

export const PreviewPanel = memo(PreviewPanelComponent); 