// Sidebar state management with useReducer for optimal performance

import React from 'react';

export interface SidebarState {
  editingChatId: string | null;
  editingTitle: string;
  editingFolderId: string | null;
  editingFolderName: string;
  isSearching: boolean;
  menuOpenChatId: string | null;
  openDropdownId: string | null;
  isPinnedSectionCollapsed: boolean;
  isFoldersSectionCollapsed: boolean;
  collapsedFolders: Set<string>;
  isDeleteModalOpen: boolean;
  chatToDelete: any | null;
  isFolderDeleteModalOpen: boolean;
  folderToDelete: any | null;
  deleteFolderWithChats: boolean;
  isCreateFolderModalOpen: boolean;
  hasFetchedOnMount: boolean;
  isInitialLoad: boolean;
}

export type SidebarAction =
  // Chat editing actions
  | { type: 'START_CHAT_EDIT'; chatId: string; title: string }
  | { type: 'UPDATE_EDIT_TITLE'; title: string }
  | { type: 'CANCEL_CHAT_EDIT' }
  | { type: 'SUBMIT_CHAT_EDIT' }

  // Folder editing actions
  | { type: 'START_FOLDER_EDIT'; folderId: string; name: string }
  | { type: 'UPDATE_FOLDER_NAME'; name: string }
  | { type: 'CANCEL_FOLDER_EDIT' }
  | { type: 'SUBMIT_FOLDER_EDIT' }

  // Search actions
  | { type: 'TOGGLE_SEARCH' }
  | { type: 'CLEAR_SEARCH' }

  // Menu and dropdown actions
  | { type: 'OPEN_CHAT_MENU'; chatId: string }
  | { type: 'CLOSE_CHAT_MENU' }
  | { type: 'SET_OPEN_DROPDOWN'; dropdownId: string | null }

  // Section collapse actions
  | { type: 'TOGGLE_PINNED_SECTION' }
  | { type: 'TOGGLE_FOLDERS_SECTION' }
  | { type: 'AUTO_TOGGLE_PINNED_SECTION' }  // For auto expand/collapse without marking as manual
  | { type: 'AUTO_TOGGLE_FOLDERS_SECTION' }  // For auto expand/collapse without marking as manual
  | { type: 'TOGGLE_FOLDER_COLLAPSE'; folderId: string }
  | { type: 'SET_COLLAPSED_FOLDERS'; folderIds: string[] }
  | { type: 'INITIALIZE_SECTIONS'; hasPinnedChats: boolean; hasFolders: boolean }

  // Delete modal actions
  | { type: 'OPEN_DELETE_MODAL'; chat: any }
  | { type: 'CLOSE_DELETE_MODAL' }
  | { type: 'CONFIRM_DELETE' }

  // Folder delete modal actions
  | { type: 'OPEN_FOLDER_DELETE_MODAL'; folder: any }
  | { type: 'CLOSE_FOLDER_DELETE_MODAL' }
  | { type: 'SET_DELETE_FOLDER_WITH_CHATS'; value: boolean }
  | { type: 'CONFIRM_FOLDER_DELETE' }

  // Create folder modal
  | { type: 'OPEN_CREATE_FOLDER_MODAL' }
  | { type: 'CLOSE_CREATE_FOLDER_MODAL' }

  // Loading states
  | { type: 'SET_HAS_FETCHED'; value: boolean }
  | { type: 'SET_INITIAL_LOAD'; value: boolean };

export const initialSidebarState: SidebarState = {
  editingChatId: null,
  editingTitle: '',
  editingFolderId: null,
  editingFolderName: '',
  isSearching: false,
  menuOpenChatId: null,
  openDropdownId: null,
  isPinnedSectionCollapsed: false,  // Start with sections open by default
  isFoldersSectionCollapsed: false,  // Start with sections open by default
  collapsedFolders: new Set<string>(),
  isDeleteModalOpen: false,
  chatToDelete: null,
  isFolderDeleteModalOpen: false,
  folderToDelete: null,
  deleteFolderWithChats: false,
  isCreateFolderModalOpen: false,
  hasFetchedOnMount: false,
  isInitialLoad: true
};

