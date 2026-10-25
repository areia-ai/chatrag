'use client';

import { useAudioSettings } from '@/lib/hooks/use-audio-settings';
import { useIsTouchDevice } from '@/lib/hooks/use-touch-device';

// First declare the props interface before using it
interface ChatMessageProps {
  message: Omit<UIMessage, 'content'> & {
    content: string | ContentPart[];
  };
  isLastMessage?: boolean;
  isFirstMessage?: boolean;
  isThinking?: boolean;
  isStreaming?: boolean;
  isStreamingMessage?: boolean;
  className?: string;
  sessionId?: string; // Add sessionId for MCP tool persistence
}

// Then forward declare the ChatMessage component for the export
let ChatMessage: React.FC<ChatMessageProps>;

// Export the component
export { ChatMessage };

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { UIMessage, ToolCallPart as SDKToolCallPart, ToolResultPart as SDKToolResultPart } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { Check, ChevronUp, ChevronDown, Copy, ChevronsUpDown, FileX, Play, Download, Video, AudioLines, FileText, Clipboard, CheckCheck, Brain, Database } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { useTheme } from '@/components/theme-provider';
import { onAudioStateChange, stopAudioPlayback, textToSpeech, getCachedAudioBlob, isAudioCached, generateAudioFilename } from '@/lib/audio-utils';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { env } from '@/lib/env';
import { useTextSize } from '@/components/providers/text-size-provider';
import { useFont } from '@/components/providers/font-provider';
import { Markdown } from '@/components/ui/markdown';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { generatePDFBlob, generatePDFFilename, downloadMessageAsPDF } from '@/lib/pdf-utils';
import { useArtifact } from '@/components/providers/artifact-provider';
import { useToast } from '@/components/ui/use-toast';
import { useLanguage } from '@/components/providers/language-provider';
import { useSources } from '@/components/providers/sources-provider';
import { cleanMarkdown } from '@/lib/title-generator';
import { IconOpenAI, IconUser } from '@/components/ui/icons';
import { UserSettings } from '@/lib/user-settings-store';
import { McpToolBox } from '@/components/ui/mcp-tool-box';
import { ModelViewer } from '@/components/ui/model-viewer';
import { CopyButton } from './CopyButton';
import { Spinner } from './spinner';
import { SourcesButton } from './sources-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { formatToolResultUniversally, needsRichFormatting } from '@/lib/universal-tool-formatter';
import { type ToolExecutionState } from '@/lib/tool-execution-state';
import Image from 'next/image';
import ReactDOM from 'react-dom';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { useModel } from '@/components/providers/model-provider'
import { ImageModal } from './image-modal'
import { SourceImagesGrid } from './source-images-grid'
import type { SourceImageData } from '@/types/chat'

// Define DocumentContent type that was missing
type DocumentContent = {
  id: string;
  name: string;
  content: string;
  [key: string]: any;
};

/**
 * Local type definitions bridging AI SDK v6 with legacy code expectations.
 * AI SDK v6 changed:
 * - ToolCallPart.args -> ToolCallPart.input
 * - ToolResultPart.result -> ToolResultPart.output
 * - ToolResultPart.isError was removed
 * 
 * These local types provide backwards compatibility.
 */

// Extended ToolCallPart that supports both 'input' (v6) and 'args' (legacy)
interface ToolCallPart extends Omit<SDKToolCallPart, 'input'> {
  input?: unknown;
  args?: unknown; // Legacy alias for input
}

// Extended ToolResultPart that supports both 'output' (v6) and 'result' (legacy)
interface ToolResultPart extends Omit<SDKToolResultPart, 'output'> {
  output?: unknown;
  result?: unknown; // Legacy alias for output
  isError?: boolean; // Legacy error indicator
}

// ToolCall type that was removed from ai v6 exports
interface ToolCall {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  input?: unknown;
}

// Function to highlight document mentions in text
function highlightDocumentMentions(text: string) {
  if (!text) return '';

  // Regex to match /mentions, potentially with backslashes
  const mentionRegex = /\/\\?([^\\]+?)\\?(?=\s|$|\.|\,|\;|\:|\!|\?)/g;

  // Replace mentions with styled spans, removing any backslashes
  const formattedText = text.replace(mentionRegex, (match, docName) => {
    // Clean the document name by removing any backslashes
    const cleanedDocName = docName.replace(/\\/g, '');

    return `<span class="inline-flex items-center leading-none">
      <span class="text-[#FF6417] dark:text-[#FF8A4D] font-medium align-baseline leading-none">${cleanedDocName}</span>
    </span>`;
  });

  return formattedText;
}

// Function to check if text contains our special approval format
function isApprovalRequiredFormat(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  // Log the check for debugging if there's a potential match
  if (text.includes('__REQUIRES_APPROVAL__')) {
    // Debug: Found potential approval format in text
    // Use a more robust pattern check - we only need to match the prefix and basic format
    const approvalPattern = /__REQUIRES_APPROVAL__:[^:]+:[^:]+/;
    const match = text.match(approvalPattern);

    if (match) {
      // Debug: Confirmed approval format using regex
      return true;
    }
  }

  // Check for various approval-required patterns - more flexible matching
  const hasExplicitApprovalText =
    text.includes('This tool requires explicit user approval before execution') ||
    text.includes('Tool execution failed: Error executing tool') ||
    text.includes('Error executing tool');

  if (hasExplicitApprovalText) {
    // Debug: Detected approval required message pattern
    return true;
  }

  return false;
}

// Function to clean JSON artifacts from approval strings
function stripJsonArtifacts(text: string): string {
  if (!text) return text;

  // If it includes our approval marker, extract just that part
  if (text.includes('__REQUIRES_APPROVAL__:')) {
    const approvalPattern = /__REQUIRES_APPROVAL__:[^:]+:[^,"}\s]+/;
    const match = text.match(approvalPattern);
    if (match) {
      // Debug: Extracted clean approval signal
      return match[0];
    }
  }

  return text;
}

// Function to extract tool call information from approval string
function extractApprovalNeededToolCall(text: string): ToolCallPart | null {
  // Check for our special format __REQUIRES_APPROVAL__:toolCallId:toolName
  if (!text || typeof text !== 'string') return null;

  // Debug: Checking text for approval needed tool call

  // 🔧 CRITICAL FIX: Handle multiple concatenated approval requests
  // Pattern to match individual approval segments
  const approvalPattern = /__REQUIRES_APPROVAL__:([^:,\s\}"]+):([^:,\s\}"]+)/g;

  // Add logging to help debug the issue
  // Debug: Checking for pattern match in text

  // Find the first match (we'll only process the first one for now)
  const match = approvalPattern.exec(text);
  approvalPattern.lastIndex = 0; // Reset the regex state

  if (match) {
    const [_, toolCallId, rawToolName] = match;

    // 🔧 CRITICAL FIX: Remove __REQUIRES_APPROVAL__ suffix from tool name if present
    const toolName = rawToolName.replace(/__REQUIRES_APPROVAL__$/, '');

    // Debug: Detected tool requiring approval
    // Debug: Cleaned tool name from raw approval text
    console.log('[extractApprovalNeededToolCall] Extracted approval format:', {
      toolCallId,
      toolName,
      rawToolName
    });

    // Create a complete ToolCallPart object with proper structure
    // Include default args based on tool type to ensure proper rendering
    let args: any = {};

    // Add default args based on tool type
    if (toolName.includes('gmail_find_email')) {
      args = { query: 'recent emails', maxResults: 5 };
    } else if (toolName.includes('gmail_create_draft')) {
      args = { to: '', subject: '', body: '' };
    } else if (toolName.includes('gmail_send_email')) {
      args = { to: '', subject: '', body: '' };
    } else if (toolName.includes('calendar')) {
      args = { query: 'upcoming events' };
    }

    return {
      type: 'tool-call',
      toolCallId,
      toolName,
      args, // Now includes proper default args structure
    } as ToolCallPart;
  }

  // Fallback patterns for direct error messages
  const errorPattern = /Tool execution failed: Error executing tool ([^:]+): This tool requires explicit user approval/;
  const errorMatch = text.match(errorPattern);

  if (errorMatch) {
    // Extract tool name from direct error message
    const rawToolName = errorMatch[1];
    const toolName = rawToolName.replace(/__REQUIRES_APPROVAL__$/, '');
    // Generate a toolCallId if not available
    const toolCallId = `auto-${Date.now()}`;

    // Debug: Detected tool requiring approval from error message

    return {
      type: 'tool-call',
      toolCallId,
      toolName,
      args: {}, // No args available from the error message
    };
  }

  // Additional pattern to match common error strings we see in the logs
  const directToolErrorPattern = /Error executing tool ([^:]+):/;
  const directToolMatch = text.match(directToolErrorPattern);

  if (directToolMatch) {
    const rawToolName = directToolMatch[1];
    const toolName = rawToolName.replace(/__REQUIRES_APPROVAL__$/, '');
    const toolCallId = `auto-${Date.now()}`;

    // Debug: Detected tool from direct error message

    return {
      type: 'tool-call',
      toolCallId,
      toolName,
      args: {},
    };
  }

  // Debug: Failed to extract tool call from text
  return null;
}

// Add the styles string
const styles = `
.chat-message .copy-code-button {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: none;
  background: #CBD5E1;
  border: 1px solid #94A3B8;
  border-radius: 0.25rem;
  padding: 0.25rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.dark .chat-message .copy-code-button {
  background: #475569;
  border-color: #64748B;
}

.chat-message pre:hover .copy-code-button {
  display: block;
}

.chat-message pre {
  position: relative;
}

.chat-message .code-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.2s;
}

.chat-message pre:hover .code-actions {
  opacity: 1;
}

@keyframes fadein {
  from { opacity: 0.5; }
  to { opacity: 1; }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

.animate-bounce-1 {
  animation: bounce 0.6s infinite;
}

.animate-bounce-2 {
  animation: bounce 0.6s infinite;
  animation-delay: 0.2s;
}

.animate-bounce-3 {
  animation: bounce 0.6s infinite;
  animation-delay: 0.4s;
}

.animate-fadein {
  animation: fadein 0.5s ease-in-out;
}

.chat-message {
  transition: all 0.3s ease-in-out;
}

.chat-message p, 
.chat-message h1, 
.chat-message h2, 
.chat-message h3, 
.chat-message h4, 
.chat-message h5, 
.chat-message h6, 
.chat-message ul, 
.chat-message ol, 
.chat-message li, 
.chat-message pre, 
.chat-message code {
  transition: opacity 0.2s ease-in-out;
}
`;



type TextSize = 'small' | 'default' | 'large';


interface HeadingProps {
  children?: React.ReactNode;
  className?: string;
}

interface LoadingImagePartProps {
  id: string;
  progress?: number;
  prompt?: string;
  aspectRatio?: string;
  count?: number;
  total?: number;
  status?: string;
  isError?: boolean;
}

const GeneratedImage = React.memo(function GeneratedImage({
  imageUrl,
  index,
  aspectRatio = '1:1',
  isSourceImage = false
}: {
  imageUrl: string;
  index: number;
  aspectRatio?: string;
  isSourceImage?: boolean;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [imageLoadingStyle, setImageLoadingStyle] = useState<React.CSSProperties>({});
  const [showLightbox, setShowLightbox] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Preload the image to get dimensions before showing it
  useEffect(() => {
    if (!isLoaded && !hasError) {
      const img = new window.Image(); // Use window.Image to specify the constructor
      img.src = imageUrl;

      img.onload = () => {
        // Debug: Image loaded successfully (preload)
        // No need to calculate custom height - we'll use CSS for aspect ratio
      };

      img.onerror = () => {
        console.error('Error preloading image:', imageUrl);
        setHasError(true);
      };
    }
  }, [imageUrl, aspectRatio, isLoaded, hasError]);

  // Add a new function to handle opening the lightbox
  const handleImageClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Debug: Image clicked - checking load status
    if (isLoaded && !hasError) {
      // Debug: Opening lightbox for image
      setShowLightbox(true);
    } else {
      // Debug: Image not ready for lightbox
    }
  };

  // Add a function to close the lightbox
  const closeLightbox = () => {
    setShowLightbox(false);
  };

  // Map aspect ratio to appropriate CSS class
  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case '2:3': return 'aspect-[2/3]';
      case '3:2': return 'aspect-[3/2]';
      case '16:9': return 'aspect-[16/9]';
      default: return 'aspect-square';
    }
  };

  useEffect(() => {
    if (!isLoaded && !hasError) {
      // Simulate progressive loading with a scan effect
      let progress = 0;
      const interval = setInterval(() => {
        progress += 2;
        setLoadingProgress(progress);
        // Create a progressive loading effect with a gradient mask
        setImageLoadingStyle({
          maskImage: `linear-gradient(to bottom, black ${progress}%, transparent ${progress}%)`,
          WebkitMaskImage: `linear-gradient(to bottom, black ${progress}%, transparent ${progress}%)`
        });

        if (progress >= 100) {
          clearInterval(interval);
        }
      }, 100);

      return () => clearInterval(interval);
    }
  }, [isLoaded, hasError]);

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `generated-image-${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading image:', error);
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden group w-full max-w-4xl mb-4 cursor-pointer",
        getAspectRatioClass(),
        isSourceImage && "border-2 border-[#FF6417] dark:border-[#E55000]" // Add border for source images
      )}
      style={{ touchAction: 'manipulation' }} // Disable double-tap zoom for faster touch response
      onClick={handleImageClick} // Make the entire container clickable
      onTouchEnd={(e) => {
        // Handle touch events immediately on mobile (bypass 300ms delay)
        // Only trigger if it's a tap (not a scroll or pinch)
        if (e.touches.length === 0 && isLoaded && !hasError) {
          e.preventDefault();
          setShowLightbox(true);
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* This is the placeholder that shows while the image is loading */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 z-10">
          <div className="flex flex-col items-center gap-2 p-2">
            <div className="w-12 h-12 flex items-center justify-center text-gray-300 dark:text-gray-500">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <path d="M16 16L14 14L10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 18L9 15L10 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Loading image...
            </div>
            <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-[#FF6417] dark:bg-[#FF8A4D] h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, loadingProgress)}%` }}
              ></div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-500">
              {loadingProgress ? `${Math.round(loadingProgress)}% complete` : ''}
            </div>
          </div>
        </div>
      )}
      {!hasError && (
        <div className="w-full h-full flex items-center justify-center">
          <Image
            src={imageUrl}
            alt={`Generated image ${index + 1}`}
            width={1024}
            height={1024}
            priority
            unoptimized
            className={cn(
              "w-full h-full object-contain transition-opacity duration-300",
              !isLoaded ? "opacity-0" : "opacity-100" // Hide completely while loading
            )}
            onLoad={() => {
              // Debug: Image loaded successfully
              setIsLoaded(true);
            }}
            onError={() => {
              console.error('Error loading image:', imageUrl);
              setHasError(true);
            }}
          />
        </div>
      )}

      {/* Download button positioned on container - functional but may appear outside image for non-matching ratios */}
      <div className="absolute top-2 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDownload();
          }}
          className="h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 text-white border-none flex items-center justify-center transition-colors"
          title="Download image"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          Failed to load image
        </div>
      )}

      {/* Lightbox Modal for Full-Screen View - DISABLED */}
      {false && showLightbox && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-[9999] flex items-center justify-center p-4"
          onClick={closeLightbox}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center">
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload();
                }}
                className="p-3 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 transform hover:scale-105"
                title="Download image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeLightbox();
                }}
                className="p-3 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 transform hover:scale-105"
                title="Close fullscreen view"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <Image
              src={imageUrl}
              alt={`Generated image ${index + 1} (full size)`}
              width={1024}
              height={1024}
              priority
              unoptimized
              className="max-w-full max-h-[90vh] object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* New Clean Image Modal */}
      <ImageModal
        src={imageUrl}
        alt={`Generated image ${index + 1}`}
        isOpen={showLightbox}
        onClose={closeLightbox}
        showDownload={true}
      />
    </div>
  );
});

GeneratedImage.displayName = 'GeneratedImage';

