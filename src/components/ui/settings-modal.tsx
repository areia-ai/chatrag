'use client';

import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Settings, Upload, X, Globe, Bell, VolumeX, Volume2, Volume1, Volume, Shield, ShieldAlert, Lock, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { useLanguage } from '@/components/providers/language-provider';
import { Language, languageNames } from '@/translations';
import { playNotificationSound } from '@/lib/audio-utils';
import { useAdminStore } from '@/lib/admin-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  emitSelectPortalEvent,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SettingsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ isOpen, onOpenChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  const {
    backgroundImage,
    uploadBackground,
    notificationSoundEnabled,
    setNotificationSoundEnabled,
    notificationSoundType,
    setNotificationSoundType,
    setBackgroundImage,
  } = useUserSettingsStore();

  // Admin state
  const {
    isAdmin,
    isCheckingAdmin,
    checkAdminStatus,
    logoutAdmin
  } = useAdminStore();
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [adminLoginSuccess, setAdminLoginSuccess] = useState(false);

  // Other existing state variables ...
  const [isUploading, setIsUploading] = useState(false);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const [isSelectingOption, setIsSelectingOption] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isInteractingWithSelect, setIsInteractingWithSelect] = useState(false);
  const [soundOptionsVisible, setSoundOptionsVisible] = useState(notificationSoundEnabled);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Add animation duration state for sound options
  useEffect(() => {
    if (notificationSoundEnabled) {
      setSoundOptionsVisible(true);
    } else {
      // Delay hiding to allow animation to complete
      const timer = setTimeout(() => {
        setSoundOptionsVisible(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [notificationSoundEnabled]);

  // Reset state when dialog is closed to ensure clean re-renders
  useEffect(() => {
    if (!isOpen) {
      // Reset any stateful UI elements when modal closes
      setIsTestingSound(false);
      setIsUploading(false);
      setIsSelectingOption(false);
      setIsInteractingWithSelect(false);
      setIsClosing(false);
    }
  }, [isOpen]);

  // Explicitly handle document-level events to detect when select dropdowns are open/closed
  useEffect(() => {
    if (!isOpen) return;

    const handleSelectOpened = () => {
      setIsSelectingOption(true);
      setIsInteractingWithSelect(true);
    };

    const handleSelectClosed = () => {
      // Keep track that we were selecting but now finished
      setIsSelectingOption(false);

      // Delay resetting interaction state to prevent immediate closing
      setTimeout(() => {
        setIsInteractingWithSelect(false);
      }, 200);
    };

    // Create a mutation observer to detect DOM changes from select dropdowns
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const addedNodes = Array.from(mutation.addedNodes);
          const removedNodes = Array.from(mutation.removedNodes);

          // Check if a portal was added (dropdown opened)
          const portalAdded = addedNodes.some(node =>
            node instanceof HTMLElement &&
            (node.hasAttribute('data-radix-portal') ||
              node.querySelector('[data-radix-popper-content-wrapper]'))
          );

          // Check if a portal was removed (dropdown closed)
          const portalRemoved = removedNodes.some(node =>
            node instanceof HTMLElement &&
            (node.hasAttribute('data-radix-portal') ||
              node.querySelector('[data-radix-popper-content-wrapper]'))
          );

          if (portalAdded) {
            handleSelectOpened();
          }
          if (portalRemoved) {
            handleSelectClosed();
          }
        }
      }
    });

    // Start observing the document body for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Listen for our custom select events as a backup
    document.addEventListener('select-portal-opened', handleSelectOpened);
    document.addEventListener('select-portal-closed', handleSelectClosed);

    return () => {
      // Clean up
      observer.disconnect();
      document.removeEventListener('select-portal-opened', handleSelectOpened);
      document.removeEventListener('select-portal-closed', handleSelectClosed);
    };
  }, [isOpen]);

  // Modified click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't handle clicks if deliberately closing or interacting with select
      if (isClosing || isInteractingWithSelect || isSelectingOption) return;

      // Don't handle clicks while selects are active
      const target = event.target as HTMLElement;

      // Check for clicks on select elements
      const isSelectElement =
        target.closest('[data-radix-select-content]') ||
        target.closest('[data-radix-select-item]') ||
        target.closest('[data-radix-select-trigger]') ||
        target.closest('[data-radix-popper-content-wrapper]');

      if (isSelectElement) return;

      // Check if click is outside dialog
      if (isOpen &&
        dialogRef.current &&
        !dialogRef.current.contains(target) &&
        !isSelectElement) {
        // Only close if it's a deliberate click outside, not from dropdown interactions
        setIsClosing(true);
        onOpenChange(false);
      }
    };

    if (isOpen) {
      // Add delay to avoid immediate closing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 300); // Longer delay to ensure modal is fully rendered
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onOpenChange, isSelectingOption, isInteractingWithSelect, isClosing]);

  const handleDialogOpenChange = (open: boolean) => {
    // Don't close the dialog if we're in the middle of selecting an option
    if (!open && (isSelectingOption || isInteractingWithSelect)) {
      return;
    }

    // Track that we're deliberately closing
    if (!open) {
      setIsClosing(true);
    }

    // Call the parent onOpenChange after animations or state changes
    if (!open) {
      // Slight delay to ensure proper cleanup
      setTimeout(() => {
        onOpenChange(open);
      }, 50);
    } else {
      onOpenChange(open);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      await uploadBackground(file);
    } catch (error) {
      console.error('Error uploading background:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const testNotificationSound = async () => {
    if (isTestingSound) return;

    setIsTestingSound(true);
    try {
      console.log('Testing notification sound');
      await playNotificationSound(0.8, notificationSoundType);
    } catch (error) {
      console.error('Error playing test notification sound:', error);
    } finally {
      setIsTestingSound(false);
    }
  };

  const getSoundTypeLabel = (type: string) => {
    switch (type) {
      case 'bell': return t('highBell');
      case 'soft': return t('mediumBell');
      case 'low': return t('deepBell');
      case 'subtle': return t('subtleBell');
      default: return t('highBell');
    }
  };

  const handleSelectChange = (value: string, type: string) => {
    if (type === 'language') {
      setLanguage(value as Language);
    } else if (type === 'soundType') {
      setNotificationSoundType(value as 'bell' | 'soft' | 'low' | 'subtle');
    }
  };

  // Check admin status when the modal opens
  useEffect(() => {
    if (isOpen) {
      checkAdminStatus();
    }
  }, [isOpen, checkAdminStatus]);

  // Reset admin login form when tab changes or modal closes
  useEffect(() => {
    setAdminPassword('');
    setAdminError('');
    setAdminLoginSuccess(false);
  }, [activeTab, isOpen]);

  // Handle admin login
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!adminPassword.trim()) {
      setAdminError(t('adminPasswordRequired'));
      return;
    }

    setIsAdminLoggingIn(true);
    setAdminError('');

    try {
      console.log("Attempting admin login with password");

      // Use our server API endpoint to get user profile instead of direct Supabase call
      const response = await fetch('/api/user/profile', {
        method: 'GET',
        credentials: 'include', // Include cookies with the request
      });

      const profileData = await response.json();

      if (!response.ok || !profileData.authenticated) {
        setAdminError(t('loginRequired'));
        setIsAdminLoggingIn(false);
        return;
      }

      const userEmail = profileData.user.email;
      const userId = profileData.user.id;

      if (!userEmail || !userId) {
        setAdminError(t('loginRequired'));
        setIsAdminLoggingIn(false);
        return;
      }

      console.log("Admin login with email:", userEmail, "User ID:", userId);

      // Call admin login API with password, email and userId
      const loginResponse = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: adminPassword,
          email: userEmail,
          userId: userId
        }),
        credentials: 'include', // Important! Include cookies with the request
      });

      const data = await loginResponse.json();

      console.log("Admin login response:", loginResponse.status, data);

      if (!loginResponse.ok) {
        const error = data.error || {};

        if (error.message === 'Not authorized as admin') {
          setAdminError(t('notAuthorizedAsAdmin'));
        } else if (error.message === 'Password is incorrect') {
          setAdminError(t('adminPasswordIncorrect'));
        } else if (error.message === 'You must be logged in') {
          setAdminError(t('loginRequired'));
        } else if (error.message === 'User not found') {
          setAdminError('User not found. Make sure your email matches the admin email.');
        } else if (error.message === 'Error granting admin access') {
          setAdminError('Error granting admin permissions. Please contact support.');
        } else {
          setAdminError(error.message || t('adminLoginFailed'));
        }
        return;
      }

      if (data?.success) {
        setAdminLoginSuccess(true);
        // Refresh admin status
        await checkAdminStatus();
      } else {
        setAdminError(t('adminLoginFailed'));
      }
    } catch (error) {
      console.error("Admin login error:", error);
      setAdminError(t('adminLoginFailed'));
    } finally {
      setIsAdminLoggingIn(false);
    }
  };

  // Handle admin logout
  const handleAdminLogout = async () => {
    setIsLoggingOut(true);
    try {
      console.log("Calling logoutAdmin from settings modal");
      await logoutAdmin();
      console.log("Admin logout process completed in modal");
      // State is reset within the logoutAdmin function itself
    } catch (error) {
      console.error("Error during admin logout in modal:", error);
      // Optionally show an error message to the user
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent
        ref={dialogRef}
        className="p-0 gap-0 max-w-3xl w-[95vw] lg:w-[90vw] bg-[#FFF1E5] dark:bg-[#212121] overflow-hidden settings-dialog h-[95vh] lg:h-auto max-h-[95vh] lg:max-h-[80vh]"
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking on select dropdown or during interactions
          if (isSelectingOption || isInteractingWithSelect) {
            e.preventDefault();
            return;
          }

          // Check if interaction is with a select-related element
          const target = e.target as HTMLElement;
          const isSelectDropdown =
            target.closest('[data-radix-select-content]') ||
            target.closest('[data-radix-select-item]') ||
            target.closest('[data-radix-select-trigger]') ||
            target.closest('[data-radix-popper-content-wrapper]');

          if (isSelectDropdown) {
            e.preventDefault();
            return;
          }
        }}
        onInteractOutside={(e) => {
          // Prevent interaction outside when using dropdowns
          if (isSelectingOption || isInteractingWithSelect) {
            e.preventDefault();
            return;
          }
        }}
        onEscapeKeyDown={() => {
          // Only allow escape to close if not in the middle of selection
          if (isSelectingOption || isInteractingWithSelect) {
            return;
          }
          setIsClosing(true);
          onOpenChange(false);
        }}
      >
        {/* Custom close button with high z-index to ensure it's clickable */}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-full p-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer z-[100] w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7"
          onClick={() => {
            setIsClosing(true);
            onOpenChange(false);
          }}
        >
          <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
          <span className="sr-only">{t('closeSidebar')}</span>
        </DialogPrimitive.Close>
        <DialogTitle className="sr-only">{t('settings')}</DialogTitle>
        <div className="flex flex-col lg:flex-row h-full lg:h-[650px]">
          {/* Left sidebar - horizontal tabs on mobile, vertical on desktop */}
          <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-[#FFE0D0] dark:border-[#2A2A2A] p-4">
            <h2 className="text-xl lg:text-2xl font-bold mb-4 lg:mb-6 px-2 text-gray-800 dark:text-gray-100">{t('settings')}</h2>

            <nav className="flex lg:flex-col space-x-2 lg:space-x-0 lg:space-y-1 overflow-x-auto lg:overflow-x-visible mobile-tabs-scroll">
              <button
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left rounded-xl transition-colors lg:whitespace-nowrap lg:w-full min-h-[44px] mobile-tab-responsive",
                  activeTab === 'general'
                    ? "bg-[#FFE0D0] dark:bg-[#2A2A2A] text-gray-900 dark:text-white"
                    : "text-gray-700 dark:text-gray-300 hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]"
                )}
                onClick={() => setActiveTab('general')}
              >
                <Settings className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium mobile-text-i18n">{t('general')}</span>
              </button>

              <button
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left rounded-xl transition-colors lg:whitespace-nowrap lg:w-full min-h-[44px] mobile-tab-responsive",
                  activeTab === 'admin'
                    ? "bg-[#FFE0D0] dark:bg-[#2A2A2A] text-gray-900 dark:text-white"
                    : "text-gray-700 dark:text-gray-300 hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]"
                )}
                onClick={() => setActiveTab('admin')}
              >
                <Shield className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium mobile-text-i18n">{t('admin')}</span>
              </button>
            </nav>
          </div>

          {/* Right content area */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-6">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{t('general')}</h3>

                <div className="space-y-4">
                  {/* Language Selection */}
                  <div className="flex items-center justify-between pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
                    <div>
                      <h4 className="text-base font-medium text-gray-900 dark:text-white">{t('language')}</h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('languageSelector')}</p>
                    </div>

                    <div className="flex items-center justify-between">
                      <Select
                        value={language}
                        onValueChange={(value) => handleSelectChange(value, 'language')}
                        onOpenChange={(open) => {
                          setIsSelectingOption(open);
                          // Also emit our custom event as a backup
                          emitSelectPortalEvent(open);
                        }}
                      >
                        <SelectTrigger
                          className="w-full sm:w-[180px] min-w-[120px] relative group border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent mobile-select-dynamic"
                        >
                          <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
                          <div className="relative z-10">
                            <SelectValue placeholder={t('language')} />
                          </div>
                        </SelectTrigger>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          <SelectItem value="en">
                            <span className="pl-1">English</span>
                          </SelectItem>
                          <SelectItem value="es">
                            <span className="pl-1">Español</span>
                          </SelectItem>
                          <SelectItem value="pt">
                            <span className="pl-1">Português</span>
                          </SelectItem>
                          <SelectItem value="lt">
                            <span className="pl-1">Lietuvių</span>
                          </SelectItem>
                          <SelectItem value="zh">
                            <span className="pl-1">中文（简体） (Chinese)</span>
                          </SelectItem>
                          <SelectItem value="hi">
                            <span className="pl-1">हिंदी (Hindi)</span>
                          </SelectItem>
                          <SelectItem value="ar">
                            <span className="pl-1">العربية (Arabic)</span>
                          </SelectItem>
                          <SelectItem value="ja">
                            <span className="pl-1">日本語 (Japanese)</span>
                          </SelectItem>
                          <SelectItem value="de">
                            <span className="pl-1">Deutsch</span>
                          </SelectItem>
                          <SelectItem value="ru">
                            <span className="pl-1">Русский (Russian)</span>
                          </SelectItem>
                          <SelectItem value="fr">
                            <span className="pl-1">Français</span>
                          </SelectItem>
                          <SelectItem value="ko">
                            <span className="pl-1">한국어 (Korean)</span>
                          </SelectItem>
                          <SelectItem value="sw">
                            <span className="pl-1">Kiswahili</span>
                          </SelectItem>
                          <SelectItem value="yo">
                            <span className="pl-1">Yorùbá</span>
                          </SelectItem>
                          <SelectItem value="am">
                            <span className="pl-1">አማርኛ (Amharic)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Notification Sound Toggle */}
                  <div className="space-y-2 pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
                    <div className="flex items-center justify-between group">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2">
                            <div className="relative">
                              {notificationSoundEnabled ? (
                                <>
                                  <Volume2 className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D] transition-all" />
                                  <span className="absolute -right-1 -top-1 flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6417] dark:bg-[#FF8A4D] opacity-30"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF6417] dark:bg-[#FF8A4D]"></span>
                                  </span>
                                </>
                              ) : (
                                <VolumeX className="h-5 w-5 text-gray-400 dark:text-gray-500 transition-all" />
                              )}
                            </div>
                            {t('notificationSound')}
                          </h4>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('notificationSoundDesc')}</p>
                      </div>

                      <div className="relative">
                        <Switch
                          checked={notificationSoundEnabled}
                          onCheckedChange={setNotificationSoundEnabled}
                          className={cn(
                            "data-[state=checked]:!bg-[#FF6417] dark:data-[state=checked]:!bg-[#FF8A4D]",
                            "transition-all duration-300"
                          )}
                        />
                      </div>
                    </div>

                    {soundOptionsVisible && (
                      <div className={cn(
                        "mt-3 ml-2 px-2 border-l-2 border-[#FFE0D0] dark:border-[#2A2A2A] transition-all duration-300",
                        notificationSoundEnabled
                          ? "max-h-40 opacity-100"
                          : "max-h-0 opacity-0 overflow-hidden"
                      )}>
                        <div className="flex flex-col space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('soundType')}</span>
                            <Select
                              value={notificationSoundType}
                              onValueChange={(value) => handleSelectChange(value, 'soundType')}
                              onOpenChange={(open) => {
                                setIsSelectingOption(open);
                                // Also emit our custom event as a backup
                                emitSelectPortalEvent(open);
                              }}
                              disabled={!notificationSoundEnabled}
                            >
                              <SelectTrigger
                                className="w-full sm:w-[180px] min-w-[120px] relative group border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent mobile-select-dynamic"
                                style={{
                                  opacity: notificationSoundEnabled ? 1 : 0.5,
                                }}
                              >
                                <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
                                <div className="relative z-10">
                                  <SelectValue placeholder={t('soundType')} />
                                </div>
                              </SelectTrigger>
                              <SelectContent className="max-h-60 overflow-y-auto">
                                {['bell', 'soft', 'low', 'subtle'].map((type) => (
                                  <SelectItem key={type} value={type}>
                                    <span className="pl-1">{getSoundTypeLabel(type)}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">{t('playSound')}</span>
                            <button
                              onClick={testNotificationSound}
                              className={cn(
                                "w-[180px] px-4 py-2 rounded-md transition-colors relative group",
                                "border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent",
                                "text-gray-700 dark:text-gray-300",
                                "flex items-center justify-center gap-2",
                                isTestingSound && "relative",
                                !notificationSoundEnabled && "opacity-50 cursor-not-allowed"
                              )}
                              disabled={isTestingSound || !notificationSoundEnabled}
                              title="Test notification sound"
                            >
                              <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
                              <div className="relative z-10 flex items-center justify-center gap-2">
                                <Volume2 className="h-4 w-4" />
                                <span className="text-xs font-medium">{t('playSound')}</span>
                              </div>
                              {isTestingSound && (
                                <span className="absolute inset-0 flex items-center justify-center bg-[#FFD0B5] dark:bg-[#3A3A3A] rounded-md z-20">
                                  <span className="flex items-center space-x-1">
                                    <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse"></span>
                                    <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                                    <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                                  </span>
                                </span>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Custom Background */}
                  <div className="pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2">
                          <Upload className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                          {t('customBackground')}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('customBackgroundDesc')}</p>
                      </div>

                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileChange}
                      />

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 rounded-md transition-colors relative group border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent text-gray-700 dark:text-gray-300 flex items-center gap-2"
                        disabled={isUploading}
                      >
                        <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
                        <div className="relative z-10 flex items-center justify-center gap-2">
                          <Upload className="h-4 w-4" />
                          <span className="text-xs font-medium">{t('upload')}</span>
                        </div>
                        {isUploading && (
                          <span className="absolute inset-0 flex items-center justify-center bg-[#FFD0B5] dark:bg-[#3A3A3A] rounded-md z-20">
                            <span className="flex items-center space-x-1">
                              <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse"></span>
                              <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                              <span className="h-1.5 w-1.5 bg-[#FF6417] dark:bg-[#FF8A4D] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                            </span>
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {backgroundImage && (
                    <div className="mt-4 relative bg-white dark:bg-gray-900 rounded-lg overflow-hidden shadow-sm border border-[#FFE0D0] dark:border-[#2A2A2A]">
                      <div className="aspect-[16/9] relative">
                        <img
                          src={backgroundImage}
                          alt="Custom background"
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => setBackgroundImage(null)}
                          className="absolute top-2 right-2 p-1.5 rounded-full transition-colors bg-white/80 dark:bg-gray-900/80 hover:bg-white dark:hover:bg-gray-900 text-gray-700 dark:text-gray-300 border border-[#FFE0D0] dark:border-[#2A2A2A] group"
                          title="Remove"
                        >
                          <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
                          <X className="h-4 w-4 relative z-10" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'admin' && (
              <div className="space-y-6">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{t('admin')}</h3>

                <div className="space-y-6">
                  {!isAdmin ? (
                    <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
                      <div className="flex items-center gap-2 mb-4">
                        <Lock className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('adminLogin')}</h4>
                      </div>

                      <form onSubmit={handleAdminLogin} className="space-y-4">
                        <div className="space-y-2">
                          <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('adminPassword')}
                          </label>
                          <Input
                            id="admin-password"
                            type="password"
                            value={adminPassword}
                            onChange={(e) => setAdminPassword(e.target.value)}
                            placeholder="••••••••"
                            className="bg-white dark:bg-[#212121] border border-[#FFE0D0] dark:border-[#2A2A2A]"
                          />
                          {adminError && (
                            <p className="text-sm text-red-600 dark:text-red-400">{adminError}</p>
                          )}
                        </div>

                        <Button
                          type="submit"
                          className="w-full bg-[#FF6417] hover:bg-[#E05A15] text-white dark:bg-[#FF8A4D] dark:hover:bg-[#E05A15] dark:text-white font-medium rounded-lg"
                          disabled={isAdminLoggingIn || !adminPassword.trim()}
                        >
                          {isAdminLoggingIn ? (
                            <>
                              <div className="h-4 w-4 border-2 border-white border-r-transparent rounded-full animate-spin mr-2"></div>
                              {t('loggingIn')}
                            </>
                          ) : (
                            t('login')
                          )}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-6 mb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                          <div>
                            <h4 className="text-base font-medium text-gray-900 dark:text-white">{t('adminAuthenticated')}</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('adminAuthenticatedDesc')}</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleAdminLogout}
                          disabled={isLoggingOut}
                          className="text-red-600 dark:text-red-400 border-red-400 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 hover:border-red-600 dark:hover:border-red-500 flex items-center gap-2"
                        >
                          {isLoggingOut ? (
                            <div className="h-4 w-4 border-2 border-current border-r-transparent rounded-full animate-spin mr-2"></div>
                          ) : (
                            <LogOut className="h-4 w-4 mr-2" />
                          )}
                          <span className="text-xs font-medium">
                            {isLoggingOut ? t('loggingOut') : t('logoutAdmin')}
                          </span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      <style jsx global>{`
        .settings-dialog {
          background-color: #FFF1E5 !important; 
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        
        .dark .settings-dialog {
          background-color: #212121 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        
        /* Make sure the close button is always visible and clickable */
        [data-radix-dialog-close] {
          z-index: 100 !important;
          position: absolute !important;
          right: 1rem !important;
          top: 1rem !important;
          cursor: pointer !important;
          pointer-events: auto !important;
        }
        
        /* Make sure Select Portals appear above other UI elements */
        [data-radix-popper-content-wrapper] {
          z-index: 9999 !important;
        }
        
        /* Style dropdown content to match user menu */
        [data-radix-select-content] {
          background-color: #EFE1D5 !important;
          border-radius: 0.5rem !important;
          overflow: hidden !important;
          padding: 0 !important;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
        }
        
        .dark [data-radix-select-content] {
          background-color: #2F2F2F !important;
        }
        
        [data-radix-select-viewport] {
          padding: 8px !important;
        }
        
        /* Performance optimization - use more specific selectors */
        .settings-dialog [data-radix-select-content],
        .settings-dialog [data-radix-select-viewport],
        .settings-dialog [data-radix-select-item] {
          pointer-events: auto !important;
        }

        /* Selected item styling - simplified for performance */
        [data-radix-select-item][data-state="checked"] {
          color: #444 !important;
          position: relative !important;
        }
        
        .dark [data-radix-select-item][data-state="checked"] {
          color: #E6E6E6 !important;
        }
        
        /* Simplified check icon for better performance */
        [data-radix-select-item][data-state="checked"]::after {
          content: "";
          width: 16px;
          height: 16px;
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23FF6417' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
        }
        
        .dark [data-radix-select-item][data-state="checked"]::after {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23E6E6E6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E");
        }
        
        [data-radix-select-item] {
          border-radius: 0.5rem !important;
          margin: 2px 0 !important;
          padding: 12px 16px !important;
          position: relative !important;
          color: #444 !important;
          transition: background-color 0.15s ease !important;
        }
        
        .dark [data-radix-select-item] {
          color: #E6E6E6 !important;
        }
        
        [data-radix-select-item]:hover {
          background-color: #FFE0D0 !important;
        }
        
        .dark [data-radix-select-item]:hover {
          background-color: #424242 !important;
        }

        /* Remove any unnecessary animations for performance */
        [data-radix-select-content],
        [data-radix-select-viewport] {
          transition: none !important;
        }
      `}</style>
    </Dialog>
  );
} 