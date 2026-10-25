'use client';

import { Globe, ArrowUp, X, FileText, Paperclip, Upload, Loader2, Square, StopCircle, Mic, AudioLines, Palette, ListTodo, Paintbrush, FileX, Download, Video, ArrowLeft, Box, Hammer } from "lucide-react";
import { useRef, useEffect, useCallback, useState, useMemo, useTransition, forwardRef, useImperativeHandle } from "react";
// Removed TextareaAutosize import for better performance
import { cn } from "@/lib/utils";
import { useWebSearchStore } from "@/lib/web-search-store";
import { useFileUploadStore } from "@/lib/file-upload-store";
import { useMultiFileUploadStore } from "@/lib/multi-file-upload-store";
import { ContentPart, SourceImageData } from "@/types/chat";
import { startRecording, stopRecording, speechToText } from '@/lib/audio-utils';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { env } from '@/lib/env';
import { useAudioSettings } from '@/lib/hooks/use-audio-settings';
import { ImageGenerationButton, type ImageGenerationConfig } from './image-generation-button';
import { VideoGenerationButton } from './video-generation-button';
import { ExtendedFormEvent } from '@/types/events';
import type { ProcessedDocument } from './permanent-doc-upload-button';
import { UnifiedUploadButton } from './unified-upload-button';
import { useChatStore } from '@/lib/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { useLanguage } from '@/components/providers/language-provider';
import { useToast } from '@/components/ui/use-toast';
// Add document selector imports
import DocumentSelector from './document-selector';
import { useDocumentMentionStore, Document } from '@/lib/document-mention-store';
import { ThreeDGenerationButton } from './three-d-generation-button';
// Import the CollapsibleButton component at the top of the file
import { CollapsibleButton } from './collapsible-button';
// Import the WebSearchButton component
import { WebSearchButton } from './web-search-button';
import { useReasoningStore } from '@/lib/stores/reasoning-store';
// Import the MCPToolsButton component
import { MCPToolsButton } from './mcp-tools-button';
// Import the ReasoningButton component
import { ReasoningButton, type ReasoningConfig } from './reasoning-button';
// Import useModel hook to get selected model
import { useModel } from '@/components/providers/model-provider';
// Import mobile tools infrastructure
import { useMobileDetection } from '@/hooks/use-mobile-detection';
import { useMobileTools } from '@/contexts/mobile-tools-context';
import { MobileToolsButton } from './mobile-tools-button';
import { MobileToolsModal } from './mobile-tools-modal';
import { MobileToolConfigModal } from './mobile-tool-config-modal';
import { MobileActiveToolIndicator } from './mobile-active-tool-indicator';
import { MobileMCPToolsModal } from './mobile-mcp-tools-modal';
// Suggestion buttons are now handled in the main page component
// Voice Mode imports
import dynamic from 'next/dynamic';
import { VoiceEndButton } from './voice-end-button';

// Dynamically import VoiceModeOverlay to avoid SSR issues with WebGL/LiveKit
const VoiceModeOverlay = dynamic(
  () => import('@/components/voice/voice-mode-overlay'),
  { ssr: false }
);

// Add environment variable check
const IMAGE_GENERATION_ENABLED = process.env.NEXT_PUBLIC_IMAGE_GENERATION_ENABLED === 'true';
const VIDEO_GENERATION_ENABLED = process.env.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED === 'true';
const THREE_D_GENERATION_ENABLED = process.env.NEXT_PUBLIC_3D_GENERATION_ENABLED === 'true';
const MCP_TOOLS_LIST_ENABLED = process.env.NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED === 'true';
const VOICE_MODE_ENABLED = process.env.NEXT_PUBLIC_VOICE_MODE_ENABLED !== 'false'; // Enabled by default if not explicitly disabled

// Compile-time default for suggestions
const ENV_SHOW_SUGGESTIONS = env.NEXT_PUBLIC_SHOW_SUGGESTIONS === 'true';
// Debug: Initial ENV_SHOW_SUGGESTIONS (from env.ts)

// Helper to read the runtime flag from localStorage (falls back to the env default)
const getRuntimeSuggestionFlag = (): boolean => {
  if (typeof window === 'undefined') {
    // Server-side rendering - use the environment value
    return ENV_SHOW_SUGGESTIONS;
  }

  // More aggressively default to true unless explicitly set to false

  // Check localStorage first
  const stored = window.localStorage.getItem('SHOW_SUGGESTIONS');
  if (stored === 'false') return false;
  if (stored === 'true') return true;

  // Then check cookie
  if (document.cookie.includes('SHOW_SUGGESTIONS=false')) {
    try { window.localStorage.setItem('SHOW_SUGGESTIONS', 'false'); } catch { }
    return false;
  }

  // If we reach here, default to true, as that's the most common desired state
  // This ensures buttons appear unless explicitly disabled
  try { window.localStorage.setItem('SHOW_SUGGESTIONS', 'true'); } catch { }
  return true;
};

// Declare global window properties for storing request state
declare global {
  interface Window {
    _pendingVideoRequests?: Record<string, number>;
    _pendingImageRequests?: Record<string, number>;
    _pendingThreeDRequests?: Record<string, number>;
    _lastSubmitTime?: number;
    // Added to track initial viewport size for keyboard detection
    initialViewportHeight?: number;
    initialViewportWidth?: number;
  }
}

interface ProcessingDocument {
  name: string;
  isProcessing: boolean;
}

interface ChatInputProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement> & { messageContent?: ContentPart | ContentPart[] }) => void;
  handleStop?: () => void;
  isLoading: boolean;
  className?: string;
  placeholder?: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement> & { messageContent?: ContentPart | ContentPart[] }) => void;
  setInput: (value: string) => void;
  // Voice Mode props
  isVoiceModeActive?: boolean;
  onVoiceModeChange?: (isActive: boolean) => void;
}

// Image generation interfaces
interface ImagePlaceholder {
  id: string;
  prompt: string;
  aspectRatio: string;
  count: number;
  total: number;
  parentMessageId: string;
  status: string;
}

interface ImageProgressDetail {
  placeholderId: string;
  parentMessageId: string;
  count: number;
  total: number;
  status: string;
}

interface ImageResponseDetail {
  imageUrls: string[];
  prompt: string;
  placeholderId: string;
  parentMessageId: string;
  aspectRatio: string;
  sourceImageUrl?: string; // Add this field for source image URL
  isComplete: boolean;
}

interface ImageErrorDetail {
  error: string;
  placeholderId: string;
  rawError: string;
}

// Updated video generation settings interface
interface VideoGenerationSettings {
  isActive: boolean;
  useContext?: boolean;
  aspectRatio?: string;
  resolution?: string;
  frameCount?: number | string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  cameraFixed?: boolean;
  sourceImage?: SourceImageData | File;
  // Veo3 fields
  useFastMode?: boolean;
  enhancePrompt?: boolean;
  autoFix?: boolean;
  generateAudio?: boolean;
  seed?: number;
}

// Add 3D generation settings interface
interface ThreeDGenerationSettings {
  isActive: boolean;
  useContext?: boolean;
  textureSize?: number;
  meshSimplify?: number;
  ssSamplingSteps?: number;
  texturedMesh?: boolean;
  imageUrl?: string;
  imageFile?: File;
}

