'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ChatInput, type ChatInputHandle } from '@/components/ui/chat-input';
import { ChatMessage } from '@/components/ui/chat-message';
import { useEffect, useState, useRef, useCallback, useMemo, startTransition } from 'react';
import { ChevronDown } from 'lucide-react';
import { ScrollIndicator } from '@/components/ui/scroll-indicator';
import { useAuth } from '@/components/providers/auth-provider';
import { useModel, AVAILABLE_MODELS } from '@/components/providers/model-provider';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/ui/header';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/ui/sidebar';
import { useChatStore } from '@/lib/chat-store';
import { useWebSearchStore } from '@/lib/web-search-store';
import { useFileUploadStore } from '@/lib/file-upload-store';
import { useShallow } from 'zustand/react/shallow';
import { useOrganizationStore } from '@/lib/stores/organization-store';
import { isMultiTenant } from '@/lib/deployment-mode';

import type { Chat } from '@/lib/supabase';
import type { ExtendedMessage, APIMessage, ContentPart, DocumentContent } from '@/types/chat';
import { toAPIMessage, toDBMessages, updateMessages, appendMessage, toExtendedMessages, fromUIMessage } from '@/types/chat';
import { motion, useScroll, useSpring, AnimatePresence } from 'framer-motion';
import { createChat, updateChat } from '@/lib/chat-store';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';

import { getSupabase } from '@/lib/supabase';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { useTheme } from '@/components/theme-provider';
import { useTextSize } from '@/components/providers/text-size-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { playNotificationSound } from '@/lib/audio-utils';
import { useMcpProvider } from '@/components/ui/mcp-provider-selector';
import { SuggestionButtons } from '@/components/ui/suggestion-buttons';
import { resetMcpForNewChat } from '@/lib/mcp/universal-client';
import { clearCache as clearMcpCache } from '@/lib/mcp-cache';
import { useReasoningStore } from '@/lib/stores/reasoning-store';
import { useGhostModeStore } from '@/lib/ghost-mode-store';
import { GhostModeIndicator } from '@/components/ui/ghost-mode-indicator';
import { useToast } from '@/components/ui/use-toast';


// Declare global window properties for storing request state
declare global {
  interface Window {
    _pendingVideoRequests?: Record<string, number>;
    _pendingImageRequests?: Record<string, number>;
    _pendingThreeDRequests?: Record<string, number>;
    _lastSubmitTime?: number;
    _saveImageChatTimeout?: NodeJS.Timeout;
    _videoProgressIntervals?: Record<string, NodeJS.Timeout>;
    _save3DChatTimeout?: NodeJS.Timeout;
  }
}

interface CancellableError extends Error {
  cancel?: () => void;
}

interface ExtendedFormEvent extends React.FormEvent<HTMLFormElement> {
  messageContent?: ContentPart | ContentPart[];
}

interface StreamingMessage extends ExtendedMessage {
  id: string;
  role: 'assistant';
  content: string;
  createdAt: Date;
}

interface ImageProgressDetail {
  placeholderId: string;
  parentMessageId: string;
  count: number;
  total: number;
  status: string;
}

interface ImageErrorDetail {
  error: string;
  placeholderId: string;
  rawError: string;
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

interface ImageResponseDetail {
  imageUrls: string[];
  placeholderId: string;
  parentMessageId: string;
  aspectRatio?: string;
  sourceImageUrl?: string;
  isComplete: boolean;
}

interface ImagePlaceholder {
  id: string;
  prompt: string;
  aspectRatio: string;
  parentMessageId: string;
  count: number;
  total: number;
}

interface VideoGenerationSettings {
  isActive: boolean;
  // Add any other necessary settings you want to track
}

// Default welcome messages defined outside component to prevent re-creation
const defaultWelcomeMessages = [
  "Hey, {Username}! What can I help you with today?",
  "Ready when you are.",
  "Good to see you, {Username}.",
  "What's on your mind?",
  "Hi there, {Username}. How can I assist?",
  "Let's get started!",
  "Welcome back, {Username}!",
  "How can I help?",
  "Hey! Ready to dive in?",
  "Hi, {Username}. What would you like to explore today?"
];

// One-time Gmail save tracker
const preventDuplicateGmailSaves = (() => {
  // Debug: Initializing preventDuplicateGmailSaves tracker

  // Always prevent multiple saves
  return {
    // Try to register a save operation - only first save allowed
    register: (): boolean => {
      console.log('GMAIL SAVE DISABLED - Using single save point only');
      // Always return false to disable this save path
      return false;
    },

    // Reset the counter (used for testing)
    reset: (): void => { }
  };
})();

// First, let's enhance our Base64 detection and decoding function
const isBase64 = (str: string): boolean => {
  // Base64 strings are multiples of 4 in length (with possible padding)
  // and contain only base64 characters (A-Z, a-z, 0-9, +, /, =)
  if (!str || typeof str !== 'string') return false;
  try {
    return /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0;
  } catch (e) {
    return false;
  }
};

const decodeEmailContent = (content: string): string => {
  if (!content) return 'No content available';

  // Check if content is Base64 encoded
  try {
    // Replace URL-safe characters back to standard Base64
    const normalizedBase64 = content.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const padding = normalizedBase64.length % 4;
    const paddedBase64 = padding ?
      normalizedBase64 + '='.repeat(4 - padding) :
      normalizedBase64;

    // Check if it's likely Base64 (after normalization)
    if (/^[A-Za-z0-9+/=]+$/.test(paddedBase64)) {
      try {
        const decoded = Buffer.from(paddedBase64, 'base64').toString('utf-8');

        // If the decoded text looks like text (not binary), return it
        if (/^[\x00-\x7F\xA0-\xFF\s]*$/.test(decoded)) {
          return decoded;
        }
      } catch (e) {
        console.error('Error decoding possible Base64:', e);
      }
    }
  } catch (e) {
    console.error('Error processing content:', e);
  }

  return content;
};

// Add this function after the Base64 decoding functions (before the Home function)
const extractActionsFromEmail = (emailContent: string): { tasks: string[], deadlines: string[] } => {
  if (!emailContent) return { tasks: [], deadlines: [] };

  const tasks: string[] = [];
  const deadlines: string[] = [];

  // Regular expressions to identify common task patterns
  const taskPatterns = [
    /(?:please|kindly|can you|could you)\s+([^.!?]+\??)/gi,
    /(?:need to|should|must|have to)\s+([^.!?]+)/gi,
    /(?:task|action item|todo|to-do|to do)(?:\s*:|\s+is)\s+([^.!?]+)/gi,
    /I(?:'ll| will) wait for\s+([^.!?]+)/gi,
    /(?:follow up|get back to me|respond|reply)\s+([^.!?]+)/gi,
  ];

  // Regular expressions to identify deadline patterns
  const deadlinePatterns = [
    /(?:by|before|due|deadline|no later than|until)\s+(\w+day|tomorrow|next week|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?)/gi,
    /(?:by|before|due|deadline|no later than|until)\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/gi,
  ];

  // Extract tasks
  taskPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(emailContent)) !== null) {
      if (match[1] && match[1].trim().length > 5) {
        tasks.push(match[1].trim());
      }
    }
  });

  // Extract deadlines
  deadlinePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(emailContent)) !== null) {
      if (match[1]) {
        deadlines.push(match[1].trim());
      }
    }
  });

  return {
    tasks: [...new Set(tasks)], // Remove duplicates
    deadlines: [...new Set(deadlines)] // Remove duplicates
  };
};

// Define the ChatMessage props type
interface LocalChatMessageProps {
  message: Omit<UIMessage, 'content'> & {
    content: string | ContentPart[];
  };
  isLastMessage?: boolean;
  isFirstMessage?: boolean;
  isThinking?: boolean;
  isStreaming?: boolean;
  className?: string;
}

