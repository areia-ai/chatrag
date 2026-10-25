import React, { useState, useRef, useEffect } from 'react';
import { Video, Check, ChevronDown, ChevronUp, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { CollapsibleButton } from './collapsible-button';
import { LazyMotion, m } from 'framer-motion';
import { SourceImageData } from '@/types/chat';
import { useMultiFileUploadStore } from '@/lib/multi-file-upload-store';

// Dynamically import features to reduce initial bundle size
const loadFeatures = () => import('@/lib/framer-motion/features').then(res => res.default);

interface VideoGenerationConfig {
  prompt: string;
  aspectRatio?: string;
  resolution: string;
  duration: string;
  sourceImage?: SourceImageData;
  useFastMode?: boolean;
  enhancePrompt?: boolean;
  autoFix?: boolean;
  generateAudio?: boolean;
  negativePrompt?: string;
  seed?: number;
  useContext?: boolean;
}

interface VideoGenerationButtonProps {
  disabled?: boolean;
  hasDocumentContext?: boolean;
  onVideoGenerate: (config: VideoGenerationConfig | null) => void;
  hasText?: boolean;
  isActive?: boolean;
  sourceImage?: File;
  onSourceImageSelect?: (file: File | null) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
}

// Veo3 models - fast mode as default
// Duration options are now defined inside the component to use translations

// Aspect ratio options for text-to-video
const aspectRatioOptionsText = [
  { label: 'Landscape (16:9)', value: '16:9' },
  { label: 'Portrait (9:16)', value: '9:16' },
  { label: 'Square (1:1)', value: '1:1' },
];

// Aspect ratio options for image-to-video
const aspectRatioOptionsImage = [
  { label: 'Auto', value: 'auto' },
  { label: 'Landscape (16:9)', value: '16:9' },
  { label: 'Portrait (9:16)', value: '9:16' },
];

const resolutionOptions = [
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
];

export function VideoGenerationButton({
  disabled = false,
  hasDocumentContext = false,
  onVideoGenerate,
  hasText = false,
  isActive = false,
  sourceImage = undefined,
  onSourceImageSelect,
  onMenuOpenChange,
}: VideoGenerationButtonProps) {
  const { t } = useLanguage();

  // Duration options with translations (Veo3 supports only 8s)
  const durationOptions = [
    { value: '8s', label: '8s' },
  ];

  const [isOpen, setIsOpen] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(aspectRatioOptionsText[0]); // Default to 16:9
  const [selectedResolution, setSelectedResolution] = useState(resolutionOptions[0]); // Default to 720p
  const [selectedDuration, setSelectedDuration] = useState(durationOptions[0]); // Default to 8s
  const [useFastMode, setUseFastMode] = useState(true); // Default to fast mode
  const [enhancePrompt, setEnhancePrompt] = useState(false);
  const [autoFix, setAutoFix] = useState(true); // Default to true as per API
  const [generateAudio, setGenerateAudio] = useState(true);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [useContext, setUseContext] = useState(true);
  const [localSourceImage, setLocalSourceImage] = useState<File | undefined>(sourceImage);
  const [localSourceImageData, setLocalSourceImageData] = useState<SourceImageData | undefined>(undefined);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isMenuAction, setIsMenuAction] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [wasRecentlyActive, setWasRecentlyActive] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileStore = useMultiFileUploadStore();

  /**
   * Upload images and get permanent URLs for preview
   */
  const uploadImagesForPreview = async (images: File[]): Promise<SourceImageData[]> => {
    if (!images || images.length === 0) return [];

    try {
      const formData = new FormData();
      const sessionId = `preview-${Date.now()}`;

      images.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('sessionId', sessionId);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();

      if (result.errors && result.errors.length > 0) {
        console.error('Upload errors:', result.errors);
      }

      // Map upload results to SourceImageData format
      const sourceImages = result.files?.map((uploadResult: any) => ({
        name: uploadResult.originalName,
        size: uploadResult.size,
        type: uploadResult.type,
        url: uploadResult.downloadUrl
      })) || [];

      return sourceImages;

    } catch (error) {
      console.error('Error uploading images for preview:', error);
      return [];
    }
  };

  // Check if configuration has been customized
  const isConfigured = isActive && (
    selectedAspectRatio.value !== '16:9' ||
    selectedResolution.value !== '1080p' ||
    selectedDuration.value !== '8s' ||
    !useFastMode ||
    enhancePrompt ||
    !autoFix ||
    generateAudio ||
    seed !== undefined ||
    useContext ||
    localSourceImage !== undefined
  );

  // Determine which options to show based on source image
  const isImageModel = localSourceImage !== undefined;
  const aspectRatioOptions = isImageModel ? aspectRatioOptionsImage : aspectRatioOptionsText;

  // Build configuration object
  const buildConfig = (promptOverride?: string): VideoGenerationConfig | null => {
    if (promptOverride === 'deactivate') {
      return null;
    }

    const currentPrompt = promptOverride === 'current-text-placeholder'
      ? 'current-text-placeholder'
      : promptOverride || '';

    const config: VideoGenerationConfig = {
      prompt: currentPrompt,
      aspectRatio: selectedAspectRatio.value,
      resolution: selectedResolution.value,
      duration: selectedDuration.value,
      sourceImage: localSourceImageData,
      useFastMode,
      enhancePrompt,
      autoFix,
      generateAudio,
      // negativePrompt will be provided by parent component when needed
      seed,
      useContext
    };

    return config;
  };

  // Update active state when prop changes
  useEffect(() => {
    if (isActive) {
      setWasRecentlyActive(true);
    } else if (!isHovered) {
      setWasRecentlyActive(false);
    }
  }, [isActive, isHovered]);

  // Update source image when prop changes
  useEffect(() => {
    if (sourceImage !== localSourceImage) {
      setLocalSourceImage(sourceImage);
    }
  }, [sourceImage, localSourceImage]);

  // Special handling for menu actions to prevent flickering
  useEffect(() => {
    if (isMenuAction) {
      const timeout = setTimeout(() => {
        setIsMenuAction(false);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isMenuAction]);

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

  // Main button click handler
  const handleButtonClick = () => {
    if (!isMenuAction) {
      if (!isActive) {
        // Activate - pass 'configure-only' to activate the mode
        onVideoGenerate(buildConfig('configure-only'));
      } else {
        // Deactivate
        onVideoGenerate(null);
        // Clear any preview images from the chat input
        try {
          multiFileStore.clearAllFiles();
        } catch { }
        if (isOpen) {
          setIsOpen(false);
          onMenuOpenChange?.(false);
        }
      }
    }
  };

  // Open/close the menu
  const handleRatioClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    onMenuOpenChange?.(newIsOpen);
  };

  // Get display value for active button
  const getDisplayValue = () => {
    if (isImageModel) {
      return selectedResolution.value;
    }
    return selectedAspectRatio.value;
  };

  // Removed handleGenerateWithCurrentText - button should only toggle mode, not submit


  // Handle seed change
  const handleSeedChange = (value: string) => {
    const parsed = value ? parseInt(value, 10) : undefined;
    setSeed(isNaN(parsed!) ? undefined : parsed);

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
      });
    }
  };

  // Handle aspect ratio selection
  const handleAspectRatioSelect = (e: React.MouseEvent, option: typeof aspectRatioOptionsText[0]) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('Aspect ratio selected:', option.value, option.label);
    setIsMenuAction(true);
    setSelectedAspectRatio(option);

    if (isActive) {
      requestAnimationFrame(() => {
        // Build config with the NEW aspect ratio value directly
        const config: VideoGenerationConfig = {
          prompt: 'configure-only',
          aspectRatio: option.value, // Use the NEW value directly
          resolution: selectedResolution.value,
          duration: selectedDuration.value,
          sourceImage: localSourceImage,
          useFastMode,
          enhancePrompt,
          autoFix,
          generateAudio,
          seed,
          useContext
        };
        onVideoGenerate(config);
      });
    }
  };

  // Handle resolution selection
  const handleResolutionSelect = (e: React.MouseEvent, option: typeof resolutionOptions[0]) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setSelectedResolution(option);

    if (isActive) {
      requestAnimationFrame(() => {
        // Build config with the NEW resolution value directly
        const config: VideoGenerationConfig = {
          prompt: 'configure-only',
          aspectRatio: selectedAspectRatio.value,
          resolution: option.value, // Use the NEW value directly
          duration: selectedDuration.value,
          sourceImage: localSourceImage,
          useFastMode,
          enhancePrompt,
          autoFix,
          generateAudio,
          seed,
          useContext
        };
        onVideoGenerate(config);
      });
    }
  };

  // Handle duration selection
  const handleDurationSelect = (e: React.MouseEvent, option: typeof durationOptions[0]) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setSelectedDuration(option);

    if (isActive) {
      requestAnimationFrame(() => {
        // Build config with the NEW duration value directly
        const config: VideoGenerationConfig = {
          prompt: 'configure-only',
          aspectRatio: selectedAspectRatio.value,
          resolution: selectedResolution.value,
          duration: option.value, // Use the NEW value directly
          sourceImage: localSourceImage,
          useFastMode,
          enhancePrompt,
          autoFix,
          generateAudio,
          seed,
          useContext
        };
        onVideoGenerate(config);
      });
    }
  };

  // Handle Fast Mode toggle
  const handleFastModeToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setUseFastMode(!useFastMode);

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
      });
    }
  };

  // Handle Enhance Prompt toggle
  const handleEnhancePromptToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setEnhancePrompt(!enhancePrompt);

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
      });
    }
  };

  // Handle Auto-fix toggle
  const handleAutoFixToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setAutoFix(!autoFix);

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
      });
    }
  };

  // Handle Generate Audio toggle
  const handleGenerateAudioToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    const newGenerateAudio = !generateAudio;
    setGenerateAudio(newGenerateAudio);

    if (isActive) {
      requestAnimationFrame(() => {
        // Build config with the NEW generateAudio value directly
        const config: VideoGenerationConfig = {
          prompt: 'configure-only',
          aspectRatio: selectedAspectRatio.value,
          resolution: selectedResolution.value,
          duration: selectedDuration.value,
          sourceImage: localSourceImage,
          useFastMode,
          enhancePrompt,
          autoFix,
          generateAudio: newGenerateAudio, // Use the NEW value directly
          seed,
          useContext
        };
        onVideoGenerate(config);
      });
    }
  };

  // Handle Context toggle
  const handleContextToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsMenuAction(true);
    setUseContext(!useContext);

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
      });
    }
  };

  // Handle file selection for image-to-video
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();

    const file = e.target.files?.[0];
    if (file) {
      setLocalSourceImage(file);

      // Sync preview with chat input's multi-file store
      try {
        multiFileStore.clearAllFiles();
      } catch { }
      multiFileStore.addFiles([file]);

      if (onSourceImageSelect) {
        onSourceImageSelect(file);
      }

      // Upload the image immediately and convert to SourceImageData
      try {
        const sourceImages = await uploadImagesForPreview([file]);
        if (sourceImages.length > 0) {
          setLocalSourceImageData(sourceImages[0]);

          if (isActive) {
            requestAnimationFrame(() => {
              onVideoGenerate(buildConfig());
            });
          }
        }
      } catch (error) {
        console.error('Failed to upload source image:', error);
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle image upload button click
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

    setLocalSourceImage(undefined);
    setLocalSourceImageData(undefined);

    // Clear preview images from the chat input
    try {
      multiFileStore.clearAllFiles();
    } catch { }

    if (onSourceImageSelect) {
      onSourceImageSelect(null);
    }

    if (isActive) {
      requestAnimationFrame(() => {
        onVideoGenerate(buildConfig('configure-only'));
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
            <Video className="h-5 w-5 text-[#E6E6E6]" />

            <span className="text-sm font-medium whitespace-nowrap text-[#E6E6E6]">
              {useContext ? String(t('videoWithContext')) : String(t('generateVideo'))}
            </span>

            <div
              onClick={handleRatioClick}
              className="flex items-center cursor-pointer ml-1"
            >
              <div className="flex items-center px-1 py-0 rounded-full border border-white/40 hover:bg-white/10">
                <span className="text-[10px] text-[#E6E6E6]">{getDisplayValue()}</span>
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
            <Video className="h-5 w-5 text-green-600 dark:text-green-400" />

            <span className="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-[#9E9E9E]">
              {useContext ? String(t('videoWithContext')) : String(t('generateVideo'))}
            </span>
          </div>
        </button>
      ) : (
        // Use CollapsibleButton for all other states
        <CollapsibleButton
          icon={<Video className="h-5 w-5 text-green-600 dark:text-green-400" />}
          text={useContext ? String(t('videoWithContext')) : String(t('generateVideo'))}
          onClick={handleButtonClick}
          isActive={false}
          disabled={disabled}
        />
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />

      {/* Menu as an absolutely positioned overlay */}
      {isOpen && (
        <LazyMotion features={loadFeatures}>
          <m.div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="absolute left-0 bottom-[calc(100%+10px)] z-[200] w-64 rounded-xl bg-white dark:bg-[#2F2F2F] shadow-lg border border-gray-200 dark:border-gray-700"
            style={{ pointerEvents: 'auto' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-3 pt-4 px-3 pb-3 overflow-y-auto scroll-container max-h-[18rem] pr-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('mode'))}
                </label>
                <button
                  type="button"
                  onClick={handleFastModeToggle}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-sm rounded-lg transition-colors bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <span>{String(t('fastMode'))}</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    useFastMode ? "bg-[#FF6417]" : "bg-gray-300 dark:bg-gray-600"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                      useFastMode ? "translate-x-5" : "translate-x-0.5"
                    )} />
                  </div>
                </button>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {useFastMode ? String(t('fasterGenerationMode')) : String(t('standardQualityMode'))}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('aspectRatio'))}
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
                  {String(t('resolution'))}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {resolutionOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={(e) => handleResolutionSelect(e, option)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg transition-colors",
                        selectedResolution.value === option.value
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
                  {String(t('duration'))}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {durationOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={(e) => handleDurationSelect(e, option)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg transition-colors",
                        selectedDuration.value === option.value
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
                  {String(t('sourceImage'))}
                  <span className="text-xs text-gray-500 ml-1">{String(t('videoSizeLimit'))}</span>
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
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    {localSourceImage ? String(t('changeImage')) : String(t('uploadImage'))}
                  </button>

                  {localSourceImage && (
                    <button
                      type="button"
                      onClick={handleClearSourceImage}
                      className="px-3 py-1.5 text-sm rounded-lg transition-colors bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      {String(t('cancel'))}
                    </button>
                  )}
                </div>

                {localSourceImage && (
                  <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {localSourceImage.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      {Math.round(localSourceImage.size / 1024)} KB
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleEnhancePromptToggle}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {String(t('enhancePrompt'))}
                  </span>
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center transition-colors",
                    enhancePrompt
                      ? "bg-[#FF6417] dark:bg-[#E55000]"
                      : "border border-gray-300 dark:border-gray-600"
                  )}>
                    {enhancePrompt && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleAutoFixToggle}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {String(t('autoFix'))}
                  </span>
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center transition-colors",
                    autoFix
                      ? "bg-[#FF6417] dark:bg-[#E55000]"
                      : "border border-gray-300 dark:border-gray-600"
                  )}>
                    {autoFix && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleGenerateAudioToggle}
                  className="flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {String(t('generateAudio'))}
                  </span>
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center transition-colors",
                    generateAudio
                      ? "bg-[#FF6417] dark:bg-[#E55000]"
                      : "border border-gray-300 dark:border-gray-600"
                  )}>
                    {generateAudio && <Check className="h-3.5 w-3.5 text-white" />}
                  </div>
                </button>
              </div>

              {hasDocumentContext && (
                <div>
                  <button
                    type="button"
                    onClick={handleContextToggle}
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
              )}
            </div>
          </m.div>
        </LazyMotion>
      )}
    </div>
  );
} 
