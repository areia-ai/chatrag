'use client';

import React from 'react';
import { Check, Brain, Gift, Unlock, Link2Off } from 'lucide-react';
import { useModel, AVAILABLE_MODELS } from '@/components/providers/model-provider';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { PortalTooltip } from '@/components/ui/portal-tooltip';

// Custom tooltip styles - matches PortalTooltip colors
const tooltipStyles = `
  .icon-tooltip {
    position: relative;
  }
  .icon-tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    padding: 4px 8px;
    background: #FF6417;
    color: white;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    border-radius: 6px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 999999;
  }
  .icon-tooltip:hover::after {
    opacity: 1;
  }
  /* Dark mode - match header tooltips exactly */
  .dark .icon-tooltip::after {
    background: #1A1A1A;
    color: #E6E6E6;
  }
`;

export function ModelSelector() {
  const { selectedModel, setSelectedModel, availableModels } = useModel();
  const { theme, resolvedTheme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark' || resolvedTheme === 'dark';

  // Inject tooltip styles
  React.useEffect(() => {
    if (!document.getElementById('icon-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'icon-tooltip-styles';
      style.textContent = tooltipStyles;
      document.head.appendChild(style);
    }
  }, []);

  const dropdownBgColor = isDarkMode ? '#2F2F2F' : '#EFE1D5';
  const hoverColor = isDarkMode ? '#424242' : '#E5D6C9';
  const textColor = isDarkMode ? '#E6E6E6' : '#444';
  const checkColor = isDarkMode ? '#E6E6E6' : '#FF6417';

  return (
    <div
      style={{
        backgroundColor: dropdownBgColor,
        padding: '8px 4px 8px 8px'
      }}
      className="w-full rounded-lg"
    >
      <div className={cn(
        "max-h-[14rem] overflow-y-scroll pr-1",
        isDarkMode ? "dark-scrollbar" : "light-scrollbar"
      )}>
        {availableModels.map((option) => (
          <button
            key={option.id}
            onClick={() => setSelectedModel(option)}
            className={cn(
              "w-full text-left text-sm rounded-lg transition-colors flex items-center justify-between",
              "hover:bg-transparent"
            )}
            style={{
              backgroundColor: dropdownBgColor,
              color: selectedModel?.id === option.id
                ? isDarkMode ? '#fff' : '#000'
                : isDarkMode ? '#ddd' : '#555',
              padding: '12px 16px',
              border: 'none',
              margin: '2px 0'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hoverColor}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = dropdownBgColor}
          >
            <div className="flex items-center gap-2">
              <span className="flex-shrink-0">{option.displayName}</span>
              {option.supportsReasoning && (
                <div className="flex items-center icon-tooltip" data-tooltip="Supports Reasoning">
                  <Brain
                    className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0 cursor-help"
                    aria-label="Supports Reasoning"
                  />
                </div>
              )}
              {option.isFree && (
                <div className="flex items-center icon-tooltip" data-tooltip="Free on OpenRouter">
                  <Gift
                    className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0 cursor-help"
                    aria-label="Free on OpenRouter"
                  />
                </div>
              )}
              {option.isOpenSource && (
                <div className="flex items-center icon-tooltip" data-tooltip="Open Source">
                  <Unlock
                    className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0 cursor-help"
                    aria-label="Open Source"
                  />
                </div>
              )}
              {option.isUncensored && (
                <div className="flex items-center icon-tooltip" data-tooltip="Uncensored Model">
                  <Link2Off
                    className="h-3.5 w-3.5 text-red-600 dark:text-pink-400 flex-shrink-0 cursor-help"
                    aria-label="Uncensored Model"
                  />
                </div>
              )}
            </div>
            {selectedModel?.id === option.id && (
              <div className="flex-shrink-0 flex items-center justify-center">
                <Check className="h-4 w-4" style={{ color: checkColor }} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
} 
