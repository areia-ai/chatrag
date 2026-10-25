'use client';

import React from 'react';
import { useTextSize } from '@/components/providers/text-size-provider';
import { useFont } from '@/components/providers/font-provider';
import * as Slider from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface MobileTextSizeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileTextSizeModal({ open, onOpenChange }: MobileTextSizeModalProps) {
  const { textSize, setTextSize } = useTextSize();
  const { fontFamily, setFontFamily } = useFont();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark';
  
  const hoverColor = isDarkMode ? '#424242' : '#E5D6C9';
  const textColor = isDarkMode ? '#E6E6E6' : '#444';
  const accentColor = isDarkMode ? '#424242' : '#FF6417';
  const checkColor = isDarkMode ? '#E6E6E6' : '#FF6417';

  const sizeToValue = {
    'small': 0,
    'default': 1,
    'large': 2
  };

  const valueToSize = {
    0: 'small',
    1: 'default',
    2: 'large'
  } as const;

  const fonts = [
    { id: 'atkinson-hyperlegible', name: 'Atkinson Hyperlegible ♿', className: 'font-atkinson-hyperlegible' },
    { id: 'lexend', name: 'Lexend ♿', className: 'font-lexend' },
    { id: 'inter', name: t('interDefault'), className: 'font-sans' },
    { id: 'open-sans', name: 'Open Sans', className: 'font-open-sans' },
    { id: 'lato', name: 'Lato', className: 'font-lato' },
    { id: 'merriweather', name: t('merriweather'), className: 'font-serif' },
    { id: 'source-code-pro', name: t('sourceCodePro'), className: 'font-mono' }
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#FFFAF5] dark:bg-[#212121]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('textSettings')}</span>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Text Size Slider */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">{t('textSize')}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {textSize === 'small' ? t('small') : textSize === 'default' ? t('default') : t('large')}
              </span>
            </div>
            <Slider.Root
              className="relative flex items-center select-none touch-none w-full h-5"
              value={[sizeToValue[textSize]]}
              onValueChange={([value]) => setTextSize(valueToSize[value as keyof typeof valueToSize])}
              max={2}
              step={1}
              aria-label="Text size"
            >
              <Slider.Track 
                className="relative grow rounded-full h-[3px]" 
                style={{ backgroundColor: isDarkMode ? '#3A3A3A' : '#FFE0D0' }}
              >
                <Slider.Range 
                  className="absolute rounded-full h-full" 
                  style={{ backgroundColor: accentColor }}  
                />
              </Slider.Track>
              <Slider.Thumb
                className="block w-5 h-5 rounded-full focus:outline-none shadow-md"
                style={{ backgroundColor: accentColor }}
              />
            </Slider.Root>
          </div>

          {/* Font Selection */}
          <div>
            <div className="text-sm font-medium mb-3">{t('fontFamily')}</div>
            <div className="space-y-2">
              {fonts.map((font) => (
                <button
                  key={font.id}
                  onClick={() => setFontFamily(font.id as any)}
                  className={cn(
                    "w-full text-left text-sm rounded-lg transition-colors flex items-center justify-between p-3",
                    font.className,
                    fontFamily === font.id 
                      ? "bg-[#FFE0D0] dark:bg-[#2F2F2F]" 
                      : "hover:bg-[#FFE0D0]/50 dark:hover:bg-[#2F2F2F]/50"
                  )}
                >
                  <span>{font.name}</span>
                  {fontFamily === font.id && (
                    <Check className="h-4 w-4" style={{ color: checkColor }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}