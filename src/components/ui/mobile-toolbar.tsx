'use client';

import React, { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { TextSizeSlider } from './text-size-slider';
import { ShareChatButton } from './share-chat-button';
import { DocumentDashboard } from './document-dashboard';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useChatStore } from '@/lib/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '@/components/providers/language-provider';
import type { ProcessedDocument } from './document-dashboard';

interface MobileToolbarProps {
  className?: string;
}

export function MobileToolbar({ className }: MobileToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPermanentDocProcessing, setIsPermanentDocProcessing] = useState(false);
  const [permanentDoc, setPermanentDoc] = useState<ProcessedDocument | null>(null);
  const { theme } = useTheme();
  const { currentChatId, chats } = useChatStore(
    useShallow((s) => ({ currentChatId: s.currentChatId, chats: s.chats }))
  );
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark';
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  
  // Define colors to match other dropdown menus
  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
  const itemBgColor = isDarkMode ? '#424242' : '#E5D6C9';
  const textColor = isDarkMode ? '#E6E6E6' : '#444';
  
  // Show TextSizeSlider whenever there's a current chat (saved or ghost)
  const hasActiveChat = Boolean(currentChatId);

  // Handle clicks outside the menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && 
          menuRef.current && 
          !menuRef.current.contains(event.target as Node) &&
          triggerRef.current && 
          !triggerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // Add slight delay to avoid immediate closing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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

  return (
    <div className={cn("relative", className)}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg transition-colors group relative",
          "bg-[#FFE0D0]/30 hover:bg-[#FFE0D0] dark:bg-[#2F2F2F]/30 dark:hover:bg-[#424242]",
          "text-gray-700 dark:text-gray-200 backdrop-blur-md",
          isOpen && "bg-[#FFE0D0] dark:bg-[#424242]"
        )}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <MoreHorizontal className="h-5 w-5" />
        )}
        <span className="sr-only">{isOpen ? 'Close toolbar' : 'Open toolbar'}</span>
      </button>

      {/* Mobile Menu - Opens Downward */}
      {isOpen && (
        <div
          ref={menuRef}
          className={cn(
            "absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)]",
            "rounded-xl shadow-lg backdrop-blur-md z-[999999]",
            "animate-in slide-in-from-top-2 duration-200"
          )}
          style={{
            backgroundColor: dropdownBgColor,
            border: `1px solid ${isDarkMode ? '#3A3A3A' : '#D0C5B9'}`,
            animationFillMode: 'forwards'
          }}
        >
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium" style={{ color: textColor }}>
                Tools
              </h3>
            </div>

            {/* Grid of Action Items */}
            <div className="grid grid-cols-2 gap-3">
              {/* Theme Toggle */}
              <div 
                className="flex flex-col items-center p-3 rounded-lg border"
                style={{ 
                  backgroundColor: itemBgColor,
                  borderColor: isDarkMode ? '#3A3A3A' : '#D0C5B9'
                }}
              >
                <ThemeToggle />
                <span className="text-xs mt-2" style={{ color: textColor }}>
                  {t('themeLabel')}
                </span>
              </div>

              {/* Text Size - Only show when there's an active chat */}
              {hasActiveChat && (
                <div 
                  className="flex flex-col items-center p-3 rounded-lg border"
                  style={{ 
                    backgroundColor: itemBgColor,
                    borderColor: isDarkMode ? '#3A3A3A' : '#D0C5B9'
                  }}
                >
                  <div className="flex items-center justify-center h-10 w-10">
                    <TextSizeSlider />
                  </div>
                  <span className="text-xs mt-2" style={{ color: textColor }}>
                    {t('textSizeLabel')}
                  </span>
                </div>
              )}

              {/* Share Chat - Only show when there's an active chat */}
              {currentChatId && (
                <div 
                  className="flex flex-col items-center p-3 rounded-lg border"
                  style={{ 
                    backgroundColor: itemBgColor,
                    borderColor: isDarkMode ? '#3A3A3A' : '#D0C5B9'
                  }}
                >
                  <ShareChatButton className="!w-10 !h-10" />
                  <span className="text-xs mt-2" style={{ color: textColor }}>
                    {t('shareLabel')}
                  </span>
                </div>
              )}

              {/* Document Dashboard */}
              <div 
                className="flex flex-col items-center p-3 rounded-lg border"
                style={{ 
                  backgroundColor: itemBgColor,
                  borderColor: isDarkMode ? '#3A3A3A' : '#D0C5B9'
                }}
              >
                <DocumentDashboard
                  disabled={isPermanentDocProcessing}
                  isActive={Boolean(permanentDoc)}
                  onProcessingStart={handlePermanentDocProcessingStart}
                  onProcessingComplete={handlePermanentDocProcessingComplete}
                  onProcessingError={handlePermanentDocProcessingError}
                  className="!w-10 !h-10 !rounded-lg !inline-flex !items-center !justify-center"
                />
                <span className="text-xs mt-2" style={{ color: textColor }}>
                  Documents
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes slide-in-from-top-2 {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-in {
          animation-duration: 200ms;
          animation-fill-mode: both;
        }
        
        .slide-in-from-top-2 {
          animation-name: slide-in-from-top-2;
        }
      `}</style>
    </div>
  );
} 