export function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    // Chat editing
    case 'START_CHAT_EDIT':
      return {
        ...state,
        editingChatId: action.chatId,
        editingTitle: action.title
      };
    
    case 'UPDATE_EDIT_TITLE':
      return {
        ...state,
        editingTitle: action.title
      };
    
    case 'CANCEL_CHAT_EDIT':
      return {
        ...state,
        editingChatId: null,
        editingTitle: ''
      };
    
    case 'SUBMIT_CHAT_EDIT':
      return {
        ...state,
        editingChatId: null,
        editingTitle: ''
      };
    
    // Folder editing
    case 'START_FOLDER_EDIT':
      return {
        ...state,
        editingFolderId: action.folderId,
        editingFolderName: action.name
      };
    
    case 'UPDATE_FOLDER_NAME':
      return {
        ...state,
        editingFolderName: action.name
      };
    
    case 'CANCEL_FOLDER_EDIT':
      return {
        ...state,
        editingFolderId: null,
        editingFolderName: ''
      };
    
    case 'SUBMIT_FOLDER_EDIT':
      return {
        ...state,
        editingFolderId: null,
        editingFolderName: ''
      };
    
    // Search
    case 'TOGGLE_SEARCH':
      return {
        ...state,
        isSearching: !state.isSearching
      };
    
    case 'UPDATE_SEARCH_QUERY':
      // Search query is managed by chat store, not local state
      return state;
    
    case 'CLEAR_SEARCH':
      return {
        ...state,
        isSearching: false
      };
    
    // Menus
    case 'OPEN_CHAT_MENU':
      return {
        ...state,
        menuOpenChatId: action.chatId
      };
    
    case 'CLOSE_CHAT_MENU':
      return {
        ...state,
        menuOpenChatId: null
      };
    
    case 'SET_OPEN_DROPDOWN':
      return {
        ...state,
        openDropdownId: action.dropdownId
      };
    
    // Sections
    case 'TOGGLE_PINNED_SECTION':
      // Mark as user preference by saving immediately
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebar-pinned-collapsed', JSON.stringify(!state.isPinnedSectionCollapsed));
        // Also mark that user has set a preference
        localStorage.setItem('sidebar-pinned-manually-set', 'true');
      }
      return {
        ...state,
        isPinnedSectionCollapsed: !state.isPinnedSectionCollapsed
      };

    case 'TOGGLE_FOLDERS_SECTION':
      // Mark as user preference by saving immediately
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebar-folders-collapsed', JSON.stringify(!state.isFoldersSectionCollapsed));
        // Also mark that user has set a preference
        localStorage.setItem('sidebar-folders-manually-set', 'true');
      }
      return {
        ...state,
        isFoldersSectionCollapsed: !state.isFoldersSectionCollapsed
      };
    
    case 'AUTO_TOGGLE_PINNED_SECTION':
      // Auto-toggle WITHOUT saving to localStorage (no persistence for auto actions)
      return {
        ...state,
        isPinnedSectionCollapsed: !state.isPinnedSectionCollapsed
      };

    case 'AUTO_TOGGLE_FOLDERS_SECTION':
      // Auto-toggle WITHOUT saving to localStorage (no persistence for auto actions)
      return {
        ...state,
        isFoldersSectionCollapsed: !state.isFoldersSectionCollapsed
      };

    case 'TOGGLE_FOLDER_COLLAPSE':
      const newCollapsed = new Set(state.collapsedFolders);
      if (newCollapsed.has(action.folderId)) {
        newCollapsed.delete(action.folderId);
      } else {
        newCollapsed.add(action.folderId);
      }
      return {
        ...state,
        collapsedFolders: newCollapsed
      };

    case 'SET_COLLAPSED_FOLDERS':
      return {
        ...state,
        collapsedFolders: new Set(action.folderIds)
      };

    case 'INITIALIZE_SECTIONS':
      // Initialize/adjust sections based on content availability
      // This is called once when the sidebar first gets data
      // It may need to override previously loaded preferences if sections are empty

      const hasManualPinnedPref = typeof window !== 'undefined' &&
        localStorage.getItem('sidebar-pinned-manually-set') === 'true';
      const hasManualFoldersPref = typeof window !== 'undefined' &&
        localStorage.getItem('sidebar-folders-manually-set') === 'true';

      // Determine states based on content
      let newPinnedState: boolean = state.isPinnedSectionCollapsed; // Keep current state by default
      let newFoldersState: boolean = state.isFoldersSectionCollapsed; // Keep current state by default

      // Pinned section logic:
      if (!action.hasPinnedChats) {
        // Empty: ALWAYS closed (override any preference)
        newPinnedState = true;
      } else if (!hasManualPinnedPref) {
        // Has content + no manual pref: default open
        newPinnedState = false;
      }
      // else: Has content + manual pref: keep current state (already loaded)

      // Folders section logic:
      if (!action.hasFolders) {
        // Empty: ALWAYS closed (override any preference)
        newFoldersState = true;
      } else if (!hasManualFoldersPref) {
        // Has content + no manual pref: default open
        newFoldersState = false;
      }
      // else: Has content + manual pref: keep current state (already loaded)

      // Only update if something changed
      if (newPinnedState !== state.isPinnedSectionCollapsed ||
          newFoldersState !== state.isFoldersSectionCollapsed) {
        return {
          ...state,
          isPinnedSectionCollapsed: newPinnedState,
          isFoldersSectionCollapsed: newFoldersState
        };
      }
      return state;

    // Delete modals
    case 'OPEN_DELETE_MODAL':
      return {
        ...state,
        isDeleteModalOpen: true,
        chatToDelete: action.chat
      };
    
    case 'CLOSE_DELETE_MODAL':
      return {
        ...state,
        isDeleteModalOpen: false,
        chatToDelete: null
      };
    
    case 'OPEN_FOLDER_DELETE_MODAL':
      return {
        ...state,
        isFolderDeleteModalOpen: true,
        folderToDelete: action.folder
      };
    
    case 'CLOSE_FOLDER_DELETE_MODAL':
      return {
        ...state,
        isFolderDeleteModalOpen: false,
        folderToDelete: null,
        deleteFolderWithChats: false
      };
    
    case 'SET_DELETE_FOLDER_WITH_CHATS':
      return {
        ...state,
        deleteFolderWithChats: action.value
      };
    
    // Create folder
    case 'OPEN_CREATE_FOLDER_MODAL':
      return {
        ...state,
        isCreateFolderModalOpen: true
      };
    
    case 'CLOSE_CREATE_FOLDER_MODAL':
      return {
        ...state,
        isCreateFolderModalOpen: false
      };
    
    // Loading states
    case 'SET_HAS_FETCHED':
      return {
        ...state,
        hasFetchedOnMount: action.value
      };
    
    case 'SET_INITIAL_LOAD':
      return {
        ...state,
        isInitialLoad: action.value
      };
    
    default:
      return state;
  }
}

