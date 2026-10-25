'use client';

import React, { useState } from 'react';
import { X, Download, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { FileToDownload } from './types/artifact.types';
import { downloadFile, downloadMultipleFiles, formatFileSize } from './utils/file-extractors';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileToDownload[];
  projectName?: string;
}

export function DownloadModal({
  isOpen,
  onClose,
  files,
  projectName = 'Artifact',
}: DownloadModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(
    new Set(files.map((_, index) => index))
  );
  const [isDownloading, setIsDownloading] = useState(false);

  const handleFileToggle = (index: number) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedFiles(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map((_, index) => index)));
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedFiles.size === 0 || isDownloading) return;

    setIsDownloading(true);
    
    try {
      const filesToDownload = Array.from(selectedFiles).map(index => files[index]);
      
      if (filesToDownload.length === 1) {
        downloadFile(filesToDownload[0]);
      } else {
        downloadMultipleFiles(filesToDownload);
      }
      
      // Close modal after successful download
      setTimeout(() => onClose(), 500);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setTimeout(() => setIsDownloading(false), 1000);
    }
  };

  const handleDownloadSingle = async (file: FileToDownload) => {
    if (isDownloading) return;
    
    setIsDownloading(true);
    
    try {
      downloadFile(file);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setTimeout(() => setIsDownloading(false), 500);
    }
  };

  const totalSelectedSize = Array.from(selectedFiles)
    .reduce((total, index) => total + (files[index]?.size || 0), 0);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Download Files
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {projectName} • {files.length} file{files.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-10 h-10 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>

          {/* File List */}
          <div className="p-6 max-h-96 overflow-y-auto">
            {/* Select All Toggle */}
            <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <div className={cn(
                  "w-4 h-4 border-2 rounded transition-colors",
                  selectedFiles.size === files.length
                    ? "bg-blue-600 border-blue-600"
                    : selectedFiles.size > 0
                    ? "bg-blue-100 border-blue-600 dark:bg-blue-900/30"
                    : "border-gray-300 dark:border-gray-600"
                )}>
                  {selectedFiles.size === files.length && (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-white rounded-full" />
                    </div>
                  )}
                </div>
                {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {selectedFiles.size} of {files.length} selected
              </span>
            </div>

            {/* File Items */}
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    selectedFiles.has(index)
                      ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
                      : "bg-white border-gray-200 dark:bg-gray-700 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                  )}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => handleFileToggle(index)}
                    className="flex-shrink-0"
                  >
                    <div className={cn(
                      "w-4 h-4 border-2 rounded transition-colors",
                      selectedFiles.has(index)
                        ? "bg-blue-600 border-blue-600"
                        : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
                    )}>
                      {selectedFiles.has(index) && (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        </div>
                      )}
                    </div>
                  </button>

                  {/* File Icon */}
                  <div className="flex-shrink-0 text-gray-600 dark:text-gray-400">
                    {file.icon}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {file.name}
                      </p>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {file.size ? formatFileSize(file.size) : ''}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {file.type.toUpperCase()} file
                    </p>
                  </div>

                  {/* Individual Download Button */}
                  <button
                    onClick={() => handleDownloadSingle(file)}
                    disabled={isDownloading}
                    className="flex-shrink-0 flex items-center justify-center w-8 h-8 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50"
                    aria-label={`Download ${file.name}`}
                  >
                    <Download size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {selectedFiles.size > 0 && (
                <span>
                  Total: {formatFileSize(totalSelectedSize)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDownloadSelected}
                disabled={selectedFiles.size === 0 || isDownloading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  selectedFiles.size > 0 && !isDownloading
                    ? "bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-600"
                )}
              >
                <Download size={16} className={cn(
                  isDownloading && "animate-bounce"
                )} />
                {isDownloading 
                  ? 'Downloading...' 
                  : selectedFiles.size === 1 
                    ? 'Download File' 
                    : `Download ${selectedFiles.size} Files`
                }
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
} 