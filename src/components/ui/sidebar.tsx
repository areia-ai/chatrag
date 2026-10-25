'use client';

import { PanelLeft, X, MessageSquare, ExternalLink, SquarePen, Search, MoreVertical, Pencil, Trash, Pin, ChevronDown, ChevronRight, ArrowLeft, Plus, FolderPlus, Folder as FolderIcon, Ghost, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/lib/chat-store';
import { ChatEvents } from '@/lib/chat-store';
import React, { useEffect, useState, useRef, useCallback, useMemo, startTransition } from 'react';
import type { Chat } from '@/lib/supabase';
import type { Folder } from '@/types/folder';
import { useGhostModeStore } from '@/lib/ghost-mode-store';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { UserMenu } from '@/components/ui/user-menu';
import { PortalTooltip } from '@/components/ui/portal-tooltip';
import { CreateFolderModal } from '@/components/ui/create-folder-modal';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePerformanceMonitor, performanceMonitor, measurePerformance } from '@/lib/performance-monitor';
import { sanitizeTitleCached } from '@/lib/utils/sanitize-title';
import { getRelativeTimeCached, groupChatsByTimeCached } from '@/lib/utils/date-grouping';
import {
  DROPDOWN_STYLES,
  getDropdownStyle,
  getDropdownItemStyle,
  getFolderDropdownStyle,
  getFolderItemStyle,
  DELETE_BUTTON_STYLE,
  FOLDER_DELETE_ITEM_STYLE,
  VIRTUAL_LIST_CONTAINER_STYLE,
  VIRTUAL_ITEM_STYLE,
  MODAL_BACKDROP_STYLE,
  getIOSStyle,
  getFABStyle
} from './sidebar-styles';
import { useShallow } from 'zustand/react/shallow';
import {
  createChatHandlers,
  createFolderHandlers,
  createNavigationHandlers,
  createFormHandlers,
  createSectionHandlers,
  createModalHandlers,
  createDelegatedClickHandler
} from './sidebar-handlers';
import { useSidebarReducer, SidebarAction } from './sidebar-reducer';
import { OrganizationSwitcher } from '@/components/organization-switcher';
import { useOrganizationStore } from '@/lib/stores/organization-store';
import { isMultiTenant } from '@/lib/deployment-mode';
import './sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat?: () => void;
  onSelectChat?: (chat: Chat) => void;
  userEmail?: string;
  onSignOut?: () => Promise<void>;
}

// Add ScrollingTitle component
interface ScrollingTitleProps {
  title: string;
  className?: string;
  isHovering?: boolean;
  isMenuOpen?: boolean;
  uniqueId: string;
}

// Memoized ChatItem component
interface ChatItemProps {
  chat: Chat;
  isEditing: boolean;
  editingTitle: string;
  onEditingTitleChange: (title: string) => void;
  onEditSubmit: (e: React.FormEvent) => void;
  onEditCancel: () => void;
  onChatSelect: (chat: Chat) => void;
  onEditStart: (chatId: string, title: string) => void;
  onDelete: (chat: Chat) => void;
  onTogglePin: (chatId: string) => void;
  onMoveToFolder: (chatId: string, folderId: string | null) => void;
  folders: Folder[];
  showRelativeTime?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  t: any;
  isDarkMode: boolean;
  className?: string;
}

const ChatItem = React.memo(({
  chat,
  isEditing,
  editingTitle,
  onEditingTitleChange,
  onEditSubmit,
  onEditCancel,
  onChatSelect,
  onEditStart,
  onDelete,
  onTogglePin,
  onMoveToFolder,
  folders,
  showRelativeTime = false,
  inputRef,
  t,
  isDarkMode,
  className = ""
}: ChatItemProps) => {
  usePerformanceMonitor('ChatItem');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const theme = isDarkMode ? 'dark' : 'light';
  const dropdownBgColor = DROPDOWN_STYLES[theme].backgroundColor;
  const hoverColor = DROPDOWN_STYLES[theme].hoverColor;
  const textColor = DROPDOWN_STYLES[theme].color;
  const iconColor = isDarkMode ? '#9E9E9E' : '#666';

  // Refs for touch handling - distinguish tap from scroll
  const touchTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const SCROLL_THRESHOLD = 10; // pixels - if finger moves more than this, it's a scroll

  // Track touch start position
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  // Handle touch end - only trigger if it was a tap, not a scroll
  const handleTouchEnd = (e: React.TouchEvent) => {
    // Don't trigger if the menu is open or user is editing
    if (isMenuOpen || isEditing) return;

    // Check if this was a scroll or a tap
    if (touchStartRef.current) {
      const touch = e.changedTouches[0];
      const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

      // If finger moved more than threshold, user was scrolling - don't trigger
      if (deltaX > SCROLL_THRESHOLD || deltaY > SCROLL_THRESHOLD) {
        touchStartRef.current = null;
        return;
      }
    }

    // This was a tap - trigger the action
    e.preventDefault();
    touchTriggeredRef.current = true;
    touchStartRef.current = null;
    onChatSelect(chat);
  };

  // Handle click - skip if touch already handled it
  const handleClick = () => {
    if (touchTriggeredRef.current) {
      touchTriggeredRef.current = false;
      return;
    }
    onChatSelect(chat);
  };

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "w-full flex items-center justify-between rounded-lg transition-colors group cursor-pointer",
        "px-3 py-3 lg:py-2 text-sm",
        "chat-item-hover", // Mobile-safe hover from CSS
        "[&:has([data-state=open])]:bg-[#FFE8DC] dark:[&:has([data-state=open])]:bg-[#2F2F2F]",
        className
      )}
    >
      <div className="flex items-center space-x-2 min-w-0 flex-1">
        <MessageSquare className="h-4 w-4 flex-shrink-0" />
        {isEditing ? (
          <form
            onSubmit={onEditSubmit}
            className="flex-1"
            onClick={e => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={editingTitle}
              onChange={(e) => onEditingTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onEditCancel();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  onEditSubmit(e);
                }
              }}
              autoFocus
              className={cn(
                "w-full bg-transparent border-none focus:ring-0 p-0",
                "text-gray-900 dark:text-gray-100",
                "placeholder:text-gray-400 dark:placeholder:text-gray-500"
              )}
              placeholder={t('enterChatTitle')}
            />
          </form>
        ) : (
          <div className="flex-1 min-w-0">
            {chat.titlePending ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <ScrollingTitle
                title={sanitizeTitleCached(chat.title)}
                isMenuOpen={isMenuOpen}
                uniqueId={chat.id}
              />
            )}
            {showRelativeTime && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 lg:hidden">
                {getRelativeTimeCached(chat.updated_at || chat.created_at, t)}
              </div>
            )}
          </div>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "opacity-0 group-hover:opacity-100 p-1.5 rounded transition-all",
                isMenuOpen && "opacity-100"
              )}
              style={{
                backgroundColor: hoveredItem === 'menu-trigger' ? hoverColor : 'transparent'
              }}
              onMouseEnter={() => setHoveredItem('menu-trigger')}
              onMouseLeave={() => setHoveredItem(null)}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="w-56 rounded-xl z-[100]"
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
              padding: 0,
              overflow: 'hidden',
              borderRadius: '12px'
            }}
          >
            <div style={{
              padding: '8px',
              backgroundColor: dropdownBgColor
            }}>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(chat.id);
                  setIsMenuOpen(false);
                }}
                onMouseEnter={() => setHoveredItem('pin')}
                onMouseLeave={() => setHoveredItem(null)}
                className="flex items-center gap-2 cursor-pointer text-sm w-full"
                style={{
                  backgroundColor: hoveredItem === 'pin' ? hoverColor : 'transparent',
                  padding: '12px 16px',
                  margin: '2px 0',
                  borderRadius: '8px',
                  color: textColor
                }}
              >
                <Pin className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                <span>{chat.pinned ? t('unpin') : t('pin')}</span>
              </div>

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onEditStart(chat.id, chat.title);
                  setIsMenuOpen(false);
                }}
                onMouseEnter={() => setHoveredItem('rename')}
                onMouseLeave={() => setHoveredItem(null)}
                className="flex items-center gap-2 cursor-pointer text-sm w-full"
                style={{
                  backgroundColor: hoveredItem === 'rename' ? hoverColor : 'transparent',
                  padding: '12px 16px',
                  margin: '2px 0',
                  borderRadius: '8px',
                  color: textColor
                }}
              >
                <Pencil className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                <span>{t('rename')}</span>
              </div>

              {folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    onMouseEnter={() => setHoveredItem('folder')}
                    onMouseLeave={() => setHoveredItem(null)}
                    className="sidebar-subtrigger flex items-center gap-2 cursor-pointer text-sm w-full [&>svg]:ml-auto focus:bg-transparent data-[state=open]:bg-transparent"
                    style={{
                      backgroundColor: hoveredItem === 'folder' ? hoverColor : 'transparent',
                      padding: '12px 16px',
                      margin: '2px 0',
                      borderRadius: '8px',
                      color: textColor
                    }}
                  >
                    <FolderIcon className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                    <span className="flex-1">{t('moveToFolder')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="w-48 rounded-xl z-[101]"
                    style={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
                      padding: 0,
                      overflow: 'hidden',
                      borderRadius: '12px'
                    }}
                  >
                    <div style={{
                      padding: '8px',
                      backgroundColor: dropdownBgColor
                    }}>
                      {chat.folder_id && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveToFolder(chat.id, null);
                          }}
                          onMouseEnter={() => setHoveredItem('remove-folder')}
                          onMouseLeave={() => setHoveredItem(null)}
                          className="flex items-center gap-2 cursor-pointer text-sm w-full"
                          style={{
                            backgroundColor: hoveredItem === 'remove-folder' ? hoverColor : 'transparent',
                            padding: '12px 16px',
                            margin: '2px 0',
                            borderRadius: '8px',
                            color: textColor
                          }}
                        >
                          <X className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                          <span>{t('removeFromFolder')}</span>
                        </div>
                      )}
                      {chat.folder_id && folders.length > 5 && (
                        <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />
                      )}
                      <ScrollArea className={folders.length > 5 ? "h-[240px]" : ""}>
                        <div className="py-1">
                          {folders.map((folder) => (
                            <div
                              key={folder.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveToFolder(chat.id, folder.id);
                              }}
                              onMouseEnter={() => setHoveredItem(`folder-${folder.id}`)}
                              onMouseLeave={() => setHoveredItem(null)}
                              className="flex items-center gap-2 cursor-pointer text-sm w-full"
                              style={{
                                backgroundColor: hoveredItem === `folder-${folder.id}` ? hoverColor : 'transparent',
                                padding: '12px 16px',
                                margin: '2px 0',
                                borderRadius: '8px',
                                color: textColor
                              }}
                            >
                              <FolderIcon className="h-4 w-4 flex-shrink-0" style={{ color: folder.color }} />
                              <span>{folder.name}</span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsMenuOpen(false);
                  // Small delay to ensure dropdown fully unmounts before modal opens
                  setTimeout(() => {
                    onDelete(chat);
                  }, 0);
                }}
                onMouseEnter={() => setHoveredItem('delete')}
                onMouseLeave={() => setHoveredItem(null)}
                className="flex items-center gap-2 cursor-pointer text-sm w-full"
                style={{
                  backgroundColor: hoveredItem === 'delete' ? hoverColor : 'transparent',
                  padding: '12px 16px',
                  margin: '2px 0',
                  borderRadius: '8px',
                  color: '#EF4444'
                }}
              >
                <Trash className="h-4 w-4 flex-shrink-0" style={{ color: '#EF4444' }} />
                <span>{t('delete')}</span>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

