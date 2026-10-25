import { create } from 'zustand';
import { supabase, type Chat } from './supabase';
import { ExtendedMessage, DBMessage, toDBMessages } from '@/types/chat';
import { StorageError } from '@supabase/storage-js';
import { generateTitle, generateSmartTitle, generateBasicTitle, hasEnoughContentForTitle, cleanMarkdown } from './title-generator';
import { generateChatTitleFromToolCall, isToolApprovalRequest, extractToolCallInfo } from './chat-title-utils';
import { v4 as uuidv4 } from 'uuid';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { isInGhostMode } from './ghost-mode-store';

import type { supabase as SupabaseClient } from './supabase';
import type { ContentPart } from '@/types/chat';
import type { Folder, FolderWithStats, CreateFolderInput, UpdateFolderInput } from '@/types/folder';

// Add event emitter for chat updates
export const ChatEvents = {
  CHAT_CREATED: 'chatrag:chat_created',
  CHAT_UPDATED: 'chatrag:chat_updated'
};

interface ChatStore {
  chats: Chat[];
  folders: Folder[];
  currentChatId: string | null;
  currentFolderId: string | null;
  isSidebarOpen: boolean;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filteredChats: Chat[];
  fetchChats: (organizationId?: string | null) => Promise<any[] | undefined>;
  fetchFolders: () => Promise<any[] | undefined>;
  createChat: (messages: DBMessage[], folderId?: string, organizationId?: string | null) => Promise<string | null>;
  updateChat: (chatId: string | null, messages: DBMessage[]) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  setCurrentChat: (chatId: string | null) => void;
  setCurrentFolder: (folderId: string | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
  renameChat: (chatId: string, newTitle: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  togglePinChat: (chatId: string) => Promise<void>;
  getPinnedChats: () => Chat[];
  getUnpinnedChats: () => Chat[];
  // Folder management
  createFolder: (input: CreateFolderInput) => Promise<string | null>;
  updateFolder: (folderId: string, input: UpdateFolderInput) => Promise<void>;
  deleteFolder: (folderId: string, deleteChats?: boolean) => Promise<void>;
  togglePinFolder: (folderId: string) => Promise<void>;
  moveChatToFolder: (chatId: string, folderId: string | null) => Promise<void>;
  moveChatsToFolder: (chatIds: string[], folderId: string | null) => Promise<void>;
  getChatsByFolder: (folderId: string | null) => Chat[];
  getPinnedFolders: () => Folder[];
  getUnpinnedFolders: () => Folder[];
}

const STORAGE_BUCKET = 'chat-images';
const CURRENT_CHAT_KEY = 'currentChatId';
const SIDEBAR_OPEN_KEY = 'isSidebarOpen';

// Get stored chat ID from localStorage, making sure we're in a browser environment
const getStoredChatId = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(CURRENT_CHAT_KEY);
  }
  return null;
};

// Get stored sidebar state from localStorage
const getStoredSidebarState = (): boolean => {
  if (typeof window !== 'undefined') {
    const value = localStorage.getItem(SIDEBAR_OPEN_KEY);
    return value === 'true';
  }
  return false;
};

// Simplified event emission with debouncing
let eventDebounceTimer: NodeJS.Timeout | null = null;
const emitChatEvent = (eventName: string, chatData: any) => {
  if (typeof window === 'undefined' || !chatData?.chat) return;

  // Debounce rapid events
  if (eventDebounceTimer) clearTimeout(eventDebounceTimer);

  eventDebounceTimer = setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: chatData,
        bubbles: false // Don't bubble to reduce propagation overhead
      }));
    } catch (err) {
      console.error(`Error emitting ${eventName}:`, err);
    }
  }, 50); // 50ms debounce
};

// Helper function to update chat title in database
async function updateChatTitle(chatId: string, newTitle: string, userId: string, set: any) {
  try {
    const cleanTitle = cleanMarkdown(newTitle);
    console.log(`[Chat Title] Updating chat ${chatId} with AI-generated title: ${cleanTitle}`);

    const { error } = await supabase
      .from('chats')
      .update({ title: cleanTitle })
      .eq('id', chatId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating chat title:', error);
      return;
    }

    // Update local state immediately
    set((state: ChatStore) => ({
      chats: state.chats.map((chat: Chat) =>
        chat.id === chatId ? { ...chat, title: cleanTitle, titlePending: false } : chat
      ),
      filteredChats: state.searchQuery ?
        state.filteredChats.map((chat: Chat) =>
          chat.id === chatId ? { ...chat, title: cleanTitle, titlePending: false } : chat
        ) :
        state.filteredChats
    }));

    console.log(`[Chat Title] Successfully updated title for chat ${chatId}`);
  } catch (error) {
    console.error('Error in updateChatTitle:', error);
  }
}

