'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LogOut, Settings, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/theme-provider';
import { useState, useRef, useEffect } from 'react';
import { SettingsModal } from './settings/SettingsModal';
import { useLanguage } from '@/components/providers/language-provider';

interface UserMenuProps {
  email?: string;
  onSignOut?: () => Promise<void>;
}

export function UserMenu({ email, onSignOut }: UserMenuProps) {
  const router = useRouter();
  const { theme, resolvedTheme } = useTheme();
  const isDarkMode = theme === 'dark' || resolvedTheme === 'dark';
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { t } = useLanguage();

  // Define colors to match other dropdown menus
  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
  const hoverColor = isDarkMode ? '#424242' : '#E5D6C9';
  const textColor = isDarkMode ? '#E6E6E6' : '#444';

  // Get first two letters of email if available
  const initials = email
    ? email.split('@')[0].slice(0, 2).toUpperCase()
    : null;

  // Handle clicks outside the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If dropdown is open and the click is outside both the dropdown and its trigger
      if (isDropdownOpen && dropdownRef.current && triggerRef.current) {
        if (
          !dropdownRef.current.contains(event.target as Node) &&
          !triggerRef.current.contains(event.target as Node)
        ) {
          setIsDropdownOpen(false);
        }
      }
    };

    // Add event listener when dropdown is open
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleSignOut = async () => {
    if (onSignOut) {
      try {
        setIsDropdownOpen(false); // Close dropdown when signing out
        await onSignOut();
        router.push('/auth');
      } catch (error) {
        console.error('Error signing out:', error);
      }
    }
  };

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
    setIsDropdownOpen(false); // Close dropdown when opening settings
  };

  const handleSettingsOpenChange = (open: boolean) => {
    // Only allow the settings to close when explicitly requested
    // This prevents accidental closing during dropdown interactions
    if (!open) {
      // Add a small delay to ensure any ongoing interactions are complete
      setTimeout(() => {
        setIsSettingsOpen(open);
      }, 50);
    } else {
      setIsSettingsOpen(open);
    }
  };

  const handleDropdownOpenChange = (open: boolean) => {
    // If settings are open, don't allow dropdown to open
    if (isSettingsOpen && open) return;

    setIsDropdownOpen(open);
  };

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            className="dropdown-trigger inline-flex items-center justify-center w-10 h-10 rounded-full bg-transparent dark:bg-transparent border border-[#FFE0D0] dark:border-[#2F2F2F] hover:bg-[#FFE0D0] dark:hover:bg-[#424242] transition-colors backdrop-blur-md"
          >
            {initials ? (
              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-none">{initials}</span>
            ) : (
              <User className="h-5 w-5 text-gray-800 dark:text-gray-200" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={dropdownRef}
          align="end"
          className="w-48 rounded-lg z-[10001]"
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
          <div style={{
            padding: '8px',
            backgroundColor: dropdownBgColor,
            borderRadius: '12px'
          }}>
            <div
              onMouseEnter={() => setHoveredItem('settings')}
              onMouseLeave={() => setHoveredItem(null)}
              onClick={handleOpenSettings}
              className="flex items-center gap-2 cursor-pointer text-sm w-full"
              style={{
                backgroundColor: hoveredItem === 'settings' ? hoverColor : 'transparent',
                padding: '16px 16px',
                margin: '2px 0',
                borderRadius: '8px',
                color: textColor,
                minHeight: '44px'
              }}
            >
              <Settings className="h-4 w-4" />
              <span>{t('settings')}</span>
            </div>

            {email && onSignOut && (
              <div
                onMouseEnter={() => setHoveredItem('logout')}
                onMouseLeave={() => setHoveredItem(null)}
                onClick={handleSignOut}
                className="flex items-center gap-2 cursor-pointer text-sm w-full"
                style={{
                  backgroundColor: hoveredItem === 'logout' ? hoverColor : 'transparent',
                  padding: '16px 16px',
                  margin: '2px 0',
                  borderRadius: '8px',
                  color: textColor,
                  minHeight: '44px'
                }}
              >
                <LogOut className="h-4 w-4" />
                <span>{t('logout')}</span>
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Always render the SettingsModal but control visibility with the isOpen prop */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onOpenChange={handleSettingsOpenChange}
      />
    </>
  );
}
