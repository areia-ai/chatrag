import { create } from 'zustand';
import { ExtendedMessage } from '@/types/chat';

interface GhostModeStore {
  isGhostMode: boolean;
  ghostMessages: ExtendedMessage[];
  ghostChatId: string | null;
  hasUnsavedGhostMessages: boolean;

  toggleGhostMode: () => void;
  enableGhostMode: () => void;
  disableGhostMode: (clearMessages?: boolean) => void;
  setGhostMessages: (messages: ExtendedMessage[]) => void;
  addGhostMessage: (message: ExtendedMessage) => void;
  clearGhostMessages: () => void;
  setGhostChatId: (id: string | null) => void;
}

const GHOST_MODE_KEY = 'ghostModeEnabled';

export const useGhostModeStore = create<GhostModeStore>((set, get) => ({
  isGhostMode: false,
  ghostMessages: [],
  ghostChatId: null,
  hasUnsavedGhostMessages: false,

  toggleGhostMode: () => {
    const currentMode = get().isGhostMode;
    if (currentMode) {
      get().disableGhostMode();
    } else {
      get().enableGhostMode();
    }
  },

  enableGhostMode: () => {
    set({
      isGhostMode: true,
      ghostChatId: `ghost-${Date.now()}`
    });
    if (typeof window !== 'undefined') {
      localStorage.setItem(GHOST_MODE_KEY, 'true');
    }
  },

  disableGhostMode: (clearMessages = true) => {
    set((state) => ({
      isGhostMode: false,
      ghostMessages: clearMessages ? [] : state.ghostMessages,
      ghostChatId: null,
      hasUnsavedGhostMessages: clearMessages ? false : state.ghostMessages.length > 0
    }));
    if (typeof window !== 'undefined') {
      localStorage.removeItem(GHOST_MODE_KEY);
    }
  },

  setGhostMessages: (messages: ExtendedMessage[]) => {
    set({
      ghostMessages: messages,
      hasUnsavedGhostMessages: messages.length > 0
    });
  },

  addGhostMessage: (message: ExtendedMessage) => {
    set((state) => ({
      ghostMessages: [...state.ghostMessages, message],
      hasUnsavedGhostMessages: true
    }));
  },

  clearGhostMessages: () => {
    set({
      ghostMessages: [],
      hasUnsavedGhostMessages: false
    });
  },

  setGhostChatId: (id: string | null) => {
    set({ ghostChatId: id });
  }
}));

export const isInGhostMode = () => useGhostModeStore.getState().isGhostMode;
export const getGhostMessages = () => useGhostModeStore.getState().ghostMessages;
export const clearGhostSession = () => {
  const state = useGhostModeStore.getState();
  state.clearGhostMessages();
  state.setGhostChatId(null);
};