'use client';

import React from 'react';
import { Settings2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileTools } from '@/contexts/mobile-tools-context';
import { useLanguage } from '@/components/providers/language-provider';

interface MobileToolsButtonProps {
  disabled?: boolean;
  className?: string;
}

export function MobileToolsButton({
  disabled = false,
  className
}: MobileToolsButtonProps) {
  const { openPrimaryModal } = useMobileTools();
  const { t } = useLanguage();

  const handleClick = () => {
    if (!disabled) {
      openPrimaryModal();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors border-[0.5px] overflow-hidden group relative",
        "bg-transparent border-[#D4C0B6] dark:border-gray-600 hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      aria-label={t('mcpToolsButton')}
    >
      <Wrench className="h-5 w-5 text-gray-700 dark:text-gray-300" />

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+4px)] px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md opacity-0 group-hover:opacity-100 transition-opacity delay-150 duration-200 whitespace-nowrap z-[9980]">
        {t('otherTools')}
      </div>
    </button>
  );
} 