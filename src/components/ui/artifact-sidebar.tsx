'use client';

import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ExternalLink, Copy, Check, Download, FileCode, FileText, FileJson } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { motion, AnimatePresence } from 'framer-motion';

interface ArtifactSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  language: string;
  title?: string;
}

interface FileToDownload {
  name: string;
  content: string;
  type: 'html' | 'css' | 'js';
  icon: React.ReactNode;
}

export function ArtifactSidebar({
  isOpen,
  onClose,
  code,
  language,
  title
}: ArtifactSidebarProps) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [iframeContent, setIframeContent] = useState<string>('');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [filesToDownload, setFilesToDownload] = useState<FileToDownload[]>([]);
  const [width, setWidth] = useState(600); // Width for the sidebar overlay
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Get display title based on language
  const displayTitle = title || `${language.charAt(0).toUpperCase() + language.slice(1)} Preview`;

  // Robust resize handler with proper cleanup
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = width;
    setIsResizing(true);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const newWidth = Math.max(400, Math.min(1000, startWidth - (moveEvent.clientX - startX)));
      setWidth(newWidth);
    };
    
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', cleanup, true);
      window.removeEventListener('mouseleave', cleanup, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
      resizeCleanupRef.current = null;
    };
    
    // Store cleanup function for potential external cleanup
    resizeCleanupRef.current = cleanup;
    
    window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
    window.addEventListener('mouseup', cleanup, { capture: true, passive: false });
    window.addEventListener('mouseleave', cleanup, { capture: true, passive: false });
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  // Cleanup resize on component unmount or sidebar close
  useEffect(() => {
    return () => {
      if (resizeCleanupRef.current) {
        resizeCleanupRef.current();
      }
    };
  }, []);

  // Additional cleanup when sidebar closes
  useEffect(() => {
    if (!isOpen && resizeCleanupRef.current) {
      resizeCleanupRef.current();
    }
  }, [isOpen]);

  // Extract CSS and JS from HTML if present
  const extractFilesFromHTML = (htmlCode: string) => {
    const files: FileToDownload[] = [];
    
    // Add the main HTML file
    files.push({
      name: 'index.html',
      content: htmlCode,
      type: 'html',
      icon: <FileText size={16} />
    });
    
    // Extract CSS
    const cssRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    const cssMatches = [...htmlCode.matchAll(cssRegex)];
    
    if (cssMatches.length > 0) {
      const cssContent = cssMatches.map(match => match[1]).join('\n\n');
      files.push({
        name: 'styles.css',
        content: cssContent,
        type: 'css',
        icon: <FileCode size={16} />
      });
    }
    
    // Extract JavaScript
    const jsRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    const jsMatches = [...htmlCode.matchAll(jsRegex)];
    
    if (jsMatches.length > 0) {
      const jsContent = jsMatches.map(match => match[1]).join('\n\n');
      files.push({
        name: 'script.js',
        content: jsContent,
        type: 'js',
        icon: <FileJson size={16} />
      });
    }
    
    return files;
  };

  // Handle copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Handle download
  const handleDownload = () => {
    if (language === 'html') {
      const files = extractFilesFromHTML(code);
      
      if (files.length > 1) {
        // If we have multiple files, show the modal
        setFilesToDownload(files);
        setShowDownloadModal(true);
      } else {
        // If we only have HTML, download it directly
        downloadFile('index.html', code, 'text/html');
      }
    } else if (language === 'css') {
      downloadFile('styles.css', code, 'text/css');
    } else if (language === 'js' || language === 'javascript') {
      downloadFile('script.js', code, 'application/javascript');
    } else if (language === 'svg') {
      downloadFile('image.svg', code, 'image/svg+xml');
    } else {
      // For other languages, just download as text
      downloadFile(`code.${language}`, code, 'text/plain');
    }
  };
  
  // Download a single file
  const downloadFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Generate iframe content based on language
  useEffect(() => {
    if (!code) return;

    if (language === 'html' || language === 'jsx' || language === 'tsx') {
      // For HTML/JSX/TSX, create a full HTML document
      const htmlContent = language === 'html' 
        ? code 
        : `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    html.light {
      color-scheme: light;
    }
    body { 
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      line-height: 1.5;
      background-color: white;
      color: #333;
    }
  </style>
</head>
<body>
  <div id="root">${code}</div>
</body>
</html>`;
      
      setIframeContent(htmlContent);
    } else if (language === 'css') {
      // For CSS, create a demo page with the CSS applied
      const htmlContent = `<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSS Preview</title>
  <style>
    html.light {
      color-scheme: light;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: white;
      color: #333;
    }
  </style>
  <style>${code}</style>
</head>
<body>
  <div class="container">
    <h1>CSS Preview</h1>
    <p>This is a preview of your CSS code.</p>
    <button>Button Example</button>
    <div class="box">Styled Box</div>
  </div>
</body>
</html>`;
      
      setIframeContent(htmlContent);
    } else if (language === 'svg') {
      // For SVG, just display the SVG
      setIframeContent(`<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Preview</title>
  <style>
    html.light {
      color-scheme: light;
    }
    body { 
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: white;
    }
  </style>
</head>
<body>
  ${code}
</body>
</html>`);
    } else {
      // For other languages, show a message
      setIframeContent(`<!DOCTYPE html>
<html class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    html.light {
      color-scheme: light;
    }
    body { 
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: white;
      color: #333;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div>
    <h2>Preview not available for ${language} code</h2>
    <p>Live preview is only available for HTML, CSS, and SVG code.</p>
  </div>
</body>
</html>`);
    }
  }, [code, language]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      // Add a small delay to prevent immediate closing when opening
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

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
        {isOpen && (
          <motion.aside
            ref={sidebarRef}
            className="fixed right-2 top-4 bottom-4 z-[60] bg-[#FFF1E5]/60 dark:bg-[#212121]/75 backdrop-blur-md border border-[#FFE0D0]/60 dark:border-[#2F2F2F]/60 rounded-l-2xl overflow-hidden shadow-[0_10px_25px_-5px_rgba(0,0,0,0.2),0_4px_10px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_6px_15px_-2px_rgba(0,0,0,0.3),0_2px_6px_-1px_rgba(0,0,0,0.15)]"
            style={{ width: `${width}px` }}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { type: 'spring', stiffness: 300, damping: 30, mass: 1 } }}
            exit={{ x: '100%', transition: { type: 'spring', stiffness: 400, damping: 40, mass: 0.8 } }}
          >
            <div className="flex h-full flex-col">
              {/* Header - Modern design matching sources sidebar */}
              <div className="flex items-center justify-between px-6 py-4 bg-[#FFF1E5]/30 dark:bg-[#212121]/30 backdrop-blur-sm border-b border-[#FFE0D0]/40 dark:border-[#2F2F2F]/40">
                <h2 className="text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                  {displayTitle}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 bg-[#EFE1D5]/25 hover:bg-[#FFE0D0]/50 dark:bg-black/10 dark:hover:bg-black/20 backdrop-blur-none border border-[#FFE0D0]/40 hover:border-[#FFE0D0]/70 dark:border-white/10 dark:hover:border-white/20 transition-all duration-200 hover:scale-105"
                    title="Copy code"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-100 bg-blue-100/25 hover:bg-blue-200/50 dark:bg-blue-900/10 dark:hover:bg-blue-800/20 backdrop-blur-none border border-blue-200/40 hover:border-blue-200/70 dark:border-blue-700/20 dark:hover:border-blue-600/30 transition-all duration-200 hover:scale-105"
                    title="Download code"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onClose}
                    className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 bg-[#EFE1D5]/25 hover:bg-[#FFE0D0]/50 dark:bg-black/10 dark:hover:bg-black/20 backdrop-blur-none border border-[#FFE0D0]/40 hover:border-[#FFE0D0]/70 dark:border-white/10 dark:hover:border-white/20 transition-all duration-200 hover:scale-105"
                  >
                    <X className="w-4 h-4 transition-transform duration-200 group-hover:rotate-90" />
                  </button>
                </div>
              </div>

              {/* Drag handle for resizing - Enhanced with visual feedback */}
              <div
                className={cn(
                  "absolute left-0 top-8 bottom-8 w-3 cursor-ew-resize transition-all duration-200",
                  isResizing 
                    ? "opacity-100 bg-gradient-to-r from-orange-500/40 to-orange-600/40" 
                    : "opacity-0 hover:opacity-100 bg-gradient-to-r from-orange-500/20 to-orange-600/20",
                  "rounded-r-full"
                )}
                onMouseDown={handleResizeStart}
                title="Drag to resize"
              />

              {/* Preview Content - Scrollable area with iframe */}
              <div className="flex-1 overflow-hidden">
                <div className="w-full h-full overflow-auto p-4 custom-scrollbar">
                  {iframeContent && (
                    <div className="w-full h-full rounded-xl overflow-hidden bg-white dark:bg-gray-900 border border-[#FFE0D0]/40 dark:border-[#2F2F2F]/40">
                      <iframe
                        srcDoc={iframeContent}
                        title="Code Preview"
                        className="w-full h-full border-0"
                        sandbox="allow-scripts allow-same-origin"
                        loading="lazy"
                        style={{ backgroundColor: 'white' }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      
      {/* Download Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[70]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg w-full max-w-md p-6 transform transition-all">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Download Files</h3>
              <button
                onClick={() => setShowDownloadModal(false)}
                className="flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {filesToDownload.map((file, index) => (
                <button
                  key={index}
                  onClick={() => {
                    downloadFile(file.name, file.content, `text/${file.type}`);
                    setShowDownloadModal(false);
                  }}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors text-left"
                >
                  <span className="text-gray-700 dark:text-gray-300">{file.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{file.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{file.type.toUpperCase()} file</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
} 