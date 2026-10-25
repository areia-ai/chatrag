import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { CollapsibleButton } from './collapsible-button';

interface WebSearchButtonProps {
  disabled?: boolean;
  onWebSearchToggle: (useSearch: boolean) => void;
  isActive?: boolean;
}

export function WebSearchButton({
  disabled = false,
  onWebSearchToggle,
  isActive = false,
}: WebSearchButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [wasRecentlyActive, setWasRecentlyActive] = useState(isActive);
  const { t } = useLanguage();

  const handleButtonClick = () => {
    const willBeEnabled = !isActive;
    console.log('[WebSearchButton] Toggle clicked:', { from: isActive, to: willBeEnabled });
    onWebSearchToggle(willBeEnabled);

    if (willBeEnabled) {
      setWasRecentlyActive(true);
    } else if (!isHovered) {
      setWasRecentlyActive(false);
    }
    
    // Additional logging to verify state propagation
    console.log('[WebSearchButton] State after toggle:', { 
      isActive: willBeEnabled,
      buttonWillShow: willBeEnabled ? 'active (orange)' : 'inactive (collapsed)'
    });
  };

  // Mouse enter/leave handlers
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (isActive && !wasRecentlyActive) {
      setWasRecentlyActive(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // If we were recently active but now inactive, and mouse leaves,
    // reset wasRecentlyActive so the button can fully collapse
    if (wasRecentlyActive && !isActive) {
      setWasRecentlyActive(false);
    }
  };

  // Determine if we should show the expanded button
  const showExpandedWithActive = isActive;
  // Determine if we should show the expanded button for hover after deactivation
  const showManualExpanded = !isActive && isHovered && wasRecentlyActive;

  return (
    <div
      className="relative ml-0.25 mt-1.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showExpandedWithActive ? (
        // Custom active button - only used when active
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-9 items-center justify-center rounded-xl transition-colors border-[0.5px] overflow-hidden mr-0.25",
            "bg-[#FF6417] border-[#FF6417] dark:bg-[#212121] dark:border-[#212121] hover:bg-[#E55000] dark:hover:bg-[#1A1A1A]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-center px-3 gap-1">
            <Globe className="h-5 w-5 text-[#E6E6E6]" />
            
            <span className="text-sm font-medium whitespace-nowrap text-[#E6E6E6]">
              {t('webSearch')}
            </span>
          </div>
        </button>
      ) : showManualExpanded ? (
        // Manually expanded inactive button - for hover after deactivation
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-9 items-center justify-center rounded-xl transition-colors border-[0.5px] overflow-hidden mr-0.25",
            "bg-transparent border-[#D4C0B6] dark:border-gray-600 hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-center px-3 gap-1">
            <Globe className="h-5 w-5 text-red-600 dark:text-red-400" />
            
            <span className="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-[#9E9E9E]">
              {t('webSearch')}
            </span>
          </div>
        </button>
      ) : (
        // Use CollapsibleButton for all other states
        <CollapsibleButton
          icon={<Globe className="h-5 w-5 text-red-600 dark:text-red-400" />}
          text={t('webSearch')}
          tooltipText={t('searchWeb')}
          onClick={handleButtonClick}
          isActive={false}
          disabled={disabled}
        />
      )}
    </div>
  );
} 
