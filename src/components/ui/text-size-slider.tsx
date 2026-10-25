'use client';

import { useTextSize } from '@/components/providers/text-size-provider';
import { useFont } from '@/components/providers/font-provider';
import * as Slider from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { PortalTooltip } from './portal-tooltip';

export function TextSizeSlider({ className }: { className?: string }) {
  const { textSize, setTextSize } = useTextSize();
  const { fontFamily, setFontFamily } = useFont();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark';

  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
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
    <DropdownMenu>
      <PortalTooltip content={t('textSize')}>
        <DropdownMenuTrigger asChild>
          <button className="dropdown-trigger flex items-center justify-center w-10 h-10 text-gray-700 dark:text-gray-200 transition-colors bg-transparent hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242] rounded-lg">
            <span className="text-base font-medium">Aa</span>
          </button>
        </DropdownMenuTrigger>
      </PortalTooltip>
      <DropdownMenuContent
        align="end"
        className="w-72 rounded-xl"
        style={{
          backgroundColor: dropdownBgColor,
          border: 'none',
          boxShadow: '0 10px 40px -5px rgba(0, 0, 0, 0.15), 0 4px 25px -2px rgba(0, 0, 0, 0.1)',
          padding: 0,
          overflow: 'hidden',
          borderRadius: '12px'
        }}
      >
        <div
          style={{
            backgroundColor: dropdownBgColor,
            padding: '16px'
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span style={{ fontSize: '14px', fontWeight: 500, color: textColor }}>{t('textSize')}</span>
            <span style={{ fontSize: '14px', color: isDarkMode ? '#aaa' : '#888' }}>
              {textSize === 'small' ? t('small') : textSize === 'default' ? t('default') : t('large')}
            </span>
          </div>
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5 mb-6"
            value={[sizeToValue[textSize]]}
            onValueChange={([value]) => setTextSize(valueToSize[value as keyof typeof valueToSize])}
            max={2}
            step={1}
            aria-label="Text size"
          >
            <Slider.Track
              className="relative grow rounded-full h-[3px]"
              style={{ backgroundColor: isDarkMode ? '#1A1A1A' : '#FFE0D0' }}
            >
              <Slider.Range
                className="absolute rounded-full h-full"
                style={{ backgroundColor: accentColor }}
              />
            </Slider.Track>
            <Slider.Thumb
              className="block w-4 h-4 rounded-full focus:outline-none"
              style={{ backgroundColor: accentColor }}
            />
          </Slider.Root>
          <div className="space-y-2 mt-4">
            <div style={{ fontSize: '14px', fontWeight: 500, color: textColor, marginBottom: '8px' }}>{t('fontFamily')}</div>
            {fonts.map((font) => (
              <button
                key={font.id}
                onClick={() => setFontFamily(font.id as any)}
                className={cn(
                  "w-full text-left text-sm rounded-lg transition-colors flex items-center justify-between",
                  font.className
                )}
                style={{
                  backgroundColor: dropdownBgColor,
                  color: fontFamily === font.id
                    ? isDarkMode ? '#fff' : '#000'
                    : isDarkMode ? '#ddd' : '#555',
                  padding: '12px 16px',
                  border: 'none',
                  margin: '2px 0'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hoverColor}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = dropdownBgColor}
              >
                <span>{font.name}</span>
                {fontFamily === font.id && (
                  <div className="flex-shrink-0 flex items-center justify-center">
                    <Check className="h-4 w-4" style={{ color: checkColor }} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 