// Helper function to generate title considering tool calls
function generateTitleWithToolCallSupport(
  messages: DBMessage[],
  chatId?: string,
  onSmartTitleGenerated?: (chatId: string, smartTitle: string) => Promise<void>
): string {
  // Debug: generateTitleWithToolCallSupport called with messages

  // Debug: Logging first few messages for title generation

  // Check if any message contains a tool approval request
  const toolApprovalMessage = messages.find(msg => isToolApprovalRequest(msg.content));

  if (toolApprovalMessage) {
    // Debug: Found tool approval request, generating title from tool call

    // Extract tool call information from the approval message
    const toolCallInfo = extractToolCallInfo(toolApprovalMessage.content);

    if (toolCallInfo) {
      // Try to get tool call data from global state first (for complete args)
      const globalToolState = (globalThis as any).toolApprovalState;
      if (globalToolState && globalToolState[toolCallInfo.toolCallId]) {
        const storedToolCall = globalToolState[toolCallInfo.toolCallId].toolCall;
        if (storedToolCall) {
          // Debug: Using stored tool call data for title generation

          // Create a ToolCallPart-like object for title generation
          const toolCallPart = {
            type: 'tool-call' as const,
            toolName: storedToolCall.name,
            toolCallId: toolCallInfo.toolCallId,
            args: storedToolCall.params || {}
          };

          const toolTitle = generateChatTitleFromToolCall(toolCallPart);
          // Debug: Generated tool-based title
          return toolTitle;
        }
      }

      // Fallback: generate title from just the tool name if no stored data
      // Debug: No stored tool call data, using tool name
      const fallbackToolCall = {
        type: 'tool-call' as const,
        toolName: toolCallInfo.toolName,
        toolCallId: toolCallInfo.toolCallId,
        args: {}
      };

      const fallbackTitle = generateChatTitleFromToolCall(fallbackToolCall);
      // Debug: Generated fallback tool title
      return fallbackTitle;
    }
  }

  // Define callback for smart title generation
  const titleCallback = chatId && onSmartTitleGenerated
    ? (smartTitle: string) => onSmartTitleGenerated(chatId, smartTitle)
    : undefined;

  // No tool approval request found, use regular title generation with callback
  return generateTitle(messages, titleCallback);
}

// Optimized state update with single mutation
function updateLocalChatState(set: any, updatedChat: Chat) {
  set((state: ChatStore) => {
    const chatIndex = state.chats.findIndex((chat: Chat) => chat.id === updatedChat.id);
    const existingChat = chatIndex >= 0 ? state.chats[chatIndex] : null;

    // Preserve titlePending from existing chat state if the update doesn't explicitly set it
    const chatWithPreservedPending = {
      ...updatedChat,
      titlePending: updatedChat.titlePending !== undefined
        ? updatedChat.titlePending
        : existingChat?.titlePending
    };

    // Create new arrays only if needed
    const newChats = chatIndex >= 0
      ? [...state.chats.slice(0, chatIndex), chatWithPreservedPending, ...state.chats.slice(chatIndex + 1)]
      : [chatWithPreservedPending, ...state.chats];

    // Update filteredChats only if search is active
    const newFilteredChats = state.searchQuery
      ? state.filteredChats.map((chat: Chat) => chat.id === updatedChat.id ? chatWithPreservedPending : chat)
      : state.filteredChats;

    return {
      ...state,
      chats: newChats,
      filteredChats: newFilteredChats
    };
  });

  // Emit event with debouncing
  emitChatEvent(ChatEvents.CHAT_UPDATED, { chat: updatedChat });
}

