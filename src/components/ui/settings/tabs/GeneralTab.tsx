'use client';

import { memo, useCallback, useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X, Globe, Bell, VolumeX, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { useLanguage } from '@/components/providers/language-provider';
import { Language } from '@/translations';
import { playNotificationSound } from '@/lib/audio-utils';
import { DebouncedSelect, MemoizedSelectItem } from '../components/DebouncedSelect';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

// Custom comparison function for memo optimization
const areEqual = (prevProps: any, nextProps: any) => {
  // Since GeneralTab has no props, always return true to prevent re-renders
  // unless the component's internal state changes
  return true;
};

export const GeneralTab = memo(function GeneralTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    backgroundImage,
    uploadBackground,
    notificationSoundEnabled,
    setNotificationSoundEnabled,
    notificationSoundType,
    setNotificationSoundType,
    setBackgroundImage,
  } = useUserSettingsStore();

  const [isUploading, setIsUploading] = useState(false);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const [isSelectingOption, setIsSelectingOption] = useState(false);
  const [soundOptionsVisible, setSoundOptionsVisible] = useState(notificationSoundEnabled);

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

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [uploadBackground]);

  const testNotificationSound = useCallback(async () => {
    if (isTestingSound) return;

    setIsTestingSound(true);
    try {
      await playNotificationSound(0.8, notificationSoundType);
    } catch (error) {
      console.error('Error playing test notification sound:', error);
    } finally {
      setIsTestingSound(false);
    }
  }, [isTestingSound, notificationSoundType]);

  const getSoundTypeLabel = useCallback((type: string) => {
    switch (type) {
      case 'bell': return t('highBell');
      case 'soft': return t('mediumBell');
      case 'low': return t('deepBell');
      case 'subtle': return t('subtleBell');
      default: return t('highBell');
    }
  }, [t]);

  const handleLanguageChange = useCallback((value: string) => {
    setLanguage(value as Language);
  }, [setLanguage]);

  const handleSoundTypeChange = useCallback((value: string) => {
    setNotificationSoundType(value as 'bell' | 'soft' | 'low' | 'subtle');
  }, [setNotificationSoundType]);

  // Callbacks for select open/close events - must be defined at top level
  const handleLanguageSelectOpenChange = useCallback((open: boolean) => {
    setIsSelectingOption(open);
  }, []);

  const handleSoundSelectOpenChange = useCallback((open: boolean) => {
    setIsSelectingOption(open);
  }, []);

  return (
    <div className="space-y-3 sm:space-y-6 pb-20">
      {/* Hide heading on mobile since tab is already highlighted - saves vertical space */}
      <h3 className="hidden sm:block text-xl font-semibold text-gray-900 dark:text-white">{t('general')}</h3>

      <div className="space-y-3 sm:space-y-4">
        {/* Language Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
          <div className="flex-1 min-w-0">
            <h4 className="text-base font-medium text-gray-900 dark:text-white">{t('language')}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 break-words">{t('languageSelector')}</p>
          </div>
          <div className="flex-shrink-0 w-full sm:w-auto">
            <DebouncedSelect
              value={language}
              onValueChange={handleLanguageChange}
              onOpenChange={handleLanguageSelectOpenChange}
              className="w-full sm:w-[180px] relative group border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent"
              placeholder={t('language')}
              debounceMs={100}
            >
              <MemoizedSelectItem value="en">
                <span className="pl-1">English</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="es">
                <span className="pl-1">Español</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="pt">
                <span className="pl-1">Português</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="lt">
                <span className="pl-1">Lietuvių</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="zh">
                <span className="pl-1">中文（简体） (Chinese)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="hi">
                <span className="pl-1">हिंदी (Hindi)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="ar">
                <span className="pl-1">العربية (Arabic)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="ja">
                <span className="pl-1">日本語 (Japanese)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="de">
                <span className="pl-1">Deutsch</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="ru">
                <span className="pl-1">Русский (Russian)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="fr">
                <span className="pl-1">Français</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="ko">
                <span className="pl-1">한국어 (Korean)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="sw">
                <span className="pl-1">Kiswahili</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="yo">
                <span className="pl-1">Yorùbá</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="am">
                <span className="pl-1">አማርኛ (Amharic)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="sr">
                <span className="pl-1">Српски (Serbian)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="sl">
                <span className="pl-1">Slovenščina (Slovenian)</span>
              </MemoizedSelectItem>
              <MemoizedSelectItem value="hr">
                <span className="pl-1">Hrvatski (Croatian)</span>
              </MemoizedSelectItem>
            </DebouncedSelect>
          </div>
        </div>

        {/* Notification Sound Toggle */}
        <div className="space-y-2 pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
          <div className="flex items-center justify-between">
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">{t('notificationSoundDesc')}</p>
            </div>

            <div className="relative flex-shrink-0 ml-3">
              <Switch
                checked={notificationSoundEnabled}
                onCheckedChange={setNotificationSoundEnabled}
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
                {/* Sound Type - stacked on mobile */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-shrink-0">{t('soundType')}</span>
                  <DebouncedSelect
                    value={notificationSoundType}
                    onValueChange={handleSoundTypeChange}
                    onOpenChange={handleSoundSelectOpenChange}
                    disabled={!notificationSoundEnabled}
                    className="w-full sm:w-[180px] relative group border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent"
                    placeholder={t('soundType')}
                    debounceMs={100}
                  >
                    {['bell', 'soft', 'low', 'subtle'].map((type) => (
                      <MemoizedSelectItem key={type} value={type}>
                        <span className="pl-1">{getSoundTypeLabel(type)}</span>
                      </MemoizedSelectItem>
                    ))}
                  </DebouncedSelect>
                </div>

                {/* Play Sound - stacked on mobile */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-shrink-0">{t('playSound')}</span>
                  <button
                    onClick={testNotificationSound}
                    className={cn(
                      "w-full sm:w-[180px] px-4 py-2 rounded-md transition-colors relative group",
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
                      <Volume2 className="h-4 w-4 flex-shrink-0" />
                      <span className="text-xs font-medium whitespace-nowrap">{t('playSound')}</span>
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

        {/* Custom Background - last section, no border-b, extra bottom margin for safe area */}
        <div className="pb-6">
          {/* Stacked layout on mobile, side-by-side on larger screens */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div className="flex-1">
              <h4 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <Upload className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                {t('customBackground')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">{t('customBackgroundDesc')}</p>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleFileChange}
            />

            {/* Upload button - full width on mobile, auto on larger screens */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "px-4 py-2.5 rounded-lg transition-colors relative group",
                "border border-[#FFE0D0] dark:border-[#2A2A2A] bg-transparent",
                "text-gray-700 dark:text-gray-300",
                "flex items-center justify-center gap-2",
                // Full width on mobile for better touch target
                "w-full sm:w-auto"
              )}
              disabled={isUploading}
            >
              <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 bg-[#FFE0D0] dark:bg-[#424242] transition-opacity duration-200"></div>
              <div className="relative z-10 flex items-center justify-center gap-2">
                <Upload className="h-4 w-4" />
                <span className="text-sm font-medium">{t('upload')}</span>
              </div>
              {isUploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-[#FFD0B5] dark:bg-[#3A3A3A] rounded-lg z-20">
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
              <Image
                src={backgroundImage}
                alt="Custom background"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 600px"
                unoptimized
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
  );
}, areEqual);
