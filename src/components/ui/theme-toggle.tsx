'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { PortalTooltip } from './portal-tooltip';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();

  return (
    <PortalTooltip content={t('themeToggle')}>
      <button
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        className="flex items-center justify-center w-10 h-10 bg-transparent hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242] transition-colors rounded-lg"
      >
        {theme === 'light' ? (
          <Moon className="h-[18px] w-[18px] text-gray-800 dark:text-gray-200" />
        ) : (
          <Sun className="h-[18px] w-[18px] text-gray-800 dark:text-gray-200" />
        )}
        <span className="sr-only">Toggle theme</span>
      </button>
    </PortalTooltip>
  );
}