ChatItem.displayName = 'ChatItem';

// FolderItem Component
interface FolderItemProps {
  folder: Folder;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onEditSubmit: (e: React.FormEvent) => void;
  onEditCancel: () => void;
  onEditStart: (folderId: string, name: string) => void;
  onDelete: (folder: Folder) => void;
  onTogglePin: (folderId: string) => void;
  onToggleCollapse: (folderId: string) => void;
  isCollapsed: boolean;
  chatCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  t: any;
  isDarkMode: boolean;
  isPinned?: boolean;
  children?: React.ReactNode;
}

const FolderItem = React.memo(({
  folder,
  isEditing,
  editingName,
  onEditingNameChange,
  onEditSubmit,
  onEditCancel,
  onEditStart,
  onDelete,
  onTogglePin,
  onToggleCollapse,
  isCollapsed,
  chatCount,
  inputRef,
  t,
  isDarkMode,
  isPinned = false,
  children
}: FolderItemProps) => {
  usePerformanceMonitor('FolderItem');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const theme = isDarkMode ? 'dark' : 'light';
  const dropdownBgColor = DROPDOWN_STYLES[theme].backgroundColor;
  const hoverColor = DROPDOWN_STYLES[theme].hoverColor;
  const textColor = DROPDOWN_STYLES[theme].color;
  const iconColor = isDarkMode ? '#9E9E9E' : '#666';

  // Refs for touch handling - distinguish tap from scroll
  const touchTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const SCROLL_THRESHOLD = 10; // pixels - if finger moves more than this, it's a scroll

  // Track touch start position
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  // Handle touch end - only trigger if it was a tap, not a scroll
  const handleTouchEnd = (e: React.TouchEvent) => {
    // Don't trigger if the menu is open or user is editing
    if (isMenuOpen || isEditing) return;

    // Check if this was a scroll or a tap
    if (touchStartRef.current) {
      const touch = e.changedTouches[0];
      const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

      // If finger moved more than threshold, user was scrolling - don't trigger
      if (deltaX > SCROLL_THRESHOLD || deltaY > SCROLL_THRESHOLD) {
        touchStartRef.current = null;
        return;
      }
    }

    // This was a tap - trigger the action
    e.preventDefault();
    touchTriggeredRef.current = true;
    touchStartRef.current = null;
    onToggleCollapse(folder.id);
  };

  // Handle click - skip if touch already handled it
  const handleClick = () => {
    if (touchTriggeredRef.current) {
      touchTriggeredRef.current = false;
      return;
    }
    onToggleCollapse(folder.id);
  };

  return (
    <div className="space-y-1">
      <div className={cn(
        "w-full flex items-center justify-between rounded-lg transition-colors group cursor-pointer px-3 py-2 text-sm",
        "folder-item-hover", // Mobile-safe hover from CSS
        "[&:has([data-state=open])]:bg-[#FFE8DC] dark:[&:has([data-state=open])]:bg-[#2F2F2F]"
      )}>
        <div
          className="flex items-center space-x-2 min-w-0 flex-1"
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 flex-shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 flex-shrink-0" />
          )}
          <FolderIcon className="h-4 w-4 flex-shrink-0" style={{ color: folder.color }} />
          {isEditing ? (
            <form
              onSubmit={onEditSubmit}
              className="flex-1"
              onClick={e => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => onEditingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onEditCancel();
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    onEditSubmit(e);
                  }
                }}
                autoFocus
                className={cn(
                  "w-full bg-transparent border-none focus:ring-0 p-0",
                  "text-gray-900 dark:text-gray-100",
                  "placeholder:text-gray-400 dark:placeholder:text-gray-500"
                )}
                placeholder={t('enterFolderName')}
              />
            </form>
          ) : (
            <div className="flex-1 min-w-0">
              <div className={cn("truncate", isPinned && "font-medium")}>{folder.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {chatCount} {t('chats')}
              </div>
            </div>
          )}
          {isPinned && <Pin className="h-3 w-3 text-amber-500 flex-shrink-0" />}
        </div>

        {!isEditing && (
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "opacity-0 group-hover:opacity-100 p-1.5 rounded transition-all",
                  isMenuOpen && "opacity-100"
                )}
                style={{
                  backgroundColor: hoveredItem === 'folder-menu-trigger' ? hoverColor : 'transparent'
                }}
                onMouseEnter={() => setHoveredItem('folder-menu-trigger')}
                onMouseLeave={() => setHoveredItem(null)}
                aria-label="More options"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              className="w-56 rounded-xl z-[100]"
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
                padding: 0,
                overflow: 'hidden',
                borderRadius: '12px'
              }}
            >
              <div style={{
                padding: '8px',
                backgroundColor: dropdownBgColor
              }}>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(folder.id);
                    setIsMenuOpen(false);
                  }}
                  onMouseEnter={() => setHoveredItem('pin')}
                  onMouseLeave={() => setHoveredItem(null)}
                  className="flex items-center gap-2 cursor-pointer text-sm w-full"
                  style={{
                    backgroundColor: hoveredItem === 'pin' ? hoverColor : 'transparent',
                    padding: '12px 16px',
                    margin: '2px 0',
                    borderRadius: '8px',
                    color: textColor
                  }}
                >
                  <Pin className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                  <span>{isPinned ? t('unpin') : t('pin')}</span>
                </div>

                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditStart(folder.id, folder.name);
                    setIsMenuOpen(false);
                  }}
                  onMouseEnter={() => setHoveredItem('rename')}
                  onMouseLeave={() => setHoveredItem(null)}
                  className="flex items-center gap-2 cursor-pointer text-sm w-full"
                  style={{
                    backgroundColor: hoveredItem === 'rename' ? hoverColor : 'transparent',
                    padding: '12px 16px',
                    margin: '2px 0',
                    borderRadius: '8px',
                    color: textColor
                  }}
                >
                  <Pencil className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                  <span>{t('rename')}</span>
                </div>

                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setIsMenuOpen(false);
                    // Small delay to ensure dropdown fully unmounts before modal opens
                    setTimeout(() => {
                      onDelete(folder);
                    }, 0);
                  }}
                  onMouseEnter={() => setHoveredItem('delete')}
                  onMouseLeave={() => setHoveredItem(null)}
                  className="flex items-center gap-2 cursor-pointer text-sm w-full"
                  style={{
                    backgroundColor: hoveredItem === 'delete' ? hoverColor : 'transparent',
                    padding: '12px 16px',
                    margin: '2px 0',
                    borderRadius: '8px',
                    color: '#FF4A4A'
                  }}
                >
                  <Trash className="h-4 w-4 flex-shrink-0" style={{ color: '#FF4A4A' }} />
                  <span>{t('delete')}</span>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Children (folder chats) */}
      {!isCollapsed && children}
    </div>
  );
});

FolderItem.displayName = 'FolderItem';

// VirtualChatList Component for performance optimization
interface VirtualChatListProps {
  chats: Chat[];
  parentRef: React.RefObject<HTMLDivElement | null>;
  renderChat: (chat: Chat, index: number) => React.ReactNode;
  estimateSize?: number;
}

const VirtualChatList = React.memo(({
  chats,
  parentRef,
  renderChat,
  estimateSize = 64 // Default height estimate for a chat item
}: VirtualChatListProps) => {
  usePerformanceMonitor('VirtualChatList');
  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 5, // Render 5 items outside of visible area for smoother scrolling
  });

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        ...VIRTUAL_LIST_CONTAINER_STYLE
      }}
      className="virtual-list-container"
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const chat = chats[virtualItem.index];
        return (
          <div
            key={virtualItem.key}
            style={{
              ...VIRTUAL_ITEM_STYLE,
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
            className="virtual-item"
          >
            {renderChat(chat, virtualItem.index)}
          </div>
        );
      })}
    </div>
  );
});

VirtualChatList.displayName = 'VirtualChatList';