export interface ChatInputHandle {
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  input,
  handleInputChange,
  handleSubmit: parentHandleSubmit,
  handleStop,
  isLoading: parentIsLoading,
  className,
  placeholder = "Send a message...",
  onSubmit,
  setInput,
  isVoiceModeActive: controlledVoiceMode,
  onVoiceModeChange,
}, ref) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tempDocInputRef = useRef<HTMLInputElement>(null);
  const { isEnabled: isWebSearchEnabled, isAvailable: isWebSearchAvailable, toggleWebSearch } = useWebSearchStore();
  const { file, fileUrl, fileType, clearFile } = useFileUploadStore();
  const multiFileStore = useMultiFileUploadStore();
  const { t } = useLanguage();
  const audioSettings = useAudioSettings();

  // State management for controlled component
  const isTypingRef = useRef(false); // Track if user is actively typing
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPending, startTransition] = useTransition();

  // Chrome iOS detection
  useEffect(() => {
    const checkChromeIOS = () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isChrome = /CriOS/.test(navigator.userAgent);
      return isIOS && isChrome;
    };

    if (checkChromeIOS()) {
      document.documentElement.classList.add('chrome-ios');
      document.body.classList.add('chrome-ios');
    }

    return () => {
      document.documentElement.classList.remove('chrome-ios');
      document.body.classList.remove('chrome-ios');
    };
  }, []);

  // Preload framer-motion features during idle time for instant button activation
  useEffect(() => {
    // Preload framer-motion features after initial render
    if ('requestIdleCallback' in window) {
      const idleCallbackId = (window as any).requestIdleCallback(() => {
        import('@/lib/framer-motion/features').catch(() => {
          // Silent fail - features will load on demand if preload fails
        });
      });
      return () => {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleCallbackId);
        }
      };
    } else {
      // Fallback for browsers without requestIdleCallback
      const timeoutId = setTimeout(() => {
        import('@/lib/framer-motion/features').catch(() => {
          // Silent fail - features will load on demand if preload fails
        });
      }, 1000); // Load after 1 second
      return () => clearTimeout(timeoutId);
    }
  }, []);

  // Enhanced mobile viewport and keyboard detection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      let keyboardVisible = false;

      // Set initial viewport height for CSS custom properties
      const setVH = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
      };

      // Enhanced keyboard detection for mobile devices
      const handleViewportChange = () => {
        const currentHeight = window.innerHeight;
        const currentWidth = window.innerWidth;

        // Store initial dimensions on first load
        if (!window.initialViewportHeight) {
          window.initialViewportHeight = currentHeight;
          window.initialViewportWidth = currentWidth;
        }

        // Detect virtual keyboard by viewport height reduction
        const heightDifference = window.initialViewportHeight - currentHeight;
        const isLandscape = currentWidth > currentHeight;
        const threshold = isLandscape ? 100 : 150;

        const newKeyboardVisible = heightDifference > threshold;

        if (newKeyboardVisible !== keyboardVisible) {
          keyboardVisible = newKeyboardVisible;

          // Update body classes for CSS targeting
          document.body.classList.toggle('keyboard-visible', keyboardVisible);
          document.body.classList.toggle('keyboard-hidden', !keyboardVisible);
          document.body.classList.add('keyboard-transitioning');

          // Set CSS custom properties for dynamic positioning
          document.documentElement.style.setProperty(
            '--keyboard-visible-vh',
            `${currentHeight}px`
          );
          document.documentElement.style.setProperty(
            '--keyboard-adjusted-bottom',
            keyboardVisible ? `${Math.max(0, heightDifference)}px` : '0px'
          );

          // Remove transitioning class after animation completes
          setTimeout(() => {
            document.body.classList.remove('keyboard-transitioning');
          }, 300);
        }

        setVH();
      };

      // Initialize
      setVH();
      handleViewportChange();

      // Event listeners
      window.addEventListener('resize', handleViewportChange);
      window.addEventListener('orientationchange', () => {
        setTimeout(handleViewportChange, 100);
      });

      // Enhanced keyboard detection with Visual Viewport API (modern browsers)
      if (window.visualViewport) {
        const handleVisualViewportChange = () => {
          const offset = window.visualViewport ? window.innerHeight - window.visualViewport.height : 0;
          const isKeyboardOpen = offset > 100;

          document.body.classList.toggle('keyboard-visible', isKeyboardOpen);
          document.documentElement.style.setProperty(
            '--keyboard-adjusted-bottom',
            isKeyboardOpen ? `${offset}px` : '0px'
          );
        };

        window.visualViewport!.addEventListener('resize', handleVisualViewportChange);

        return () => {
          window.removeEventListener('resize', handleViewportChange);
          window.visualViewport?.removeEventListener('resize', handleVisualViewportChange);
        };
      }

      return () => {
        window.removeEventListener('resize', handleViewportChange);
      };
    }
  }, []);

  // Enhanced auto-resize function with mobile optimizations
  const autoResize = useCallback((textarea: HTMLTextAreaElement) => {
    // Store current height to prevent jumps
    const currentHeight = textarea.offsetHeight;

    // Reset height to get accurate scrollHeight
    textarea.style.height = 'auto';

    // Calculate new height with min/max constraints
    const scrollHeight = textarea.scrollHeight;

    // Add safety check to prevent extremely tall textareas
    // If scrollHeight is unreasonably large, it might be a calculation error
    const safeScrollHeight = Math.min(scrollHeight, 250); // Reduced limit for better handling with attachments

    // Debug logging for extreme height issues
    if (scrollHeight > 350) {
      console.warn('[ChatInput] Detected unusually large scrollHeight:', {
        scrollHeight,
        valueLength: textarea.value.length,
        valuePreview: textarea.value.substring(0, 100) + (textarea.value.length > 100 ? '...' : ''),
        hasNewlines: textarea.value.includes('\n'),
        lineCount: textarea.value.split('\n').length
      });
    }

    const newHeight = Math.min(Math.max(safeScrollHeight, 50), 250);

    // Only update if height actually changed to prevent jumps
    if (Math.abs(newHeight - currentHeight) > 2) {
      textarea.style.height = `${newHeight}px`;
    } else {
      textarea.style.height = `${currentHeight}px`;
    }

    // Dynamic mobile margin: expand when textarea grows past single line (~56px)
    // Use ref to avoid stale closure issues
    if (newHeight > 56) {
      if (!isTextareaExpandedRef.current) setIsTextareaExpanded(true);
    } else {
      if (isTextareaExpandedRef.current) setIsTextareaExpanded(false);
    }

    // Mobile-specific adjustments
    if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
      // Ensure textarea remains visible during resize on mobile
      requestAnimationFrame(() => {
        textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }, []);

  // Initialize textarea height on mount to prevent jump
  useEffect(() => {
    if (textareaRef.current) {
      // Set initial height based on actual content
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';

      // Apply same safety check as autoResize
      const scrollHeight = textarea.scrollHeight;
      const safeScrollHeight = Math.min(scrollHeight, 350);

      const initialHeight = Math.min(Math.max(safeScrollHeight, 50), 250);
      textarea.style.height = `${initialHeight}px`;
    }
  }, []);

  // Auto-resize textarea when input changes, especially when cleared
  useEffect(() => {
    if (textareaRef.current) {
      // Small delay to ensure DOM is updated
      const timeoutId = setTimeout(() => {
        if (textareaRef.current) {
          autoResize(textareaRef.current);
        }
      }, 0);

      return () => clearTimeout(timeoutId);
    }
  }, [input, autoResize]);


  // Simplified input handler for controlled component
  const optimizedHandleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const textarea = e.target;

      // Safety check: prevent setting extremely long values that might be image data
      if (newValue.length > 10000) {
        console.error('[ChatInput] Attempted to set extremely long input value:', {
          length: newValue.length,
          preview: newValue.substring(0, 100) + '...',
          isBase64: newValue.includes('data:image'),
          isLikelyImageData: newValue.includes('base64') || newValue.includes('data:')
        });
        // Prevent setting the value if it's likely corrupted with image data
        if (newValue.includes('data:image') || newValue.includes('base64')) {
          console.error('[ChatInput] Blocked setting input value that appears to contain image data');
          return;
        }
      }

      // Track that user is actively typing
      isTypingRef.current = true;

      // Clear existing typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set timeout to mark typing as stopped
      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
      }, 300); // Consider typing stopped after 300ms of inactivity

      // Auto-resize for UX
      autoResize(textarea);

      // Value updated via onChange

      // Call the parent's input handler (controlled component)
      handleInputChange(e);
    },
    [handleInputChange, autoResize]
  );

  // Check if input is long for UI layout purposes
  const isLongInput = useMemo(() => {
    return input.includes('\n') || input.length > 40;
  }, [input]);

  // Diagnostic: Monitor input prop for suspicious content
  useEffect(() => {
    if (input.length > 10000) {
      console.error('[ChatInput] Detected extremely long input prop:', {
        length: input.length,
        preview: input.substring(0, 200) + '...',
        hasBase64: input.includes('base64'),
        hasDataUrl: input.includes('data:'),
        hasImageData: input.includes('data:image'),
        stack: new Error().stack
      });
    }
  }, [input]);

  // Auto-focus input on mount for desktop devices
  useEffect(() => {
    // Check if it's a desktop device (not mobile/tablet)
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
    const isTablet = /iPad|Android|Tablet/i.test(navigator.userAgent);

    if (!isMobile && !isTablet && textareaRef.current) {
      // Small delay to ensure component is fully mounted and not disabled
      const focusTimeout = setTimeout(() => {
        // Only focus if the textarea is not disabled
        const isDisabled = parentIsLoading || isProcessingDoc || isGenerating3D || isRecording || isTranscribing || isMediaLoading;
        if (!isDisabled) {
          textareaRef.current?.focus();
        }
      }, 100);

      return () => clearTimeout(focusTimeout);
    }
  }, []); // Empty dependency array means this runs once on mount

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Add document selector state
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [documentSelectorPosition, setDocumentSelectorPosition] = useState({ top: 0, left: 0 });
  const { selectedDocuments, addDocument, removeDocument, clearDocuments } = useDocumentMentionStore();
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);

  // Use global reasoning store
  const reasoningStore = useReasoningStore();
  const reasoningConfig = reasoningStore.enabled ? {
    enabled: reasoningStore.enabled,
    effort: reasoningStore.effort,
    maxOutputTokens: reasoningStore.maxOutputTokens
  } : null;

  // Get selected model from ModelProvider, not ChatStore
  const { selectedModel: currentModel } = useModel();

  // State to track when we should force caret positioning (for paste, suggestions, etc.)
  const [shouldMoveCaret, setShouldMoveCaret] = useState(false);

  // Handle caret positioning only when explicitly needed
  useEffect(() => {
    if (shouldMoveCaret && textareaRef.current && input.length > 0) {
      const textarea = textareaRef.current;

      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (textarea === document.activeElement) {
          // Force the caret to the end
          textarea.setSelectionRange(input.length, input.length);

          // Force a style recalculation to fix any rendering issues
          textarea.style.transform = 'translateZ(0)';
          setTimeout(() => {
            textarea.style.transform = '';
          }, 0);
        }

        // Reset the flag
        setShouldMoveCaret(false);
      });
    }
  }, [input, shouldMoveCaret]);

  const [processingDoc, setProcessingDoc] = useState<ProcessingDocument | null>(null);
  const [tempDoc, setTempDoc] = useState<ProcessedDocument | null>(null); // Restore this line
  const [isProcessingDoc, setIsProcessingDoc] = useState<boolean>(false);
  const [docProcessingError, setDocProcessingError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [imageGenSettings, setImageGenSettings] = useState<ImageGenerationConfig | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoGenSettings, setVideoGenSettings] = useState<VideoGenerationSettings | null>(null);
  const [isVideoMenuOpen, setIsVideoMenuOpen] = useState(false);
  const [isImageMenuOpen, setIsImageMenuOpen] = useState(false);
  const [hasNegativePrompt, setHasNegativePrompt] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestionText, setSuggestionText] = useState('');
  // Add state for 3D generation
  const [threeDGenSettings, setThreeDGenSettings] = useState<ThreeDGenerationSettings | null>(null);
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const { currentChatId, chats } = useChatStore(
    useShallow((s) => ({ currentChatId: s.currentChatId, chats: s.chats }))
  );
  const currentChat = currentChatId ? chats.find(chat => chat.id === currentChatId) : null;
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Add submitting state
  const [internalVoiceMode, setInternalVoiceMode] = useState(false); // Internal voice mode state

  // Use controlled mode if prop is provided, otherwise use internal state
  const isVoiceModeActive = controlledVoiceMode ?? internalVoiceMode;
  const setIsVoiceModeActive = (active: boolean) => {
    if (onVoiceModeChange) {
      onVoiceModeChange(active);
    } else {
      setInternalVoiceMode(active);
    }
  };

  // State and ref for dynamic textarea expansion (grows margin on multi-line input)
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const isTextareaExpandedRef = useRef(isTextareaExpanded);

  // Keep ref in sync with state
  useEffect(() => {
    isTextareaExpandedRef.current = isTextareaExpanded;
  }, [isTextareaExpanded]);

  // SVG Border Animation State
  const containerRef = useRef<HTMLDivElement>(null);
  const [perimeter, setPerimeter] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const updatePerimeter = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      // Calculate perimeter for rounded rect (approximate)
      // Add a small buffer to ensure overlap/smoothness
      const p = (2 * (width + height) - 42) || 0;
      setPerimeter(p > 0 ? p : 0);
    };

    updatePerimeter();

    // Use ResizeObserver for responsive updates
    const observer = new ResizeObserver(updatePerimeter);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Border configuration
  // We prioritize process.env directly to ensure fresh values during dev HMR
  const borderGradientEnabled = (process.env.NEXT_PUBLIC_BORDER_GRADIENT_ENABLED || env.NEXT_PUBLIC_BORDER_GRADIENT_ENABLED) === 'true';
  const borderWidth = parseFloat(process.env.NEXT_PUBLIC_BORDER_WIDTH || env.NEXT_PUBLIC_BORDER_WIDTH || '2.5');
  const animationSpeed = parseFloat(process.env.NEXT_PUBLIC_BORDER_ANIMATION_SPEED || env.NEXT_PUBLIC_BORDER_ANIMATION_SPEED || '14');
  const borderEnabled = (process.env.NEXT_PUBLIC_BORDER_ENABLED || env.NEXT_PUBLIC_BORDER_ENABLED || 'true') === 'true';
  const borderLength = parseInt(process.env.NEXT_PUBLIC_BORDER_LENGTH || env.NEXT_PUBLIC_BORDER_LENGTH || '220');

  const borderColor1 = borderGradientEnabled
    ? (process.env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_1 || env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_1 || '#FF6417')
    : (process.env.NEXT_PUBLIC_BORDER_COLOR || env.NEXT_PUBLIC_BORDER_COLOR || '#FF6417');

  const borderColor2 = borderGradientEnabled
    ? (process.env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_2 || env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_2 || '#FF1744')
    : (process.env.NEXT_PUBLIC_BORDER_COLOR || env.NEXT_PUBLIC_BORDER_COLOR || '#FF6417');



  // Check for negative prompt pattern when video generation is active
  useEffect(() => {
    if (videoGenSettings && input) {
      const { hasNegative } = parseVideoPrompts(input);
      setHasNegativePrompt(hasNegative);

      // Check if we should show suggestion for "Negative prompt:"
      if (!hasNegative) {
        const lastWord = input.split(/\s+/).pop() || '';
        const lowerLastWord = lastWord.toLowerCase();

        // Check if user is starting to type "negative" or "neg"
        if (lowerLastWord && 'negative'.startsWith(lowerLastWord) && lowerLastWord.length >= 3) {
          // Calculate what to suggest based on what they've typed
          const fullPhrase = 'Negative prompt:';
          const typedLength = lastWord.length;
          const suggestion = fullPhrase.substring(typedLength);
          setSuggestionText(suggestion);
          setShowSuggestion(true);
        } else {
          setShowSuggestion(false);
          setSuggestionText('');
        }
      } else {
        // Already has negative prompt, don't suggest
        setShowSuggestion(false);
        setSuggestionText('');
      }
    } else {
      setHasNegativePrompt(false);
      setShowSuggestion(false);
      setSuggestionText('');
    }
  }, [input, videoGenSettings]);

  // Mobile tools integration
  const { isMobile, isTablet, isSmallMobile } = useMobileDetection();
  const {
    isPrimaryModalOpen,
    isSecondaryModalOpen,
    activeTool,
    openPrimaryModal,
    closePrimaryModal,
    openSecondaryModal,
    closeSecondaryModal,
    closeAllModals,
    setActiveTool,
    clearActiveTool
  } = useMobileTools();

  // Expose focus method via ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      // Always try to focus when explicitly called
      // Only prevent focus if actively recording
      if (textareaRef.current && !isRecording) {
        textareaRef.current.focus();
      }
    }
  }), [isRecording]);

  // Handle clicks on the form to focus textarea
  const handleFormClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Don't focus if clicking on these interactive elements
    const interactiveElements = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG'];
    const isInteractive = interactiveElements.includes(target.tagName) ||
      target.closest('button') ||
      target.closest('a') ||
      target.closest('[role="button"]') ||
      target.closest('[role="combobox"]') ||
      target.closest('[role="listbox"]');

    // Focus textarea if not clicking an interactive element and not recording
    if (!isInteractive && !isRecording && !isProcessingDoc && textareaRef.current) {
      e.preventDefault();
      textareaRef.current.focus();
    }
  };

  // Determine if an active tool indicator should be shown
  const shouldShowActiveToolIndicator = isMobile && (
    (// Video generation is configured  
      isWebSearchEnabled || // Web search is active
      Boolean(imageGenSettings) || // Image generation is configured
      Boolean(videoGenSettings) || Boolean(threeDGenSettings)) // 3D generation is configured
  );

  // Determine which tool is currently active
  const getActiveToolType = (): 'web-search' | 'image-generation' | 'video-generation' | '3d-generation' | 'mcp-tools' | null => {
    if (isWebSearchEnabled) return 'web-search';
    if (imageGenSettings) return 'image-generation';
    if (videoGenSettings) return 'video-generation';
    if (threeDGenSettings) return '3d-generation';
    // TODO: Add MCP tools detection when implemented
    return null;
  };

  // Parse video prompts for negative prompt pattern
  const parseVideoPrompts = (text: string) => {
    const negativePromptPattern = /Negative prompt:?\s*(.*)/i;
    const match = text.match(negativePromptPattern);

    if (match) {
      const mainPrompt = text.substring(0, match.index).trim();
      const negativePrompt = match[1].trim();
      return { mainPrompt, negativePrompt, hasNegative: true };
    }

    return { mainPrompt: text, negativePrompt: '', hasNegative: false };
  };

  // Handle canceling the active tool
  const handleCancelActiveTool = () => {
    const activeToolType = getActiveToolType();

    switch (activeToolType) {
      case 'web-search':
        handleWebSearchToggle(false);
        break;
      case 'image-generation':
        setImageGenSettings(null);
        break;
      case 'video-generation':
        setVideoGenSettings(null);
        break;
      case '3d-generation':
        setThreeDGenSettings(null);
        useFileUploadStore.getState().clearFile();
        break;
      default:
        break;
    }

    clearActiveTool();
  };

  // Handle mobile tool selection
  const handleMobileToolSelect = (toolId: string) => {
    const toolsRequiringConfig = ['image-generation', 'video-generation'];

    if (toolsRequiringConfig.includes(toolId)) {
      // Open secondary modal for configuration
      setActiveTool(toolId as any);
      openSecondaryModal(toolId as any);
      return; // Don't close primary modal yet
    }

    // Handle simple tools and 3D generation
    switch (toolId) {
      case 'web-search':
        if (isWebSearchAvailable) {
          handleWebSearchToggle(!isWebSearchEnabled);
        }
        break;
      case 'mcp-tools':
        if (MCP_TOOLS_LIST_ENABLED) {
          setIsMCPModalOpen(true);
          closePrimaryModal();
        }
        break;
      case '3d-generation':
        if (THREE_D_GENERATION_ENABLED) {
          // Toggle off if already active
          if (isGenerating3D || threeDGenSettings) {
            setThreeDGenSettings(null);
            setIsGenerating3D(false);
            useFileUploadStore.getState().clearFile();
            closePrimaryModal();
            break;
          }

          // Create and trigger file input for 3D generation
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.multiple = true;

          fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
              const files: File[] = Array.from(target.files);

              // Call the 3D generation handler with default settings
              handleThreeDGenSettingsChange(
                2048, // Default textureSize
                0.9,  // Default meshSimplify
                38,   // Default ssSamplingSteps
                false, // Default texturedMesh
                Boolean(tempDoc), // useContext if we have a document context
                files // pass array of files
              );
            }

            // Remove the input element after use
            document.body.removeChild(fileInput);
          });

          // Append to body and trigger click
          document.body.appendChild(fileInput);
          fileInput.click();
          closePrimaryModal();
        }
        break;
      default:
        break;
    }
    closePrimaryModal();
  };

  // Handle configuration modal apply
  const handleConfigApply = (config: any) => {
    console.log('🔧 handleConfigApply called with config:', config);
    switch (activeTool) {
      case 'image-generation':
        if (IMAGE_GENERATION_ENABLED) {
          // Don't clear/re-add files - modal manages multiFileStore directly now
          // Just use whatever is currently in the store
          const currentImages = multiFileStore.getFilesArray();
          console.log('🔧 handleConfigApply - currentImages from multiFileStore:', currentImages.length, 'images');
          currentImages.forEach((img, idx) => {
            console.log(`🔧 handleConfigApply - Image ${idx}:`, img.name, img.size, 'bytes');
          });

          const finalConfig = {
            prompt: '',
            size: config.size || 'auto',
            aspectRatio: '1:1', // Default for mobile, will be overridden by size if mapped later
            numOutputs: config.numOutputs || 1,
            quality: config.quality,
            background: config.background,
            outputFormat: config.outputFormat,
            compression: config.compression,
            moderation: config.moderation,
            useContext: config.useContext || false,
            sourceImages: currentImages.length > 0 ? currentImages : config.sourceImages
          };

          console.log('🔧 handleConfigApply - finalConfig.sourceImages:', finalConfig.sourceImages?.length || 0, 'images');

          // If we have images, use handleImageGenerate to properly activate the button
          // Otherwise just update settings
          if (currentImages.length > 0 || config.sourceImages?.length > 0) {
            console.log('🔧 handleConfigApply - calling handleImageGenerate with', finalConfig.sourceImages?.length || 0, 'images');
            handleImageGenerate(finalConfig);
          } else {
            console.log('🔧 handleConfigApply - no images, calling handleImageGenSettingsChange');
            handleImageGenSettingsChange(finalConfig);
          }
        }
        break;
      case 'video-generation':
        if (VIDEO_GENERATION_ENABLED) {
          setVideoGenSettings({
            isActive: true,
            aspectRatio: config.aspectRatio || '16:9',
            resolution: config.resolution || '720p',
            frameCount: '8s', // Fixed for Veo3
            useContext: config.useContext || false,
            // New Veo3 fields
            useFastMode: config.useFastMode !== false, // default true
            enhancePrompt: config.enhancePrompt || false,
            autoFix: config.autoFix !== false, // default true
            generateAudio: config.generateAudio || false,
            sourceImage: config.sourceImage,
            seed: config.seed, // Although not exposed in mobile UI yet, good to separate
          });

          // Critical: Set this to true so handleFormSubmit knows we are in video mode
          console.log('🔥 handleConfigApply: Setting isGeneratingVideo=true');
          setIsGeneratingVideo(true);
        }
        break;
      case '3d-generation':
        // 3D generation doesn't use config modal - it opens file picker directly
        break;
    }
    closeAllModals();
  };

  // ------------------------------------------------------------------
  // Suggestion buttons runtime flag handling
  // ------------------------------------------------------------------

  // Initialize with runtime value immediately on first client render
  const [showSuggestionsFlag, setShowSuggestionsFlag] = useState<boolean>(() => getRuntimeSuggestionFlag());

  // Add a one-time mount effect to double-check cookies (runs once on client-side mount)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncWithCookie = () => {
      const cookieMatch = document.cookie.match(/(?:^|;\s*)SHOW_SUGGESTIONS=([^;]+)/);
      if (cookieMatch) {
        const newValueFromCookie = cookieMatch[1] !== 'false';
        setShowSuggestionsFlag(currentFlag => {
          if (newValueFromCookie !== currentFlag) {
            // Debug: Mount/Cookie sync: updating showSuggestionsFlag
            // If updating, also sync to localStorage to be consistent
            try {
              window.localStorage.setItem('SHOW_SUGGESTIONS', newValueFromCookie ? 'true' : 'false');
            } catch { }
            return newValueFromCookie;
          }
          return currentFlag;
        });
      }
    };

    // Run once on mount, and again after a short delay to catch any immediate post-render cookie changes
    syncWithCookie();
    const timeoutId = setTimeout(syncWithCookie, 150);

    return () => clearTimeout(timeoutId);
  }, []); // Empty dependency array ensures this runs only on mount

  // ------------------------------------------------------------------
  // Listen for cross-tab/channel config updates (BroadcastChannel + cookie polling)
  // ------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Listen for config changes via BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('chatrag-config');
      bc.onmessage = (event) => {
        if (event.data && event.data.key === 'SHOW_SUGGESTIONS') {
          const newValue = event.data.value === 'true';
          // Debug: BroadcastChannel received SHOW_SUGGESTIONS
          setShowSuggestionsFlag(newValue);
        }
      };
      // Debug: BroadcastChannel listener setup for config changes
    } catch (err) {
      // Debug: BroadcastChannel not supported
    }

    // Clean up the channel when component unmounts
    return () => {
      if (bc) {
        bc.close();
      }
    };
  }, []);

  // Listen for localStorage changes via the storage event
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'SHOW_SUGGESTIONS') {
        const newValue = e.newValue !== 'false';
        // Debug: Storage event for SHOW_SUGGESTIONS
        setShowSuggestionsFlag(newValue);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Handler for when a suggestion button is clicked
  const handleNewSuggestionClick = (text: string) => {
    setInput(text);
    // Programmatically submit the form
    // Ensure the event object has the necessary structure if parentHandleSubmit expects it
    const syntheticEvent = {
      preventDefault: () => { },
      currentTarget: formRef.current, // Or null if not strictly needed
      messageContent: [{ type: 'text', text }],
    } as any;
    wrappedParentHandleSubmit(syntheticEvent);
  };

  // Create a stabilized loading state to prevent rapid transitions
  const [stableLoading, setStableLoading] = useState(parentIsLoading);

  // Manage stable loading state with debounce for smooth transitions
  useEffect(() => {
    if (parentIsLoading) {
      // When loading starts, immediately set to loading
      setStableLoading(true);
    } else {
      // When loading ends, delay the transition slightly to ensure stability
      const timer = setTimeout(() => {
        setStableLoading(false);
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [parentIsLoading]);

  // Listen for media loading state changes from the chat message component
  useEffect(() => {
    const handleMediaLoadingStateChange = (event: CustomEvent<{ isLoading: boolean }>) => {
      console.log('Received media loading state change:', event.detail);
      setIsMediaLoading(event.detail.isLoading);
    };

    // Add event listener with type assertion
    window.addEventListener('media-loading-state-change', handleMediaLoadingStateChange as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('media-loading-state-change', handleMediaLoadingStateChange as EventListener);
    };
  }, []);

  // Check if there are any loading placeholders in the current chat
  const hasLoadingPlaceholders = useMemo(() => {
    if (!currentChat?.messages?.length) return false;

    // Get the last message
    const lastMessage = currentChat.messages[currentChat.messages.length - 1];

    // If the last message is from the assistant and has content parts
    if (lastMessage && lastMessage.role === 'assistant' && Array.isArray(lastMessage.content)) {
      // Check for any loading image or video parts
      return lastMessage.content.some(part =>
        part.type === 'loading_image' ||
        part.type === 'loading_video' ||
        // Also check for image generation in progress
        (part.type === 'generated_image' &&
          (!Array.isArray((part as any).generated_images) ||
            (part as any).generated_images.length === 0))
      );
    }
    return false;
  }, [currentChat?.messages]);

  // Add a more stable check that includes processing state
  const isAnyMediaProcessing = useMemo(() => {
    return hasLoadingPlaceholders ||
      parentIsLoading ||
      (window._pendingImageRequests && Object.keys(window._pendingImageRequests).length > 0) ||
      (window._pendingVideoRequests && Object.keys(window._pendingVideoRequests).length > 0) ||
      (window._pendingThreeDRequests && Object.keys(window._pendingThreeDRequests).length > 0);
  }, [hasLoadingPlaceholders, parentIsLoading]);

  // Add a more comprehensive check for active chat content
  const hasActiveChatContent = useMemo(() => {
    return isMediaLoading || // Include the media loading state from the event
      currentChat?.messages?.some(msg => {
        // Check if message is from assistant (AI)
        if (msg.role === 'assistant') {
          // Check for array content (might have media)
          if (Array.isArray(msg.content)) {
            // Look for ANY loading media or processing states
            return msg.content.some(part =>
              part.type === 'loading_image' ||
              part.type === 'loading_video' ||
              part.type === 'generated_image' ||
              part.type === 'generated_video'
            );
          }
          // Check for string content with processing indicator
          else if (typeof msg.content === 'string') {
            return msg.content.includes('processing') ||
              msg.content.includes('loading') ||
              msg.content.includes('generating');
          }
        }
        return false;
      }) || false;
  }, [currentChat?.messages, isMediaLoading]); // Add isMediaLoading to dependencies

  // CRITICAL FIX: Enhanced input clearing mechanism with state reset
  const clearInputField = useCallback(() => {
    // Clear typing state
    isTypingRef.current = false;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Clear typing state (controlled component handles value via React state)

    // Auto-resize textarea when cleared (React will handle the value via controlled component)
    if (textareaRef.current) {
      autoResize(textareaRef.current);
    }

    // Clear parent state (throttled to prevent render loops)
    startTransition(() => {
      setInput('');
    });
  }, [setInput, autoResize]);

  // Check if this is the initial chat state with no user messages
  const isInitialChatState = useMemo(() => {
    if (!currentChat?.messages?.length) return true;

    // Check if there are only system messages (no user or AI messages yet)
    const hasOnlySystemMessages = currentChat.messages.every(msg => msg.role === 'system');
    return hasOnlySystemMessages;
  }, [currentChat?.messages]);

  // Add a more aggressive check for any activity that should hide suggestions
  const isAnyActivity = useMemo(() => {
    return parentIsLoading ||
      hasLoadingPlaceholders ||
      isAnyMediaProcessing ||
      hasActiveChatContent ||
      isMediaLoading ||
      (Boolean(currentChatId) && Boolean(currentChat?.messages?.length) && !isInitialChatState);
  }, [
    parentIsLoading,
    hasLoadingPlaceholders,
    isAnyMediaProcessing,
    hasActiveChatContent,
    isMediaLoading,
    currentChatId,
    currentChat?.messages?.length,
    isInitialChatState
  ]);

  // Track the last time streaming stopped to debounce suggestion reappearance
  const [lastStreamEndTime, setLastStreamEndTime] = useState(0);

  // Track when loading state changes to better manage transitions
  const prevLoadingRef = useRef(parentIsLoading);

  // Increase post-streaming debounce time to ensure interface stability
  useEffect(() => {
    // Detect when streaming/loading ends
    if (prevLoadingRef.current && !parentIsLoading) {
      console.log('Loading state changed from true to false - stream ended');
      // Update the lastStreamEndTime with current timestamp
      setLastStreamEndTime(Date.now());

      // Trigger the ai-stream-completed event when streaming ends
      if (typeof window !== 'undefined') {
        console.log('ChatInput: Dispatching ai-stream-completed event');
        const streamCompletedEvent = new CustomEvent('ai-stream-completed', {
          detail: { timestamp: Date.now(), source: 'chatInput' }
        });
        window.dispatchEvent(streamCompletedEvent);
      }
    }

    // Update the ref for future comparisons
    prevLoadingRef.current = parentIsLoading;
  }, [parentIsLoading]);

  // Check if we're in the post-streaming debounce period (increased to 5 seconds for stability)
  const isInPostStreamingDebounce = useMemo(() => {
    if (lastStreamEndTime === 0) return false;
    const inDebounce = Date.now() - lastStreamEndTime < 5000;
    return inDebounce;
  }, [lastStreamEndTime]);

  // Modified condition: show suggestions when:
  // 1. SHOW_SUGGESTIONS flag is enabled
  // 2. NOT in any stable loading state (stableLoading is false)
  // 3. NOT in any media loading state (isMediaLoading is false)
  // 4. NOT in any activity state (isAnyActivity is false)
  // 5. NOT in post-streaming debounce
  // 6. NOT has any loading placeholders
  // 7. NOT when there's a current chat ID (even before messages are loaded)
  // 8. NOT when current chat has Gmail emails results
  const hasGmailResults = useMemo(() => {
    if (!currentChat?.messages?.length) return false;

    return currentChat.messages.some(msg => {
      if (Array.isArray(msg.content)) {
        // Check for tool_result parts specifically from a gmail tool
        return msg.content.some(part => {
          // First check if it's a tool_result type
          if (part.type === 'tool_result') {
            // Properly type the part to avoid type errors
            const toolResultPart = part as {
              type: string;
              tool?: string;
              toolName?: string;
              result?: any;
            };

            // Check if it's Gmail-related by tool or toolName property
            const toolValue = toolResultPart.tool || toolResultPart.toolName || '';
            return typeof toolValue === 'string' &&
              toolValue.toLowerCase().includes('gmail');
          }
          return false;
        });
      }
      return false;
    });
  }, [currentChat?.messages]);

  // Check if there are ANY messages in the current conversation or if we have a chat ID
  const hasAnyMessages = useMemo(() => {
    // If there's a current chat with any messages, consider it active
    if (currentChatId && currentChat?.messages && currentChat.messages.length > 0) {
      return true;
    }
    // If we have a current chat ID at all, consider this an active chat
    if (currentChatId) {
      return true;
    }
    return false;
  }, [currentChatId, currentChat?.messages]);

  // SIMPLIFIED: We removed stableSuggestions state which was causing problems
  // Instead we use a direct unified condition in the JSX 

  // Monitor suggestion visibility state changes
  useEffect(() => {
    // Enhanced condition: Show suggestions when no meaningful messages exist
    const hasNoMeaningfulMessages = !currentChat?.messages?.length ||
      currentChat.messages.every(msg => msg.role === 'system');

    const isVisible = (
      showSuggestionsFlag === true &&
      !parentIsLoading &&
      (!currentChatId || hasNoMeaningfulMessages)
    );

    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('[SUGGESTION DEBUG] Visibility check:', {
        showSuggestionsFlag,
        currentChatId,
        parentIsLoading,
        hasNoMeaningfulMessages,
        currentChatMessagesLength: currentChat?.messages?.length || 0,
        isVisible,
        timestamp: new Date().toISOString()
      });
    }
  }, [showSuggestionsFlag, currentChatId, parentIsLoading, currentChat?.messages]);

  // Debug: Chat input state tracking for debugging
  useEffect(() => {
    // Track chat input state changes (removed verbose logging)
  }, [
    hasLoadingPlaceholders,
    parentIsLoading,
    showSuggestionsFlag, // Fix reference in dependency array
    isProcessingDoc,
    isMediaLoading,
    isInitialChatState,
    isInPostStreamingDebounce,
    currentChatId
    // Removed input dependency to prevent render loops
  ]);

  // Add a ref for logging
  const logRef = useRef({
    lastLoadingState: false,
    lastTimestamp: ''
  });

  // Add component mount and image loading/error/placeholder listeners
  useEffect(() => {

    // Add listener for image loading completion
    const handleImageResponse = (event: CustomEvent<ImageResponseDetail>) => {
      const { imageUrls, prompt, placeholderId, parentMessageId, aspectRatio, sourceImageUrl, isComplete } = event.detail;

      console.log('Received image response:', {
        imageUrls: imageUrls?.length || 0,
        prompt,
        placeholderId,
        hasSourceImage: Boolean(sourceImageUrl),
        isComplete
      });

      // Get last message
      if (currentChatId) {
        // Dispatch event to update images in the chat message
        window.dispatchEvent(new CustomEvent('update-message-images', {
          detail: {
            messageId: parentMessageId,
            images: imageUrls.map(url => ({
              type: 'generated_image',
              url,
              aspectRatio,
              sourceImageUrl // Include source image URL if it exists
            }))
          }
        }));

        setIsMediaLoading(false);
      }
    };

    // Add listener for image loading errors
    const handleImageError = (event: CustomEvent<ImageErrorDetail>) => {
      console.log('Image generation error:', event.detail);
      setIsMediaLoading(false);

      // The error will be displayed in the placeholder message in the chat
      // The page.tsx will handle updating the placeholder with the error
    };

    // Add listener for image placeholders
    const handleImagePlaceholders = (event: CustomEvent<{ placeholders: ImagePlaceholder[] }>) => {
      console.log('Image placeholders created, setting loading state');
      setIsMediaLoading(true);
    };

    window.addEventListener('ai-image-response', handleImageResponse as EventListener);
    window.addEventListener('ai-image-error', handleImageError as EventListener);
    window.addEventListener('ai-image-placeholders', handleImagePlaceholders as EventListener);

    return () => {
      console.log('ChatInput unmounted');
      window.removeEventListener('ai-image-response', handleImageResponse as EventListener);
      window.removeEventListener('ai-image-error', handleImageError as EventListener);
      window.removeEventListener('ai-image-placeholders', handleImagePlaceholders as EventListener);
    };
  }, [currentChatId]);

  // Debug: ChatInput state changes (dev only)


  // Add paste event listener for handling pasted images
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Check if we have files in the clipboard
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) {
        // If pasting text, trigger caret positioning after the input updates
        setShouldMoveCaret(true);
        return;
      }

      // Look for image files
      let hasImageFile = false;
      for (let i = 0; i < clipboardItems.length; i++) {
        if (clipboardItems[i].type.startsWith('image/')) {
          hasImageFile = true;
          e.preventDefault(); // Prevent the default paste behavior

          // Get the file from clipboard
          const file = clipboardItems[i].getAsFile();
          if (file) {
            // Add pasted image to multi-file store for proper handling
            // This supports multiple images and syncs with the modal
            multiFileStore.addFiles([file]);
            console.log('Image pasted from clipboard', file.type, file.size);
          }
          break;
        }
      }

      // If pasting text (no image files found), trigger caret positioning
      if (!hasImageFile) {
        setShouldMoveCaret(true);
      }
    };

    textarea.addEventListener('paste', handlePaste);
    return () => textarea.removeEventListener('paste', handlePaste);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle input if any modal or menu is open
      if (isPrimaryModalOpen || isSecondaryModalOpen || videoGenSettings || imageGenSettings || isMCPModalOpen || isVideoMenuOpen || isImageMenuOpen) {
        return;
      }

      // Don't handle input if the textarea is already focused
      if (textareaRef.current === document.activeElement) {
        return;
      }

      // Don't handle if any other input element is focused
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) {
        return;
      }

      if (textareaRef.current) {
        textareaRef.current.focus();
        // Don't modify the input value here, let the normal input handling take over
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPrimaryModalOpen, isSecondaryModalOpen, videoGenSettings, imageGenSettings, isMCPModalOpen, isVideoMenuOpen, isImageMenuOpen]);

  // Sync scroll position between textarea and mirror div
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleScroll = () => {
      const mirrorDiv = textarea.previousElementSibling as HTMLDivElement;
      if (mirrorDiv) {
        mirrorDiv.scrollTop = textarea.scrollTop;
        mirrorDiv.scrollLeft = textarea.scrollLeft;
      }
    };

    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, []);


  // Handle temporary document upload
  const handleTempDocUpload = (processedDoc: ProcessedDocument) => {
    console.log('Document processed successfully:', processedDoc);
    setTempDoc(processedDoc);
    // Make sure to clear the processing states when document is ready
    setProcessingDoc(null);
    setIsProcessingDoc(false);
    setDocProcessingError(null);
  };

  const clearTempDoc = () => {
    setTempDoc(null);
    setProcessingDoc(null);
    setIsProcessingDoc(false);
    setDocProcessingError(null);
    if (tempDocInputRef.current) {
      tempDocInputRef.current.value = '';
    }
  };

  // Get placeholder text based on context
  const getPlaceholder = () => {
    // Always return the default placeholder regardless of which button is active
    return placeholder;
  };

  const handleImageGenSettingsChange = (config: ImageGenerationConfig | null) => {
    console.log('Image generation settings changed:', config);
    setImageGenSettings(config);

    // Note: Multi-file images are managed by multiFileStore, not the old file upload store
    // This ensures proper real-time sync between modal and chat input
  };

  /**
   * Helper function to upload images and get permanent URLs
   * @param images Array of File objects to upload
   * @returns Array of SourceImageData with permanent URLs
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
      console.log('📤 uploadImagesForPreview result:', result);

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

      console.log('📤 uploadImagesForPreview returning:', sourceImages.length, 'images with URLs');
      return sourceImages;

    } catch (error) {
      console.error('Error uploading images for preview:', error);
      return [];
    }
  };

  /**
   * Handles the image generation request with loading placeholders
   * @param config The image generation configuration
   */
  const handleImageGenerate = async (config: ImageGenerationConfig | null) => {
    console.log('🚀 handleImageGenerate called with:', config);
    console.log('🚀 handleImageGenerate - sourceImages received:', config?.sourceImages?.length || 0, 'images');
    config?.sourceImages?.forEach((img, idx) => {
      console.log(`🚀 handleImageGenerate - Source image ${idx}:`, img.name, img.size, 'bytes');
    });

    // Special case for toggling off image generation
    if (config === null) {
      console.log('Turning off image generation');
      setImageGenSettings(null);
      return;
    }

    // If just updating settings without generating
    if (config.prompt === 'configure-only') {
      console.log('Updating image generation settings only');
      handleImageGenSettingsChange(config);
      return;
    }

    // Enhanced request tracking to prevent duplicates
    const requestKey = `image-${config.prompt}-${config.size}-${config.numOutputs}-${Date.now()}`;

    // Initialize request tracking object if it doesn't exist
    if (!window._pendingImageRequests) window._pendingImageRequests = {};

    // Check for pending similar requests
    const pendingRequestTimestamp = window._pendingImageRequests
      ? Object.keys(window._pendingImageRequests || {})
        .filter(key => key.startsWith(`image-${config.prompt}-${config.size}-${config.numOutputs}`))
        .map(key => (window._pendingImageRequests || {})[key])
        .find(timestamp => timestamp && (Date.now() - timestamp) < 10000)
      : null;

    if (pendingRequestTimestamp) {
      console.log('Preventing duplicate image generation request. Previous request is still pending.');
      return;
    }

    // Track this request
    window._pendingImageRequests[requestKey] = Date.now();

    // If the prompt is not a valid string, use the current input instead
    const actualPrompt = (!config.prompt?.trim()) ? input.trim() : config.prompt.trim();

    // Don't proceed if we don't have a valid prompt AND no source images
    // Allow empty prompts if we have source images (for image editing)
    if (!actualPrompt && (!config.sourceImages || config.sourceImages.length === 0)) {
      console.log('No valid prompt or source images provided for image generation');
      delete window._pendingImageRequests[requestKey];
      return;
    }

    // Upload source images and get permanent URLs for preview
    let sourceImagesWithUrls: SourceImageData[] = [];
    if (config.sourceImages && config.sourceImages.length > 0) {
      console.log('📤 Uploading source images for preview...');
      sourceImagesWithUrls = await uploadImagesForPreview(config.sourceImages);
      console.log('📤 Upload complete. Got URLs for:', sourceImagesWithUrls.length, 'images');
    }

    // Create user message with all source images using permanent URLs
    const userMessageEvent = new CustomEvent('user-image-message', {
      detail: {
        text: actualPrompt,
        sourceImages: sourceImagesWithUrls
      }
    });
    window.dispatchEvent(userMessageEvent);

    // Clear multiFileStore to remove images from chat input
    multiFileStore.clearAllFiles();

    // Note: Source images are handled by multiFileStore for proper multi-file support

    // Generate a unique parent message ID for all placeholders
    const parentMessageId = `image-generation-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Set a loading state immediately to prevent suggestion buttons  
    // Loading state is now set in the form submit handler

    // Create initial placeholders immediately
    const initialPlaceholders: ImagePlaceholder[] = Array.from({ length: config.numOutputs }, (_: unknown, index: number) => ({
      id: `image-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 8)}`,
      prompt: actualPrompt,
      aspectRatio: config.aspectRatio || config.size || '1:1', // Use aspectRatio, fallback to size for backward compatibility
      count: index + 1,
      total: config.numOutputs,
      parentMessageId,
      status: `Starting AI image generation ${index + 1} of ${config.numOutputs}...`
    }));

    // Set loading state first to ensure suggestions are hidden
    setIsMediaLoading(true);

    // Then show placeholders
    window.dispatchEvent(new CustomEvent('ai-image-placeholders', {
      detail: {
        parentMessageId,
        placeholders: initialPlaceholders,
      }
    }));

    try {
      // Prepare the request data - either with or without source images
      let requestData: FormData | string;
      let headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (config.sourceImages && config.sourceImages.length > 0) {
        // If we have source images, use FormData to send them
        console.log('🔥 Creating FormData with', config.sourceImages.length, 'source images');
        const formData = new FormData();
        formData.append('prompt', actualPrompt);
        if (config.model) formData.append('model', config.model);
        formData.append('aspectRatio', config.aspectRatio);
        formData.append('size', config.size || config.aspectRatio); // Backward compatibility
        formData.append('numOutputs', config.numOutputs.toString());
        formData.append('useContext', (config.useContext || false).toString());

        // Append all source images
        console.log('Frontend: Appending', config.sourceImages.length, 'source images to FormData');
        config.sourceImages.forEach((img: File, idx: number) => {
          console.log(`Frontend: Appending sourceImage${idx}:`, img.name, img.size, 'bytes');
          formData.append(`sourceImage${idx}`, img);
        });

        // Append optional parameters if they exist
        if (config.quality) formData.append('quality', config.quality);
        if (config.style) formData.append('style', config.style);
        if (config.background) formData.append('background', config.background);
        if (config.outputFormat) formData.append('outputFormat', config.outputFormat);
        if (config.compression !== undefined) formData.append('compression', config.compression.toString());
        if (config.moderation) formData.append('moderation', config.moderation);
        if (config.responseFormat) formData.append('responseFormat', config.responseFormat);
        if (config.maskImage) formData.append('maskImage', config.maskImage);

        // Debug: Log all FormData keys being sent
        console.log('Frontend: FormData keys being sent:', Array.from(formData.keys()));

        requestData = formData;
        // Let the browser set the appropriate content-type for FormData
        headers = {};
      } else {
        // No source images, use JSON
        const jsonData: any = {
          prompt: actualPrompt,
          model: config.model,
          aspectRatio: config.aspectRatio,
          size: config.size || config.aspectRatio, // Backward compatibility
          numOutputs: config.numOutputs,
          useContext: config.useContext || false
        };

        // Add optional parameters if they exist
        if (config.quality) jsonData.quality = config.quality;
        if (config.style) jsonData.style = config.style;
        if (config.background) jsonData.background = config.background;
        if (config.outputFormat) jsonData.outputFormat = config.outputFormat;
        if (config.compression !== undefined) jsonData.compression = config.compression;
        if (config.moderation) jsonData.moderation = config.moderation;
        if (config.responseFormat) jsonData.responseFormat = config.responseFormat;

        requestData = JSON.stringify(jsonData);
      }

      // Make the image generation request
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers,
        body: requestData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          // Try to parse as JSON
          errorData = JSON.parse(errorText);
        } catch (e) {
          // If not valid JSON, use the raw text
          errorData = { error: errorText };
        }

        // Create a custom error with additional properties
        const error = new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
        (error as any).code = errorData.code;
        (error as any).details = errorData.details;
        throw error;
      }

      const data = await response.json();
      console.log('Image generation response:', data);

      if (!data.images || !data.images.length) {
        throw new Error('No images returned from server');
      }

      // Update placeholders with final status
      data.images.forEach((_: string, index: number) => {
        const progressDetail: ImageProgressDetail = {
          placeholderId: initialPlaceholders[index].id,
          parentMessageId,
          count: index + 1,
          total: data.images.length,
          status: `Loading generated image ${index + 1} of ${data.images.length}...`
        };
        window.dispatchEvent(new CustomEvent('ai-image-progress', { detail: progressDetail }));
      });

      // Send final response with all images
      const responseDetail: ImageResponseDetail = {
        imageUrls: data.images,
        prompt: actualPrompt,
        placeholderId: initialPlaceholders[0].id,
        parentMessageId,
        aspectRatio: config.aspectRatio || config.size || '1:1', // Use aspectRatio, fallback to size
        // Add sourceImageUrl if provided in the response
        sourceImageUrl: data.sourceImageUrl,
        isComplete: true
      };
      window.dispatchEvent(new CustomEvent('ai-image-response', { detail: responseDetail }));

      // Clear input and settings, but let the image response handler manage loading state
      setInput('');
      setImageGenSettings(null);
    } catch (error: any) {
      console.error('Error generating image:', error);

      // Create a user-friendly error message
      let userErrorMessage: string;

      if (error instanceof Error) {
        const errorMessage = error.message;

        // Check for moderation errors specifically
        if ((error as any).code === 'moderation_blocked') {
          userErrorMessage = errorMessage;
          // If we have additional details, append them
          if ((error as any).details) {
            userErrorMessage += '\n\n' + (error as any).details;
          }
        } else if (errorMessage.includes('Network request failed') ||
          errorMessage.includes('Failed to fetch')) {
          userErrorMessage = 'Failed to connect to image generation service. Please check your network connection and try again.';
        } else if (errorMessage.includes('timeout') ||
          errorMessage.includes('Timeout')) {
          userErrorMessage = 'Image generation request timed out. The server might be busy, please try again later.';
        } else {
          userErrorMessage = 'Error generating image: ' + errorMessage;
        }
      } else {
        userErrorMessage = 'Failed to generate image due to an unknown error.';
      }

      // Update all placeholders to show error
      initialPlaceholders.forEach(placeholder => {
        const errorDetail: ImageErrorDetail = {
          error: userErrorMessage,
          placeholderId: placeholder.id,
          rawError: error instanceof Error ? error.message : 'Unknown error'
        };
        window.dispatchEvent(new CustomEvent('ai-image-error', { detail: errorDetail }));
      });

      // Reset loading state
      setIsMediaLoading(false);
    } finally {
      // Clear request tracking and settings
      if (window._pendingImageRequests && requestKey in window._pendingImageRequests) {
        delete window._pendingImageRequests[requestKey];
      }
      setImageGenSettings(null);
    }
  };

  /**
   * Handles the video generation request
   * @param prompt The prompt to generate a video from
   * @param aspectRatio The aspect ratio for the video (e.g. "16:9", "9:16")
   * @param resolution The resolution for the video (e.g. "720p")
   * @param frameCount The number of frames for the video
   * @param useContext Whether to use document context for enhanced generation
   */
  // Add VideoGenerationConfig interface locally if not imported
  interface VideoGenerationConfig {
    prompt: string;
    negativePrompt?: string;
    model?: string;
    aspectRatio?: string;
    resolution: string;
    duration: number | string;
    cameraFixed?: boolean;
    useContext?: boolean;
    sourceImage?: SourceImageData | File;
    generateAudio?: boolean;
    // New fields
    useFastMode?: boolean;
    enhancePrompt?: boolean;
    autoFix?: boolean;
    seed?: number;
  }

  const handleVideoGenerate = async (config: VideoGenerationConfig | null) => {
    console.log('🎬 handleVideoGenerate called with config:', config);
    console.log('🎬 handleVideoGenerate sourceImage type:', config?.sourceImage instanceof File ? 'File' : typeof config?.sourceImage);

    // Special case for toggling off video generation
    if (config === null) {
      console.log('Turning off video generation');
      setVideoGenSettings(null);
      setIsGeneratingVideo(false);
      return;
    }

    const { prompt = 'current-text-placeholder', negativePrompt, model, useContext, aspectRatio, resolution, duration, cameraFixed, sourceImage, generateAudio } = config;

    // Turn off web search if it's enabled
    if (isWebSearchEnabled) {
      toggleWebSearch();
    }

    // Turn off image generation if active
    if (imageGenSettings) {
      setImageGenSettings(null);
    }

    // If this is a configuration update (not an actual generation request)
    if (prompt === 'configure-only') {
      setVideoGenSettings({
        isActive: true,
        model,
        negativePrompt,
        useContext: !!useContext,
        aspectRatio,
        resolution,
        frameCount: duration,
        cameraFixed,
        sourceImage,
        generateAudio: generateAudio ?? true
      });
      setIsGeneratingVideo(true);
      console.log('Video generation mode activated with settings:', { model, aspectRatio, resolution, duration, useContext, cameraFixed, negativePrompt, generateAudio });

      // Focus the textarea for better UX
      textareaRef.current?.focus();
      return;
    }

    // Enhanced request tracking key that includes timestamp to be more unique
    const requestKey = `${prompt}-${model}-${aspectRatio}-${resolution}-${duration}-${Date.now()}`;

    // More robust request tracking with timestamp check
    const pendingRequestTimestamp = window._pendingVideoRequests
      ? Object.keys(window._pendingVideoRequests || {})
        .filter(key => key.startsWith(`${prompt}-${model}-${aspectRatio}-${resolution}-${duration}`))
        .map(key => (window._pendingVideoRequests || {})[key])
        .find(timestamp => timestamp && (Date.now() - timestamp) < 10000) // Check for requests in the last 10 seconds
      : null;

    if (pendingRequestTimestamp) {
      console.log('Preventing duplicate video generation request. Previous request is still pending.');
      return;
    }

    // Track this request with a timestamp instead of a boolean
    if (!window._pendingVideoRequests) window._pendingVideoRequests = {};
    window._pendingVideoRequests[requestKey] = Date.now();

    // If the prompt is not a valid string or is a placeholder, use the current input instead
    const actualPrompt = (prompt === 'current-text-placeholder' || !prompt?.trim())
      ? input.trim()
      : prompt.trim();

    // Don't proceed if we don't have a valid prompt
    if (!actualPrompt) {
      console.log('No valid prompt provided for video generation');
      delete window._pendingVideoRequests[requestKey];
      return;
    }

    // Set loading states and clear suggestions
    setIsGeneratingVideo(true);
    setIsMediaLoading(true);

    // Create a placeholder message for the video that will be updated when generation completes
    const videoPlaceholderId = `video-${Date.now()}`;


    // Convert File sourceImage to SourceImageData with permanent URL (like image generation does)
    let sourceImagesWithUrls: SourceImageData[] = [];
    if (sourceImage) {
      // Check if sourceImage is a File object that needs uploading
      if (sourceImage instanceof File) {
        console.log('🎬 Video generation: uploading source image file to get permanent URL');
        const uploadedSourceImages = await uploadImagesForPreview([sourceImage]);
        sourceImagesWithUrls = uploadedSourceImages;
      } else {
        // sourceImage is already a SourceImageData object
        sourceImagesWithUrls = [sourceImage];
      }
    }

    console.log('🎬 Video generation dispatching user message with sourceImages:', sourceImagesWithUrls.length);
    console.log('🎬 Source images data:', sourceImagesWithUrls);

    const userMessageEvent = new CustomEvent('user-video-message', {
      detail: {
        text: actualPrompt,
        sourceImages: sourceImagesWithUrls,
      }
    });
    window.dispatchEvent(userMessageEvent);

    // Dispatch a custom event for the placeholder
    const placeholderEvent = new CustomEvent('ai-video-placeholder', {
      detail: {
        id: videoPlaceholderId,
        prompt: actualPrompt,
        model,
        aspectRatio,
        resolution,
        duration
      }
    });
    window.dispatchEvent(placeholderEvent);

    try {
      // No need to remap parameters - send them exactly as they are
      // The API expects the same format we use in the UI

      // Helper function to convert File to base64
      async function fileToBase64(file: File): Promise<{ base64: string; type: string }> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result as string;
            resolve({ base64, type: file.type });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      // Create a request body that includes the prompt and all settings
      const requestBody = {
        prompt: actualPrompt, // Use the actual prompt here, not the placeholder
        model: model || 'pro-text',
        useContext: useContext || false, // Explicitly set to false if undefined
        aspectRatio, // Use original aspect ratio
        resolution,
        duration, // Duration in seconds (5 or 10)
        cameraFixed: cameraFixed || false,
        sourceImage: sourceImagesWithUrls.length > 0 ? { base64: sourceImagesWithUrls[0].url, type: 'url' } : undefined,
        generateAudio: generateAudio ?? true, // Default to true for Veo3 audio generation
      };

      console.log('Making video generation request with:', requestBody);

      // Add retry logic for network failures
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let response;

      // Use exponential backoff for retries
      const backoff = (attempt: number) => Math.min(Math.pow(2, attempt) * 1000, 10000);

      while (retryCount < MAX_RETRIES) {
        try {
          // Make the API request with the enhanced body
          console.log(`API request attempt ${retryCount + 1}/${MAX_RETRIES}`);
          response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          // If successful, break out of retry loop
          break;
        } catch (fetchError: any) {
          retryCount++;
          console.warn(`Fetch failed (attempt ${retryCount}/${MAX_RETRIES}):`, fetchError);

          // If we've exhausted all retries, rethrow the error
          if (retryCount >= MAX_RETRIES) {
            console.error('All retry attempts failed');
            throw new Error(`Network request failed after ${MAX_RETRIES} attempts: ${fetchError.message}`);
          }

          // Wait before retrying (exponential backoff)
          const retryDelay = backoff(retryCount);
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }

      if (!response) {
        throw new Error('Failed to make request to video generation API');
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          // Try to parse as JSON
          errorData = JSON.parse(errorText);
        } catch (e) {
          // If not valid JSON, use the raw text
          errorData = { error: errorText };
        }

        console.error('API returned error:', response.status, errorData);
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // Check if the response is a streaming response
      const contentType = response.headers.get('Content-Type');
      if (contentType && contentType.includes('application/json') && response.body) {
        // Process the streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let videoUrl: string | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk:', chunk);

            // Split by newlines in case multiple JSON objects are in one chunk
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
              try {
                const update = JSON.parse(line);
                console.log('Parsed update:', update);

                if (update.error) {
                  console.error('Error from streaming response:', update.error);
                  throw new Error(update.error);
                }

                // Update the placeholder with progress information
                if (typeof update.progress === 'number') {
                  // Dispatch an event to update the placeholder
                  const progressEvent = new CustomEvent('ai-video-progress', {
                    detail: {
                      id: videoPlaceholderId,
                      progress: update.progress,
                      status: update.status || '',
                    }
                  });
                  window.dispatchEvent(progressEvent);
                }

                // If the update contains the final video URL
                if (update.video) {
                  videoUrl = update.video;
                  console.log('Received final video URL:', videoUrl);
                }

                // Handle special error case where video was generated but URL couldn't be extracted
                if (update.stage === 'COMPLETED_WITH_ERROR' && update.requestId) {
                  console.log('Video generated but URL extraction failed. Request ID:', update.requestId);

                  // Create a special error message that includes the request ID
                  const errorMessage = `Video was generated (Request ID: ${update.requestId}) but the URL couldn't be extracted. Please check server logs.`;

                  // Dispatch an error event with the detailed message
                  const errorEvent = new CustomEvent('ai-video-error', {
                    detail: {
                      id: videoPlaceholderId,
                      error: errorMessage,
                      requestId: update.requestId,
                      rawResponse: update.rawResponse
                    }
                  });
                  window.dispatchEvent(errorEvent);
                }

                // Handle raw response from server when URL extraction failed on server side
                if (update.stage === 'RAW_RESPONSE' && update.rawResponse) {
                  console.log('Received raw response from server, attempting to extract video URL on client side');

                  try {
                    // Try to extract the video URL from the raw response
                    const rawResponse = update.rawResponse;
                    console.log('Raw response:', rawResponse);

                    // First, try to find any MP4 URL in the response
                    let extractedUrl: string | null = null;

                    // Convert to string if it's not already
                    const responseStr = typeof rawResponse === 'string'
                      ? rawResponse
                      : JSON.stringify(rawResponse);

                    // Look for MP4 URLs using regex
                    const mp4UrlMatches = responseStr.match(/(https?:\/\/[^\s"]+\.mp4)/g);
                    if (mp4UrlMatches && mp4UrlMatches.length > 0) {
                      extractedUrl = mp4UrlMatches[0];
                      console.log('Client-side extracted MP4 URL using regex:', extractedUrl);
                    }
                    // If no MP4 URL found, try to navigate the object structure
                    else if (typeof rawResponse === 'object' && rawResponse !== null) {
                      // Check common paths for video URLs
                      if (rawResponse.data?.video?.url) {
                        extractedUrl = rawResponse.data.video.url;
                        console.log('Client-side found URL in data.video.url');
                      } else if (rawResponse.output?.video_url) {
                        extractedUrl = rawResponse.output.video_url;
                        console.log('Client-side found URL in output.video_url');
                      } else if (rawResponse.data?.url) {
                        extractedUrl = rawResponse.data.url;
                        console.log('Client-side found URL in data.url');
                      } else if (rawResponse.data?.video_url) {
                        extractedUrl = rawResponse.data.video_url;
                        console.log('Client-side found URL in data.video_url');
                      } else if (rawResponse.video_url) {
                        extractedUrl = rawResponse.video_url;
                        console.log('Client-side found URL in video_url');
                      } else if (rawResponse.url) {
                        extractedUrl = rawResponse.url;
                        console.log('Client-side found URL in url');
                      }

                      // Deep search for any URL property
                      if (!extractedUrl) {
                        const findUrlInObject = (obj: Record<string, any>): string | null => {
                          for (const [key, value] of Object.entries(obj)) {
                            if (typeof value === 'string' && value.match(/https?:\/\/.*\.mp4/)) {
                              console.log(`Client-side found URL in ${key}:`, value);
                              return value;
                            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                              const nestedUrl = findUrlInObject(value);
                              if (nestedUrl) return nestedUrl;
                            } else if (Array.isArray(value)) {
                              for (const item of value) {
                                if (typeof item === 'string' && item.match(/https?:\/\/.*\.mp4/)) {
                                  console.log(`Client-side found URL in array:`, item);
                                  return item;
                                } else if (item && typeof item === 'object') {
                                  const nestedUrl = findUrlInObject(item);
                                  if (nestedUrl) return nestedUrl;
                                }
                              }
                            }
                          }
                          return null;
                        };

                        if (typeof rawResponse === 'object') {
                          extractedUrl = findUrlInObject(rawResponse);
                        }
                      }
                    }

                    // If we found a URL, use it
                    if (extractedUrl) {
                      console.log('Client-side successfully extracted video URL:', extractedUrl);
                      videoUrl = extractedUrl;

                      // Create a video response event
                      const customEvent = new CustomEvent('ai-video-response', {
                        detail: {
                          videoUrl,
                          prompt: actualPrompt,
                          placeholderId: videoPlaceholderId,
                          extractedByClient: true
                        }
                      });

                      console.log('Dispatching ai-video-response event with client-extracted URL:', {
                        videoUrl,
                        prompt: actualPrompt,
                        placeholderId: videoPlaceholderId
                      });

                      window.dispatchEvent(customEvent);
                    } else {
                      throw new Error('Client-side URL extraction also failed');
                    }
                  } catch (extractionError) {
                    console.error('Client-side URL extraction failed:', extractionError);

                    // Create an error event
                    const errorEvent = new CustomEvent('ai-video-error', {
                      detail: {
                        id: videoPlaceholderId,
                        error: 'Both server-side and client-side URL extraction failed. Please try again.',
                        rawResponse: update.rawResponse
                      }
                    });
                    window.dispatchEvent(errorEvent);
                  }
                }

                // Handle direct download from server
                if (update.stage === 'DIRECT_DOWNLOAD' && update.videoBase64) {
                  console.log('Received base64 encoded video from server');

                  try {
                    // Convert base64 to blob
                    const binaryString = atob(update.videoBase64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: update.contentType || 'video/mp4' });

                    // Create a local URL for the blob
                    const localUrl = URL.createObjectURL(blob);
                    console.log('Created local URL for base64 video:', localUrl);

                    // Use this URL as the video URL
                    videoUrl = localUrl;

                    // Create a video response event
                    const customEvent = new CustomEvent('ai-video-response', {
                      detail: {
                        videoUrl,
                        prompt: actualPrompt,
                        placeholderId: videoPlaceholderId,
                        isLocalBlob: true
                      }
                    });

                    console.log('Dispatching ai-video-response event with local blob URL:', {
                      videoUrl,
                      prompt: actualPrompt,
                      placeholderId: videoPlaceholderId
                    });

                    window.dispatchEvent(customEvent);
                  } catch (blobError) {
                    console.error('Error creating blob from base64:', blobError);

                    // Create an error event
                    const errorEvent = new CustomEvent('ai-video-error', {
                      detail: {
                        id: videoPlaceholderId,
                        error: 'Error creating video from base64 data. Please try again.'
                      }
                    });
                    window.dispatchEvent(errorEvent);
                  }
                }
              } catch (parseError) {
                console.error('Error parsing JSON from chunk:', parseError, line);
              }
            }
          }

          // If we got a video URL from the streaming response
          if (videoUrl) {
            console.log('Creating video message with URL:', videoUrl);

            // For the AI message, we need to create it directly in page.tsx
            // by dispatching a custom event that will be handled there
            const customEvent = new CustomEvent('ai-video-response', {
              detail: {
                videoUrl,
                prompt: actualPrompt,
                placeholderId: videoPlaceholderId
              }
            });

            console.log('Dispatching ai-video-response event with:', {
              videoUrl,
              prompt: actualPrompt,
              placeholderId: videoPlaceholderId
            });

            // Dispatch the event and verify it was dispatched
            const dispatched = window.dispatchEvent(customEvent);
            console.log('Event dispatched successfully:', dispatched);

            // Clear the input and settings
            setInput('');
            setVideoGenSettings({
              isActive: false
            });
          } else {
            // Create a more detailed error message
            const errorMessage = 'No video URL received from streaming response. The video may have been generated but could not be retrieved. Please try again or check server logs.';
            console.error(errorMessage);

            // Dispatch an error event with the detailed message
            const errorEvent = new CustomEvent('ai-video-error', {
              detail: {
                id: videoPlaceholderId,
                error: errorMessage
              }
            });
            window.dispatchEvent(errorEvent);

            throw new Error(errorMessage);
          }
        } catch (streamError: any) {
          console.error('Error processing streaming response:', streamError);
          throw streamError;
        }
      } else {
        // Handle non-streaming response (fallback)
        let data;
        try {
          data = await response.json();
          console.log('Video generation response:', data);
        } catch (jsonError) {
          console.error('Failed to parse API response as JSON:', jsonError);
          throw new Error('Invalid response from video generation API');
        }

        if (data.video) {
          console.log('Creating video message with URL:', data.video);

          // For the AI message, we need to create it directly in page.tsx
          // by dispatching a custom event that will be handled there
          const customEvent = new CustomEvent('ai-video-response', {
            detail: {
              videoUrl: data.video,
              prompt: actualPrompt,
              placeholderId: videoPlaceholderId
            }
          });

          console.log('Dispatching ai-video-response event with:', {
            videoUrl: data.video,
            prompt: actualPrompt,
            placeholderId: videoPlaceholderId
          });

          // Dispatch the event and verify it was dispatched
          const dispatched = window.dispatchEvent(customEvent);
          console.log('Event dispatched successfully:', dispatched);

          // Clear all states
          setInput('');
          setVideoGenSettings({
            isActive: false
          });
          setIsMediaLoading(false);
        } else {
          throw new Error('No video URL in response');
        }
      }
    } catch (error: any) {
      console.error('Error generating video:', error);

      // Show error in the UI
      const errorEvent = new CustomEvent('ai-video-error', {
        detail: {
          id: videoPlaceholderId,
          error: error.message || 'Failed to generate video'
        }
      });
      window.dispatchEvent(errorEvent);

      // Reset all states
      setIsGeneratingVideo(false);
      setVideoGenSettings({
        isActive: false
      });
      setIsMediaLoading(false);
    } finally {
      // Clean up the pending request
      if (window._pendingVideoRequests && requestKey in window._pendingVideoRequests) {
        delete window._pendingVideoRequests[requestKey];
      }
    }
  };

  // Add 3D generation handler function
  const handleThreeDGenerate = async (prompt: string, textureSize?: number, meshSimplify?: number, ssSamplingSteps?: number, texturedMesh?: boolean, useContext?: boolean, imageFile?: File) => {
    console.log('handle3DGenerate called with:', { prompt, textureSize, meshSimplify, ssSamplingSteps, texturedMesh, useContext, hasImageFile: !!imageFile });

    // Enhanced request tracking key that includes timestamp to be more unique
    const requestKey = `3d-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Initialize request tracking object if it doesn't exist
    if (!window._pendingThreeDRequests) window._pendingThreeDRequests = {};

    // Check for pending similar requests
    const pendingRequestCount = Object.keys(window._pendingThreeDRequests || {}).length;

    if (pendingRequestCount > 0) {
      console.log('Preventing duplicate 3D generation request. Previous request is still pending.');
      return;
    }

    // Track this request
    window._pendingThreeDRequests[requestKey] = Date.now();

    // If the prompt is not a valid string, use a default one
    const actualPrompt = (!prompt?.trim()) ? t('threeDModel') : prompt.trim();

    // Get image data - either from settings or from file
    let imageData = threeDGenSettings?.imageUrl;

    // If no imageUrl but we have imageFile, read it now
    if (!imageData && imageFile) {
      console.log('Reading image file directly...');
      imageData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(imageFile);
      });
    }

    // Don't proceed if we don't have image data
    if (!imageData) {
      console.log('No image data available for 3D generation');
      delete window._pendingThreeDRequests[requestKey];
      return;
    }

    // Turn off web search if it's enabled
    if (isWebSearchEnabled) {
      toggleWebSearch();
    }

    // Turn off image generation if active
    if (imageGenSettings) {
      setImageGenSettings(null);
    }

    // Turn off video generation if active
    if (videoGenSettings) {
      setVideoGenSettings(null);
      setIsGeneratingVideo(false);
    }

    // Create user message with a prompt indicating we're generating a 3D model from an image
    const userMessageText = actualPrompt || "Generate 3D model from the attached image";

    // Create source image data for preview (similar to image generation)
    const sourceImages = [{
      url: imageData,
      name: imageFile?.name || 'uploaded-image.jpg',
      size: imageFile?.size || 0,
      type: imageFile?.type || 'image/jpeg'
    }];

    // Add the user message to the conversation with both image_url and source_images
    const userMessageObj: ContentPart[] = [
      {
        type: 'text',
        text: userMessageText
      },
      {
        type: 'image_url',
        image_url: {
          url: imageData
        }
      },
      {
        type: 'source_images' as const,
        source_images: sourceImages
      }
    ];

    // Create a custom event to add the user message to the chat
    const userMessageEvent = new CustomEvent('user-3d-message', {
      detail: {
        text: userMessageText,
        contentParts: userMessageObj,
        sourceImages: sourceImages // Also pass as top-level property for consistency
      }
    });
    window.dispatchEvent(userMessageEvent);

    // Clear the 3D generation settings immediately after dispatching the user message
    // This prevents the UI from showing the "Generate 3D model from image" button again
    setIsGenerating3D(false);
    setThreeDGenSettings(null);
    // Clear the file from the upload store since we're done with it
    useFileUploadStore.getState().clearFile();

    // Generate a unique placeholder ID for the 3D model
    const threeDPlaceholderId = `3d-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Set loading state and clear suggestions
    setIsMediaLoading(true);

    // Dispatch a placeholder event
    const placeholderEvent = new CustomEvent('ai-3d-placeholder', {
      detail: {
        id: threeDPlaceholderId,
        prompt: actualPrompt,
        textureSize,
        meshSimplify,
        ssSamplingSteps,
        texturedMesh
      }
    });
    window.dispatchEvent(placeholderEvent);

    try {
      // Make the API request
      console.log('Making 3D generation request with:', {
        prompt: actualPrompt,
        textureSize,
        meshSimplify,
        ssSamplingSteps,
        texturedMesh,
        useContext,
        hasImageData: !!imageData
      });

      const response = await fetch('/api/generate-3d', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: actualPrompt,
          textureSize: textureSize || 2048,
          meshSimplify: meshSimplify || 0.9,
          ssSamplingSteps: ssSamplingSteps || 38,
          texturedMesh: !!texturedMesh,
          useContext: !!useContext,
          imageData // Include the image data for processing
        }),
      });

      let errorMessage = 'Failed to generate 3D model';

      if (!response.ok) {
        let errorJson;
        try {
          // Try to parse error as JSON first
          errorJson = await response.json();
          console.error('API error response:', errorJson);
          errorMessage = errorJson.error || `API error: ${response.status}`;
        } catch (parseError) {
          // If JSON parsing fails, try to get text instead
          try {
            const errorText = await response.text();
            errorMessage = `API error: ${response.status} - ${errorText}`;
          } catch (textError) {
            errorMessage = `API error: ${response.status}`;
          }
        }
        throw new Error(errorMessage);
      }

      // Only try to parse JSON after we're sure response is OK
      const data = await response.json();
      console.log('3D generation response:', data);

      if (!data.modelUrl) {
        throw new Error('No model URL in response');
      }

      // Dispatch response event with model URL
      const responseEvent = new CustomEvent('ai-3d-response', {
        detail: {
          modelUrl: data.modelUrl,
          prompt: actualPrompt || "3D model generated from image",
          placeholderId: threeDPlaceholderId,
          isComplete: true,
          extraData: {
            colorVideo: data.colorVideo,
            normalVideo: data.normalVideo,
            combinedVideo: data.combinedVideo,
            gaussianPly: data.gaussianPly
          }
        }
      });
      window.dispatchEvent(responseEvent);

      // Clear input and settings
      setInput('');

    } catch (error) {
      console.error('Error generating 3D model:', error);

      // Show error in the UI
      const errorEvent = new CustomEvent('ai-3d-error', {
        detail: {
          id: threeDPlaceholderId,
          error: error instanceof Error ? error.message : 'Failed to generate 3D model'
        }
      });
      window.dispatchEvent(errorEvent);

    } finally {
      // Clear request tracking
      if (window._pendingThreeDRequests && requestKey in window._pendingThreeDRequests) {
        delete window._pendingThreeDRequests[requestKey];
      }

      // Reset states
      setIsGenerating3D(false);
      setThreeDGenSettings(null);
      setIsMediaLoading(false);
      // Clear the file from upload store after 3D generation
      useFileUploadStore.getState().clearFile();
    }
  };

  // Add handler for 3D button click
  const handleThreeDGenSettingsChange = (
    textureSize?: number,
    meshSimplify?: number,
    ssSamplingSteps?: number,
    texturedMesh?: boolean,
    useContext?: boolean,
    imageFiles?: File[]
  ) => {
    // Check if all parameters are undefined (deactivation signal)
    if (textureSize === undefined && meshSimplify === undefined &&
      ssSamplingSteps === undefined && texturedMesh === undefined &&
      useContext === undefined && imageFiles === undefined) {
      // Deactivate 3D generation
      console.log('Deactivating 3D generation mode');
      setThreeDGenSettings(null);
      setIsGenerating3D(false);
      useFileUploadStore.getState().clearFile();
      return;
    }

    const firstImageFile = Array.isArray(imageFiles) && imageFiles.length > 0 ? imageFiles[0] : undefined;

    console.log('Setting 3D generation settings:', {
      textureSize,
      meshSimplify,
      ssSamplingSteps,
      texturedMesh,
      useContext,
      hasImageFile: !!firstImageFile,
      imageFilesCount: Array.isArray(imageFiles) ? imageFiles.length : 0
    });


    // Turn off web search if it's enabled
    if (isWebSearchEnabled) {
      toggleWebSearch();
    }

    // Turn off image generation if active
    if (imageGenSettings) {
      setImageGenSettings(null);
    }

    // Turn off video generation if active
    if (videoGenSettings) {
      setVideoGenSettings(null);
      setIsGeneratingVideo(false);
    }

    // Get image URL from file if provided
    let imageUrl: string | undefined;
    if (firstImageFile) {
      // Add the file to the upload store so it displays in the input area
      useFileUploadStore.getState().setFile(firstImageFile);
      console.log('Added 3D source image to file upload store:', firstImageFile.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Update settings with the image URL
        setThreeDGenSettings((prevSettings) => ({
          ...prevSettings!,
          imageUrl: result,
        }));
      };
      reader.readAsDataURL(firstImageFile);
    }

    // Set 3D generation settings
    setThreeDGenSettings({
      isActive: true,
      useContext,
      textureSize,
      meshSimplify,
      ssSamplingSteps,
      texturedMesh,
      imageFile: firstImageFile
    });
    setIsGenerating3D(true);

    // Focus the textarea for better UX
    textareaRef.current?.focus();
  };

  // Modify the parentHandleSubmit wrapper to ensure input is always cleared
  const wrappedParentHandleSubmit = async (event: React.FormEvent<HTMLFormElement> & { messageContent?: ContentPart | ContentPart[] }) => {
    console.log('Wrapped parent handle submit called, current input:', input);

    // Check for Gmail fetch operations to prevent duplicates
    if (event.messageContent) {
      // For text content, check if it's a fetch gmail operation
      let contentText = '';

      if (typeof event.messageContent === 'string') {
        contentText = event.messageContent;
      } else if (Array.isArray(event.messageContent)) {
        // Extract text from array of content parts
        contentText = event.messageContent
          .filter(part => part.type === 'text' && part.text)
          .map(part => (part as any).text || '')
          .join(' ');
      } else if (event.messageContent.type === 'text') {
        contentText = event.messageContent.text || '';
      }

      // Check if it's a Gmail fetch request
      if (contentText &&
        contentText.toLowerCase().includes('fetch') &&
        (contentText.toLowerCase().includes('email') || contentText.toLowerCase().includes('gmail'))) {

        console.log('Gmail fetch operation detected in wrappedParentHandleSubmit');

        // Check for duplicate submissions within a short timeframe
        const now = Date.now();
        const lastFetchTime = Number(localStorage.getItem('lastGmailFetchSubmitted') || '0');

        if (now - lastFetchTime < 3000) { // 3 seconds
          console.log('Blocking duplicate Gmail fetch submission within 3 seconds');
          return; // Exit early without submission
        }

        // Mark this submission
        localStorage.setItem('lastGmailFetchSubmitted', String(now));
      }
    }

    // Always clear input immediately, before the async operation
    clearInputField();

    // Then call the parent handler
    return parentHandleSubmit(event);
  };

  // Update handleFormSubmit to use our wrapped version
  const handleFormSubmit = async (e: ExtendedFormEvent) => {
    e.preventDefault();

    // IMPORTANT: Immediately set DOM class to hide suggestions
    document.body.classList.add('form-submitting');

    // Always set submitting flag immediately
    setIsSubmitting(true);

    // Special check for Gmail fetch operations to prevent duplicates
    const currentInputText = input.trim().toLowerCase();
    if (
      currentInputText.includes('fetch') &&
      (currentInputText.includes('email') || currentInputText.includes('gmail'))
    ) {
      const gmailFetchKey = 'gmail_fetch_' + Date.now();

      // Check if we've recently processed a similar request
      const lastGmailFetch = localStorage.getItem('lastGmailFetch');
      if (lastGmailFetch) {
        const timeSinceLastFetch = Date.now() - Number(lastGmailFetch);
        if (timeSinceLastFetch < 5000) { // 5 seconds
          console.log('Preventing duplicate Gmail fetch within 5 seconds');
          setIsSubmitting(false);
          document.body.classList.remove('form-submitting');
          return; // Exit early
        }
      }

      // Mark this fetch operation
      localStorage.setItem('lastGmailFetch', String(Date.now()));
    }

    // Add a debounce flag to prevent duplicate submissions within a short time period
    const now = Date.now();
    const lastSubmitTime = (window as any)._lastSubmitTime || 0;
    if (now - lastSubmitTime < 2000) { // 2 second debounce
      console.log('Preventing rapid form resubmission within debounce period');
      setIsSubmitting(false);
      document.body.classList.remove('form-submitting');
      return;
    }
    (window as any)._lastSubmitTime = now;

    try {
      // Log the submission attempt
      console.log('Form submit initiated, current input:', input);

      // CRITICAL FIX: Store the input value from internal reference to prevent stale closure
      const currentInput = input.trim();

      // Store file reference before clearing
      const currentFile = file;
      const currentFileType = fileType;

      // Clear input immediately at the beginning of submission
      clearInputField();

      // If image generation is active, ONLY handle image generation
      if (imageGenSettings && currentInput) {
        console.log('Handling image generation with settings:', imageGenSettings);
        // Set loading state and clear suggestions only when actually generating images
        setIsMediaLoading(true);

        // Get current images from multiFileStore to ensure ALL selected images are included
        const currentImages = multiFileStore.getFilesArray();
        console.log('🔥 Form submission - multiFileStore has', currentImages.length, 'images');

        // Use the new handleImageGenerate function with ALL images from multiFileStore
        await handleImageGenerate({
          ...imageGenSettings,
          sourceImages: currentImages.length > 0 ? currentImages : imageGenSettings.sourceImages,
          prompt: currentInput
        });
        return;
      }

      // Handle video generation if active
      console.log('🔥 handleFormSubmit checking video: isGeneratingVideo=', isGeneratingVideo, 'currentInput=', !!currentInput);
      if (isGeneratingVideo && currentInput) {
        console.log('Video generation is active, handling video generation with prompt:', currentInput);

        // Parse the prompt for negative prompt pattern
        const { mainPrompt, negativePrompt } = parseVideoPrompts(currentInput);

        // Clear video generation state immediately to prevent duplicate submissions
        const savedVideoSettings = { ...videoGenSettings };

        // Important: Clear the state before making the API call to prevent duplicate requests
        setIsGeneratingVideo(false);
        setVideoGenSettings(null);
        setHasNegativePrompt(false);

        // Then proceed with the video generation using the saved settings
        const videoConfig = {
          prompt: mainPrompt, // Use the parsed main prompt
          negativePrompt: negativePrompt || undefined, // Add negative prompt if present
          model: savedVideoSettings?.model || 'pro-text',
          aspectRatio: savedVideoSettings?.aspectRatio,
          resolution: savedVideoSettings?.resolution || '720p',
          duration: savedVideoSettings?.frameCount || 16,
          cameraFixed: savedVideoSettings?.cameraFixed || false,
          useContext: !!savedVideoSettings?.useContext,
          sourceImage: savedVideoSettings?.sourceImage
        };
        console.log('🎬 Form submission: Submitting video with config:', videoConfig);
        console.log('🎬 Form submission: sourceImage type:', savedVideoSettings?.sourceImage instanceof File ? 'File' : typeof savedVideoSettings?.sourceImage);
        console.log('🎬 Form submission: sourceImage data:', savedVideoSettings?.sourceImage);
        // Immediately clear any image previews from the chat input so they don't stick around
        try {
          multiFileStore.clearAllFiles();
        } catch { }
        await handleVideoGenerate(videoConfig);
        return;
      }

      // Handle 3D generation if active
      if (isGenerating3D && threeDGenSettings?.imageFile) {
        console.log('3D generation is active with image');

        // Clear 3D generation state immediately to prevent duplicate submissions
        const savedThreeDSettings = { ...threeDGenSettings };

        // Clear the state before making the API call
        setIsGenerating3D(false);
        setThreeDGenSettings(null);
        // Clear the file from the upload store after submission
        useFileUploadStore.getState().clearFile();

        // Proceed with 3D generation with the saved image
        await handleThreeDGenerate(
          currentInput || t('threeDModel'), // Use input if available, otherwise use default prompt
          savedThreeDSettings?.textureSize,
          savedThreeDSettings?.meshSimplify,
          savedThreeDSettings?.ssSamplingSteps,
          savedThreeDSettings?.texturedMesh,
          !!savedThreeDSettings?.useContext,
          savedThreeDSettings?.imageFile  // Pass the image file
        );
        return;
      }

      // Only proceed with regular chat if no special generation is active
      // Also allow proceeding if multiFileStore has images (uploaded via unified upload button)
      const hasMultiFileImages = multiFileStore.hasFiles();
      if (!currentInput && !currentFile && !e.messageContent && selectedDocuments.length === 0 && !hasMultiFileImages) return;

      const contentParts: ContentPart[] = [];

      // Add text content if present
      if (currentInput) {
        contentParts.push({
          type: 'text',
          text: currentInput
        });
      }

      // Add image file if present (from single-file store)
      if (currentFile && currentFileType === 'image') {
        console.log('Adding image file to contentParts:', {
          name: currentFile.name,
          type: currentFile.type,
          size: currentFile.size
        });

        // Convert image to base64
        const reader = new FileReader();
        const fileData = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            } else {
              reject(new Error('Failed to convert image to base64'));
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(currentFile);
        });

        contentParts.push({
          type: 'image_url',
          image_url: { url: fileData }
        });
        console.log('Image successfully added to contentParts');
      }

      // Add images from multiFileStore (for images uploaded via unified upload button)
      const multiFileImages = multiFileStore.getFilesArray();
      if (multiFileImages.length > 0) {
        console.log('[handleFormSubmit] Adding', multiFileImages.length, 'images from multiFileStore to contentParts');

        for (const imageFile of multiFileImages) {
          console.log('[handleFormSubmit] Processing multiFileStore image:', {
            name: imageFile.name,
            type: imageFile.type,
            size: imageFile.size
          });

          // Convert image to base64
          const reader = new FileReader();
          const fileData = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
              } else {
                reject(new Error('Failed to convert image to base64'));
              }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(imageFile);
          });

          contentParts.push({
            type: 'image_url',
            image_url: { url: fileData }
          });
          console.log('[handleFormSubmit] MultiFileStore image added to contentParts:', imageFile.name);
        }

        // Clear multiFileStore after adding images to prevent re-sending
        multiFileStore.clearAllFiles();
        console.log('[handleFormSubmit] Cleared multiFileStore after adding images');
      }

      // Add temporary document if present
      if (tempDoc) {
        console.log('Including temporary document in message:', tempDoc.name);

        // Add a notification to show the document is being used
        const docUsageEvent = new CustomEvent('document-usage', {
          detail: {
            name: tempDoc.name,
            action: 'used'
          }
        });
        window.dispatchEvent(docUsageEvent);

        contentParts.push({
          type: 'document',
          document: {
            id: tempDoc.id,
            name: tempDoc.name,
            text: tempDoc.text || '',
            type: tempDoc.type || 'pdf',
            chunks: tempDoc.chunks
          }
        });
      }

      // Add document mentions/references
      if (selectedDocuments.length > 0) {
        selectedDocuments.forEach(doc => {
          contentParts.push({
            type: 'document',
            document: {
              id: doc.id,
              name: doc.name,
              text: '', // This will be populated from the server
              type: doc.type as 'pdf' | 'doc' | 'docx' | 'txt'
            }
          });
        });

        // Clear selected documents after sending
        clearDocuments();
      }

      // Create the message content
      const messageContent = contentParts.length === 1 ? contentParts[0] : contentParts;

      // Create a custom event with the message content
      const event = {
        preventDefault: () => { },
        currentTarget: e.currentTarget,
        messageContent,
        data: {
          settings: {
            webSearch: isWebSearchEnabled
            // Reasoning is now handled via global store in page.tsx
          }
        }
      } as any;

      // Call our wrapped parent handler with the event
      await wrappedParentHandleSubmit(event);

      // Double-check that input is cleared after parent handler
      clearInputField();

      // Clear the temporary document after submission
      if (tempDoc) {
        console.log('Clearing temporary document after submission');
        clearTempDoc();
      }

      // Clear the file after submission
      if (file) {
        console.log('Clearing file after submission');
        clearFile();
      }
    } catch (error) {
      console.error('Error in form submission:', error);
      // Reset the debounce flag on error to allow retry
      (window as any)._lastSubmitTime = 0;
    } finally {
      setIsSubmitting(false);
      document.body.classList.remove('form-submitting');
    }
  };

  // Update the loading state effect
  // Debug: ChatInput state change tracking
  useEffect(() => {
    // Track state changes for debugging (removed verbose logging)
  }, [parentIsLoading, handleStop, tempDoc, isProcessingDoc, input]);

  // Update the button click handler
  const handleButtonClick = (e: React.MouseEvent) => {
    // Debug: Button click handler (removed verbose logging)

    if (parentIsLoading && handleStop) {
      e.preventDefault();
      e.stopPropagation();
      // Debug: Executing stop action

      // Call handleStop synchronously to ensure immediate response
      handleStop();
      console.log('Stop action initiated');

      // Prevent any form submission
      return false;
    } else if (!parentIsLoading && input.trim()) {
      // If sending a message, clear the input value proactively
      console.log('Send button clicked, current input:', input);

      // Let the form submit normally, but we'll clear the input value immediately after
      setTimeout(() => {
        if (input) {
          console.log('Clearing input after send button click');
          setInput('');
        }
      }, 0);
    }
  };

  const handleStartRecording = async () => {
    try {
      const recorder = await startRecording();
      setMediaRecorder(recorder);
      setIsRecording(true);
      recorder.start();
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const handleStopRecording = async () => {
    if (!mediaRecorder) return;

    try {
      // Immediately show processing state
      setIsTranscribing(true);
      setIsRecording(false);

      // Stop all tracks in the stream first for immediate feedback
      mediaRecorder.stream.getTracks().forEach(track => track.stop());

      // Get the audio blob
      const audioBlob = await stopRecording(mediaRecorder);

      // Clean up recorder state
      setMediaRecorder(null);

      // Get voice provider - prioritize environment variable
      const voiceProvider = env.NEXT_PUBLIC_VOICE_PROVIDER || useUserSettingsStore.getState().voiceProvider || 'openai';

      // Process the transcription
      const transcription = await speechToText(audioBlob, { provider: voiceProvider });

      // CRITICAL FIX: Update the input with the transcribed text in uncontrolled manner
      // Clear typing state since this is programmatic
      isTypingRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Controlled component handles value via React state

      // Auto-resize textarea for transcription (React will handle the value via controlled component)
      if (textareaRef.current) {
        autoResize(textareaRef.current);
      }

      // Sync to parent (immediate for transcription)
      startTransition(() => {
        setInput(transcription);
      });

    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      // Reset all states
      setIsTranscribing(false);
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  // Make the button more explicit about its state
  const renderButton = () => {
    // Special 3D generation submit button
    if (isGenerating3D && threeDGenSettings?.imageFile) {
      return (
        <button
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-tl-xl rounded-tr-xl rounded-bl-xl rounded-br-3xl transition-colors",
            "bg-[#FF6417] dark:bg-[#FF6417] hover:bg-[#E55000] dark:hover:bg-[#E55000]",
            "group relative focus:outline-none"
          )}
          onClick={(e) => {
            e.preventDefault();
            // Submit the form to trigger the handleFormSubmit function
            formRef.current?.requestSubmit();
          }}
          disabled={parentIsLoading || isProcessingDoc}
        >
          <ArrowUp className="h-5 w-5 text-white transform -translate-x-[1px] -translate-y-[1px]" />
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[calc(100%+4px)] px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap">
            {t('generate3DModel')}
          </div>
        </button>
      );
    }

    const isDisabled = parentIsLoading ||
      isProcessingDoc ||
      isAnyMediaProcessing ||
      hasActiveChatContent ||
      isMediaLoading;
    // Get STT disabled state from audio settings
    const sttDisabled = audioSettings.sttDisabled;

    const showMicButton = !sttDisabled && !parentIsLoading && !input.trim() && !isProcessingDoc;

    if (showMicButton) {
      return (
        <div className="flex items-center gap-1.5">
          {/* Dictate Button - Speech to Text to Input (Mic icon, square when inactive, red when recording) */}
          <button
            type="button"
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 group relative",
              isRecording
                ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 animate-pulse"
                : isTranscribing
                  ? "bg-[#FFF0E8] dark:bg-[#2A2A2A]"
                  : "bg-[#FFF0E8] dark:bg-[#2A2A2A] hover:bg-[#FFE0D0] dark:hover:bg-[#333333]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            disabled={isProcessingDoc}
            aria-label={isRecording ? t('stopRecording') : isTranscribing ? t('processing') : t('voiceModeDictate')}
          >
            {isRecording ? (
              <Mic className="h-5 w-5 text-white" />
            ) : isTranscribing ? (
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce"></div>
              </div>
            ) : (
              <Mic className="h-5 w-5 text-gray-700 dark:text-gray-400" />
            )}
            <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+4px)] px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap">
              {isRecording ? t('stopRecording') : isTranscribing ? t('processing') : t('voiceModeDictate')}
            </div>
          </button>

          {/* Voice Mode Button - Toggles between "Voice Mode" and "End" */}
          {VOICE_MODE_ENABLED && (
            <VoiceEndButton
              isActive={isVoiceModeActive}
              onClick={() => setIsVoiceModeActive(!isVoiceModeActive)}
              disabled={isProcessingDoc || isRecording || isTranscribing}
            />
          )}
        </div>
      );
    }

    return (
      <button
        type={parentIsLoading ? "button" : "submit"}
        onClick={handleButtonClick}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-tl-xl rounded-tr-xl rounded-bl-xl rounded-br-3xl transition-all duration-200 group relative",
          parentIsLoading
            ? "bg-red-500 hover:bg-red-600 dark:bg-red-700 dark:hover:bg-red-800"
            : isDisabled || !input.trim()
              ? "bg-[#FFF0E8] dark:bg-[#2A2A2A] hover:bg-[#FFE0D0] dark:hover:bg-[#333333]"
              : "bg-[#FF6417] hover:bg-[#E55000] dark:bg-[#E6E6E6] dark:hover:bg-[#D4D4D4]",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        disabled={!parentIsLoading && (isDisabled || !input.trim())}
        aria-label={parentIsLoading ? t('stopGenerating') : t('sendPrompt')}
      >
        {parentIsLoading ? (
          <StopCircle className="h-5 w-5 text-white" />
        ) : (
          <ArrowUp className={cn(
            "h-5 w-5 transform -translate-x-[1px] -translate-y-[1px]",
            isDisabled || !input.trim()
              ? "text-gray-700 dark:text-gray-400"
              : "text-white dark:text-[#1A1A1A]"
          )} />
        )}
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+4px)] px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap">
          {parentIsLoading ? t('stopGenerating') : t('sendPrompt')}
        </div>
      </button>
    );
  };

  const handleWebSearchToggle = (useSearch: boolean) => {
    // Debug: Web search toggle requested

    // Toggle web search only when state needs to change
    if (useSearch !== isWebSearchEnabled) {
      toggleWebSearch();
    }

    // Verify the state change took effect
    setTimeout(() => {
      // Debug: Web search state after toggle
    }, 10);

    // Turn off image generation if active
    if (imageGenSettings) {
      setImageGenSettings(null);
    }

    // Turn off video generation if active
    if (videoGenSettings) {
      setVideoGenSettings(null);
    }

    // Turn off 3D generation if active
    if (threeDGenSettings) {
      setThreeDGenSettings(null);
      useFileUploadStore.getState().clearFile();
    }

    // Set isGeneratingVideo to false
    setIsGeneratingVideo(false);

    // Set isGenerating3D to false
    setIsGenerating3D(false);

    // Focus/blur the textarea based on web search state
    if (useSearch) {
      textareaRef.current?.focus();
    } else {
      textareaRef.current?.blur();
    }
  };

  // Add state for active suggestion category
  const [activeCategory, setActiveCategory] = useState("");

  const handleSuggestionClick = (category: string, item: string) => {
    console.log('Suggestion clicked:', category, item);
    const fullSuggestion = `${category} ${item} `;

    // IMPORTANT: Immediately hide suggestions via DOM
    document.body.classList.add('form-submitting');

    // Check if this is a Gmail fetch-related suggestion
    const lowerSuggestion = fullSuggestion.toLowerCase();
    if (lowerSuggestion.includes('fetch') &&
      (lowerSuggestion.includes('email') || lowerSuggestion.includes('gmail'))) {

      console.log('Gmail fetch suggestion detected, checking for duplicates');

      // Check if we've recently processed a similar request
      const lastGmailFetch = localStorage.getItem('lastGmailFetch');
      if (lastGmailFetch) {
        const timeSinceLastFetch = Date.now() - Number(lastGmailFetch);
        if (timeSinceLastFetch < 5000) { // 5 seconds
          console.log('Preventing duplicate Gmail fetch suggestion within 5 seconds');
          document.body.classList.remove('form-submitting');
          return; // Exit early
        }
      }

      // Mark this fetch operation in localStorage
      localStorage.setItem('lastGmailFetch', String(Date.now()));
    }

    // CRITICAL FIX: Set input in uncontrolled manner with proper state management
    // Clear typing state since this is programmatic
    isTypingRef.current = false;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Controlled component handles value via React state

    // Auto-resize and focus textarea for suggestion (React will handle the value via controlled component)
    if (textareaRef.current) {
      autoResize(textareaRef.current);

      // Trigger caret positioning for suggestion
      setShouldMoveCaret(true);

      setTimeout(() => {
        textareaRef.current?.focus();

        // Programmatically submit the form
        if (formRef.current) {
          console.log('Submitting form programmatically after suggestion click');
          formRef.current.requestSubmit();
        }
      }, 0);
    }

    // Sync to parent (immediate for programmatic changes)
    startTransition(() => {
      setInput(fullSuggestion);
    });

    // Close any active suggestion category
    setActiveCategory("");

    // Close any active generation panels
    if (videoGenSettings) {
      setVideoGenSettings({ ...videoGenSettings, isActive: false });
    }

    if (imageGenSettings) {
      setImageGenSettings(null);
    }

    // Clear form-submitting class after a short delay in case form submission doesn't happen
    setTimeout(() => {
      document.body.classList.remove('form-submitting');
    }, 5000);
  };

  // Handle category button click
  const handleCategoryClick = (category: string) => {
    setActiveCategory(category);

    // Close any active generation panels
    if (videoGenSettings) {
      setVideoGenSettings({ ...videoGenSettings, isActive: false });
    }

    if (imageGenSettings) {
      setImageGenSettings(null);
    }
  };

  // Restore toggleImageGeneration function
  const toggleImageGeneration = (config: ImageGenerationConfig | null) => {
    // If null config passed, turn off image generation
    if (!config) {
      console.log('Turning off image generation (null config)');
      setImageGenSettings(null);

      // If web search was enabled before, turn it back on
      if (isWebSearchEnabled) {
        toggleWebSearch();
      }
      return;
    }

    // If we're already in image generation mode and receive a new config,
    // UPDATE the settings instead of toggling off
    // This allows adding images while keeping the mode active
    if (imageGenSettings) {
      console.log('Updating image generation settings:', config);
      handleImageGenSettingsChange(config);
      return;
    }

    // Turn off web search if it's enabled
    if (isWebSearchEnabled) {
      toggleWebSearch();
    }

    // Turn off video generation if active
    if (videoGenSettings) {
      setVideoGenSettings(null);
      setIsGeneratingVideo(false);
    }

    // Turn off 3D generation if active
    if (threeDGenSettings) {
      setThreeDGenSettings(null);
      setIsGenerating3D(false);
      useFileUploadStore.getState().clearFile();
    }

    console.log('Turning on image generation with config:', config);

    // Set image generation settings through the handler function
    // This will also add the source image to the file upload store
    handleImageGenSettingsChange(config);

    // Focus the textarea for better UX
    textareaRef.current?.focus();
  };

  // Clear active category when input is cleared
  useEffect(() => {
    if (input.trim() === "" && activeCategory !== "") {
      // Reset active category when field is cleared
      setActiveCategory("");
    }
  }, [input, activeCategory]);

  // Add back the suggestion state logging
  useEffect(() => {
    console.log('Suggestion state debug:', {
      showSuggestionsFlag,
      isAnyActivity,
      hasActiveChatContent,
      isMediaLoading,
      hasCurrentChat: Boolean(currentChatId),
      hasMessages: Boolean(currentChat?.messages?.length),
      timestamp: new Date().toISOString()
    });
  }, [
    showSuggestionsFlag,
    isAnyActivity,
    hasActiveChatContent,
    isMediaLoading,
    currentChatId,
    currentChat?.messages?.length
  ]);

  // Add an effect to monitor document processing states
  useEffect(() => {
    console.log('Document states updated:', {
      processingDoc: !!processingDoc,
      isProcessingDoc,
      tempDoc: !!tempDoc
    });
  }, [processingDoc, isProcessingDoc, tempDoc]);

  // Define suggestion groups
  const suggestionGroups = [
    {
      label: "write",
      icon: <FileText className="h-5 w-5 text-gray-700 dark:text-[#9E9E9E]" />,
      items: [
        { text: "writeSummary" },
        { text: "writeEmail" },
        { text: "writeBlog" },
        { text: "writeSocial" }
      ]
    },
    {
      label: "plan",
      icon: <ListTodo className="h-5 w-5 text-gray-700 dark:text-[#9E9E9E]" />,
      items: [
        { text: "planMarketing" },
        { text: "planBusiness" },
        { text: "planProduct" },
        { text: "planLearning" }
      ]
    },
    {
      label: "design",
      icon: <Paintbrush className="h-5 w-5 text-gray-700 dark:text-[#9E9E9E]" />,
      items: [
        { text: "designLogo" },
        { text: "designHero" },
        { text: "designLanding" },
        { text: "designSocial" }
      ]
    }
  ];

  // Get suggestions based on active category
  const activeCategoryData = suggestionGroups.find(
    (group) => group.label === activeCategory
  );

  // Add animation styles
  // Get configurable text size from environment variable, default to 18px
  const chatInputTextSize = process.env.NEXT_PUBLIC_CHAT_INPUT_TEXT_SIZE || '18';
  const fontSize = `${chatInputTextSize}px`;
  const lineHeight = `${Number(chatInputTextSize) * 1.5}px`;

  const style = `
    @keyframes fadeIn {
      from { opacity: 0.95; transform: translateY(-1px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .animate-fadeIn {
      animation: fadeIn 0.05s ease-out forwards;
    }

    /* SVG Stroke Animation - Smoother cornering */
    @keyframes svg-travel {
      0% { stroke-dashoffset: 0; }
      100% { stroke-dashoffset: calc(var(--perimeter) * -1px); }
    }

    /* Fix for overflow issues with attachments */
    .chat-input-container .relative.px-2 {
      max-height: 400px;
      display: flex;
      flex-direction: column;
      overflow: visible; /* Allow modals to extend outside */
    }
    
    /* Targeted Chromium button click area fixes */
    .chat-input-container button {
      position: relative;
      cursor: pointer;
      pointer-events: auto;
      overflow: visible;
    }
    
    /* Only prevent SVG icons from blocking clicks */
    .chat-input-container button > svg {
      pointer-events: none;
    }
    
    /* Ensure tooltips don't interfere but can use transforms */
    .chat-input-container button .pointer-events-none {
      pointer-events: none !important;
    }
    
    .chat-input-container .flex-1.relative {
      overflow: visible;
    }
    
    /* Ensure proper scrolling only for textarea */
    .chat-input-container .flex-1.relative > textarea {
      scrollbar-width: thin;
      scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
    }
    
    /* Ensure consistent text rendering between textarea and mirror div */
    .chat-input-container .flex-1.relative > textarea,
    .chat-input-container .flex-1.relative > div:first-child {
      /* Use explicit font stack to ensure consistency */
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      font-size: ${fontSize} !important; /* Configurable size from environment */
      line-height: ${lineHeight} !important; /* Proportional line height */
      font-weight: 400 !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      /* Use geometric precision for exact character placement */
      text-rendering: geometricPrecision !important;
      word-spacing: 0 !important;
      letter-spacing: 0 !important;
      /* Disable font ligatures and kerning for consistent spacing */
      font-variant-ligatures: none !important;
      font-feature-settings: "liga" 0, "kern" 0 !important;
      /* Remove any default appearance */
      -moz-appearance: none !important;
      -webkit-appearance: none !important;
      appearance: none !important;
      /* Additional precision settings */
      -webkit-text-stroke-width: 0 !important;
      /* Ensure identical text wrapping */
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      /* Ensure identical box model */
      box-sizing: border-box !important;
      padding: 0.5rem 0.75rem !important; /* Match px-3 py-2 */
    }
    
    @media (min-width: 640px) {
      .chat-input-container .flex-1.relative > textarea,
      .chat-input-container .flex-1.relative > div:first-child {
        padding: 0.75rem 0.75rem !important; /* Match sm:py-3 */
      }
    }
    
    /* Fine-tune mirror div position to compensate for sub-pixel rendering differences */
    .chat-input-container .flex-1.relative > div:first-child {
      /* Tiny adjustment to align with textarea caret */
      transform: translateX(-0.3px);
    }
    
    .chat-input-container .flex-1.relative > textarea::-webkit-scrollbar {
      width: 6px;
    }
    
    .chat-input-container .flex-1.relative > textarea::-webkit-scrollbar-thumb {
      background-color: rgba(156, 163, 175, 0.3);
      border-radius: 3px;
    }
    
    .chat-input-container .flex-1.relative > textarea::-webkit-scrollbar-track {
      background: transparent;
    }

    .suggestion-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      position: absolute;
      top: 100%; /* Position it below the input area on desktop */
      left: 0;
      right: 0;
      z-index: 20;
      padding: 8px 16px;
      pointer-events: none; /* Allow clicks to pass through the container */
      transition: opacity 0.2s ease-out, transform 0.2s ease-out; /* Animate opacity and transform */
    }


    
    /* Desktop only - keep suggestions below input */
    @media (min-width: 1025px) {
      .suggestion-list {
        position: absolute !important;
        top: 100% !important;
        bottom: auto !important;
      }
    }
    
    /* MOBILE POSITIONING - Mobile phones only (iPad should use desktop positioning) */
    @media (max-width: 639px) {
      /* CSS custom properties for enhanced mobile compatibility */
      :root {
        --safe-area-inset-top: env(safe-area-inset-top, 0px);
        --safe-area-inset-right: env(safe-area-inset-right, 0px);
        --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
        --safe-area-inset-left: env(safe-area-inset-left, 0px);
        --keyboard-height: var(--keyboard-height, 0px);
        --vh: var(--vh, 1vh);
        --mobile-chat-input-height: calc(110px + var(--safe-area-inset-bottom));
      }
      
      /* Suggestion list positioning for all mobile devices */
      .suggestion-list {
        /* When inside mobile-suggestions-wrapper, use static positioning */
        position: static !important;
        z-index: 40 !important;
        pointer-events: none !important;
      }
      
      /* Re-enable clicks for the actual buttons inside */
      .suggestion-list > * {
        pointer-events: auto !important;
      }
      
      /* Override any positioning from the suggestion-buttons component */
      .suggestion-list .suggestion-buttons-container {
        position: static !important;
        margin: 0 !important;
        bottom: auto !important;
        top: auto !important;
        transform: none !important;
      }
      
      /* SIMPLIFIED MOBILE POSITIONING - Let parent handle fixed positioning */
      .chat-input-container {
        position: relative !important;
        width: 100% !important;
        background: transparent !important;
        padding: 0px !important;
        margin: 0px !important;
        box-sizing: border-box !important;
      }
      
      /* Desktop browsers - handled by body classes in globals.css */
      
      /* Safari iOS specific - PROPER safe area padding */
      @supports (-webkit-touch-callout: none) {
        @media (max-width: 639px) {
          .chat-input-container {
            /* Use both constant() and env() for compatibility */
            padding-bottom: constant(safe-area-inset-bottom) !important;
            padding-bottom: env(safe-area-inset-bottom) !important;
            /* Minimum padding fallback if safe area is 0 */
            min-height: calc(100px + constant(safe-area-inset-bottom));
            min-height: calc(100px + env(safe-area-inset-bottom));
          }
        }
      }
      
      /* Chrome iOS specific - needs extra bottom padding */
      @supports (not (-webkit-touch-callout: none)) {
        @media (max-width: 639px) and (pointer: coarse) {
          .chat-input-container {
            padding-bottom: max(env(safe-area-inset-bottom, 0px), 24px) !important;
            min-height: calc(100px + env(safe-area-inset-bottom));
          }
        }
      }
      
      /* Chrome iOS specific positioning using JavaScript-added class */
      /* Chrome iOS has a taller browser bar (~50px) than Safari, plus disclaimer (~30px) needs space */
      .chrome-ios .chat-input-container {
        padding-bottom: env(safe-area-inset-bottom, 0px) !important;
      }
      
      .chrome-ios .chat-input-container form {
        margin-bottom: 0px !important;
      }
      
      /* Chrome iOS needs extra disclaimer padding since base was reduced for Safari */
      .chrome-ios .chat-input-container > div:last-child {
        padding-bottom: 0px !important;
      }

      /* ENHANCED FORM STYLING WITH BETTER TOUCH TARGETS */
      .chat-input-container form {
        background: #EFE1D5 !important;
        border-radius: 28px !important;
        padding: 6px !important;
        margin: 8px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05) !important;
        transition: box-shadow 0.2s ease-out;
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      
      /* Safari specific - tighter bottom margin */
      @supports (-webkit-touch-callout: none) {
        .chat-input-container form {
          margin: 8px 8px 4px 8px !important;
        }
      }

      .dark .chat-input-container form {
        background: #3a3a3a !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
        margin: 8px 8px 0px 8px !important; /* Consistent with light mode */
        margin-bottom: 0px !important;
        padding-bottom: 6px !important; /* Increased for better touch targets */
        /* Enhanced touch interaction for dark mode */
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      
      /* ENHANCED TEXTAREA WITH BETTER TOUCH INTERACTION */
      .chat-input-container textarea {
        padding: 12px 18px 16px 18px !important; /* Reduced bottom padding to prevent overlap with tool buttons */
        min-height: 57px !important; /* Final compact height */
        max-height: 250px !important;
        font-size: 16px !important; /* Prevents zoom on iOS */
        line-height: 1.6 !important;
        border-radius: 12px !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        resize: none !important;
        /* Enhanced touch and interaction properties */
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
        /* Better scrolling behavior */
        -webkit-overflow-scrolling: touch;
        overflow-scrolling: touch;
        /* Prevent zoom on focus (iOS) */
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
        /* Better text rendering */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      
    }
    
    /* Hide suggestions when the form is submitting */
    .form-submitting .animate-fadeIn,
    .form-submitting .suggestion-list,
    .form-submitting .suggestion-item {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
    }

    .suggestion-item {
      cursor: pointer;
      transition: background-color 0.15s;
      border-radius: 12px;
      padding: 12px 16px;
      background-color: transparent;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: block;
      width: 100%;
      text-align: left;
      border: 0.5px solid rgba(212, 192, 182, 0.7);
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      margin: 0 auto;
      max-width: 600px;
      position: relative;
      z-index: 25;
    }

    .dark .suggestion-item {
      background-color: transparent;
      border-color: rgba(47, 47, 47, 0.7);
    }

    .suggestion-item:hover {
      background-color: rgba(255, 224, 208, 1);
    }

    .dark .suggestion-item:hover {
      background-color: rgba(51, 51, 51, 1);
    }

    .suggestion-category {
      font-weight: 600;
      color: #333;
      font-size: 14px;
    }

    .dark .suggestion-category {
      color: #E0E0E0;
    }

    .suggestion-text {
      color: #666;
      font-size: 14px;
    }

    .dark .suggestion-text {
      color: #AAAAAA;
    }
    
    .back-link {
      text-align: center;
      display: block;
      width: 100%;
      margin: 12px auto 4px;
      font-size: 13px;
      max-width: 600px;
      color: #666;
      text-decoration: none;
      font-weight: 400;
      position: relative;
      z-index: 25;
    }
    
    .back-link:hover {
      color: #333;
    }
    
    .dark .back-link {
      color: #999;
    }
    
    .dark .back-link:hover {
      color: #ccc;
    }
    
    /* ENHANCED MOBILE KEYBOARD HANDLING WITH VIEWPORT DETECTION */
    @supports (-webkit-touch-callout: none) {
      /* iOS Safari specific fixes with enhanced viewport handling */
      @media (max-width: 639px) {
        .chat-input-container {
          /* Let parent handle positioning */
          position: relative !important;
          /* Force safe area on actual iOS devices - add extra padding to move UP */
          padding-bottom: calc(constant(safe-area-inset-bottom) + 25px) !important;
          padding-bottom: calc(env(safe-area-inset-bottom) + 25px) !important;
        }
        
        /* Dynamic viewport height calculation for keyboard state */
        body {
          /* Set custom property for actual viewport height */
          --actual-vh: calc(var(--vh, 1vh) * 100);
          --keyboard-visible-vh: var(--keyboard-visible-vh, var(--actual-vh));
        }
        
        /* When keyboard is visible, maintain relative positioning */
        body.keyboard-visible .chat-input-container {
          position: relative !important;
        }
        
        /* Hide suggestions when keyboard is open to prevent overlap */
        body.keyboard-visible .suggestion-list {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
        
        /* ENHANCED IOS SAFARI SPECIFIC TEXTAREA FIXES */
        body.keyboard-visible .chat-input-container textarea {
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
          /* Prevent iOS from zooming on focus - critical for UX */
          font-size: max(16px, 1rem) !important;
          /* Improve scrolling behavior */
          -webkit-overflow-scrolling: touch;
          overflow-scrolling: touch;
          /* Fix iOS Safari input focus issues */
          -webkit-appearance: none;
          appearance: none;
          /* Prevent iOS Safari from adding default styling */
          border-radius: 12px !important;
          /* Fix scroll position jumping */
          scroll-behavior: smooth;
          /* Prevent iOS momentum scrolling issues */
          overscroll-behavior: contain;
          /* Better text rendering during input */
          -webkit-text-fill-color: currentColor;
          -webkit-opacity: 1;
        }
        
        /* Fix iOS Safari scroll restoration after keyboard hide */
        body.keyboard-hidden .chat-input-container textarea {
          scroll-behavior: auto;
          /* Restore smooth scrolling after keyboard animation */
          transition: scroll-behavior 0.1s ease;
        }
        
        /* iOS Safari focus state improvements */
        .chat-input-container textarea:focus {
          /* Prevent iOS from adding default focus styles */
          -webkit-appearance: none;
          appearance: none;
          /* Remove outline on mobile */
          outline: none !important;
        }
        
        /* Prevent viewport shifts during keyboard animation */
        body.keyboard-transitioning {
          overflow: hidden !important;
        }
        
        /* Optimize for smooth keyboard transitions */
        body.keyboard-transitioning .chat-input-container {
          will-change: bottom, transform !important;
          transform: translateZ(0) !important;
          -webkit-transform: translateZ(0) !important;
        }
      }
    }
    
    /* iOS-SPECIFIC FIXES: Hide duplicate disclaimer and position scroll button */
    @supports (-webkit-touch-callout: none) {
      @media (max-width: 639px) {
        /* Hide the page.tsx disclaimer on iOS - chat-input.tsx already shows one */
        .ios-hidden {
          display: none !important;
        }
        
        /* iOS scroll button positioning - lower than Android since iOS doesn't need as much clearance */
        .scroll-indicator-down {
          top: -48px !important; /* 12 * 4 = 48px, same as desktop - iOS handles safe areas differently */
        }
      }
    }
    
    /* ENHANCED ANDROID CHROME SPECIFIC OPTIMIZATIONS */
    /* IMPORTANT: gate to touch devices so desktop Chrome at narrow widths doesn't get "mobile-fixed" input */
    @supports (not (-webkit-touch-callout: none)) and (-webkit-appearance: none) {
      @media (max-width: 639px) and (pointer: coarse) {
        /* CRITICAL FIX: When inside #mobile-dock (initial view), use relative positioning
           to allow parent flex container to stack suggestions above input properly */
        #mobile-dock .chat-input-container {
          position: relative !important;
          bottom: auto !important;
          width: 100% !important;
        }
        
        /* Only apply fixed positioning when NOT inside #mobile-dock */
        .chat-input-container:not(#mobile-dock .chat-input-container) {
          position: fixed !important;
          /* Position 28px from bottom to leave room for mobile disclaimer text below */
          bottom: max(28px, calc(28px + var(--safe-area-inset-bottom))) !important;
        }
        
        /* Enhanced Android keyboard handling with viewport units */
        body.keyboard-visible .chat-input-container:not(#mobile-dock .chat-input-container) {
          position: fixed !important;
          /* Use svh (small viewport height) for Android keyboard */
          bottom: max(0px, calc(100svh - var(--keyboard-visible-vh, 100svh))) !important;
          /* Fallback for older Android versions */
          bottom: max(0px, var(--keyboard-adjusted-bottom, 0px)) !important;
          /* Smooth transition for Android keyboard */
          transition: bottom 0.2s ease-out !important;
        }
        
        /* Android specific textarea optimizations */
        .chat-input-container textarea {
          /* Prevent Android zoom on focus */
          font-size: max(16px, 1rem) !important;
          /* Better touch scrolling */
          overscroll-behavior: contain;
          /* Optimize rendering */
          will-change: scroll-position;
        }
        
        /* Android keyboard transition optimization */
        body.keyboard-visible .chat-input-container textarea {
          /* Maintain font size during keyboard transition */
          font-size: max(16px, 1rem) !important;
          /* Prevent text jumping */
          line-height: 1.5 !important;
        }
      }
    }
    
    /* UNIVERSAL MOBILE VIEWPORT HANDLING */
    @media (max-width: 639px) {
      /* Support for newer viewport units across all mobile browsers */
      @supports (height: 100dvh) {
        .chat-input-container {
          /* Use dynamic viewport height when available */
          min-height: calc(100px + env(safe-area-inset-bottom, 0px)) !important;
        }
        
        body.keyboard-visible .chat-input-container {
          /* Better keyboard positioning with dvh */
          bottom: max(0px, calc(100dvh - 100svh)) !important;
        }
      }
      
      /* Fallback for browsers without new viewport unit support */
      @supports (not (height: 100dvh)) {
        body.keyboard-visible .chat-input-container {
          /* Use JavaScript-calculated values */
          bottom: var(--keyboard-adjusted-bottom, 0px) !important;
        }
      }
    }
    
    /* ENHANCED TOUCH TARGETS AND BUTTON INTERACTIONS */
    /* Only apply on actual touch devices, not desktop browsers at narrow widths */
    @media (max-width: 639px) and (pointer: coarse) {
      /* Touch interaction enhancements without changing button size */
      .chat-input-container button {
        /* Enhanced touch interaction */
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      
      /* Upload and tool buttons - just touch settings, no size changes */
      .chat-input-container .mobile-tools-button,
      .chat-input-container .unified-upload-button {
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      
      /* Suggestion items touch targets */
      .suggestion-item {
        min-height: 56px !important; /* Larger touch target for suggestions */
        padding: 16px 20px !important; /* Increased padding */
        margin: 4px 8px !important; /* Better spacing */
        /* Enhanced touch feedback */
        -webkit-tap-highlight-color: transparent;
        tap-highlight-color: transparent;
        touch-action: manipulation;
        cursor: pointer;
        transition: transform 0.1s ease, background-color 0.15s ease !important;
      }
      
      .suggestion-item:active {
        transform: scale(0.98) !important;
      }
      
      /* ENHANCED TEXT SELECTION AND INPUT BEHAVIOR */
      .chat-input-container textarea {
        -webkit-user-select: text !important;
        user-select: text !important;
        /* Better cursor visibility */
        caret-color: #FF6417 !important;
        /* Critical iOS fixes */
        font-size: max(16px, 1rem) !important; /* Prevent zoom on all mobile devices */
        /* Enhanced iOS Safari input behavior */
        -webkit-appearance: none !important;
        appearance: none !important;
        /* Fix iOS Safari text input lag */
        -webkit-text-size-adjust: 100% !important;
        text-size-adjust: 100% !important;
        /* Better placeholder behavior on iOS */
        -webkit-text-fill-color: currentColor !important;
        -webkit-opacity: 1 !important;
      }
      
      /* Placeholder specific fixes for iOS Safari */
      .chat-input-container textarea::placeholder {
        -webkit-text-fill-color: rgba(156, 163, 175, 1) !important;
        opacity: 1 !important;
      }
      
      .dark .chat-input-container textarea::placeholder {
        -webkit-text-fill-color: rgba(156, 163, 175, 1) !important;
        opacity: 1 !important;
      }
      
      /* Focus states for better accessibility */
      .chat-input-container textarea:focus {
        outline: none !important;
      }
      
      .chat-input-container button:focus-visible {
        outline: 2px solid rgba(255, 100, 23, 0.5) !important;
        outline-offset: 2px !important;
      }
      
      /* ENHANCED MOBILE SCROLLING AND MOMENTUM */
      .chat-input-container textarea {
        /* Better scrolling physics */
        -webkit-overflow-scrolling: touch !important;
        overflow-scrolling: touch !important;
        /* Optimize scroll performance */
        will-change: scroll-position !important;
        /* Prevent overscroll bounce that can cause issues */
        overscroll-behavior: contain !important;
        /* Better scroll indicators */
        /* Hide scrollbar until content overflows */
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      
      /* Hide webkit scrollbar on mobile */
      .chat-input-container textarea::-webkit-scrollbar {
        display: none !important;
      }
      
      /* Better mobile scrolling for suggestion list */
      .suggestion-list {
        -webkit-overflow-scrolling: touch !important;
        overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
      }
      
      /* Optimize document selector scrolling */
      .document-selector {
        -webkit-overflow-scrolling: touch !important;
        overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
      }
    }
    
    /* MOBILE PERFORMANCE OPTIMIZATIONS */
    @media (max-width: 639px) {
      /* Optimize rendering performance */
      .chat-input-container {
        /* Enable hardware acceleration */
        will-change: transform, opacity !important;
        transform: translateZ(0) !important;
        -webkit-transform: translateZ(0) !important;
        /* Better composition layer */
        isolation: isolate;
      }
      
      /* Optimize form rendering */
      .chat-input-container form {
        /* Enable hardware acceleration */
        transform: translateZ(0) !important;
        -webkit-transform: translateZ(0) !important;
        /* Better repaint performance */
        contain: layout style paint !important;
      }
      
      /* Optimize textarea rendering */
      .chat-input-container textarea {
        /* Better text rendering performance */
        contain: layout style paint !important;
        /* Optimize for frequent updates */
        will-change: contents !important;
      }
    }
  `;

  // Calculate position for suggestion menu
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Update menu position when active category changes
  useEffect(() => {
    if (activeCategory && categoryButtonRefs.current[activeCategory]) {
      const buttonEl = categoryButtonRefs.current[activeCategory];
      if (buttonEl) {
        const rect = buttonEl.getBoundingClientRect();
        setMenuPosition({
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
          width: Math.max(rect.width, 200)  // At least 200px wide
        });
      }
    }
  }, [activeCategory]);

  // Add a ref for the suggestions component right after other refs
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  // Add an effect to handle clicks outside the suggestions when a category is active
  useEffect(() => {
    // Only activate the click-outside handler when a category is active
    if (activeCategory) {
      const handleClickOutside = (event: MouseEvent) => {
        // Make sure we're not closing the category when clicking inside the suggestion list
        if (event.target instanceof Element) {
          // Check if we're clicking on a suggestion-item or back-link
          const isSuggestionItem = event.target.closest('.suggestion-item') !== null;
          const isBackLink = event.target.closest('.back-link') !== null;
          const isSuggestionButton = event.target.closest('button[type="button"]') !== null;

          if (isSuggestionItem || isBackLink) {
            // Don't close the suggestions if clicking on a suggestion item or back link
            return;
          }
        }

        // Close the category menu immediately when clicking outside - don't check if it's within the container bounds
        setActiveCategory("");
      };

      // Add the event listener to the document
      document.addEventListener('mousedown', handleClickOutside, true);

      // Clean up the event listener when the component unmounts or category changes
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [activeCategory]);

  // Determine if the input should be disabled
  const isInputDisabled = useMemo(() => {
    return parentIsLoading ||
      hasLoadingPlaceholders ||
      isAnyMediaProcessing ||
      hasActiveChatContent ||
      isMediaLoading ||
      (Boolean(currentChatId) && Boolean(currentChat?.messages?.length) && !isInitialChatState);
  }, [
    parentIsLoading,
    hasLoadingPlaceholders,
    isAnyMediaProcessing,
    hasActiveChatContent,
    isMediaLoading,
    currentChatId,
    currentChat?.messages?.length,
    isInitialChatState
  ]);

  // Add custom input handling to detect / symbol and Tab completion
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Tab key for suggestion completion
    if (e.key === 'Tab' && showSuggestion && suggestionText) {
      e.preventDefault();

      // Get the current input and find where the last word starts
      const words = input.split(/\s+/);
      const lastWordIndex = input.lastIndexOf(words[words.length - 1]);

      // Replace the partial word with the full "Negative prompt:"
      const newInput = input.substring(0, lastWordIndex) + 'Negative prompt: ';
      setInput(newInput);

      // Clear the suggestion
      setShowSuggestion(false);
      setSuggestionText('');

      // Keep focus on the textarea
      e.currentTarget.focus();

      // Set cursor position to the end
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.value.length;
          textareaRef.current.selectionEnd = textareaRef.current.value.length;
        }
      }, 0);

      return;
    }

    // Handle backspace key for document selector
    if (e.key === 'Backspace' && isDocumentSelectorOpen) {
      const textArea = e.currentTarget;
      const { selectionStart, selectionEnd, value } = textArea;

      // Check if we're about to delete the "/" character that triggered the selector
      if (selectionStart === selectionEnd && selectionStart > 0) {
        const charBeforeCursor = value.charAt(selectionStart - 1);
        if (charBeforeCursor === '/') {
          // Close the document selector when "/" is deleted
          setIsDocumentSelectorOpen(false);
        }
      }
    }

    // Only handle / symbol for document selector
    if (e.key === '/') {
      const textArea = e.currentTarget;

      // Get cursor position
      const rect = textArea.getBoundingClientRect();

      // Calculate position that ensures the selector is visible
      // We want to position it below the cursor
      const cursorHeight = 24; // Approximate line height

      // Position relative to viewport (since we're using fixed positioning)
      const top = Math.min(rect.top + cursorHeight + 8, window.innerHeight - 400); // Keep it within viewport
      const left = Math.min(rect.left + 50, window.innerWidth - 300); // Ensure it doesn't go off-screen

      console.log('Setting document selector position:', { top, left });

      setDocumentSelectorPosition({ top, left });
      setIsDocumentSelectorOpen(true);
    }

    // Add default enter key behavior
    if (e.key === "Enter" && !e.shiftKey && !parentIsLoading && !isProcessingDoc) {
      // Check if 3D generation is active with an image
      if (isGenerating3D && threeDGenSettings?.imageFile) {
        e.preventDefault();
        formRef.current?.requestSubmit();
        return;
      }

      // Normal submit for regular messages
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  // Add document selection handler
  const handleDocumentSelect = (document: Document) => {
    console.log('Handle document select called with:', document);

    // Safely handle potentially missing properties
    if (!document || typeof document !== 'object') {
      console.error('Invalid document object received:', document);
      return;
    }

    // Add the document to the store if it has a valid ID
    if (document.id) {
      addDocument(document);
    } else {
      console.error('Document is missing ID:', document);
      return;
    }

    // CRITICAL FIX: Insert document mention into text using uncontrolled approach
    const textArea = textareaRef.current;
    if (textArea) {
      const { selectionStart, selectionEnd } = textArea;
      const textBefore = textArea.value.substring(0, selectionStart);
      const textAfter = textArea.value.substring(selectionEnd);

      // We remove the / that triggered this and replace it with the document reference
      // Safely handle missing name property
      const docName = document.name || `Document-${document.id.substring(0, 8)}`;
      const newText = textBefore.slice(0, -1) + `${docName} ` + textAfter;

      // Clear typing state since this is programmatic
      isTypingRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Controlled component handles value via React state

      // Auto-resize textarea (React will handle the value via controlled component)
      autoResize(textArea);
      // Value updated via onChange

      // Focus and set cursor position after the mention
      textArea.focus();
      const newCursorPos = selectionStart + (docName?.length || 0) + 1; // +1 for the space
      setTimeout(() => {
        textArea.selectionStart = textArea.selectionEnd = newCursorPos;
      }, 10);

      // Sync to parent (immediate for document selection)
      startTransition(() => {
        setInput(newText);
      });
    }

    // Close the selector
    setIsDocumentSelectorOpen(false);
  };

  // Add debugging effect
  useEffect(() => {
    if (isDocumentSelectorOpen) {
      console.log('Document selector opened at position:', documentSelectorPosition);

      // Check if element exists in DOM after a short delay
      setTimeout(() => {
        const selector = document.querySelector('.document-selector');
        console.log('Document selector element found in DOM:', !!selector);
      }, 100);
    }
  }, [isDocumentSelectorOpen, documentSelectorPosition]);

  // Add this function after handleImageGenSettingsChange
  const clearImageGenerationSource = () => {
    if (imageGenSettings?.sourceImages || imageGenSettings?.sourceImage) {
      console.log('Clearing image generation source images');
      // Update the settings but clear the source images
      setImageGenSettings({
        ...imageGenSettings,
        sourceImages: undefined,
        sourceImage: undefined,
        maskImage: undefined
      });
    }
  };

  // Create a custom wrapper for the clearFile function
  const handleClearFile = () => {
    clearFile(); // Call the original clearFile from useFileUploadStore
    clearImageGenerationSource(); // Also clear any image generation source
    multiFileStore.clearAllFiles(); // Clear multi-file store

    // Also clear 3D generation settings if active
    if (threeDGenSettings) {
      setThreeDGenSettings(null);
      setIsGenerating3D(false);
    }
  };

  // Now replace onClick={clearFile} with onClick={handleClearFile} in the image preview close button
  // Replace this line:
  // onClick={clearFile}
  // with:
  // onClick={handleClearFile}

  // Now update the JSX to include our document selector and document tags
  return (
    <>
      {/* Add animation styles */}
      <style dangerouslySetInnerHTML={{
        __html: style + `
        /* SVG Stroke Animation - Smoother cornering */
        @keyframes svg-travel {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: calc(var(--perimeter) * -1px); }
        }
      `}} />

      {/* Suggestion buttons are now rendered in the main page component for proper layout */}

      <div className={cn("chat-input-container relative z-50", className)}>
        {/* Voice Mode Overlay moved here to share stacking context with the input form */}
        {VOICE_MODE_ENABLED && (
          <VoiceModeOverlay
            isActive={isVoiceModeActive}
            onEnd={() => {
              console.log('[ChatInput] VoiceModeOverlay requested end');
              setIsVoiceModeActive(false);
            }}
          />
        )}
        {/* Add a debug element */}
        {process.env.NODE_ENV === 'development' && (
          <div className="hidden">
            Loading: {String(parentIsLoading)}
            Has Stop Handler: {String(!!handleStop)}
          </div>
        )}

        <div className="flex justify-center pt-0 pb-0 md:px-4">

          <form
            ref={formRef}
            onSubmit={handleFormSubmit}
            onClick={handleFormClick}
            className={cn(
              'relative rounded-3xl p-1 w-full sm:max-w-full lg:max-w-[52rem] border border-[#D4C0B6]/20 dark:border-gray-600/20',
              // Force opaque background in voice mode with !important to ensure no bleed-through
              isVoiceModeActive
                ? '!bg-[#EFE1D5] dark:!bg-[#2F2F2F] !opacity-100 shadow-xl'
                : 'bg-[#EFE1D5]/70 dark:bg-[#2F2F2F]/70 backdrop-blur-sm',
              'sm:mb-8',
              'rounded-3xl', // Consistent radius
              // Only apply opacity reduction if NOT in voice mode (or force it off)
              (isProcessingDoc && !isVoiceModeActive) && 'opacity-70',
              'z-20' // Ensure it sits above voice overlay text
            )}
          >
            {/* Animated Gradient Border - SVG Implementation */}
            <div
              ref={containerRef}
              className="absolute -inset-[1px] pointer-events-none z-30"
              style={{
                '--perimeter': perimeter,
                overflow: 'visible',
              } as React.CSSProperties}
            >
              {(perimeter > 0 && borderEnabled) && (
                <svg
                  className="w-full h-full"
                  style={{
                    overflow: 'visible',
                    filter: `
                      drop-shadow(0 0 1.5px rgba(255,100,23,0.8))
                      drop-shadow(0 0 3px rgba(255,100,23,0.5))
                      drop-shadow(0 0 5px rgba(255,100,23,0.25))
                    `,
                    opacity: 0.85
                  }}
                >
                  {/* Primary comet */}
                  <rect
                    x="1.25" y="1.25"
                    width="calc(100% - 2.5px)" height="calc(100% - 2.5px)"
                    rx="24" ry="24"
                    fill="none"
                    stroke="#FF6417"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    style={{
                      strokeDasharray: `220 ${Math.max(0, perimeter - 220)}`,
                      animation: 'svg-travel 14s linear infinite',
                    }}
                  />

                  {/* Secondary comet (opposite side) */}
                  <rect
                    x="1.25" y="1.25"
                    width="calc(100% - 2.5px)" height="calc(100% - 2.5px)"
                    rx="24" ry="24"
                    fill="none"
                    stroke="#FF6417"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    style={{
                      strokeDasharray: `160 ${Math.max(0, perimeter - 160)}`,
                      strokeDashoffset: `calc(var(--perimeter) * -0.5px)`, // Start halfway, using pixels
                      animation: 'svg-travel 14s linear infinite',
                    }}
                  />
                </svg>
              )}
            </div>

            {/* Background Layer - 80% opacity for aesthetic */}
            <div className="absolute inset-0 rounded-3xl bg-[#EFE1D5]/80 dark:bg-[#2F2F2F]/80 backdrop-blur-sm z-10" />
            <div className={cn("relative px-2 sm:px-1 flex flex-col z-20", isLongInput && "max-h-[400px]")}>

              {/* Document preview - Minimal design */}
              {(tempDoc || processingDoc || (fileType === 'document' && file)) &&
                <div className="mx-2 sm:mx-3 mt-1.5 mb-0.5">
                  <div className="relative inline-block w-[64px] h-[64px]">
                    <div className={cn(
                      "w-full h-full rounded-lg border border-gray-200/30 dark:border-gray-600/30 bg-gray-100 dark:bg-gray-700 flex items-center justify-center",
                      processingDoc && "animate-pulse relative",
                      docProcessingError && "border-red-500 dark:border-red-500"
                    )}>
                      <FileText className={cn(
                        "h-6 w-6 text-gray-500 dark:text-gray-400",
                        processingDoc && "opacity-40",
                        docProcessingError && "text-red-500 dark:text-red-500"
                      )} />
                      {processingDoc && !docProcessingError && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-[#FF6417] dark:text-[#FF6417]" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (tempDoc) {
                          clearTempDoc();
                        } else {
                          handleClearFile();
                        }
                      }}
                      className="absolute w-5 h-5 p-0 rounded-full hover:bg-[#FF6417]/10 transition-all border border-[#D4C0B6]/30 dark:border-gray-600/30 hover:border-[#FF6417] dark:hover:border-[#FF6417] bg-[#EFE1D5]/90 dark:bg-[#2F2F2F]/90 flex items-center justify-center shadow-sm"
                      style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        zIndex: 30
                      }}
                    >
                      <X className="w-3 h-3 text-[#FF6417] dark:text-[#FF6417]" />
                    </button>
                  </div>
                </div>
              }

              {/* Debug logging for multiFileStore */}
              {(() => {
                console.log('[Multi-File Debug] multiFileStore.files:', multiFileStore.files);
                console.log('[Multi-File Debug] fileType:', fileType, 'file:', file, 'fileUrl:', fileUrl);
                return null;
              })()}

              {/* Single Image preview - Only show if NO multi-file uploads present */}
              {/* This is for single file uploads (documents, etc), not image generation */}
              {fileType === 'image' && file && fileUrl && multiFileStore.files.length === 0 && (
                <div className="mx-2 sm:mx-3 mt-1.5 mb-0.5">
                  <div className="relative inline-block w-[64px] h-[64px]">
                    <div className="w-full h-full rounded-lg overflow-hidden border border-gray-200/30 dark:border-gray-600/30">
                      <img
                        src={fileUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.error('Failed to load image preview:', file.name);
                          e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yNCAyNEgzMlY0MEgyNFYyNFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDI0SDQwVjQwSDMyVjI0WiIgZmlsbD0iI0Q5REFFM0UiLz4KPC9zdmc+';
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleClearFile}
                      className="absolute w-5 h-5 p-0 rounded-full hover:bg-[#FF6417]/10 transition-all border border-[#D4C0B6]/30 dark:border-gray-600/30 hover:border-[#FF6417] dark:hover:border-[#FF6417] bg-[#EFE1D5]/90 dark:bg-[#2F2F2F]/90 flex items-center justify-center shadow-sm"
                      style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        zIndex: 30
                      }}
                    >
                      <X className="w-3 h-3 text-[#FF6417] dark:text-[#FF6417]" />
                    </button>
                  </div>
                </div>
              )}

              {/* Multiple Images preview - Horizontal scrollable */}
              {(() => {
                console.log('[Multi-File Preview Check] multiFileStore.files.length:', multiFileStore.files.length);
                console.log('[Multi-File Preview Check] Files detail:', multiFileStore.files);
                console.log('[Multi-File Preview Check] Should show preview:', multiFileStore.files.length > 0);
                if (multiFileStore.files.length > 0) {
                  console.log('[Multi-File Preview Check] ✅ SHOULD BE SHOWING PREVIEW NOW!');
                }
                return null;
              })()}
              {multiFileStore.files.length > 0 && (
                <div className="mx-2 sm:mx-3 mt-0.5 mb-0.5 pt-2">
                  <div className="flex gap-2 overflow-x-auto overflow-y-visible pb-2 scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500 dark:hover:scrollbar-thumb-gray-500" style={{ maxWidth: '100%', scrollBehavior: 'smooth' }}>
                    {multiFileStore.files.map((uploadedFile, index) => (
                      <div key={index} className="relative inline-block flex-shrink-0 w-[64px] h-[64px] mt-2">
                        <div className="w-full h-full rounded-lg overflow-hidden border border-gray-200/30 dark:border-gray-600/30">
                          <img
                            src={uploadedFile.uploadedUrl || uploadedFile.tempUrl}
                            alt={uploadedFile.file.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              console.error('Failed to load image preview:', uploadedFile.file.name);
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yNCAyNEgzMlY0MEgyNFYyNFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHBhdGggZD0iTTMyIDI0SDQwVjQwSDMyVjI0WiIgZmlsbD0iI0Q5REFFM0UiLz4KPC9zdmc+';
                            }}
                          />
                          {uploadedFile.isUploading && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                              <Loader2 className="h-4 w-4 text-white animate-spin" />
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => multiFileStore.removeFile(index)}
                          className="absolute w-5 h-5 p-0 rounded-full hover:bg-[#FF6417]/10 transition-all border border-[#D4C0B6]/30 dark:border-gray-600/30 hover:border-[#FF6417] dark:hover:border-[#FF6417] bg-[#EFE1D5]/90 dark:bg-[#2F2F2F]/90 flex items-center justify-center shadow-sm"
                          style={{
                            position: 'absolute',
                            top: '-8px',
                            right: '-8px',
                            zIndex: 30
                          }}
                        >
                          <X className="w-3 h-3 text-[#FF6417] dark:text-[#FF6417]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col flex-1 min-h-0 overflow-x-hidden cursor-text">
                <div className={cn("flex items-center gap-2", isTextareaExpanded ? "mb-12" : "mb-10", "sm:mb-12")}>
                  <div className="flex-1 max-h-[250px] min-h-[40px] relative overflow-x-hidden">
                    {/* Subtle text indicator positioned to the right */}
                    {hasNegativePrompt && videoGenSettings && (
                      <div className="absolute -top-4 right-2 text-purple-600 dark:text-purple-400 text-[7px] flex items-center gap-0.5 z-20">
                        <span className="w-1 h-1 bg-purple-500 dark:bg-purple-400 rounded-full animate-pulse"></span>
                        <span>Negative prompt active</span>
                      </div>
                    )}

                    <textarea
                      ref={textareaRef}
                      tabIndex={0}
                      rows={1}
                      value={isGenerating3D ? "" : (input.length > 10000 ? "" : input)}
                      onChange={optimizedHandleInputChange}
                      placeholder={isGenerating3D ? t('generate3DModel') : t('messagePlaceholder')}
                      spellCheck={false}
                      disabled={parentIsLoading || isProcessingDoc || isRecording || isTranscribing || isMediaLoading}
                      className="w-full resize-none bg-transparent px-3 focus:outline-none placeholder-gray-500 dark:placeholder-gray-400 max-h-[250px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent py-2 sm:py-3 leading-6 sm:leading-relaxed min-h-[42px] mobile-textarea relative z-10 text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words"
                      onKeyDown={handleKeyDown}
                      style={{
                        WebkitTapHighlightColor: 'transparent'
                      }}
                    />

                    {/* Ghost text suggestion overlay */}
                    {showSuggestion && suggestionText && (
                      <div
                        className="absolute inset-0 pointer-events-none px-3 py-2 sm:py-3 leading-6 sm:leading-relaxed overflow-hidden"
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        <span className="text-transparent">
                          {input}
                        </span>
                        <span className="text-gray-400 dark:text-gray-500 opacity-60">
                          {suggestionText}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 py-1 px-1 sm:px-1.5 rounded-b-3xl cursor-default">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 ml-2">
                    <UnifiedUploadButton
                      disabled={parentIsLoading || isProcessingDoc || Boolean(file)}
                      onTempDocUpload={handleTempDocUpload}
                      onProcessingStateChange={(state) => {
                        if (state.isProcessing) {
                          setProcessingDoc({
                            name: state.name || 'Document',
                            isProcessing: true
                          });
                          setIsProcessingDoc(true);
                          setDocProcessingError(null);
                        } else {
                          if (state.error) {
                            setDocProcessingError(state.error);
                          }
                          setIsProcessingDoc(false);
                          // Don't clear processingDoc here - let it stay until tempDoc is set
                        }
                      }}
                    />

                    <div className="w-0.5"></div> {/* Smaller spacer */}

                    {/* Mobile Layout - Show Tools button and Active Tool Indicator */}
                    {isMobile && (
                      <>
                        <MobileToolsButton
                          disabled={parentIsLoading || isProcessingDoc}
                          className="lg:hidden"
                        />

                        {/* Active Tool Indicator - positioned to the right of tools button */}
                        <MobileActiveToolIndicator
                          isVisible={getActiveToolType() !== null}
                          toolType={getActiveToolType()}
                          onCancel={handleCancelActiveTool}
                          className="lg:hidden"
                        />
                      </>
                    )}

                    {/* Desktop Layout - Show individual buttons */}
                    {!isMobile && (
                      <>
                        {isWebSearchAvailable && (
                          <WebSearchButton
                            onWebSearchToggle={handleWebSearchToggle}
                            isActive={isWebSearchEnabled}
                            disabled={parentIsLoading || isProcessingDoc || Boolean(tempDoc)}
                          />
                        )}

                        <ReasoningButton
                          onReasoningToggle={(config) => {
                            // Update global store
                            if (config) {
                              reasoningStore.setConfig(config);
                            } else {
                              reasoningStore.setEnabled(false);
                            }
                          }}
                          isActive={reasoningStore.enabled}
                          currentModel={currentModel?.id}
                          disabled={parentIsLoading || isProcessingDoc || Boolean(tempDoc)}
                        />

                        {IMAGE_GENERATION_ENABLED && (
                          <ImageGenerationButton
                            disabled={parentIsLoading || isProcessingDoc}
                            onImageGenerate={(config) => toggleImageGeneration(config)}
                            hasText={Boolean(input.trim())}
                            hasDocumentContext={true}
                            isActive={Boolean(imageGenSettings)}
                            sourceImage={imageGenSettings?.sourceImages?.[0] || imageGenSettings?.sourceImage}
                            onSourceImageSelect={(file) => {
                              if (imageGenSettings) {
                                // Update existing settings with the new file
                                handleImageGenSettingsChange({
                                  ...imageGenSettings,
                                  sourceImages: file ? [file] : undefined
                                });
                              }
                            }}
                            onMenuOpenChange={setIsImageMenuOpen}
                          />
                        )}

                        {VIDEO_GENERATION_ENABLED && (
                          <VideoGenerationButton
                            disabled={parentIsLoading || isProcessingDoc}
                            onVideoGenerate={handleVideoGenerate as any}
                            hasText={Boolean(input.trim())}
                            hasDocumentContext={true}
                            isActive={Boolean(videoGenSettings)}
                            sourceImage={videoGenSettings?.sourceImage as File | undefined}
                            onSourceImageSelect={(file) => {
                              console.log('🔥 Video onSourceImageSelect called with:', file ? `${file.name} (${file.size} bytes)` : 'null');
                              if (file) {
                                // Update existing settings with the new file or create new settings
                                const newSettings = {
                                  ...videoGenSettings,
                                  isActive: true,
                                  sourceImage: file
                                };
                                console.log('🔥 Video updating videoGenSettings with:', newSettings);
                                setVideoGenSettings(newSettings);
                              } else {
                                // Remove source image
                                if (videoGenSettings) {
                                  setVideoGenSettings({
                                    ...videoGenSettings,
                                    sourceImage: undefined
                                  });
                                }
                              }
                            }}
                            onMenuOpenChange={setIsVideoMenuOpen}
                          />
                        )}

                        {THREE_D_GENERATION_ENABLED && (
                          <ThreeDGenerationButton
                            disabled={parentIsLoading || isProcessingDoc}
                            hasDocumentContext={true}
                            onThreeDGenerate={(textureSize, meshSimplify, ssSamplingSteps, texturedMesh, useContext, imageFiles) => {
                              handleThreeDGenSettingsChange(
                                textureSize,
                                meshSimplify,
                                ssSamplingSteps,
                                texturedMesh,
                                useContext,
                                imageFiles
                              );
                            }}
                            isActive={Boolean(threeDGenSettings)}
                          />
                        )}

                        {/* Add MCP Tools Button */}
                        {MCP_TOOLS_LIST_ENABLED && (
                          <MCPToolsButton
                            disabled={parentIsLoading || isProcessingDoc}
                          />
                        )}
                      </>
                    )}
                  </div>
                  {renderButton()}
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Mobile disclaimer now handled at the end of chat-input-container using t('disclaimer') */}

        {/* Document selector dropdown */}
        <DocumentSelector
          isOpen={isDocumentSelectorOpen}
          onDocumentSelect={handleDocumentSelect}
          onClose={() => setIsDocumentSelectorOpen(false)}
          position={documentSelectorPosition}
        />

        {/* Mobile Tools Modal */}
        <MobileToolsModal
          isOpen={isPrimaryModalOpen}
          onClose={closePrimaryModal}
          onToolSelect={handleMobileToolSelect}
          isWebSearchEnabled={isWebSearchAvailable}
          isImageGenerationEnabled={IMAGE_GENERATION_ENABLED}
          isVideoGenerationEnabled={VIDEO_GENERATION_ENABLED}
          is3DGenerationEnabled={THREE_D_GENERATION_ENABLED}
          isMCPToolsEnabled={MCP_TOOLS_LIST_ENABLED}
          isSubMenuOpen={isSecondaryModalOpen}
        />
        <MobileToolConfigModal
          isOpen={isSecondaryModalOpen}
          onClose={closeSecondaryModal}
          onApplyConfig={handleConfigApply}
          toolType={activeTool}
        />
        <MobileMCPToolsModal
          isOpen={isMCPModalOpen}
          onClose={() => setIsMCPModalOpen(false)}
        />

        {/* Mobile disclaimer text - inside chat-input-container so it's visible in fixed mobile dock */}
        <div
          className="sm:hidden w-full text-center pointer-events-none bg-[#FFF1E5] dark:bg-[#212121]"
          style={{
            paddingTop: '4px',
            paddingBottom: '6px'
          }}
        >
          <p className="text-gray-500 dark:text-gray-400 text-center" style={{ fontSize: '10px' }}>
            {t('mobileDisclaimer')}
          </p>
        </div>


      </div>
    </>
  );
});
