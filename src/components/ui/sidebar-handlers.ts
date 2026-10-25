// Sidebar performance optimization: Extract all event handlers to prevent recreating functions on every render

import { Chat, Folder } from '@/lib/supabase';
import { Dispatch } from 'react';

// Chat item event handlers
export const createChatHandlers = (
  onChatSelect: (chat: Chat) => void,
  onTogglePin: (chatId: string) => void,
  onEditStart: (chatId: string, title: string) => void,
  onDelete: (chat: Chat) => void,
  onMoveToFolder: (chatId: string, folderId: string | null) => void
) => {
  const handleChatClick = (chat: Chat) => {
    onChatSelect(chat);
  };

  const handleTogglePin = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    onTogglePin(chatId);
  };

  const handleEditStart = (e: React.MouseEvent, chatId: string, title: string) => {
    e.stopPropagation();
    onEditStart(chatId, title);
  };

  const handleDelete = (e: React.MouseEvent, chat: Chat) => {
    e.stopPropagation();
    onDelete(chat);
  };

  const handleMoveToFolder = (e: React.MouseEvent, chatId: string, folderId: string | null) => {
    e.stopPropagation();
    onMoveToFolder(chatId, folderId);
  };

  const handleDropdownItemClick = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return {
    handleChatClick,
    handleTogglePin,
    handleEditStart,
    handleDelete,
    handleMoveToFolder,
    handleDropdownItemClick
  };
};

// Folder item event handlers
export const createFolderHandlers = (
  onToggleCollapse: (folderId: string) => void,
  onTogglePin: (folderId: string) => void,
  onEditStart: (folderId: string, name: string) => void,
  onDelete: (folder: Folder) => void
) => {
  const handleToggleCollapse = (folderId: string) => {
    onToggleCollapse(folderId);
  };

  const handleTogglePin = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation();
    onTogglePin(folderId);
  };

  const handleEditStart = (e: React.MouseEvent, folderId: string, name: string) => {
    e.stopPropagation();
    onEditStart(folderId, name);
  };

  const handleDelete = (e: React.MouseEvent, folder: Folder) => {
    e.stopPropagation();
    onDelete(folder);
  };

  const handleMenuButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return {
    handleToggleCollapse,
    handleTogglePin,
    handleEditStart,
    handleDelete,
    handleMenuButtonClick
  };
};

// Search and navigation handlers
export const createNavigationHandlers = (
  onClose: () => void,
  onNewChat: () => void,
  onSearchToggle: () => void,
  onNewFolder: () => void
) => {
  const handleClose = () => {
    onClose();
  };

  const handleNewChat = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onNewChat();
  };

  const handleSearchToggle = () => {
    onSearchToggle();
  };

  const handleNewFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    onNewFolder();
  };

  return {
    handleClose,
    handleNewChat,
    handleSearchToggle,
    handleNewFolder
  };
};

// Form handlers
export const createFormHandlers = (
  onSubmit: (e: React.FormEvent) => void,
  onCancel: () => void
) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e);
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleFormClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return {
    handleSubmit,
    handleCancel,
    handleFormClick
  };
};

// Collapsible section handlers
export const createSectionHandlers = (
  dispatch: Dispatch<any>
) => {
  const handleTogglePinnedSection = () => {
    dispatch({ type: 'TOGGLE_PINNED_SECTION' });
  };

  const handleToggleFoldersSection = () => {
    dispatch({ type: 'TOGGLE_FOLDERS_SECTION' });
  };

  return {
    handleTogglePinnedSection,
    handleToggleFoldersSection
  };
};

// Modal handlers
export const createModalHandlers = (
  onConfirm: () => void,
  onCancel: () => void
) => {
  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  return {
    handleConfirm,
    handleCancel
  };
};

// Hover state handlers (will be replaced with CSS)
export const createHoverHandlers = (hoverColor: string, baseColor: string) => {
  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.backgroundColor = hoverColor;
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.backgroundColor = baseColor;
  };

  return {
    handleMouseEnter,
    handleMouseLeave
  };
};

// Event delegation handler for optimized performance
export const createDelegatedClickHandler = (
  handlers: {
    onChatSelect?: (chatId: string) => void;
    onAction?: (chatId: string, action: string) => void;
    onFolderToggle?: (folderId: string) => void;
  }
) => {
  return (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Check for chat item clicks
    const chatItem = target.closest('[data-chat-id]');
    if (chatItem) {
      const chatId = chatItem.getAttribute('data-chat-id');
      if (!chatId) return;

      // Check for action buttons
      const actionButton = target.closest('[data-action]');
      if (actionButton && handlers.onAction) {
        const action = actionButton.getAttribute('data-action');
        if (action) {
          e.stopPropagation();
          handlers.onAction(chatId, action);
        }
      } else if (handlers.onChatSelect) {
        handlers.onChatSelect(chatId);
      }
      return;
    }

    // Check for folder clicks
    const folderItem = target.closest('[data-folder-id]');
    if (folderItem && handlers.onFolderToggle) {
      const folderId = folderItem.getAttribute('data-folder-id');
      if (folderId) {
        handlers.onFolderToggle(folderId);
      }
    }
  };
};