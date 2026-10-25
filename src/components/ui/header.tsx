'use client';

import { PanelLeft, SquarePen, ChevronDown, Ghost } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { ModelSelector } from './model-selector';
import { ThemeToggle } from './theme-toggle';
import { ShareChatButton } from './share-chat-button';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { TextSizeSlider } from './text-size-slider';
import { useChatStore } from '@/lib/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { UserMenu } from './user-menu';
import { PermanentDocUploadButton } from './permanent-doc-upload-button';
import { MobileToolbarFixed } from './mobile-toolbar-fixed';
import { useState, useRef, useEffect } from 'react';
import type { ProcessedDocument } from './permanent-doc-upload-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { useAdminStore, useAdmin } from '@/lib/admin-store';
import Image from 'next/image';
import { PortalTooltip } from '@/components/ui/portal-tooltip';
import { WhatsAppConnectionButton } from './whatsapp-connection-button';
import { useGhostModeStore } from '@/lib/ghost-mode-store';

interface HeaderProps {
  onNewChat?: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen?: boolean;
}

export function Header({ onNewChat, onToggleSidebar, isSidebarOpen }: HeaderProps) {
  const { user, isAuthEnabled, signOut } = useAuth();
  const pathname = usePathname();
  const isAuthPage = pathname === '/auth';
  const { currentChatId, chats } = useChatStore(
    useShallow((s) => ({ currentChatId: s.currentChatId, chats: s.chats }))
  );
  const { isGhostMode, toggleGhostMode, hasUnsavedGhostMessages } = useGhostModeStore();
  const [isPermanentDocProcessing, setIsPermanentDocProcessing] = useState(false);
  const [permanentDoc, setPermanentDoc] = useState<ProcessedDocument | null>(null);
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark';
  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
  const dropdownBorder = isDarkMode ? '1px solid #2F2F2F' : '1px solid #EFE1D5';

  // Separate dropdown states for each ModelSelector instance
  const [isModelDropdownOpenClosed, setIsModelDropdownOpenClosed] = useState(false);
  const [isModelDropdownOpenOpen, setIsModelDropdownOpenOpen] = useState(false);
  const [isModelDropdownOpenMobile, setIsModelDropdownOpenMobile] = useState(false);
  const [isMcpDropdownOpen, setIsMcpDropdownOpen] = useState(false);

  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelDropdownOpenRef = useRef<HTMLDivElement>(null);
  const modelTriggerOpenRef = useRef<HTMLButtonElement>(null);
  const modelDropdownMobileRef = useRef<HTMLDivElement>(null);
  const modelTriggerMobileRef = useRef<HTMLButtonElement>(null);
  const mcpDropdownRef = useRef<HTMLDivElement>(null);
  const mcpTriggerRef = useRef<HTMLButtonElement>(null);
  const { isAdmin } = useAdmin();
  const [headerLogoType, setHeaderLogoType] = useState<string>('text');
  const [headerLogoText, setHeaderLogoText] = useState<string>('ChatRAG');
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(256); // Default sidebar width

  // Show TextSizeSlider whenever there's a current chat (saved or ghost)
  const hasActiveChat = Boolean(currentChatId);

  // Handle dynamic sidebar width for proper positioning
  useEffect(() => {
    const updateSidebarWidth = () => {
      // On larger screens, use 256px, on smaller screens adjust as needed
      if (typeof window !== 'undefined') {
        const width = window.innerWidth >= 1024 ? 256 : (window.innerWidth >= 768 ? 256 : 0);
        setSidebarWidth(width);
      }
    };

    // Initial calculation
    updateSidebarWidth();

    // Update on resize
    window.addEventListener('resize', updateSidebarWidth);

    return () => {
      window.removeEventListener('resize', updateSidebarWidth);
    };
  }, []);

  // Handle clicks outside the model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If dropdown is open and the click is outside both the dropdown and its trigger
      if (isModelDropdownOpenClosed && modelDropdownRef.current && modelTriggerRef.current) {
        if (
          !modelDropdownRef.current.contains(event.target as Node) &&
          !modelTriggerRef.current.contains(event.target as Node) &&
          (!modelDropdownOpenRef.current || !modelDropdownOpenRef.current.contains(event.target as Node)) &&
          (!modelTriggerOpenRef.current || !modelTriggerOpenRef.current.contains(event.target as Node))
        ) {
          setIsModelDropdownOpenClosed(false);
        }
      }

      if (isModelDropdownOpenOpen && modelDropdownRef.current && modelTriggerRef.current) {
        if (
          !modelDropdownRef.current.contains(event.target as Node) &&
          !modelTriggerRef.current.contains(event.target as Node) &&
          (!modelDropdownOpenRef.current || !modelDropdownOpenRef.current.contains(event.target as Node)) &&
          (!modelTriggerOpenRef.current || !modelTriggerOpenRef.current.contains(event.target as Node))
        ) {
          setIsModelDropdownOpenOpen(false);
        }
      }

      if (isModelDropdownOpenMobile && modelDropdownMobileRef.current && modelTriggerMobileRef.current) {
        if (
          !modelDropdownMobileRef.current.contains(event.target as Node) &&
          !modelTriggerMobileRef.current.contains(event.target as Node)
        ) {
          setIsModelDropdownOpenMobile(false);
        }
      }

      // Same check for MCP dropdown
      if (isMcpDropdownOpen && mcpDropdownRef.current && mcpTriggerRef.current) {
        if (
          !mcpDropdownRef.current.contains(event.target as Node) &&
          !mcpTriggerRef.current.contains(event.target as Node)
        ) {
          setIsMcpDropdownOpen(false);
        }
      }
    };

    // Add event listener when either dropdown is open
    if (isModelDropdownOpenClosed || isModelDropdownOpenOpen || isModelDropdownOpenMobile || isMcpDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpenClosed, isModelDropdownOpenOpen, isModelDropdownOpenMobile, isMcpDropdownOpen]);

  // Initialize header logo configuration
  useEffect(() => {
    // Load from localStorage first for quick initial render
    const savedLogoType = localStorage.getItem('HEADER_LOGO_TYPE');
    const savedLogoText = localStorage.getItem('HEADER_LOGO_TEXT');
    const savedLogoUrl = localStorage.getItem('HEADER_LOGO_URL');

    if (savedLogoType) setHeaderLogoType(savedLogoType);
    if (savedLogoText) setHeaderLogoText(savedLogoText);
    if (savedLogoUrl) setHeaderLogoUrl(savedLogoUrl);

    // Then fetch latest from server
    async function fetchHeaderConfig() {
      try {
        // Fetch logo type and text
        const typeResponse = await fetch('/api/config/get-env?var=NEXT_PUBLIC_HEADER_LOGO_TYPE');
        if (typeResponse.ok) {
          const typeData = await typeResponse.json();
          if (typeData.value) {
            setHeaderLogoType(typeData.value);
            localStorage.setItem('HEADER_LOGO_TYPE', typeData.value);
          }
        }

        const textResponse = await fetch('/api/config/get-env?var=NEXT_PUBLIC_HEADER_LOGO_TEXT');
        if (textResponse.ok) {
          const textData = await textResponse.json();
          if (textData.value) {
            setHeaderLogoText(textData.value);
            localStorage.setItem('HEADER_LOGO_TEXT', textData.value);
          }
        }

        // Fetch logo URL
        const logoResponse = await fetch('/api/config/get-logo?type=header');
        if (logoResponse.ok) {
          const logoData = await logoResponse.json();
          if (logoData.logoUrl) {
            setHeaderLogoUrl(logoData.logoUrl);
            localStorage.setItem('HEADER_LOGO_URL', logoData.logoUrl);
          }
        }
      } catch (error) {
        console.error('Error fetching header logo config:', error);
      }
    }

    fetchHeaderConfig();
  }, []);

  const handlePermanentDocProcessingStart = (fileName: string) => {
    setIsPermanentDocProcessing(true);
    setPermanentDoc(null);
  };

  const handlePermanentDocProcessingComplete = (processedDoc: ProcessedDocument) => {
    setPermanentDoc(processedDoc);
    setIsPermanentDocProcessing(false);
  };

  const handlePermanentDocProcessingError = (error: Error) => {
    console.error('Permanent document processing error:', error);
    setPermanentDoc(null);
    setIsPermanentDocProcessing(false);
  };

  const handleMcpDropdownOpenChange = (open: boolean) => {
    setIsMcpDropdownOpen(open);
  };

  // New separate handler functions for each ModelSelector dropdown
  const handleModelDropdownClosedChange = (open: boolean) => {
    setIsModelDropdownOpenClosed(open);
  };

  const handleModelDropdownOpenChange = (open: boolean) => {
    setIsModelDropdownOpenOpen(open);
  };

  const handleModelDropdownMobileChange = (open: boolean) => {
    setIsModelDropdownOpenMobile(open);
  };

  const handleGhostModeToggle = () => {
    if (!isGhostMode) {
      // Enabling ghost mode - no confirmation needed
      toggleGhostMode();
    } else if (hasUnsavedGhostMessages) {
      // Disabling with unsaved messages - confirm only in this case
      const confirmDisable = window.confirm(
        'Exit Ghost Mode? Current conversation will be cleared and not saved.'
      );
      if (confirmDisable) {
        toggleGhostMode();
      }
    } else {
      // Disabling without messages - no confirmation needed
      toggleGhostMode();
    }
  };

  return (
    <div className={cn(
      "fixed top-0",
      "header-container",
      isSidebarOpen ? "lg:left-64 left-0 right-0" : "left-0 right-0"
    )}
      style={{ zIndex: 60 }}>
      <style jsx global>{`
        /* Header visibility fixes for mobile */
        .header-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50; /* Higher z-index to ensure it stays above other elements */
          height: 4rem; /* Explicit height */
          transform: translateZ(0); /* Force hardware acceleration */
          -webkit-transform: translateZ(0);
          will-change: transform; /* Hint for browser optimization */
          transition: transform 0.2s ease;
          background-color: transparent; /* Fully transparent background */
          
          /* Enhanced mobile browser compatibility */
          -webkit-user-select: none;
          -moz-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-tap-highlight-color: transparent;
          contain: layout style paint;
        }
        
        /* Set header background colors based on theme */
        :root {
          --header-bg-color: transparent;
        }
        
        /* Make header transparent in both light and dark mode */
        .header-container {
          background-color: transparent !important;
        }
        
        /* Ensure header remains visible when keyboard is open */
        .header-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 100%;
          z-index: -1;
          backdrop-filter: none;
        }
        
        /* Prevent header from disappearing when keyboard shows */
        @media (max-height: 450px) {
          .header-container {
            position: absolute;
          }
        }
        
        /* Fix for iOS Safari and Chrome */
        @supports (-webkit-touch-callout: none) {
          .header-container {
            position: sticky;
            top: 0;
            z-index: 50;
          }
        }
      `}</style>

      <div className="relative flex items-center justify-between h-16 px-3 sm:px-6 bg-transparent pointer-events-auto">
        {/* Desktop Layout (1024px and up) */}
        <div className="hidden lg:flex items-center justify-between w-full">
          {/* Left section with conditional layout based on sidebar state */}
          <div className="flex items-center gap-2 pointer-events-auto z-20">
            {/* Show sidebar toggle only when sidebar is closed */}
            {!isSidebarOpen && (
              <PortalTooltip content={t('openSidebar')} align="right">
                <button
                  onClick={onToggleSidebar}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 rounded-lg transition-colors group relative backdrop-blur-md",
                    "bg-[#FFE0D0]/30 hover:bg-[#FFE0D0] dark:bg-[#2F2F2F]/30 dark:hover:bg-[#424242]"
                  )}
                >
                  <PanelLeft className="h-5 w-5" />
                  <span className="sr-only">{t('openSidebar')}</span>
                </button>
              </PortalTooltip>
            )}

            {/* New chat button - only show when sidebar is closed and user is authenticated */}
            {!isSidebarOpen && onNewChat && (!isAuthEnabled || user) && (
              <PortalTooltip content={t('newChat')}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewChat();
                  }}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 rounded-lg transition-colors group relative backdrop-blur-md",
                    "bg-[#FFE0D0]/30 hover:bg-[#FFE0D0] dark:bg-[#2F2F2F]/30 dark:hover:bg-[#424242]"
                  )}
                >
                  <SquarePen className="h-5 w-5" />
                  <span className="sr-only">{t('newChat')}</span>
                </button>
              </PortalTooltip>
            )}

            {/* Model selector - show when sidebar is closed */}
            {!isSidebarOpen && (
              <div className="flex items-center ml-2">
                <DropdownMenu open={isModelDropdownOpenClosed} onOpenChange={handleModelDropdownClosedChange}>
                  <PortalTooltip content={t('modelSelector')}>
                    <DropdownMenuTrigger asChild>
                      <button
                        ref={modelTriggerRef}
                        className={cn(
                          "inline-flex items-center h-9 px-3 border border-[#FFE0D0]/50 dark:border-[#2F2F2F]/50 rounded-md transition-colors backdrop-blur-md",
                          isModelDropdownOpenClosed
                            ? "bg-[#FFE8DC] dark:bg-[#2E2E2E]"
                            : "hover:bg-[#FFE0D0] dark:hover:bg-[#424242] bg-transparent"
                        )}
                      >
                        <span className="font-medium text-sm truncate max-w-[140px] md:max-w-none text-gray-700 dark:text-gray-200">
                          {headerLogoText}
                        </span>
                        <ChevronDown className="h-3 w-3 ml-2 opacity-60 flex-shrink-0 text-gray-700 dark:text-gray-200" />
                      </button>
                    </DropdownMenuTrigger>
                  </PortalTooltip>
                  <DropdownMenuContent
                    ref={modelDropdownRef}
                    align="start"
                    side="bottom"
                    sideOffset={4}
                    className="w-72 rounded-xl"
                    style={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
                      padding: 0,
                      overflow: 'hidden',
                      borderRadius: '12px',
                      zIndex: 9999
                    }}
                    forceMount
                  >
                    <ModelSelector />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* When sidebar is open, show model selector in the right place */}
          {isSidebarOpen && (
            <div
              className="fixed left-0 top-0 h-16 flex items-center pointer-events-none z-20"
              style={{
                marginLeft: `${sidebarWidth}px`, // Position exactly at the edge of sidebar
                paddingLeft: '0.75rem' // Match ChatGPT spacing
              }}
            >
              <div className="pointer-events-auto">
                <DropdownMenu open={isModelDropdownOpenOpen} onOpenChange={handleModelDropdownOpenChange}>
                  <PortalTooltip content={t('modelSelector')}>
                    <DropdownMenuTrigger asChild>
                      <button
                        ref={modelTriggerOpenRef}
                        className={cn(
                          "inline-flex items-center h-9 px-3 border border-[#FFE0D0]/50 dark:border-[#2F2F2F]/50 rounded-md transition-colors backdrop-blur-md",
                          isModelDropdownOpenOpen
                            ? "bg-[#FFE8DC] dark:bg-[#2E2E2E]"
                            : "hover:bg-[#FFE0D0] dark:hover:bg-[#424242] bg-transparent"
                        )}
                        style={{
                          // Ensure consistent appearance across browsers
                          WebkitAppearance: 'none',
                          MozAppearance: 'none'
                        }}
                      >
                        <span className="font-medium text-sm truncate max-w-[140px] md:max-w-none text-gray-700 dark:text-gray-200">
                          {headerLogoText}
                        </span>
                        <ChevronDown className="h-3 w-3 ml-2 opacity-60 flex-shrink-0 text-gray-700 dark:text-gray-200" />
                      </button>
                    </DropdownMenuTrigger>
                  </PortalTooltip>
                  <DropdownMenuContent
                    ref={modelDropdownOpenRef}
                    align="start"
                    side="bottom"
                    sideOffset={4}
                    className="w-72 rounded-xl"
                    style={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
                      padding: 0,
                      overflow: 'hidden',
                      borderRadius: '12px'
                    }}
                    forceMount
                  >
                    <ModelSelector />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          {/* Right section */}
          <div className="flex items-center pointer-events-auto min-w-[80px] z-20">
            <div className={cn(
              "flex items-center border border-[#FFE0D0] dark:border-[#2F2F2F] rounded-lg mr-2 sm:mr-4 backdrop-blur-md"
            )} style={{ background: 'transparent' }}>
              {!isAuthPage && hasActiveChat ? (
                <TextSizeSlider />
              ) : (
                <ThemeToggle />
              )}

              {!isAuthPage && hasActiveChat && (
                <ThemeToggle />
              )}

              {!isAuthPage && (!isAuthEnabled || user) && (
                <>
                  <ShareChatButton />
                  <PermanentDocUploadButton
                    disabled={isPermanentDocProcessing}
                    isActive={Boolean(permanentDoc)}
                    onProcessingStart={handlePermanentDocProcessingStart}
                    onProcessingComplete={handlePermanentDocProcessingComplete}
                    onProcessingError={handlePermanentDocProcessingError}
                    className={cn(
                      "flex items-center justify-center w-9 h-9 text-gray-700 dark:text-gray-200 bg-transparent hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242] transition-colors group relative backdrop-blur-md"
                    )}
                  />
                  <PortalTooltip content={t('useIncognitoChat')}>
                    <button
                      onMouseDown={(e) => {
                        // Prevent the button from stealing focus from the input
                        e.preventDefault();
                      }}
                      onClick={handleGhostModeToggle}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg text-gray-700 dark:text-gray-200 transition-colors group relative backdrop-blur-md",
                        isGhostMode
                          ? "bg-purple-500/20 hover:bg-purple-500/30 dark:bg-purple-600/20 dark:hover:bg-purple-600/30 text-purple-600 dark:text-purple-400"
                          : "bg-transparent hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242]"
                      )}
                    >
                      <Ghost className="h-5 w-5" />
                      <span className="sr-only">Toggle Ghost Mode</span>
                    </button>
                  </PortalTooltip>
                </>
              )}
            </div>
            {/* WhatsApp Connection Button */}
            {!isAuthPage && user && (
              <div className="mr-2 flex items-center">
                <WhatsAppConnectionButton />
              </div>
            )}
            {!isAuthPage && (
              <div className="mt-1">
                <UserMenu email={user?.email} onSignOut={user ? signOut : undefined} />
              </div>
            )}
          </div>
        </div>

        {/* Mobile + Tablet Layout (smaller than 1024px) */}
        <div className="flex lg:hidden items-center justify-between w-full gap-3">
          {/* Left section - Hamburger menu */}
          <div className="flex items-center pointer-events-auto z-20">
            <button
              onClick={onToggleSidebar}
              className={cn(
                "flex items-center justify-center w-10 h-10 text-gray-700 dark:text-gray-200 rounded-lg transition-colors group relative backdrop-blur-md",
                "bg-[#FFE0D0]/30 hover:bg-[#FFE0D0] dark:bg-[#2F2F2F]/30 dark:hover:bg-[#424242]"
              )}
            >
              <PanelLeft className="h-5 w-5" />
              <span className="sr-only">{t('openSidebar')}</span>
            </button>
          </div>

          {/* Center section - Model selector */}
          <div className="flex items-center justify-center flex-1 px-2 pointer-events-auto z-20">
            <DropdownMenu open={isModelDropdownOpenMobile} onOpenChange={handleModelDropdownMobileChange}>
              <PortalTooltip content={t('modelSelector')}>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={modelTriggerMobileRef}
                    className={cn(
                      "inline-flex items-center h-9 px-3 border border-[#FFE0D0]/50 dark:border-[#2F2F2F]/50 rounded-md transition-colors backdrop-blur-md",
                      isModelDropdownOpenMobile
                        ? "bg-[#FFE8DC] dark:bg-[#2E2E2E]"
                        : "hover:bg-[#FFE0D0] dark:hover:bg-[#424242] bg-transparent"
                    )}
                  >
                    <span className="font-medium text-sm truncate max-w-[140px] text-gray-700 dark:text-gray-200">
                      {headerLogoText}
                    </span>
                    <ChevronDown className="h-3 w-3 ml-2 opacity-60 flex-shrink-0 text-gray-700 dark:text-gray-200" />
                  </button>
                </DropdownMenuTrigger>
              </PortalTooltip>
              <DropdownMenuContent
                ref={modelDropdownMobileRef}
                align="center"
                side="bottom"
                sideOffset={4}
                className="w-72 rounded-xl"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: '12px'
                }}
                forceMount
              >
                <ModelSelector />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right section - Mobile toolbar and user menu */}
          <div className="flex items-center gap-3 pointer-events-auto z-20">
            {/* Mobile Toolbar - contains theme, text size, share, documents */}
            {!isAuthPage && (!isAuthEnabled || user) && (
              <MobileToolbarFixed />
            )}

            {/* User Menu */}
            {!isAuthPage && (
              <UserMenu email={user?.email} onSignOut={user ? signOut : undefined} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