const ScrollingTitle = React.memo(({ title, className, isMenuOpen = false, uniqueId }: ScrollingTitleProps) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const { theme } = useTheme();

  // Single effect for overflow check on mount
  useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current) {
        const isTextOverflowing = titleRef.current.scrollWidth > titleRef.current.clientWidth;
        setIsOverflowing(isTextOverflowing);
      }
    };

    // Defer check to next frame
    requestAnimationFrame(checkOverflow);
  }, [title]);

  // Optimized marquee animation with dynamic keyframes
  const startMarqueeAnimation = useCallback(() => {
    if (!isOverflowing || isMenuOpen) return;

    const element = document.getElementById(`scrolling-title-${uniqueId}`);
    const container = titleRef.current?.parentElement;
    if (!element || !container) return;

    // Calculate actual overflow amount
    const containerWidth = container.clientWidth;
    const textWidth = titleRef.current?.scrollWidth || 0;
    const scrollDistance = textWidth - containerWidth + 20; // Add some padding

    // Create or update keyframes
    if (!styleRef.current) {
      styleRef.current = document.createElement('style');
      styleRef.current.id = `marquee-style-${uniqueId}`;
      document.head.appendChild(styleRef.current);
    }

    // Calculate duration based on text length (roughly 30px per second)
    const duration = Math.max(3, Math.min(10, scrollDistance / 30));

    // Define optimized keyframes
    styleRef.current.textContent = `
      @keyframes marquee-${uniqueId} {
        0% { transform: translateX(0); }
        50% { transform: translateX(-${scrollDistance}px); }
        100% { transform: translateX(0); }
      }
    `;

    // Apply animation with GPU acceleration
    element.style.animation = `marquee-${uniqueId} ${duration}s ease-in-out infinite`;
    element.style.willChange = 'transform';
  }, [isOverflowing, isMenuOpen, uniqueId]);

  const stopMarqueeAnimation = useCallback(() => {
    const element = document.getElementById(`scrolling-title-${uniqueId}`);
    if (element) {
      element.style.animation = 'none';
      element.style.willChange = 'auto';
    }
  }, [uniqueId]);

  const handleMouseEnter = () => {
    if (!isMenuOpen && isOverflowing) {
      setIsHovering(true);
      startMarqueeAnimation();
    }
  };

  const handleMouseLeave = () => {
    if (!isMenuOpen) {
      setIsHovering(false);
      stopMarqueeAnimation();
    }
  };

  // Handle menu state changes
  useEffect(() => {
    if (isMenuOpen && isHovering) {
      stopMarqueeAnimation();
    }
  }, [isMenuOpen, isHovering, stopMarqueeAnimation]);

  // Common text style for both static and animated versions
  const textStyles = "leading-normal";

  // Cleanup style element on unmount
  useEffect(() => {
    return () => {
      // Clean up the dynamically created style element
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
      // Also try to remove by ID as backup
      const styleElement = document.getElementById(`marquee-style-${uniqueId}`);
      if (styleElement) {
        styleElement.remove();
      }
      // Stop any running animation
      stopMarqueeAnimation();
    };
  }, [uniqueId, stopMarqueeAnimation]);

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Normal static title (always visible when not hovering) */}
      <div
        id={`static-title-${uniqueId}`}
        ref={titleRef}
        className={cn("truncate transition-opacity duration-200", textStyles)}
        style={{
          opacity: isHovering && isOverflowing ? 0 : 1,
          transition: 'opacity 0.2s ease'
        }}
      >
        {title}
      </div>

      {/* Scrolling title for marquee effect */}
      {isOverflowing && (
        <div
          id={`scrolling-title-${uniqueId}`}
          ref={scrollRef}
          className={cn(
            "absolute inset-0 whitespace-nowrap",
            "text-gray-900 dark:text-gray-100",
            textStyles
          )}
          style={{
            opacity: isHovering ? 1 : 0,
            transition: 'opacity 0.2s ease',
            padding: 0,
            margin: 0,
            zIndex: 20,
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          }}
        >
          {/* The complete scrolling content */}
          <div className="flex items-center title-content">
            <span className="whitespace-nowrap">{title}</span>
            <span className="opacity-50 px-4 whitespace-nowrap">•••</span>
          </div>

          {/* Duplicate for continuous scrolling */}
          <div className="flex items-center">
            <span className="whitespace-nowrap">{title}</span>
            <span className="opacity-50 px-4 whitespace-nowrap">•••</span>
          </div>
        </div>
      )}
    </div>
  );
});

ScrollingTitle.displayName = 'ScrollingTitle';

// Local storage cache key
const CHATS_CACHE_KEY = 'chatrag_sidebar_chats';
const CACHE_EXPIRY_KEY = 'chatrag_sidebar_cache_expiry';
const CACHE_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
const MAX_CHATS_TO_CACHE = 10; // Limit to storing only 10 most recent chats