const GeneratedVideo = React.memo(function GeneratedVideo({ videoUrl, index, isLocalBlob }: { videoUrl: string; index: number; isLocalBlob?: boolean }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);

  // Check if the video URL is valid
  useEffect(() => {
    const checkVideoUrl = async () => {
      try {
        // Skip the check for local blob URLs
        if (isLocalBlob) {
          setIsLoading(false);
          return;
        }

        // For remote URLs, check if they're valid
        const response = await fetch(videoUrl, { method: 'HEAD' });
        if (!response.ok) {
          throw new Error(`Video URL returned status ${response.status}`);
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Error checking video URL:', error);
        setError('Video could not be loaded. It may have expired or been removed.');
        setIsLoading(false);
      }
    };

    checkVideoUrl();

    // Clean up function to revoke object URL if it's a local blob
    return () => {
      if (isLocalBlob && typeof videoUrl === 'string' && videoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl, isLocalBlob]);

  // Handle video play/pause
  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  // Update play state
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('ended', handleEnded);

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Handle download
  const handleDownload = async () => {
    try {
      // Skip if videoUrl is not a string
      if (typeof videoUrl !== 'string') {
        console.error('Cannot download: videoUrl is not a string', videoUrl);
        alert('Failed to download video: The video URL is invalid.');
        return;
      }

      // For local blob URLs, we already have the blob
      if (isLocalBlob && videoUrl.startsWith('blob:')) {
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `generated-video-${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        return;
      }

      // For remote URLs, fetch the video first
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `generated-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading video:', error);
      alert('Failed to download video. Please try again.');
    }
  };

  return (
    <div className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 group mb-2">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-t-transparent border-gray-500 dark:border-gray-300 rounded-full animate-spin"></div>
          <div className="ml-2 text-sm text-gray-500 dark:text-gray-400">Loading video...</div>
        </div>
      )}

      {error && (
        <div className="aspect-video flex items-center justify-center p-4 bg-gray-100 dark:bg-gray-800">
          <div className="text-center">
            <FileX className="w-8 h-8 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {error}
            </p>

            <button
              onClick={handleDownload}
              className="mt-3 px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md flex items-center justify-center mx-auto"
            >
              <Download className="w-3 h-3 mr-1" />
              Try Download
            </button>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        className={cn(
          "w-full rounded-lg shadow-lg",
          isLoading && "invisible h-0",
          error && "hidden"
        )}
        controls
        playsInline
        preload="auto"
        controlsList="nodownload noremoteplayback"
        onLoadedData={() => {
          // Debug: Video loaded successfully
          setIsLoading(false);
          // Hack: Force mobile browsers to render the first frame by seeking slightly
          if (videoRef.current) {
            videoRef.current.currentTime = 0.001;
          }
        }}
        onError={(e) => {
          const target = e.target as HTMLVideoElement;
          console.error(`Error loading video: ${videoUrl}`, e, target.error);
          setError('Video could not be loaded');
        }}
      >
        <source src={videoUrl} type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleDownload}
          className="flex items-center justify-center w-8 h-8 bg-white/80 dark:bg-black/50 rounded-full hover:bg-white dark:hover:bg-black/80 transition-colors"
          title="Download video"
        >
          <Download className="w-4 h-4 text-gray-700 dark:text-gray-300" />
        </button>
      </div>
    </div>
  );
});

const LoadingVideo = React.memo(function LoadingVideo({
  id,
  progress = 0,
  aspectRatio = '16:9',
  resolution = '720p',
  status = '',
  frameCount = 129
}: {
  id: string;
  progress?: number;
  aspectRatio?: string;
  resolution?: string;
  status?: string;
  frameCount?: number;
}) {
  return (
    <div className="relative w-full max-w-md rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <div className={`aspect-${aspectRatio === '9:16' ? '[9/16]' : 'video'} flex flex-col items-center justify-center p-4`}>
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="flex items-center justify-center">
            <Video className={`h-10 w-10 text-gray-400 dark:text-gray-500 ${progress < 100 ? 'animate-pulse' : ''}`} />
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {progress >= 100 ? 'Video generated successfully!' : `Generating video${aspectRatio === '9:16' ? ' (portrait)' : ''} in ${resolution}...`}
          </div>

          <div className="w-full max-w-xs bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2">
            <div
              className="bg-[#FF6417] dark:bg-[#FF8A4D] h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(5, progress || 0)}%` }}
            ></div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-500">
            {progress ? `${Math.round(progress)}% complete` : 'Starting generation...'}
          </div>

          {/* Animated thinking indicator */}
          <div className="flex items-center gap-2 pt-1">
            <div className="animate-bounce-1">
              <div className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400"></div>
            </div>
            <div className="animate-bounce-2">
              <div className="h-2 w-2 rounded-full bg-yellow-500 dark:bg-yellow-400"></div>
            </div>
            <div className="animate-bounce-3">
              <div className="h-2 w-2 rounded-full bg-orange-500 dark:bg-orange-400"></div>
            </div>
          </div>

          {status && (
            <div className="text-xs text-gray-600 dark:text-gray-400 text-center mt-1 max-w-xs">
              {status}
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            <span className="font-medium">Settings:</span> {aspectRatio}, {resolution}, {frameCount} frames
          </div>

          {progress < 95 && (
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              This may take several minutes to complete
            </div>
          )}

          {progress >= 95 && progress < 100 && (
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Almost done! Finalizing video...
            </div>
          )}

          {status && status.includes('Error') && (
            <div className="text-xs text-red-500 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

LoadingVideo.displayName = 'LoadingVideo';

const LoadingImage = React.memo(function LoadingImage({
  id,
  progress = 0,
  prompt = '',
  aspectRatio = '1:1',
  count = 1,
  total = 1,
  status = '',
  isError = false
}: LoadingImagePartProps) {
  // Map aspect ratio to appropriate CSS class
  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case '2:3': return 'aspect-[2/3]';
      case '3:2': return 'aspect-[3/2]';
      case '16:9': return 'aspect-[16/9]';
      default: return 'aspect-square';
    }
  };

  const displayCount = total > 1 ? ` (${count}/${total})` : '';

  return (
    <div className={cn(
      "relative rounded-lg overflow-hidden group w-full max-w-4xl mb-4",
      getAspectRatioClass(),
      isError ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800" : "bg-gray-100 dark:bg-gray-800"
    )}>
      <div className={cn(
        "absolute inset-0 flex items-center justify-center z-10",
        isError ? "bg-red-50 dark:bg-red-950/20" : "bg-gray-100 dark:bg-gray-800"
      )}>
        <div className="flex flex-col items-center gap-2 p-4 max-w-[90%]">
          {isError ? (
            <>
              <div className="w-16 h-16 flex items-center justify-center text-red-500 dark:text-red-400">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-sm font-medium text-red-700 dark:text-red-300 text-center">
                Image Generation Failed
              </div>
              <div className="text-xs text-red-600 dark:text-red-400 text-center break-words px-2">
                {status || 'An error occurred while generating the image'}
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 flex items-center justify-center text-gray-300 dark:text-gray-500">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <path d="M16 16L14 14L10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 18L9 15L10 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
                {status || `Loading image${displayCount}...`}
              </div>
              <div className="w-40 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-[#FF6417] dark:bg-[#FF8A4D] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, progress || 0)}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-500">
                {progress ? `${Math.round(progress)}% complete` : ''}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

LoadingImage.displayName = 'LoadingImage';

// Create a reusable Tooltip component using Portals for reliable positioning
interface TooltipProps {
  content: string;
  position?: 'top' | 'bottom';
  show: boolean;
  anchorElement: HTMLElement | null;
}

function Tooltip({ content, position = 'bottom', show, anchorElement }: TooltipProps) {
  // Only render if we should show and have a valid anchor
  if (!show || !anchorElement) return null;

  // Get the anchor element's bounding rectangle
  const rect = anchorElement.getBoundingClientRect();

  // Use useTheme to detect dark mode
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  // Calculate position
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    padding: '0.4rem 0.6rem',
    backgroundColor: isDarkMode ? '#1A1A1A' : '#FF6417', // Use dark background in dark mode
    color: isDarkMode ? '#E6E6E6' : 'white', // Use appropriate text color
    borderRadius: '0.25rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    pointerEvents: 'none',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    maxWidth: '200px',
    textAlign: 'center',
    left: `${rect.left + rect.width / 2}px`,
    transform: 'translateX(-50%)',
    whiteSpace: 'normal'
  };

  // Adjust vertical position based on placement
  if (position === 'top') {
    tooltipStyle.top = rect.top - 40; // Reduced spacing for a more balanced look
  } else {
    tooltipStyle.top = rect.bottom + 8; // Reduced spacing for bottom tooltips
  }

  // Use portal to render the tooltip at the root level
  return ReactDOM.createPortal(
    <div style={tooltipStyle}>
      {content}
    </div>,
    document.body
  );
}

// Add this helper function to convert markdown to HTML for clipboard
function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '';

  let html = '';
  const lines = markdown.split('\n');
  let inTable = false;
  let tableHTML = '';
  let inCodeBlock = false;
  let codeBlockHTML = '';
  let inList = false;
  let listHTML = '';
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';

    // Handle tables
    if (line.includes('|') && !inCodeBlock) {
      // Detect start of table
      if (!inTable && i + 1 < lines.length && nextLine.includes('|-')) {
        inTable = true;
        tableHTML = '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
      }

      if (inTable) {
        // Skip separator row (the one with |---|---|)
        if (line.includes('|-')) {
          continue;
        }

        const isHeader = tableHTML.endsWith('<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">');
        const cells = line.split('|').filter(cell => cell.trim() !== '');

        tableHTML += '<tr>';
        cells.forEach(cell => {
          const cellContent = cell.trim();
          if (isHeader) {
            tableHTML += `<th style="background-color: #f2f2f2; font-weight: bold;">${cellContent}</th>`;
          } else {
            tableHTML += `<td>${cellContent}</td>`;
          }
        });
        tableHTML += '</tr>';

        // Detect end of table (next line doesn't have pipes)
        if (!nextLine.includes('|')) {
          inTable = false;
          tableHTML += '</table><br>';
          html += tableHTML;
          tableHTML = '';
        }
        continue;
      }
    } else if (inTable) {
      // End of table reached
      inTable = false;
      tableHTML += '</table><br>';
      html += tableHTML;
      tableHTML = '';
    }

    // Handle code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockHTML = '<pre style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; font-family: monospace; white-space: pre-wrap;">';
      } else {
        inCodeBlock = false;
        codeBlockHTML += '</pre><br>';
        html += codeBlockHTML;
        codeBlockHTML = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockHTML += `${line}\n`;
      continue;
    }

    // Handle headings
    if (line.startsWith('# ')) {
      html += `<h1 style="font-size: 24px; font-weight: bold; margin-top: 24px; margin-bottom: 16px;">${line.substring(2)}</h1>`;
      continue;
    }

    if (line.startsWith('## ')) {
      html += `<h2 style="font-size: 20px; font-weight: bold; margin-top: 20px; margin-bottom: 14px;">${line.substring(3)}</h2>`;
      continue;
    }

    if (line.startsWith('### ')) {
      html += `<h3 style="font-size: 18px; font-weight: bold; margin-top: 16px; margin-bottom: 12px;">${line.substring(4)}</h3>`;
      continue;
    }

    // Handle lists
    if (line.match(/^\d+\.\s/) || line.match(/^-\s/) || line.match(/^\*\s/)) {
      const isOrderedList = line.match(/^\d+\.\s/);
      const currentListType = isOrderedList ? 'ol' : 'ul';

      if (!inList) {
        inList = true;
        listType = currentListType;
        listHTML = `<${listType} style="${isOrderedList ? 'list-style-type: decimal;' : 'list-style-type: disc;'} margin-left: 20px;">`;
      } else if (listType !== currentListType) {
        // List type changed
        listHTML += `</${listType}><br>`;
        listType = currentListType;
        listHTML = `<${listType} style="${isOrderedList ? 'list-style-type: decimal;' : 'list-style-type: disc;'} margin-left: 20px;">`;
      }

      const content = line.replace(/^\d+\.\s/, '').replace(/^-\s/, '').replace(/^\*\s/, '');
      listHTML += `<li style="margin-bottom: 5px;">${content}</li>`;

      // Check if this is the end of the list
      if (!nextLine.match(/^\d+\.\s/) && !nextLine.match(/^-\s/) && !nextLine.match(/^\*\s/)) {
        inList = false;
        listHTML += `</${listType}><br>`;
        html += listHTML;
        listHTML = '';
      }
      continue;
    } else if (inList) {
      // End of list
      inList = false;
      listHTML += `</${listType}><br>`;
      html += listHTML;
      listHTML = '';
    }

    // Handle bold and italic
    let formattedLine = line;
    formattedLine = formattedLine.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formattedLine = formattedLine.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formattedLine = formattedLine.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    formattedLine = formattedLine.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Handle links
    formattedLine = formattedLine.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Handle inline code
    formattedLine = formattedLine.replace(/`([^`]+)`/g, '<code style="background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>');

    // Add paragraph if not empty
    if (formattedLine) {
      html += `<p style="margin-bottom: 10px;">${formattedLine}</p>`;
    } else {
      html += '<br>';
    }
  }

  // Close any open blocks
  if (inTable) {
    html += tableHTML + '</table>';
  }
  if (inCodeBlock) {
    html += codeBlockHTML + '</pre>';
  }
  if (inList) {
    html += listHTML + `</${listType}>`;
  }

  return html;
}

// Define custom types for our content parts
type ToolResult = {
  [key: string]: unknown;
};

type ContentPart =
  | { type: 'text'; text: string; content?: string; reasoningText?: string }
  | { type: 'document'; document: DocumentContent }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'source_images'; source_images: SourceImageData[]; images?: SourceImageData[] }
  | { type: 'generated_image'; url: string; image_url?: { url: string }; aspectRatio?: string; sourceImageUrl?: string; generated_images?: string[] }
  | { type: 'generated_video'; url: string; video_url?: string; isLocalBlob?: boolean }
  | { type: 'loading_video'; id: string; progress?: number; resolution?: string; aspectRatio?: string; status?: string; frameCount?: number }
  | { type: 'loading_image'; id: string; progress?: number; prompt?: string; aspectRatio?: string; count?: number; total?: number; status?: string }
  | { type: 'generated_3d_model'; url: string; model_url?: string; prompt?: string; status?: string }
  | { type: 'loading_3d_model'; id: string; progress?: number; prompt?: string; status?: string }
  | { type: 'html_content'; html: string }
  | { type: 'thinking'; content?: string; reasoningText?: string }
  | { type: 'metadata'; usedDocuments?: Array<{ id: string; name: string; filename?: string; similarity?: number; content_preview?: string; created_at?: string; uploadedAt?: string; explicitly_referenced?: boolean }>;[key: string]: unknown }
  | { type: 'tool_result'; toolName?: string; toolCallId?: string; result?: { documents?: Array<{ documentId?: string; id?: string; title?: string; name?: string; filename?: string; uploadedAt?: string; created_at?: string; content_preview?: string; provider?: string; explicitly_referenced?: boolean }> } | unknown; output?: unknown; isError?: boolean }
  | ToolCallPart
  | ToolResultPart;

// Document reference types removed - no longer needed

// Document source type removed - no longer needed

interface Source {
  title: string;
  url?: string;
  content?: string;
  snippet?: string;
  date?: string;
  favicon?: string;
  provider: string;
  type: 'web' | 'tool_link' | 'document'; // Added 'document' type back
  toolName?: string;
  toolResultId?: string;
  documentId?: string; // For document sources
  uploadedAt?: string; // For document sources
  explicitly_referenced?: boolean; // For document sources
}

// --- NEW: ToolInvocation Component --- 
interface ToolInvocationProps {
  toolCall: ToolCallPart;
  toolResult?: ToolResultPart;
  requireExplicitApproval?: boolean; // Always true by default to require explicit approval
  explanationText?: string; // Optional explanation text to display with the tool
  sessionId?: string; // Session ID for MCP tool persistence
}

// Helper to check if an object is a ToolCallPart
function isToolCallPart(part: any): part is ToolCallPart {
  return part && part.type === 'tool-call' && typeof part.toolName === 'string';
}

// Helper to check if an object is a ToolResultPart
function isToolResultPart(part: any): part is ToolResultPart {
  return (
    part &&
    typeof part === 'object' &&
    (part.type === 'tool-result' || part.type === 'tool_result')
  );
}

// Helper to summarize Gmail tool results and avoid raw Base64 output
const summarizeGmailResult = (data: any): string => {
  try {
    // Safety check - if data is not valid, return a fallback message
    if (!data) {
      return 'Email found, but could not extract details.';
    }

    // Process messages from the data
    const messages = Array.isArray(data) ? data : [data];
    const summaries: string[] = [];

    messages.forEach((msg: any, idx: number) => {
      // Safety check for each message
      if (!msg) {
        summaries.push(`• Email ${idx + 1}: [Details unavailable]`);
        return; // Skip this iteration
      }

      let subject = '';
      let from = '';
      let date = '';
      let snippet = '';

      // Gmail messages can contain payload.headers or top‑level headers
      const headers = msg?.payload?.headers || msg?.headers || [];
      if (Array.isArray(headers)) {
        headers.forEach((h: any) => {
          if (!h || typeof h !== 'object') return; // Skip invalid headers

          const name = h?.name?.toLowerCase();
          if (name === 'subject') subject = h?.value || subject;
          if (name === 'from') from = h?.value || from;
          if (name === 'date') date = h?.value || date;
        });
      }

      snippet = msg?.snippet || '';

      // Escape any quotes in the fields to prevent display issues
      subject = subject.replace(/"/g, '\'');
      from = from.replace(/"/g, '\'');

      // Truncate long values
      if (subject.length > 50) subject = subject.substring(0, 47) + '...';
      if (from.length > 40) from = from.substring(0, 37) + '...';
      if (snippet.length > 100) snippet = snippet.substring(0, 97) + '...';

      summaries.push(`• Email ${idx + 1}: '${subject || 'No Subject'}' from ${from || 'Unknown Sender'}${date ? ' on ' + date : ''}.${snippet ? ' Snippet: ' + snippet.replace(/\n/g, ' ') : ''}`);
    });

    // If we couldn't extract any summaries, provide a fallback
    if (summaries.length === 0) {
      return 'Email found, but could not extract a readable summary.';
    }

    return summaries.join('\n');
  } catch (err) {
    console.error('[ToolInvocation] Failed to summarize Gmail result:', err);
    return 'Email found, but could not extract a readable summary.';
  }
};

// Add a utility function near the beginning of the file to detect approval-required errors
// Add this function near line ~1180 with other utility functions

function isApprovalRequiredError(toolResult?: ToolResultPart): boolean {
  if (!toolResult || !toolResult.isError) return false;

  // Check if the error message contains our specific approval text
  const errorMessage = typeof toolResult.result === 'string'
    ? toolResult.result
    : typeof toolResult.result === 'object' && toolResult.result !== null
      ? (toolResult.result as any).message || JSON.stringify(toolResult.result)
      : String(toolResult.result);

  return errorMessage.includes('requires explicit user approval before execution');
}

// Then update the ToolInvocation component to handle this special case
const ToolInvocation: React.FC<ToolInvocationProps> = React.memo(function ToolInvocation({ toolCall, toolResult, requireExplicitApproval = true, explanationText, sessionId }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();

  // Font-specific spacing configuration for action buttons
  const fontSpacingConfig: Record<string, { gap: string, marginTop: string }> = {
    'inter': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    },
    'merriweather': {
      gap: textSize === 'small' ? 'gap-1.5' : textSize === 'large' ? 'gap-2.5' : 'gap-2',
      marginTop: textSize === 'small' ? '-mt-0.5' : textSize === 'large' ? '-mt-1' : '-mt-0.5'
    },
    'source-code-pro': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : textSize === 'large' ? '-mt-0.5' : '-mt-0.5'
    },
    'atkinson-hyperlegible': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : textSize === 'large' ? '-mt-0.5' : '-mt-0.5'
    },
    'lexend': {
      gap: textSize === 'small' ? 'gap-1.5' : textSize === 'large' ? 'gap-2.5' : 'gap-2',
      marginTop: textSize === 'small' ? '-mt-0.5' : textSize === 'large' ? '-mt-1' : '-mt-0.5'
    },
    'open-sans': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    },
    'lato': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    }
  };

  const audioSettings = useAudioSettings();

  const [isLayoutStable, setIsLayoutStable] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  // Check if YOLO mode is enabled
  const isYoloMode = env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true';
  const [isApproved, setIsApproved] = useState(isYoloMode); // In YOLO mode, tools are auto-approved
  const [isCancelled, setIsCancelled] = useState(false); // 🎯 CRITICAL FIX: Track if user cancelled the tool
  const [resultText, setResultText] = useState<string | null>(null); // Store the result text to display in the chat message
  const [isResultCopied, setIsResultCopied] = useState(false); // Track copy state
  const [hasToolResult, setHasToolResult] = useState(false); // Track if we have a tool result
  const [persistentState, setPersistentState] = useState<ToolExecutionState | null>(null); // Persistent tool state

  // Safety check: Ensure toolCallId exists
  if (!toolCall.toolCallId) {
    console.error('ToolInvocation: toolCallId is undefined', toolCall);
    return null;
  }

  // Tooltip states for Tool Result buttons
  const [showToolCopyTooltip, setShowToolCopyTooltip] = useState(false);
  const [showToolSpeakTooltip, setShowToolSpeakTooltip] = useState(false);
  const [showToolPDFTooltip, setShowToolPDFTooltip] = useState(false);
  const [showToolRAGTooltip, setShowToolRAGTooltip] = useState(false);
  const [isToolSendingToRAG, setIsToolSendingToRAG] = useState(false);

  // Refs for Tool Result buttons
  const toolCopyButtonRef = useRef<HTMLButtonElement>(null);
  const toolSpeakButtonRef = useRef<HTMLButtonElement>(null);
  const toolPDFButtonRef = useRef<HTMLButtonElement>(null);
  const toolRAGButtonRef = useRef<HTMLButtonElement>(null);

  // 🎯 CRITICAL FIX: Calculate isAwaitingApproval based on persistent state status
  const isAwaitingApproval = React.useMemo(() => {
    // Debug: Calculating isAwaitingApproval state

    // If we have a tool result, check if it's an approval error
    if (toolResult) {
      const needsApproval = isApprovalRequiredError(toolResult);
      // Debug: Tool result exists, checking if needs approval
      return needsApproval;
    }

    // If no tool result, check persistent state to determine if still awaiting approval
    if (persistentState) {
      // Tool is no longer awaiting approval if it's approved, running, or completed
      const awaiting = persistentState.status === 'pending' || persistentState.status === 'error';
      // Debug: Persistent state awaiting approval check
      return awaiting;
    }

    // Default to true if no persistent state yet
    // Debug: No persistent state yet, defaulting to awaiting approval
    return true;
  }, [toolResult, persistentState?.status]);

  // Debug: Component initialized/re-rendered
  // Debug: Tool call status summary
  // Debug: Current persistent state logged
  // Track component re-mounts with a stable ref
  const componentIdRef = React.useRef(Math.random().toString(36).substr(2, 9));
  // Debug: Component render with ID and tool name

  // 🎯 CRITICAL FIX: Add polling mechanism for status updates with proper callback handling
  const [pollingActive, setPollingActive] = React.useState(false);
  const [renderKey, setRenderKey] = React.useState(0);
  const pollingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const startStatusPolling = React.useCallback(() => {
    if (pollingActive) {
      // Debug: Polling already active, skipping
      return;
    }

    // Debug: Starting status polling for tool
    setPollingActive(true);

    const pollFunction = async () => {
      try {
        // Debug: Polling for status update
        const apiUrl = `/api/tool-execution-state?tool_call_id=${encodeURIComponent(toolCall.toolCallId || '')}`;
        const response = await fetch(apiUrl);

        if (response.ok) {
          const state = await response.json();
          // Debug: Polled state vs previous state

          if (state && state.status !== persistentState?.status) {
            // Debug: Status changed, updating state

            // 🎯 CRITICAL FIX: Use functional update to ensure latest state
            setPersistentState(prevState => {
              if (prevState?.status !== state.status) {
                // Debug: setPersistentState updating status
                return { ...state };
              }
              return prevState;
            });

            // 🎯 CRITICAL FIX: Force re-render when status changes
            setRenderKey(prev => {
              const newKey = prev + 1;
              // Debug: Forcing re-render with new key
              return newKey;
            });

            // Stop polling when tool is completed or errored
            if (state.status === 'completed' || state.status === 'error') {
              // Debug: Tool completed, stopping polling
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              setPollingActive(false);
            }
          }
        } else {
          console.error('[ToolInvocation] ❌ Polling failed:', response.status);
        }
      } catch (error) {
        console.error('[ToolInvocation] ❌ Polling error:', error);
      }
    };

    // Start immediate poll
    pollFunction();

    // Then poll every 1 second for faster updates
    pollingIntervalRef.current = setInterval(pollFunction, 1000);

    // Stop polling after 60 seconds to prevent infinite polling
    setTimeout(() => {
      // Debug: Stopping polling after timeout
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setPollingActive(false);
    }, 60000);
  }, [toolCall.toolCallId, pollingActive]); // 🎯 CRITICAL FIX: Remove persistentState?.status from dependencies to prevent loops

  // Cleanup polling on unmount and track component lifecycle
  React.useEffect(() => {
    // Debug: Component mounted

    return () => {
      // Debug: Component unmounting
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [toolCall.toolName]);

  // 🔥 CLEANUP FUNCTION FOR FAILED TOOL EXECUTIONS
  const cleanupFailedToolExecution = () => {
    console.log('[cleanupFailedToolExecution] Cleaning up failed tool execution state');

    // Reset tool execution state
    setIsApproved(false);
    setHasToolResult(false);

    // Stop any active polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Clear any cached results
    if (toolCall.toolCallId) {
      // Clear from sessionStorage if exists
      try {
        sessionStorage.removeItem(`tool_result_${toolCall.toolCallId}`);
      } catch (e) {
        // Ignore sessionStorage errors
      }
    }

    console.log('[cleanupFailedToolExecution] Tool execution state cleaned up');
  };

  // Handle user approval of tool execution
  const handleApprove = async () => {
    // Debug: Before approval state
    // Debug: Tool explicitly approved by user
    setIsApproved(true);
    // Debug: After setIsApproved(true)

    // Provide feedback to the user via toast notification
    // toast({
    //   title: "Tool action approved",
    //   description: `${formatToolName(toolCall.toolName)} tool is now running.`,
    //   duration: 3000,
    // });

    // We want the tool box to reflect the "running" state immediately
    setHasToolResult(false); // Reset in case it was somehow set

    // CRITICAL: Make API call to approve the tool on the server
    try {
      // Debug: Log the values being sent
      console.log('[handleApprove] Debug - Preparing approval request:', {
        toolCallId: toolCall.toolCallId,
        toolCallIdType: typeof toolCall.toolCallId,
        action: 'approve',
        sessionId: sessionId,
        sessionIdType: typeof sessionId,
        toolCall: toolCall
      });

      const requestBody = {
        toolCallId: toolCall.toolCallId,
        action: 'approve',
        sessionId: sessionId // Include sessionId for tool persistence
      };

      console.log('[handleApprove] Debug - Request body:', JSON.stringify(requestBody, null, 2));

      // Debug: Sending explicit approval to API
      // Update to use the new approval endpoint
      const response = await fetch('/api/chat/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const result = await response.json();
        console.error('Tool approval failed:', result.error);
        console.error('[handleApprove] Debug - Full error response:', {
          status: response.status,
          statusText: response.statusText,
          error: result.error,
          details: result.details,
          toolName: result.toolName,
          debugInfo: result.debugInfo,
          fullResult: result
        });

        // Enhanced error handling with specific error types
        let errorTitle = "Tool approval failed";
        let errorDescription = result.error || "Could not approve tool. Please try again.";

        // Handle specific error types based on debug info
        if (result.debugInfo) {
          if (result.debugInfo.isTimeoutError) {
            errorTitle = "Connection timeout";
            errorDescription = `${result.toolName || 'Tool'} timed out. This may be due to slow network or service issues. Please try again.`;
          } else if (result.debugInfo.isAuthError) {
            errorTitle = "Authentication error";
            errorDescription = `${result.toolName || 'Tool'} authentication failed. Please check your permissions and try again.`;
          } else if (result.debugInfo.isBadRequestError) {
            errorTitle = "Invalid request";
            errorDescription = `${result.toolName || 'Tool'} received invalid parameters. Please check your input and try again.`;
          } else if (result.debugInfo.isNetworkError) {
            errorTitle = "Network error";
            errorDescription = `Cannot connect to ${result.toolName || 'tool'} service. Please check your internet connection and try again.`;
          } else if (!result.debugInfo.hasActiveClient) {
            errorTitle = "Service unavailable";
            errorDescription = `${result.toolName || 'Tool'} service is currently unavailable. Please try again later.`;
          } else if (!result.debugInfo.toolFound) {
            errorTitle = "Tool not found";
            errorDescription = `${result.toolName || 'Tool'} is not available. Please contact support if this persists.`;
          }
        }

        // Handle Zapier-specific errors
        if (result.toolName?.includes('drive') || result.toolName?.includes('gmail') || result.toolName?.includes('google_')) {
          if (result.details?.includes('Zapier')) {
            errorTitle = "Zapier connection error";
            errorDescription = "Unable to connect to Zapier service for Google integration. Please try again later.";
          }
        }

        // 🔥 CLEANUP FOR FAILED TOOL EXECUTIONS
        cleanupFailedToolExecution();

        toast({
          title: errorTitle,
          description: errorDescription,
          variant: "destructive",
          duration: 6000, // Longer duration for more detailed errors
        });
      } else {
        const resultData = await response.json();
        // Debug: Tool explicit approval successful

        // 🔥 RESPONSE VALIDATION - Safety checks for empty responses
        console.log('[handleApprove] Response validation - Raw result data:', JSON.stringify(resultData, null, 2));

        // Validate response structure
        if (!resultData || typeof resultData !== 'object') {
          console.error('[handleApprove] Invalid response: not an object');

          // 🔥 CLEANUP FOR INVALID RESPONSE
          cleanupFailedToolExecution();

          toast({
            title: "Invalid response",
            description: "Received invalid response from server. Please try again.",
            variant: "destructive",
            duration: 4000,
          });
          return;
        }

        // Check for success flag
        if (!resultData.success) {
          console.error('[handleApprove] Response indicates failure:', resultData);

          // 🔥 CLEANUP FOR FAILED EXECUTION
          cleanupFailedToolExecution();

          toast({
            title: "Tool execution failed",
            description: resultData.error || "Tool execution was not successful. Please try again.",
            variant: "destructive",
            duration: 4000,
          });
          return;
        }

        // Validate result structure
        if (!resultData.result && !resultData.toolResult) {
          console.error('[handleApprove] No result or toolResult in response');

          // 🔥 CLEANUP FOR EMPTY RESPONSE
          cleanupFailedToolExecution();

          toast({
            title: "Empty response",
            description: "Tool executed but returned no result. Please try again.",
            variant: "destructive",
            duration: 4000,
          });
          return;
        }

        // 🎯 CRITICAL FIX: Start polling for status updates immediately after approval
        // Debug: Starting status polling after approval
        startStatusPolling();

        // 🎯 CRITICAL FIX: Check for toolResult from approval API
        if (resultData.toolResult && resultData.toolResult.content) {
          // Add the result to the UI
          const formattedResult = resultData.toolResult;

          // Set the resultText to display directly in the chat message
          if (formattedResult.content[0]?.text) {
            // Debug: Setting result text in chat message

            // Apply universal formatting to the result text
            let displayText = formattedResult.content[0].text;

            // Use universal formatter to enhance the result
            const universalResult = formatToolResultUniversally(displayText, toolCall.toolName);
            displayText = universalResult.markdown;

            setResultText(displayText);

            // Mark the tool as completed with a result
            setHasToolResult(true);
            // Keep the approved state
            setIsApproved(true);

            // Gmail-specific completion logging
            if (toolCall.toolName.includes('gmail')) {
              // Debug: Gmail tool completed successfully
              // Debug: Gmail setting result text
              // Debug: Gmail hasToolResult and isApproved state
            }

            // CRITICAL: Save the result to localStorage for persistence across page reloads
            const chatId = window.location.pathname.split('/').pop();
            if (chatId) {
              const savedResultKey = `savedToolResult_${chatId || ''}_${toolCall.toolCallId}`;
              localStorage.setItem(savedResultKey, displayText);
              // Debug: Saved new result to localStorage

              // Also save in ref for this session
              savedResultRef.current = displayText;

              // CRITICAL: We also need to add a visible text element to ensure the result is captured in the DOM
              // This element acts as a permanent record in the rendered message
              try {
                // Find the appropriate message container
                const messageId = `response-${(toolCall.toolCallId || '').split('-')[0]}`;
                const messageContainer = document.getElementById(messageId);
                if (messageContainer) {
                  // Create a hidden div with the result text that will be part of the DOM
                  // but not visible to users - it's just there for state persistence
                  const hiddenDiv = document.createElement('div');
                  hiddenDiv.className = `tool-result-data-${toolCall.toolCallId}`;
                  hiddenDiv.style.display = 'none';
                  hiddenDiv.setAttribute('data-tool-result', 'true');
                  hiddenDiv.textContent = displayText;

                  // Add it to the message container
                  messageContainer.appendChild(hiddenDiv);
                  // Debug: Created hidden result element in DOM
                }
              } catch (e) {
                console.error('[ToolInvocation] Error creating hidden result element:', e);
              }
            }
          }

          // Add visual confirmation directly in the tool box
          setIsApproved(true);
        }
      }
    } catch (error) {
      console.error('Error approving tool:', error);
      toast({
        title: "Tool approval error",
        description: "Could not send approval to server. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
    }
  };

  // Handle user cancellation of tool execution
  const handleCancel = async () => {
    // Debug: Before cancellation state
    // Debug: Tool cancelled by user

    // 🎯 CRITICAL FIX: Immediate UI feedback - set cancelled state before API call
    setIsCancelled(true);
    // Debug: After setIsCancelled(true)

    // CRITICAL: Make API call to cancel the tool on the server
    try {
      // Debug: Sending cancellation to API
      // Update to use the new approval endpoint with cancel action
      const response = await fetch('/api/chat/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCallId: toolCall.toolCallId,
          action: 'cancel',
          sessionId: sessionId // Include sessionId for tool persistence
        })
      });

      if (!response.ok) {
        const result = await response.json();
        console.error('Tool cancellation failed:', result.error);

        // 🎯 CRITICAL FIX: Handle "Tool call already processed" error gracefully
        if (result.error && result.error.includes('already processed')) {
          // Debug: Tool already processed, keeping cancelled state
          // Keep isCancelled=true, this is expected behavior
        } else {
          // For other errors, revert the cancelled state
          // Debug: Unexpected cancellation error, reverting state
          setIsCancelled(false);

          // Show error for unexpected failures
          toast({
            title: "Cancellation failed",
            description: result.error || "Could not cancel tool. Please try again.",
            variant: "destructive",
            duration: 4000,
          });
        }
      } else {
        // Debug: Tool cancellation successful
      }
    } catch (error) {
      console.error('Error cancelling tool:', error);
      // Revert cancelled state on network/other errors
      setIsCancelled(false);

      toast({
        title: "Cancellation error",
        description: "Could not send cancellation to server. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
    }
  };

  // Format tool name for display
  const formatToolName = (name: string): string => {
    return name
      .replace(/__REQUIRES_APPROVAL__$/, '') // Remove __REQUIRES_APPROVAL__ suffix if present
      .replace(/^mcp_/, '') // Remove mcp_ prefix if present
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  // Load persistent tool execution state on mount
  // Load persistent tool execution state on mount
  React.useEffect(() => {
    const loadPersistentState = async () => {
      try {
        // Debug: Starting loadPersistentState
        // Debug: Tool name logged
        // Debug: Tool args logged

        // Call our API endpoint instead of the service directly
        const apiUrl = `/api/tool-execution-state?tool_call_id=${encodeURIComponent(toolCall.toolCallId || '')}`;
        // Debug: Making GET request to API

        const response = await fetch(apiUrl);
        // Debug: API Response status logged
        // Debug: API Response ok status

        if (response.ok) {
          const state = await response.json();
          // Debug: API Response data received

          if (state) {
            // Debug: Found persistent state
            setPersistentState(state);

            // Simply set the persistent state - processing will happen in the separate useEffect
            // Debug: Loaded persistent state
          } else {
            // Debug: API returned null/empty state
          }
        } else if (response.status === 404) {
          // Debug: No persistent state found (404)

          // Create persistent state if it doesn't exist
          try {
            let chatId = window.location.pathname.split('/').pop();
            // Debug: Extracted chatId from URL

            // Validate that we have a proper UUID format for chat_id
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!chatId || chatId === 'chat' || !uuidRegex.test(chatId)) {
              // Use placeholder UUID if we can't get the real chat_id
              chatId = '00000000-0000-0000-0000-000000000000';
              // Debug: Using placeholder chat_id
            } else {
              // Debug: Valid chat_id found
            }

            // Generate a deterministic message_id based on tool_call_id to prevent duplicates
            // Use a hash of the tool_call_id to ensure consistency across component re-mounts
            const messageId = Math.abs((toolCall.toolCallId || '').split('').reduce((a, b) => {
              a = ((a << 5) - a) + b.charCodeAt(0);
              return a & a;
            }, 0));
            // Debug: Generated deterministic message_id

            // 🔍 CRITICAL FIX: Always create persistent state to ensure it exists for approval route
            // The approval route will update it with correct parameters from global state
            const hasActualParams = toolCall.args && Object.keys(toolCall.args).length > 0;

            if (!hasActualParams) {
              // Debug: Creating persistent state with empty params
            } else {
              // Debug: Creating persistent state with available params
            }

            const createPayload = {
              chat_id: chatId,
              message_id: messageId,
              tool_call_id: toolCall.toolCallId,
              tool_name: toolCall.toolName,
              tool_params: toolCall.args || {}
            };

            // Debug: Creating initial persistent state

            const createResponse = await fetch('/api/tool-execution-state', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(createPayload)
            });

            // Debug: Create API Response status
            // Debug: Create API Response ok

            if (createResponse.ok) {
              const newState = await createResponse.json();
              // Debug: Created initial persistent state
              setPersistentState(newState);
            } else {
              // If creation failed, it might be because the state already exists
              // Try to fetch the existing state
              // Debug: Creation failed, fetching existing state
              const retryResponse = await fetch(apiUrl);
              if (retryResponse.ok) {
                const existingState = await retryResponse.json();
                if (existingState) {
                  // Debug: Found existing state after creation failure
                  setPersistentState(existingState);
                } else {
                  console.error('[ToolInvocation] ❌ No existing state found after creation failure');
                }
              } else {
                const errorData = await createResponse.json().catch(() => ({}));
                console.error('[ToolInvocation] ❌ Failed to create initial persistent state:', createResponse.status, errorData);
              }
            }
          } catch (createError) {
            console.error('[ToolInvocation] ❌ Exception creating initial persistent state:', createError);
          }
        } else {
          console.error('[ToolInvocation] ❌ Error response loading persistent state:', response.status, response.statusText);
          const errorText = await response.text().catch(() => 'Unable to read error response');
          console.error('[ToolInvocation] ❌ Error response body:', errorText);
        }
      } catch (error) {
        console.error('[ToolInvocation] ❌ Exception in loadPersistentState:', error);
      }
    };

    // Debug: useEffect triggered - calling loadPersistentState
    loadPersistentState();
  }, [toolCall.toolCallId, toolCall.toolName]);

  // 🎯 CRITICAL FIX: Automatically start polling when tool transitions to approved/running state
  React.useEffect(() => {
    if (persistentState?.status === 'approved' || persistentState?.status === 'running') {
      // Debug: Auto-starting polling because of tool status
      if (!pollingActive) {
        startStatusPolling();
      }
    }
  }, [persistentState?.status, pollingActive, startStatusPolling]);

  // Process persistent state when it changes (separate effect for completed states)
  React.useEffect(() => {
    // Gmail-specific debugging for persistent state processing
    if (toolCall.toolName.includes('gmail')) {
      // Debug: Gmail persistent state useEffect triggered
      // Debug: Gmail current persistentState
      // Debug: Gmail persistentState status
      // Debug: Gmail has tool_result check
    }

    // Prevent infinite loops by checking if state has already been processed
    if (hasToolResult && persistentState?.status === 'completed') {
      // Debug: State already processed, skipping
      return;
    }

    // Prevent processing if we already have a result but no persistent state (edge case)
    if (toolResult && !toolResult.isError && hasToolResult && !persistentState) {
      // Debug: Already have tool result, skipping processing
      return;
    }

    if (persistentState && persistentState.status === 'completed' && persistentState.tool_result) {
      // Debug: Processing completed persistent state

      // Gmail-specific completion logging
      if (toolCall.toolName.includes('gmail')) {
        // Debug: Gmail tool completed, processing result
        // Debug: Gmail tool result structure logged
      }

      setIsApproved(true);
      setHasToolResult(true);

      // Extract and format the result properly
      // Debug: Processing tool_result

      let resultData = persistentState.tool_result;

      // If the tool_result has the content structure, extract the actual data
      if (persistentState.tool_result.content && Array.isArray(persistentState.tool_result.content)) {
        const textPart = persistentState.tool_result.content.find((part: any) => part.type === 'text');
        if (textPart && textPart.text) {
          // Debug: Found text part in tool_result

          // Try to parse JSON if it's a JSON string
          if (textPart.text.startsWith('{') || textPart.text.startsWith('[')) {
            try {
              const parsedData = JSON.parse(textPart.text);
              // Debug: Parsed JSON from tool_result

              // For calendar tools, extract just the results array, not the entire response
              if (toolCall.toolName.includes('calendar') && parsedData.results && Array.isArray(parsedData.results)) {
                resultData = parsedData.results;
                // Debug: Extracted calendar results array
              } else if (parsedData.result && Array.isArray(parsedData.result)) {
                // Some tools use 'result' instead of 'results'
                resultData = parsedData.result;
                // Debug: Extracted result array
              } else {
                // For other tools, use the entire parsed data
                resultData = parsedData;
                // Debug: Using entire parsed data for non-calendar tool
              }
            } catch (e) {
              // Debug: Failed to parse JSON, using text directly
              resultData = textPart.text;
            }
          } else {
            resultData = textPart.text;
          }
        }
      }

      // Check if resultData contains [object Object] and needs special handling
      if (typeof resultData === 'string' && resultData.includes('[object Object]')) {
        // Debug: Detected [object Object] in result, attempting recovery

        // Try to extract meaningful data from the stored result
        if (persistentState.tool_result?.content?.[0]?.text) {
          try {
            const parsedData = JSON.parse(persistentState.tool_result.content[0].text);
            if (parsedData.results && Array.isArray(parsedData.results)) {
              resultData = parsedData.results;
              // Debug: Successfully recovered data from stored result
            }
          } catch (e) {
            // Debug: Could not parse stored result, using fallback
            resultData = 'Tool completed successfully, but result format was not preserved during reload.';
          }
        }
      }

      // Format the result using universal formatter
      const universalResult = formatToolResultUniversally(resultData, toolCall.toolName);
      setResultText(universalResult.markdown);

      // Debug: Processed completed persistent state with formatted result
    } else if (persistentState && (persistentState.status === 'approved' || persistentState.status === 'running')) {
      setIsApproved(true);
      // Debug: Processed approved/running persistent state

      // Gmail-specific tracking for running state
      if (toolCall.toolName.includes('gmail') && persistentState.status === 'running') {
        // Debug: Gmail tool is in RUNNING state - polling for completion
      }
    } else if (persistentState && persistentState.status === 'error') {
      setIsApproved(true);
      setHasToolResult(true);
      setResultText(`Error: ${persistentState.error_message || 'Tool execution failed'}`);
      // Debug: Processed error persistent state
    }
  }, [persistentState?.status, persistentState?.tool_result, toolCall.toolName, hasToolResult]); // Only re-run when status or result actually changes

  // Force layout stabilization after mount with staggered animation
  React.useEffect(() => {
    // Trigger layout calculation immediately after mount
    const layoutTimer = setTimeout(() => {
      setIsLayoutStable(true);
    }, 10);

    // Delay showing content slightly to prevent flash of unstyled content
    const visibilityTimer = setTimeout(() => {
      setIsVisible(true);
    }, 50);

    return () => {
      clearTimeout(layoutTimer);
      clearTimeout(visibilityTimer);
    };
  }, []);

  // Detect when we have a successful tool result (dynamic updates during a live chat session)
  React.useEffect(() => {
    // This effect is for live updates during tool execution, not for restored tool calls
    if (toolResult && !toolResult.isError && resultText && !hasToolResult) {
      // Debug: Detected successful tool result and text, updating state
      setHasToolResult(true);
      // Also make sure we have the approved flag set to complete the tool
      setIsApproved(true);
    }

    // Gmail-specific check for completed state that wasn't detected
    if (toolCall.toolName.includes('gmail') && resultText && !hasToolResult) {
      // Debug: Gmail tool has result text but hasToolResult false, fixing state
      setHasToolResult(true);
      setIsApproved(true);
    }
  }, [toolResult, resultText, hasToolResult, toolCall.toolName]);

  // Cached result text for storage across renders
  const savedResultRef = React.useRef<string | null>(null);

  // Process and parse the tool result into a proper format
  const processToolResult = React.useCallback((result: any) => {
    // Extract the result text from the tool result to restore the saved state
    let extractedResultText = '';
    // Debug: Processing tool result

    // First check if the message text has already been saved in the DOM - this is the most reliable approach
    // Look for elements that might contain the formatted text from a previous render
    if (document) {
      try {
        // First look for our specific hidden data element which is more reliable
        const toolResultSelector = `.tool-result-data-${toolCall.toolCallId}`;
        const hiddenResultElement = document.querySelector(toolResultSelector);
        if (hiddenResultElement) {
          const text = hiddenResultElement.textContent || '';
          if (text) {
            // Debug: Found hidden result element in DOM
            return text; // This is our exact saved result
          }
        }

        // If no hidden element, search for any message element with our result
        // We need to search all possible message IDs where our result might be
        const possibleIds = [
          `response-${toolCall.toolCallId}`,                    // Exact match
          `response-${toolCall.toolCallId.split('-')[0]}`,      // First part
          `response-${toolCall.toolCallId.slice(0, 10)}`        // First 10 chars
        ];

        for (const id of possibleIds) {
          const messageElement = document.getElementById(id);
          if (messageElement) {
            // First check for hidden elements with tool result data
            const hiddenElements = messageElement.querySelectorAll('[data-tool-result="true"]');
            for (const el of hiddenElements) {
              const text = el.textContent || '';
              if (text) {
                // Debug: Found tool result data element
                return text;
              }
            }

            // Then check for visible paragraphs
            const paragraphs = messageElement.querySelectorAll('p');
            for (const p of paragraphs) {
              const text = p.textContent || '';
              // Check if this paragraph contains a result that matches what we're looking for
              if (toolCall.toolName.includes('calendar') && text.includes('calendar event')) {
                // Debug: Found previously formatted calendar result in DOM
                return text; // Use the already formatted text from the DOM
              }
            }
          }
        }
      } catch (e) {
        console.error('[ToolInvocation] Error searching for formatted text in DOM:', e);
      }
    }

    try {
      // Handle different result formats
      if (typeof result === 'string') {
        extractedResultText = result;
      } else if (result && typeof result === 'object') {
        // Handle the specific format we use for calendar results
        if (result.content && Array.isArray(result.content)) {
          const content = result.content;
          const textPart = content.find((part: any) => part.type === 'text' && part.text);
          if (textPart && textPart.text) {
            // Try to parse JSON if it seems to be JSON
            if (textPart.text.startsWith('[') || textPart.text.startsWith('{')) {
              try {
                const parsed = JSON.parse(textPart.text);

                // Use universal formatting for any parsed JSON result
                const universalResult = formatToolResultUniversally(parsed, toolCall.toolName);
                extractedResultText = universalResult.markdown;
                // Debug: Applied universal formatting to parsed result
              } catch (e) {
                // If parsing fails, use the text directly
                extractedResultText = textPart.text;
              }
            } else {
              // Not JSON, use directly
              extractedResultText = textPart.text;
            }
          }
        }
      }
    } catch (e) {
      console.error('[ToolInvocation] Error extracting saved result text:', e);
    }

    return extractedResultText;
  }, [toolCall.toolName, toolCall.toolCallId]);

  // Discover results when coming back to a saved chat
  const forcedInitialization = useCallback(() => {
    // Debug: Running forced initialization for tool result

    // Check if we can extract formatted result text from the DOM first
    // This is the most reliable because it actually gets what was rendered before
    const extractedText = processToolResult({});
    if (extractedText) {
      // Debug: Found text in the DOM
      setResultText(extractedText);
      setHasToolResult(true);
      setIsApproved(true);
      savedResultRef.current = extractedText;
      return true;
    }

    // Next, check localStorage
    const chatId = window.location.pathname.split('/').pop();
    const savedResultKey = `savedToolResult_${chatId || ''}_${toolCall.toolCallId}`;
    const savedResult = localStorage.getItem(savedResultKey);

    if (savedResult) {
      // Debug: Found saved result in localStorage
      setResultText(savedResult);
      setHasToolResult(true);
      setIsApproved(true);
      savedResultRef.current = savedResult;
      return true;
    }

    // Finally, check for a tool result prop
    if (toolResult && !toolResult.isError) {
      // Debug: Found existing successful tool result, extracting data
      const extractedText = processToolResult(toolResult.result);

      // If we found a result, mark the tool as completed
      if (extractedText) {
        // Debug: Successfully extracted saved result text
        setResultText(extractedText);
        setHasToolResult(true);
        setIsApproved(true);
        savedResultRef.current = extractedText;

        // Save to localStorage for persistence across page loads
        if (chatId) {
          localStorage.setItem(savedResultKey, extractedText);
          // Debug: Saved result to localStorage
        }
        return true;
      }
    }

    return false;
  }, [toolCall.toolCallId, toolResult, processToolResult]);

  // Run forced initialization on component mount
  React.useEffect(() => {
    // Short delay to let the DOM fully load first
    const timer = setTimeout(() => {
      const success = forcedInitialization();
      if (success) {
        // Debug: Successfully restored tool state
      } else {
        // Debug: No saved state found for tool
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [forcedInitialization]);

  // Log explanation text for debugging
  // Debug: Rendering with explanation text

  // Show placeholder during initialization to prevent layout shifts
  if (!isVisible) {
    return <div className="tool-invocation-wrapper h-10 opacity-0" aria-hidden="true"></div>;
  }

  // Determine what text to show for the tool
  const toolExplanationText = explanationText ||
    (isAwaitingApproval ? `This tool needs to access ${formatToolName(toolCall.toolName)}. Please approve to continue.` : undefined);

  // 🎯 CRITICAL FIX: Don't override status - let McpToolBox handle it based on persistentState
  // The status determination should be handled entirely by McpToolBox using persistentState
  // Debug: Rendering with persistentState status

  // Note: Initial tool state creation is now handled by the approval API
  // when tools are first approved, ensuring we have proper context

  return (
    <div
      className={cn(
        "tool-invocation-wrapper relative my-2 animate-slideIn",
        isLayoutStable ? "opacity-100" : "opacity-0",
        "transition-opacity duration-200"
      )}
    >
      {/* Custom version of the McpToolBox that doesn't show loading animation when we have results */}
      {(hasToolResult && !isAwaitingApproval) || persistentState?.status === 'completed' ? (
        // For completed tools, show a simpler version with completion message
        (<div className="border rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800/50 border-green-200 dark:border-green-800 shadow-sm">
          <div className="flex items-center justify-between w-full px-4 py-3 text-left text-sm font-medium 
                         border-b border-gray-200 dark:border-gray-700
                         bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-750">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30">
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-gray-800 dark:text-gray-200">
                <strong className="font-semibold">{formatToolName(toolCall.toolName)}</strong>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                  Completed
                </span>
              </span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 shadow-inner p-3">
              <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                ✅ Tool execution completed successfully. Results displayed below.
              </p>
            </div>
          </div>
        </div>)
      ) : (
        // For tools that are waiting/running, use the normal McpToolBox
        (<McpToolBox
          key={`${toolCall.toolCallId}-${renderKey}`}
          toolCall={toolCall}
          toolResult={toolResult}
          onApprove={handleApprove}
          onCancel={handleCancel}
          requireExplicitApproval={!isYoloMode}
          initialExplanationText={toolExplanationText}
          persistentState={persistentState}
          isApproved={isApproved}
          isCancelled={isCancelled}
          sessionId={sessionId}
        />)
      )}
      {/* Display the tool result as a normal AI text response with standard buttons */}
      {resultText && (
        <div className="mt-5 mb-2">
          <div className="chat-message prose dark:prose-invert break-words max-w-full">
            {/* Tool Result header - clean, no duplicate AI icon */}
            <div className="flex items-center mb-3 text-sm">
              <div className="text-gray-600 dark:text-gray-400 text-sm font-medium">
                Tool Result
              </div>
            </div>

            {/* Main content with universal rich formatting */}
            <div>
              {resultText ? (
                (() => {
                  // Check if resultText is already formatted markdown (contains ** or other markdown syntax)
                  // If so, use it directly. Otherwise, apply universal formatting.
                  const isAlreadyMarkdown = resultText.includes('**') ||
                    resultText.includes('*') ||
                    resultText.includes('[') ||
                    resultText.includes('#');

                  const finalMarkdown = isAlreadyMarkdown
                    ? resultText
                    : formatToolResultUniversally(resultText, toolCall.toolName).markdown;

                  // Debug: Rendering tool result

                  // ALWAYS use ReactMarkdown for ALL tool results to properly parse markdown
                  return (
                    <div className="prose dark:prose-invert break-words text-gray-700 dark:text-gray-300 leading-normal max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          // Ensure links open in new tab
                          a: ({ href, children, ...props }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                              {...props}
                            >
                              {children}
                            </a>
                          ),
                          // Style code blocks
                          code: ({ className, children, ...props }) => (
                            <code
                              className={cn(
                                "bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm",
                                className
                              )}
                              {...props}
                            >
                              {children}
                            </code>
                          ),
                          // Style lists
                          ul: ({ children, ...props }) => (
                            <ul className="list-disc list-inside space-y-1" {...props}>
                              {children}
                            </ul>
                          ),
                          ol: ({ children, ...props }) => (
                            <ol className="list-decimal list-inside space-y-1" {...props}>
                              {children}
                            </ol>
                          ),
                          // Style headings
                          h3: ({ children, ...props }) => (
                            <h3 className="text-lg font-semibold mt-4 mb-2" {...props}>
                              {children}
                            </h3>
                          ),
                          // Style paragraphs
                          p: ({ children, ...props }) => (
                            <p className="mb-2 last:mb-0" {...props}>
                              {children}
                            </p>
                          )
                        }}
                      >
                        {finalMarkdown}
                      </ReactMarkdown>
                    </div>
                  );
                })()
              ) : (
                <div className="text-gray-500 dark:text-gray-400 text-sm">
                  Retrieving information...
                </div>
              )}
            </div>
          </div>

          {/* Tool result buttons - REMOVED to prevent duplicates */}
          {/* All buttons are now rendered in the main button section at line 4629+ */}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary re-renders
  // Only re-render if essential props have actually changed
  return (
    prevProps.toolCall.toolCallId === nextProps.toolCall.toolCallId &&
    prevProps.toolCall.toolName === nextProps.toolCall.toolName &&
    JSON.stringify(prevProps.toolCall.args) === JSON.stringify(nextProps.toolCall.args) &&
    prevProps.requireExplicitApproval === nextProps.requireExplicitApproval &&
    prevProps.explanationText === nextProps.explanationText &&
    // Compare toolResult by checking critical properties
    (prevProps.toolResult?.toolCallId === nextProps.toolResult?.toolCallId) &&
    (prevProps.toolResult?.isError === nextProps.toolResult?.isError)
  );
});

// --- END ToolInvocation Component ---

const TextPartRenderer = React.memo(({
  part,
  index,
  inlineSourcesEnabled,
  markdownComponents,
  textSize,
  fontFamily,
  isAI,
  isLastMessage,
  textSizeClasses,
  fontClasses,
  cleanToolCallMetadata
}: {
  part: ContentPart & { type: 'text' };
  index: number;
  inlineSourcesEnabled: boolean;
  markdownComponents: Partial<Components>;
  textSize: string;
  fontFamily: string;
  isAI: boolean;
  isLastMessage: boolean;
  textSizeClasses: any;
  fontClasses: any;
  cleanToolCallMetadata: (text: string) => string;
}) => {
  const rawTrim = part.text.trim();
  // Skip if original text is just JSON braces/brackets or whitespace
  if (/^[\{\}\[\]\s]+$/.test(rawTrim)) {
    return null;
  }
  const cleanedText = cleanToolCallMetadata(part.text);
  const trimmed = cleanedText.trim();

  // Use useMemo to ensure proper re-rendering when toggle changes
  const displayText = useMemo(() => {
    if (!cleanedText) return '';

    if (!inlineSourcesEnabled) {
      // Remove lines that contain **Source:** or Source: citations
      return cleanedText
        .split('\n')
        .filter(line => !line.includes('**Source:**') && !line.match(/\bSource:\s/))
        .join('\n')
        .trim();
    }

    // When sources are enabled, ensure Source: citations are on their own line
    // First, ensure any inline "Source:" or "**Source:**" is moved to its own line
    let processedText = cleanedText
      // Handle inline **Source:** - move to new line
      .replace(/\.\s*\*\*Source:\*\*/g, '.\n\n**Source:**')
      .replace(/([^\n])\s*\*\*Source:\*\*/g, '$1\n\n**Source:**')
      // Handle inline Source: (without bold) - move to new line and make bold
      .replace(/\.\s*Source:\s*([^\n]+)/g, '.\n\n**Source:** $1')
      .replace(/([^\n])\s+Source:\s*([^\n]+)/g, '$1\n\n**Source:** $2');

    // Then ensure proper spacing before Source: lines
    const lines = processedText.split('\n');
    const formattedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];

      formattedLines.push(line);

      // If this line doesn't end with Source: but the next line starts with **Source:**,
      // add a blank line before it for spacing
      if (!line.includes('**Source:**') && nextLine && nextLine.includes('**Source:**')) {
        formattedLines.push('');
      }
    }

    return formattedLines.join('\n').trim();
  }, [cleanedText, inlineSourcesEnabled]);

  if (!cleanedText) return null;

  return (
    <Markdown
      key={`text-${index}-${inlineSourcesEnabled}`}
      components={markdownComponents}
      className={cn(
        "react-markdown chat-message prose dark:prose-invert prose-headings:mb-4 prose-li:my-0.5 max-w-none",
        isLastMessage && "chat-message-last",
        textSizeClasses[textSize].base,
        fontClasses[fontFamily],
        isAI ? "prose-p:my-2" : "prose-p:my-0 leading-normal",
        "mt-2"
      )}
    >
      {typeof displayText === 'string' ? displayText : String(displayText)}
    </Markdown>
  );
});

TextPartRenderer.displayName = 'TextPartRenderer';

ChatMessage = function ({
  message,
  isLastMessage = false,
  isFirstMessage = false,
  isThinking = false,
  isStreaming = false,
  className,
  sessionId,
  ...props
}: ChatMessageProps) {
  const { theme } = useTheme();
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();
  const { openArtifact } = useArtifact();
  const { t } = useLanguage();
  // Correctly destructure the tracked setter and other needed values
  const { trackedSetIsSourcesOpen, setSources, isSourcesOpen } = useSources();
  const audioSettings = useAudioSettings();
  const isAI = message.role === 'assistant';
  const { showBorder, logoSizePx } = useAvatarSettings();
  const [isHovered, setIsHovered] = useState(false);
  const [layoutStabilized, setLayoutStabilized] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const [citationSources, setCitationSources] = useState<Source[]>([]);
  const [isContentChanging, setIsContentChanging] = useState(false);
  const prevContentRef = useRef(message.content);
  // Document sources state removed - no longer needed

  // Reasoning state
  const [showReasoning, setShowReasoning] = useState(env.NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT === 'true');
  const [reasoningContent, setReasoningContent] = useState<string | null>(null);

  // Remove webSearchEnabled log and update existing log
  // Debug: Rendering message with ID and role
  // --- NEW: Log the full message content structure ---
  // Debug: Message content object logged
  // --- END NEW ---

  // Track if autoplay has been triggered for this message
  const hasTriggeredAutoplayRef = useRef(false);

  // Extract reasoning content from message
  useEffect(() => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      // Look for reasoning content in the message parts
      const reasoningPart = message.content.find((part: any) =>
        part.type === 'reasoning' ||
        (part.type === 'metadata' && part.reasoningText)
      ) as { content?: string; reasoningText?: string } | undefined;

      if (reasoningPart) {
        setReasoningContent(reasoningPart.content || reasoningPart.reasoningText || null);
      }
    }

    // Also check for reasoning in experimental metadata (for OpenRouter)
    if ((message as any).experimental_providerMetadata?.openrouter?.reasoning_content) {
      setReasoningContent((message as any).experimental_providerMetadata.openrouter.reasoning_content);
    }
  }, [message]);

  // Font-specific spacing configuration for action buttons
  const fontSpacingConfig: Record<string, { gap: string, marginTop: string }> = {
    'inter': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    },
    'merriweather': {
      gap: textSize === 'small' ? 'gap-1.5' : textSize === 'large' ? 'gap-2.5' : 'gap-2',
      marginTop: textSize === 'small' ? '-mt-0.5' : textSize === 'large' ? '-mt-1' : '-mt-0.5'
    },
    'source-code-pro': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : textSize === 'large' ? '-mt-0.5' : '-mt-0.5'
    },
    'atkinson-hyperlegible': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : textSize === 'large' ? '-mt-0.5' : '-mt-0.5'
    },
    'lexend': {
      gap: textSize === 'small' ? 'gap-1.5' : textSize === 'large' ? 'gap-2.5' : 'gap-2',
      marginTop: textSize === 'small' ? '-mt-0.5' : textSize === 'large' ? '-mt-1' : '-mt-0.5'
    },
    'open-sans': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    },
    'lato': {
      gap: textSize === 'small' ? 'gap-1' : textSize === 'large' ? 'gap-2' : 'gap-1.5',
      marginTop: textSize === 'small' ? '-mt-1' : ''
    }
  };

  // Function to extract citations from message content
  const extractCitations = useCallback((content: string): Source[] => {
    const citations: Source[] = [];

    // Extract citations from markdown links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const [_, title, url] = match;
      if (url && !url.startsWith('#')) { // Ignore anchor links
        try {
          const urlObj = new URL(url);
          citations.push({
            title,
            url,
            favicon: `${urlObj.origin}/favicon.ico`,
            provider: urlObj.hostname,
            type: 'web' // Add the required type property
          });
        } catch (e) {
          console.error('Invalid URL in citation:', url);
        }
      }
    }

    return citations;
  }, []);

  useEffect(() => {
    // Only allow the *latest* assistant message to modify the global sources.
    // Older assistant messages remain mounted in the DOM and were unintentionally
    // re-running this effect, which could overwrite the sidebar with out-of-date
    // sources (e.g. web citations from a previous answer). Guarding against
    // non-last messages guarantees that the sidebar always reflects the current answer.
    if (message.role === 'assistant' && !isLastMessage) {
      // Debug: Skipping sources update for non-last message
      return;
    }

    // Only process for assistant messages that might contain document sources
    if (message.role === 'assistant') {
      // Debug: Checking message for document sources

      // Enhanced debugging to see the full message structure
      if (Array.isArray(message.content)) {
        // Debug: Full message content structure logged
      } else {
        // Debug: Not an array content - logging content type
      }

      let textContent = '';
      // Check if content is a string or an array
      if (typeof message.content === 'string') {
        textContent = message.content;
      } else if (Array.isArray(message.content)) {
        // Find the text part within the array
        const textPart = (message.content as ContentPart[]).find((part: ContentPart) => part.type === 'text');
        textContent = textPart?.text || '';
      }

      // Log the text content being processed
      // Debug: Processing text content for citations

      // Only proceed if we have text content
      if (textContent) {
        const citations = extractCitations(textContent);
        // Debug: Extracted citations // Added logging
        if (citations.length > 0) {
          // Debug: Setting citation sources // Added logging
          setCitationSources(citations);
        } else {
          // Ensure sources are cleared if no citations are found in the current message
          setCitationSources([]);
        }
      } else {
        // Clear sources if no text content
        setCitationSources([]);
      }
    }
  }, [message, extractCitations]); // Keep dependencies

  // Extract document sources from message content
  const extractDocumentSources = (content: ContentPart[]): Source[] => {
    const documentSources: Source[] = [];

    // Look for metadata parts with usedDocuments
    content.forEach(part => {
      if (part.type === 'metadata' && part.usedDocuments) {
        part.usedDocuments.forEach(doc => {
          documentSources.push({
            title: doc.name || doc.filename || 'Document',
            type: 'document' as const,
            documentId: doc.id,
            uploadedAt: doc.uploadedAt || doc.created_at,
            content: doc.content_preview,
            provider: 'Document Database',
            explicitly_referenced: doc.explicitly_referenced || false
          });
        });
      }

      if (part.type === 'tool_result' && part.toolName === 'query_documents' && (part.result as any)?.documents) {
        (part.result as any).documents.forEach((doc: any) => {
          // Avoid duplicates
          if (!documentSources.find(s => s.documentId === doc.documentId)) {
            documentSources.push({
              title: doc.title || doc.name || doc.filename || 'Document',
              type: 'document' as const,
              documentId: doc.documentId || doc.id,
              uploadedAt: doc.uploadedAt || doc.created_at,
              content: doc.content_preview,
              provider: doc.provider || 'Document Database',
              explicitly_referenced: doc.explicitly_referenced || false
            });
          }
        });
      }
    });

    return documentSources;
  };

  // Handle all sources - web, tool, and document
  useEffect(() => {
    // Only process for assistant messages that might contain sources
    if (message.role === 'assistant' && isLastMessage) {
      // Extract all types of sources
      const allSources: Source[] = [];

      // Add document sources if message has array content
      if (Array.isArray(message.content)) {
        // Check if this is a tool-only message first
        const isToolMessage = isToolOnlyMessage(message.content);

        // Get document sources
        const documentSources = extractDocumentSources(message.content);
        allSources.push(...documentSources);

        // Get tool links from tool results
        const toolLinks = extractToolLinks(message.content);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Sources] Extracted sources:', {
            isToolMessage,
            toolLinks: toolLinks.length,
            documentSources: documentSources.length,
            citationSources: citationSources.length
          });
        }

        // For tool-only messages, be much more aggressive about handling sources
        if (isToolMessage) {
          if (toolLinks.length > 0) {
            // ONLY show the tool links for tool-only messages
            setSources(toolLinks);
          } else {
            // If no tool links, clear ALL sources for tool-only messages
            setSources([]);
            // Also forcibly close the sources sidebar if it's open
            trackedSetIsSourcesOpen(false, 'TOOL_MESSAGE_NO_LINKS');
          }
          return; // Exit early for tool-only messages
        }

        // For normal messages, add tool links
        allSources.push(...toolLinks);
      }

      // Add web citation sources
      const webSources = citationSources.map(source => ({
        ...source,
        type: 'web' as const
      }));
      allSources.push(...webSources);

      // Set all sources
      if (allSources.length > 0) {
        setSources(allSources);
      } else {
        setSources([]);
      }
    }
  }, [message.id, message.role, citationSources, trackedSetIsSourcesOpen, isLastMessage]); // Keep stable dependencies


  // Detect content changes and manage transitions
  useEffect(() => {
    const prevContent = prevContentRef.current;
    const currentContent = message.content;

    // Check if content is different (not just a reference change)
    const contentChanged =
      typeof prevContent !== typeof currentContent ||
      JSON.stringify(prevContent) !== JSON.stringify(currentContent);

    if (contentChanged && layoutStabilized && !isFirstMessage) {
      // Content is changing, start transition
      setIsContentChanging(true);

      // After a very short delay, update the content
      const timer = setTimeout(() => {
        setIsContentChanging(false);
      }, 10);

      return () => clearTimeout(timer);
    }

    // Update the ref with current content
    prevContentRef.current = currentContent;
  }, [message.content, layoutStabilized, isFirstMessage]);

  // IMPORTANT: Check if this is a streaming message by its ID
  const isStreamingMessage = message.id === 'streaming';

  // Function to clean unwanted tool call metadata and SDK streaming artifacts
  const cleanToolCallMetadata = (text: string): string => {
    if (typeof text !== 'string' || !text) return '';

    // Debug: Processing text for tool call metadata

    // CRITICAL: First, check for our special approval format pattern
    if (text.includes('__REQUIRES_APPROVAL__:')) {
      // Debug: Found approval format with potential JSON artifacts

      // 🔧 CRITICAL FIX: Handle multiple concatenated approval requests
      // Extract the first clean approval signal only
      const approvalPattern = /__REQUIRES_APPROVAL__:([^:,\s\}"]+):([^:,\s\}"]+)/;
      const match = text.match(approvalPattern);
      if (match) {
        const [fullMatch, toolCallId, rawToolName] = match;
        // Remove __REQUIRES_APPROVAL__ suffix from tool name if present
        const cleanToolName = rawToolName.replace(/__REQUIRES_APPROVAL__$/, '');
        const cleanApproval = `__REQUIRES_APPROVAL__:${toolCallId}:${cleanToolName}`;
        // Debug: Extracted clean approval signal
        return cleanApproval; // Return just the clean approval format
      }

      // Debug: Could not extract clean approval signal, returning original
      return text;
    }

    // For non-approval content, proceed with regular cleaning
    let cleanedText = text;

    // 🎯 CRITICAL FIX: Enhanced JSON artifact removal for CoinGecko results
    // Remove the specific pattern: ,"isContinued":false}\n}\n
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\s*\n\s*\}\s*\n\s*$/g, '');
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\s*\}\s*$/g, '');

    // Super-aggressive cleaning of artifacts at the end of messages
    // These patterns match the exact artifact shown in the logs
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\s*\}/g, '');
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\}/g, '');
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}/g, '');

    // Also handle any trailing isContinued fragments at the end of paragraphs
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\s*\}\s*$/g, '');
    cleanedText = cleanedText.replace(/\s*\{\s*"isContinued"\s*:\s*false\s*\}\s*$/g, '');
    cleanedText = cleanedText.replace(/\s*\{"isContinued":false\}$/g, '');

    // Clean up artifacts that appear at end of paragraphs or sentences
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\s*\}([.,?!])/g, '$1');
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}\}([.,?!])/g, '$1');
    cleanedText = cleanedText.replace(/,\s*"isContinued"\s*:\s*false\s*\}([.,?!])/g, '$1');

    // Even more specific pattern matches
    cleanedText = cleanedText.replace(/\s*,"isContinued":false\}\s*\}/g, '');
    cleanedText = cleanedText.replace(/\s*,"isContinued":false\}\}/g, '');

    // Clean up isolated JSON fragments that might appear in the text
    cleanedText = cleanedText.replace(/\s*\{\s*"isContinued"\s*:\s*false\s*\}\s*/g, ' ');

    // 🎯 CRITICAL FIX: Additional cleanup for tool result content corruption
    // Remove any trailing newlines and spaces that might affect rendering
    cleanedText = cleanedText.replace(/\s+$/g, '');

    return cleanedText;
  };

  // Function to prepare text for text-to-speech by removing markdown formatting
  const prepareTextForTTS = (text: string): string => {
    if (typeof text !== 'string' || !text) return '';

    let ttsText = text;

    // CRITICAL: Normalize special whitespace characters first
    // Replace non-breaking spaces with regular spaces
    ttsText = ttsText.replace(/\u00A0/g, ' ');
    // Remove zero-width characters that might confuse TTS
    ttsText = ttsText.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '');
    // Normalize line endings (convert Windows CRLF to LF)
    ttsText = ttsText.replace(/\r\n/g, '\n');
    ttsText = ttsText.replace(/\r/g, '\n');

    // Remove code blocks first (before other processing)
    // Match code blocks with optional language specifier
    ttsText = ttsText.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1');

    // Remove inline code markers (`)
    ttsText = ttsText.replace(/`([^`]+)`/g, '$1');

    // ENHANCED: Remove markdown headings with more aggressive pattern
    // This handles edge cases with special whitespace after #
    ttsText = ttsText.replace(/^#{1,6}[\s\u00A0\t]+/gm, '');
    // Also remove headings that might have no space after #
    ttsText = ttsText.replace(/^#{1,6}(?=\S)/gm, '');

    // Remove bold markers (** and __)
    ttsText = ttsText.replace(/\*\*([^*]+)\*\*/g, '$1');
    ttsText = ttsText.replace(/__([^_]+)__/g, '$1');

    // Remove italic markers (* and _)
    // First handle the bullet points conversion
    ttsText = ttsText.replace(/^[\*\-\+]\s+/gm, '• ');

    // Then remove italic markers (single * or _ not at line start)
    ttsText = ttsText.replace(/(?<!^|\n)\*([^*\n]+)\*/g, '$1');
    ttsText = ttsText.replace(/(?<!^|\n)_([^_\n]+)_/g, '$1');

    // Remove strikethrough markers (~~)
    ttsText = ttsText.replace(/~~([^~]+)~~/g, '$1');

    // Convert links to just the link text
    // [text](url) -> text
    ttsText = ttsText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Convert numbered lists to readable format (keeping the numbers)
    ttsText = ttsText.replace(/^\d+\.\s+/gm, (match) => match);

    // Remove horizontal rules
    ttsText = ttsText.replace(/^[\*\-_]{3,}$/gm, '');

    // Remove blockquote markers (>)
    ttsText = ttsText.replace(/^>\s+/gm, '');

    // Handle tables - convert to a simple readable format
    // This is a simplified approach - just remove table formatting
    ttsText = ttsText.replace(/\|/g, ' ');
    ttsText = ttsText.replace(/^\s*[-:]+\s*$/gm, '');

    // Remove HTML tags if any
    ttsText = ttsText.replace(/<[^>]+>/g, '');

    // ENHANCED: Remove any remaining special Unicode characters that might confuse TTS
    // Remove soft hyphens
    ttsText = ttsText.replace(/\u00AD/g, '');
    // Remove other invisible formatting characters
    ttsText = ttsText.replace(/[\u2028\u2029]/g, '\n');

    // Clean up excessive whitespace
    ttsText = ttsText.replace(/\n{3,}/g, '\n\n');
    ttsText = ttsText.replace(/[ \t]+/g, ' ');

    // Trim leading and trailing whitespace
    ttsText = ttsText.trim();

    // Debug logging for ElevenLabs issue
    if (env.NEXT_PUBLIC_VOICE_PROVIDER === 'elevenlabs') {
      console.log('[TTS Debug] Original text preview:', text.substring(0, 100));
      console.log('[TTS Debug] Cleaned text preview:', ttsText.substring(0, 100));
    }

    return ttsText;
  };

  // Check for weather tool results in the message content
  const hasWeatherData = false;

  // Check for stock tool results in the message content
  const hasStockData = false;

  // Define the hook first
  const messageContentParts = React.useMemo(() => {
    // Add a flag to track if we need to show the approval UI
    let requiresApproval = false;

    // Part detection
    let text = '';
    let imageUrl = '';
    let documentInfo: any = null; // Use any to avoid type issues
    let toolCall: any = null; // Use any to avoid type issues
    let toolResult: any = null; // Use any to avoid type issues
    let modelInfo: any = null; // Use any to avoid type issues
    let parts: ContentPart[] = [];
    const generatedImages: string[] = []; // Collect generated images

    // Add this debug log
    // Debug: Processing message content

    // First, check if this is a direct approval required message regardless of content format
    if (typeof message.content === 'string' && message.content.includes('__REQUIRES_APPROVAL__')) {
      // Debug: Found approval pattern in string content
      console.log('[messageContentParts] Found approval pattern in string content:', message.content);
      const approvalToolCall = extractApprovalNeededToolCall(message.content);
      if (approvalToolCall) {
        // Debug: Successfully extracted tool call from string
        console.log('[messageContentParts] Successfully extracted tool call:', approvalToolCall);
        toolCall = approvalToolCall;
        requiresApproval = true;

        // Extract the text before the approval marker to preserve RAG content
        const approvalIndex = message.content.indexOf('__REQUIRES_APPROVAL__');
        const textBeforeApproval = approvalIndex > 0 ? message.content.substring(0, approvalIndex).trim() : '';

        // Create parts array with both text and tool call
        parts = [];
        if (textBeforeApproval) {
          parts.push({
            type: 'text',
            text: textBeforeApproval
          });
        }
        parts.push(approvalToolCall);

        // Return with both text and tool call info
        return {
          text: textBeforeApproval,
          imageUrl: '',
          documentInfo: null,
          toolCall,
          toolResult: null,
          modelInfo: null,
          parts,
          requiresApproval: true,
          generatedImages: []
        };
      }
    } else if (Array.isArray(message.content)) {
      // Check if any part has the approval format
      const textPart = message.content.find(part =>
        part.type === 'text' &&
        typeof (part as any).text === 'string' &&
        (part as any).text.includes('__REQUIRES_APPROVAL__')
      );

      if (textPart && typeof (textPart as any).text === 'string') {
        // Debug: Found approval pattern in array text part
        const approvalToolCall = extractApprovalNeededToolCall((textPart as any).text);
        if (approvalToolCall) {
          // Debug: Successfully extracted tool call from array
          toolCall = approvalToolCall;
          requiresApproval = true;

          // Extract the text before the approval marker to preserve RAG content
          const fullText = (textPart as any).text;
          const approvalIndex = fullText.indexOf('__REQUIRES_APPROVAL__');
          const textBeforeApproval = approvalIndex > 0 ? fullText.substring(0, approvalIndex).trim() : '';

          // Create parts array with both text and tool call
          parts = [];
          if (textBeforeApproval) {
            parts.push({
              type: 'text',
              text: textBeforeApproval
            });
          }
          parts.push(approvalToolCall);

          // Return with both text and tool call info
          return {
            text: textBeforeApproval,
            imageUrl: '',
            documentInfo: null,
            toolCall,
            toolResult: null,
            modelInfo: null,
            parts,
            requiresApproval: true,
            generatedImages: []
          };
        }
      }
    }

    // If we get here, we didn't find an approval request, so proceed with normal content parsing
    if (Array.isArray(message.content)) {
      // Standard case - content is already structured
      parts = [...message.content];

      // Find text, image, document, and 3D model content
      const textItem = message.content.find(item => item.type === 'text');

      // Debug check specifically for image_url parts
      const imageItems = message.content.filter(item => item.type === 'image_url');
      if (imageItems.length > 0) {
        // Debug: Found image_url parts

        // Extract image URLs to the generatedImages array
        imageItems.forEach(img => {
          if (img.image_url?.url) {
            generatedImages.push(img.image_url.url);
          }
        });
      }

      // Also look for generated_image type items
      const generatedImageItems = message.content.filter(item => item.type === 'generated_image');
      if (generatedImageItems.length > 0) {
        // Debug: Found generated_image parts

        // Extract image URLs
        generatedImageItems.forEach(img => {
          // Check for generated_images array first (our current format)
          if (img.generated_images && Array.isArray(img.generated_images)) {
            generatedImages.push(...img.generated_images);
          } else {
            // Fallback to legacy formats
            const url = img.url || (img.image_url ? img.image_url.url : null);
            if (url) {
              generatedImages.push(url);
            }
          }
        });
      }

      const documentItem = message.content.find(item => item.type === 'document');
      const modelItem = message.content.find(item => item.type === 'generated_3d_model');

      // Extract text content and clean it
      text = textItem?.text || '';

      // Clean the text to remove JSON artifacts
      if (text) {
        text = cleanToolCallMetadata(text);
      }

      // Add logging to help debug
      // Debug: Processing array content with text part

      // Direct check for approval format in the text
      if (text && text.includes('__REQUIRES_APPROVAL__')) {
        // Debug: Raw text contains approval format
        // If it matches our format detector, extract the tool call
        if (isApprovalRequiredFormat(text)) {
          // Debug: Found approval format in array text part
          console.log('[messageContentParts] Found approval format in array text');
          const approvalToolCall = extractApprovalNeededToolCall(text);
          if (approvalToolCall) {
            // Debug: Successfully extracted tool call
            console.log('[messageContentParts] Successfully extracted tool call:', approvalToolCall);
            toolCall = approvalToolCall;
            // Flag that we need to render the approval UI
            requiresApproval = true;

            // Extract the text before the approval marker to preserve RAG content
            const approvalIndex = text.indexOf('__REQUIRES_APPROVAL__');
            const textBeforeApproval = approvalIndex > 0 ? text.substring(0, approvalIndex).trim() : '';

            // Keep the text before approval marker
            text = textBeforeApproval;

            // CRITICAL FIX: Create parts array with both text and tool call
            parts = [];
            if (textBeforeApproval) {
              parts.push({
                type: 'text',
                text: textBeforeApproval
              });
            }
            parts.push(approvalToolCall);

            console.log('[messageContentParts] Created parts with RAG text and tool call:', {
              hasText: !!textBeforeApproval,
              hasToolCall: true,
              partsCount: parts.length
            });
          }
        }
      }

      // Extract image URL from the first found image_url part
      const firstImageItem = imageItems[0];
      if (firstImageItem && firstImageItem.image_url) {
        imageUrl = firstImageItem.image_url.url;
        // Debug: Set primary imageUrl
      }

      // Extract document information
      if (documentItem) {
        documentInfo = documentItem.document;
      }

      // Extract 3D model information
      if (modelItem) {
        modelInfo = modelItem as any;
      }

      // Find any tool call parts
      const toolCallItem = message.content.find(
        item => item.type === 'tool-call'
      ) as ToolCallPart | undefined;

      if (toolCallItem) {
        // Debug: Found tool call part in content
        toolCall = toolCallItem;
      }

      // Find any tool result parts
      const toolResultItem = message.content.find(
        item => item.type === 'tool-result'
      ) as ToolResultPart | undefined;

      if (toolResultItem) {
        toolResult = toolResultItem;
      }
    } else if (typeof message.content === 'string') {
      // Legacy format - just a text string
      text = message.content;

      // Clean the text to remove JSON artifacts
      text = cleanToolCallMetadata(text);

      // Add more logging for plain string content
      // Debug: Processing string content

      // Direct check for approval format in the text
      if (text && text.includes('__REQUIRES_APPROVAL__')) {
        // Debug: String content contains approval format

        // If it matches our format detector, extract the tool call
        if (isApprovalRequiredFormat(text)) {
          // Debug: Found approval format in string content
          const approvalToolCall = extractApprovalNeededToolCall(text);
          if (approvalToolCall) {
            // Debug: Successfully extracted tool call
            toolCall = approvalToolCall;
            // Flag that we need to render the approval UI
            requiresApproval = true;

            // Extract the text before the approval marker to preserve RAG content
            const approvalIndex = text.indexOf('__REQUIRES_APPROVAL__');
            const textBeforeApproval = approvalIndex > 0 ? text.substring(0, approvalIndex).trim() : '';

            // Keep the text before approval marker and create parts array with both
            text = textBeforeApproval;

            // Create parts array with both text and tool call
            parts = [];
            if (textBeforeApproval) {
              parts.push({
                type: 'text',
                text: textBeforeApproval
              });
            }
            parts.push(approvalToolCall);
          }
        }
      }

      // Only create a text part if we didn't create a tool call part earlier
      if (!toolCall) {
        parts = [{
          type: 'text',
          text
        }];
      }
    }

    // Debug: Returning parts with toolCall and generated images

    return {
      text,
      imageUrl,
      documentInfo,
      toolCall,
      toolResult,
      modelInfo,
      parts,
      requiresApproval,
      generatedImages
    };
  }, [message.content]);

  // Extract message content
  const messageContent = useMemo(() => {
    const { text, imageUrl, documentInfo, toolCall, toolResult, modelInfo, parts, requiresApproval, generatedImages } = messageContentParts;

    // Sanitize text content to prevent raw MCP JSON data from appearing
    let sanitizedText = text;

    // Clean the text to remove JSON artifacts before display
    sanitizedText = cleanToolCallMetadata(sanitizedText);

    // Various processing of the text...

    return {
      text: sanitizedText,
      imageUrl,
      documentInfo,
      toolCall,
      toolResult,
      modelInfo,
      parts,
      containsToolResults: !!toolResult,
      generatedImages // Include the generated images array
    };
  }, [messageContentParts]);

  // Audio state management
  const { user } = useAuth();
  const [audioState, setAudioState] = useState<{
    isPlaying: boolean;
    isLoading: boolean;
    audioUrl: string | null;
  }>({
    isPlaying: false,
    isLoading: false,
    audioUrl: null
  });
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [showAICopyTooltip, setShowAICopyTooltip] = useState(false);
  const [showAISpeakTooltip, setShowAISpeakTooltip] = useState(false);
  const [showAIOptionsTooltip, setShowAIOptionsTooltip] = useState(false);
  const [showUserCopyTooltip, setShowUserCopyTooltip] = useState(false);
  const [showUserSpeakTooltip, setShowUserSpeakTooltip] = useState(false);
  const [showPreviewTooltip, setShowPreviewTooltip] = useState(false);
  const [showPDFTooltip, setShowPDFTooltip] = useState(false);
  const [showUserPDFTooltip, setShowUserPDFTooltip] = useState(false);
  const [showUserImageModal, setShowUserImageModal] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [showRAGTooltip, setShowRAGTooltip] = useState(false);
  const [isSendingToRAG, setIsSendingToRAG] = useState(false);
  const ragButtonRef = useRef<HTMLButtonElement>(null);

  // Detect touch devices to conditionally disable tooltips
  const isTouchDevice = useIsTouchDevice();

  // Helper to conditionally set tooltip visibility (no-op on touch devices)
  const setTooltipIfNotTouch = useCallback((setter: (value: boolean) => void, value: boolean) => {
    if (isTouchDevice && value) return; // Don't show tooltips on touch devices
    setter(value);
  }, [isTouchDevice]);

  // Comprehensive tooltip state management to prevent persistence bugs
  useEffect(() => {
    // Function to reset all tooltip states
    const resetAllTooltips = () => {
      setShowAICopyTooltip(false);
      setShowAISpeakTooltip(false);
      setShowAIOptionsTooltip(false);
      setShowUserCopyTooltip(false);
      setShowUserSpeakTooltip(false);
      setShowPreviewTooltip(false);
      setShowPDFTooltip(false);
      setShowUserPDFTooltip(false);
      setShowRAGTooltip(false);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        resetAllTooltips();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        resetAllTooltips();
      }
    };

    const handleWindowBlur = () => {
      resetAllTooltips();
    };

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  // Create refs for all tooltip buttons
  const speakButtonRef = useRef<HTMLButtonElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const userCopyButtonRef = useRef<HTMLButtonElement>(null);
  const userSpeakButtonRef = useRef<HTMLButtonElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const pdfButtonRef = useRef<HTMLButtonElement>(null);

  const userPdfButtonRef = useRef<HTMLButtonElement>(null);

  // Set up audio state change listener
  useEffect(() => {
    const handleAudioStateChange = (state: { isPlaying: boolean; isLoading: boolean }) => {
      setAudioState(prevState => ({
        ...prevState,
        isPlaying: state.isPlaying,
        isLoading: state.isLoading
      }));
    };

    onAudioStateChange(handleAudioStateChange);

    return () => {
      // Use an empty function for cleanup instead of null
      onAudioStateChange(() => { });
    };
  }, []);

  // Inside the ChatMessage component, add a state for copy confirmation
  const [isCopied, setIsCopied] = useState(false);

  // Update the handleCopy function to show a confirmation
  const handleCopy = async () => {
    // Use processed parts instead of raw message content to get properly extracted RAG text
    const textParts = processMessageContent.renderableParts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text');

    // Concatenate text from all text parts (includes RAG content extracted before approval marker)
    let textToCopy = textParts.map(part => part.text).join('\n\n');

    // Always clean the text to remove JSON artifacts before copying
    textToCopy = cleanToolCallMetadata(textToCopy);

    // Check if this message has tool results that should be included
    const hasToolResults = processMessageContent.renderableParts.some(part =>
      isToolCallPart(part) || isToolResultPart(part)
    );

    // If we have tool results, append them to the text
    if (hasToolResults) {
      // Look for tool result text in the rendered parts
      processMessageContent.renderableParts.forEach(part => {
        if (isToolCallPart(part)) {
          // Find the corresponding result
          const result = processMessageContent.toolResultsMap.get(part.toolCallId);
          if (result && !result.isError) {
            // Extract result text
            let resultText = '';
            if (result.result && typeof result.result === 'object') {
              const content = (result.result as any).content;
              if (Array.isArray(content)) {
                const textPart = content.find((c: any) => c.type === 'text');
                if (textPart && textPart.text) {
                  resultText = textPart.text;
                }
              }
            } else if (typeof result.result === 'string') {
              resultText = result.result;
            }

            if (resultText) {
              // Format and append the tool result
              const toolName = part.toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              textToCopy += `\n\n## Tool Result: ${toolName}\n${resultText}`;
            }
          }
        }
      });
    }

    // Convert markdown to HTML for rich text clipboard
    const htmlContent = convertMarkdownToHTML(textToCopy);

    try {
      // Check for ClipboardItem support (not available on all mobile browsers)
      const hasClipboardItem = typeof ClipboardItem !== 'undefined';

      // Try to copy as rich text for better paste experience in word processors
      if (navigator.clipboard && hasClipboardItem && typeof navigator.clipboard.write === 'function') {
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([textToCopy], { type: 'text/plain' });

        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': htmlBlob,
              'text/plain': textBlob
            })
          ]);
        } catch (richErr) {
          console.warn('Rich clipboard copy failed, falling back to plain text:', richErr);
          // Fall back to plain text
          await navigator.clipboard.writeText(textToCopy);
        }
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        // Standard writeText API - works on most mobile browsers
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Legacy fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (execErr) {
          console.error('execCommand copy failed:', execErr);
        }
        document.body.removeChild(textArea);
      }

      // Show copied confirmation
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      // Ultimate fallback using execCommand
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('All copy methods failed:', fallbackErr);
      }
    }
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const handleTextToSpeech = async () => {
    try {
      if (audioState.isPlaying) {
        stopAudioPlayback();
        setAudioState({ isPlaying: false, isLoading: false, audioUrl: null });
        return;
      }

      // Clean the text before sending to text-to-speech
      const cleanedText = prepareTextForTTS(cleanToolCallMetadata(messageContent.text));

      // Get voice provider - prioritize environment variable
      const voiceProvider = env.NEXT_PUBLIC_VOICE_PROVIDER || useUserSettingsStore.getState().voiceProvider || 'openai';

      setAudioState({ isLoading: true, isPlaying: true, audioUrl: null });
      await textToSpeech(cleanedText, () => {
        setAudioState({ isPlaying: false, isLoading: false, audioUrl: null });
      }, { provider: voiceProvider });
    } catch (error) {
      console.error('Failed to play text-to-speech:', error);
      setAudioState({ isPlaying: false, isLoading: false, audioUrl: null });
    }
  };

  const handleDownloadAudio = () => {
    // Clean the text before checking the audio cache
    const cleanedText = prepareTextForTTS(cleanToolCallMetadata(messageContent.text));
    const audioBlob = getCachedAudioBlob(cleanedText);
    if (!audioBlob) return;

    // Create download link
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateAudioFilename(cleanedText);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSendToRAG = async () => {
    try {
      setIsSendingToRAG(true);

      // Extract the text content
      let textContent = '';
      if (typeof message.content === 'string') {
        textContent = message.content;
      } else if (Array.isArray(message.content)) {
        const textPart = (message.content as ContentPart[]).find((part: ContentPart) => part.type === 'text');
        textContent = textPart?.text || '';
      }

      // Clean the text content
      textContent = cleanToolCallMetadata(textContent);

      if (!textContent) {
        toast({
          title: "Error",
          description: "No content to send to knowledge base",
          variant: "destructive",
        });
        return;
      }

      // Send to the API endpoint
      const response = await fetch('/api/ai-to-rag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: textContent,
          messageId: message.id,
          chatId: sessionId,
          userId: user?.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send to RAG');
      }

      const result = await response.json();

      // Show success notification
      toast({
        title: "Success",
        description: `Added "${result.title}" to knowledge base (${result.chunksStored} chunks)`,
      });

    } catch (error) {
      console.error('Error sending to RAG:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send to knowledge base",
        variant: "destructive",
      });
    } finally {
      setIsSendingToRAG(false);
    }
  };

  // Reset autoplay trigger when message ID changes
  useEffect(() => {
    hasTriggeredAutoplayRef.current = false;
  }, [message.id]);

  // Listen for stream completion event to trigger autoplay
  useEffect(() => {
    const handleStreamCompleted = () => {
      console.log('[Autoplay] Stream completed event received', {
        isAI,
        isLastMessage,
        messageId: message.id,
        hasText: !!messageContent.text,
        audioAutoplay: audioSettings.audioAutoplay,
        ttsDisabled: audioSettings.ttsDisabled,
        hasTriggered: hasTriggeredAutoplayRef.current
      });

      // Check if this is an AI message and we should autoplay
      if (isAI && isLastMessage && audioSettings.audioAutoplay && !audioSettings.ttsDisabled &&
        !hasTriggeredAutoplayRef.current && messageContent.text && messageContent.text.trim()) {
        console.log('[Autoplay] All conditions met, triggering autoplay');
        hasTriggeredAutoplayRef.current = true;

        // Small delay to ensure audio system is ready
        setTimeout(() => {
          console.log('[Autoplay] Calling handleTextToSpeech');
          handleTextToSpeech();
        }, 500); // Slightly longer delay to ensure everything is ready
      }
    };

    // Add event listener
    window.addEventListener('ai-stream-completed', handleStreamCompleted);

    // Cleanup
    return () => {
      window.removeEventListener('ai-stream-completed', handleStreamCompleted);
    };
  }, [isAI, isLastMessage, audioSettings.audioAutoplay, audioSettings.ttsDisabled, messageContent, handleTextToSpeech]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioState.isPlaying) {
        stopAudioPlayback();
      }
    };
  }, [audioState.isPlaying]);

  const textSizeClasses: Record<TextSize, { base: string, image: string, document: string }> = {
    small: {
      base: 'text-size-small',
      image: 'max-w-[400px]',
      document: 'max-w-[400px]'
    },
    default: {
      base: 'text-size-default',
      image: 'max-w-[500px]',
      document: 'max-w-[500px]'
    },
    large: {
      base: 'text-size-large',
      image: 'max-w-[600px]',
      document: 'max-w-[600px]'
    }
  };

  const fontClasses: Record<string, string> = {
    'inter': 'font-inter',
    'merriweather': 'font-merriweather',
    'source-code-pro': 'font-source-code-pro',
    'atkinson-hyperlegible': 'font-atkinson-hyperlegible',
    'lexend': 'font-lexend',
    'open-sans': 'font-open-sans',
    'lato': 'font-lato'
  };

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Document processing removed - only web and tool sources needed

  // Enhanced document sources removed - no longer needed

  // Update sources in provider when citation sources change (web sources only)
  useEffect(() => {
    // Skip processing if this isn't the last message - only the latest message should update sources
    if (!isLastMessage) {
      return;
    }

    if (isAI && citationSources.length > 0) {
      // Only handle web citation sources now
      const webSources = citationSources.map(source => ({
        ...source,
        type: 'web' as const
      }));

      console.log('[ChatMessage] Setting web sources in provider:', webSources.length);
      setSources(webSources);
    }
  }, [isAI, citationSources, isLastMessage, setSources]); // Simplified dependencies

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Define markdown components with access to component state
  const markdownComponents: Partial<Components> = useMemo(() => ({
    h1: ({ children }) => (
      <h1 className="font-semibold mb-4 mt-8 first:mt-0 text-gray-900 dark:text-gray-100">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-bold mb-4 text-gray-900 dark:text-gray-100">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="font-bold text-gray-900 dark:text-gray-100 mt-6 mb-4">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="font-semibold mb-3 mt-4 text-gray-900 dark:text-gray-100">{children}</h5>
    ),
    ul: ({ children }) => (
      <ul className="space-y-2 mb-6 last:mb-0 pl-6">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal space-y-2 mb-6 last:mb-0 pl-6">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="ml-2 text-gray-700 dark:text-gray-300">{children}</li>
    ),
    p: ({ children }) => {
      // If children contains a string that might have @mentions
      if (typeof children === 'string') {
        const formattedText = highlightDocumentMentions(children);
        return <p
          className="break-words text-gray-700 dark:text-gray-300 mb-4 last:mb-0"
          dangerouslySetInnerHTML={{ __html: formattedText }}
        />;
      }

      // Otherwise use normal paragraph rendering
      return <p className="break-words text-gray-700 dark:text-gray-300 mb-4 last:mb-0">{children}</p>;
    },
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#FF6417] dark:text-[#FF8A4D] hover:underline font-medium"
      >
        {children}
      </a>
    ),
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const value = String(children).replace(/\n$/, '');

      // Don't render code blocks containing tool JSON data
      if (!inline &&
        (value.includes('"toolCallId"') ||
          value.includes('"result"') ||
          value.includes('isContinued') ||
          value.includes('isError'))) {
        // Debug: Hiding code block with JSON tool data
        return null;
      }

      // Inline code rendering - clean and minimal
      if (inline) {
        return (
          <code className={cn(
            // Light mode colors
            "bg-slate-100 dark:bg-slate-800",
            "text-slate-900 dark:text-slate-100",
            "border border-slate-200 dark:border-slate-700",
            // Typography and spacing
            "px-1.5 py-0.5 rounded text-sm font-mono",
            // Subtle styling
            "ring-1 ring-slate-200/50 dark:ring-slate-700/50"
          )}>
            {children}
          </code>
        );
      }

      // Block code rendering - clean and simple
      const language = match?.[1] || 'text';

      return (
        <div className="relative my-4 rounded overflow-hidden bg-slate-50 dark:bg-slate-900">
          {/* Clean header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50">
            {/* Language indicator */}
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              {language === 'javascript' ? 'JavaScript' :
                language === 'typescript' ? 'TypeScript' :
                  language === 'html' ? 'HTML' :
                    language === 'css' ? 'CSS' :
                      language === 'python' ? 'Python' :
                        language === 'bash' ? 'Shell' :
                          language === 'json' ? 'JSON' :
                            language === 'sql' ? 'SQL' :
                              language}
            </span>

            {/* Copy button */}
            <button
              onClick={() => {
                copyToClipboard(value);
                setIsCodeCopied(true);
                setTimeout(() => setIsCodeCopied(false), 2000);
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded",
                "text-slate-600 dark:text-slate-400",
                "hover:text-slate-900 dark:hover:text-slate-100",
                "hover:bg-slate-200/50 dark:hover:bg-slate-700/50",
                "transition-colors duration-150",
                "focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
              )}
              aria-label="Copy code"
            >
              {isCodeCopied ? (
                <>
                  <Check className="h-3 w-3" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Simple code content - no line numbers */}
          <div className="relative">
            <pre className="p-4 text-sm leading-relaxed font-mono overflow-x-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
              <code className="block whitespace-pre">
                {value}
              </code>
            </pre>
          </div>
        </div>
      );
    }
  }), [isCodeCopied]);

  // Set up layout stabilization on initial render
  useEffect(() => {
    // Set layout as stabilized immediately to avoid animations on first render
    setLayoutStabilized(true);

    // Only set contentHeight if it's not already set
    if (contentRef.current && !contentHeight) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [contentHeight]);

  // Update content height when content changes, but only after initial render
  useEffect(() => {
    if (contentRef.current && layoutStabilized) {
      const height = contentRef.current.offsetHeight;
      // Always update height to ensure proper adjustment when text size changes
      setContentHeight(height);
    }
  }, [message.content, contentHeight, layoutStabilized, textSize, fontFamily]);

  // Clear content height when text size or font family changes to force recalculation
  useEffect(() => {
    setContentHeight(null);
  }, [textSize, fontFamily]);

  // Document-related type guards removed - no longer needed

  // Modified function to check for sources (web sources only)
  const hasAnySources = citationSources.length > 0;

  // --- MODIFIED: Process content parts, map results to calls ---
  const processMessageContent = useMemo(() => {
    const resultsMap = new Map<string, ToolResultPart>();
    // Use parts from messageContentParts which contains the extracted tool call
    const parts = messageContentParts.parts || [];

    // Clean any text parts to remove JSON artifacts
    parts.forEach(part => {
      if (part.type === 'text' && typeof part.text === 'string') {
        part.text = cleanToolCallMetadata(part.text);
      }
    });

    // Collect tool results for reference
    parts.forEach(part => {
      if (isToolResultPart(part)) {
        resultsMap.set(part.toolCallId, part);
      }
      // Add debug logging for all parts to help troubleshoot
      // Debug: Found part of specific type
    });

    // ----- FIX FOR MISSING TEXT PARTS -----
    // If we have tool calls and results but NO text parts, check the message
    // This handles when the API returns text after a tool execution
    // but it's not being processed as a separate part
    let hasToolCalls = parts.some(part => isToolCallPart(part) || isToolResultPart(part));

    // CRITICAL FIX: Check for approval in messageContentParts and manually add tool call if needed
    if (messageContentParts.requiresApproval && messageContentParts.toolCall) {
      console.log('[processMessageContent] Found approval required flag and toolCall');
      console.log('[processMessageContent] Checking if tool call is in parts:', {
        partsCount: parts.length,
        partTypes: parts.map(p => p.type),
        hasToolCall: parts.some(part => part.type === 'tool-call')
      });

      // Add the tool call to parts if it's not already there
      if (!parts.some(part => part.type === 'tool-call')) {
        console.log('[processMessageContent] Tool call not in parts, adding it:', messageContentParts.toolCall);
        parts.push(messageContentParts.toolCall);
        hasToolCalls = true;
      } else {
        console.log('[processMessageContent] Tool call already in parts');
      }
    }
    const hasTextParts = parts.some(part => part.type === 'text' && part.text.trim().length > 0);

    // Debug: Parts analysis - hasToolCalls and hasTextParts

    // If we have tool calls but no text parts
    if (hasToolCalls && !hasTextParts) {
      // Debug: Found tool calls without text parts, checking for API text

      // This is a new part that comes from the API response but might not be properly adding to the parts array
      if (message.role === 'assistant' && message.id !== 'streaming') {
        // Debug: Adding missing text part from API response

        // Extract text from raw message content using regex that matches the pattern we see
        // Looking for patterns like: "I found your most recent email..." followed by "isContinued":false}
        let extractedText = '';

        // Convert message content to string if it isn't already
        const contentStr = typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);

        // Debug: Raw content for extraction

        // Try to find the explanatory text portion using regex
        const textMatch = /I found your most recent email[^}"]*/.exec(contentStr);
        if (textMatch) {
          extractedText = textMatch[0];
          // Clean up the extracted text
          extractedText = extractedText
            .replace(/\\n/g, '\n')  // Convert escaped newlines
            .replace(/\\"/g, '"')   // Convert escaped quotes
            .trim();

          // Debug: Extracted text from content
        }

        // If we found text, add it as a new part
        if (extractedText) {
          // Clean any JSON artifacts from the extracted text
          extractedText = cleanToolCallMetadata(extractedText);

          const newTextPart: ContentPart = {
            type: 'text' as const,  // Use 'as const' to fix type issues
            text: extractedText
          };

          // Debug: Adding extracted text part

          // Create a new renderableParts array with the additional text part
          return {
            renderableParts: [...parts, newTextPart],
            toolResultsMap: resultsMap
          };
        }
      }
    }
    // ----- END FIX -----

    return {
      renderableParts: parts,
      toolResultsMap: resultsMap
    };
  }, [messageContentParts, message.role, message.id]);
  // --- END MODIFIED ---

  // Add these handlers for the McpToolBox
  const { toast } = useToast();

  const handleToolApprove = useCallback(async (toolCallId: string) => {
    // Debug: Tool approved
    try {
      // Show some feedback that we're processing
      toast({
        title: "Running tool...",
        description: "Processing the tool request",
        variant: "default"
      });

      const response = await fetch('/api/chat', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCallId,
          approved: true
        }),
      });

      // Try to parse the JSON response
      let responseData;
      try {
        responseData = await response.json();
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError);
        // If it's not JSON, get the text content
        const textContent = await response.text();
        responseData = { error: `Invalid JSON response: ${textContent}` };
      }

      if (!response.ok) {
        console.error('Failed to approve tool:', responseData);
        toast({
          title: "Tool execution failed",
          description: responseData.error || `Server returned status ${response.status}`,
          variant: "destructive"
        });
      } else {
        // Debug: Tool execution succeeded
        if (responseData.success) {
          toast({
            title: "Tool executed successfully",
            description: "The operation completed successfully",
            variant: "default"
          });
        } else {
          // Handle case where HTTP status is 200 but success is false
          toast({
            title: "Tool execution failed",
            description: responseData.error || "Unknown error occurred",
            variant: "destructive"
          });
        }
      }
    } catch (error) {
      console.error('Error approving tool:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to execute tool",
        variant: "destructive"
      });
    }
  }, [toast]);

  const handleToolCancel = useCallback(async (toolCallId: string) => {
    // Debug: Tool cancelled
    try {
      const response = await fetch('/api/chat', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCallId,
          approved: false
        }),
      });

      let responseData;
      try {
        responseData = await response.json();
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError);
        const textContent = await response.text();
        toast({
          title: "Invalid response",
          description: "Received invalid JSON response from server",
          variant: "destructive"
        });
        return;
      }

      if (!response.ok) {
        console.error('Failed to cancel tool:', responseData);
        toast({
          title: "Error",
          description: responseData.error || `Failed to cancel tool: ${response.statusText}`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Tool cancelled",
          description: "Operation cancelled successfully",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Error cancelling tool:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to cancel tool",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Main render
  return (
    <>
      <div
        className={cn(
          "w-full transition-all duration-500",
          layoutStabilized ? "opacity-100" : "opacity-0",
          isContentChanging ? "opacity-95" : "opacity-100",
          className
        )}
        ref={messageContainerRef}
        {...props}
      >
        <style dangerouslySetInnerHTML={{ __html: styles }} />

        <div className={cn(
          "max-w-5xl mx-auto flex gap-6 px-6 py-4",
          !isAI && "flex-row-reverse",
          isFirstMessage && "pt-20" // Add extra padding to first message
        )}>
          {isAI && (
            <div
              className={cn(
                "shrink-0 flex items-center justify-center rounded-full text-black dark:text-white",
                // Remove fixed border from className
                "bg-transparent transition-all duration-300" // Add transition
              )}
              style={{
                width: `${logoSizePx}px`,
                height: `${logoSizePx}px`,
                position: 'relative',
                // Position relative to the baseline of the first line
                top: (() => {
                  // Calculate position to align with first line of text (roughly h1 height / 2 - logo height / 2)
                  // These values are carefully tuned for each size to align with heading
                  if (logoSizePx <= 24) return '-1px';      // XS
                  if (logoSizePx <= 32) return '-2px';      // S
                  if (logoSizePx <= 40) return '-4px';      // M
                  if (logoSizePx <= 48) return '-7px';      // L
                  return '-10px';                           // XL
                })(),
                // Dynamic border that scales with logo size
                ...(showBorder ? {
                  borderWidth: `${Math.max(0.5, logoSizePx * 0.015)}px`, // Scale border with logo size
                  borderStyle: 'solid',
                  borderColor: 'var(--border-color, currentColor)'
                } : {}),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconOpenAI
                style={{
                  width: `${Math.max(Math.floor(logoSizePx * 0.6), 20)}px`,
                  height: `${Math.max(Math.floor(logoSizePx * 0.6), 20)}px`,
                  transition: 'all 0.3s ease', // Add transition
                  display: 'block', // Ensure block display
                  margin: '0 auto', // Center horizontally
                }}
              />
            </div>
          )}

          {isAI ? (
            (<div
              className={cn(
                "inline-block max-w-[95%] w-full chat-message",
                textSizeClasses[textSize].base,
                fontClasses[fontFamily],
                isLastMessage && "mb-8"
              )}
              style={{
                marginTop: '0px', // No margin needed since we're positioning the logo relatively
              }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}>
              <div
                className={cn(
                  "transition-all duration-500",
                  // Dynamic padding based on text size
                  textSize === 'small' ? 'pb-1' : textSize === 'large' ? 'pb-3' : 'pb-2',
                  // Dynamic minimum height based on text size
                  textSize === 'small' ? 'min-h-[30px]' : textSize === 'large' ? 'min-h-[50px]' : 'min-h-[40px]',
                  messageContent.containsToolResults && "pb-0"
                )}
                ref={contentRef}
                style={contentHeight ? { minHeight: `${contentHeight}px` } : undefined}
              >
                {isThinking ? (
                  <div className="flex items-center gap-2 h-full pt-3 ml-0.5">
                    {/* Check if we have specific loading text */}
                    {typeof message.content === 'string' && message.content === 'Generating image...' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-[#FF6417] dark:text-[#FF6417]" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Generating image...</span>
                      </>
                    ) : (
                      <>
                        <div className="animate-bounce-1">
                          <div className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400"></div>
                        </div>
                        <div className="animate-bounce-2">
                          <div className="h-2 w-2 rounded-full bg-yellow-500 dark:bg-yellow-400"></div>
                        </div>
                        <div className="animate-bounce-3">
                          <div className="h-2 w-2 rounded-full bg-orange-500 dark:bg-orange-400"></div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Render each content part */}
                    {/* [FIX] Render source_images TOP-FIRST for voice chats */}
                    {processMessageContent.renderableParts
                      .filter(p => p.type === 'source_images')
                      .map((part, i) => (
                        <div key={`top-source-images-${i}`} className="my-4 w-full max-w-2xl">
                          <SourceImagesGrid
                            images={(part as any).images || (part as any).source_images}
                            className="justify-start"
                          />
                        </div>
                      ))}


                    {processMessageContent.renderableParts.map((part: ContentPart, index: number) => {
                      // Debug log for ALL part types to help diagnose issues
                      // Debug: Rendering part type at index

                      // Handle text content FIRST - Ensure text always renders
                      if (part.type === 'text') {
                        return (
                          <TextPartRenderer
                            key={`text-part-${index}`}
                            part={part as ContentPart & { type: 'text' }}
                            index={index}
                            inlineSourcesEnabled={env.NEXT_PUBLIC_SHOW_SOURCES_ENABLED === 'true'}
                            markdownComponents={markdownComponents}
                            textSize={textSize}
                            fontFamily={fontFamily}
                            isAI={isAI}
                            isLastMessage={isLastMessage}
                            textSizeClasses={textSizeClasses}
                            fontClasses={fontClasses}
                            cleanToolCallMetadata={cleanToolCallMetadata}
                          />
                        );
                      }

                      // Handle generated images
                      if (part.type === 'generated_image') {
                        // Check for generated_images array first (our current format)
                        if (part.generated_images && Array.isArray(part.generated_images) && part.generated_images.length > 0) {
                          // Debug: Rendering generated_images array

                          // Only show the generated images, no source image or labels
                          return (
                            <div key={`image-${index}`} className="my-4">
                              {part.generated_images.map((imageUrl, imgIndex) => (
                                <GeneratedImage
                                  key={`generated-${imgIndex}`}
                                  imageUrl={imageUrl}
                                  index={imgIndex}
                                  aspectRatio={part.aspectRatio || '1:1'}
                                />
                              ))}
                            </div>
                          );
                        }

                        // Fallback to legacy formats
                        const imageUrl = part.url || (part.image_url ? part.image_url.url : null);
                        if (imageUrl) {
                          // Debug: Rendering legacy image format

                          // Only show the generated image, no source image or labels
                          return (
                            <div key={`image-${index}`} className="my-4">
                              <GeneratedImage
                                imageUrl={imageUrl}
                                index={index}
                                aspectRatio={part.aspectRatio || '1:1'}
                              />
                            </div>
                          );
                        }
                        return null;
                      }

                      // Handle RAG Source Images from tool_result (New Flow)
                      // We check for both 'tool_result' and 'tool-result' to cover SDK variations
                      // Cast to any to avoid strict type issues with the union type
                      if (((part as any).type === 'tool_result' || (part as any).type === 'tool-result') &&
                        (part as any).toolName === 'query_documents' &&
                        (part as any).result?.images?.length > 0) {
                        return (
                          <div key={`source-images-tool-${index}`}>
                            <SourceImagesGrid
                              images={(part as any).result.images}
                            />
                          </div>
                        );
                      }

                      // [FIX] Handle RAG Source Images from metadata usedDocuments
                      // When the backend sends documents with image_url in metadata parts
                      if ((part as any).type === 'metadata' && (part as any).usedDocuments) {
                        const imageDocuments = ((part as any).usedDocuments as any[])
                          .filter(doc => doc.image_url)
                          .map(doc => ({
                            name: doc.name || doc.filename || 'Source Image',
                            size: 0,
                            type: 'image/jpeg',
                            url: doc.image_url
                          }));

                        if (imageDocuments.length > 0) {
                          console.log('[ChatMessage] Rendering images from metadata usedDocuments:', imageDocuments.length);
                          return (
                            <div key={`metadata-images-${index}`}>
                              <SourceImagesGrid
                                images={imageDocuments}
                              />
                            </div>
                          );
                        }
                      }

                      // Handle source_images type parts (from user messages)
                      if (part.type === 'source_images' && part.source_images?.length > 0) {
                        return (
                          <div key={`source-images-${index}`}>
                            <SourceImagesGrid
                              images={part.source_images}
                            />
                          </div>
                        );
                      }

                      // Handle image_url type parts (from AI responses) - Enhanced handling
                      if (part.type === 'image_url' && part.image_url?.url) {
                        // Debug: Rendering image_url
                        return (
                          <div key={`image-url-${index}`} className="my-4">
                            <GeneratedImage
                              imageUrl={part.image_url.url}
                              index={index}
                              aspectRatio="1:1"
                            />
                          </div>
                        );
                      }

                      // Handle generated images array if it exists (legacy support)
                      if (index === 0 && messageContent.generatedImages && messageContent.generatedImages.length > 0) {
                        // Debug: Rendering generatedImages from array
                        return (
                          <React.Fragment key={`legacy-images`}>
                            {messageContent.generatedImages.map((imageUrl, imgIndex) => (
                              <div key={`legacy-image-${imgIndex}`} className="my-4">
                                <GeneratedImage imageUrl={imageUrl} index={imgIndex} aspectRatio="1:1" />
                              </div>
                            ))}
                          </React.Fragment>
                        );
                      }

                      // Handle tool calls
                      if (part.type === 'tool-call') {
                        // Debug: Processing tool-call
                        console.log('[ChatMessage] Processing tool-call:', {
                          toolName: part.toolName,
                          toolCallId: part.toolCallId,
                          hasArgs: !!part.args
                        });

                        // Find the associated result part
                        const resultPart = processMessageContent.renderableParts.find(p =>
                          p.type === 'tool-result' && (p as ToolResultPart).toolCallId === part.toolCallId
                        ) as ToolResultPart | undefined;

                        // Check if we have an approval-required error
                        const needsApproval = resultPart && isApprovalRequiredError(resultPart);

                        // Add extra logging for debugging the approval flow
                        if (needsApproval) {
                          console.log('[ChatMessage] Tool needs approval:', {
                            toolName: part.toolName,
                            hasResult: !!resultPart,
                            isError: resultPart?.isError
                          });
                        }

                        // Use a stable explanation text to prevent unnecessary re-renders
                        const stableExplanationText = needsApproval ? 'This tool requires your explicit approval before it can run.' : undefined;

                        // Always render the tool invocation component for tools regardless of error status
                        return (
                          <ToolInvocation
                            key={part.toolCallId || index}
                            toolCall={part}
                            toolResult={resultPart}
                            requireExplicitApproval={!(env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true')}
                            explanationText={stableExplanationText}
                            sessionId={sessionId}
                          />
                        );
                      }

                      // Handle source images from RAG
                      if (part.type === 'source_images') {
                        // Handled at the top of the render function to ensure images display first
                        return null;
                      }

                      // Handle tool results explicitly (don't render them directly here)
                      if (isToolResultPart(part)) {
                        // No direct rendering needed, handled by ToolInvocation
                        return null;
                      }

                      // Handle generated videos
                      if (part.type === 'generated_video') {
                        const videoUrl = part.video_url || part.url;
                        if (videoUrl) {
                          // Debug: Rendering generated video
                          return (
                            <div key={`video-${index}`} className="my-4">
                              <GeneratedVideo
                                videoUrl={videoUrl}
                                index={index}
                                isLocalBlob={part.isLocalBlob}
                              />
                            </div>
                          );
                        }
                        return null;
                      }

                      // Handle loading video placeholders
                      if (part.type === 'loading_video') {
                        return (
                          <div key={`loading-video-${index}`} className="my-4">
                            <LoadingVideo
                              id={part.id}
                              progress={part.progress}
                              aspectRatio={part.aspectRatio}
                              resolution={part.resolution}
                              status={part.status}
                              frameCount={part.frameCount}
                            />
                          </div>
                        );
                      }

                      // Handle generated 3D models
                      if (part.type === 'generated_3d_model') {
                        const modelUrl = part.url || part.model_url;
                        if (modelUrl) {
                          // Debug: Rendering generated 3D model
                          return (
                            <div key={`model-${index}`} className="my-4">
                              <ModelViewer modelUrl={modelUrl} />
                            </div>
                          );
                        }
                        return null;
                      }

                      // Handle loading 3D model placeholders
                      if (part.type === 'loading_3d_model') {
                        return (
                          <div key={`loading-model-${index}`} className="my-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                            <Loader2 className="animate-spin w-4 h-4" />
                            <span>{part.status || 'Generating 3D model...'}</span>
                          </div>
                        );
                      }

                      // Handle loading image placeholders
                      if (part.type === 'loading_image') {
                        // Check if we have an error status that indicates moderation failure
                        const isErrorStatus = !!(part.status && (
                          part.status.toLowerCase().includes('error') ||
                          part.status.toLowerCase().includes('blocked') ||
                          part.status.toLowerCase().includes('failed') ||
                          part.status.toLowerCase().includes('safety')
                        ));

                        return (
                          <div key={`loading-image-${index}`} className="my-4">
                            <LoadingImage
                              id={part.id}
                              progress={part.progress}
                              prompt={part.prompt}
                              aspectRatio={part.aspectRatio}
                              count={part.count}
                              total={part.total}
                              status={part.status}
                              isError={isErrorStatus}
                            />
                          </div>
                        );
                      }
                    })}
                    {/* End parts mapping */}
                  </>
                )}

                {/* Reasoning Section */}
                {isAI && reasoningContent && (
                  <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowReasoning(!showReasoning)}
                      className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      <Brain className="h-4 w-4" />
                      <span>Reasoning</span>
                      {showReasoning ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>

                    {showReasoning && (
                      <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
                        <div className="prose dark:prose-invert prose-sm max-w-none text-gray-700 dark:text-gray-300">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {reasoningContent}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Copy and audio buttons for AI messages */}
              {(() => {
                // Log the state right before rendering the button area
                // Debug: Render check with conditions

                if (isAI && messageContent.text && !isThinking && !isStreamingMessage) {
                  return (
                    <>
                      {/* Sources Button - Only show when relevant */}
                      <SourcesButtonContainer messageContent={messageContent} isLastMessage={isLastMessage} />
                      {/* Existing Action Buttons */}
                      <div
                        className={cn(
                          "flex items-center transition-opacity duration-200",
                          fontSpacingConfig[fontFamily]?.gap || 'gap-1.5',
                          fontSpacingConfig[fontFamily]?.marginTop || '',
                          isLastMessage ? "opacity-100" : (isHovered ? "opacity-100" : "opacity-0")
                        )}
                      >
                        <CopyButton
                          onClick={handleCopy}
                          isCopied={isCopied}
                          tooltipText={t('copyTooltip')}
                        />

                        {/* Speak button - only show if TTS is not disabled (allow showing while loading settings to reserve space) */}
                        {(audioSettings.loading || !audioSettings.ttsDisabled) && (
                          <div className="relative" style={{ position: 'relative' }}>
                            <button
                              ref={speakButtonRef}
                              onClick={handleTextToSpeech}
                              // Disable if TTS is playing (loading audio) OR if settings are initializing
                              disabled={audioState.isLoading || audioSettings.loading}
                              className={cn(
                                "flex items-center justify-center w-8 h-8 text-gray-700 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors",
                                // Only apply opacity for active TTS loading (bouncing dots), NOT initial settings load
                                audioState.isLoading && "opacity-70 cursor-wait",
                                // Just applying cursor-wait for initial load
                                audioSettings.loading && "cursor-wait",
                                audioState.isPlaying && "text-[#FF6417] dark:text-[#E6E6E6]"
                              )}
                              aria-label={audioState.isLoading ? "Loading..." : audioState.isPlaying ? "Stop" : "Play text to speech"}
                              onMouseEnter={() => setTooltipIfNotTouch(setShowAISpeakTooltip, true)}
                              onMouseLeave={() => setShowAISpeakTooltip(false)}
                              onFocus={() => setTooltipIfNotTouch(setShowAISpeakTooltip, true)}
                              onBlur={() => setShowAISpeakTooltip(false)}
                            >
                              {/* Show bouncing dots only for active TTS fetching (audioState.isLoading) */}
                              {/* audioSettings.loading falls through to the default icon */}
                              {audioState.isLoading ? (
                                <div className="flex items-center gap-1">
                                  <div className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                  <div className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                  <div className="w-1 h-1 bg-current rounded-full animate-bounce"></div>
                                </div>
                              ) : (
                                <AudioLines className={cn(
                                  "h-4 w-4",
                                  audioState.isPlaying && "animate-pulse"
                                )} />
                              )}
                            </button>
                            {!isTouchDevice && showAISpeakTooltip && (
                              <Tooltip
                                content={audioState.isLoading ? "Loading..." : audioState.isPlaying ? "Stop" : t('textToSpeechTooltip')}
                                show={showAISpeakTooltip}
                                position="bottom"
                                anchorElement={speakButtonRef.current}
                              />
                            )}
                          </div>
                        )}

                        {/* PDF Download Button */}
                        <div className="relative" style={{ position: 'relative' }}>
                          <button
                            ref={pdfButtonRef}
                            onClick={() => {
                              // Pass the full text content to preserve markdown formatting
                              let textToDownload = '';
                              if (typeof message.content === 'string') {
                                textToDownload = message.content;
                              } else if (Array.isArray(message.content)) {
                                const textPart = (message.content as ContentPart[]).find((part: ContentPart) => part.type === 'text');
                                textToDownload = textPart?.text || '';
                              }
                              // Clean the text before generating PDF
                              textToDownload = cleanToolCallMetadata(textToDownload);
                              downloadMessageAsPDF(message.role as 'user' | 'assistant', textToDownload);
                            }}
                            className={cn(
                              "flex items-center justify-center w-8 h-8 text-gray-700 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors"
                            )}
                            aria-label="Download as PDF"
                            onMouseEnter={() => setTooltipIfNotTouch(setShowPDFTooltip, true)}
                            onMouseLeave={() => setShowPDFTooltip(false)}
                            onFocus={() => setTooltipIfNotTouch(setShowPDFTooltip, true)}
                            onBlur={() => setShowPDFTooltip(false)}
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                          {!isTouchDevice && showPDFTooltip && (
                            <Tooltip
                              content={t('downloadPdfTooltip')}
                              show={showPDFTooltip}
                              position="bottom"
                              anchorElement={pdfButtonRef.current}
                            />
                          )}
                        </div>

                        {/* Send to RAG Button */}
                        <div className="relative" style={{ position: 'relative' }}>
                          <button
                            ref={ragButtonRef}
                            onClick={handleSendToRAG}
                            disabled={isSendingToRAG}
                            className={cn(
                              "flex items-center justify-center w-8 h-8 text-gray-700 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors",
                              isSendingToRAG && "opacity-70 cursor-wait"
                            )}
                            aria-label="Send to knowledge base"
                            onMouseEnter={() => setTooltipIfNotTouch(setShowRAGTooltip, true)}
                            onMouseLeave={() => setShowRAGTooltip(false)}
                            onFocus={() => setTooltipIfNotTouch(setShowRAGTooltip, true)}
                            onBlur={() => setShowRAGTooltip(false)}
                          >
                            {isSendingToRAG ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Database className="h-4 w-4" />
                            )}
                          </button>
                          {!isTouchDevice && showRAGTooltip && (
                            <Tooltip
                              content={t('sendToKnowledgeBase')}
                              show={showRAGTooltip}
                              position="bottom"
                              anchorElement={ragButtonRef.current}
                            />
                          )}
                        </div>

                        {/* Add preview button for previewable code */}
                        {(() => {
                          // Check if the message contains previewable code
                          const codeBlockMatch = messageContent.text.match(/```(\w+)([\s\S]*?)```/);
                          if (codeBlockMatch) {
                            const [, language, code] = codeBlockMatch;
                            const isPreviewable = ['html', 'css', 'svg', 'jsx', 'tsx', 'javascript', 'js'].includes(language);
                            if (isPreviewable) {
                              return (
                                <div className="relative">
                                  <button
                                    ref={previewButtonRef}
                                    onClick={() => openArtifact(code.trim(), language as any)}
                                    className="flex items-center justify-center w-8 h-8 text-gray-700 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors"
                                    onMouseEnter={() => setTooltipIfNotTouch(setShowPreviewTooltip, true)}
                                    onMouseLeave={() => setShowPreviewTooltip(false)}
                                    onFocus={() => setTooltipIfNotTouch(setShowPreviewTooltip, true)}
                                    onBlur={() => setShowPreviewTooltip(false)}
                                  >
                                    <Play className="h-4 w-4" />
                                  </button>
                                  {!isTouchDevice && showPreviewTooltip && (
                                    <Tooltip
                                      content="Run code in real-time"
                                      show={showPreviewTooltip}
                                      position="bottom"
                                      anchorElement={previewButtonRef.current}
                                    />
                                  )}
                                </div>
                              );
                            }
                          }
                          return null;
                        })() as React.ReactNode}

                        {/* Audio download options */}
                        {isAudioCached(prepareTextForTTS(cleanToolCallMetadata(messageContent.text))) && !audioState.isPlaying && !audioState.isLoading && (
                          <div className="relative" style={{ position: 'relative' }}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  ref={optionsButtonRef}
                                  className="dropdown-trigger flex items-center justify-center w-6 h-8 text-gray-700 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors"
                                  onMouseEnter={() => setShowAIOptionsTooltip(true)}
                                  onMouseLeave={() => setShowAIOptionsTooltip(false)}
                                  onFocus={() => setShowAIOptionsTooltip(true)}
                                  onBlur={() => setShowAIOptionsTooltip(false)}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-32 bg-[#FFF0E8] dark:bg-[#2F2F2F] rounded-xl shadow-lg p-1"
                              >
                                <DropdownMenuItem
                                  onClick={handleDownloadAudio}
                                  className="flex items-center gap-2 cursor-pointer px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-colors"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span>Download</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {showAIOptionsTooltip && (
                              <Tooltip
                                content="Options"
                                show={showAIOptionsTooltip}
                                position="bottom"
                                anchorElement={optionsButtonRef.current}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  );
                }
                return null;
              })()}
            </div>) // Closing div for the AI message content area
          ) : (
            // User message
            (<div
              className="flex flex-col items-end gap-2"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              {/* Handle content array (multi-part messages) */}
              {Array.isArray(message.content) ? (
                message.content.map((part, index) => {
                  if (part.type === 'source_images') {
                    const imagesToDisplay = part.images || part.source_images;
                    if (imagesToDisplay && imagesToDisplay.length > 0) {
                      return (
                        <div key={`source-images-${index}`} className="mb-0 w-full max-w-2xl">
                          <SourceImagesGrid
                            images={imagesToDisplay}
                            className="justify-end"
                          />
                        </div>
                      );
                    }
                    return null;
                  }
                  // 🔧 FIX: Display image_url type parts (uploaded images from chat input)
                  if (part.type === 'image_url' && part.image_url?.url) {
                    return (
                      <div key={`user-image-${index}`} className="mb-2 w-full max-w-2xl flex justify-end">
                        <img
                          src={part.image_url.url}
                          alt="Attached image"
                          className="rounded-lg max-h-[300px] w-auto object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setShowUserImageModal(true)}
                        />
                      </div>
                    );
                  }
                  return null;
                })
              ) : (
                // Legacy single image display (backward compatibility)
                (messageContent.imageUrl && (<div className="mb-0 w-full max-w-2xl">
                  <img
                    src={messageContent.imageUrl}
                    alt="Attached content"
                    className="rounded-lg max-h-[400px] w-auto object-contain float-right cursor-pointer hover:opacity-90 transition-opacity"
                    onLoad={() => setIsImageLoaded(true)}
                    onClick={() => setShowUserImageModal(true)}
                    ref={imageRef}
                  />
                </div>))
              )}
              <div className="flex flex-row-reverse items-center gap-2">
                {/* User message bubble */}
                <div className={cn(
                  "inline-block overflow-hidden max-w-none chat-message",
                  isLastMessage && "mb-4",
                  "bg-[#EFE1D5] dark:bg-[#303030] rounded-[20px] px-4 py-2",
                  textSizeClasses[textSize].base,
                  fontClasses[fontFamily]
                )}>
                  <div className="flex items-center justify-center min-h-[1.5rem] w-full">
                    {/* Extract text from content array or use simple text */}
                    {(() => {
                      const textContent = Array.isArray(message.content)
                        ? message.content.find(part => part.type === 'text')?.text || ''
                        : messageContent.text || '';

                      return textContent && textContent.includes('@') ? (
                        <div
                          className={cn(
                            "react-markdown prose dark:prose-invert max-w-none",
                            textSizeClasses[textSize].base,
                            fontClasses[fontFamily] || '',
                            "prose-p:my-0 leading-normal"
                          )}
                          dangerouslySetInnerHTML={{ __html: highlightDocumentMentions(textContent) }}
                        />
                      ) : (
                        <div className={cn(
                          "break-words text-gray-700 dark:text-gray-300",
                          textSizeClasses[textSize].base,
                          fontClasses[fontFamily] || '',
                          "leading-normal"
                        )}>
                          {textContent}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Copy and audio buttons for user messages */}
                {(() => {
                  const textContent = Array.isArray(message.content)
                    ? message.content.find(part => part.type === 'text')?.text || ''
                    : messageContent.text || '';
                  return textContent && !isStreamingMessage;
                })() && (
                    <div
                      className={cn(
                        "flex items-center transition-opacity duration-200",
                        fontSpacingConfig[fontFamily]?.gap || 'gap-1.5',
                        fontSpacingConfig[fontFamily]?.marginTop || '',
                        isLastMessage ? "opacity-100" : (isHovered ? "opacity-100" : "opacity-0")
                      )}
                    >
                      <CopyButton
                        onClick={handleCopy}
                        isCopied={isCopied}
                        tooltipText={t('copyTooltip')}
                      />

                      {!audioSettings.loading && !audioSettings.ttsDisabled && (
                        <div className="relative" style={{ position: 'relative' }}>
                          <button
                            ref={userSpeakButtonRef}
                            onClick={handleTextToSpeech}
                            disabled={audioState.isLoading}
                            className={cn(
                              "flex items-center justify-center w-7 h-7 text-gray-600 dark:text-gray-400 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] hover:text-gray-700 dark:hover:text-gray-200 rounded-md transition-colors",
                              audioState.isLoading && "opacity-70 cursor-wait",
                              audioState.isPlaying && "text-[#FF6417] dark:text-[#E6E6E6]"
                            )}
                            aria-label={audioState.isLoading ? "Loading..." : audioState.isPlaying ? "Stop" : "Play text to speech"}
                            onMouseEnter={() => setTooltipIfNotTouch(setShowUserSpeakTooltip, true)}
                            onMouseLeave={() => setShowUserSpeakTooltip(false)}
                            onFocus={() => setTooltipIfNotTouch(setShowUserSpeakTooltip, true)}
                            onBlur={() => setShowUserSpeakTooltip(false)}
                          >
                            <AudioLines className="h-3.5 w-3.5" />
                          </button>
                          {!isTouchDevice && showUserSpeakTooltip && (
                            <Tooltip
                              content={audioState.isLoading ? "Loading..." : audioState.isPlaying ? "Stop" : t('textToSpeechTooltip')}
                              show={showUserSpeakTooltip}
                              position="top"
                              anchorElement={userSpeakButtonRef.current}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>)
          )}
        </div>
      </div>
      {/* User Image Modal */}
      {messageContent.imageUrl && (
        <ImageModal
          src={messageContent.imageUrl}
          alt="User uploaded image"
          isOpen={showUserImageModal}
          onClose={() => setShowUserImageModal(false)}
          showDownload={true}
        />
      )}
    </>
  );
}

// Custom hook to get border setting
function useAvatarBorder() {
  const [showBorder, setShowBorder] = useState(true);

  useEffect(() => {
    // Function to fetch the border setting
    const fetchBorderSetting = async () => {
      try {
        // Debug: Fetching border setting

        const savedSetting = localStorage.getItem('AI_RESPONSE_LOGO_BORDER');
        // Debug: localStorage border value

        if (savedSetting !== null) {
          const parsedValue = savedSetting === 'true';
          // Debug: Using localStorage border value
          setShowBorder(parsedValue);
        }

        try {
          // REMOVED cache-busting timestamp
          const apiUrl = `/api/config/get-logo?type=ai`;
          // Debug: Fetching border setting from API

          // REMOVED cache: 'no-store' and headers
          const response = await fetch(apiUrl);

          if (response.ok) {
            const apiData = await response.json();
            // Debug: Border setting API response

            if (apiData.showBorder !== undefined) {
              // Debug: Setting border value from API
              setShowBorder(apiData.showBorder);
              localStorage.setItem('AI_RESPONSE_LOGO_BORDER', String(apiData.showBorder));
              // Debug: Updated localStorage with border value
            } else {
              console.warn('[useAvatarBorder] API response missing showBorder property');
            }
          } else {
            console.warn('[useAvatarBorder] API returned error status:', response.status);
          }
        } catch (apiError) {
          console.error('[useAvatarBorder] API fetch error:', apiError);
        }
      } catch (error) {
        console.error('[useAvatarBorder] Error in fetchBorderSetting:', error);
      }
    };

    // Fetch immediately on mount
    fetchBorderSetting();

    // REMOVED polling interval
    // const intervalId = setInterval(fetchBorderSetting, 3000);

    // REMOVED Cleanup for interval
    // return () => clearInterval(intervalId);
  }, []); // Empty dependency array ensures this runs only once on mount

  return showBorder;
}

// Custom hook to get avatar settings (border and size)
function useAvatarSettings() {
  const [showBorder, setShowBorder] = useState(true);
  const [logoSize, setLogoSize] = useState(3); // Default to medium (3)

  useEffect(() => {
    // Function to fetch the avatar settings
    const fetchAvatarSettings = async () => {
      try {
        // First, check localStorage for cached values
        const savedBorder = localStorage.getItem('AI_RESPONSE_LOGO_BORDER');
        const savedSize = localStorage.getItem('AI_RESPONSE_LOGO_SIZE');

        if (savedBorder !== null) {
          setShowBorder(savedBorder === 'true');
        }

        if (savedSize !== null) {
          const parsedSize = parseInt(savedSize);
          if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 5) {
            setLogoSize(parsedSize);
          }
        }

        // Then fetch from API to get the latest values from environment variables
        try {
          const apiUrl = `/api/config/get-logo?type=ai`;
          const response = await fetch(apiUrl);

          if (response.ok) {
            const apiData = await response.json();
            console.log('[useAvatarSettings] Received API data:', apiData);

            if (apiData.showBorder !== undefined) {
              setShowBorder(apiData.showBorder);
              localStorage.setItem('AI_RESPONSE_LOGO_BORDER', String(apiData.showBorder));
            }

            if (apiData.logoSize !== undefined) {
              const parsedSize = parseInt(apiData.logoSize);
              if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 5) {
                setLogoSize(parsedSize);
                localStorage.setItem('AI_RESPONSE_LOGO_SIZE', String(parsedSize));
              }
            }
          } else {
            console.warn('[useAvatarSettings] API returned error status:', response.status);
          }
        } catch (apiError) {
          console.error('[useAvatarSettings] API fetch error:', apiError);
        }
      } catch (error) {
        console.error('[useAvatarSettings] Error fetching settings:', error);
      }
    };

    // Function to handle localStorage changes from other tabs/windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'AI_RESPONSE_LOGO_BORDER' && e.newValue !== null) {
        setShowBorder(e.newValue === 'true');
      } else if (e.key === 'AI_RESPONSE_LOGO_SIZE' && e.newValue !== null) {
        const parsedSize = parseInt(e.newValue);
        if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 5) {
          setLogoSize(parsedSize);
        }
      }
    };

    // Initial fetch
    fetchAvatarSettings();

    // Listen for storage changes
    window.addEventListener('storage', handleStorageChange);

    // Also listen for BroadcastChannel messages for real-time updates
    try {
      const bc = new BroadcastChannel('chatrag-config');
      bc.onmessage = (event) => {
        if (event.data.key === 'AI_RESPONSE_LOGO_BORDER') {
          const newValue = event.data.value === 'true';
          setShowBorder(newValue);
        } else if (event.data.key === 'AI_RESPONSE_LOGO_SIZE') {
          const parsedSize = parseInt(event.data.value);
          if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 5) {
            setLogoSize(parsedSize);
          }
        }
      };

      return () => {
        bc.close();
        window.removeEventListener('storage', handleStorageChange);
      };
    } catch (err) {
      // BroadcastChannel might not be supported in all browsers
      return () => {
        window.removeEventListener('storage', handleStorageChange);
      };
    }
  }, []);

  // Convert the numerical size to actual pixel value
  const logoSizePx = useMemo(() => {
    const sizeMappings = {
      1: 28, // Extra small
      2: 32, // Small
      3: 36, // Medium (default)
      4: 40, // Large
      5: 44  // Extra large
    };
    return sizeMappings[logoSize as keyof typeof sizeMappings] || 36;
  }, [logoSize]);

  return { showBorder, logoSizePx };
}

// After the isDocumentQueryResult function and before useAvatarBorder

// Function to determine if a message consists only of tool results with no significant text content
const isToolOnlyMessage = (parts: ContentPart[]): boolean => {
  // Check if there are tool call/result parts
  const hasToolParts = parts.some(part => isToolCallPart(part) || isToolResultPart(part));

  // Check if there are any substantive text parts
  const hasTextContent = parts.some(part =>
    part.type === 'text' &&
    part.text.trim().length > 0 &&
    !part.text.includes('"isContinued"') && // Filter out tool call JSON remnants
    !part.text.includes('"toolCallId"')
  );

  // If we have tool parts but no substantive text, it's a tool-only message
  return hasToolParts && !hasTextContent;
};

// Function to extract links from tool results
const extractToolLinks = (parts: ContentPart[]): Source[] => {
  const toolLinks: Source[] = [];

  // Find all tool result parts
  const toolResultParts = parts.filter(part => isToolResultPart(part)) as ToolResultPart[];
  if (process.env.NODE_ENV === 'development') {
    console.log('[Sources][ToolLinks] Tool result parts:', toolResultParts.map(part => ({
      toolName: (part as any).toolName,
      toolCallId: (part as any).toolCallId,
      resultType: typeof (part as any).result,
      resultKeys: (part as any).result && typeof (part as any).result === 'object'
        ? Object.keys((part as any).result as object)
        : [],
      outputType: typeof (part as any).output,
      outputKeys: (part as any).output && typeof (part as any).output === 'object'
        ? Object.keys((part as any).output as object)
        : [],
      outputValueKeys: (part as any).output && typeof (part as any).output === 'object' && 'value' in (part as any).output
        ? Object.keys(((part as any).output as any).value || {})
        : []
    })));
  }

  for (const part of toolResultParts) {
    const toolName = part.toolName || '';
    let title = '';
    let url = '';
    let provider = '';
    let snippet = '';

    // Extract relevant information based on the tool type
    if (toolName === 'webSearch') {
      const rawPayload = (part.output ?? part.result) as any;
      const normalizedPayload = rawPayload && typeof rawPayload === 'object' && 'value' in rawPayload
        ? rawPayload.value
        : rawPayload;
      if (normalizedPayload && typeof normalizedPayload === 'object') {
        const result = normalizedPayload as any;
        const items = Array.isArray(result)
          ? result
          : Array.isArray(result.results)
            ? result.results
            : Array.isArray(result.items)
              ? result.items
              : [];

        if (process.env.NODE_ENV === 'development') {
          console.log('[Sources][ToolLinks] webSearch items:', items.length);
        }

        for (const item of items) {
          if (!item || !item.url) continue;
          const itemTitle = item.title || item.url;
          const itemSnippet = (item.content || item.text || item.snippet || item.description || '').toString();
          let itemProvider = 'Web Search';
          let itemFavicon: string | undefined;

          try {
            const urlObj = new URL(item.url);
            itemProvider = urlObj.hostname.replace('www.', '');
            itemFavicon = `${urlObj.origin}/favicon.ico`;
          } catch (error) {
            itemProvider = 'Web Search';
          }

          toolLinks.push({
            title: itemTitle,
            url: item.url,
            provider: itemProvider,
            snippet: itemSnippet.length > 200 ? `${itemSnippet.substring(0, 200)}...` : itemSnippet,
            type: 'web',
            toolName,
            toolResultId: part.toolCallId,
            date: item.publishedDate,
            favicon: itemFavicon
          });
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.log('[Sources][ToolLinks] webSearch result missing or not object');
      }
    } else if (toolName.includes('gmail')) {
      // Gmail tool - extract messageId, threadId, etc.
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        if (result.messages && result.messages.length > 0) {
          const message = result.messages[0];
          title = message.subject || 'Email Thread';
          // For Gmail, we can construct a URL to the thread
          if (message.threadId) {
            url = `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`;
            provider = 'Gmail';
            snippet = message.snippet || '';
          }
        } else if (result.id || result.threadId) {
          title = result.subject || 'Email Thread';
          url = `https://mail.google.com/mail/u/0/#inbox/${result.threadId || result.id}`;
          provider = 'Gmail';
          snippet = result.snippet || '';
        }
      }
    } else if (toolName.includes('calendar')) {
      // Google Calendar tool
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        if (result.htmlLink) {
          title = result.summary || 'Calendar Event';
          url = result.htmlLink;
          provider = 'Google Calendar';

          // Create a more detailed snippet with event details
          const start = result.start?.dateTime || result.start?.date;
          const end = result.end?.dateTime || result.end?.date;
          let eventDetails = '';

          if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            eventDetails = `${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}`;
          }

          // Add location if available
          if (result.location) {
            eventDetails += `\nLocation: ${result.location}`;
          }

          // Add description if available (truncated)
          if (result.description) {
            const truncatedDesc = result.description.length > 150
              ? result.description.substring(0, 150) + '...'
              : result.description;
            eventDetails += `\n${truncatedDesc}`;
          }

          snippet = eventDetails;
        } else if (Array.isArray(result.items) && result.items.length > 0) {
          const event = result.items[0];
          title = event.summary || 'Calendar Event';
          url = event.htmlLink;
          provider = 'Google Calendar';

          // Create a more detailed snippet with event details
          const start = event.start?.dateTime || event.start?.date;
          const end = event.end?.dateTime || event.end?.date;
          let eventDetails = '';

          if (start && end) {
            const startDate = new Date(start);
            const endDate = new Date(end);
            eventDetails = `${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}`;
          }

          // Add location if available
          if (event.location) {
            eventDetails += `\nLocation: ${event.location}`;
          }

          // Add description if available (truncated)
          if (event.description) {
            const truncatedDesc = event.description.length > 150
              ? event.description.substring(0, 150) + '...'
              : event.description;
            eventDetails += `\n${truncatedDesc}`;
          }

          snippet = eventDetails;
        }
      }
    } else if (toolName.includes('github')) {
      // GitHub tool
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        if (result.html_url) {
          title = result.name || result.full_name || 'GitHub Repository';
          url = result.html_url;
          provider = 'GitHub';

          // Create a more detailed snippet
          let repoDetails = '';
          if (result.description) {
            repoDetails = result.description;
          }

          // Add stars and forks if available
          if (result.stargazers_count !== undefined) {
            repoDetails += `\n⭐ ${result.stargazers_count} stars`;
          }

          if (result.forks_count !== undefined) {
            repoDetails += `\n🍴 ${result.forks_count} forks`;
          }

          snippet = repoDetails;
        }
      }
    } else if (toolName.includes('brave')) {
      // Extract URLs from Brave search results
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        if (Array.isArray(result)) {
          // For the first result item only (to avoid cluttering)
          const firstResult = result[0];
          if (firstResult && firstResult.url) {
            title = firstResult.title || 'Search Result';
            url = firstResult.url;
            provider = 'Brave Search';
            snippet = firstResult.description || '';
          }
        } else if (result.results && Array.isArray(result.results)) {
          // For the first result item only
          const firstResult = result.results[0];
          if (firstResult && firstResult.url) {
            title = firstResult.title || 'Search Result';
            url = firstResult.url;
            provider = 'Brave Search';
            snippet = firstResult.description || '';
          }
        }
      }
    } else if (toolName.includes('whatsapp')) {
      // WhatsApp tool
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        if (result.to_number) {
          title = `WhatsApp Message to ${result.to_number}`;
          // No direct URL available for WhatsApp messages
          url = 'https://web.whatsapp.com/';
          provider = 'WhatsApp';
          snippet = result.text || '';
        }
      }
    } else if (toolName.includes('zapier') || toolName.includes('mcp')) {
      // Generic handling for other MCP/Zapier tools
      if (part.result && typeof part.result === 'object') {
        const result = part.result as any;

        // Try to extract a URL if available
        const possibleUrl = result.url || result.link || result.html_url || '';
        if (possibleUrl && typeof possibleUrl === 'string' && possibleUrl.startsWith('http')) {
          url = possibleUrl;
        }

        // Get a descriptive title
        title = result.name || result.title || result.summary || `${toolName} Result`;
        provider = toolName.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

        // Extract some content as snippet
        if (result.description) {
          snippet = result.description;
        } else if (result.content) {
          snippet = result.content;
        } else if (result.text) {
          snippet = result.text;
        } else if (typeof result === 'object') {
          // Create a readable summary of the object properties
          const properties = Object.entries(result)
            .filter(([key, value]) =>
              typeof value !== 'object' &&
              key !== 'id' &&
              key !== 'url' &&
              key !== 'link'
            )
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');

          if (properties) {
            snippet = properties;
          }
        }
      }
    }

    // If we found a valid URL, add it to our links
    if (url) {
      toolLinks.push({
        title,
        url,
        provider,
        snippet,
        type: 'tool_link',
        toolName,
        toolResultId: part.toolCallId
      });
    }
  }

  // Also scan text parts for links with "here" anchor text - these are often tool-related links
  const textParts = parts.filter(part => part.type === 'text') as { type: 'text', text: string }[];

  for (const part of textParts) {
    // Check the full text for event title first, using a more precise regex
    let eventTitle = '';

    // More robust regex to capture titles within quotes, handling escaped quotes
    const eventTitleRegex = /event titled \"([^\"]*(?:\\.[^\"]*)*)\"/i;
    const titleMatch = part.text.match(eventTitleRegex);
    if (titleMatch && titleMatch[1]) {
      // Clean up escaped quotes if any
      eventTitle = titleMatch[1].replace(/\\"/g, '"');
      // Debug: Found event title in text
    }

    // Look for markdown links with "here" as the anchor text
    const hereLinks = part.text.match(/\[here\]\((https?:\/\/[^\s)]+)\)/g);

    if (hereLinks) {
      for (const linkMatch of hereLinks) {
        const urlMatch = linkMatch.match(/\[here\]\((https?:\/\/[^\s)]+)\)/);
        if (urlMatch && urlMatch[1]) {
          const url = urlMatch[1];

          // Use the extracted eventTitle if available and the URL is for Google Calendar
          let title = (url.includes('calendar.google.com') || url.includes('google.com/calendar')) && eventTitle ? eventTitle : '';
          let provider = '';

          if (url.includes('calendar.google.com') || url.includes('google.com/calendar')) {
            provider = 'Google Calendar';
            // If we couldn't extract the title from the text, use a default
            if (!title) {
              title = 'Calendar Event';
            }
          } else {
            // For other links, extract domain or set based on common domains
            try {
              const urlObj = new URL(url);
              // Only use domain as title if we don't have an event title
              if (!title) {
                title = urlObj.hostname.replace('www.', '');
              }

              // Check for common domains and provide better titles/providers
              if (urlObj.hostname.includes('github.com')) {
                provider = 'GitHub';
                if (!eventTitle) { // Only update title if not an event title
                  const pathParts = urlObj.pathname.split('/').filter(Boolean);
                  if (pathParts.length >= 2) {
                    title = `${pathParts[0]}/${pathParts[1]} Repository`;
                  } else {
                    title = 'GitHub Repository';
                  }
                }
              } else if (urlObj.hostname.includes('google.com')) {
                provider = 'Google';
                if (!eventTitle) { // Only update title if not an event title
                  if (urlObj.pathname.includes('/docs/')) {
                    title = 'Google Document';
                  } else if (urlObj.pathname.includes('/sheets/')) {
                    title = 'Google Spreadsheet';
                  } else if (urlObj.pathname.includes('/slides/')) {
                    title = 'Google Presentation';
                  } else if (urlObj.pathname.includes('/forms/')) {
                    title = 'Google Form';
                  } else {
                    title = 'Google Service';
                  }
                }
              } else {
                // Use hostname as provider
                provider = urlObj.hostname.replace('www.', '').split('.')[0];
                provider = provider.charAt(0).toUpperCase() + provider.slice(1); // Capitalize
                if (!eventTitle) { // Only update title if not an event title
                  title = 'Link to ' + provider;
                }
              }
            } catch (e) {
              // If URL parsing fails, use generic values
              if (!title) {
                title = 'External Link';
              }
              provider = 'Website';
            }
          }

          // Debug: Adding tool link with title

          toolLinks.push({
            title,
            url,
            provider,
            snippet: '',
            type: 'tool_link',
            toolName: 'inline_link'
          });
        }
      }
    }
  }

  return toolLinks;
};

// Add a new component for the Sources button just before the ChatMessage component
function SourcesButtonContainer({ messageContent, isLastMessage }: { messageContent: any, isLastMessage: boolean }) {
  const { sources, setSources, hasAvailableSources } = useSources();

  // Check if we have web search sources specifically
  const hasWebSearchSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;

    // Only count 'web' type sources for the button visibility
    const webSources = sources.filter(source => source.type === 'web');
    // Debug: Web sources and total sources count

    return webSources.length > 0;
  }, [sources]);

  // Check if sources are only tool-related that should show button
  const hasRelevantToolSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;

    // Only show for tool sources that are NOT image generation
    const relevantToolSources = sources.filter(source =>
      source.type === 'tool_link' &&
      !source.toolName?.toLowerCase().includes('image') &&
      !source.toolName?.includes('create_image') &&
      !source.title?.toLowerCase().includes('image generation')
    );

    // Debug: Relevant tool sources count
    return relevantToolSources.length > 0;
  }, [sources]);

  // Simple debug logging - no event dispatching to avoid loops
  React.useEffect(() => {
    if (isLastMessage && sources.length > 0) {
      // Debug: SourcesButtonContainer state check

      // Log source breakdown
      const sourceBreakdown = sources.reduce<Record<string, number>>((acc, s) => {
        acc[s.type] = (acc[s.type] || 0) + 1;
        return acc;
      }, {});
      // Debug: Source breakdown logged
    }
  }, [isLastMessage, hasWebSearchSources, hasRelevantToolSources, sources.length]); // Use sources.length instead of sources array

  // Skip rendering for old messages
  if (!isLastMessage) {
    return null;
  }

  // CRITICAL CHANGE: Only show sources button for web search or relevant tool sources
  // Do NOT show for document/RAG sources
  const shouldShow = hasWebSearchSources || hasRelevantToolSources;

  if (shouldShow) {
    // Debug: Rendering sources button for web/tool sources
    return (
      <div className="mb-1 mt-1 sources-container">
        <SourcesButton alwaysShowText={true} disabled={false} skipIfEmpty={false} />
      </div>
    );
  }

  // Debug: Not showing sources button - no web search sources available
  return null;
}

// Document-related functions removed - no longer needed

// Removed findDocumentSources function body - document sources are no longer needed