// Helper hook for using the reducer with localStorage persistence
export function useSidebarReducer() {
  const [state, dispatch] = React.useReducer(sidebarReducer, initialSidebarState, (initial) => {
    // Load saved preferences immediately to prevent FOUC (Flash of Unstyled Content)
    // If user has manually set preferences, apply them right away
    // They'll be adjusted later by INITIALIZE_SECTIONS if content doesn't match
    if (typeof window !== 'undefined') {
      try {
        const savedCollapsed = localStorage.getItem('sidebar-collapsed-folders');
        const hasManualPinnedPref = localStorage.getItem('sidebar-pinned-manually-set') === 'true';
        const hasManualFoldersPref = localStorage.getItem('sidebar-folders-manually-set') === 'true';

        // Start with defaults
        let pinnedState = initial.isPinnedSectionCollapsed;
        let foldersState = initial.isFoldersSectionCollapsed;

        // If user has manually set preferences, load them immediately to prevent visual jump
        if (hasManualPinnedPref) {
          const savedPinnedCollapsed = localStorage.getItem('sidebar-pinned-collapsed');
          if (savedPinnedCollapsed !== null) {
            pinnedState = JSON.parse(savedPinnedCollapsed);
          }
        }

        if (hasManualFoldersPref) {
          const savedFoldersCollapsed = localStorage.getItem('sidebar-folders-collapsed');
          if (savedFoldersCollapsed !== null) {
            foldersState = JSON.parse(savedFoldersCollapsed);
          }
        }

        return {
          ...initial,
          collapsedFolders: savedCollapsed ? new Set(JSON.parse(savedCollapsed)) : initial.collapsedFolders,
          // Load manual preferences immediately to prevent FOUC
          isPinnedSectionCollapsed: pinnedState,
          isFoldersSectionCollapsed: foldersState
        };
      } catch (error) {
        console.error('Failed to load sidebar state:', error);
      }
    }
    return initial;
  });

  // Save collapsed folders to localStorage when they change
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'sidebar-collapsed-folders',
          JSON.stringify(Array.from(state.collapsedFolders))
        );
      } catch (error) {
        console.error('Failed to save collapsed folders:', error);
      }
    }
  }, [state.collapsedFolders]);

  // Note: Section collapsed states are saved directly in the reducer actions (TOGGLE_PINNED_SECTION, TOGGLE_FOLDERS_SECTION)
  // We don't need to save them here to avoid conflicts with auto-toggle actions

  return [state, dispatch] as const;
}