import { useState, useRef, useEffect } from 'react';
import { Palette, Check, ChevronDown, ChevronUp, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { CollapsibleButton } from './collapsible-button';
import { LazyMotion, m } from 'framer-motion';
import { useMultiFileUploadStore } from '@/lib/multi-file-upload-store';

// Dynamically import features to reduce initial bundle size
const loadFeatures = () => import('@/lib/framer-motion/features').then(res => res.default);

export interface ImageGenerationConfig {
  // Required
  prompt: string;
  aspectRatio: string; // FAL nano-banana uses aspect ratios (e.g., "1:1", "16:9")
  numOutputs: number;
  outputFormat: string; // FAL supports: "jpeg", "png", "webp"

  // Optional toggles/flags
  enableSafetyChecker?: boolean;
  useContext?: boolean;

  // Source images (either a single file or array provided upstream)
  sourceImage?: File;
  sourceImages?: File[];

  // Backward compatibility (deprecated, use aspectRatio)
  size?: string;

  // Optional generation parameters used upstream by ChatInput
  model?: string;
  quality?: string;
  style?: string;
  background?: string;
  compression?: number;
  moderation?: string;
  responseFormat?: string;
  maskImage?: File | string;
}

interface ImageGenerationButtonProps {
  disabled?: boolean;
  onImageGenerate: (config: ImageGenerationConfig | null) => void;
  hasText?: boolean;
  hasDocumentContext?: boolean;
  isActive?: boolean;
  sourceImage?: File;
  onSourceImageSelect?: (file: File | null) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
}

const aspectRatioOptions = [
  { label: 'Square 1:1', value: '1:1' },
  { label: 'Landscape 16:9', value: '16:9' },
  { label: 'Portrait 9:16', value: '9:16' },
  { label: 'Landscape 21:9', value: '21:9' },
  { label: 'Classic 4:3', value: '4:3' },
  { label: 'Portrait 3:4', value: '3:4' },
  { label: 'Photo 3:2', value: '3:2' },
  { label: 'Portrait 2:3', value: '2:3' },
];

const outputFormatOptions = [
  { label: 'JPEG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
];



export function ImageGenerationButton({
  disabled = false,
  onImageGenerate,
  hasText = false,
  hasDocumentContext = false,
  isActive = false,
  sourceImage = undefined,
  onSourceImageSelect,
  onMenuOpenChange,
}: ImageGenerationButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(aspectRatioOptions[0]); // Default to 1:1
  const [selectedOutputFormat, setSelectedOutputFormat] = useState(outputFormatOptions[0]); // Default to jpeg
  const [selectedNumOutputs, setSelectedNumOutputs] = useState(1);
  const [enableSafetyChecker, setEnableSafetyChecker] = useState(true);
  const [useContext, setUseContext] = useState(false);
  const [sourceImages, setSourceImages] = useState<File[]>([]);
  const [isMenuAction, setIsMenuAction] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [wasRecentlyActive, setWasRecentlyActive] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileStore = useMultiFileUploadStore();
  const { t } = useLanguage();

  // Track when active state changes
  useEffect(() => {
    if (isActive) {
      setWasRecentlyActive(true);
    } else if (!isHovered) {
      // Only reset when not hovering
      setWasRecentlyActive(false);
    }
  }, [isActive, isHovered]);

  // Special handling for menu actions to prevent flickering
  useEffect(() => {
    if (isMenuAction) {
      const timeout = setTimeout(() => {
        setIsMenuAction(false);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isMenuAction]);

  // Track when isActive changes to handle edge cases
  useEffect(() => {
    if (!isActive && isMenuAction) {
      onImageGenerate(buildConfig());
    }
  }, [isActive, isMenuAction]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onMenuOpenChange?.(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onMenuOpenChange]);

  // Mouse enter/leave handlers
  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // If we were recently active but now inactive, and mouse leaves,
    // reset wasRecentlyActive so the button can fully collapse
    if (wasRecentlyActive && !isActive) {
      setWasRecentlyActive(false);
    }
  };

  // Build configuration object
  const buildConfig = (prompt: string = ''): ImageGenerationConfig => {
    return {
      prompt,
      aspectRatio: selectedAspectRatio.value,
      outputFormat: selectedOutputFormat.value,
      numOutputs: selectedNumOutputs,
      enableSafetyChecker,
      useContext,
      sourceImages: sourceImages.length > 0 ? sourceImages : sourceImage ? [sourceImage] : undefined,
      // Backward compatibility: also provide size for older code
      size: selectedAspectRatio.value,
    };
  };

  // This is for the main button click - toggle activation state
  const handleButtonClick = () => {
    if (!isMenuAction) {
      if (!isActive) {
        // Activate
        onImageGenerate(buildConfig());
      } else {
        // Deactivate
        onImageGenerate(null);
        // Clear multiFileStore when deactivating
        multiFileStore.clearAllFiles();
        console.log('Image-generation-button: Cleared multiFileStore on deactivation');
        if (isOpen) {
          setIsOpen(false);
          onMenuOpenChange?.(false);
        }
      }
    }
  };

  // Open/close the menu without toggling the button state
  const handleRatioClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    onMenuOpenChange?.(newIsOpen);
  };


  // Handle aspect ratio option changes
  const handleAspectRatioSelect = (e: React.MouseEvent, option: typeof aspectRatioOptions[0]) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setSelectedAspectRatio(option);

    if (isActive) {
      requestAnimationFrame(() => {
        onImageGenerate(buildConfig());
      });
    }
  };

  // Handle output format option changes
  const handleOutputFormatSelect = (e: React.MouseEvent, option: typeof outputFormatOptions[0]) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setSelectedOutputFormat(option);

    if (isActive) {
      requestAnimationFrame(() => {
        onImageGenerate(buildConfig());
      });
    }
  };

  // Handle number of outputs changes
  const handleNumOutputsChange = (num: number) => {
    // Ensure the number is within bounds (FAL nano-banana supports 1-4 images)
    const clampedNum = Math.max(1, Math.min(4, num));

    setIsMenuAction(true);
    setSelectedNumOutputs(clampedNum);

    if (isActive) {
      requestAnimationFrame(() => {
        onImageGenerate(buildConfig());
      });
    }
  };

  // Handle increment/decrement buttons
  const incrementNumOutputs = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleNumOutputsChange(selectedNumOutputs + 1);
  };

  const decrementNumOutputs = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleNumOutputsChange(selectedNumOutputs - 1);
  };



  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();

    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      console.log('Image-generation-button: Files selected:', files.length);

      // Seedream v4 supports up to 10 images for editing
      const totalImages = sourceImages.length + files.length;
      if (totalImages > 10) {
        alert(`Seedream v4 supports up to 10 images. You can add ${10 - sourceImages.length} more images.`);
        files.splice(10 - sourceImages.length);
      }
      const newFiles = files.slice(0, 10 - sourceImages.length);
      setSourceImages([...sourceImages, ...newFiles]);

      // Add files to multiFileStore for display in chat input
      multiFileStore.addFiles(newFiles);
      console.log('Image-generation-button: Added files to multiFileStore:', newFiles.length);

      if (onSourceImageSelect && newFiles.length > 0) {
        onSourceImageSelect(newFiles[0]);
      }

      // If active, also update the image generation settings
      if (isActive) {
        requestAnimationFrame(() => {
          onImageGenerate(buildConfig());
        });
      } else {
        // If not active, just configure without activating
        requestAnimationFrame(() => {
          const config = buildConfig('configure-only');
          onImageGenerate(config);
        });
      }
    }

    // Reset file input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle clicking the image upload button
  const handleImageUploadClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Handle clearing the source image
  const handleClearSourceImage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setSourceImages([]);

    // Clear multiFileStore as well
    multiFileStore.clearAllFiles();
    console.log('Image-generation-button: Cleared all files from multiFileStore');

    if (onSourceImageSelect) {
      onSourceImageSelect(null);
    }

    if (isActive) {
      requestAnimationFrame(() => {
        onImageGenerate(buildConfig());
      });
    }
  };

  // Determine if we should show the expanded button with ratio
  const showExpandedWithRatio = isActive;
  // Determine if we should show the expanded button (without ratio) for hover after deactivation
  const showManualExpanded = !isActive && isHovered && wasRecentlyActive;

  return (
    <div
      className="relative mt-1.5"
      ref={dropdownRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        multiple
        className="hidden"
      />

      {showExpandedWithRatio ? (
        // Custom active button with ratio selector - only used when active
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-9 items-center justify-center rounded-xl transition-colors border-[0.5px] overflow-hidden mr-0.25",
            "bg-[#FF6417] border-[#FF6417] dark:bg-[#212121] dark:border-[#212121] hover:bg-[#E55000] dark:hover:bg-[#1A1A1A]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-center px-3 gap-1">
            <Palette className="h-5 w-5 text-[#E6E6E6]" />

            <span className="text-sm font-medium whitespace-nowrap text-[#E6E6E6]">
              {(sourceImages.length > 0 || sourceImage) ? String(t('editImage')) : String(t('generateImage'))}
            </span>

            <div
              onClick={handleRatioClick}
              className="flex items-center cursor-pointer ml-1"
            >
              <div className="flex items-center px-1 py-0 rounded-full border border-white/40 hover:bg-white/10">
                <span className="text-[10px] text-[#E6E6E6]">{selectedAspectRatio.value}</span>
                <ChevronDown className="h-2.5 w-2.5 ml-0.5 text-[#E6E6E6]" />
              </div>
            </div>
          </div>
        </button>
      ) : showManualExpanded ? (
        // Manually expanded inactive button - for hover after deactivation
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-9 items-center justify-center rounded-xl transition-colors border-[0.5px] overflow-hidden mr-0.25",
            "bg-transparent border-[#D4C0B6] dark:border-gray-600 hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-center px-3 gap-1">
            <Palette className="h-5 w-5 text-[#FFB000] dark:text-[#FFB000]" />

            <span className="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-[#9E9E9E]">
              {(sourceImages.length > 0 || sourceImage) ? String(t('editImage')) : String(t('generateImage'))}
            </span>
          </div>
        </button>
      ) : (
        // Use CollapsibleButton for all other states
        <CollapsibleButton
          icon={<Palette className="h-5 w-5 text-[#FFB000] dark:text-[#FFB000]" />}
          text={(sourceImages.length > 0 || sourceImage) ? String(t('editImage')) : String(t('generateImage'))}
          onClick={handleButtonClick}
          isActive={false}
          disabled={disabled}
        />
      )}

      {/* Menu as an absolutely positioned overlay */}
      {isOpen && (
        <LazyMotion features={loadFeatures}>
          <m.div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 bottom-[calc(100%+10px)] z-[200] w-64 rounded-xl bg-white dark:bg-[#2F2F2F] shadow-lg border border-gray-200 dark:border-gray-700"
            style={{ pointerEvents: 'auto' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-3 pt-4 px-3 pb-3 overflow-y-auto scroll-container max-h-[18rem] pr-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {aspectRatioOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={(e) => handleAspectRatioSelect(e, option)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg transition-colors",
                        selectedAspectRatio.value === option.value
                          ? "bg-[#FF6417] text-white dark:bg-[#E55000]"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Output Format
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {outputFormatOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={(e) => handleOutputFormatSelect(e, option)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg transition-colors",
                        selectedOutputFormat.value === option.value
                          ? "bg-[#FF6417] text-white dark:bg-[#E55000]"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('numberOfImages'))}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg">
                    <input
                      type="number"
                      min="1"
                      max="4"
                      value={selectedNumOutputs}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        handleNumOutputsChange(value);
                      }}
                      className="w-16 px-3 py-1.5 text-sm text-center bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none appearance-none"
                      style={{
                        MozAppearance: 'textfield',
                        WebkitAppearance: 'none'
                      }}
                    />
                    <div className="flex flex-col border-l border-gray-200 dark:border-gray-700">
                      <button
                        type="button"
                        onClick={incrementNumOutputs}
                        disabled={selectedNumOutputs >= 4}
                        className={cn(
                          "px-1.5 py-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                          selectedNumOutputs >= 4 && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <ChevronUp className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                      </button>
                      <button
                        type="button"
                        onClick={decrementNumOutputs}
                        disabled={selectedNumOutputs <= 1}
                        className={cn(
                          "px-1.5 py-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border-t border-gray-200 dark:border-gray-700",
                          selectedNumOutputs <= 1 && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <ChevronDown className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                      </button>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Max: 4</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('sourceImages'))}
                  <span className="text-xs text-gray-500 ml-1">{String(t('upToImagesLimit'))}</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleImageUploadClick}
                    className={cn(
                      "flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors",
                      "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 w-full"
                    )}
                  >
                    <ImageIcon className="h-4 w-4" />
                    {String(t('addImage'))}
                  </button>

                  {(sourceImages.length > 0 || sourceImage) && (
                    <button
                      type="button"
                      onClick={handleClearSourceImage}
                      className="px-3 py-1.5 text-sm rounded-lg transition-colors bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      {String(t('clearAll'))}
                    </button>
                  )}
                </div>

                {(sourceImages.length > 0 || sourceImage) && (
                  <div className="mt-2 space-y-1">
                    {sourceImage && !sourceImages.length && (
                      <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {sourceImage.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          {Math.round(sourceImage.size / 1024)} KB
                        </div>
                      </div>
                    )}
                    {sourceImages.map((img, idx) => (
                      <div key={idx} className="p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {idx + 1}. {img.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          {Math.round(img.size / 1024)} KB
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsMenuAction(true);
                    setEnableSafetyChecker(!enableSafetyChecker);
                    if (isActive) {
                      requestAnimationFrame(() => {
                        onImageGenerate(buildConfig());
                      });
                    }
                  }}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {String(t('safetyChecker'))}
                  </span>
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center transition-colors",
                    enableSafetyChecker
                      ? "bg-[#FF6417] dark:bg-[#E55000]"
                      : "border border-gray-300 dark:border-gray-600"
                  )}>
                    {enableSafetyChecker && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>
              </div>


              <div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsMenuAction(true);
                    const newUseContext = !useContext;
                    setUseContext(newUseContext);
                    if (isActive) {
                      // Pass the new value explicitly since setState is async
                      onImageGenerate({
                        ...buildConfig(),
                        useContext: newUseContext,
                      });
                    }
                  }}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {String(t('useDocumentContext'))}
                  </span>
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center transition-colors",
                    useContext
                      ? "bg-[#FF6417] dark:bg-[#E55000]"
                      : "border border-gray-300 dark:border-gray-600"
                  )}>
                    {useContext && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>
              </div>
            </div>
          </m.div>
        </LazyMotion>
      )}
    </div>
  );
}