export function Sidebar({ isOpen, onClose, onNewChat, onSelectChat, userEmail, onSignOut }: SidebarProps) {
  // Add performance monitoring
  usePerformanceMonitor('Sidebar');

  const {
    chats,
    fetchChats,
    setCurrentChat,
    deleteChat,
    renameChat,
    searchQuery,
    setSearchQuery,
    filteredChats,
    togglePinChat,
    getPinnedChats,
    getUnpinnedChats,
    folders,
    fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    togglePinFolder,
    moveChatToFolder,
    getChatsByFolder,
    getPinnedFolders,
    getUnpinnedFolders
  } = useChatStore(
    useShallow((s) => ({
      chats: s.chats,
      fetchChats: s.fetchChats,
      setCurrentChat: s.setCurrentChat,
      deleteChat: s.deleteChat,
      renameChat: s.renameChat,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      filteredChats: s.filteredChats,
      togglePinChat: s.togglePinChat,
      getPinnedChats: s.getPinnedChats,
      getUnpinnedChats: s.getUnpinnedChats,
      folders: s.folders,
      fetchFolders: s.fetchFolders,
      createFolder: s.createFolder,
      updateFolder: s.updateFolder,
      deleteFolder: s.deleteFolder,
      togglePinFolder: s.togglePinFolder,
      moveChatToFolder: s.moveChatToFolder,
      getChatsByFolder: s.getChatsByFolder,
      getPinnedFolders: s.getPinnedFolders,
      getUnpinnedFolders: s.getUnpinnedFolders,
    }))
  );

  const { isGhostMode, ghostChatId } = useGhostModeStore();

  // Use reducer for all state management
  const [state, dispatch] = useSidebarReducer();
  const {
    editingChatId,
    editingTitle,
    editingFolderId,
    editingFolderName,
    isSearching,
    menuOpenChatId,
    openDropdownId,
    isPinnedSectionCollapsed,
    isFoldersSectionCollapsed,
    collapsedFolders,
    isDeleteModalOpen,
    chatToDelete,
    isFolderDeleteModalOpen,
    folderToDelete,
    deleteFolderWithChats,
    isCreateFolderModalOpen,
    hasFetchedOnMount,
    isInitialLoad
  } = state;

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Theme and language
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark';
  // Initialize with immediate detection
  const [isIOSSafari, setIsIOSSafari] = useState(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      return isIOS && isSafari;
    }
    return false;
  });

  const [isChromeIOS, setIsChromeIOS] = useState(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isChrome = /CriOS/.test(navigator.userAgent);
      return isIOS && isChrome;
    }
    return false;
  });

  // Consolidated browser detection
  useEffect(() => {
    const detectBrowser = () => {
      const userAgent = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
      const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
      const isChrome = /CriOS/.test(userAgent);

      setIsIOSSafari(isIOS && isSafari);
      setIsChromeIOS(isIOS && isChrome);

      console.log('Browser Detection Results:', {
        isIOSSafari: isIOS && isSafari,
        isChromeIOS: isIOS && isChrome,
        userAgent
      });
    };

    detectBrowser();
  }, []);

  // Initialize sidebar button configuration
  const [sidebarButtonText, setSidebarButtonText] = useState<string>('ChatRAG');
  const [sidebarButtonUrl, setSidebarButtonUrl] = useState<string>('https://www.chatrag.ai/');

  useEffect(() => {
    // Load from localStorage first for quick initial render
    const savedButtonText = localStorage.getItem('SIDEBAR_BUTTON_TEXT');
    const savedButtonUrl = localStorage.getItem('SIDEBAR_BUTTON_URL');

    if (savedButtonText) setSidebarButtonText(savedButtonText);
    if (savedButtonUrl) setSidebarButtonUrl(savedButtonUrl);

    // Then fetch latest from server
    async function fetchSidebarButtonConfig() {
      try {
        // Fetch button text
        const textResponse = await fetch('/api/config/get-env?var=NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT');
        if (textResponse.ok) {
          const textData = await textResponse.json();
          if (textData.value) {
            setSidebarButtonText(textData.value);
            localStorage.setItem('SIDEBAR_BUTTON_TEXT', textData.value);
          }
        }

        // Fetch button URL
        const urlResponse = await fetch('/api/config/get-env?var=NEXT_PUBLIC_SIDEBAR_BUTTON_URL');
        if (urlResponse.ok) {
          const urlData = await urlResponse.json();
          if (urlData.value) {
            setSidebarButtonUrl(urlData.value);
            localStorage.setItem('SIDEBAR_BUTTON_URL', urlData.value);
          }
        }
      } catch (error) {
        console.error('Error fetching sidebar button config:', error);
      }
    }

    fetchSidebarButtonConfig();
  }, []);

  // Get organization context for workspace-aware fetching
  const { currentOrganization, isPersonalMode } = useOrganizationStore();
  const orgId = isMultiTenant()
    ? (isPersonalMode ? null : currentOrganization?.id)
    : undefined;

  // Add comprehensive function to stop all marquee animations
  const stopAllMarqueeAnimations = useCallback(() => {
    // Debug: Stopping all marquee animations

    // Find all scrolling title elements and stop their animations
    const scrollingElements = document.querySelectorAll('[id^="scrolling-title-"]');
    const staticElements = document.querySelectorAll('[id^="static-title-"]');
    const styleElements = document.querySelectorAll('[id^="scrolling-style-"]');

    scrollingElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      htmlElement.style.animation = 'none';
      htmlElement.style.transform = 'translate3d(0, 0, 0)';
      htmlElement.style.opacity = '0';
      htmlElement.style.transition = 'none';
    });

    staticElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      htmlElement.style.opacity = '1';
    });

    // Remove all style elements with marquee keyframes
    styleElements.forEach((element) => {
      element.remove();
    });

    // Debug: Stopped marquee animations and removed style elements
  }, []);

  // Simplified cache loading - only essential validation
  const loadFromCacheOrFetch = useCallback(async () => {
    // Don't use cache if we already have chats in state
    if (chats.length > 0) {
      return chats;
    }

    // Quick cache check - simplified validation
    try {
      const cachedData = sessionStorage.getItem(CHATS_CACHE_KEY);
      if (cachedData) {
        const cachedChats = JSON.parse(cachedData);
        if (Array.isArray(cachedChats) && cachedChats.length > 0) {
          // Simple validation - just check basic structure
          if (cachedChats[0].id && cachedChats[0].title) {
            useChatStore.setState({ chats: cachedChats });
            return cachedChats;
          }
        }
      }
    } catch {
      // Silent fail - just fetch fresh data
      sessionStorage.removeItem(CHATS_CACHE_KEY);
    }

    // Fetch fresh data with workspace context
    return await fetchChats(orgId);
  }, [chats.length, fetchChats, orgId]);

  // Simplified cache update - store only metadata, no messages
  const updateCache = useCallback((chatsToCache: Chat[]) => {
    if (!chatsToCache || chatsToCache.length === 0) return;

    try {
      // Store only essential metadata - no messages
      const metadata = chatsToCache
        .slice(0, 20) // Limit to 20 most recent
        .map(chat => ({
          id: chat.id,
          title: chat.title,
          pinned: chat.pinned,
          updated_at: chat.updated_at,
          folder_id: chat.folder_id
        }));

      sessionStorage.setItem(CHATS_CACHE_KEY, JSON.stringify(metadata));
    } catch {
      // Silent fail - not critical
      sessionStorage.removeItem(CHATS_CACHE_KEY);
    }
  }, []);

  // IMPORTANT: Refetch chats immediately when workspace/organization changes
  useEffect(() => {
    if (isMultiTenant()) {
      console.log('[Sidebar] Organization context changed, refetching chats for workspace:', orgId || 'personal');
      // Clear cache when switching workspaces
      sessionStorage.removeItem(CHATS_CACHE_KEY);
      // Force immediate refetch
      fetchChats(orgId).then((fetchedChats) => {
        if (fetchedChats && fetchedChats.length > 0) {
          updateCache(fetchedChats);
        }
      });
      fetchFolders();
    }
  }, [orgId]); // Only depend on orgId - refetch whenever it changes

  // Simplified initial load - single source of truth
  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll on mobile
      if (window.innerWidth < 1024) {
        document.body.style.overflow = 'hidden';
      }

      // Check throttle timing
      const now = Date.now();
      const timeSinceLastFetch = now - lastFetchTimeRef.current;

      // Only fetch if enough time has passed or no data
      if (timeSinceLastFetch > 30000 || chats.length === 0) {
        dispatch({ type: 'SET_INITIAL_LOAD', value: true });

        // Use the unified load function with workspace context
        Promise.all([loadFromCacheOrFetch(), fetchFolders()])
          .then(([fetchedChats]) => {
            lastFetchTimeRef.current = now;

            if (fetchedChats && fetchedChats.length > 0) {
              updateCache(fetchedChats);
            }
          })
          .catch(err => {
            console.error("Error fetching chats:", err);
          })
          .finally(() => {
            dispatch({ type: 'SET_INITIAL_LOAD', value: false });
            dispatch({ type: 'SET_HAS_FETCHED', value: true });
          });
      } else {
        console.log(`Skipping fetch - only ${Math.round(timeSinceLastFetch / 1000)}s since last fetch (30s threshold)`);
      }
    } else {
      // Restore body scroll when sidebar is closed
      document.body.style.overflow = '';
    }

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, fetchChats, fetchFolders, updateCache]); // Removed orgId from here since it has its own effect

  // Initialize all folders as collapsed when they are first loaded
  useEffect(() => {
    if (folders.length > 0 && collapsedFolders.size === 0) {
      startTransition(() => {
        dispatch({ type: 'SET_COLLAPSED_FOLDERS', folderIds: folders.map(folder => folder.id) });
      });
    }
  }, [folders.length]);

  // Listen for voice session end to force refresh
  const { toast } = useToast();

  useEffect(() => {
    const handleVoiceSessionEnd = async () => {
      console.log('[Sidebar] Voice session ended event received, force refreshing chats...');
      console.log('[Sidebar] Voice session ended event received, force refreshing chats...');
      // Removed sync toast as requested by user

      // Clear cache to ensure fresh fetch
      sessionStorage.removeItem(CHATS_CACHE_KEY);
      // Reset throttle timer
      lastFetchTimeRef.current = 0;

      const chats = await fetchChats(orgId);
      if (chats && chats.length > 0) {
        updateCache(chats);

        // Optionally select the newest chat if it's very recent (likely the voice chat)
        const newestChat = chats[0];
        const age = Date.now() - new Date(newestChat.created_at).getTime();
        // Increased window to 20s to be safe
        if (age < 20000) {
          console.log('[Sidebar] Auto-selecting new voice chat:', newestChat.id);
          setCurrentChat(newestChat.id);
          toast({
            title: "Voice Chat Saved",
            description: "Your session has been saved and opened.",
            duration: 3000,
          });
        }
      }
    };

    window.addEventListener('chatrag:voice-session-ended', handleVoiceSessionEnd);
    return () => {
      window.removeEventListener('chatrag:voice-session-ended', handleVoiceSessionEnd);
    };
  }, [fetchChats, orgId, updateCache, setCurrentChat, toast]);

  // Replace the memoized values with more direct access to the chat data
  const displayedChats = useMemo(() =>
    searchQuery ? filteredChats : chats
    , [searchQuery, filteredChats, chats]);

  const pinnedChats = useMemo(() =>
    chats.filter(chat => chat.pinned === true)
    , [chats]);

  const unpinnedChats = useMemo(() =>
    chats.filter(chat => !chat.pinned)
    , [chats]);

  // Add data integrity check to prevent duplicate keys
  const safeUnpinnedChats = useMemo(() => {
    const pinnedIds = new Set(pinnedChats.map(chat => chat.id));
    return chats.filter(chat => !chat.pinned && !pinnedIds.has(chat.id));
  }, [chats, pinnedChats]);

  const safeDisplayedChats = useMemo(() => {
    let baseChats = [];

    if (searchQuery) {
      baseChats = filteredChats;
    } else {
      // For non-search, use unpinned chats only
      const pinnedIds = new Set(pinnedChats.map(chat => chat.id));
      baseChats = chats.filter(chat => !chat.pinned && !pinnedIds.has(chat.id));
    }

    // Aggressive deduplication - use Map for O(1) lookup
    const result = measurePerformance('chat-deduplication', () => {
      const uniqueChats = new Map();
      baseChats.forEach(chat => {
        if (chat && chat.id && !uniqueChats.has(chat.id)) {
          uniqueChats.set(chat.id, chat);
        }
      });

      return Array.from(uniqueChats.values());
    });
    return result;
  }, [searchQuery, filteredChats, chats, pinnedChats]);

  // Emergency deduplication right before render (Step 9 safety measure)
  const renderChats = useMemo(() => {
    const seen = new Set();
    return safeDisplayedChats.filter(chat => {
      if (!chat?.id || seen.has(chat.id)) return false;
      seen.add(chat.id);

      // If searching, show all chats regardless of folder
      if (searchQuery) return true;

      // Otherwise, only show chats that are not in folders (folder_id is null)
      return !chat.folder_id;
    });
  }, [safeDisplayedChats, searchQuery]);

  // Memoize folder-related operations
  const memoizedGetPinnedFolders = useMemo(() =>
    getPinnedFolders()
    , [folders, getPinnedFolders]);

  const memoizedGetUnpinnedFolders = useMemo(() =>
    getUnpinnedFolders()
    , [folders, getUnpinnedFolders]);

  // Memoize chat counts for folders to prevent re-calculation on every render
  const folderChatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    folders.forEach(folder => {
      counts[folder.id] = getChatsByFolder(folder.id).length;
    });
    return counts;
  }, [folders, chats, getChatsByFolder]);

  // Memoize chats by folder to prevent repeated filtering
  const chatsByFolder = useMemo(() => {
    const chatMap: Record<string, Chat[]> = {};
    folders.forEach(folder => {
      chatMap[folder.id] = getChatsByFolder(folder.id);
    });
    return chatMap;
  }, [folders, chats, getChatsByFolder]);

  // Local state for search input to prevent lag
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

  // Debounced search handler to prevent excessive re-renders
  const debouncedSearchRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSetSearchQuery = useCallback((query: string) => {
    // Update local state immediately for responsive input
    setLocalSearchQuery(query);

    // Debounce the store update
    if (debouncedSearchRef.current) {
      clearTimeout(debouncedSearchRef.current);
    }
    debouncedSearchRef.current = setTimeout(() => {
      startTransition(() => {
        setSearchQuery(query);
      });
    }, 300); // 300ms delay for search
  }, [setSearchQuery]);

  // Sync local state when searchQuery is cleared externally
  useEffect(() => {
    if (searchQuery === '') {
      setLocalSearchQuery('');
    }
  }, [searchQuery]);

  // Update the debugging useEffect to be more verbose
  useEffect(() => {
    // Force a render update if we have chats in the store but they're not showing
    if (!isInitialLoad && isOpen && chats.length > 0) {
      console.log(`Sidebar has ${chats.length} chats to display`);
      const pinned = chats.filter(chat => chat.pinned === true);
      const unpinned = chats.filter(chat => !chat.pinned);
      console.log("Raw chats from store:", JSON.stringify(chats.map(c => ({ id: c.id, title: c.title, pinned: c.pinned }))));
      console.log("Pinned chats (direct): ", pinned.length);
      console.log("Unpinned chats (direct): ", unpinned.length);
      console.log("Pinned chats (memoized): ", pinnedChats.length);
      console.log("Unpinned chats (memoized): ", unpinnedChats.length);
      console.log("Safe unpinned chats: ", safeUnpinnedChats.length);

      // Check for potential duplicates
      const pinnedIds = pinnedChats.map(c => c.id);
      const unpinnedIds = safeUnpinnedChats.map(c => c.id);
      const duplicateIds = pinnedIds.filter(id => unpinnedIds.includes(id));
      if (duplicateIds.length > 0) {
        console.warn("Found duplicate chat IDs between sections:", duplicateIds);
      } else {
        console.log("No duplicate chat IDs found - safe rendering");
      }
    } else if (!isInitialLoad && isOpen && chats.length === 0) {
      console.log("No chats available to display");
    }
  }, [isInitialLoad, isOpen, chats, pinnedChats, unpinnedChats, safeUnpinnedChats]);



  // Consolidated focus management
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated before focusing
    const timer = setTimeout(() => {
      if (editingChatId && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else if (editingFolderId && folderInputRef.current) {
        folderInputRef.current.focus();
        folderInputRef.current.select();
      } else if (isSearching && searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 10);

    return () => clearTimeout(timer);
  }, [editingChatId, editingFolderId, isSearching]);


  // Consolidated cleanup and animation management
  useEffect(() => {
    // Stop animations when sidebar closes
    if (!isOpen) {
      stopAllMarqueeAnimations();
    }

    // Cleanup on unmount
    return () => {
      if (debouncedSearchRef.current) {
        clearTimeout(debouncedSearchRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      // Stop animations on unmount
      stopAllMarqueeAnimations();
    };
  }, [isOpen, stopAllMarqueeAnimations]);

  // Initialize section collapsed states based on content (only once after data loads)
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    // Only initialize once, and only after we've actually fetched data
    // The key is to wait until hasFetchedOnMount is true, which indicates data has been loaded
    if (!hasInitialized && hasFetchedOnMount) {
      const hasPinnedChats = pinnedChats.length > 0;
      const hasFolders = folders.length > 0;

      // Initialize section states based on whether they have content
      dispatch({
        type: 'INITIALIZE_SECTIONS',
        hasPinnedChats,
        hasFolders
      });

      // Mark as initialized to prevent re-running
      setHasInitialized(true);
    }
  }, [hasInitialized, hasFetchedOnMount, pinnedChats.length, folders.length, dispatch]);

  // Auto-expand/collapse sections when content changes (after initial load)
  const [prevPinnedCount, setPrevPinnedCount] = useState<number | null>(null);
  const [prevFoldersCount, setPrevFoldersCount] = useState<number | null>(null);

  useEffect(() => {
    // Skip if not initialized yet
    if (!hasInitialized) return;

    // Skip if this is the first time we're setting prev counts
    if (prevPinnedCount === null || prevFoldersCount === null) {
      setPrevPinnedCount(pinnedChats.length);
      setPrevFoldersCount(folders.length);
      return;
    }

    const hasManualPinnedPref = typeof window !== 'undefined' &&
      localStorage.getItem('sidebar-pinned-manually-set') === 'true';
    const hasManualFoldersPref = typeof window !== 'undefined' &&
      localStorage.getItem('sidebar-folders-manually-set') === 'true';

    // Auto-expand pinned section when first item is added (only if no manual preference)
    if (!hasManualPinnedPref && prevPinnedCount === 0 && pinnedChats.length > 0 && isPinnedSectionCollapsed) {
      // Use AUTO_TOGGLE to expand without marking as manual
      dispatch({ type: 'AUTO_TOGGLE_PINNED_SECTION' });
    }

    // Auto-expand folders section when first folder is added (only if no manual preference)
    if (!hasManualFoldersPref && prevFoldersCount === 0 && folders.length > 0 && isFoldersSectionCollapsed) {
      // Use AUTO_TOGGLE to expand without marking as manual
      dispatch({ type: 'AUTO_TOGGLE_FOLDERS_SECTION' });
    }

    // Auto-collapse pinned section when it becomes empty (only if no manual preference)
    if (!hasManualPinnedPref && prevPinnedCount > 0 && pinnedChats.length === 0 && !isPinnedSectionCollapsed) {
      // Use AUTO_TOGGLE to collapse without marking as manual
      dispatch({ type: 'AUTO_TOGGLE_PINNED_SECTION' });
    }

    // Auto-collapse folders section when it becomes empty (only if no manual preference)
    if (!hasManualFoldersPref && prevFoldersCount > 0 && folders.length === 0 && !isFoldersSectionCollapsed) {
      // Use AUTO_TOGGLE to collapse without marking as manual
      dispatch({ type: 'AUTO_TOGGLE_FOLDERS_SECTION' });
    }

    setPrevPinnedCount(pinnedChats.length);
    setPrevFoldersCount(folders.length);
  }, [hasInitialized, pinnedChats.length, folders.length, prevPinnedCount, prevFoldersCount,
    isPinnedSectionCollapsed, isFoldersSectionCollapsed, dispatch]);

  const handleChatSelect = (chat: Chat) => {
    setCurrentChat(chat.id);
    onSelectChat?.(chat);
  };

  const handleRename = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      dispatch({ type: 'START_CHAT_EDIT', chatId, title: chat.title });
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingChatId && editingTitle.trim()) {
      await renameChat(editingChatId, editingTitle.trim());
      dispatch({ type: 'SUBMIT_CHAT_EDIT' });
    }
  };

  const handleRenameCancel = () => {
    dispatch({ type: 'CANCEL_CHAT_EDIT' });
  };

  const handleSearchToggle = () => {
    dispatch({ type: 'TOGGLE_SEARCH' });
    if (!isSearching) {
      // Clear any pending debounced search
      if (debouncedSearchRef.current) {
        clearTimeout(debouncedSearchRef.current);
        debouncedSearchRef.current = null;
      }
      setSearchQuery('');
    }
  };

  // Folder-related functions
  const toggleFolderCollapse = (folderId: string) => {
    startTransition(() => {
      dispatch({ type: 'TOGGLE_FOLDER_COLLAPSE', folderId });
    });
  };

  const handleFolderRename = (folderId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      dispatch({ type: 'START_FOLDER_EDIT', folderId, name: folder.name });
    }
  };

  const handleFolderRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFolderId && editingFolderName.trim()) {
      await updateFolder(editingFolderId, { name: editingFolderName.trim() });
      dispatch({ type: 'SUBMIT_FOLDER_EDIT' });
    }
  };

  const handleFolderRenameCancel = () => {
    dispatch({ type: 'CANCEL_FOLDER_EDIT' });
  };

  const handleFolderDeleteRequest = (folder: Folder) => {
    console.log('[DELETE DEBUG] Delete requested for folder:', folder.id, folder.name);

    // Close any open dropdowns first
    dispatch({ type: 'SET_OPEN_DROPDOWN', dropdownId: null });

    // Immediately open modal
    dispatch({ type: 'OPEN_FOLDER_DELETE_MODAL', folder });
  };

  const handleConfirmFolderDelete = async () => {
    if (folderToDelete) {
      const folderIdToDelete = folderToDelete.id;
      console.log('[DELETE DEBUG] Confirming delete for folder:', folderIdToDelete, 'Delete chats:', deleteFolderWithChats);

      // Close modal immediately to show responsiveness
      dispatch({ type: 'CLOSE_FOLDER_DELETE_MODAL' });

      // Execute delete without waiting
      deleteFolder(folderIdToDelete, deleteFolderWithChats);
    }
  };

  const handleCancelFolderDelete = () => {
    console.log('[DELETE DEBUG] Folder delete cancelled');
    dispatch({ type: 'CLOSE_FOLDER_DELETE_MODAL' });
    dispatch({ type: 'SET_DELETE_FOLDER_WITH_CHATS', value: false });
  };

  const handleMoveChatToFolder = async (chatId: string, folderId: string | null) => {
    await moveChatToFolder(chatId, folderId);
  };

  // Add new animation variants
  const sidebarVariants = {
    hidden: {
      x: '-100%',
      opacity: 0.2,
      boxShadow: '0px 0px 0px rgba(0,0,0,0)'
    },
    visible: {
      x: 0,
      opacity: 1,
      boxShadow: theme === 'dark'
        ? '1px 0 8px rgba(0,0,0,0.3)'
        : '1px 0 8px rgba(0,0,0,0.15)',
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 30,
        mass: 1,
        when: "beforeChildren",
        staggerChildren: 0.05
      }
    },
    exit: {
      x: '-100%',
      opacity: 0,
      boxShadow: '0px 0px 0px rgba(0,0,0,0)',
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 40,
        mass: 0.8,
        when: "afterChildren",
        staggerChildren: 0.03,
        staggerDirection: -1
      }
    }
  };

  const childVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 30
      }
    },
    exit: {
      opacity: 0,
      x: -5,
      transition: {
        duration: 0.2,
        ease: "easeInOut"
      }
    }
  };

  // Debounced fetch function to avoid hammering the server
  const debouncedFetch = useCallback(async () => {
    const now = Date.now();
    // Only fetch if it's been more than 2 seconds since the last fetch
    if (now - lastFetchTimeRef.current > 2000) {
      console.log("Running debounced fetch");
      lastFetchTimeRef.current = now;
      try {
        const fetchedChats = await fetchChats(orgId);
        // Note: fetchChats() already updates the store internally with merged chats
        // that preserve titlePending. We only update the cache here.
        if (fetchedChats && Array.isArray(fetchedChats)) {
          updateCache(fetchedChats);
        }
      } catch (err) {
        console.error("Error in debounced fetch:", err);
      }
    } else {
      console.log("Skipping fetch - too soon since last fetch");
    }
  }, [fetchChats, updateCache]);

  // Optimized event listener effect
  useEffect(() => {
    const handleChatCreated = async (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("Chat created event received in sidebar");

      if (customEvent.detail?.chat?.id) {
        const newChat = customEvent.detail.chat as Chat;

        // Immediately update local state for better UX
        useChatStore.setState(state => {
          if (!state.chats.some(chat => chat.id === newChat.id)) {
            const updatedChats = [newChat, ...state.chats];

            // Also update the cache
            try {
              updateCache(updatedChats);
            } catch (err) {
              console.error("Error updating cache after chat created:", err);
            }

            return {
              ...state,
              chats: updatedChats
            };
          }
          return state;
        });

        // Throttle backend fetch to every 2 seconds
        debouncedFetch();
      }
    };

    const handleChatUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent;

      if (customEvent.detail?.chat?.id) {
        const updatedChat = customEvent.detail.chat as Chat;

        // Update local state immediately
        useChatStore.setState(state => {
          const existingChat = state.chats.find(chat => chat.id === updatedChat.id);

          if (existingChat) {
            // CRITICAL: Preserve titlePending from existing state
            // If existing chat has titlePending=true and updatedChat doesn't have titlePending set,
            // keep titlePending=true to prevent "New Chat" from appearing before AI title arrives
            const chatWithPreservedPending = {
              ...updatedChat,
              titlePending: updatedChat.titlePending !== undefined
                ? updatedChat.titlePending
                : existingChat.titlePending,
              // Also preserve existing title if titlePending is true to prevent "New Chat" flash
              title: existingChat.titlePending && !updatedChat.titlePending
                ? existingChat.title
                : updatedChat.title
            };

            const updatedChats = state.chats.map(chat =>
              chat.id === updatedChat.id ? chatWithPreservedPending : chat
            );

            // Update the cache
            try {
              updateCache(updatedChats);
            } catch (err) {
              console.error("Error updating cache after chat updated:", err);
            }

            return {
              ...state,
              chats: updatedChats,
              filteredChats: state.searchQuery ?
                state.filteredChats.map(chat =>
                  chat.id === updatedChat.id ? chatWithPreservedPending : chat
                ) : state.filteredChats
            };
          }

          return state;
        });

        // Throttle backend fetch to every 2 seconds
        debouncedFetch();
      }
    };

    // Add event listeners
    window.addEventListener(ChatEvents.CHAT_CREATED, handleChatCreated);
    window.addEventListener(ChatEvents.CHAT_UPDATED, handleChatUpdated);

    // Replace continuous polling with a more efficient approach
    // Only poll if sidebar is open and it's been at least 10 seconds since last fetch
    const pollingInterval = setInterval(() => {
      if (isOpen && Date.now() - lastFetchTimeRef.current > 10000) {
        debouncedFetch();
      }
    }, 30000); // Check every 30 seconds to reduce performance impact

    pollingIntervalRef.current = pollingInterval;

    // Cleanup
    return () => {
      window.removeEventListener(ChatEvents.CHAT_CREATED, handleChatCreated);
      window.removeEventListener(ChatEvents.CHAT_UPDATED, handleChatUpdated);

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isOpen, debouncedFetch, updateCache]);

  // First, let's add a handler for chat deletion that clears the cache
  const handleDeleteChat = async (chatId: string) => {
    try {
      // Clear cache immediately
      if (typeof window !== 'undefined') {
        localStorage.removeItem(CHATS_CACHE_KEY);
        localStorage.removeItem(CACHE_EXPIRY_KEY);
      }

      // Delete immediately without await to not block UI
      deleteChat(chatId).then(() => {
        // Refresh chats after successful deletion
        fetchChats(orgId).then(fetchedChats => {
          if (fetchedChats && Array.isArray(fetchedChats)) {
            updateCache(fetchedChats);
          }
        });
      });

    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  };

  // Add handlers for delete confirmation modal
  const handleDeleteRequest = (chat: Chat) => {
    console.log('[DELETE DEBUG] Delete requested for chat:', chat.id, chat.title);

    // Close any open dropdowns first
    dispatch({ type: 'SET_OPEN_DROPDOWN', dropdownId: null });

    // Immediately open modal without animations
    dispatch({ type: 'OPEN_DELETE_MODAL', chat });
  };

  const handleConfirmDelete = async () => {
    if (chatToDelete) {
      const chatIdToDelete = chatToDelete.id;
      console.log('[DELETE DEBUG] Confirming delete for chat:', chatIdToDelete);

      // Close modal immediately to show responsiveness
      dispatch({ type: 'CLOSE_DELETE_MODAL' });

      // Execute delete without waiting
      handleDeleteChat(chatIdToDelete);
    }
  };

  const handleCancelDelete = () => {
    console.log('[DELETE DEBUG] Delete cancelled');
    dispatch({ type: 'CLOSE_DELETE_MODAL' });
  };

  // Consolidated keyboard event handlers for modals
  useEffect(() => {
    if (!isDeleteModalOpen && !isFolderDeleteModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Return') {
        e.preventDefault();
        if (isDeleteModalOpen) {
          handleConfirmDelete();
        } else if (isFolderDeleteModalOpen) {
          handleConfirmFolderDelete();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isDeleteModalOpen) {
          handleCancelDelete();
        } else if (isFolderDeleteModalOpen) {
          handleCancelFolderDelete();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDeleteModalOpen, isFolderDeleteModalOpen]);

  return (
    <>
      {/* Backdrop - only on mobile */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="fixed inset-0 bg-black/20 dark:bg-black/50 z-[9998] lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.div
            key="sidebar"
            variants={sidebarVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "fixed top-0 left-0 h-full overflow-hidden shadow-lg",
              // Mobile: full width and higher z-index to cover everything, Desktop: fixed width
              "w-full z-[9999] lg:w-64 lg:z-[60]",
              // Ensure full viewport coverage on mobile
              "h-screen lg:h-full",
              theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]"
            )}
            style={
              isChromeIOS ? {
                height: 'calc(100vh - 80px)',
                maxHeight: 'calc(100vh - 80px)'
              } : undefined
            }
            onMouseEnter={() => document.documentElement.classList.add('sidebar-hover')}
            onMouseLeave={() => document.documentElement.classList.remove('sidebar-hover')}
          >
            <div className={cn(
              "h-full w-full",
              // Remove border on mobile, keep on desktop
              "lg:border-r border-[#FFE0D0] dark:border-[#2F2F2F]",
              theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]",
              "sidebar-main-container"
            )}>
              <div className="flex flex-col h-full sidebar-content">
                {/* Header - Mobile vs Desktop Layout */}
                <div
                  className={cn(
                    "flex items-center justify-between border-b relative z-[70]",
                    // Mobile: larger height, Desktop: current height
                    "h-16 lg:h-16 px-4 lg:px-6",
                    "border-[#FFE0D0] dark:border-[#2F2F2F]",
                    theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]"
                  )}
                >
                  {/* Mobile Header Layout */}
                  <div className="flex items-center justify-between w-full lg:hidden">
                    {/* Left: Back/Close Button */}
                    <button
                      onClick={onClose}
                      className="flex items-center justify-center w-10 h-10 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200"
                    >
                      <ArrowLeft className="h-6 w-6" />
                    </button>

                    {/* Center: Title */}
                    <motion.h1
                      variants={childVariants}
                      className="text-xl font-semibold text-gray-900 dark:text-gray-100"
                    >
                      Chats
                    </motion.h1>

                    {/* Right: User Avatar */}
                    <UserMenu email={userEmail} onSignOut={onSignOut} />
                  </div>

                  {/* Desktop Header Layout */}
                  <div className="hidden lg:flex items-center justify-between w-full relative z-[80]">
                    <PortalTooltip content={t('closeSidebar')} align="right">
                      <button
                        onClick={onClose}
                        className="flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200 group relative z-[101]"
                      >
                        <PanelLeft className="h-5 w-5" />
                      </button>
                    </PortalTooltip>
                    <div className="flex items-center gap-1">
                      {!isSearching && (
                        <PortalTooltip content={t('search')}>
                          <button
                            onClick={handleSearchToggle}
                            className={cn(
                              "flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200 group relative z-[101]",
                              isSearching && "bg-[#FFE0D0] dark:bg-[#424242]"
                            )}
                          >
                            <Search className="h-5 w-5" />
                          </button>
                        </PortalTooltip>
                      )}
                      {isSearching && (
                        <button
                          onClick={handleSearchToggle}
                          className={cn(
                            "flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200 group relative z-[101]",
                            "bg-[#FFE0D0] dark:bg-[#424242]"
                          )}
                        >
                          <Search className="h-5 w-5" />
                        </button>
                      )}
                      <PortalTooltip content={t('newFolder')}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ type: 'OPEN_CREATE_FOLDER_MODAL' });
                          }}
                          className="flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200 group relative z-[101]"
                        >
                          <FolderPlus className="h-5 w-5" />
                        </button>
                      </PortalTooltip>
                      {onNewChat && (
                        <PortalTooltip content={t('newChat')}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNewChat();
                            }}
                            className="flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 hover:bg-[#FFE0D0] dark:hover:bg-[#424242] rounded-lg transition-all duration-200 group relative z-[101]"
                          >
                            <SquarePen className="h-5 w-5" />
                          </button>
                        </PortalTooltip>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mobile Search Bar */}
                <div className="lg:hidden border-b border-[#FFE0D0] dark:border-[#2F2F2F] px-4 py-3">
                  {/* Search input - full width */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      type="text"
                      placeholder={t('search')}
                      value={localSearchQuery}
                      onChange={(e) => debouncedSetSearchQuery(e.target.value)}
                      className="w-full pl-10 bg-[#EFE1D5] dark:bg-[#2F2F2F] border-[#FFE0D0] dark:border-[#424242] focus:ring-[#FF6417] dark:focus:ring-[#424242] h-11"
                    />
                  </div>

                  {/* Action buttons row */}
                  <div className="flex items-center gap-2">
                    {onNewChat && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewChat();
                        }}
                        className="flex-1 h-11 min-h-[44px] rounded-lg bg-[#FF6417] hover:bg-[#E55A15] text-white flex items-center justify-center gap-2 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#FF6417] focus:ring-offset-2 text-sm font-medium box-border"
                      >
                        <SquarePen className="h-4 w-4" />
                        <span>{t('newChat')}</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'OPEN_CREATE_FOLDER_MODAL' });
                      }}
                      className="flex-1 min-h-[46px] rounded-lg border border-[#FFE0D0] dark:border-[#424242] bg-transparent hover:bg-[#FFE0D0] dark:hover:bg-[#2F2F2F] text-gray-700 dark:text-gray-200 flex items-center justify-center gap-2 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#FF6417] focus:ring-offset-2 text-sm font-medium box-border"
                    >
                      <FolderPlus className="h-4 w-4" />
                      <span>{t('newFolder')}</span>
                    </button>
                  </div>
                </div>

                {/* Organization Switcher (Multi-tenant only) */}
                {isMultiTenant() && (
                  <div className="border-b border-[#FFE0D0] dark:border-[#2F2F2F] px-4 py-3 relative z-50">
                    <OrganizationSwitcher />
                  </div>
                )}

                {/* Desktop Search Input */}
                <AnimatePresence mode="wait">
                  {isSearching && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{
                        height: "auto",
                        opacity: 1,
                        transition: {
                          height: { type: "spring", stiffness: 400, damping: 35 },
                          opacity: { duration: 0.2, delay: 0.1 }
                        }
                      }}
                      exit={{
                        height: 0,
                        opacity: 0,
                        transition: {
                          height: { type: "spring", stiffness: 400, damping: 45 },
                          opacity: { duration: 0.15 }
                        }
                      }}
                      className={cn(
                        "border-b overflow-hidden hidden lg:block",
                        "border-[#FFE0D0] dark:border-[#2F2F2F]",
                        theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]"
                      )}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: -5 }}
                        animate={{
                          scale: 1,
                          opacity: 1,
                          y: 0,
                          transition: {
                            type: "spring",
                            stiffness: 400,
                            damping: 25,
                            delay: 0.1
                          }
                        }}
                        exit={{
                          scale: 0.95,
                          opacity: 0,
                          y: -5,
                          transition: {
                            duration: 0.15,
                            ease: "easeInOut"
                          }
                        }}
                        className="px-4 py-2"
                      >
                        <Input
                          ref={searchInputRef}
                          type="text"
                          placeholder={t('searchChats')}
                          value={localSearchQuery}
                          onChange={(e) => debouncedSetSearchQuery(e.target.value)}
                          className="w-full bg-[#EFE1D5] dark:bg-[#2F2F2F] border-[#FFE0D0] dark:border-[#424242] focus:ring-[#FF6417] dark:focus:ring-[#424242]"
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Wrap content with the group/sidebar */}
                <motion.div
                  variants={childVariants}
                  className="flex-1 flex flex-col group/sidebar h-[calc(100vh-8rem)]"
                >
                  {/* Content section with scrollbar */}
                  <motion.div
                    ref={scrollContainerRef}
                    variants={childVariants}
                    className={cn(
                      "flex-1 overflow-y-auto scrollbar",
                      "scrollbar-w-3",
                      "scrollbar-track-[#FFF1E5] dark:scrollbar-track-[#212121]",
                      "scrollbar-thumb-[#EADDD7]",
                      "dark:scrollbar-thumb-[#2F2F2F]",
                      "group-hover/sidebar:scrollbar-thumb-[#D4C0B6]",
                      "group-hover/sidebar:dark:scrollbar-thumb-[#424242]",
                      "group-data-[state=dimmed]/root:scrollbar-thumb-[#EADDD7]",
                      "group-data-[state=dimmed]/root:dark:scrollbar-thumb-[#2F2F2F]",
                      theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]"
                    )}
                  >
                    <div className="p-4 space-y-4">
                      {/* Ghost Mode Indicator */}
                      {isGhostMode && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg",
                            "bg-purple-500/10 dark:bg-purple-600/10",
                            "border border-purple-500/20 dark:border-purple-600/20",
                            "backdrop-blur-md"
                          )}
                        >
                          <Ghost className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                            {t('incognitoChatActive')}
                          </span>
                        </motion.div>
                      )}

                      {/* Pinned Chats Section */}
                      {!searchQuery && (
                        <motion.div variants={childVariants}>
                          <div
                            className="flex items-center justify-between mb-2 cursor-pointer"
                            onClick={() => startTransition(() => dispatch({ type: 'TOGGLE_PINNED_SECTION' }))}
                          >
                            <h2 className="text-sm font-medium flex items-center">
                              {t('pinnedChats')}
                              {isPinnedSectionCollapsed ? (
                                <ChevronRight className="h-4 w-4 ml-1" />
                              ) : (
                                <ChevronDown className="h-4 w-4 ml-1" />
                              )}
                            </h2>
                          </div>

                          {!isPinnedSectionCollapsed && (
                            <div className="space-y-1 mb-4">
                              {pinnedChats.length > 0 ? (
                                pinnedChats.map((chat) => (
                                  <ChatItem
                                    key={`pinned-${chat.id}`}
                                    chat={chat}
                                    isEditing={editingChatId === chat.id}
                                    editingTitle={editingTitle}
                                    onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                    onEditSubmit={handleRenameSubmit}
                                    onEditCancel={handleRenameCancel}
                                    onChatSelect={handleChatSelect}
                                    onEditStart={(id) => handleRename(id)}
                                    onDelete={handleDeleteRequest}
                                    onTogglePin={togglePinChat}
                                    onMoveToFolder={moveChatToFolder}
                                    folders={folders}
                                    showRelativeTime={true}
                                    inputRef={inputRef}
                                    t={t}
                                    isDarkMode={isDarkMode}
                                  />
                                ))
                              ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                                  {t('noPinnedChats')}
                                </div>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}

                      {/* Folders Section */}
                      {!searchQuery && (
                        <motion.div variants={childVariants}>
                          <div
                            className="flex items-center justify-between mb-2 cursor-pointer"
                            onClick={() => startTransition(() => dispatch({ type: 'TOGGLE_FOLDERS_SECTION' }))}
                          >
                            <h2 className="text-sm font-medium flex items-center">
                              {t('folders')}
                              {isFoldersSectionCollapsed ? (
                                <ChevronRight className="h-4 w-4 ml-1" />
                              ) : (
                                <ChevronDown className="h-4 w-4 ml-1" />
                              )}
                            </h2>
                          </div>

                          {!isFoldersSectionCollapsed && (
                            <div className="space-y-1 mb-4">
                              {/* Pinned Folders */}
                              {memoizedGetPinnedFolders.map((folder) => (
                                <FolderItem
                                  key={`pinned-folder-${folder.id}`}
                                  folder={folder}
                                  isEditing={editingFolderId === folder.id}
                                  editingName={editingFolderName}
                                  onEditingNameChange={(name) => dispatch({ type: 'UPDATE_FOLDER_NAME', name })}
                                  onEditSubmit={handleFolderRenameSubmit}
                                  onEditCancel={handleFolderRenameCancel}
                                  onEditStart={handleFolderRename}
                                  onDelete={handleFolderDeleteRequest}
                                  onTogglePin={togglePinFolder}
                                  onToggleCollapse={toggleFolderCollapse}
                                  isCollapsed={collapsedFolders.has(folder.id)}
                                  chatCount={folderChatCounts[folder.id] || 0}
                                  inputRef={folderInputRef}
                                  t={t}
                                  isDarkMode={isDarkMode}
                                  isPinned={true}
                                >
                                  {/* Chats in pinned folder */}
                                  <div className="ml-6 space-y-1">
                                    {(chatsByFolder[folder.id] || []).map((chat) => (
                                      <ChatItem
                                        key={`folder-chat-${chat.id}`}
                                        chat={chat}
                                        isEditing={editingChatId === chat.id}
                                        editingTitle={editingTitle}
                                        onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                        onEditSubmit={handleRenameSubmit}
                                        onEditCancel={handleRenameCancel}
                                        onChatSelect={handleChatSelect}
                                        onEditStart={(id) => handleRename(id)}
                                        onDelete={handleDeleteRequest}
                                        onTogglePin={togglePinChat}
                                        onMoveToFolder={handleMoveChatToFolder}
                                        folders={folders}
                                        showRelativeTime={false}
                                        inputRef={inputRef}
                                        t={t}
                                        isDarkMode={isDarkMode}
                                      />
                                    ))}
                                    {(chatsByFolder[folder.id]?.length || 0) === 0 && (
                                      <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                                        {t('noChatsInFolder')}
                                      </div>
                                    )}
                                  </div>
                                </FolderItem>
                              ))}

                              {/* Unpinned Folders */}
                              {memoizedGetUnpinnedFolders.map((folder) => (
                                <FolderItem
                                  key={`unpinned-folder-${folder.id}`}
                                  folder={folder}
                                  isEditing={editingFolderId === folder.id}
                                  editingName={editingFolderName}
                                  onEditingNameChange={(name) => dispatch({ type: 'UPDATE_FOLDER_NAME', name })}
                                  onEditSubmit={handleFolderRenameSubmit}
                                  onEditCancel={handleFolderRenameCancel}
                                  onEditStart={handleFolderRename}
                                  onDelete={handleFolderDeleteRequest}
                                  onTogglePin={togglePinFolder}
                                  onToggleCollapse={toggleFolderCollapse}
                                  isCollapsed={collapsedFolders.has(folder.id)}
                                  chatCount={folderChatCounts[folder.id] || 0}
                                  inputRef={folderInputRef}
                                  t={t}
                                  isDarkMode={isDarkMode}
                                  isPinned={false}
                                >
                                  {/* Chats in unpinned folder */}
                                  <div className="ml-6 space-y-1">
                                    {(chatsByFolder[folder.id] || []).map((chat) => (
                                      <ChatItem
                                        key={`folder-chat-${chat.id}`}
                                        chat={chat}
                                        isEditing={editingChatId === chat.id}
                                        editingTitle={editingTitle}
                                        onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                        onEditSubmit={handleRenameSubmit}
                                        onEditCancel={handleRenameCancel}
                                        onChatSelect={handleChatSelect}
                                        onEditStart={(id) => handleRename(id)}
                                        onDelete={handleDeleteRequest}
                                        onTogglePin={togglePinChat}
                                        onMoveToFolder={handleMoveChatToFolder}
                                        folders={folders}
                                        showRelativeTime={false}
                                        inputRef={inputRef}
                                        t={t}
                                        isDarkMode={isDarkMode}
                                      />
                                    ))}
                                    {(chatsByFolder[folder.id]?.length || 0) === 0 && (
                                      <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                                        {t('noChatsInFolder')}
                                      </div>
                                    )}
                                  </div>
                                </FolderItem>
                              ))}

                              {folders.length === 0 && (
                                <div className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
                                  {t('noFolders')}
                                </div>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}

                      {/* Recent Chats Section */}
                      <motion.div variants={childVariants}>
                        <h2 className="text-sm font-medium mb-2">
                          {searchQuery ? t('searchResults') : t('recentChats')}
                          {searchQuery && ` (${filteredChats.length})`}
                        </h2>
                        {/* Debug section - invisible but shows chat info */}
                        {chats.length > 0 && (
                          <div className="hidden">
                            Debug info - Chats: {chats.length},
                            Unpinned: {chats.filter(c => !c.pinned).length},
                            First chat: {chats[0]?.title}
                          </div>
                        )}
                        <div className="space-y-1">
                          {isInitialLoad ? (
                            // Add loading indicators for better UX
                            <div className="flex flex-col space-y-2 p-3">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="animate-pulse flex items-center">
                                  <div className="h-4 w-4 bg-gray-300 dark:bg-gray-700 rounded-full mr-2"></div>
                                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6"></div>
                                </div>
                              ))}
                            </div>
                          ) : searchQuery ? (
                            // Use virtual scrolling only for large datasets
                            renderChats.length > 50 ? (
                              <VirtualChatList
                                chats={renderChats}
                                parentRef={scrollContainerRef}
                                renderChat={(chat, index) => (
                                  <ChatItem
                                    key={`search-${chat.id}-${index}`}
                                    chat={chat}
                                    isEditing={editingChatId === chat.id}
                                    editingTitle={editingTitle}
                                    onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                    onEditSubmit={handleRenameSubmit}
                                    onEditCancel={handleRenameCancel}
                                    onChatSelect={handleChatSelect}
                                    onEditStart={(id) => handleRename(id)}
                                    onDelete={handleDeleteRequest}
                                    onTogglePin={togglePinChat}
                                    onMoveToFolder={handleMoveChatToFolder}
                                    folders={folders}
                                    showRelativeTime={true}
                                    inputRef={inputRef}
                                    t={t}
                                    isDarkMode={isDarkMode}
                                  />
                                )}
                              />
                            ) : (
                              // Regular rendering for small lists
                              renderChats.map((chat, index) => (
                                <ChatItem
                                  key={`search-${chat.id}-${index}`}
                                  chat={chat}
                                  isEditing={editingChatId === chat.id}
                                  editingTitle={editingTitle}
                                  onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                  onEditSubmit={handleRenameSubmit}
                                  onEditCancel={handleRenameCancel}
                                  onChatSelect={handleChatSelect}
                                  onEditStart={(id) => handleRename(id)}
                                  onDelete={handleDeleteRequest}
                                  onTogglePin={togglePinChat}
                                  onMoveToFolder={handleMoveChatToFolder}
                                  folders={folders}
                                  showRelativeTime={true}
                                  inputRef={inputRef}
                                  t={t}
                                  isDarkMode={isDarkMode}
                                />
                              ))
                            )
                          ) : (
                            // Time-grouped chats for non-search view
                            (() => {
                              const groupedChats = groupChatsByTimeCached(renderChats, t);
                              return Object.entries(groupedChats).map(([timeGroup, groupChats]) => (
                                <div key={timeGroup} className="mb-4">
                                  <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
                                    {timeGroup}
                                  </h3>
                                  <div className="space-y-1">
                                    {groupChats.map((chat, index) => (
                                      <ChatItem
                                        key={`${timeGroup}-${chat.id}-${index}`}
                                        chat={chat}
                                        isEditing={editingChatId === chat.id}
                                        editingTitle={editingTitle}
                                        onEditingTitleChange={(title) => dispatch({ type: 'UPDATE_EDIT_TITLE', title })}
                                        onEditSubmit={handleRenameSubmit}
                                        onEditCancel={handleRenameCancel}
                                        onChatSelect={handleChatSelect}
                                        onEditStart={(id) => handleRename(id)}
                                        onDelete={handleDeleteRequest}
                                        onTogglePin={togglePinChat}
                                        onMoveToFolder={handleMoveChatToFolder}
                                        folders={folders}
                                        showRelativeTime={true}
                                        inputRef={inputRef}
                                        t={t}
                                        isDarkMode={isDarkMode}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ));
                            })()
                          )}
                          {renderChats.length === 0 && !isInitialLoad && (
                            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                              {searchQuery ? t('noChats') : (chats.length > 0 ? `${t('noChats')} (All chats are pinned)` : t('noChatsAvailable'))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    </div>
                  </motion.div>

                  {/* Footer */}
                  <motion.div
                    variants={childVariants}
                    className={cn(
                      "p-4 border-t",
                      "border-[#FFE0D0] dark:border-[#2F2F2F]",
                      theme === 'dark' ? "bg-[#212121]" : "bg-[#FFF1E5]"
                    )}
                    style={
                      isIOSSafari ? {
                        paddingTop: '20px',
                        paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px) + 40px)'
                      } : undefined
                    }
                  >
                    <motion.a
                      variants={childVariants}
                      href={sidebarButtonUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-2 px-3 py-2 text-sm rounded-lg hover:bg-[#FFE8DC] dark:hover:bg-[#2F2F2F] transition-all duration-200"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>{sidebarButtonText}</span>
                    </motion.a>
                  </motion.div>
                </motion.div>
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0 }}
          className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm z-[10000] flex items-center justify-center p-4"
          style={MODAL_BACKDROP_STYLE}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
              duration: 0.15
            }}
            className={cn(
              "w-full max-w-md rounded-xl shadow-lg border",
              "bg-[#FFF1E5] dark:bg-[#212121]",
              "border-[#FFE0D0] dark:border-[#2F2F2F]"
            )}
          >
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                {t('confirmDeleteChat') || 'Confirm Delete'}
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                {t('confirmDeleteChatMessage') || 'Are you sure you want to delete'}
                {' '}
                &ldquo;{chatToDelete?.title}&rdquo;?
                {' '}
                {t('actionCannotBeUndone') || 'This action cannot be undone.'}
              </p>
              <div className="flex justify-end gap-3">
                <motion.button
                  onClick={handleCancelDelete}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-all duration-200",
                    "bg-transparent hover:bg-[#FFE0D0] dark:hover:bg-[#2F2F2F]",
                    "text-gray-700 dark:text-gray-300",
                    "border border-[#FFE0D0] dark:border-[#424242]"
                  )}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {t('cancel') || 'Cancel'}
                </motion.button>
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmDelete();
                  }}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-all duration-200",
                    "bg-red-600 hover:bg-red-700 text-white",
                    "shadow-md hover:shadow-lg"
                  )}
                  whileHover={{ scale: 1.02 }}
                  autoFocus
                >
                  {t('delete') || 'Delete'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Create Folder Modal */}
      <CreateFolderModal
        isOpen={isCreateFolderModalOpen}
        onClose={() => dispatch({ type: 'CLOSE_CREATE_FOLDER_MODAL' })}
      />

      {/* Folder Delete Confirmation Modal */}
      {isFolderDeleteModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0 }}
          className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm z-[10000] flex items-center justify-center p-4"
          style={MODAL_BACKDROP_STYLE}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
              duration: 0.15
            }}
            className={cn(
              "w-full max-w-md rounded-xl shadow-lg border",
              "bg-[#FFF1E5] dark:bg-[#212121]",
              "border-[#FFE0D0] dark:border-[#2F2F2F]"
            )}
          >
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                {t('deleteFolder') || 'Delete Folder'}
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                {t('confirmDeleteFolderMessage') || `Are you sure you want to delete "${folderToDelete?.name}"?`}
              </p>

              <div className="mb-6 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteFolderWithChats}
                    onChange={(e) => dispatch({ type: 'SET_DELETE_FOLDER_WITH_CHATS', value: e.target.checked })}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('deleteFolderWithChats') || 'Also delete all chats in this folder'}
                  </span>
                </label>
                {!deleteFolderWithChats && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 ml-6">
                    {t('deleteFolderKeepChats') || 'Chats will be moved to the root level'}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <motion.button
                  onClick={handleCancelFolderDelete}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-all duration-200",
                    "bg-transparent hover:bg-[#FFE0D0] dark:hover:bg-[#2F2F2F]",
                    "text-gray-700 dark:text-gray-300",
                    "border border-[#FFE0D0] dark:border-[#424242]"
                  )}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {t('cancel') || 'Cancel'}
                </motion.button>
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmFolderDelete();
                  }}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-all duration-200",
                    "bg-red-600 hover:bg-red-700 text-white",
                    "shadow-md hover:shadow-lg"
                  )}
                  whileHover={{ scale: 1.02 }}
                  autoFocus
                >
                  {t('delete') || 'Delete'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
