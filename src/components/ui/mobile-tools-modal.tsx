'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Globe, Palette, Video, Box, Hammer, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileTools } from '@/contexts/mobile-tools-context';
import { useLanguage } from '@/components/providers/language-provider';
import { useTheme } from '@/components/theme-provider';

// Tool definitions with their display information
interface ToolItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  requiresConfig?: boolean;
  enabled?: boolean;
}

interface MobileToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToolSelect: (toolId: string) => void;
  // Props for checking which tools are enabled
  isWebSearchEnabled?: boolean;
  isImageGenerationEnabled?: boolean;
  isVideoGenerationEnabled?: boolean;
  is3DGenerationEnabled?: boolean;
  isMCPToolsEnabled?: boolean;
  isSubMenuOpen?: boolean;
}

export function MobileToolsModal({
  isOpen,
  onClose,
  onToolSelect,
  isWebSearchEnabled = true,
  isImageGenerationEnabled = true,
  isVideoGenerationEnabled = true,
  is3DGenerationEnabled = true,
  isMCPToolsEnabled = true,
  isSubMenuOpen = false,
}: MobileToolsModalProps) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  // State for closing animation
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Refs
  const modalRef = useRef<HTMLDivElement>(null);
  const isSubMenuOpenRef = useRef(isSubMenuOpen);

  // Update ref when prop changes
  useEffect(() => {
    isSubMenuOpenRef.current = isSubMenuOpen;
  }, [isSubMenuOpen]);

  // Handle visibility based on isOpen prop
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setIsClosing(false);
    } else {
      // If isOpen becomes false externally, just hide immediately
      setIsVisible(false);
      setIsClosing(false);
    }
  }, [isOpen]);

  // Handle closing with animation
  const closeModal = () => {
    if (isClosing) return;

    setIsClosing(true);
    // Wait for animation to finish
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300); // 300ms matches animation duration
  };

  // Match the model selector dropdown colors exactly
  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
  const hoverColor = isDarkMode ? '#424242' : '#E5D6C9';
  const textColor = isDarkMode ? '#E6E6E6' : '#444';
  const borderColor = isDarkMode ? '#3F3F3F' : '#E5D1C3';

  // Refs and state for swipe-to-close
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const velocityRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const lastMoveYRef = useRef(0);

  // Click outside handler for mobile
  useEffect(() => {
    if (!isOpen || !isVisible) return;

    const onOutsidePress = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;

      // If the press is inside the modal, ignore it
      if (modalRef.current?.contains(target)) return;

      // If a sub-menu is open, do not close the primary modal
      if (isSubMenuOpen) return;

      // If clicking the backdrop directly
      const isBackdrop = (target as Element).classList?.contains('tools-backdrop');

      // Introduce a small delay to allow for state updates (fixing race condition)
      setTimeout(() => {
        // Build a fresh check using the ref
        if (isSubMenuOpenRef.current) return;

        if (isBackdrop) {
          closeModal();
        } else {
          // Additional check: valid targets usually have data-in-modal attribute
          if ((target as Element).closest('[data-in-modal="true"]')) return;

          // For other outside clicks that might bubble up
          closeModal();
        }
      }, 50);
    };

    // Capture phase listeners for robust mobile handling
    document.addEventListener('pointerdown', onOutsidePress, true);
    document.addEventListener('touchstart', onOutsidePress, true);
    document.addEventListener('mousedown', onOutsidePress, true);

    return () => {
      document.removeEventListener('pointerdown', onOutsidePress, true);
      document.removeEventListener('touchstart', onOutsidePress, true);
      document.removeEventListener('mousedown', onOutsidePress, true);
    };
  }, [isOpen, isVisible]);

  // Define available tools based on environment variables and props
  const tools: ToolItem[] = [
    {
      id: 'web-search',
      name: t('searchWeb') || 'Search the web',
      description: 'Search the internet for current information',
      icon: <Globe className="h-5 w-5" />,
      iconColor: 'text-blue-500 dark:text-blue-400',
      enabled: isWebSearchEnabled,
    },
    {
      id: 'image-generation',
      name: t('imageGenerate') || 'Generate images',
      description: 'Generate images with AI',
      icon: <Palette className="h-5 w-5" />,
      iconColor: 'text-amber-500 dark:text-amber-400',
      requiresConfig: true,
      enabled: isImageGenerationEnabled,
    },
    {
      id: 'video-generation',
      name: t('videoGenerate') || 'Generate video',
      description: 'Generate videos with AI',
      icon: <Video className="h-5 w-5" />,
      iconColor: 'text-orange-500 dark:text-orange-400',
      requiresConfig: true,
      enabled: isVideoGenerationEnabled,
    },
    {
      id: '3d-generation',
      name: t('threeDModel') || '3D Model',
      description: 'Create 3D models from images',
      icon: <Box className="h-5 w-5" />,
      iconColor: 'text-rose-500 dark:text-rose-400',
      requiresConfig: true,
      enabled: is3DGenerationEnabled,
    },
    {
      id: 'mcp-tools',
      name: t('mcpToolsButton') || 'MCP Tools',
      description: 'Access specialized tools and integrations',
      icon: <Hammer className="h-5 w-5" />,
      iconColor: 'text-purple-500 dark:text-purple-400',
      enabled: isMCPToolsEnabled,
    },
  ].filter(tool => tool.enabled);

  const handleToolClick = (toolId: string) => {
    // Tools that require configuration should open secondary modal
    const toolsRequiringConfig = ['image-generation', 'video-generation'];

    if (toolsRequiringConfig.includes(toolId)) {
      // For tools requiring config, just call onToolSelect which will handle opening config modal
      onToolSelect(toolId);
    } else {
      // For simple tools and 3D generation, directly handle them
      onToolSelect(toolId);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  };

  // Swipe-to-close handlers
  const handleDragStart = (event: React.TouchEvent) => {
    const clientY = event.touches[0].clientY;
    const now = Date.now();

    setDragStartY(clientY);
    setDragDeltaY(0);
    setIsDragging(true);

    // Initialize velocity tracking
    lastMoveTimeRef.current = now;
    lastMoveYRef.current = clientY;
    velocityRef.current = 0;
  };

  const handleDragMove = (event: React.TouchEvent) => {
    if (!isDragging) return;

    const clientY = event.touches[0].clientY;
    const now = Date.now();
    const delta = clientY - dragStartY;

    // Calculate velocity (pixels per millisecond)
    const timeDelta = now - lastMoveTimeRef.current;
    if (timeDelta > 0) {
      const moveDelta = clientY - lastMoveYRef.current;
      const instantVelocity = moveDelta / timeDelta;
      // Smooth velocity using exponential moving average
      velocityRef.current = velocityRef.current * 0.7 + instantVelocity * 0.3;
    }

    // Update tracking refs
    lastMoveTimeRef.current = now;
    lastMoveYRef.current = clientY;

    // Only allow dragging down (positive delta), clamp negative values to 0
    setDragDeltaY(Math.max(0, delta));
  };

  const handleDragEnd = () => {
    if (!isDragging) return;

    const CLOSE_THRESHOLD = 80; // pixels needed to close
    const VELOCITY_THRESHOLD = 0.5; // pixels per ms (fast flick)

    const velocity = velocityRef.current;

    // Close if: swiped far enough OR fast flick downward
    const shouldClose = dragDeltaY > CLOSE_THRESHOLD ||
      (dragDeltaY > 30 && velocity > VELOCITY_THRESHOLD);

    // Always stop dragging
    setIsDragging(false);
    velocityRef.current = 0;

    if (shouldClose) {
      closeModal();
    } else {
      // Snap back
      setDragStartY(0);
      setDragDeltaY(0);
    }
  };

  if (!isOpen && !isClosing) return null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-black/30 backdrop-blur-sm z-[100] tools-backdrop",
          isClosing ? "tools-backdrop-closing" : "tools-backdrop-open"
        )}
        onClick={handleBackdropClick}
        // These handlers are backups to the document listeners
        onPointerDown={handleBackdropClick}
      >
        <div
          ref={modalRef}
          className={cn(
            "absolute left-0 right-0 bottom-0 overflow-hidden tools-modal",
            isClosing ? "tools-modal-closing" : "tools-modal-open",
            isDragging && "dragging"
          )}
          data-in-modal="true"
          style={{
            maxHeight: 'calc(85vh - 32px)',
            backgroundColor: dropdownBgColor,
            borderRadius: '16px 16px 0 0',
            border: `1px solid ${borderColor}`,
            borderBottom: 'none',
            boxShadow: isDarkMode
              ? '0 -10px 25px -5px rgba(0, 0, 0, 0.3)'
              : '0 -10px 40px -5px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.03)',
            paddingBottom: 'max(34px, calc(16px + env(safe-area-inset-bottom, 34px)))',
            transform: dragDeltaY > 0 ? `translateY(${dragDeltaY}px)` : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
        >
          {/* Handle strip - visual indicator for swipe */}
          <div className="tools-dropdown-handle" aria-hidden="true" />

          {/* Styled close button - matches suggestion menu */}
          <button
            className="tools-dropdown-close"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeModal();
            }}
            aria-label="Close tools"
            type="button"
          >
            ×
          </button>

          {/* Header with centered title */}
          <div className="tools-dropdown-header">
            <div className="tools-dropdown-title" style={{ color: textColor }}>
              {t('tools') || 'Tools'}
            </div>
          </div>

          {/* Tools List */}
          <div className="py-1 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 140px)' }}>
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => handleToolClick(tool.id)}
                className={cn(
                  "w-full text-left text-sm transition-colors flex items-center gap-3",
                  "hover:bg-transparent"
                )}
                style={{
                  backgroundColor: dropdownBgColor,
                  color: textColor,
                  padding: '12px 16px',
                  border: 'none',
                  margin: '2px 0',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hoverColor}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = dropdownBgColor}
              >
                {/* Tool Icon */}
                <div className={cn("flex-shrink-0", tool.iconColor)}>
                  {tool.icon}
                </div>

                {/* Tool Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium" style={{ color: textColor }}>
                    {tool.name}
                  </div>
                  <div
                    className="text-xs truncate mt-0.5"
                    style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280' }}
                  >
                    {tool.description}
                  </div>
                </div>

                {/* Arrow indicator for tools requiring config */}
                {tool.requiresConfig && (
                  <ChevronRight
                    className="h-4 w-4 flex-shrink-0 opacity-50"
                    style={{ color: textColor }}
                  />
                )}
              </button>
            ))}

            {/* Empty state if no tools */}
            {tools.length === 0 && (
              <div className="text-center py-8 px-4">
                <div style={{ color: isDarkMode ? '#6B7280' : '#9CA3AF' }} className="mb-2">
                  <Hammer className="h-8 w-8 mx-auto opacity-50" />
                </div>
                <p
                  className="text-sm font-medium"
                  style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280' }}
                >
                  {t('noToolsAvailable') || 'No tools available'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Styles matching suggestion menu */}
      <style jsx global>{`
        .tools-dropdown-handle {
          width: 36px;
          height: 5px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
          margin: 10px auto 0 auto;
        }

        .dark .tools-dropdown-handle,
        [data-theme="dark"] .tools-dropdown-handle {
          background: rgba(255, 255, 255, 0.20);
        }

        .tools-dropdown-header {
          position: relative;
          padding: 8px 14px 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .tools-dropdown-title {
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2px;
          color: rgba(0, 0, 0, 0.70);
          padding: 0 52px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dark .tools-dropdown-title,
        [data-theme="dark"] .tools-dropdown-title {
          color: rgba(255, 255, 255, 0.72);
        }

        .tools-dropdown-close {
          position: absolute !important;
          top: 8px !important;
          right: 12px !important;
          left: auto !important;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: rgba(212, 192, 182, 0.3);
          border: 1px solid rgba(212, 192, 182, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
          text-align: center;
          padding-bottom: 2px;
          color: rgba(0, 0, 0, 0.50);
          cursor: pointer;
          z-index: 10;
          transition: background-color 0.15s ease;
        }

        .tools-dropdown-close:hover {
          background: rgba(212, 192, 182, 0.5);
        }

        .dark .tools-dropdown-close,
        [data-theme="dark"] .tools-dropdown-close {
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.60);
        }

        .dark .tools-dropdown-close:hover,
        [data-theme="dark"] .tools-dropdown-close:hover {
          background: rgba(255, 255, 255, 0.20);
        }

        /* Disable transition during drag for immediate feedback */
        .dragging {
          transition: none !important;
        }

        /* Animation Classes */
        .tools-backdrop-open {
          animation: toolsFadeIn 0.3s ease-out forwards;
        }

        .tools-backdrop-closing {
          animation: toolsFadeOut 0.3s ease-in forwards;
        }

        .tools-modal {
          transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }

        .tools-modal-open {
          animation: toolsSlideUp 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }

        .tools-modal-closing {
          animation: toolsSlideDown 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }

        @keyframes toolsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes toolsFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes toolsSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        @keyframes toolsSlideDown {
          from { transform: translateY(0); }
          to { transform: translateY(100%); }
        }
      `}</style>
    </>
  );
}