export default function Home() {
  const supabase = getSupabase();
  const { user, signOut, isAuthEnabled } = useAuth();
  const { selectedModel, isLoading: isModelLoading, setSelectedModel } = useModel();
  const { selectedProvider: mcpProvider, isLoading: isMcpProviderLoading } = useMcpProvider();
  const { theme } = useTheme();
  const router = useRouter();
  const {
    currentChatId,
    setCurrentChat,
    isSidebarOpen,
    setSidebarOpen,
    fetchChats // Get fetchChats action
  } = useChatStore(
    useShallow((s) => ({
      currentChatId: s.currentChatId,
      setCurrentChat: s.setCurrentChat,
      isSidebarOpen: s.isSidebarOpen,
      setSidebarOpen: s.setSidebarOpen,
      fetchChats: s.fetchChats,
    }))
  );
  const { backgroundImage } = useUserSettingsStore();
  const { setTextSize } = useTextSize();
  const { t, language } = useLanguage();
  const {
    isGhostMode,
    ghostMessages,
    ghostChatId,
    setGhostMessages,
    clearGhostMessages
  } = useGhostModeStore();
  const currentChatIdRef = useLatestRef(currentChatId);

  const [chatResetKey, setChatResetKey] = useState(0);
  const { file, fileType, clearFile, downloadableUrl, isUploading, uploadError } = useFileUploadStore();
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const messagesRef = useLatestRef(messages);
  const updateChatRef = useLatestRef(updateChat);
  const [temporaryDocument, setTemporaryDocument] = useState<DocumentContent | null>(null);
  const [contentParts, setContentParts] = useState<ContentPart[]>([]);

  // For tracking tool call information (Removed Gmail specific parts)
  const [toolCallInfo, setToolCallInfo] = useState<{
    toolName: string;
    parameters: Record<string, any>;
    placeholderMessageId: string;
  } | null>(null);

  // For streaming state tracking
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [toolCallMatches, setToolCallMatches] = useState<RegExpMatchArray[]>([]);

  // For image generation state tracking
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);

  // Add a ref to track confirmed tool calls (Keep for other potential tools)
  const confirmedToolCalls = useRef<Set<string>>(new Set());

  // Add state for tool call confirmation (Keep for other potential tools)
  const [toolCallState, setToolCallState] = useState({
    isConfirmationOpen: false,
    toolName: '',
    parameters: {},
    toolCallId: '',
    onConfirm: () => { },
    onCancel: () => { }
  });

  // State for runtime suggestions configuration
  const [showSuggestionsEnabled, setShowSuggestionsEnabled] = useState<boolean | null>(null);

  // For tracking video generation settings
  const [videoGenerationSettings, setVideoGenerationSettings] = useState<VideoGenerationSettings>({
    isActive: false
  });

  // State for welcome text customization
  const [welcomeTextMode, setWelcomeTextMode] = useState(
    process.env.NEXT_PUBLIC_WELCOME_TEXT_MODE || 'default'
  );
  const [welcomeText, setWelcomeText] = useState(
    process.env.NEXT_PUBLIC_WELCOME_TEXT || 'What can I help with?'
  );
  const [welcomeTextGradient, setWelcomeTextGradient] = useState(
    process.env.NEXT_PUBLIC_WELCOME_TEXT_GRADIENT || 'none'
  );
  const [welcomeTextTranslations, setWelcomeTextTranslations] = useState<Record<string, string>>({});

  // State for welcome messages array
  const [welcomeMessages, setWelcomeMessages] = useState<string[]>(defaultWelcomeMessages);
  const [welcomeMessagesTranslations, setWelcomeMessagesTranslations] = useState<Record<string, string[]>>({});
  const [selectedWelcomeMessage, setSelectedWelcomeMessage] = useState<string>('');
  const [extractedDisplayName, setExtractedDisplayName] = useState<string>('');

  // Helper function to get user display name (synchronous version using cached/extracted name)
  const getUserDisplayName = useCallback(() => {
    // First check for manual override from config
    const manualUsername = process.env.NEXT_PUBLIC_MANUAL_USERNAME;
    if (manualUsername && manualUsername.trim()) return manualUsername.trim();

    // Then check OAuth name
    if (user?.user_metadata?.name) return user.user_metadata.name;

    // Then check extracted name
    if (extractedDisplayName) return extractedDisplayName;

    // Finally fall back to email prefix
    if (user?.email) return user.email.split('@')[0];

    // Default fallback
    return 'there';
  }, [user, extractedDisplayName]);

  // Extract display name when user changes
  useEffect(() => {
    const extractDisplayName = async () => {
      // Skip if we already have a name from OAuth
      if (user?.user_metadata?.name) {
        setExtractedDisplayName(user.user_metadata.name);
        return;
      }

      if (user?.email) {
        const emailPrefix = user.email.split('@')[0];

        // Check localStorage cache first
        const cacheKey = `display_name_${emailPrefix}`;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            // Check if cache is still valid (30 days)
            if (parsed.timestamp && Date.now() - parsed.timestamp < 30 * 24 * 60 * 60 * 1000) {
              setExtractedDisplayName(parsed.displayName);
              return;
            }
          } catch {
            // Invalid cache, will re-extract
          }
        }

        // Extract name using AI
        try {
          const response = await fetch('/api/extract-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailPrefix })
          });

          if (response.ok) {
            const { displayName, type } = await response.json();
            setExtractedDisplayName(displayName);

            // Cache the result
            localStorage.setItem(cacheKey, JSON.stringify({
              displayName,
              type,
              timestamp: Date.now()
            }));

            console.log(`Extracted ${type} name: ${displayName}`);
          } else {
            // Fallback to simple extraction
            const simpleName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
            setExtractedDisplayName(simpleName);
          }
        } catch (error) {
          console.error('Failed to extract display name:', error);
          // Fallback to email prefix
          setExtractedDisplayName(emailPrefix);
        }
      }
    };

    extractDisplayName();
  }, [user]);

  // Listen for welcome text updates from config-ui
  useEffect(() => {
    const handleStorageChange = () => {
      // Check if localStorage has been explicitly set (even to empty string)
      const storedMode = localStorage.getItem('NEXT_PUBLIC_WELCOME_TEXT_MODE');
      const storedText = localStorage.getItem('NEXT_PUBLIC_WELCOME_TEXT');
      const storedGradient = localStorage.getItem('NEXT_PUBLIC_WELCOME_TEXT_GRADIENT');

      // Use stored values if they exist, otherwise fall back to env/defaults
      const mode = storedMode !== null ? storedMode :
        (process.env.NEXT_PUBLIC_WELCOME_TEXT_MODE || 'default');
      const text = storedText !== null ? storedText :
        (process.env.NEXT_PUBLIC_WELCOME_TEXT || 'What can I help with?');
      const gradient = storedGradient !== null ? storedGradient :
        (process.env.NEXT_PUBLIC_WELCOME_TEXT_GRADIENT || 'none');
      const translationsStr = localStorage.getItem('NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS') ||
        process.env.NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS ||
        '{}';

      // Load welcome messages array
      const messagesStr = localStorage.getItem('NEXT_PUBLIC_WELCOME_MESSAGES') ||
        process.env.NEXT_PUBLIC_WELCOME_MESSAGES ||
        '[]';
      const messagesTranslationsStr = localStorage.getItem('NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS') ||
        process.env.NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS ||
        '{}';

      let translations = {};
      let messages = [];
      let messagesTranslations = {};

      try {
        translations = JSON.parse(translationsStr);
      } catch (e) {
        console.error('Failed to parse welcome text translations:', e);
      }

      try {
        messages = JSON.parse(messagesStr);
        if (!Array.isArray(messages) || messages.length === 0) {
          messages = defaultWelcomeMessages;
        }
      } catch (e) {
        console.error('Failed to parse welcome messages:', e);
        messages = defaultWelcomeMessages;
      }

      try {
        messagesTranslations = JSON.parse(messagesTranslationsStr);
      } catch (e) {
        console.error('Failed to parse welcome messages translations:', e);
      }

      setWelcomeTextMode(mode);
      setWelcomeText(text);
      setWelcomeTextGradient(gradient);
      setWelcomeTextTranslations(translations);
      setWelcomeMessages(messages);
      setWelcomeMessagesTranslations(messagesTranslations);
    };

    // Listen for storage events (cross-tab updates)
    window.addEventListener('storage', handleStorageChange);

    // Listen for BroadcastChannel updates (same-tab updates)
    const channel = new BroadcastChannel('chatrag-config');
    channel.addEventListener('message', (event) => {
      // Check if the update is for welcome text
      if (event.data.key && (
        event.data.key === 'NEXT_PUBLIC_WELCOME_TEXT_MODE' ||
        event.data.key === 'NEXT_PUBLIC_WELCOME_TEXT' ||
        event.data.key === 'NEXT_PUBLIC_WELCOME_TEXT_GRADIENT' ||
        event.data.key === 'NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS' ||
        event.data.key === 'NEXT_PUBLIC_WELCOME_MESSAGES' ||
        event.data.key === 'NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS'
      )) {
        handleStorageChange();
      }
    });

    // Initial load from localStorage
    handleStorageChange();

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      channel.close();
    };
  }, []); // Removed defaultWelcomeMessages from dependencies

  // Add desktop narrow view detection
  useEffect(() => {
    const checkDesktopNarrow = () => {
      const isDesktop = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
      const isNarrow = window.innerWidth < 640;

      if (isDesktop && isNarrow) {
        document.body.classList.add('desktop-narrow-view');
      } else {
        document.body.classList.remove('desktop-narrow-view');
      }
    };

    checkDesktopNarrow();
    window.addEventListener('resize', checkDesktopNarrow);

    return () => {
      window.removeEventListener('resize', checkDesktopNarrow);
      document.body.classList.remove('desktop-narrow-view');
    };
  }, []);

  // Select a random welcome message on mount and when messages or language change
  useEffect(() => {
    if (welcomeMessages && welcomeMessages.length > 0) {
      const randomIndex = Math.floor(Math.random() * welcomeMessages.length);
      setSelectedWelcomeMessage(welcomeMessages[randomIndex]);
    }
  }, [welcomeMessages, language]);

  // ADDED: New helper function to reliably reset streaming state
  const resetStreamingState = useCallback(() => {
    console.log('=== Resetting streaming state ===');

    // Reset main streaming flag
    setIsStreaming(false);

    // Reset streaming message
    setStreamingMessage(null);

    // Clean up abort controller
    if (abortControllerRef.current) {
      abortControllerRef.current = null;
    }

    // Clean up stream timeout
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }

    console.log('Streaming state reset complete');
  }, []);

  // Safe chat creation function that prevents duplicates
  const safeCreateChat = useCallback(async (messages: any[]) => {
    // Check if we're already creating a chat
    if (isCreatingChatRef.current) {
      console.log('[SafeCreateChat] Chat creation already in progress, skipping...');
      return null;
    }

    // Check if we recently created a chat (within 2 seconds)
    const now = Date.now();
    const timeSinceLastCreation = now - lastChatCreationTimeRef.current;
    if (timeSinceLastCreation < 2000) {
      console.log(`[SafeCreateChat] Chat was created ${timeSinceLastCreation}ms ago, skipping duplicate...`);
      return null;
    }

    // Clear any pending save timeout
    if (pendingSaveTimeoutRef.current) {
      clearTimeout(pendingSaveTimeoutRef.current);
      pendingSaveTimeoutRef.current = null;
    }

    try {
      // Set the creation lock
      isCreatingChatRef.current = true;
      lastChatCreationTimeRef.current = now;

      // Get current organization context for workspace-scoped chats
      let organizationId: string | null | undefined = undefined;
      if (isMultiTenant()) {
        const { currentOrganization, isPersonalMode } = useOrganizationStore.getState();
        // Always use currentOrganization.id if it exists, regardless of isPersonalMode
        // This ensures chats are saved to the correct workspace (including Personal Workspaces)
        organizationId = currentOrganization?.id ?? null;
        console.log('[SafeCreateChat] Creating chat in workspace:', {
          organizationId: organizationId || 'personal workspace',
          organizationName: currentOrganization?.name || 'Default Workspace',
          isPersonalMode,
          hasCurrentOrg: !!currentOrganization
        });
      }

      console.log('[SafeCreateChat] Creating new chat...');
      const chatId = await createChat(messages, undefined, organizationId);

      if (chatId) {
        console.log('[SafeCreateChat] Chat created successfully:', chatId);
        setCurrentChat(chatId);
      }

      return chatId;
    } catch (error) {
      console.error('[SafeCreateChat] Error creating chat:', error);
      return null;
    } finally {
      // Release the lock after a short delay to prevent rapid re-creation
      setTimeout(() => {
        isCreatingChatRef.current = false;
      }, 1000);
    }
  }, [setCurrentChat]);

  const safeCreateChatRef = useLatestRef(safeCreateChat);

  // Debounced save function to prevent multiple saves
  const debouncedSave = useCallback((chatId: string | null, messages: any[]) => {
    // Clear any existing timeout
    if (pendingSaveTimeoutRef.current) {
      clearTimeout(pendingSaveTimeoutRef.current);
    }

    // Set a new timeout for saving
    pendingSaveTimeoutRef.current = setTimeout(async () => {
      try {
        if (chatId) {
          console.log('[DebouncedSave] Updating existing chat:', chatId);
          await updateChatRef.current(chatId, messages);
        } else {
          // Use safe creation for new chats
          await safeCreateChatRef.current(messages);
        }
      } catch (error) {
        console.error('[DebouncedSave] Error saving:', error);
      }
    }, 500); // 500ms debounce
  }, []);

  const [input, setInput] = useState('');

  // Removed fetchedEmails state

  // Removed isEmailFetchInProgress state

  // Initialize useChat hook before any references to its variables
  const {
    isLoading: isChatLoading,
    error,
    stop: stopStream,
    messages: aiMessages,
    setMessages: setAiMessages,
    data
  } = useChat({
    id: currentChatId || undefined,


    // Body is not used since we have a custom handleSubmit that makes direct fetch calls
    onResponse: (response: Response) => {
      console.log('=== Stream Response ===');
      if (!response.ok) {
        setIsStreaming(false);
        return;
      }
      setIsStreaming(true);

      // Set a maximum streaming time in case the stream doesn't complete properly
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
      }

      streamTimeoutRef.current = setTimeout(() => {
        console.log('=== Stream Timeout ===');
        setIsStreaming(false);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
      }, 60000); // 60 seconds maximum streaming time
    },

    onFinish: (async (message: any, options: any) => {
      const metadata = (options as any)?.metadata;
      console.log('=== Stream Complete ===');
      console.log('onFinish handler triggered with message:', message);
      console.log('onFinish metadata:', metadata);
      console.log('Stored streaming content length:', streamingContentRef.current?.length);

      // Handle multi-step queries
      if (metadata?.multiStep) {
        console.log('📝 [MULTI-STEP] Detected multi-step response');
        console.log('📝 [MULTI-STEP] Current step:', metadata.multiStep.currentStepIndex + 1, 'of', metadata.multiStep.totalSteps);
        console.log('📝 [MULTI-STEP] Has more steps:', metadata.multiStep.hasMoreSteps);
        console.log('📝 [MULTI-STEP] Requires tool approval:', metadata.multiStep.requiresToolApproval);

        // Store multi-step metadata for UI display
        if (window) {
          (window as any).__multiStepMetadata = metadata.multiStep;
        }

        // If there are more steps and they require tool approval, trigger MCP modal
        if (metadata.multiStep.hasMoreSteps && metadata.multiStep.requiresToolApproval) {
          console.log('📝 [MULTI-STEP] Triggering MCP tool approval for next step');

          // Set a timeout to show the MCP modal after the current response is displayed
          setTimeout(() => {
            // Trigger MCP modal for the next step
            const nextStepQuery = metadata.multiStep.nextStep?.text || '';
            console.log('📝 [MULTI-STEP] Next step query:', nextStepQuery);

            // Dispatch custom event to trigger MCP modal
            const event = new CustomEvent('multi-step-mcp-trigger', {
              detail: {
                step: metadata.multiStep.nextStep,
                query: nextStepQuery,
                metadata: metadata.multiStep
              }
            });
            window.dispatchEvent(event);
          }, 2000); // Wait 2 seconds for user to read the response
        }
      }

      // Clear the streaming timeout
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current = null;
      }

      // CRITICAL FIX: Get the current streaming message from state instead of relying on refs
      // This ensures we get the most up-to-date content
      let finalContent = '';

      setMessages(prevMessages => {
        // Find the streaming message
        const streamingMsg = prevMessages.find(msg => msg.id === 'streaming');

        if (streamingMsg && typeof streamingMsg.content === 'string') {
          finalContent = streamingMsg.content;
        } else if (streamingContentRef.current) {
          finalContent = streamingContentRef.current;
        } else if (message.content) {
          finalContent = message.content;
        }

        console.log('[onFinish] Final content extracted:', finalContent.substring(0, 100) + '...');

        // Filter out streaming and thinking messages
        const filteredMessages = prevMessages.filter(msg => msg.id !== 'streaming' && msg.id !== 'thinking');

        // Create the final message
        const finalMessage: ExtendedMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: finalContent,
          createdAt: new Date()
        };

        console.log('[onFinish] Creating final message with content length:', finalContent.length);

        // Store for database update
        const messagesWithFinal = [...filteredMessages, finalMessage];

        // Save to database using debounced save
        debouncedSave((isGhostMode || (currentChatId && currentChatId.startsWith('ghost-'))) ? null : currentChatId, messagesWithFinal);

        return messagesWithFinal;
      });

      // Reset streaming state
      setIsStreaming(false);
      console.log('Stream cleanup completed');

      // Don't clear the streaming content ref immediately - it may still be needed
      // The ref will be naturally cleared when a new message starts streaming

      // Dispatch the custom event to trigger notification sound
      if (typeof window !== 'undefined') {
        const streamCompletedEvent = new CustomEvent('ai-stream-completed', {
          detail: { timestamp: Date.now(), source: 'onFinish' }
        });
        window.dispatchEvent(streamCompletedEvent);
        console.log('Dispatched ai-stream-completed event from onFinish handler');
      }
    }) as any,

    onError: (error: any) => {
      console.error('Chat error:', error);
      setIsStreaming(false);

      // Clear the streaming timeout
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    },

    transport: new DefaultChatTransport({
      api: '/api/chat'
    })
  } as any) as any;
  const isChatLoadingRef = useLatestRef(isChatLoading);

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamingContentRef = useRef<string>(''); // Store accumulated streaming content

  // Add refs to prevent duplicate chat creation
  const isCreatingChatRef = useRef(false);
  const lastChatCreationTimeRef = useRef(0);
  const pendingSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reminderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const isInitialLoadRef = useRef(true);
  const chatSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Add sessionId ref for MCP tool persistence
  const sessionIdRef = useRef<string | null>(null);

  // Generate session ID once on mount using useEffect to ensure consistency
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = uuidv4();
      console.log('[Page] Generated new session ID:', sessionIdRef.current);
    }
  }, []); // Empty dependency array ensures this runs only once

  // Cleanup effect for pending saves
  useEffect(() => {
    return () => {
      // Clear any pending save timeout on unmount
      if (pendingSaveTimeoutRef.current) {
        clearTimeout(pendingSaveTimeoutRef.current);
      }

      if (chatSwitchTimeoutRef.current) {
        clearTimeout(chatSwitchTimeoutRef.current);
        chatSwitchTimeoutRef.current = null;
      }

    };
  }, [currentChatIdRef, isChatLoadingRef, messagesRef, safeCreateChatRef, updateChatRef]);

  // Helper function to generate unique message IDs
  const generateMessageId = () => {
    // Use timestamp + random component to prevent collisions
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Simple, clean scroll state - NO COMPLEX STATE MANAGEMENT
  const scrollState = useRef({
    shouldAutoScroll: true,
    userBrokeFromAutoScroll: false
  });

  const [showBottomScrollIndicator, setShowBottomScrollIndicator] = useState(false);
  const [showTopScrollIndicator, setShowTopScrollIndicator] = useState(false);
  const [showTopGradient, setShowTopGradient] = useState(false);
  const [showBottomGradient, setShowBottomGradient] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false); // Start hidden
  const [isSwitchingChat, setIsSwitchingChat] = useState(false); // Prevents welcome screen flash during chat switches
  const [isChatTransitionAnimating, setIsChatTransitionAnimating] = useState(false);
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false); // Voice mode layout state
  const { toast } = useToast();

  // Track previous voice mode state to detect when it ends
  const prevIsVoiceModeActive = useRef(isVoiceModeActive);

  useEffect(() => {
    // Check if we transitioned from Active (true) to Inactive (false)
    if (prevIsVoiceModeActive.current && !isVoiceModeActive) {
      console.log('[Page] Voice mode ended (detected via state transition)');

      // Show immediate feedback to user
      console.log('[Page] Voice mode ended (detected via state transition)');

      // Removed end session toast as requested by user

      // Schedule the refresh event
      // We use a safe timeout to ensure the backend has finished saving, 
      // which happens asynchronously after disconnection.
      setTimeout(() => {
        console.log('[Page] Dispatching global refresh event');
        window.dispatchEvent(new CustomEvent('chatrag:voice-session-ended'));
      }, 4000); // 4s delay to be absolutely sure DB is consistent
    }

    // Update ref for next render
    prevIsVoiceModeActive.current = isVoiceModeActive;
  }, [isVoiceModeActive, toast]);

  const isInitialView = useMemo(() => {
    // CRITICAL FIX: Check isSwitchingChat FIRST - this prevents ANY welcome screen flash during transitions
    // When switching chats, NEVER show welcome screen, even if messages array is temporarily empty
    if (isSwitchingChat) {
      console.log('🚫 [isInitialView] Blocking welcome screen - chat switch in progress');
      return false;
    }

    // CRITICAL FIX: If we have a currentChatId, we're NEVER in initial view
    // This handles the case where messages might be loading or temporarily empty
    if (currentChatId) {
      console.log('🚫 [isInitialView] Blocking welcome screen - currentChatId exists:', currentChatId);
      return false;
    }

    // VOICE MODE FIX: When voice mode is active, use conversation layout (input at bottom)
    if (isVoiceModeActive) {
      console.log('🚫 [isInitialView] Blocking welcome screen - voice mode is active');
      return false;
    }

    // Only show welcome screen when:
    // 1. No current chat ID
    // 2. No messages in the UI
    // 3. NOT switching between chats
    // 4. NOT in voice mode
    const hasNoMessages = messages.length === 0;
    const shouldShowWelcome = hasNoMessages;

    if (shouldShowWelcome) {
      console.log('✅ [isInitialView] Showing welcome screen - truly initial state');
    }

    return shouldShowWelcome;
  }, [messages.length, currentChatId, isSwitchingChat, isVoiceModeActive]);

  const handleStop = useCallback(async () => {
    console.log('=== Stop Requested ===');

    // Only handle stop if we're actually streaming
    if (!isStreaming) {
      console.log('Not currently streaming, ignoring stop request');
      return;
    }

    try {
      // CHANGED: Use the resetStreamingState helper for consistent cleanup
      resetStreamingState();

      // Get the current streaming message content
      setMessages(prevMessages => {
        const streamingMessage = prevMessages.find(msg => msg.id === 'streaming');

        if (streamingMessage && streamingMessage.content) {
          // Create a final message from the current streaming content
          const finalMessage: ExtendedMessage = {
            ...streamingMessage,
            id: generateMessageId(),
          };

          console.log('Created final message from stopped stream:', finalMessage);

          // Create updated messages array
          const updatedMessages = prevMessages
            .filter(msg => msg.id !== 'thinking' && msg.id !== 'streaming')
            .concat(finalMessage);

          // Save to database using debounced save
          const userMessages = updatedMessages.filter(msg => msg.role === 'user');
          if (userMessages.length > 0) {
            debouncedSave((isGhostMode || (currentChatId && currentChatId.startsWith('ghost-'))) ? null : currentChatId, updatedMessages);
          }

          return updatedMessages;
        } else {
          // Just filter out thinking/streaming messages
          return prevMessages.filter(msg => msg.id !== 'thinking' && msg.id !== 'streaming');
        }
      });
    } catch (error) {
      console.error('Error stopping stream:', error);
      // ENSURE we still reset streaming state even if there's an error
      resetStreamingState();
    }
  }, [currentChatId, debouncedSave, isStreaming, resetStreamingState]);

  // Add a ref for logging
  const logRef = useRef({
    lastLoadingState: false,
    lastTimestamp: ''
  });

  // Replace the loading state effect with this version
  useEffect(() => {
    // Only log if the loading state actually changed
    if (logRef.current.lastLoadingState !== isChatLoading) {
      const timestamp = new Date().toISOString();
      console.log('=== Loading State Change ===');
      console.log('isChatLoading:', isChatLoading);
      console.log('stopStream available:', !!stopStream);
      console.log('Timestamp:', timestamp);
      console.log('State:', isChatLoading ? 'STREAMING' : 'IDLE');
      console.log('==========================');

      // Update ref
      logRef.current.lastLoadingState = isChatLoading;
      logRef.current.lastTimestamp = timestamp;
    }
  }, [isChatLoading, stopStream]);

  // Fetch suggestions configuration from server at runtime
  useEffect(() => {
    async function fetchSuggestionsConfig() {
      try {
        const response = await fetch('/api/config/get-env?var=NEXT_PUBLIC_SHOW_SUGGESTIONS');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            const isEnabled = data.value === 'true';
            setShowSuggestionsEnabled(isEnabled);

            // Clear localStorage if suggestions are disabled at system level
            // This prevents confusion from stale user preferences
            if (!isEnabled) {
              try {
                localStorage.removeItem('SHOW_SUGGESTIONS');
              } catch (e) {
                // Ignore localStorage errors
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching suggestions config:', error);
        // Default to false if there's an error
        setShowSuggestionsEnabled(false);
      }
    }

    fetchSuggestionsConfig();
  }, []); // Run once on mount

  /**
   * This helps prevent raw JSON from initially showing during streaming
   */
  // Clean streaming messages of tool calls and metadata
  useEffect(() => {
    if (!(isStreaming || isChatLoading)) return;
    const interval = setInterval(() => {
      const latest = messagesRef.current;
      const lastMessage = latest[latest.length - 1];
      if (lastMessage?.id === 'streaming') {
        // Clean the streaming message of tool calls and raw metadata
        if (lastMessage && lastMessage.content) {
          if (Array.isArray(lastMessage.content)) {
            // Find text part in message content
            const textPart = lastMessage.content.find((part) => part.type === 'text');
            if (textPart && textPart.text) {
              // Use the more comprehensive cleanStreamedContent function
              textPart.text = cleanStreamedContent(textPart.text);
            }
          } else if (typeof lastMessage.content === 'string') {
            // Handle case where content is a string
            lastMessage.content = cleanStreamedContent(lastMessage.content);
          }
        }
      }
    }, 250); // Clean more frequently (250ms instead of 500ms) for better user experience

    return () => clearInterval(interval);
  }, [isStreaming, isChatLoading, messagesRef]);

  /**
   * This is a dedicated high-frequency cleaner specifically for the f:{messageId...} pattern
   * that runs extremely frequently to immediately remove this pattern as soon as it appears
   */
  useEffect(() => {
    if (!(isStreaming || isChatLoading)) return;
    const messageIdCleanerInterval = setInterval(() => {
      const latest = messagesRef.current;
      const lastMessage = latest[latest.length - 1];
      if (lastMessage?.id === 'streaming') {
        // Only clean messageId patterns - this is a focused cleaner
        if (lastMessage && lastMessage.content) {
          const messageIdPatterns = [
            // Exact match for f:{messageId...} format
            /f:\s*\{\s*"messageId"\s*:\s*"[^"]+"\s*\}\s*/g,
            // More flexible patterns to catch variants
            /f:\s*\{.*?messageId.*?\}\s*/g,
            /f:.*?messageId.*?\}/g,
            /\{\s*"messageId"\s*:.*?\}\s*/g
          ];

          if (Array.isArray(lastMessage.content)) {
            // Find text part in message content
            const textPart = lastMessage.content.find((part) => part.type === 'text');
            if (textPart && textPart.text) {
              let cleaned = textPart.text;
              // Apply all messageId patterns
              for (const pattern of messageIdPatterns) {
                cleaned = cleaned.replace(pattern, '');
              }
              // Only update if changes were made
              if (cleaned !== textPart.text) {
                console.log('Removed messageId pattern from streaming message');
                textPart.text = cleaned;
              }
            }
          } else if (typeof lastMessage.content === 'string') {
            // Handle case where content is a string
            let cleaned = lastMessage.content;
            // Apply all messageId patterns
            for (const pattern of messageIdPatterns) {
              cleaned = cleaned.replace(pattern, '');
            }
            // Only update if changes were made
            if (cleaned !== lastMessage.content) {
              console.log('Removed messageId pattern from streaming message (string content)');
              lastMessage.content = cleaned;
            }
          }
        }
      }
    }, 250); // Very frequent cleaner for messageId artifacts

    return () => clearInterval(messageIdCleanerInterval);
  }, [isStreaming, isChatLoading, messagesRef]);

  /**
   * This is a more aggressive cleaner specifically for document tool call formats
   * that runs more frequently and uses exact pattern matching
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.content) {
        if (Array.isArray(lastMessage.content)) {
          // Clean text parts
          for (const part of lastMessage.content) {
            if (part.type === 'text' && part.text) {
              // Specific regexes for document formats
              const docToolCallPattern = /9:\s*\{\s*"toolCallId".*?"args".*?"documentId".*?\}\s*,?\s*"isContinued"\s*:\s*false\s*\}\s*\}/g;
              const usedDocsPattern = /f:\s*\{\s*"usedDocuments"\s*:\s*\[\s*\{[\s\S]*?\}\s*\]\s*\}/g;

              // Apply exact cleaners
              part.text = part.text
                .replace(docToolCallPattern, '')
                .replace(usedDocsPattern, '');
            }
          }
        } else if (typeof lastMessage.content === 'string') {
          // Specific regexes for document formats
          const docToolCallPattern = /9:\s*\{\s*"toolCallId".*?"args".*?"documentId".*?\}\s*,?\s*"isContinued"\s*:\s*false\s*\}\s*\}/g;
          const usedDocsPattern = /f:\s*\{\s*"usedDocuments"\s*:\s*\[\s*\{[\s\S]*?\}\s*\]\s*\}/g;

          // Apply exact cleaners
          lastMessage.content = lastMessage.content
            .replace(docToolCallPattern, '')
            .replace(usedDocsPattern, '');
        }
      }
    }, 100); // Run very frequently for quick cleanup

    return () => clearInterval(interval);
  }, [messages]);

  // CRITICAL FIX: Synchronize aiMessages from useChat with local messages state during streaming
  useEffect(() => {
    if (!isStreaming) return;

    const lastAiMessage = aiMessages[aiMessages.length - 1];
    if (!lastAiMessage || lastAiMessage.role !== 'assistant') return;

    const extendedAssistantMessage = fromUIMessage(lastAiMessage as any);
    console.log('[SYNC] Syncing AI message to local state:', extendedAssistantMessage);

    setMessages(prevMessages => {
      const streamingIndex = prevMessages.findIndex(msg => msg.id === 'streaming');

      if (streamingIndex !== -1) {
        const updatedMessages = [...prevMessages];
        updatedMessages[streamingIndex] = {
          ...updatedMessages[streamingIndex],
          content: extendedAssistantMessage.content,
          attachments: extendedAssistantMessage.attachments,
          metadata: extendedAssistantMessage.metadata,
          role: 'assistant'
        };
        console.log('[SYNC] Updated streaming message with AI content');
        return updatedMessages;
      }

      console.log('[SYNC] No streaming message found, adding new one');
      return [
        ...prevMessages,
        {
          ...extendedAssistantMessage,
          id: 'streaming',
          createdAt: new Date()
        }
      ];
    });
  }, [aiMessages, isStreaming, setMessages]);

  const cleanToolCallContent = (text: string): string => {
    // Skip empty or undefined text
    if (!text || typeof text !== 'string') return '';

    console.log('Cleaning tool call content:', text);

    // First handle document reference formats which are common and problematic
    // Pattern to match document tool calls like 9:{"toolCallId":"call_ckflXj...",...}
    const docToolCallPattern = /9:\s*\{\s*"toolCallId".*?"args".*?"documentId".*?\}\s*,?\s*"isContinued"\s*:\s*false\s*\}\s*\}/g;

    // Pattern to match document usedDocuments metadata like f:{"usedDocuments":[...]}
    const usedDocsPattern = /f:\s*\{\s*"usedDocuments"\s*:\s*\[\s*\{[\s\S]*?\}\s*\]\s*\}/g;

    // Apply document patterns
    text = text
      .replace(docToolCallPattern, '')
      .replace(usedDocsPattern, '');

    // First handle the new token format with numbers and f: prefixes
    // Pattern to remove f:{"messageId":"msg-..."} prefixes
    const messageIdPattern = /f:\s*\{\"messageId\":\"[^\"]+\"\}\s*/g;
    text = text.replace(messageIdPattern, '');

    // Handle simple numbered tokens like "1:1" or "2:"
    const simpleNumberedPattern = /\d+:\d+\s*|\d+:\s*/g;
    text = text.replace(simpleNumberedPattern, '');

    // Count all numbered tokens in the text to decide if we should use this approach
    const numberedTokenCount = (text.match(/\d+:\s*\"/g) || []).length;
    console.log(`Found ${numberedTokenCount} numbered tokens in chunk`);

    if (numberedTokenCount > 0) {
      // Pattern to remove numbered tokens like 0:"text" 
      const numberedTokenPattern = /\d+:\s*\"([^\"]*)\"/g;
      let cleanedText = '';
      let match;

      // Use exec in a loop for more reliable extraction
      while ((match = numberedTokenPattern.exec(text)) !== null) {
        if (match[1]) {
          cleanedText += match[1];
        }
      }

      // If we extracted content from numbered tokens, return it directly
      if (cleanedText) {
        console.log(`Extracted token content: "${cleanedText}"`);
        return cleanedText;
      } else {
        console.log('No content extracted from numbered tokens, falling back to standard cleaning');
      }
    }

    // Otherwise, continue with the original cleaning logic

    // Check if this text appears to be a tool call
    // Removed Gmail checks
    const isToolCall = (
      (text.includes('requiresConfirmation') ||
        text.includes('toolName') ||
        text.includes('parameters') ||
        text.includes('toolCallId') ||
        text.includes('documentId') ||
        text.includes('documentName') ||
        text.includes('relevance') ||
        text.includes('reason') ||
        text.includes('usedDocuments') || /^\s*{[^}]*}\s*$/.test(text)) // Text is just a JSON object
    );

    if (!isToolCall) return text;

    // Clean out tool call markers
    let cleanedText = text;

    // Remove the entire JSON object if it looks like one
    if (/^\s*{[^}]*}\s*$/.test(text)) {
      return '';
    }

    // Remove common tool call patterns
    cleanedText = cleanedText.replace(/requiresConfirmation/g, '');
    cleanedText = cleanedText.replace(/toolName/g, '');
    cleanedText = cleanedText.replace(/parameters/g, '');
    cleanedText = cleanedText.replace(/toolCallId/g, '');
    // Removed Gmail patterns
    cleanedText = cleanedText.replace(/documentId/g, '');
    cleanedText = cleanedText.replace(/documentName/g, '');
    cleanedText = cleanedText.replace(/relevance/g, '');
    cleanedText = cleanedText.replace(/reason/g, '');
    cleanedText = cleanedText.replace(/usedDocuments/g, '');
    cleanedText = cleanedText.replace(/explicitly_referenced/g, '');
    cleanedText = cleanedText.replace(/similarity/g, '');
    cleanedText = cleanedText.replace(/content_preview/g, '');
    cleanedText = cleanedText.replace(/matched_chunk/g, '');

    // Remove curly braces, colons, and quotes that likely belong to the tool call
    cleanedText = cleanedText.replace(/[{}]/g, '');
    cleanedText = cleanedText.replace(/"\s*:\s*"/g, '');
    cleanedText = cleanedText.replace(/"\s*,\s*"/g, ' ');

    // Final cleanup of any stray JSON syntax
    cleanedText = cleanedText.replace(/[\[\]{}]/g, '');
    cleanedText = cleanedText.replace(/,\s*$/g, '');

    // Cleanup whitespace and punctuation
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

    console.log('Cleaned tool call content:', cleanedText);

    return cleanedText;
  };

  const handleSubmit = async (e: ExtendedFormEvent) => {
    // Check if e is a proper event object with preventDefault method
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (!input.trim() && !file && !e.messageContent) return;

    // Removed email follow-up check
    // if (handleEmailFollowUp(input)) {
    //   return; // Skip the rest of handleSubmit if we handled a follow-up
    // }

    // Removed email query detection and special handling

    // Create a new abort controller for this request
    abortControllerRef.current = new AbortController();

    // Force scroll to bottom when user sends a new message
    setTimeout(() => {
      scrollToBottom();
    }, 100);

    try {
      setIsStreaming(true);
      const thinkingMessage: ExtendedMessage = {
        role: 'assistant',
        content: isGeneratingImage ? 'Generating image...' : '',
        id: 'thinking',
        createdAt: new Date()
      };

      // Handle image generation content
      if (e.messageContent && 'type' in e.messageContent && e.messageContent.type === 'generated_image') {
        console.log('Handling generated image message:', e.messageContent);

        // Create user message with the prompt
        const userMessage: ExtendedMessage = {
          role: 'user',
          content: input,
          id: generateMessageId(),
          createdAt: new Date()
        };

        // Create AI message with the generated image
        const aiMessage: ExtendedMessage = {
          role: 'assistant',
          content: [e.messageContent],
          id: (Date.now() + 1).toString(),
          createdAt: new Date()
        };

        // Update messages with both the user prompt and AI response
        setMessages(prevMessages => [...prevMessages, userMessage, aiMessage]);

        // Clear input
        setInput('');
        setIsStreaming(false);

        // Save to database using debounced save
        debouncedSave((isGhostMode || (currentChatId && currentChatId.startsWith('ghost-'))) ? null : currentChatId, [...messages, userMessage, aiMessage]);
        return;
      }

      let messageContent: string | ContentPart[] = input;
      let contentParts: ContentPart[] = [];

      console.log('Initial message setup:', {
        input,
        file,
        fileType,
        messageContent: e.messageContent
      });

      // Handle other message types
      if (e.messageContent) {
        if (Array.isArray(e.messageContent)) {
          contentParts = e.messageContent;
        } else {
          contentParts = [e.messageContent];
        }
      } else if (file) {
        // Handle file uploads - now using immediate upload to Supabase
        if (fileType === 'image') {
          console.log('Processing image file:', {
            name: file.name,
            type: file.type,
            size: file.size,
            fileObject: file
          });

          // Check if we have a permanent downloadable URL
          if (downloadableUrl) {
            console.log('Using permanent downloadable URL:', downloadableUrl);
            contentParts.push({
              type: 'image_url',
              image_url: { url: downloadableUrl }
            });
            console.log('Image successfully added to contentParts with permanent URL:', contentParts);
          } else if (isUploading) {
            // Still uploading - show message to user
            throw new Error('Image is still uploading. Please wait for upload to complete.');
          } else if (uploadError) {
            // Upload failed - show error
            throw new Error(`Image upload failed: ${uploadError}`);
          } else {
            // Fallback to base64 if no permanent URL (shouldn't happen with new flow)
            console.warn('No permanent URL available, falling back to base64');
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
              reader.readAsDataURL(file);
            });

            contentParts.push({
              type: 'image_url',
              image_url: { url: fileData }
            });
          }
        } else if (fileType === 'document') {
          // Process document using the API endpoint
          const formData = new FormData();
          formData.append('file', file);

          try {
            console.log('Sending document for processing:', file.name);
            const response = await fetch('/api/process-document', {
              method: 'POST',
              body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
              console.error('Document processing failed:', data);
              throw new Error(data.error || `Document processing failed: ${response.statusText}`);
            }

            if (!data || !data.text) {
              console.error('Invalid document processing response:', data);
              throw new Error('Invalid response from document processing');
            }

            console.log('Document processed successfully:', {
              name: data.name,
              type: data.type,
              textLength: data.text.length,
              documentId: data.id
            });

            contentParts.push({
              type: 'document',
              document: data
            });
          } catch (error) {
            console.error('Error processing document:', error);
            // Remove thinking message and show error
            setMessages(messages => messages.filter(msg => msg.id !== 'thinking'));
            throw error;
          }
        }
      }

      // Add text content if present
      if (input.trim() && !contentParts.some(part => part.type === 'text')) {
        contentParts.push({
          type: 'text',
          text: input.trim()
        });
      }

      messageContent = contentParts.length > 0 ? contentParts : input;

      console.log('Final message content:', {
        messageContent,
        contentParts,
        hasFile: Boolean(file),
        fileType
      });

      // Create initial user message
      const initialUserMessage: ExtendedMessage = {
        role: 'user',
        content: messageContent,
        id: generateMessageId(),
        createdAt: new Date()
      };

      console.log('Created user message:', initialUserMessage);

      // Update messages immediately to show user input and thinking state
      setMessages(messages => [...messages, initialUserMessage, thinkingMessage]);

      // Clear the file and input
      if (file) {
        clearFile();
      }
      setInput('');

      // Prepare the messages for the API call
      const apiMessages = [...messages, initialUserMessage].map(msg => {
        const baseMsg = {
          role: msg.role,
          content: ''
        };

        if (Array.isArray(msg.content)) {
          // For array content, process each part
          const parts = msg.content as ContentPart[];

          // Check if we have any image parts
          const hasImagePart = parts.some(part => part.type === 'image_url');

          // Check if we have any generated media parts
          const hasGeneratedMedia = parts.some(part =>
            part.type === 'generated_image' ||
            part.type === 'generated_video' ||
            part.type === 'generated_3d_model'
          );

          if (hasImagePart) {
            // For messages with images, keep the full content array
            return {
              role: msg.role,
              content: parts
            };
          }

          if (hasGeneratedMedia) {
            // For messages with generated media, serialize the content parts
            // This preserves the media URLs while working with the AI SDK
            const serializedContent = JSON.stringify({
              __content_parts__: true,
              parts: parts
            });
            return {
              role: msg.role,
              content: serializedContent
            };
          }

          // For other arrays (without images or generated media), handle as before for text display
          const textParts = parts.map(part => {
            if (part.type === 'text') {
              return part.text;
            }
            if (part.type === 'document' && part.document) {
              // Include document metadata and content
              const docPrefix = `[Document: ${part.document.name}]`;
              if (part.document.chunks && Array.isArray(part.document.chunks)) {
                return `${docPrefix}\n${part.document.chunks
                  .map(chunk => chunk.content)
                  .join('\n---\n')}`;
              }
              return `${docPrefix}\n${part.document.text}`;
            }
            if (part.type === 'image_url') {
              return '[Image]';
            }
            return '';
          });
          baseMsg.content = textParts.filter(Boolean).join('\n\n');
        } else {
          baseMsg.content = msg.content as string;
        }

        return baseMsg;
      });

      // Check if the last user message contains an image (for image generation)
      const lastUserMessage = apiMessages.filter(msg => msg.role === 'user').pop();
      const hasImageInLastMessage = lastUserMessage && Array.isArray(lastUserMessage.content) &&
        lastUserMessage.content.some((part: any) => part.type === 'image_url');

      // Set image generation loading state if image is being processed
      if (hasImageInLastMessage) {
        setIsGeneratingImage(true);
        console.log('Image detected in user message, setting image generation loading state');
      }

      const runtimeWebSearchEnabled =
        typeof e?.data?.settings?.webSearch === 'boolean'
          ? e.data.settings.webSearch
          : useWebSearchStore.getState().isEnabled;

      // Prepare settings for the API call
      const settings = {
        webSearch: runtimeWebSearchEnabled,
        model: selectedModel?.id || 'openai/gpt-4o-2024-11-20',
        language: language || 'en'
      } as any;

      // Add MCP settings based on selection
      if (mcpProvider && mcpProvider !== 'auto') {
        settings.mcpEnabled = true;
        settings.mcpProvider = mcpProvider;
      }

      // Add reasoning configuration from the global store
      const reasoningConfig = useReasoningStore.getState().getConfig();
      console.log('[Page] handleSubmit - reasoning config from store:', reasoningConfig);
      if (reasoningConfig) {
        settings.reasoning = reasoningConfig;
      }

      // Get current organization context for RAG filtering
      let organizationId: string | null | undefined = undefined;
      if (isMultiTenant()) {
        const { currentOrganization, isPersonalMode } = useOrganizationStore.getState();
        organizationId = isPersonalMode ? null : currentOrganization?.id;
        console.log('[Page] Sending organization context to RAG:', organizationId || 'personal workspace');
      }

      // Make the API call
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages,
          data: {
            settings,
            organizationId // Pass organization context for workspace-scoped RAG
          }
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      // 🔧 FIX: Check if this is an image generation JSON response (not streaming)
      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const jsonData = await response.json();

        if (jsonData.isImageGeneration && jsonData.images && jsonData.images.length > 0) {
          console.log('[Page] Received image generation response:', jsonData);

          // Create a placeholder message ID
          const parentMessageId = `image-edit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
          const placeholderId = `placeholder-${parentMessageId}`;

          // Replace thinking message with a placeholder for the image
          setMessages(prevMessages => {
            const filteredMessages = prevMessages.filter(msg => msg.id !== 'thinking');
            return [
              ...filteredMessages,
              {
                id: parentMessageId,
                role: 'assistant' as const,
                content: [{
                  type: 'loading_image' as const,
                  id: placeholderId,
                  prompt: jsonData.prompt || 'Image edit',
                  aspectRatio: jsonData.aspectRatio || '1:1',
                  count: 1,
                  total: 1,
                  status: 'Loading generated image...'
                }],
                createdAt: new Date()
              }
            ];
          });

          // Set streaming state
          setIsStreaming(true);

          // Short delay to show the loading state, then dispatch the image response
          setTimeout(() => {
            // Dispatch the ai-image-response event to replace the placeholder with actual images
            const responseDetail = {
              imageUrls: jsonData.images,
              prompt: jsonData.prompt || 'Image edit',
              placeholderId: placeholderId,
              parentMessageId: parentMessageId,
              aspectRatio: jsonData.aspectRatio || '1:1',
              sourceImageUrl: jsonData.sourceImageUrl,
              isComplete: true
            };

            console.log('[Page] Dispatching ai-image-response event:', responseDetail);
            window.dispatchEvent(new CustomEvent('ai-image-response', { detail: responseDetail }));

            // Reset streaming state
            setIsStreaming(false);

            // Dispatch stream completed event for notification sound
            window.dispatchEvent(new CustomEvent('ai-stream-completed', {
              detail: { timestamp: Date.now(), source: 'imageGeneration' }
            }));
          }, 500);

          return; // Exit early, don't process as streaming
        }
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulator = ''; // Initialize accumulator for metadata extraction
      let fullStreamedContent = '';

      // Reset the streaming content ref for this new message
      streamingContentRef.current = '';

      if (reader) {
        const streamingMessage: ExtendedMessage = {
          role: 'assistant',
          content: '',
          id: 'streaming',
          createdAt: new Date()
        };

        const commitStreamingMessage = () => {
          setMessages(prevMessages => prevMessages.map(msg => {
            if (msg.id === thinkingMessage.id || msg.id === streamingMessage.id) {
              setIsStreaming(true);
              setStreamingMessage(streamingMessage as StreamingMessage);
              return { ...streamingMessage };
            }
            return msg;
          }));
        };


        // Function to handle document reference function calls
        const handleDocumentReference = (content: string): boolean => {
          // More specific regex that ensures we capture complete JSON objects
          const documentReferenceRegex = /useDocument\s*\(\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\)/g;
          const matches = [...content.matchAll(documentReferenceRegex)];

          if (matches.length === 0) return false;

          try {
            // Track referenced documents
            const referencedDocs: any[] = [];

            // Process each match
            for (const match of matches) {
              const jsonStr = match[1];

              // Validate JSON string before parsing
              if (!jsonStr || jsonStr.trim() === '{}') {
                console.warn('Empty or invalid JSON in useDocument call:', jsonStr);
                continue;
              }

              try {
                // Clean up the JSON string
                const cleanedJson = jsonStr
                  .replace(/,\s*}/g, '}') // Remove trailing commas
                  .replace(/{\s*,/g, '{') // Remove leading commas
                  .trim();

                // Only parse if it looks like valid JSON
                if (cleanedJson.startsWith('{') && cleanedJson.endsWith('}')) {
                  const docRef = JSON.parse(cleanedJson);
                  console.log('Found document reference:', docRef);

                  // Validate required fields
                  if (docRef.documentId && docRef.documentName) {
                    referencedDocs.push({
                      id: docRef.documentId,
                      name: docRef.documentName,
                      filename: docRef.documentName,
                      content_preview: docRef.reason || '',
                      similarity: (docRef.relevance || 0) / 100, // Convert 0-100 to 0-1 scale
                      explicitly_referenced: true
                    });
                  } else {
                    console.warn('Document reference missing required fields:', docRef);
                  }
                }
              } catch (parseError) {
                console.error('Error parsing document reference JSON:', {
                  error: parseError,
                  jsonString: jsonStr,
                  cleanedJson: jsonStr.substring(0, 100) + '...'
                });
              }
            }

            if (referencedDocs.length === 0) return false;

            // Clean the content by removing function calls
            let cleanedContent = content;
            for (const match of matches) {
              cleanedContent = cleanedContent.replace(match[0], '');
            }
            cleanedContent = cleanedContent.trim();

            // Update streaming message
            if (typeof streamingMessage.content === 'string') {
              // Convert to array with text and document reference
              streamingMessage.content = [
                {
                  type: 'text',
                  text: cleanedContent
                },
                {
                  type: 'document_reference',
                  documents: referencedDocs
                }
              ];
            } else if (Array.isArray(streamingMessage.content)) {
              // Update the existing text part
              const textPart = streamingMessage.content.find(part => part.type === 'text');
              if (textPart && 'text' in textPart && textPart.text) {
                textPart.text = cleanedContent;
              }

              // Add document reference part
              const docPart = streamingMessage.content.find(part => part.type === 'document_reference');
              if (docPart && 'documents' in docPart) {
                // Update existing document reference
                docPart.documents = referencedDocs;
              } else {
                // Add new document reference
                streamingMessage.content.push({
                  type: 'document_reference',
                  documents: referencedDocs
                });
              }
            }

            console.log('Updated streaming message with document references:', referencedDocs);
            commitStreamingMessage();
            return true;
          } catch (error) {
            console.error('Error processing document references:', error);
            return false;
          }
        };



        let sseBuffer = '';
        let streamClosed = false;
        const toolCallNameById = new Map<string, string>();

        const updateStreamingText = (text: string) => {
          streamingContentRef.current = text;
          if (Array.isArray(streamingMessage.content)) {
            let textPart = streamingMessage.content.find(part => part.type === 'text');
            if (!textPart) {
              textPart = { type: 'text', text };
              streamingMessage.content.unshift(textPart);
            } else {
              textPart.text = text;
            }
          } else {
            streamingMessage.content = text;
          }
          commitStreamingMessage();
        };

        const applyDocumentReferencesFromMetadata = (documents: any[]) => {
          if (!Array.isArray(documents) || documents.length === 0) return;

          const normalizedDocs = documents.map(doc => ({
            id: doc.id || doc.documentId || doc.name || globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
            name: doc.name || doc.filename || doc.documentName || 'Document',
            filename: doc.filename || doc.name || doc.documentName,
            similarity: doc.similarity ?? (typeof doc.relevance === 'number' ? doc.relevance / 100 : undefined),
            content_preview: doc.content_preview || doc.matched_chunk || doc.reason || '',
            created_at: doc.created_at,
            uploadedAt: doc.uploadedAt,
            explicitly_referenced: doc.explicitly_referenced || doc.explicit || false
          }));

          const docPart: ContentPart = {
            type: 'document_reference',
            documents: normalizedDocs
          };

          if (Array.isArray(streamingMessage.content)) {
            const existingDocPart = streamingMessage.content.find(part => part.type === 'document_reference');
            if (existingDocPart) {
              existingDocPart.documents = normalizedDocs;
            } else {
              streamingMessage.content.push(docPart);
            }
          } else {
            streamingMessage.content = [
              { type: 'text', text: streamingContentRef.current || '' },
              docPart
            ];
          }

          commitStreamingMessage();
        };

        const handleSseEvent = (event: any) => {
          accumulator += JSON.stringify(event) + '\n';

          switch (event.type) {
            case 'text-start': {
              fullStreamedContent = '';
              updateStreamingText('');
              break;
            }
            case 'text-delta': {
              if (typeof event.delta === 'string') {
                fullStreamedContent += event.delta;
                updateStreamingText(fullStreamedContent);
                handleDocumentReference(fullStreamedContent);
              }
              break;
            }
            case 'text-end': {
              if (typeof event.text === 'string') {
                fullStreamedContent += event.text;
                updateStreamingText(fullStreamedContent);
                handleDocumentReference(fullStreamedContent);
              }
              break;
            }
            case 'generated_image': {
              // 🔧 FIX: Handle generated_image events from image editing/generation
              console.log('[Stream] Received generated_image event:', event);
              if (event.generated_images && Array.isArray(event.generated_images)) {
                // Add the generated image to the streaming message content
                if (Array.isArray(streamingMessage.content)) {
                  streamingMessage.content.push({
                    type: 'generated_image',
                    generated_images: event.generated_images,
                    aspectRatio: event.aspectRatio || 'auto',
                    sourceImageUrl: event.sourceImageUrl
                  });
                } else {
                  // Convert string content to array format with text and image
                  streamingMessage.content = [
                    { type: 'text', text: streamingMessage.content || fullStreamedContent },
                    {
                      type: 'generated_image',
                      generated_images: event.generated_images,
                      aspectRatio: event.aspectRatio || 'auto',
                      sourceImageUrl: event.sourceImageUrl
                    }
                  ];
                }
                commitStreamingMessage();
                console.log('[Stream] Added generated image to message content');
              }
              break;
            }
            case 'source_images': {
              // [FIX] Handle source_images events from backend's createUIMessageStream
              console.log('[Stream] Received source_images event:', event);
              if (event.source_images && Array.isArray(event.source_images) && event.source_images.length > 0) {
                // Add source images to the streaming message content
                const sourceImagesPart: ContentPart = {
                  type: 'source_images',
                  source_images: event.source_images
                };

                if (Array.isArray(streamingMessage.content)) {
                  // Check if source_images part already exists
                  const existingPart = streamingMessage.content.find((part: ContentPart) => part.type === 'source_images');
                  if (existingPart) {
                    existingPart.source_images = event.source_images;
                  } else {
                    // [FIX] Insert at BEGINNING so image stays on top while text streams below
                    streamingMessage.content.unshift(sourceImagesPart);
                  }
                } else {
                  // [FIX] Put source_images FIRST, then text
                  streamingMessage.content = [
                    sourceImagesPart,
                    { type: 'text', text: streamingContentRef.current || '' }
                  ];
                }

                commitStreamingMessage();
                console.log('[Stream] Added source_images to message content:', event.source_images.length, 'images');
              }
              break;
            }
            case 'metadata':
            case 'response-metadata': {
              // Handle usedDocuments for document references
              if (event.metadata?.usedDocuments) {
                applyDocumentReferencesFromMetadata(event.metadata.usedDocuments);
              }
              if (event.metadata?.documentSources) {
                applyDocumentReferencesFromMetadata(event.metadata.documentSources);
              }
              // [FIX] Also extract source images from usedDocuments with image_url
              if (event.usedDocuments && Array.isArray(event.usedDocuments)) {
                const imagesFromDocs = event.usedDocuments
                  .filter((doc: any) => doc.image_url)
                  .map((doc: any) => ({
                    name: doc.name || doc.filename || 'Source Image',
                    size: 0,
                    type: 'image/jpeg',
                    url: doc.image_url
                  }));
                if (imagesFromDocs.length > 0) {
                  console.log('[Stream] Extracted images from metadata usedDocuments:', imagesFromDocs.length);
                  const sourceImagesPart: ContentPart = {
                    type: 'source_images',
                    source_images: imagesFromDocs
                  };
                  if (Array.isArray(streamingMessage.content)) {
                    const existingPart = streamingMessage.content.find((part: ContentPart) => part.type === 'source_images');
                    if (!existingPart) {
                      streamingMessage.content.push(sourceImagesPart);
                      commitStreamingMessage();
                    }
                  }
                }
              }

              const webSearchMeta = event.metadata?.webSearch;
              if (webSearchMeta) {
                const resultsPayload = Array.isArray(webSearchMeta)
                  ? webSearchMeta
                  : Array.isArray((webSearchMeta as any).results)
                    ? (webSearchMeta as any).results
                    : Array.isArray((webSearchMeta as any).items)
                      ? (webSearchMeta as any).items
                      : Array.isArray((webSearchMeta as any).results?.results)
                        ? (webSearchMeta as any).results.results
                        : Array.isArray((webSearchMeta as any).results?.items)
                          ? (webSearchMeta as any).results.items
                          : Array.isArray((webSearchMeta as any).results)
                            ? (webSearchMeta as any).results
                            : [];

                if (resultsPayload.length > 0) {
                  if (process.env.NODE_ENV === 'development') {
                    console.log('[Stream] webSearch metadata results:', {
                      count: resultsPayload.length,
                      toolCallId: (webSearchMeta as any).toolCallId
                    });
                  }
                  const toolCallId = (webSearchMeta as any).toolCallId || `webSearch-${Date.now()}`;
                  const toolResultPart: ContentPart = {
                    type: 'tool-result',
                    toolName: 'webSearch',
                    toolCallId,
                    output: resultsPayload
                  };

                  if (Array.isArray(streamingMessage.content)) {
                    const existingPart = streamingMessage.content.find(
                      (part: ContentPart) =>
                        (part.type === 'tool-result' || part.type === 'tool_result') &&
                        part.toolCallId === toolCallId
                    );
                    if (existingPart) {
                      Object.assign(existingPart, toolResultPart);
                    } else {
                      streamingMessage.content.push(toolResultPart);
                    }
                  } else {
                    streamingMessage.content = [
                      { type: 'text', text: streamingContentRef.current || '' },
                      toolResultPart
                    ];
                  }

                  commitStreamingMessage();
                }
              }
              break;
            }
            case 'tool-result': {
              if (process.env.NODE_ENV === 'development') {
                const toolName = (event as any).toolName;
                const toolCallId = (event as any).toolCallId;
                const result = (event as any).result;
                const output = (event as any).output;
                const outputValue = output && typeof output === 'object' && 'value' in output ? (output as any).value : output;
                const resultKeys = result && typeof result === 'object' ? Object.keys(result as object) : [];
                const resultCount = Array.isArray(result) ? result.length : Array.isArray(result?.results) ? result.results.length : undefined;
                const outputKeys = output && typeof output === 'object' ? Object.keys(output as object) : [];
                const outputValueKeys = outputValue && typeof outputValue === 'object' ? Object.keys(outputValue as object) : [];
                const outputCount = Array.isArray(outputValue)
                  ? outputValue.length
                  : Array.isArray((outputValue as any)?.results)
                    ? (outputValue as any).results.length
                    : Array.isArray((outputValue as any)?.items)
                      ? (outputValue as any).items.length
                      : undefined;
                console.log('[Stream] tool-result event:', {
                  toolName,
                  toolCallId,
                  resultKeys,
                  resultCount,
                  outputKeys,
                  outputValueKeys,
                  outputCount
                });
              }
              const toolResultPart: ContentPart = {
                type: 'tool-result',
                toolName: (event as any).toolName,
                toolCallId: (event as any).toolCallId,
                result: (event as any).result,
                output: (event as any).output,
                isError: (event as any).isError
              };

              if (Array.isArray(streamingMessage.content)) {
                const existingPart = streamingMessage.content.find(
                  (part: ContentPart) =>
                    (part.type === 'tool-result' || part.type === 'tool_result') &&
                    part.toolCallId === toolResultPart.toolCallId
                );
                if (existingPart) {
                  Object.assign(existingPart, toolResultPart);
                } else {
                  streamingMessage.content.push(toolResultPart);
                }
              } else {
                streamingMessage.content = [
                  { type: 'text', text: streamingContentRef.current || '' },
                  toolResultPart
                ];
              }
              commitStreamingMessage();

              if (event.result?.usedDocuments) {
                applyDocumentReferencesFromMetadata(event.result.usedDocuments);
              } else if (event.output?.usedDocuments) {
                applyDocumentReferencesFromMetadata(event.output.usedDocuments);
              } else if (event.output?.value?.usedDocuments) {
                applyDocumentReferencesFromMetadata(event.output.value.usedDocuments);
              }
              break;
            }
            case 'tool-input-available': {
              const toolCallId = (event as any).toolCallId;
              const toolName = (event as any).toolName;
              if (toolCallId && toolName) {
                toolCallNameById.set(toolCallId, toolName);
              }
              break;
            }
            case 'tool-output-available': {
              const toolCallId = (event as any).toolCallId;
              const toolName = toolCallId ? toolCallNameById.get(toolCallId) : undefined;
              if (process.env.NODE_ENV === 'development') {
                const output = (event as any).output;
                const outputCount = Array.isArray(output)
                  ? output.length
                  : Array.isArray(output?.results)
                    ? output.results.length
                    : Array.isArray(output?.items)
                      ? output.items.length
                      : undefined;
                console.log('[Stream] tool-output-available:', { toolCallId, toolName, outputCount });
              }
              const toolResultPart: ContentPart = {
                type: 'tool-result',
                toolName,
                toolCallId,
                output: (event as any).output
              };

              if (Array.isArray(streamingMessage.content)) {
                const existingPart = streamingMessage.content.find(
                  (part: ContentPart) =>
                    (part.type === 'tool-result' || part.type === 'tool_result') &&
                    part.toolCallId === toolCallId
                );
                if (existingPart) {
                  Object.assign(existingPart, toolResultPart);
                } else {
                  streamingMessage.content.push(toolResultPart);
                }
              } else {
                streamingMessage.content = [
                  { type: 'text', text: streamingContentRef.current || '' },
                  toolResultPart
                ];
              }
              commitStreamingMessage();
              break;
            }
            case 'error': {
              console.error('Stream error event:', event);
              break;
            }
            case 'finish':
            case 'step-finish':
            case 'message-annotations':
            case 'tool-call':
            case 'tool-call-streaming-start':
            case 'tool-call-delta': {
              // Known event types that don't require handling in this context
              // Silently ignore to avoid console noise
              break;
            }
            default: {
              // Only log truly unknown event types
              const knownButUnhandled = ['finish', 'step-finish', 'message-annotations', 'tool-call', 'tool-call-streaming-start', 'tool-call-delta'];
              if (process.env.NODE_ENV === 'development' && !knownButUnhandled.includes(event.type)) {
                console.log('[Stream] Unknown SSE event type:', event.type, event);
              }
              break;
            }
          }
        };

        // Start reading the stream
        while (!streamClosed) {
          try {
            const { done, value } = await reader.read();

            if (done) {
              console.log('Stream complete');
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            sseBuffer += chunk;

            let eventBoundary = sseBuffer.indexOf('\n\n');
            while (eventBoundary !== -1) {
              const eventBlock = sseBuffer.slice(0, eventBoundary);
              sseBuffer = sseBuffer.slice(eventBoundary + 2);

              const dataLines = eventBlock
                .split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trim())
                .filter(Boolean);

              if (dataLines.length > 0) {
                const dataString = dataLines.join('');

                if (dataString === '[DONE]') {
                  streamClosed = true;
                  break;
                }

                try {
                  const event = JSON.parse(dataString);
                  // Debug log for generated images
                  if (isGeneratingImage && dataString.includes('generated_image')) {
                    console.log('Image generation event detected:', event);
                  }
                  handleSseEvent(event);
                } catch (error) {
                  console.error('Failed to parse SSE event:', dataString, error);
                }
              }

              eventBoundary = sseBuffer.indexOf('\n\n');
            }
          } catch (error) {
            console.error('Error reading from stream:', error);
            break;
          }
        }

        // After stream completes, manually trigger the onFinish logic
        // since we're not using the useChat hook's built-in streaming
        console.log('Manual stream complete - triggering onFinish logic');
        console.log('Accumulator content:', accumulator);
        console.log('Is generating image:', isGeneratingImage);

        // Check if accumulator contains generated_image metadata
        let generatedImageData = null;
        // Look for the data event with generated_image - try multiple patterns
        const patterns = [
          /d:(\{[\s\S]*?"generated_image"[\s\S]*?\})\s*$/m,
          /d:(\{[\s\S]*?"generated_image"[\s\S]*?\})/,
          /d:(\{[^}]*"generated_image"[^}]*\}(?:\})?)/
        ];

        let dataPayload = null;
        for (const pattern of patterns) {
          const match = accumulator.match(pattern);
          if (match && match[1]) {
            dataPayload = match[1];
            console.log('Found data payload with pattern:', pattern);
            break;
          }
        }

        if (dataPayload) {
          try {
            console.log('Attempting to parse data payload:', dataPayload);
            const metadata = JSON.parse(dataPayload);
            if (metadata.generated_image) {
              generatedImageData = metadata.generated_image;
              console.log('Extracted generated image data from stream:', generatedImageData);
            }
          } catch (error) {
            console.error('Error parsing generated image metadata:', error);
            console.error('Failed payload:', dataPayload);
          }
        } else {
          console.log('No generated_image data found in accumulator');
        }

        // Create the final message from the streamed content
        let finalContent = streamingContentRef.current || fullStreamedContent;

        // Clean up any metadata patterns that might have been included at the end
        // Remove e:{ and d:{ patterns that contain finishReason, usage, etc.
        finalContent = finalContent
          .replace(/[ed]:\s*\{[^}]*"finishReason"[^}]*\}/g, '')
          .replace(/[ed]:\s*\{[^}]*"usage"[^}]*\}/g, '')
          .replace(/[ed]:\s*\{[^}]*\}\s*$/g, '') // Remove any trailing metadata
          .trim();

        setMessages(prevMessages => {
          // Filter out streaming and thinking messages
          const filteredMessages = prevMessages.filter(msg => msg.id !== 'streaming' && msg.id !== 'thinking');

          // Create the final message with proper content
          let messageContent: string | ContentPart[] = finalContent;

          // [FIX] Check if streamingMessage has source_images parts that need to be preserved
          if (Array.isArray(streamingMessage?.content)) {
            const sourceImagesPart = streamingMessage.content.find(
              (part: ContentPart) => part.type === 'source_images'
            );
            const toolResultParts = streamingMessage.content.filter(
              (part: ContentPart) => part.type === 'tool-result' || part.type === 'tool_result'
            );

            if (sourceImagesPart || toolResultParts.length > 0) {
              if (sourceImagesPart) {
                console.log('[Manual onFinish] Preserving source_images from streaming message');
              }
              if (toolResultParts.length > 0) {
                console.log('[Manual onFinish] Preserving tool results from streaming message:', toolResultParts.length);
              }
              const dedupedToolResults = Array.from(
                new Map(
                  toolResultParts.map(part => [part.toolCallId || `${part.type}-${Math.random()}`, part])
                ).values()
              );
              // Create a proper content array with source_images first, then tool results, then text
              messageContent = [
                ...(sourceImagesPart ? [sourceImagesPart] : []),
                ...dedupedToolResults,
                { type: 'text', text: finalContent }
              ];
            }
          }

          // If we have generated image data, create proper content parts
          if (generatedImageData) {
            // Only include the generated image, no text
            messageContent = [
              {
                type: 'generated_image',
                generated_images: generatedImageData.generated_images,
                aspectRatio: generatedImageData.aspectRatio,
                ...(generatedImageData.sourceImageUrl
                  ? {
                    source_images: [
                      {
                        name: 'source-image',
                        size: 0,
                        type: 'image',
                        url: generatedImageData.sourceImageUrl
                      }
                    ]
                  }
                  : {})
              }
            ];
          }

          const finalMessage: ExtendedMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: messageContent,
            createdAt: new Date()
          };

          console.log('[Manual onFinish] Creating final message with content:', messageContent);

          // Store for database update
          const messagesWithFinal = [...filteredMessages, finalMessage];

          // Save to database using debounced save
          debouncedSave((isGhostMode || (currentChatId && currentChatId.startsWith('ghost-'))) ? null : currentChatId, messagesWithFinal);

          return messagesWithFinal;
        });

        // Reset streaming state
        setIsStreaming(false);
        setStreamingMessage(null);
        setIsGeneratingImage(false);
        console.log('Manual stream cleanup completed');

        // Clean up abort controller
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }

        // Dispatch the custom event to trigger notification sound
        if (typeof window !== 'undefined') {
          const streamCompletedEvent = new CustomEvent('ai-stream-completed', {
            detail: { timestamp: Date.now(), source: 'manual-onFinish' }
          });
          window.dispatchEvent(streamCompletedEvent);
          console.log('Dispatched ai-stream-completed event from manual stream completion');
        }

        // Clear the streaming timeout if it exists
        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current);
          streamTimeoutRef.current = null;
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        // Clean up the streaming state
        setMessages(prevMessages =>
          prevMessages.filter(msg => msg.id !== 'thinking' && msg.id !== 'streaming')
        );
      } else {
        console.error('Error in form submit:', error);
      }
      setIsGeneratingImage(false);

      // CHANGED: Use resetStreamingState instead of just setting isStreaming=false
      resetStreamingState();
    }
  };

  const handleSubmitRef = useLatestRef(handleSubmit);

  /**
   * Handles creating a new chat. The order of operations is critical:
   * 1. Reset input first to prevent any pending operations
   * 2. Handle error states
   * 3. Force a reset of the chat hook
   * 4. Clear chat state last
   * 
   * Logging is maintained throughout to help track state changes and debug issues.
   * The logs show the sequence of state updates and help verify correct behavior.
   */
  const handleNewChat = useCallback(async (closeSidebar: boolean) => {
    console.log('handleNewChat called with closeSidebar:', closeSidebar);

    // Reset all states
    setInput('');
    setMessages([]);
    clearFile();

    // Clear chat state
    setCurrentChat(null);
    setIsChatTransitionAnimating(false);

    // Reset MCP state for new chat
    try {
      await resetMcpForNewChat();
      clearMcpCache(); // Also clear the MCP cache
      console.log('MCP state and cache reset for new chat');
    } catch (error) {
      console.error('Error resetting MCP state:', error);
    }

    // Reset auto-scroll state for new chat
    scrollState.current = {
      shouldAutoScroll: true,
      userBrokeFromAutoScroll: false
    };

    // Reset UI states
    setShowScrollIndicator(false);
    setIsStreaming(false);
    setStreamingMessage(null);

    // Reset any error states
    if (error) {
      const cancellableError = error as CancellableError;
      if (typeof cancellableError.cancel === 'function') {
        console.log('Cancelling error');
        cancellableError.cancel();
      }
    }

    // Force a complete reset of the chat hook
    setChatResetKey(prev => prev + 1);

    // Close sidebar if requested
    if (closeSidebar) {
      console.log('Closing sidebar');
      setSidebarOpen(false);
    }

    // Scroll to top and reset scroll state
    if (chatContainerRef.current) {
      console.log('Scrolling to top');
      chatContainerRef.current.scrollTo({
        top: 0,
        behavior: 'instant'
      });
    }

    console.log('handleNewChat completed with full state reset');
  }, [
    chatContainerRef,
    clearFile,
    clearMcpCache,
    resetMcpForNewChat,
    setInput,
    setMessages,
    setCurrentChat,
    setIsChatTransitionAnimating,
    setShowScrollIndicator,
    setIsStreaming,
    setStreamingMessage,
    error,
    setChatResetKey,
    setSidebarOpen
  ]);

  const handleSelectChat = async (chat: Chat) => {
    console.log('[handleSelectChat] START - Chat:', chat.id);

    // CRITICAL FIX: Set switching flag IMMEDIATELY
    setIsSwitchingChat(true);
    setIsChatTransitionAnimating(true);

    // Use startTransition for non-urgent updates to prevent visual glitches
    startTransition(() => {
      // Set current chat ID - blocks welcome screen
      useChatStore.getState().setCurrentChat(chat.id);
      console.log('🔑 [handleSelectChat] State locked - isSwitchingChat=true, chatId=', chat.id);

      // Load messages synchronously within the transition
      if (chat.messages?.length) {
        console.log('📥 [handleSelectChat] Loading', chat.messages.length, 'messages');
        const convertedMessages = toExtendedMessages(chat.messages);
        setMessages(convertedMessages);
      } else {
        console.log('🧹 [handleSelectChat] Clearing messages for empty chat');
        setMessages([]);
      }
    });

    // Reset MCP state (async, doesn't block UI)
    resetMcpForNewChat().catch(err => console.error('Error resetting MCP state:', err));
    clearMcpCache();

    // Close sidebar on mobile
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }

    // CRITICAL FIX: Use minimal delay to unlock - startTransition handles the batching
    if (chatSwitchTimeoutRef.current) {
      clearTimeout(chatSwitchTimeoutRef.current);
    }

    chatSwitchTimeoutRef.current = setTimeout(() => {
      setIsSwitchingChat(false);
      console.log('✅ [handleSelectChat] COMPLETE - Transition unlocked, isSwitchingChat=false');
      chatSwitchTimeoutRef.current = null;
    }, 50); // 50ms is barely perceptible but ensures state commits

  };

  // Simple helper to check if at bottom
  const isAtBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return false;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - clientHeight - scrollTop <= 10;
  }, []);

  // CLEAN & SIMPLE: Scroll to bottom with no complex logic
  const scrollToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }, []);

  // CLEAN & SIMPLE: Auto-scroll during AI responses + Break Free detection
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    // BREAK FREE DETECTION: Simple wheel event listener
    const handleWheel = (e: WheelEvent) => {
      // User scrolling up during AI response - break free!
      if (e.deltaY < 0 && (isStreaming || isChatLoading)) {
        console.log('🚫 User scrolled up during AI response - breaking free from autoscroll');
        scrollState.current.userBrokeFromAutoScroll = true;
        scrollState.current.shouldAutoScroll = false;
      }
    };

    // Add wheel event listener
    container.addEventListener('wheel', handleWheel, { passive: true });

    // SIMPLE AUTO-SCROLL: Only during AI responses
    let autoScrollInterval: NodeJS.Timeout | null = null;

    if (isStreaming || isChatLoading) {
      console.log('🤖 AI responding - starting autoscroll');

      autoScrollInterval = setInterval(() => {
        if (scrollState.current.shouldAutoScroll && !scrollState.current.userBrokeFromAutoScroll) {
          scrollToBottom();
        }
      }, 400); // Every 400ms
    }

    // Cleanup
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
      }
    };
  }, [isStreaming, isChatLoading, scrollToBottom]);

  // RESET LOGIC: When AI response ends, reset flags for next response
  useEffect(() => {
    if (!isStreaming && !isChatLoading) {
      console.log('✅ AI response ended - resetting autoscroll for next response');
      scrollState.current.userBrokeFromAutoScroll = false;
      scrollState.current.shouldAutoScroll = true;

      // CRITICAL FIX: Do a final scroll after AI response ends to ensure action buttons are visible
      // This is especially important for Chrome iOS where the scroll can stop before buttons render
      const doFinalScroll = () => {
        const container = chatContainerRef.current;
        if (!container) return;

        // Check if we're on mobile
        const isMobile = window.innerWidth <= 640;
        const isChromeIOS = document.body.classList.contains('chrome-ios');

        // Calculate extra offset for action buttons (copy, read aloud, etc.)
        // Mobile needs more offset due to browser chrome, especially Chrome iOS
        let extraOffset = 0;
        if (isMobile) {
          extraOffset = isChromeIOS ? 150 : 120; // Safari iOS uses 120px, Chrome iOS uses 150px
        }

        // Scroll to absolute bottom plus extra offset
        const targetScroll = container.scrollHeight + extraOffset;
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });

        console.log(`📜 Final scroll after AI response - extra offset: ${extraOffset}px`);
      };

      // Wait for DOM to update with action buttons, then scroll
      // Use multiple delays to handle different rendering speeds
      requestAnimationFrame(() => {
        setTimeout(doFinalScroll, 100); // First attempt after 100ms
        setTimeout(doFinalScroll, 300); // Second attempt after 300ms for slower renders
      });

      // Update scroll indicator
      setShowScrollIndicator(!isAtBottom());
    }
  }, [isStreaming, isChatLoading, isAtBottom]);

  // Load chat messages for the current chat ID when the page loads
  // This needs to be after scrollToBottom is defined since it uses that function
  useEffect(() => {
    const loadCurrentChat = async () => {
      // CRITICAL: Skip if we're manually switching chats
      // This prevents race condition between manual loading and useEffect loading
      if (isSwitchingChat) {
        console.log('⏸️  Skipping loadCurrentChat - manual chat switch in progress');
        return;
      }

      if (!currentChatId) return;

      // Skip database loading for ghost/incognito chats
      if (currentChatId.startsWith('ghost-')) {
        console.log('Skipping database load for incognito chat:', currentChatId);
        return;
      }

      try {
        console.log('Loading chat messages for currentChatId:', currentChatId);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('chats')
          .select('*')
          .eq('id', currentChatId)
          .eq('user_id', user.id)
          .maybeSingle(); // Use maybeSingle instead of single to prevent errors when no rows are found

        if (error) {
          console.error('Error loading chat:', error);

          // If the chat doesn't exist, clear currentChatId from localStorage
          if (error.code === 'PGRST116') {
            console.log('Chat not found, clearing currentChatId');
            localStorage.removeItem('currentChatId');
            useChatStore.getState().setCurrentChat(null);
          }
          return;
        }

        if (!data) {
          console.log('Chat not found, clearing currentChatId');
          localStorage.removeItem('currentChatId');
          useChatStore.getState().setCurrentChat(null);
          return;
        }

        if (data && data.messages) {
          console.log('Successfully loaded chat messages');
          const loadedMessages = toExtendedMessages(data.messages);
          setMessages(loadedMessages);

          // More robust check for Gmail content - Removed

          isInitialLoadRef.current = true;

          // Small delay to ensure UI renders with messages before scrolling
          setTimeout(() => {
            scrollToBottom();
            isInitialLoadRef.current = false;
          }, 100);
        }
      } catch (error) {
        console.error('Error fetching current chat:', error);

        // Clean up if there's an error
        localStorage.removeItem('currentChatId');
        useChatStore.getState().setCurrentChat(null);
      } finally {
        // Reset UI state
        setStreamingMessage(null);
        setIsStreaming(false);

        // Update chat reset key to force user query input to reset
        setChatResetKey(prev => prev + 1);
      }
    };

    loadCurrentChat();
  }, [currentChatId, scrollToBottom, supabase, isSwitchingChat]);

  // Add handler for user image messages
  const handleUserImageMessage = useCallback((event: CustomEvent) => {
    if (!event.detail?.text) return;

    const prompt = event.detail.text;
    const sourceImages = event.detail.sourceImages || [];

    // Create a user message with the prompt text and source images
    const userMessage: ExtendedMessage = {
      id: uuidv4(),
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...(sourceImages.length > 0 ? [{
          type: 'source_images' as const,
          source_images: sourceImages
        }] : [])
      ],
      createdAt: new Date()
    };

    // Add the message to the chat
    setMessages(prevMessages => [...prevMessages, userMessage]);

  }, []);

  // Add handler for user video messages
  const handleUserVideoMessage = useCallback((event: CustomEvent) => {
    if (!event.detail?.text) return;

    const prompt = event.detail.text;
    const sourceImages = event.detail.sourceImages || [];

    console.log('🎬 handleUserVideoMessage received sourceImages:', sourceImages.length);
    console.log('🎬 Source images data received:', sourceImages);

    // Create a user message with the prompt text and source images
    const userMessage: ExtendedMessage = {
      id: uuidv4(),
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...(sourceImages.length > 0 ? [{
          type: 'source_images' as const,
          source_images: sourceImages
        }] : [])
      ],
      createdAt: new Date()
    };

    console.log('🎬 Created user message with content:', userMessage.content);

    // Add the message to the chat
    setMessages(prevMessages => [...prevMessages, userMessage]);

  }, []);

  // Add handler for video placeholder
  const handleAiVideoPlaceholder = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) {
      console.error('Missing ID in video placeholder event:', event.detail);
      return;
    }

    const { id, prompt, aspectRatio, resolution, frameCount } = event.detail;
    console.log('Creating video placeholder with ID:', id, { aspectRatio, resolution, frameCount });

    // Create a placeholder message for the video
    const placeholderMessage: ExtendedMessage = {
      id,
      role: 'assistant',
      content: [
        {
          type: 'loading_video' as const,
          id,
          progress: 0,
          aspectRatio: aspectRatio || '16:9',
          resolution: resolution || '720p',
          frameCount: frameCount || 129,
          status: 'Initializing video generation...'
        }
      ],
      createdAt: new Date()
    };

    console.log('Adding video placeholder message to chat:', placeholderMessage);

    // Add the placeholder message to the chat
    setMessages(prevMessages => {
      const newMessages = [...prevMessages, placeholderMessage];
      console.log('New messages state after adding placeholder:', newMessages.length);
      return newMessages;
    });

    // Start a timer to update the progress periodically
    let progress = 0;
    const statusMessages = [
      'Initializing video generation...',
      'Preparing video model...',
      'Submitting request to AI service...',
      'Waiting in queue...',
      'Starting video generation...',
      'Generating video frames...',
      'Processing video content...',
      'Rendering video...',
      'Finalizing video...',
      'Almost done...'
    ];
    let statusIndex = 0;

    const progressInterval = setInterval(() => {
      // Increment progress more slowly to reflect the longer generation time
      progress += Math.random() * 1.5; // Add between 0-1.5% each time

      // Cap at 90% - the final 10% will be set when the video is actually ready
      if (progress > 90) {
        progress = 90;
        clearInterval(progressInterval);
      }

      // Update status message every ~10% progress
      if (progress > (statusIndex + 1) * 10 && statusIndex < statusMessages.length - 1) {
        statusIndex++;
      }

      console.log('Updating video placeholder progress:', { id, progress, status: statusMessages[statusIndex] });

      // Update the placeholder message with new progress
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === id
            ? {
              ...msg,
              content: Array.isArray(msg.content)
                ? msg.content.map(part =>
                  part.type === 'loading_video'
                    ? {
                      ...part,
                      progress,
                      status: statusMessages[statusIndex]
                    }
                    : part
                )
                : msg.content
            }
            : msg
        )
      );
    }, 3000); // Update every 3 seconds

    // Store the interval ID so we can clear it when the video is ready
    window._videoProgressIntervals = window._videoProgressIntervals || {};
    window._videoProgressIntervals[id] = progressInterval;

  }, []);

  // Add handler for video progress updates
  const handleAiVideoProgress = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) return;

    const { id, progress, status } = event.detail;
    console.log('Received video progress update:', { id, progress, status });

    // Clear the automatic progress interval if it exists
    if (window._videoProgressIntervals && window._videoProgressIntervals[id]) {
      clearInterval(window._videoProgressIntervals[id]);
      delete window._videoProgressIntervals[id];
    }

    // Update the placeholder message with the actual progress from the server
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === id
          ? {
            ...msg,
            content: Array.isArray(msg.content)
              ? msg.content.map(part =>
                part.type === 'loading_video'
                  ? {
                    ...part,
                    progress: progress || part.progress,
                    status: status || part.status
                  }
                  : part
              )
              : msg.content
          }
          : msg
      )
    );

    // If progress is 100%, we're done, but keep the placeholder until the video URL arrives
    if (progress === 100) {
      console.log('Video generation completed, waiting for URL...');
    }
  }, []);

  // Add handler for video error
  const handleAiVideoError = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) return;

    const { id, error } = event.detail;

    // Clear the progress update interval for this placeholder
    if (window._videoProgressIntervals && window._videoProgressIntervals[id]) {
      clearInterval(window._videoProgressIntervals[id]);
      delete window._videoProgressIntervals[id];
    }

    // Update the placeholder message with the error
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === id
          ? {
            ...msg,
            content: Array.isArray(msg.content)
              ? msg.content.map(part =>
                part.type === 'loading_video'
                  ? {
                    ...part,
                    progress: 0,
                    status: `Error: ${error || 'Failed to generate video'}`
                  }
                  : part
              )
              : msg.content
          }
          : msg
      )
    );
  }, []);

  // Add handler for AI video response
  const handleAiVideoResponse = useCallback((event: CustomEvent) => {
    if (!event.detail?.videoUrl || !event.detail?.placeholderId) {
      console.error('Invalid video response data:', event.detail);
      return;
    }

    console.log('Handling AI video response:', event.detail);

    // Clear the progress update interval for this placeholder
    if (window._videoProgressIntervals && window._videoProgressIntervals[event.detail.placeholderId]) {
      clearInterval(window._videoProgressIntervals[event.detail.placeholderId]);
      delete window._videoProgressIntervals[event.detail.placeholderId];
    }

    // Replace the placeholder with the actual video
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === event.detail.placeholderId
          ? {
            ...msg,
            content: [
              {
                type: 'generated_video' as const,
                video_url: event.detail.videoUrl,
                // Add a flag to indicate if this is a local blob URL that should not be saved to the database
                is_local_blob: event.detail.isLocalBlob
              }
            ]
          }
          : msg
      )
    );

    // Only save to chat history if this is not a local blob URL
    if (!event.detail.isLocalBlob) {
      // Save the updated messages to the chat history
      const sourceMessages = messagesRef.current;
      const updatedMessages = sourceMessages.map(msg =>
        msg.id === event.detail.placeholderId
          ? {
            ...msg,
            content: [
              {
                type: 'generated_video' as const,
                video_url: event.detail.videoUrl
              }
            ]
          }
          : msg
      );

      // Use a timeout to ensure the state has been updated before saving
      setTimeout(() => {
        const activeChatId = currentChatIdRef.current;
        if (activeChatId) {
          // Update existing chat
          updateChatRef.current(activeChatId, toDBMessages(updatedMessages));
        } else {
          // Create new chat if this is a meaningful interaction
          const hasUserMessage = updatedMessages.some(msg => msg.role === 'user');
          const hasAiResponse = updatedMessages.some(msg =>
            msg.role === 'assistant' &&
            Array.isArray(msg.content) &&
            msg.content.some(part => part.type === 'generated_video')
          );

          if (hasUserMessage && hasAiResponse) {
            safeCreateChatRef.current(toDBMessages(updatedMessages));
          }
        }
        delete window._saveImageChatTimeout;
      }, 500);
    } else {
      console.log('Not saving local blob URL to chat history');
    }
  }, []);

  // Add listener for user-image-message events
  useEffect(() => {
    const handleUserImageMessageEvent = (event: Event) => {
      handleUserImageMessage(event as CustomEvent);
    };

    window.addEventListener('user-image-message', handleUserImageMessageEvent);

    return () => {
      window.removeEventListener('user-image-message', handleUserImageMessageEvent);
    };
  }, [handleUserImageMessage]);

  // Add listener for user-video-message events
  useEffect(() => {
    const handleUserVideoMessageEvent = (event: Event) => {
      handleUserVideoMessage(event as CustomEvent);
    };

    window.addEventListener('user-video-message', handleUserVideoMessageEvent);

    return () => {
      window.removeEventListener('user-video-message', handleUserVideoMessageEvent);
    };
  }, [handleUserVideoMessage]);

  // Add listener for ai-video-placeholder events
  useEffect(() => {
    const handleAiVideoPlaceholderEvent = (event: Event) => {
      handleAiVideoPlaceholder(event as CustomEvent);
    };

    window.addEventListener('ai-video-placeholder', handleAiVideoPlaceholderEvent);

    return () => {
      window.removeEventListener('ai-video-placeholder', handleAiVideoPlaceholderEvent);
    };
  }, [handleAiVideoPlaceholder]);

  // Add listener for ai-video-progress events
  useEffect(() => {
    const handleAiVideoProgressEvent = (event: Event) => {
      handleAiVideoProgress(event as CustomEvent);
    };

    window.addEventListener('ai-video-progress', handleAiVideoProgressEvent);

    return () => {
      window.removeEventListener('ai-video-progress', handleAiVideoProgressEvent);
    };
  }, [handleAiVideoProgress]);

  // Add listener for ai-video-error events
  useEffect(() => {
    const handleAiVideoErrorEvent = (event: Event) => {
      handleAiVideoError(event as CustomEvent);
    };

    window.addEventListener('ai-video-error', handleAiVideoErrorEvent);

    return () => {
      window.removeEventListener('ai-video-error', handleAiVideoErrorEvent);
    };
  }, [handleAiVideoError]);

  // Add listener for ai-video-response events
  useEffect(() => {
    const handleAiVideoResponseEvent = (event: Event) => {
      handleAiVideoResponse(event as CustomEvent);
    };

    window.addEventListener('ai-video-response', handleAiVideoResponseEvent);

    return () => {
      window.removeEventListener('ai-video-response', handleAiVideoResponseEvent);
    };
  }, [handleAiVideoResponse]);

  // Add handler for image placeholders
  const handleAiImagePlaceholders = useCallback((event: CustomEvent<{ placeholders: ImagePlaceholder[] }>) => {
    if (!event.detail?.placeholders || !Array.isArray(event.detail.placeholders)) {
      console.error('Invalid image placeholders data:', event.detail);
      return;
    }

    console.log('Handling AI image placeholders:', event.detail);

    const placeholders = event.detail.placeholders;
    if (!placeholders[0]?.parentMessageId) {
      console.error('Missing parentMessageId in placeholder');
      return;
    }
    // All placeholders should share the same parentMessageId
    const parentMessageId = placeholders[0].parentMessageId;

    setMessages(prevMessages => {
      // Remove any existing placeholder messages for this generation
      const messagesWithoutPlaceholders = prevMessages.filter(msg =>
        msg.id !== parentMessageId &&
        (!Array.isArray(msg.content) ||
          !msg.content.some(part =>
            part.type === 'loading_image' &&
            placeholders.some(p => p.id === part.id)
          )
        )
      );

      // Create loading placeholders for all images at once
      const placeholderMessage: ExtendedMessage = {
        id: parentMessageId,
        role: 'assistant',
        content: placeholders.map(placeholder => ({
          type: 'loading_image' as const,
          id: placeholder.id,
          count: placeholder.count,
          total: placeholder.total,
          status: `Generating image ${placeholder.count} of ${placeholder.total}...`
        })),
        createdAt: new Date()
      };

      console.log('Adding image placeholders message to chat:', placeholderMessage);
      return [...messagesWithoutPlaceholders, placeholderMessage];
    });
  }, [setMessages]);

  // Add handler for image progress updates
  const handleAiImageProgress = useCallback((event: CustomEvent<ImageProgressDetail>) => {
    const { placeholderId, parentMessageId, count, total, status } = event.detail;

    if (!parentMessageId) {
      console.error('Missing parentMessageId in progress event');
      return;
    }

    setMessages(prevMessages => {
      // Skip update if we don't have this message
      if (!prevMessages.some(msg => msg.id === parentMessageId)) {
        return prevMessages;
      }

      return prevMessages.map(msg => {
        if (msg.id === parentMessageId) {
          // Find the specific placeholder to update
          const content = Array.isArray(msg.content) ? msg.content : [];
          const updatedContent = content.map(part => {
            if (part.type === 'loading_image' && part.id === placeholderId) {
              return {
                ...part,
                count,
                total,
                status
              };
            }
            return part;
          });

          return {
            ...msg,
            content: updatedContent
          };
        }
        return msg;
      });
    });
  }, [setMessages]);

  // Add handler for AI image response
  const handleAiImageResponse = useCallback((event: CustomEvent<ImageResponseDetail>) => {
    if (!event.detail?.imageUrls || !Array.isArray(event.detail.imageUrls) || !event.detail?.placeholderId) {
      console.error('Invalid image response data:', event.detail);
      return;
    }

    console.log('Handling AI image response:', event.detail);

    const { imageUrls, placeholderId, parentMessageId, aspectRatio, sourceImageUrl, isComplete } = event.detail;

    if (!imageUrls?.length || !parentMessageId) {
      console.error('Missing required data:', { imageUrls, parentMessageId });
      return;
    }

    // Replace the placeholder with the actual images
    setMessages(prevMessages => {
      const updatedMessages = prevMessages.map(msg => {
        if (msg.id === parentMessageId) {
          return {
            ...msg,
            content: imageUrls.map((url: string) => ({
              type: 'generated_image' as const,
              generated_images: [url],
              aspectRatio: aspectRatio || '1:1',
              ...(sourceImageUrl
                ? {
                  source_images: [
                    {
                      name: 'source-image',
                      size: 0,
                      type: 'image',
                      url: sourceImageUrl
                    }
                  ]
                }
                : {})
            }))
          };
        }
        return msg;
      });
      return updatedMessages;
    });

    // Save chat only after all images are loaded - moved OUTSIDE of setState
    if (isComplete && !isChatLoadingRef.current) {
      // Use a debounced save to prevent duplicate saves
      if (window._saveImageChatTimeout) {
        clearTimeout(window._saveImageChatTimeout);
      }

      window._saveImageChatTimeout = setTimeout(async () => {
        // Get fresh messages from state
        const baseMessages = messagesRef.current;
        const currentMessages = baseMessages.filter(msg => {
          // Include the updated message
          if (msg.id === parentMessageId) return true;
          // Include all other messages
          return true;
        }).map(msg => {
          // Apply the same transformation that was done in setState
          if (msg.id === parentMessageId) {
            return {
              ...msg,
              content: imageUrls.map((url: string) => ({
                type: 'generated_image' as const,
                generated_images: [url],
                aspectRatio: aspectRatio || '1:1',
                ...(sourceImageUrl
                  ? {
                    source_images: [
                      {
                        name: 'source-image',
                        size: 0,
                        type: 'image',
                        url: sourceImageUrl
                      }
                    ]
                  }
                  : {})
              }))
            };
          }
          return msg;
        });

        const activeChatId = currentChatIdRef.current;
        if (activeChatId) {
          // Update existing chat
          await updateChatRef.current(activeChatId, toDBMessages(currentMessages));
        } else {
          // Create new chat if this is a meaningful interaction
          const hasUserMessage = currentMessages.some(msg => msg.role === 'user');
          const hasAiResponse = currentMessages.some(msg =>
            msg.role === 'assistant' &&
            Array.isArray(msg.content) &&
            msg.content.some(part => part.type === 'generated_image')
          );

          if (hasUserMessage && hasAiResponse) {
            await safeCreateChatRef.current(toDBMessages(currentMessages));
          }
        }
        delete window._saveImageChatTimeout;
      }, 1000); // Wait 1 second before saving to prevent duplicate saves
    }
  }, []);

  // Add listener for ai-image-progress events
  useEffect(() => {
    const handleAiImageProgressEvent = (event: Event) => {
      handleAiImageProgress(event as CustomEvent<ImageProgressDetail>);
    };

    window.addEventListener('ai-image-progress', handleAiImageProgressEvent as EventListener);

    return () => {
      window.removeEventListener('ai-image-progress', handleAiImageProgressEvent as EventListener);
    };
  }, [handleAiImageProgress]);

  // Add listener for ai-image-placeholders events
  useEffect(() => {
    const handleAiImagePlaceholdersEvent = (event: Event) => {
      handleAiImagePlaceholders(event as CustomEvent<{ placeholders: ImagePlaceholder[] }>);
    };

    window.addEventListener('ai-image-placeholders', handleAiImagePlaceholdersEvent as EventListener);

    return () => {
      window.removeEventListener('ai-image-placeholders', handleAiImagePlaceholdersEvent as EventListener);
    };
  }, [handleAiImagePlaceholders]);

  // Add listener for ai-image-response events
  useEffect(() => {
    const handleAiImageResponseEvent = (event: Event) => {
      handleAiImageResponse(event as CustomEvent<ImageResponseDetail>);
    };

    window.addEventListener('ai-image-response', handleAiImageResponseEvent as EventListener);

    return () => {
      window.removeEventListener('ai-image-response', handleAiImageResponseEvent as EventListener);
    };
  }, [handleAiImageResponse]);

  // Add listener for multi-step MCP trigger events
  useEffect(() => {
    const handleMultiStepMcpTrigger = (event: CustomEvent) => {
      console.log('📝 [MULTI-STEP] Received MCP trigger event:', event.detail);

      const { step, query, metadata } = event.detail;

      // Show a notification or indicator that we're proceeding to the next step
      if (step && query) {
        console.log('📝 [MULTI-STEP] Processing next step:', step.type, '-', query);

        // Add a system message indicating we're proceeding to the next step
        const systemMessage: ExtendedMessage = {
          id: nanoid(),
          role: 'system',
          content: `📝 Processing step ${metadata.currentStepIndex + 2} of ${metadata.totalSteps}: ${step.text}`,
          createdAt: new Date(),
        };

        setMessages(prevMessages => [...prevMessages, systemMessage]);

        // Auto-submit the next step query after a brief delay
        setTimeout(() => {
          // Set the input to the next step query
          setInput(query);

          // Trigger the submission
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          const form = document.querySelector('form');
          if (form) {
            form.dispatchEvent(submitEvent);
          } else {
            // Fallback: directly call handleSubmit
            const submitEvent = { preventDefault: () => { } } as any;
            handleSubmitRef.current?.(submitEvent);
          }
        }, 500);
      }
    };

    window.addEventListener('multi-step-mcp-trigger', handleMultiStepMcpTrigger as EventListener);

    return () => {
      window.removeEventListener('multi-step-mcp-trigger', handleMultiStepMcpTrigger as EventListener);
    };
  }, [setInput, setMessages, handleSubmitRef]);

  // Add handler for AI image errors
  const handleAiImageError = useCallback((event: CustomEvent<ImageErrorDetail>) => {
    const { placeholderId, error } = event.detail;

    console.log('Handling AI image error:', event.detail);

    // Update the placeholder to show the error
    setMessages(prevMessages => {
      return prevMessages.map(msg => {
        if (Array.isArray(msg.content)) {
          const updatedContent = msg.content.map(part => {
            if (part.type === 'loading_image' && part.id === placeholderId) {
              return {
                ...part,
                status: error,
                // Indicate error state - the component will handle the display
              };
            }
            return part;
          });

          return {
            ...msg,
            content: updatedContent
          };
        }
        return msg;
      });
    });
  }, [setMessages]);

  // Add listener for ai-image-error events
  useEffect(() => {
    const handleAiImageErrorEvent = (event: Event) => {
      handleAiImageError(event as CustomEvent<ImageErrorDetail>);
    };

    window.addEventListener('ai-image-error', handleAiImageErrorEvent as EventListener);

    return () => {
      window.removeEventListener('ai-image-error', handleAiImageErrorEvent as EventListener);
    };
  }, [handleAiImageError]);

  // Function to adjust chat container position when dialog opens
  useEffect(() => {
    const adjustForDialog = () => {
      const chatContainer = chatContainerRef.current;
      if (!chatContainer) return;

      // If a dialog is open, ensure the chat container uses full width
      if (document.body.classList.contains('dialog-open')) {
        // Force container to full width with no margins/padding
        chatContainer.style.width = '100%';
        chatContainer.style.maxWidth = '100%';
        chatContainer.style.right = '0';
        chatContainer.style.left = '0';
        chatContainer.style.marginRight = '0';
        chatContainer.style.paddingRight = '0';

        // Apply additional styles to ensure scrollbar reaches edge
        chatContainer.style.position = 'absolute';
        chatContainer.style.overflowX = 'hidden';

        // Force document width to viewport
        document.documentElement.style.width = '100%';
        document.documentElement.style.overflowX = 'hidden';
        document.body.style.width = '100%';
        document.body.style.overflowX = 'hidden';

        // Fix scrollbar to edge with custom styles
        const style = document.createElement('style');
        style.id = 'edge-scrollbar-fix';
        style.textContent = `
          .absolute.inset-0.overflow-y-auto.scrollbar.scroll-container::-webkit-scrollbar {
            position: fixed !important;
            right: 0 !important;
            width: 10px !important;
            height: 100vh !important;
            z-index: 9999 !important;
          }
        `;
        document.head.appendChild(style);

        // Add padding to inner content
        const contentContainer = chatContainer.querySelector('div');
        if (contentContainer) {
          contentContainer.style.paddingRight = '15px';
          contentContainer.style.maxWidth = '52rem';
          contentContainer.style.margin = '0 auto';
        }
      } else {
        // Reset all styles when dialog is closed
        chatContainer.style.width = '';
        chatContainer.style.maxWidth = '';
        chatContainer.style.right = '';
        chatContainer.style.left = '';
        chatContainer.style.marginRight = '';
        chatContainer.style.paddingRight = '';
        chatContainer.style.position = '';
        chatContainer.style.overflowX = '';

        // Reset document styles
        document.documentElement.style.width = '';
        document.documentElement.style.overflowX = '';
        document.body.style.width = '';
        document.body.style.overflowX = '';

        // Remove custom style element if it exists
        const styleElement = document.getElementById('edge-scrollbar-fix');
        if (styleElement) {
          styleElement.remove();
        }

        // Reset inner content container
        const contentContainer = chatContainer.querySelector('div');
        if (contentContainer) {
          contentContainer.style.paddingRight = '';
          contentContainer.style.maxWidth = '';
          contentContainer.style.margin = '';
        }
      }
    };

    // Initial check
    adjustForDialog();

    // Create observer to monitor body class changes
    const observer = new MutationObserver(adjustForDialog);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      // Create a function to fix the scrollbar
      const fixScrollbar = () => {
        const containerElement = chatContainerRef.current;
        if (!containerElement) {
          return;
        }

        // Add a style tag with high specificity CSS
        const style = document.createElement('style');
        style.id = 'scrollbar-edge-fix';
        style.textContent = `
          /* Force scrollbar to edge with fixed position */
          .chat-message-container::-webkit-scrollbar {
            position: fixed !important;
            right: 0 !important;
            width: 3px !important;
            border: none !important;
          }
          
          /* Force container to full width */
          .chat-message-container {
            width: 100vw !important;
            margin-right: 0 !important;
            padding-right: 0 !important;
            box-sizing: border-box !important;
            scrollbar-width: thin !important;
            -ms-overflow-style: thin !important;
          }
          
          /* Ensure we don't affect the content inside */
          .chat-message-container > div {
            max-width: 52rem !important;
            margin: 0 auto !important;
            width: 100% !important;
          }
        `;

        // Remove any existing fix
        const existingStyle = document.getElementById('scrollbar-edge-fix');
        if (existingStyle) {
          existingStyle.remove();
        }

        // Add new style
        document.head.appendChild(style);

        // Direct style application to the container
        containerElement.style.width = '100vw';
        containerElement.style.maxWidth = '100vw';
        containerElement.style.right = '0';
        containerElement.style.marginRight = '0';
        containerElement.style.paddingRight = '0';

        // Apply scrollbar styles directly with a more specific approach
        containerElement.style.setProperty('--scrollbar-width', '3px', 'important');

        // Apply direct element styles for maximum compatibility
        containerElement.setAttribute(
          'style',
          `${containerElement.getAttribute('style') ?? ''}; --scrollbar-width: 3px !important; scrollbar-width: thin !important;`
        );

        // Force webkit scrollbar width explicitly with inline styles
        const styleTag = document.createElement('style');
        styleTag.id = 'inline-scrollbar-width-fix';
        styleTag.textContent = `
          #main-chat-container::-webkit-scrollbar {
            width: 3px !important;
          }
        `;
        document.head.appendChild(styleTag);

        // Force a repaint to ensure styles are applied
        void containerElement.offsetHeight;
      };

      // Apply the fix
      fixScrollbar();

      // Re-apply on window resize
      window.addEventListener('resize', fixScrollbar);

      // Observer for dialog state changes
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'class' &&
            (document.body.classList.contains('dialog-open') ||
              !document.body.classList.contains('dialog-open'))) {
            // Re-apply when dialog state changes
            setTimeout(fixScrollbar, 100); // Small delay to ensure DOM is updated
          }
        }
      });

      // Start observing dialog state changes
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

      // Clean up
      return () => {
        window.removeEventListener('resize', fixScrollbar);
        observer.disconnect();
        const style = document.getElementById('scrollbar-edge-fix');
        if (style) {
          style.remove();
        }
        const inlineStyle = document.getElementById('inline-scrollbar-width-fix');
        if (inlineStyle) {
          inlineStyle.remove();
        }
      };
    }
  }, [chatContainerRef]);

  // No cleanup needed for the new auto-scroll controller

  // Simple scroll indicator management - the auto-scroll controller handles the rest
  useEffect(() => {
    const chatContainer = chatContainerRef.current;
    if (!chatContainer) return;

    const checkTimeout = setTimeout(() => {
      const { scrollTop, scrollHeight, clientHeight } = chatContainer;
      const hasScrollableContent = scrollHeight > clientHeight + 5;
      const isAtBottom = scrollHeight - clientHeight - scrollTop <= 5;

      // Update scroll indicator - only show when not at bottom and scrolled away
      setShowScrollIndicator(hasScrollableContent && !isAtBottom);
    }, 100);

    return () => clearTimeout(checkTimeout);
  }, [messages]);

  // Mutation observer functionality is now handled by the auto-scroll controller

  // OLD COMPLEX AUTO-SCROLL CODE REMOVED
  // Replaced with simple approach in the wheel event handler above

  // Add handler for user 3D message
  const handleUser3DMessage = useCallback((event: CustomEvent) => {
    if (!event.detail) {
      console.error('Missing details in user 3D message event:', event.detail);
      return;
    }

    console.log('Handling user 3D message:', event.detail);

    // Create a user message for the 3D model request
    const userMessage: ExtendedMessage = {
      id: uuidv4(),
      role: 'user',
      content: event.detail.contentParts || [
        {
          type: 'text',
          text: event.detail.text || t('threeDModel')
        }
      ],
      createdAt: new Date()
    };

    // Add the user message to the chat
    setMessages(prevMessages => [...prevMessages, userMessage]);
  }, [t]);

  // Add handler for 3D model placeholder
  const handleAi3DPlaceholder = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) {
      console.error('Missing ID in 3D model placeholder event:', event.detail);
      return;
    }

    const { id, prompt, textureSize, meshSimplify, ssSamplingSteps, texturedMesh } = event.detail;
    console.log('Creating 3D model placeholder with ID:', id);

    // Create a placeholder message for the 3D model
    const placeholderMessage: ExtendedMessage = {
      id,
      role: 'assistant',
      content: [
        {
          type: 'loading_3d_model' as const,
          id,
          prompt,
          progress: 0,
          textureSize,
          meshSimplify,
          ssSamplingSteps,
          texturedMesh,
          status: 'Initializing 3D model generation...'
        }
      ],
      createdAt: new Date()
    };

    console.log('Adding 3D model placeholder message to chat:', placeholderMessage);

    // Add the placeholder message to the chat
    setMessages(prevMessages => [...prevMessages, placeholderMessage]);
  }, []);

  // Add handler for 3D model progress updates
  const handleAi3DProgress = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) return;

    const { id, progress, status } = event.detail;
    console.log('Received 3D model progress update:', { id, progress, status });

    // Update the placeholder message with the progress from the server
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === id
          ? {
            ...msg,
            content: Array.isArray(msg.content)
              ? msg.content.map(part =>
                part.type === 'loading_3d_model'
                  ? {
                    ...part,
                    progress: progress || part.progress,
                    status: status || part.status
                  }
                  : part
              )
              : msg.content
          }
          : msg
      )
    );
  }, []);

  // Add handler for 3D model error
  const handleAi3DError = useCallback((event: CustomEvent) => {
    if (!event.detail?.id) return;

    const { id, error } = event.detail;
    console.log('Received 3D model error:', { id, error });

    // Update the placeholder message with the error
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === id
          ? {
            ...msg,
            content: Array.isArray(msg.content)
              ? [
                ...msg.content.filter(part => part.type !== 'loading_3d_model'),
                {
                  type: 'text' as const,
                  text: `Error generating 3D model: ${error || 'Unknown error'}`
                }
              ]
              : `Error generating 3D model: ${error || 'Unknown error'}`
          }
          : msg
      )
    );
  }, []);

  // Add handler for 3D model response
  const handleAi3DResponse = useCallback((event: CustomEvent) => {
    if (!event.detail?.modelUrl || !event.detail?.placeholderId) {
      console.error('Invalid 3D model response data:', event.detail);
      return;
    }

    console.log('Handling AI 3D model response:', event.detail);

    // Extract extra data if available
    const extraData = event.detail.extraData || {};
    // Make sure we only use valid string URLs
    const colorVideo = typeof extraData.colorVideo === 'string' ? extraData.colorVideo : null;
    const normalVideo = typeof extraData.normalVideo === 'string' ? extraData.normalVideo : null;
    const combinedVideo = typeof extraData.combinedVideo === 'string' ? extraData.combinedVideo : null;
    const gaussianPly = typeof extraData.gaussianPly === 'string' ? extraData.gaussianPly : null;

    // Replace the placeholder with the actual 3D model
    setMessages(prevMessages => {
      const updatedMessages = prevMessages.map(msg =>
        msg.id === event.detail.placeholderId
          ? {
            ...msg,
            content: [
              {
                type: 'generated_3d_model' as const,
                url: event.detail.modelUrl,
                model_url: event.detail.modelUrl,
                prompt: undefined
              },
              // Add video renders if available
              ...(combinedVideo ? [{
                type: 'text' as const,
                text: "Combined Video Render:"
              }, {
                type: 'generated_video' as const,
                video_url: combinedVideo
              }] : []),
              ...(colorVideo && !combinedVideo ? [{
                type: 'text' as const,
                text: "Color Video Render:"
              }, {
                type: 'generated_video' as const,
                video_url: colorVideo
              }] : [])
            ]
          }
          : msg
      );
      return updatedMessages;
    });

    // Save chat after 3D model is loaded - moved OUTSIDE of setState
    if (event.detail.isComplete && !isChatLoadingRef.current) {
      // Use a debounced save to prevent duplicate saves
      if (window._save3DChatTimeout) {
        clearTimeout(window._save3DChatTimeout);
      }

      window._save3DChatTimeout = setTimeout(async () => {
        console.log('Saving 3D model chat to database');
        // Get fresh messages from state
        const baseMessages = messagesRef.current;
        const currentMessages = baseMessages.map(msg => {
          // Apply the same transformation that was done in setState
          if (msg.id === event.detail.placeholderId) {
            return {
              ...msg,
              content: [
                {
                  type: 'generated_3d_model' as const,
                  url: event.detail.modelUrl,
                  model_url: event.detail.modelUrl,
                  prompt: undefined
                },
                // Add video renders if available
                ...(combinedVideo ? [{
                  type: 'text' as const,
                  text: "Combined Video Render:"
                }, {
                  type: 'generated_video' as const,
                  video_url: combinedVideo
                }] : []),
                ...(colorVideo && !combinedVideo ? [{
                  type: 'text' as const,
                  text: "Color Video Render:"
                }, {
                  type: 'generated_video' as const,
                  video_url: colorVideo
                }] : [])
              ]
            };
          }
          return msg;
        });

        const activeChatId = currentChatIdRef.current;
        if (activeChatId) {
          // Update existing chat
          await updateChatRef.current(activeChatId, toDBMessages(currentMessages));
        } else {
          // Create new chat if this is a meaningful interaction
          const hasUserMessage = currentMessages.some(msg => msg.role === 'user');
          const hasAiResponse = currentMessages.some(msg =>
            msg.role === 'assistant' &&
            Array.isArray(msg.content) &&
            msg.content.some(part => part.type === 'generated_3d_model')
          );

          if (hasUserMessage && hasAiResponse) {
            await safeCreateChatRef.current(toDBMessages(currentMessages));
          }
        }
        delete window._save3DChatTimeout;
      }, 1000); // Wait 1 second before saving to prevent duplicate saves
    }
  }, []);

  // Add listener for 3D model events
  useEffect(() => {
    const handleUser3DMessageEvent = (event: Event) => {
      handleUser3DMessage(event as CustomEvent);
    };

    const handleAi3DPlaceholderEvent = (event: Event) => {
      handleAi3DPlaceholder(event as CustomEvent);
    };

    const handleAi3DProgressEvent = (event: Event) => {
      handleAi3DProgress(event as CustomEvent);
    };

    const handleAi3DErrorEvent = (event: Event) => {
      handleAi3DError(event as CustomEvent);
    };

    const handleAi3DResponseEvent = (event: Event) => {
      handleAi3DResponse(event as CustomEvent);
    };

    // Add event listeners
    window.addEventListener('user-3d-message', handleUser3DMessageEvent);
    window.addEventListener('ai-3d-placeholder', handleAi3DPlaceholderEvent);
    window.addEventListener('ai-3d-progress', handleAi3DProgressEvent);
    window.addEventListener('ai-3d-error', handleAi3DErrorEvent);
    window.addEventListener('ai-3d-response', handleAi3DResponseEvent);

    // Return a cleanup function
    return () => {
      window.removeEventListener('user-3d-message', handleUser3DMessageEvent);
      window.removeEventListener('ai-3d-placeholder', handleAi3DPlaceholderEvent);
      window.removeEventListener('ai-3d-progress', handleAi3DProgressEvent);
      window.removeEventListener('ai-3d-error', handleAi3DErrorEvent);
      window.removeEventListener('ai-3d-response', handleAi3DResponseEvent);
    };
  }, [handleUser3DMessage, handleAi3DPlaceholder, handleAi3DProgress, handleAi3DError, handleAi3DResponse]);

  // Create a function to check for and handle tool call confirmation responses
  // Removed checkForToolRequiringConfirmation function

  // Removed useEffect that watched messages and called checkForToolRequiringConfirmation

  // Removed processGmailResponse function

  // Removed useEffect that watched messages for email intent

  // Add a global cleanup effect that resets streaming state if stuck for too long
  useEffect(() => {
    // Only run this effect when streaming becomes true
    if (!isStreaming) return;

    console.log('Starting global streaming timeout safety');

    // Set a timeout to forcefully reset streaming state after a long period
    const globalTimeout = setTimeout(() => {
      console.log('GLOBAL TIMEOUT: Streaming active for too long, forcing reset');

      // This is just a safety net - the main stream completion logic should have already handled finalization
      // If we reach here, something went wrong with the normal flow

      // Simply reset the streaming state without duplicating message creation
      resetStreamingState();

      console.log('Global timeout: Reset streaming state as safety measure');

    }, 90000); // 90 seconds absolute maximum for streaming

    // Cleanup function
    return () => {
      clearTimeout(globalTimeout);
    };
  }, [isStreaming, resetStreamingState]);

  // Fetch chats when the component mounts
  useEffect(() => {
    // Debug: Home component mounted, fetching chats
    fetchChats();
  }, [fetchChats]); // Add fetchChats to dependency array

  // Navigate to new chat when current chat is deleted
  useEffect(() => {
    if (currentChatId === null && messagesRef.current.length > 0) {
      // The current chat was deleted, navigate to new chat
      console.log('Current chat deleted, navigating to new chat');
      handleNewChat(false); // false = don't close sidebar
    }
  }, [currentChatId, handleNewChat, messagesRef]);

  // Handle ghost mode state changes
  useEffect(() => {
    if (isGhostMode) {
      // No-op on enable: do not alter messages or current chat
    } else {
      // Exiting ghost mode - cleanup only, no navigation or chat switching
      clearGhostMessages();
    }

    // Focus the chat input after ghost mode toggle
    // Using requestAnimationFrame for more reliable timing
    requestAnimationFrame(() => {
      // Double RAF to ensure DOM has fully updated
      requestAnimationFrame(() => {
        chatInputRef.current?.focus();
      });
    });
  }, [
    isGhostMode,
    clearGhostMessages
  ]);

  // Sync ghost messages with regular messages when in ghost mode
  useEffect(() => {
    if (isGhostMode && messages.length > 0) {
      // Store messages in ghost mode store (without persisting to DB)
      setGhostMessages(messages);
    }
  }, [isGhostMode, messages, setGhostMessages]);

  // Don't render anything until model is loaded
  if (isModelLoading) {
    return null;
  }

  if (isAuthEnabled && !user) {
    return null;
  }

  // Function to clean up tool call artifacts from AI responses
  const cleanToolCallArtifacts = (content: string): string => {
    if (!content) return '';

    // First handle all SOURCES patterns regardless of other metadata
    if (content.includes('SOURCES:')) {
      // Completely remove any line containing SOURCES: and anything that follows
      content = content.replace(/[\r\n\s]*SOURCES:[\s\S]*$/i, '');
    }

    // Remove token formatting patterns
    const messageIdPattern = /f:\s*\{\"messageId\":\"[^\"]+\"\}\s*/g;
    content = content.replace(messageIdPattern, '');

    // Remove simple number:number patterns (like 1:1, 2:, etc.)
    const simpleNumberedPattern = /\d+:\d+\s*|\d+:\s*/g;
    content = content.replace(simpleNumberedPattern, '');

    // Pattern to extract content from numbered tokens like 0:"text"
    const numberedTokenPattern = /\d+:\s*\"([^\"]*)\"/g;

    // Check if there are numbered tokens in the content
    if (numberedTokenPattern.test(content)) {
      let cleanedText = '';
      const matches = content.matchAll(numberedTokenPattern);

      // Extract actual content from the numbered tokens
      for (const match of matches) {
        if (match[1]) {
          cleanedText += match[1];
        }
      }

      // If we successfully extracted content, return it
      if (cleanedText) {
        // Final check for any SOURCES text that might have survived
        return cleanedText.replace(/[\r\n\s]*SOURCES:[\s\S]*$/i, '');
      }
    }

    // Remove tool call JSON debris patterns
    content = content
      .replace(/e:\s*{[^}]*"finishReason"[^}]*}/g, '')
      .replace(/e:\s*{[^}]*"messageId"[^}]*}/g, '')
      .replace(/d:\s*{[^}]*"finishReason"[^}]*}/g, '') // Handle d:{ patterns
      .replace(/d:\s*{[^}]*"usage"[^}]*}/g, '') // Handle d:{ patterns with usage
      .replace(/f:\s*{[^}]*}/g, '')
      .replace(/\d+:\s*"call_[^"]*"/g, '')
      .replace(/{.*"promptTokens".*}/g, '')
      .replace(/{.*"completionTokens".*}/g, '')
      .replace(/{.*"finishReason".*}/g, '')
      .replace(/{.*"usage".*}/g, '')
      .replace(/{.*"include_payload".*}/g, '')
      .replace(/\s*"toolCallId"\s*:\s*"[^\"]*"/g, '')
      .replace(/\s*argsuser_id\s*:\s*"[^\"]*"/g, '')
      .trim();

    // Additional cleanup for any remaining e:{ or d:{ patterns at the end
    content = content.replace(/[ed]:\s*\{[^}]*\}\s*$/g, '');

    // Final check for any SOURCES text that might have survived
    return content.replace(/[\r\n\s]*SOURCES:[\s\S]*$/i, '');
  };

  // Prepare messages array with thinking state
  const displayMessages = [...messages].map(msg => {
    // Clean tool call JSON patterns from assistant messages
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      // Use the cleanToolCallArtifacts function to properly clean metadata
      // while preserving the actual message content
      const cleanedContent = cleanToolCallArtifacts(msg.content);
      return { ...msg, content: cleanedContent };
    }
    return msg;
  });

  if (isChatLoading && (!messages.length || messages[messages.length - 1]?.role !== 'assistant')) {
    displayMessages.push({ role: 'assistant', content: '', id: 'thinking' });
  }


  // Removed all document-related functions - document sources are no longer needed

  // Comprehensive function to clean various tool call formats from streamed content
  const cleanStreamedContent = (text: string | undefined): string => {
    if (!text) return '';

    console.log('Cleaning streamed content:', text);

    // IMPORTANT: Add more aggressive special-case handling to catch and remove f:{messageId...} patterns
    // that might have slipped through the initial stream chunk cleaning
    const messageIdPatterns = [
      // Exact match for f:{messageId...} format
      /f:\s*\{\s*"messageId"\s*:\s*"[^"]+"\s*\}\s*/g,

      // More flexible patterns to catch variants
      /f:\s*\{.*?messageId.*?\}\s*/g,
      /f:.*?messageId.*?\}/g,
      /\{\s*"messageId"\s*:.*?\}\s*/g
    ];

    // Apply message ID patterns first before any other cleaning
    for (const pattern of messageIdPatterns) {
      text = text.replace(pattern, '');
    }

    // Add specific patterns for e:{...} and d:{...} metadata
    const streamMetadataPatterns = [
      // Pattern for e:{"finishReason":"stop",...} format
      /e:\s*\{\s*"finishReason"\s*:\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*:\s*(?:"[^"]*"|\d+|true|false|null))*\s*\}/g,

      // Pattern for d:{"finishReason":"stop",...} format
      /d:\s*\{\s*"finishReason"\s*:\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*:\s*(?:"[^"]*"|\d+|true|false|null))*\s*\}/g,

      // More general pattern for any e: or d: followed by JSON object
      /[ed]:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,

      // Catch any remaining e: or d: patterns with nested objects
      /[ed]:\s*\{[\s\S]*?"finishReason"[\s\S]*?\}/g
    ];

    // Apply stream metadata patterns
    for (const pattern of streamMetadataPatterns) {
      text = text.replace(pattern, '');
    }

    // First try to match exact patterns we're seeing in the UI

    // Match complete document tool call with format shown in screenshot
    const exactDocToolCallPattern = /9:\s*\{\s*"toolCallId"\s*:\s*"[^"]+"\s*,\s*"toolName"\s*:\s*"0"\s*,\s*"args"\s*:\s*\{\s*"documentId"\s*:\s*"[^"]+"\s*,\s*"documentName"\s*:\s*"[^"]+"\s*,\s*"relevance"\s*:[^,]+,\s*"reason"\s*:\s*"[^"]+"\s*\}\s*\}\s*,?\s*"isContinued"\s*:\s*false\s*\}\s*\}/g;

    // Match exact usedDocuments format shown in screenshot
    const exactUsedDocsPattern = /f:\s*\{\s*"usedDocuments"\s*:\s*\[\s*\{[\s\S]*?\}\s*\]\s*\}/g;

    // Apply most specific patterns first
    let cleanedText = text
      .replace(exactDocToolCallPattern, '')
      .replace(exactUsedDocsPattern, '');

    // If we made any replacements with the exact patterns, return the result
    if (cleanedText !== text) {
      console.log('Exact pattern match and replacement succeeded');
      return cleanedText.trim();
    }

    // Otherwise continue with the general patterns

    // Tool call patterns
    const toolCallPatterns = [
      // Document tool call with numbered prefix and full details
      /\d+:\s*\{[\s\S]*?"toolCallId"[\s\S]*?"args"[\s\S]*?"documentId"[\s\S]*?\}/g,

      // Document metadata with f: prefix 
      /f:\s*\{[\s\S]*?"usedDocuments"[\s\S]*?\}/g,

      // Format: "isContinued":false patterns
      /,?\s*"isContinued"\s*:\s*false\s*\}\s*\}/g,

      // Format: Any letter followed by JSON object
      /[a-zA-Z]:\s*\{[\s\S]*?\}/g,

      // Format: Number followed by JSON object
      /\d+:\s*\{[\s\S]*?\}/g,

      // Format: Completion reason (now handled by streamMetadataPatterns above)
      // /[ed]:\s*\{\"finishReason\":[\s\S]*?\}/g,

      // Format: Numbering patterns like 1: or 1:1
      /\d+:\d+\s*|\d+:\s*/g,

      // Format: Message ID
      /f:\s*\{\"messageId\":\"[^\"]+\"\}\s*/g,

      // Format: Complete JSON objects
      /^\s*\{[\s\S]*\}\s*$/g,

      // Format: Various document metadata fields
      /\"explicitly_referenced\":\s*(?:true|false)/g,
      /\"similarity\":\s*[\d\.]+/g,
      /\"content_preview\":\"[^\"]*\"/g,
      /\"matched_chunk\":\"[^\"]*\"/g,
      /\"documentId\":\"[^\"]*\"/g,
      /\"documentName\":\"[^\"]*\"/g,
      /\"relevance\":\s*\d+/g,
      /\"reason\":\"[^\"]*\"/g,
    ];

    // Apply all patterns
    for (const pattern of toolCallPatterns) {
      cleanedText = cleanedText.replace(pattern, '');
    }

    // Clean up any leftover JSON fragments
    cleanedText = cleanedText.replace(/\{\s*\}\s*/g, '');
    cleanedText = cleanedText.replace(/\[\s*\]\s*/g, '');

    // Clean up multiple newlines
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');

    // Final cleanup of any stray brackets, braces, or JSON syntax
    cleanedText = cleanedText.replace(/[\[\]{}]/g, '');
    cleanedText = cleanedText.replace(/"\s*:\s*"/g, ' ');
    cleanedText = cleanedText.replace(/"\s*,\s*"/g, ' ');
    cleanedText = cleanedText.replace(/,\s*$/g, '');

    return cleanedText.trim();
  };

  // Function to update text part and clean tool call artifacts
  const cleanTextPartInMessage = (message: StreamingMessage) => {
    if (Array.isArray(message.content)) {
      const textPart = message.content.find(part => part.type === 'text');
      if (textPart && 'text' in textPart) {
        textPart.text = cleanStreamedContent(textPart.text);
      }
    } else if (typeof message.content === 'string') {
      message.content = cleanStreamedContent(message.content);
    }
  };

  // Function to extract document sources from AI response text
  const extractDocumentSources = (text: string): string[] => {
    console.log('Extracting document sources from text:', text);

    // Extract the most explicit sources first: SOURCES section
    const sourcesPatterns = [
      /SOURCES:\s*([\s\S]*?)(?:\n\n|$)/i,
      /###\s*SOURCES\s*(?:USED)?\s*\n([\s\S]*?)(?:\n\n|$)/i,
      /SOURCES[\s\n]*:[\s\n]*((?:[-\*•]\s*[^\n]+\n*)+)/i,
      /SOURCES[\s\n]*:[\s\n]*([^\n]+(?:,\s*[^\n]+)*)/i
    ];

    // Extract sources from explicit SOURCES sections
    for (const pattern of sourcesPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let sources: string[] = [];
        const sourcesText = match[1].trim();

        // Check if it's a bullet list or comma-separated list
        if (sourcesText.includes('\n') || /^[-\*•]/.test(sourcesText)) {
          // Handle bullet list format
          sources = sourcesText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => line.replace(/^[-\*•]\s*/, '').trim()) // Remove bullet points
            .filter(Boolean);
        } else {
          // Handle comma-separated format
          sources = sourcesText
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }

        // Filter out "General Knowledge" and other non-document indicators
        sources = sources.filter(s =>
          s !== 'General Knowledge' &&
          s !== 'N/A' &&
          !s.toLowerCase().includes('general knowledge') &&
          !s.toLowerCase().includes('no sources') &&
          !s.toLowerCase().includes('none')
        );

        console.log('Extracted sources from explicit SOURCES section:', sources);
        return sources;
      }
    }

    // Try to find document citations within the text if no explicit SOURCES section
    const textContentBeforeSources = text.split(/sources:/i)[0];

    // Look for explicit citations like "According to [Document]" or "As mentioned in [Document]"
    const citationPatterns = [
      /(?:according to|mentioned in|referenced in|as stated in|from|in) (?:the |")?([^".,;:!?\n]+)(?:"|\.pdf|\.docx|\.txt)?/gi,
      /information from (?:the |")?([^".,;:!?\n]+)(?:"|\.pdf|\.docx|\.txt)?/gi,
      /(?:the |")([^".,;:!?\n]+)(?:"|\.pdf|\.docx|\.txt)? (?:document|file|report|plan)/gi,
    ];

    const citedDocuments = [];
    for (const pattern of citationPatterns) {
      const matches = [...textContentBeforeSources.matchAll(pattern)];
      for (const match of matches) {
        if (match[1] && match[1].trim()) {
          const doc = match[1].trim();
          // Filter out common words that aren't likely document names
          if (doc.length > 3 &&
            !['this', 'that', 'these', 'those', 'above', 'following', 'text'].includes(doc.toLowerCase())) {
            citedDocuments.push(doc);
          }
        }
      }
    }

    if (citedDocuments.length > 0) {
      console.log('Extracted document citations from text:', citedDocuments);
      return [...new Set(citedDocuments)]; // Deduplicate
    }

    // If we still haven't found sources, fall back to previous behavior of looking for explicit document mentions
    const extractedSources = [];

    // Look for explicit document mentions
    const documentMentionPatterns = [
      // Document references with or without extension
      /\b(Executive(?:\s+)Plan(?:\.pdf)?)\b/gi,
      /\b(Nifty(?:\s+)Gateway(?:\s+)Drop(?:\.pdf)?)\b/gi,
      /\b(Bio(?:\s+)Carlos(?:\s+)Marcial(?:\.pdf)?)\b/gi,

      // Filename mentions with extensions
      /\b([A-Za-z0-9_\s-]+\.(?:pdf|docx|doc|txt))\b/gi
    ];

    for (const pattern of documentMentionPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        if (match[1] && match[1].trim()) {
          extractedSources.push(match[1].trim());
        }
      }
    }

    // Deduplicate and clean up the sources
    const uniqueSources = [...new Set(extractedSources)];

    // Filter common false positives
    const cleanedSources = uniqueSources.filter(source =>
      !source.toLowerCase().includes('general knowledge') &&
      !source.toLowerCase().includes('n/a') &&
      source.length > 3 // Filter out very short matches
    );

    if (cleanedSources.length > 0) {
      console.log('Extracted document mentions from text:', cleanedSources);
      return cleanedSources;
    }

    // If all else fails, look for simple filename mentions
    const filenameMentions = text.match(/[A-Za-z0-9_\s-]+\.(pdf|docx|doc|txt)/gi);

    if (filenameMentions && filenameMentions.length > 0) {
      console.log('Extracted filename mentions:', filenameMentions);
      return filenameMentions;
    }

    // No sources found
    console.log('No document sources found in text');
    return [];
  };

  return (
    <main className={cn(
      "flex flex-col h-screen transition-[margin] duration-200 ease-in-out relative",
      isSidebarOpen ? "lg:ml-64" : "",
      !backgroundImage ? (theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]") : ""
    )}>
      {/* Removed Tool call confirmation dialog */}
      {backgroundImage && (
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: theme === 'dark' ? 0.3 : 0.7
          }}
        />
      )}
      <div className="flex-1 flex flex-col relative">
        <Header
          onNewChat={() => handleNewChat(false)}
          onToggleSidebar={() => setSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
        />
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewChat={() => handleNewChat(true)}
          onSelectChat={handleSelectChat}
          userEmail={user?.email}
          onSignOut={signOut}
        />
        <div className={cn(
          "absolute inset-0 flex flex-col",
          !backgroundImage && (theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]")
        )}>
          {/* Add keyboard aware handler */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                // Handle keyboard visibility for header buttons
                function handleKeyboardVisibility() {
                  const header = document.querySelector('.header-container');
                  if (!header) return;
                  
                  // Add class for transition
                  header.classList.add('keyboard-visible-transition');
                  
                  // Handle input focus (keyboard appears)
                  document.addEventListener('focusin', (e) => {
                    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                      header.style.transform = 'translateY(0)';
                      header.style.opacity = '1';
                    }
                  });
                  
                  // Handle input blur (keyboard disappears)
                  document.addEventListener('focusout', (e) => {
                    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                      header.style.transform = 'translateY(0)';
                      header.style.opacity = '1';
                    }
                  });
                }
                
                // Run immediately and on page load
                handleKeyboardVisibility();
                window.addEventListener('load', handleKeyboardVisibility);
              `,
            }}
          />
          <div className="flex-1 flex flex-col group/chat relative">
            {/* Global Ghost Mode Indicator under header */}
            <div className="fixed top-0 left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none">
              <GhostModeIndicator isActive={isGhostMode} />
            </div>
            {/* Chat switching transition overlay - completely invisible, just blocks interaction */}
            {!isInitialView ? (
              <div className="flex-1 relative">
                <div
                  ref={chatContainerRef}
                  id="main-chat-container"
                  className="absolute inset-0 overflow-y-auto scrollbar scroll-container chat-message-container main-content-mobile-padding chat-messages-fade-mask scrollbar-w-3 scrollbar-track-[#FFF1E5] dark:scrollbar-track-[#212121] scrollbar-thumb-[#EADDD7] dark:scrollbar-thumb-[#2F2F2F] group-hover/chat:scrollbar-thumb-[#D4C0B6] group-hover/chat:dark:scrollbar-thumb-[#424242] group-data-[state=dimmed]/root:scrollbar-thumb-[#EADDD7] group-data-[state=dimmed]/root:dark:scrollbar-thumb-[#2F2F2F]"
                  style={{
                    backgroundColor: !backgroundImage ? (theme === 'dark' ? '#212121' : '#FFF1E5') : 'transparent'
                  }}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentChatId || 'no-chat'}
                      initial={isChatTransitionAnimating ? { opacity: 0, y: 4 } : { opacity: 1, y: 0 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={isChatTransitionAnimating ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
                      transition={{ duration: isChatTransitionAnimating ? 0.25 : 0 }}
                      onAnimationComplete={(definition) => {
                        if (isChatTransitionAnimating && definition === 'animate') {
                          setIsChatTransitionAnimating(false);
                        }
                      }}
                      style={{ willChange: 'opacity, transform' }}
                      className="w-full max-w-[52rem] mx-auto pt-0 pb-[120px] relative mobile-message-wrapper"
                    >
                      <div className="space-y-0.5" ref={messageContainerRef}>
                        {displayMessages.map((message, index) => {
                          const isLastAssistantMessage = index === displayMessages.length - 1 && message.role === 'assistant';
                          const isThinkingMessage = message.id === 'thinking';
                          return (
                            <ChatMessage
                              key={message.id}
                              message={message as any}
                              isFirstMessage={index === 0}
                              isLastMessage={index === displayMessages.length - 1}
                              isThinking={isThinkingMessage || (isLastAssistantMessage && isChatLoading && !message.content)}
                              isStreaming={Boolean(isLastAssistantMessage && isChatLoading && message.content)}
                              sessionId={sessionIdRef.current || undefined}
                            />
                          );
                        })}

                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <div
                className="flex-1 flex flex-col relative main-content-mobile-padding"
                style={{
                  backgroundColor: !backgroundImage ? (theme === 'dark' ? '#212121' : '#FFF1E5') : 'transparent'
                }}
              >
                {/* Chat switching transition overlay - invisible, same color as background */}
                {isSwitchingChat && (
                  <div
                    className="absolute inset-0 z-50 pointer-events-none"
                    style={{
                      backgroundColor: !backgroundImage ? (theme === 'dark' ? '#212121' : '#FFF1E5') : 'transparent'
                    }}
                  >
                    {/* Invisible overlay */}
                  </div>
                )}
                {/* Container for welcome text and chat - positioned slightly higher */}
                <div className="flex-1 flex flex-col items-center justify-center -mt-16 mobile-welcome-container">
                  <div className="w-full max-w-[52rem] flex flex-col items-center px-4 lg:px-0">
                    {/* Welcome text */}
                    <div className="flex items-center justify-center mb-8">
                      <h1
                        className="text-2xl lg:text-4xl font-semibold text-gray-700 dark:text-gray-200 text-center px-4 welcome-text"
                        style={(() => {
                          if (welcomeTextGradient === 'none') {
                            return {};
                          }

                          // Preset gradients that work well in both light and dark modes
                          const presets: Record<string, string> = {
                            sunset: 'linear-gradient(to right, #FF6B6B, #FFE66D)',
                            ocean: 'linear-gradient(to right, #4A90E2, #9B59B6)',
                            aurora: 'linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%)',
                            neon: 'linear-gradient(to right, #00FFF0, #FF00FF)',
                            solar: 'linear-gradient(to right, #FDB813, #FF6B6B)',
                            chatbuttons: 'linear-gradient(to right, #3B82F6, #EAB308, #EA580C, #EF4444, #A855F7)'
                          };

                          const gradientCSS = presets[welcomeTextGradient];

                          if (gradientCSS) {
                            return {
                              background: gradientCSS,
                              WebkitBackgroundClip: 'text',
                              WebkitTextFillColor: 'transparent',
                              backgroundClip: 'text',
                              color: 'transparent'
                            };
                          }

                          return {};
                        })()}
                      >
                        {(() => {
                          // If in default mode, use the translation system
                          if (welcomeTextMode === 'default') {
                            return t('mainPrompt');
                          }

                          // If using welcome messages array
                          if (welcomeTextMode === 'dynamic' && selectedWelcomeMessage) {
                            const currentLang = language || 'en';
                            let message = selectedWelcomeMessage;

                            // Check for translation
                            if (welcomeMessagesTranslations[currentLang]) {
                              const messageIndex = welcomeMessages.indexOf(selectedWelcomeMessage);
                              if (messageIndex !== -1 && welcomeMessagesTranslations[currentLang][messageIndex]) {
                                message = welcomeMessagesTranslations[currentLang][messageIndex];
                              }
                            }

                            // Replace {Username} placeholder
                            const displayName = getUserDisplayName();
                            return message.replace(/{Username}/g, displayName);
                          }

                          // If in custom mode, check for translations
                          const currentLang = language || 'en';

                          // Special case: if custom text is the default "What can I help with?", 
                          // use the translation system's mainPrompt key
                          if (welcomeText === 'What can I help with?') {
                            return t('mainPrompt');
                          }

                          // Check for custom translations
                          if (welcomeTextTranslations[currentLang]) {
                            return welcomeTextTranslations[currentLang];
                          }

                          // Fallback to the custom text or translations in English
                          return welcomeTextTranslations['en'] || welcomeText;
                        })()}
                      </h1>
                    </div>

                    {/* Chat input - centered like ChatGPT, hidden on mobile in initial view */}
                    <div className="w-full max-w-[52rem] mx-auto px-4 hidden sm:block">
                      <ChatInput
                        ref={chatInputRef}
                        input={input}
                        handleInputChange={e => setInput(e.target.value)}
                        handleSubmit={handleSubmit}
                        handleStop={handleStop}
                        isLoading={isChatLoading || isStreaming}
                        placeholder={isGhostMode ? "Send a private message..." : t('messagePlaceholder')}
                        onSubmit={handleSubmit}
                        setInput={setInput}
                        isVoiceModeActive={isVoiceModeActive}
                        onVoiceModeChange={setIsVoiceModeActive}
                      />
                    </div>

                    {/* Suggestion buttons container - maintains fixed height to keep chat input position stable */}
                    <div className="w-full max-w-[52rem] mx-auto px-4 hidden sm:block" style={{ minHeight: '75px' }}>
                      {(() => {
                        // Check if suggestions should be shown
                        const getSuggestionFlag = () => {
                          // Use runtime value if available
                          if (showSuggestionsEnabled !== null) {
                            // Debug logging in development
                            if (process.env.NODE_ENV === 'development') {
                              console.log('[Suggestions] Runtime value:', showSuggestionsEnabled);
                            }

                            // If suggestions are disabled at system level, always return false
                            if (!showSuggestionsEnabled) {
                              return false;
                            }

                            // Only check user preferences if feature is enabled at system level
                            const stored = localStorage.getItem('SHOW_SUGGESTIONS');
                            if (stored === 'false') return false;

                            if (document.cookie.includes('SHOW_SUGGESTIONS=false')) return false;

                            // Default to showing suggestions when enabled
                            return true;
                          }

                          // While loading, don't show suggestions
                          return false;
                        };

                        // Enhanced condition: Show suggestions when:
                        // 1. This is the initial view (no meaningful messages)
                        // 2. Not currently loading
                        // 3. Suggestions are enabled via flag
                        const showSuggestions = isInitialView && !isChatLoading && !isStreaming && getSuggestionFlag();

                        if (!showSuggestions) return null;

                        const handleSuggestionClick = (category: string, fullSuggestion: string) => {
                          setInput(fullSuggestion);
                          // Auto-submit the suggestion
                          setTimeout(() => {
                            const form = document.querySelector('form');
                            if (form) {
                              form.requestSubmit();
                            }
                          }, 100);
                        };

                        return (
                          <SuggestionButtons onSuggestionClick={handleSuggestionClick} />
                        );
                      })()}
                    </div>

                  </div>
                </div>

                {/* Disclaimer text - narrow desktop (640px-1024px) */}
                <div className="absolute bottom-0 left-0 right-0 text-center hidden sm:block lg:hidden pointer-events-none">
                  <p className="text-xs text-gray-500 dark:text-gray-400 pb-2">
                    {t('disclaimer')}
                  </p>
                </div>

                {/* Disclaimer text - positioned at absolute bottom of screen in desktop */}
                <div className="absolute bottom-0 left-0 right-0 text-center hidden lg:block pointer-events-none">
                  <p className="text-xs text-gray-500 dark:text-gray-400 pb-1">
                    {t('disclaimer')}
                  </p>
                </div>



              </div>
            )}

            {/* Mobile-only chat input with integrated suggestion buttons - Always visible on mobile in initial view */}
            {isInitialView && (
              <div
                id="mobile-dock"
                className="sm:hidden flex flex-col justify-end fixed bottom-0 left-0 right-0 z-50 bg-transparent pb-safe mobile-chat-container"
                style={{
                  pointerEvents: 'none' // allow clicks to pass through the empty container space
                }}
              >

                {(() => {
                  const getSuggestionFlag = () => {
                    // Use runtime value if available
                    if (showSuggestionsEnabled !== null) {
                      // If suggestions are disabled at system level, always return false
                      if (!showSuggestionsEnabled) {
                        return false;
                      }

                      // Only check user preferences if feature is enabled at system level
                      const stored = localStorage.getItem('SHOW_SUGGESTIONS');
                      if (stored === 'false') return false;

                      if (document.cookie.includes('SHOW_SUGGESTIONS=false')) return false;

                      return true;
                    }

                    // While loading, don't show suggestions
                    return false;
                  };

                  const showSuggestions = !isChatLoading && !isStreaming && getSuggestionFlag();

                  if (!showSuggestions) return null;

                  return (
                    <div
                      className="mobile-suggestions-wrapper"
                      style={{
                        order: 1,
                        zIndex: 20,
                        width: '100%',
                        flexShrink: 0,
                        position: 'relative',
                        paddingBottom: '8px',
                        pointerEvents: 'auto'
                      }}
                    >
                      <SuggestionButtons onSuggestionClick={(category: string, fullSuggestion: string) => {
                        setInput(fullSuggestion);
                        setTimeout(() => {
                          const form = document.querySelector('form');
                          if (form) {
                            form.requestSubmit();
                          }
                        }, 100);
                      }} />
                    </div>
                  );
                })()}

                {/* Chat input */}
                <div
                  className="input-wrapper relative isolate z-0"
                  style={{
                    order: 2,
                    zIndex: 10,
                    width: '100%',
                    flexShrink: 0,
                    position: 'relative',
                    pointerEvents: 'auto'
                  }}
                >
                  <ChatInput
                    ref={chatInputRef}
                    input={input}
                    handleInputChange={e => setInput(e.target.value)}
                    handleSubmit={handleSubmit}
                    handleStop={handleStop}
                    isLoading={isChatLoading || isStreaming}
                    placeholder={isGhostMode ? "Send a private message..." : t('messagePlaceholder')}
                    onSubmit={handleSubmit}
                    setInput={setInput}
                    isVoiceModeActive={isVoiceModeActive}
                    onVoiceModeChange={setIsVoiceModeActive}
                  />
                </div>
              </div>
            )}

            {!isInitialView && (
              <div className={cn(
                "fixed bottom-0 right-0 z-10 pb-safe sm:pb-0 desktop-narrow-pb-remove transition-[left] duration-200 ease-in-out mobile-chat-input-wrapper",
                "flex flex-col", // Add flex column for proper stacking on mobile
                isSidebarOpen ? "lg:left-64" : "left-0"
              )}>
                <ScrollIndicator
                  direction="up"
                  show={showTopScrollIndicator}
                  onClick={() => {
                    chatContainerRef.current?.scrollTo({
                      top: 0,
                      behavior: 'smooth'
                    });
                  }}
                />

                {/* Down scroll indicator - shows when not at bottom of chat */}
                <ScrollIndicator
                  direction="down"
                  show={showScrollIndicator}
                  chatContainerRef={chatContainerRef}
                  onClick={() => {
                    const chatContainer = chatContainerRef.current;
                    if (chatContainer) {
                      console.log('Scroll indicator clicked - scrolling to bottom');

                      // Hide the scroll indicator
                      setShowScrollIndicator(false);

                      // Force scroll to bottom and reset break-free state
                      scrollState.current.userBrokeFromAutoScroll = false;
                      scrollState.current.shouldAutoScroll = true;
                      scrollToBottom();
                    }
                  }}
                />

                <ChatInput
                  ref={chatInputRef}
                  input={input}
                  handleInputChange={e => setInput(e.target.value)}
                  handleSubmit={handleSubmit}
                  handleStop={handleStop}
                  isLoading={isChatLoading || isStreaming}
                  placeholder={isGhostMode ? "Send a private message..." : t('messagePlaceholder')}
                  onSubmit={handleSubmit}
                  setInput={setInput}
                  isVoiceModeActive={isVoiceModeActive}
                  onVoiceModeChange={setIsVoiceModeActive}
                />

                {/* Mobile disclaimer for conversation view - fixed at absolute bottom, above ChatInput */}
                {/* ios-hidden: On iOS, this is hidden via CSS because chat-input.tsx already shows the disclaimer */}
                <div
                  className="sm:hidden ios-hidden fixed bottom-0 left-0 right-0 text-center pointer-events-none bg-[#FFF1E5] dark:bg-[#212121] z-50"
                  style={{
                    paddingTop: '4px',
                    paddingBottom: '12px'
                  }}
                >
                  <p className="text-gray-500 dark:text-gray-400 text-center" style={{ fontSize: '10px' }}>
                    {t('mobileDisclaimer')}
                  </p>
                </div>

                {/* Disclaimer text - narrow desktop (640px-1024px) */}
                <div className="absolute bottom-0 left-0 right-0 text-center hidden sm:block lg:hidden pointer-events-none">
                  <p className="text-xs text-gray-500 dark:text-gray-400 pb-2">
                    {t('disclaimer')}
                  </p>
                </div>

                {/* Disclaimer text at the bottom - hidden on mobile to keep chat input flush */}
                <div className="absolute bottom-0 left-0 right-0 text-center hidden lg:block pointer-events-none">
                  <p className="text-xs text-gray-500 dark:text-gray-400 pb-1">
                    {t('disclaimer')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </main>
  );
}