// Global creation mutex to prevent concurrent chat creation
let isCreatingChat = false;
let lastCreationTime = 0;

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  folders: [],
  currentChatId: getStoredChatId(),
  currentFolderId: null,
  isSidebarOpen: getStoredSidebarState(),
  isLoading: false,
  error: null,
  searchQuery: '',
  filteredChats: [],

  fetchChats: async (organizationId?: string | null) => {
    set({ isLoading: true, error: null });
    try {
      // Build URL with organization context if provided
      const orgParam = organizationId !== undefined
        ? `&organization_id=${organizationId === null ? 'null' : organizationId}`
        : '';
      // Fetch initial page with higher limit for sidebar
      const response = await fetch(`/api/chats?page=1&limit=50${orgParam}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch chats');
      }

      const { chats, pagination } = await response.json();

      // Debug: Logging chat IDs for verification

      set((state: ChatStore) => {
        const fetchedChats = chats || [];

        // Merge fetched chats with existing state to preserve titlePending
        // This is critical to prevent the spinner from disappearing (and showing "New Chat")
        // if a background fetch happens while AI title generation is pending
        const mergedChats = fetchedChats.map((fetchedChat: Chat) => {
          const existingChat = state.chats.find(c => c.id === fetchedChat.id);
          // If local state is waiting for a title, preserve both the pending flag AND existing title
          if (existingChat?.titlePending) {
            return { ...fetchedChat, titlePending: true, title: existingChat.title };
          }
          return fetchedChat;
        });

        return {
          chats: mergedChats,
          filteredChats: state.searchQuery ? state.filteredChats : []
        };
      });

      // Return the fetched data so other components can use it if needed
      return chats;
    } catch (error: any) {
      console.error("chat-store: Error in fetchChats:", error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchFolders: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/api/folders', {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch folders');
      }

      const { folders } = await response.json();

      set({
        folders: folders || []
      });

      return folders;
    } catch (error: any) {
      console.error("chat-store: Error in fetchFolders:", error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  createChat: async (messages: DBMessage[], folderId?: string, organizationId?: string | null) => {
    // Debug: createChat called with messages
    console.log('[ChatStore] createChat called with', messages.length, 'messages', 'org:', organizationId || 'personal');

    // Check if in ghost mode - don't persist to database
    if (isInGhostMode()) {
      console.log('[ChatStore] Ghost mode active - not persisting chat to database');
      const ghostId = `ghost-${Date.now()}`;
      set({ currentChatId: ghostId });
      return ghostId;
    }

    // Check global creation mutex
    if (isCreatingChat) {
      console.log('[ChatStore] Another chat creation in progress, waiting...');
      // Wait a bit and check if we can find the recently created chat
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to find a recently created chat with matching messages
      const state = get();
      const recentChat = state.chats.find(chat => {
        if (!chat.created_at) return false;
        const chatTime = new Date(chat.created_at).getTime();
        return (Date.now() - chatTime) < 1000; // Created within last second
      });

      if (recentChat) {
        console.log('[ChatStore] Found recently created chat, returning its ID:', recentChat.id);
        return recentChat.id;
      }
    }

    // Set the global mutex
    isCreatingChat = true;
    const creationStartTime = Date.now();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (!messages?.length) {
        throw new Error('Cannot create chat with empty messages');
      }

      // Enhanced deduplication: prevent creating duplicate chats
      const state = get();
      const now = Date.now();

      // Check recent chats (within last 5 seconds) for duplicates
      const recentChats = state.chats.filter(chat => {
        if (!chat.created_at) return false;
        const chatTime = new Date(chat.created_at).getTime();
        return (now - chatTime) < 5000; // 5 second window
      });

      // Check if any recent chat has identical messages
      for (const recentChat of recentChats) {
        if (recentChat.messages?.length === messages.length) {
          // Compare first user message and last message content
          const recentFirstUser = recentChat.messages.find(m => m.role === 'user');
          const newFirstUser = messages.find(m => m.role === 'user');

          const recentLastMsg = recentChat.messages[recentChat.messages.length - 1];
          const newLastMsg = messages[messages.length - 1];

          // If messages match, it's likely a duplicate
          if (recentFirstUser?.content === newFirstUser?.content &&
            recentLastMsg?.content === newLastMsg?.content &&
            recentLastMsg?.role === newLastMsg?.role) {
            console.log('[ChatStore] Detected duplicate chat within 5s window, returning existing chat ID:', recentChat.id);
            return recentChat.id;
          }
        }
      }

      // Also check if we're trying to create a chat with the exact same title within 2 seconds
      const tempTitle = generateBasicTitle(messages);
      const duplicateTitleChat = state.chats.find(chat => {
        if (!chat.created_at || !chat.title) return false;
        const chatTime = new Date(chat.created_at).getTime();
        return (now - chatTime) < 2000 && chat.title === tempTitle;
      });

      if (duplicateTitleChat) {
        console.log('[ChatStore] Detected chat with identical title within 2s, returning existing chat ID:', duplicateTitleChat.id);
        return duplicateTitleChat.id;
      }

      const processedMessages = messages; // Use original messages for now

      const hasAssistantMessage = processedMessages.some(msg => msg.role === 'assistant');

      // Pre-create a temporary chat ID so we can pass it to title generation
      const tempChatId = uuidv4();

      // Define the callback for async title update
      const titleUpdateCallback = async (chatId: string, smartTitle: string) => {
        await updateChatTitle(chatId, smartTitle, user.id, set);
      };

      let title = generateTitleWithToolCallSupport(
        processedMessages,
        tempChatId,
        titleUpdateCallback
      );

      if (title && (title.includes('include:') || title.includes('**') || title.startsWith('-'))) {
        // Debug: detected markdown in title, applying extra cleaning
        title = cleanMarkdown(title);

        if (title.length < 5) {
          title = generateBasicTitle(processedMessages);
          // Debug: fallback to basic title
        }
      }

      // Debug: generated initial title

      const { data, error } = await supabase
        .from('chats')
        .insert([
          {
            id: tempChatId, // Use the pre-created ID
            title,
            messages: processedMessages,
            user_id: user.id,
            organization_id: organizationId !== undefined ? organizationId : null, // Set organization context
            folder_id: folderId || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Debug: updating local state with new chat

      // Defer state updates to avoid React state update warning
      setTimeout(() => {
        set((state: ChatStore) => {
          // Ensure no duplicates by filtering out any existing chat with the same ID
          const deduplicatedChats = state.chats.filter(chat => chat.id !== data.id);
          // Only show spinner (titlePending: true) if we're waiting for async AI title
          // Creative content titles (Image Generation:, Video Generation:, 3D Generation) are already final
          const isPendingAITitle = data.title === 'New Chat';
          const chatWithPending = { ...data, titlePending: isPendingAITitle };
          const updatedChats = [chatWithPending, ...deduplicatedChats];

          return {
            chats: updatedChats,
            currentChatId: data.id,
            filteredChats: state.searchQuery ?
              updatedChats.filter(chat =>
                chat.title.toLowerCase().includes(state.searchQuery.toLowerCase().trim())
              ) :
              state.filteredChats
          };
        });
      }, 0);

      if (typeof window !== 'undefined') {
        localStorage.setItem(CURRENT_CHAT_KEY, data.id);
      }

      if (data && data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
        emitChatEvent(ChatEvents.CHAT_CREATED, { chat: data });
      } else {
        // Debug: Not emitting CHAT_CREATED - saved chat has no messages
      }

      return data.id;
    } catch (error: any) {
      console.error('Error creating chat:', error);
      set({ error: error.message });
      return null;
    } finally {
      // Release the mutex after a short delay
      setTimeout(() => {
        isCreatingChat = false;
        lastCreationTime = creationStartTime;
      }, 500);
    }
  },

  updateChat: async (chatId: string | null, messages: DBMessage[]) => {
    if (!chatId) return;

    // Check if in ghost mode - don't persist to database
    if (isInGhostMode()) {
      console.log('[ChatStore] Ghost mode active - not updating chat in database');
      return;
    }

    set({ error: null });
    try {
      if (!messages || messages.length === 0) {
        // Debug: updateChat called with empty messages array, skipping update
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const processedMessages = messages; // Use original messages for now

      if (processedMessages.length === 0) {
        // Debug: No messages after processing, skipping update
        return;
      }

      const hasAssistantMessage = processedMessages.some(msg => msg.role === 'assistant');

      // Check if the chat has a pending title - if so, don't regenerate
      // This prevents overwriting with "New Chat" while the async AI title generation is running
      const existingChat = get().chats.find((c: Chat) => c.id === chatId);
      const hasPendingTitle = existingChat?.titlePending === true;

      let title: string;

      if (hasPendingTitle) {
        // Keep existing title, don't regenerate - let the initial async title complete
        title = existingChat.title;
        console.log('[ChatStore] Title pending, keeping existing title:', title);
      } else {
        // Define the callback for async title update
        const titleUpdateCallback = async (chatId: string, smartTitle: string) => {
          await updateChatTitle(chatId, smartTitle, user.id, set);
        };

        title = generateTitleWithToolCallSupport(
          processedMessages,
          chatId,
          titleUpdateCallback
        );

        title = cleanMarkdown(title);
      }

      // Debug: generated title from content

      // Only update title if not pending
      const updateData: any = {
        messages: processedMessages,
        updated_at: new Date().toISOString(),
      };

      if (!hasPendingTitle) {
        updateData.title = title;
      }

      const { data, error } = await supabase
        .from('chats')
        .update(updateData)
        .eq('id', chatId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      // Build updatedChat, preserving titlePending and existing title if pending
      const existingChatForUpdate = get().chats.find((c: Chat) => c.id === chatId);
      const shouldPreserveTitleState = existingChatForUpdate?.titlePending === true;

      const updatedChat = {
        ...(data || {
          id: chatId,
          messages: processedMessages,
          updated_at: new Date().toISOString()
        }),
        // If title is pending, keep the existing title (don't let "New Chat" from DB overwrite)
        // and maintain the titlePending flag
        title: shouldPreserveTitleState ? existingChatForUpdate.title : (data?.title || title),
        titlePending: shouldPreserveTitleState ? true : undefined
      };

      updateLocalChatState(set, updatedChat);

      if (updatedChat.messages && Array.isArray(updatedChat.messages) && updatedChat.messages.length > 0) {
        emitChatEvent(ChatEvents.CHAT_UPDATED, { chat: updatedChat });
      } else {
        // Debug: Not emitting CHAT_UPDATED - updated chat has no messages
      }
    } catch (error: any) {
      console.error('Error updating chat:', error);
      set({ error: error.message });
    }
  },

  deleteChat: async (chatId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chatId)
        .eq('user_id', user.id);

      if (error) throw error;

      set((state) => {
        // If we're deleting the current chat, remove it from localStorage
        if (state.currentChatId === chatId && typeof window !== 'undefined') {
          localStorage.removeItem(CURRENT_CHAT_KEY);
        }

        // Clear the sidebar cache to prevent deleted chats from reappearing
        if (typeof window !== 'undefined') {
          try {
            // Remove the sidebar-specific chat cache
            localStorage.removeItem('chatrag_sidebar_chats');
            localStorage.removeItem('chatrag_sidebar_cache_expiry');
            // Debug: Cleared sidebar cache after chat deletion
          } catch (cacheError) {
            console.error('chat-store: Error clearing sidebar cache:', cacheError);
          }
        }

        return {
          chats: state.chats.filter((chat) => chat.id !== chatId),
          currentChatId: state.currentChatId === chatId ? null : state.currentChatId,
        };
      });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentChat: (chatId: string | null) => {
    // Debug: setCurrentChat called
    set({ currentChatId: chatId });

    // Save to localStorage or remove if null
    if (typeof window !== 'undefined') {
      if (chatId) {
        localStorage.setItem(CURRENT_CHAT_KEY, chatId);
      } else {
        localStorage.removeItem(CURRENT_CHAT_KEY);
      }
    }

    // Debug: currentChatId updated
  },

  setSidebarOpen: (isOpen: boolean) => {
    // Debug: setSidebarOpen called
    set({ isSidebarOpen: isOpen });

    // Save sidebar state to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_OPEN_KEY, isOpen.toString());
    }

    // Debug: isSidebarOpen updated
  },

  renameChat: async (chatId: string, newTitle: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('chats')
        .update({ title: newTitle })
        .eq('id', chatId)
        .eq('user_id', user.id);

      if (error) throw error;

      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === chatId ? { ...chat, title: newTitle } : chat
        ),
      }));
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  setSearchQuery: (query: string) => {
    const { chats } = get();
    const normalizedQuery = query.toLowerCase().trim();

    set({
      searchQuery: query,
      filteredChats: normalizedQuery
        ? chats.filter(chat =>
          chat.title.toLowerCase().includes(normalizedQuery) ||
          (chat.messages || []).some(msg =>
            typeof msg.content === 'string'
              ? msg.content.toLowerCase().includes(normalizedQuery)
              : Array.isArray(msg.content)
                ? msg.content.some(item =>
                  item.type === 'text' &&
                  typeof item.text === 'string' &&
                  item.text.toLowerCase().includes(normalizedQuery)
                )
                : false
          )
        )
        : []
    });
  },

  togglePinChat: async (chatId: string) => {
    const { chats } = get();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    try {
      const updatedPinned = !chat.pinned;

      // Update in the database
      const { error } = await supabase
        .from('chats')
        .update({ pinned: updatedPinned })
        .eq('id', chatId);

      if (error) throw error;

      // Update local state
      set({
        chats: chats.map(c =>
          c.id === chatId
            ? { ...c, pinned: updatedPinned }
            : c
        )
      });
    } catch (error: any) {
      console.error('Error toggling pin status:', error);
      set({ error: error.message });
    }
  },

  getPinnedChats: () => {
    const { chats, searchQuery, filteredChats } = get();
    const source = searchQuery ? filteredChats : chats;
    return source.filter(chat => chat.pinned);
  },

  getUnpinnedChats: () => {
    const { chats, searchQuery, filteredChats } = get();
    const source = searchQuery ? filteredChats : chats;
    return source.filter(chat => !chat.pinned);
  },

  setCurrentFolder: (folderId: string | null) => {
    set({ currentFolderId: folderId });
  },

  // Folder management methods
  createFolder: async (input: CreateFolderInput) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('folders')
        .insert([{
          ...input,
          user_id: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      set((state) => ({
        folders: [...state.folders, data]
      }));

      return data.id;
    } catch (error: any) {
      console.error('Error creating folder:', error);
      set({ error: error.message });
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  updateFolder: async (folderId: string, input: UpdateFolderInput) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('folders')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', folderId)
        .eq('user_id', user.id);

      if (error) throw error;

      set((state) => ({
        folders: state.folders.map((folder) =>
          folder.id === folderId ? { ...folder, ...input } : folder
        ),
      }));
    } catch (error: any) {
      console.error('Error updating folder:', error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteFolder: async (folderId: string, deleteChats: boolean = false) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Call the database function to handle deletion
      const { error } = await supabase
        .rpc('delete_folder', {
          folder_uuid: folderId,
          delete_chats: deleteChats
        });

      if (error) throw error;

      set((state) => ({
        folders: state.folders.filter(folder => folder.id !== folderId),
        // If we deleted chats too, remove them from state
        chats: deleteChats
          ? state.chats.filter(chat => chat.folder_id !== folderId)
          : state.chats.map(chat =>
            chat.folder_id === folderId
              ? { ...chat, folder_id: null }
              : chat
          ),
      }));
    } catch (error: any) {
      console.error('Error deleting folder:', error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  togglePinFolder: async (folderId: string) => {
    const { folders } = get();
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    try {
      const updatedPinned = !folder.pinned;

      const { error } = await supabase
        .from('folders')
        .update({ pinned: updatedPinned })
        .eq('id', folderId);

      if (error) throw error;

      set({
        folders: folders.map(f =>
          f.id === folderId
            ? { ...f, pinned: updatedPinned }
            : f
        )
      });
    } catch (error: any) {
      console.error('Error toggling folder pin status:', error);
      set({ error: error.message });
    }
  },

  moveChatToFolder: async (chatId: string, folderId: string | null) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('chats')
        .update({
          folder_id: folderId,
          updated_at: new Date().toISOString()
        })
        .eq('id', chatId)
        .eq('user_id', user.id);

      if (error) throw error;

      set((state) => ({
        chats: state.chats.map(chat =>
          chat.id === chatId ? { ...chat, folder_id: folderId } : chat
        ),
      }));
    } catch (error: any) {
      console.error('Error moving chat to folder:', error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  moveChatsToFolder: async (chatIds: string[], folderId: string | null) => {
    set({ isLoading: true, error: null });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Use the database function for batch operations
      const { data, error } = await supabase
        .rpc('move_chats_to_folder', {
          chat_ids: chatIds,
          target_folder_id: folderId
        });

      if (error) throw error;

      set((state) => ({
        chats: state.chats.map(chat =>
          chatIds.includes(chat.id) ? { ...chat, folder_id: folderId } : chat
        ),
      }));
    } catch (error: any) {
      console.error('Error moving chats to folder:', error);
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  getChatsByFolder: (folderId: string | null) => {
    const { chats, searchQuery, filteredChats } = get();
    const source = searchQuery ? filteredChats : chats;
    return source.filter(chat => chat.folder_id === folderId);
  },

  getPinnedFolders: () => {
    const { folders } = get();
    return folders.filter(folder => folder.pinned);
  },

  getUnpinnedFolders: () => {
    const { folders } = get();
    return folders.filter(folder => !folder.pinned);
  }
}));

// Export standalone functions for compatibility with existing code
export const createChat = (messages: DBMessage[], folderId?: string, organizationId?: string | null): Promise<string | null> => {
  // Debug: Standalone createChat called
  return useChatStore.getState().createChat(messages, folderId, organizationId);
};

export const updateChat = (chatId: string | null, messages: DBMessage[]): Promise<void> => {
  // Debug: Standalone updateChat called
  return useChatStore.getState().updateChat(chatId, messages);
}; 