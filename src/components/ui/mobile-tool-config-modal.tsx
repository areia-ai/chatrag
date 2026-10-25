'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Image as ImageIcon, Video, Box, Settings, ArrowLeft, Upload, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileTools, MobileToolType } from '@/contexts/mobile-tools-context';
import { useLanguage } from '@/components/providers/language-provider';
import { motion, AnimatePresence } from 'framer-motion';
import { useMultiFileUploadStore } from '@/lib/multi-file-upload-store';

interface MobileToolConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyConfig: (config: any) => void;
  toolType: MobileToolType;
}

export function MobileToolConfigModal({
  isOpen,
  onClose,
  onApplyConfig,
  toolType,
}: MobileToolConfigModalProps) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<any>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileStore = useMultiFileUploadStore();

  // Memoize the tool configuration to prevent recreating on every render
  const toolConfig = React.useMemo(() => {
    switch (toolType) {
      case 'image-generation':
        const sizeOptions = [
          { value: 'auto', label: 'Auto' },
          { value: '1024x1024', label: 'Square (1024x1024)' },
          { value: '1536x1024', label: 'Landscape (1536x1024)' },
          { value: '1024x1536', label: 'Portrait (1024x1536)' },
        ];

        const qualityOptions = [
          { value: 'auto', label: 'Auto' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ];

        const backgroundOptions = [
          { value: 'auto', label: 'Auto' },
          { value: 'transparent', label: 'Clear' },
          { value: 'opaque', label: 'Solid' },
        ];

        const formatOptions = [
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'webp', label: 'WEBP' },
        ];

        const moderationOptions = [
          { value: 'auto', label: 'Auto' },
          { value: 'low', label: 'Low' },
        ];

        return {
          title: t('imageGenerate') || 'Image Generation',
          icon: <ImageIcon className="h-6 w-6" aria-hidden="true" />,
          color: 'bg-yellow-500',
          options: [
            {
              key: 'size',
              label: 'Size',
              type: 'select',
              options: sizeOptions,
              default: 'auto',
            },
            {
              key: 'quality',
              label: 'Quality',
              type: 'select',
              options: qualityOptions,
              default: 'auto',
            },
            {
              key: 'numOutputs',
              label: 'Number of Images',
              type: 'select',
              options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: `${i + 1} Image${i > 0 ? 's' : ''}` })),
              default: 1,
            },
            {
              key: 'sourceImages',
              label: 'Source Images (up to 16 images < 50MB each)',
              type: 'file',
              accept: 'image/*',
              default: null,
              multiple: true,
            },
            {
              key: 'useContext',
              label: 'Use document context',
              type: 'toggle',
              default: false,
            },
            {
              key: 'showAdvanced',
              label: 'Advanced Settings',
              type: 'toggle',
              default: false,
            },
            {
              key: 'background',
              label: 'Background',
              type: 'select',
              options: backgroundOptions,
              default: 'auto',
              showIf: 'showAdvanced',
            },
            {
              key: 'outputFormat',
              label: 'Output Format',
              type: 'select',
              options: formatOptions,
              default: 'png',
              showIf: 'showAdvanced',
            },
            {
              key: 'compression',
              label: 'Compression',
              type: 'slider',
              min: 0,
              max: 100,
              default: 100,
              showIf: 'showAdvanced',
              showFor: ['jpeg', 'webp'],
            },
            {
              key: 'moderation',
              label: 'Moderation',
              type: 'select',
              options: moderationOptions,
              default: 'auto',
              showIf: 'showAdvanced',
            },
          ],
        };
      case 'video-generation':
        // Veo3 aspect ratio options (matching desktop)
        const aspectRatioOptions = [
          { value: '16:9', label: 'Landscape (16:9)' },
          { value: '9:16', label: 'Portrait (9:16)' },
          { value: '1:1', label: 'Square (1:1)' },
        ];

        // Veo3 resolution options (matching desktop)
        const resolutionOptions = [
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ];

        return {
          title: t('videoGenerate') || 'Video Generation',
          icon: <Video className="h-6 w-6" />,
          color: 'bg-orange-600',
          options: [
            {
              key: 'useFastMode',
              label: 'Fast Mode',
              type: 'toggle',
              default: true,
              description: 'Faster generation with Veo3',
            },
            {
              key: 'aspectRatio',
              label: 'Aspect Ratio',
              type: 'select',
              options: aspectRatioOptions,
              default: '16:9',
            },
            {
              key: 'resolution',
              label: 'Resolution',
              type: 'select',
              options: resolutionOptions,
              default: '720p',
            },
            {
              key: 'duration',
              label: 'Duration',
              type: 'info',
              default: '8s',
              description: 'Fixed at 8 seconds (Veo3)',
            },
            {
              key: 'sourceImage',
              label: 'Source Image (optional, < 50MB)',
              type: 'file',
              accept: 'image/*',
              default: null,
            },
            {
              key: 'enhancePrompt',
              label: 'Enhance Prompt',
              type: 'toggle',
              default: false,
            },
            {
              key: 'autoFix',
              label: 'Auto-fix',
              type: 'toggle',
              default: true,
            },
            {
              key: 'generateAudio',
              label: 'Generate Audio',
              type: 'toggle',
              default: false,
            },
            {
              key: 'useContext',
              label: 'Use document context',
              type: 'toggle',
              default: false,
            },
          ],
        };
      case '3d-generation':
        // 3D generation doesn't need a config modal - it should open file picker directly
        return null;
      default:
        return null;
    }
  }, [toolType, t]);

  // Initialize config with defaults when modal opens or tool type changes
  React.useEffect(() => {
    if (toolConfig && isOpen) {
      const defaultConfig = toolConfig.options.reduce((acc, option) => {
        acc[option.key] = option.default;
        return acc;
      }, {} as any);
      setConfig(defaultConfig);
      // Don't clear multiFileStore here - we want to preserve images
    }
  }, [toolType, isOpen, toolConfig]);

  const handleConfigChange = (key: string, value: any) => {
    setConfig((prev: any) => {
      const newConfig = { ...prev, [key]: value };


      return newConfig;
    });
  };

  const handleApply = () => {
    // Include sourceImages in config when applying
    const finalConfig = { ...config };
    if (toolType === 'image-generation' && multiFileStore.files.length > 0) {
      finalConfig.sourceImages = multiFileStore.getFilesArray();
    }
    onApplyConfig(finalConfig);
    onClose();
  };

  const handleAddImages = (files: File[]) => {
    // Use multiFileStore directly for immediate sync
    multiFileStore.addFiles(files);
  };

  const handleRemoveImage = (index: number) => {
    // Use multiFileStore directly for immediate sync
    multiFileStore.removeFile(index);
  };

  const handleClearAll = () => {
    // Use multiFileStore directly for immediate sync
    multiFileStore.clearAllFiles();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !toolConfig) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-xl z-[110]"
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ opacity: 0, y: "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "100%" }}
          transition={{ duration: 0.3, type: "spring", damping: 30, stiffness: 400 }}
          className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1C1C1E] rounded-t-[28px] shadow-2xl border-t border-r border-l border-gray-200/50 dark:border-white/10 overflow-hidden flex flex-col"
          style={{
            maxHeight: 'calc(85dvh - env(safe-area-inset-top, 0px))',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg",
                toolConfig.icon && toolType === 'image-generation' && "bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-500/20",
                toolConfig.icon && toolType === 'video-generation' && "bg-gradient-to-br from-orange-500 to-red-500 shadow-red-500/20",
              )}>
                {React.cloneElement(toolConfig.icon as React.ReactElement, {
                  className: "h-5 w-5"
                } as React.HTMLAttributes<HTMLElement>)}
              </div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
                {toolConfig.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* Configuration Options */}
          <div className="p-5 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
            <div className="space-y-6">
              {toolConfig.options
                .filter((option: any) => {
                  // If option has showIf property, only show if the condition is met
                  if (option.showIf && !config[option.showIf]) {
                    return false;
                  }
                  // If option has showFor property, only show if current value is in the list
                  if (option.showFor) {
                    // For compression, check outputFormat
                    if (option.key === 'compression' && config.outputFormat) {
                      return option.showFor.includes(config.outputFormat);
                    }
                    // For other options, check model
                    if (config.model) {
                      return option.showFor.includes(config.model);
                    }
                  }
                  // If option has hideFor property, hide if current value is in the list
                  if (option.hideFor && config.model) {
                    return !option.hideFor.includes(config.model);
                  }
                  return true; // Show all other options
                })
                .map((option: any) => (
                  <div key={option.key} className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-1">
                      {option.label}
                    </label>

                    {option.type === 'select' && (
                      <div className="relative">
                        <select
                          value={config[option.key] || option.default}
                          onChange={(e) => handleConfigChange(option.key, option.key === 'numOutputs' || option.key === 'duration' || option.key === 'textureSize' ? Number(e.target.value) : e.target.value)}
                          disabled={option.disabled}
                          className={cn(
                            "w-full px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-white/10 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-gray-100 transition-all font-medium text-[15px]",
                            option.disabled && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {(() => {
                            // Check if this option has dynamic options based on another field
                            let optionsToRender = option.options;
                            if (option.dynamicOptions && config.model) {
                              const dynamicOpts = option.dynamicOptions[config.model];
                              if (dynamicOpts && dynamicOpts.length > 0) {
                                optionsToRender = dynamicOpts;
                              }
                            }
                            return optionsToRender.map((opt: any) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ));
                          })()}
                        </select>
                        <ChevronRight className="absolute right-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none rotate-90" />
                      </div>
                    )}

                    {option.type === 'file' && toolType === 'image-generation' && option.key === 'sourceImages' ? (
                      <div className="space-y-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple={true}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length > 0) {
                              handleAddImages(files);
                            }
                          }}
                          className="hidden"
                        />
                        {multiFileStore.files.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex-1 px-4 py-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all flex items-center justify-center gap-2 text-blue-600 dark:text-blue-300 font-medium"
                              >
                                <Upload className="h-4 w-4" />
                                <span className="text-sm">Add More</span>
                              </button>
                              <button
                                onClick={handleClearAll}
                                className="px-4 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/20 transition-all text-red-600 dark:text-red-300 font-medium"
                              >
                                Clear
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {multiFileStore.files.map((uploadedFile, idx) => (
                                <div key={idx} className="relative p-2 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-xl group">
                                  <button
                                    onClick={() => handleRemoveImage(idx)}
                                    className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center transition-colors shadow-sm z-10"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate pr-4">
                                    {idx + 1}. {uploadedFile.file.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500 dark:text-gray-500">
                                    {Math.round(uploadedFile.file.size / 1024)} KB
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full px-4 py-8 bg-gray-50 dark:bg-gray-800/50 border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400 group"
                          >
                            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                              <Upload className="h-5 w-5" />
                            </div>
                            <span className="text-sm font-medium">Upload Images</span>
                          </button>
                        )}
                      </div>
                    ) : option.type === 'file' ? (
                      <div className="space-y-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={option.accept}
                          multiple={option.multiple}
                          onChange={(e) => {
                            if (option.multiple) {
                              const files = Array.from(e.target.files || []);
                              handleConfigChange(option.key, files.length > 0 ? files : null);
                            } else {
                              const file = e.target.files?.[0];
                              handleConfigChange(option.key, file || null);
                            }
                          }}
                          className="hidden"
                        />
                        {config[option.key] ? (
                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex-1 px-4 py-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all flex items-center justify-center gap-2 text-blue-600 dark:text-blue-300 font-medium"
                              >
                                <Upload className="h-4 w-4" />
                                <span className="text-sm">
                                  {option.multiple && Array.isArray(config[option.key]) ? 'Add Images' : 'Change Image'}
                                </span>
                              </button>
                              <button
                                onClick={() => {
                                  handleConfigChange(option.key, null);
                                  if (fileInputRef.current) {
                                    fileInputRef.current.value = '';
                                  }
                                }}
                                className="px-4 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/20 transition-all text-red-600 dark:text-red-300 font-medium"
                              >
                                Clear
                              </button>
                            </div>
                            {option.multiple && Array.isArray(config[option.key]) ? (
                              <div className="space-y-2">
                                {config[option.key].map((file: File, idx: number) => (
                                  <div key={idx} className="p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-xl">
                                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                      {idx + 1}. {file.name}
                                    </div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-500">
                                      {Math.round(file.size / 1024)} KB
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-xl">
                                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                  {(config[option.key] as File).name}
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-500">
                                  {Math.round((config[option.key] as File).size / 1024)} KB
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full px-4 py-8 bg-gray-50 dark:bg-gray-800/50 border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400 group"
                          >
                            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                              <Upload className="h-5 w-5" />
                            </div>
                            <span className="text-sm font-medium">Upload {option.multiple ? 'Images' : 'Image'}</span>
                          </button>
                        )}
                      </div>
                    ) : null}

                    {option.type === 'toggle' && option.key === 'showAdvanced' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleConfigChange(option.key, !config[option.key]);
                        }}
                        className="flex items-center justify-between w-full px-4 py-3 mt-4 bg-gray-50 dark:bg-gray-800/30 rounded-xl transition-all hover:bg-gray-100 dark:hover:bg-gray-800/50 group"
                      >
                        <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">
                          {option.label}
                        </span>
                        <ChevronRight className={cn(
                          "h-4 w-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform",
                          config[option.key] && "transform rotate-90"
                        )} />
                      </button>
                    )}

                    {option.type === 'toggle' && option.key !== 'showAdvanced' && (
                      <div className="flex items-center justify-between w-full p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-white/5 rounded-xl">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                          {config[option.key] ? 'Enabled' : 'Disabled'}
                        </span>
                        <button
                          onClick={() => handleConfigChange(option.key, !config[option.key])}
                          className={cn(
                            "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900",
                            config[option.key]
                              ? toolConfig.color.replace('bg-', 'bg-')
                              : "bg-gray-200 dark:bg-gray-700"
                          )}
                        >
                          <span className="sr-only">Toggle {option.label}</span>
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ease-in-out",
                              config[option.key] ? "translate-x-5" : "translate-x-0.5"
                            )}
                          />
                        </button>
                      </div>
                    )}

                    {option.type === 'slider' && (
                      <div className="space-y-2">
                        <div
                          className="flex justify-between mb-2"
                        >
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{option.min}%</span>
                          <span className="text-xs font-bold text-gray-900 dark:text-white">{config[option.key]}%</span>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{option.max}%</span>
                        </div>
                        <input
                          type="range"
                          min={option.min}
                          max={option.max}
                          value={config[option.key] || option.default}
                          onChange={(e) => handleConfigChange(option.key, parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                      </div>
                    )}

                    {option.type === 'info' && (
                      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{option.default}</span>
                        {option.description && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Footer */}
          <div
            className="p-4 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5 backdrop-blur-sm flex-shrink-0"
          >
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3.5 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-[15px] shadow-sm"
              >
                {t('cancelTool') || 'Cancel'}
              </button>
              <button
                onClick={handleApply}
                className={cn(
                  "flex-1 px-4 py-3.5 text-white rounded-2xl transition-all shadow-lg hover:shadow-xl font-bold text-[15px]",
                  toolConfig.color,
                  // Add specific shadow based on color
                  toolType === 'image-generation' && "shadow-orange-500/25 hover:shadow-orange-500/40",
                  toolType === 'video-generation' && "shadow-red-500/25 hover:shadow-red-500/40",
                  "hover:opacity-95 active:scale-[0.98]"
                )}
              >
                Apply Settings
              </button>
            </div>
          </div>

          {/* Bottom spacer - extends modal background behind browser toolbar */}
          <div
            className="flex-shrink-0 bg-gray-50/50 dark:bg-white/5"
            style={{
              height: 'max(44px, env(safe-area-inset-bottom, 44px))',
            }}
            aria-hidden="true"
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
} 
