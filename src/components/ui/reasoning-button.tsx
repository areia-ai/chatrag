import React, { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { CollapsibleButton } from './collapsible-button';
import { env } from '@/lib/env';
import { useModel } from '@/components/providers/model-provider';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';

interface ReasoningButtonProps {
  disabled?: boolean;
  onReasoningToggle: (_config: ReasoningConfig | null) => void;
  isActive?: boolean;
  currentModel?: string;
}

export interface ReasoningConfig {
  enabled: boolean;
  effort?: 'high' | 'medium' | 'low';
  maxOutputTokens?: number;
  exclude?: boolean;
}

export function ReasoningButton({
  disabled = false,
  onReasoningToggle,
  isActive = false,
  currentModel = '',
}: ReasoningButtonProps) {
  const [isConfigured, setIsConfigured] = useState(isActive);
  const [isHovered, setIsHovered] = useState(false);
  const [wasRecentlyActive, setWasRecentlyActive] = useState(false);
  const hasNotifiedInitialRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  const { selectedModel, availableModels } = useModel();
  const { toast } = useToast();
  
  // Reasoning configuration state
  const [reasoningConfig, setReasoningConfig] = useState<ReasoningConfig>({
    enabled: isActive,
    effort: env.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT as 'medium' | 'high' | 'low' || 'medium',
    maxOutputTokens: parseInt(env.NEXT_PUBLIC_MAX_REASONING_TOKENS || '8000'),
    exclude: false,
  });

  // Use selected model from context or fall back to prop
  const activeModel = selectedModel || availableModels.find(m => m.id === currentModel);
  const isModelSupported = activeModel?.supportsReasoning || false;
  const reasoningMethod = activeModel?.reasoningMethod || 'none';
  
  // Update isConfigured when isActive prop changes and notify parent
  useEffect(() => {
    if (isActive !== isConfigured) {
      setIsConfigured(isActive);
      const newConfig = { ...reasoningConfig, enabled: isActive };
      setReasoningConfig(newConfig);
      
      // Always notify parent of state changes for proper sync
      if (isModelSupported) {
        console.log('[ReasoningButton] Syncing state with parent:', isActive ? newConfig : null);
        onReasoningToggle(isActive ? newConfig : null);
      }
    }
  }, [isActive, isConfigured, reasoningConfig, isModelSupported, onReasoningToggle]);

  // Notify parent on mount if button is active
  useEffect(() => {
    if (!hasNotifiedInitialRef.current && isConfigured && isModelSupported) {
      const config = {
        enabled: true,
        effort: reasoningConfig.effort,
        maxOutputTokens: reasoningConfig.maxOutputTokens,
        exclude: reasoningConfig.exclude,
      };
      console.log('[ReasoningButton] Notifying parent of active state on mount:', config);
      onReasoningToggle(config);
      hasNotifiedInitialRef.current = true;
    }
  }, [isConfigured, isModelSupported, reasoningConfig, onReasoningToggle]);

  // Track when active state changes
  useEffect(() => {
    if (isConfigured) {
      setWasRecentlyActive(true);
    } else if (!isHovered) {
      setWasRecentlyActive(false);
    }
  }, [isConfigured, isHovered]);

  // Auto-deactivate reasoning when switching to a non-reasoning model
  useEffect(() => {
    if (isConfigured && !isModelSupported) {
      console.log('[ReasoningButton] Auto-deactivating reasoning: model does not support reasoning');
      setIsConfigured(false);
      setReasoningConfig(prev => ({ ...prev, enabled: false }));
      onReasoningToggle(null);
    }
  }, [selectedModel?.id, isModelSupported, isConfigured, onReasoningToggle]);

  const handleButtonClick = () => {
    if (!isModelSupported) {
      // Show a toast message that model doesn't support reasoning
      toast({
        title: "Select a reasoning model",
        description: "This feature requires a model with reasoning capabilities (e.g., Claude Sonnet 4.5, Claude Opus 4.1)",
        duration: 3000,
      });
      return;
    }
    
    const willBeEnabled = !isConfigured;
    setIsConfigured(willBeEnabled);
    const newConfig = { ...reasoningConfig, enabled: willBeEnabled };
    setReasoningConfig(newConfig);
    onReasoningToggle(willBeEnabled ? newConfig : null);
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowSettings(!showSettings);
  };

  const handleEffortChange = (effort: 'high' | 'medium' | 'low') => {
    const newConfig = { ...reasoningConfig, effort };
    setReasoningConfig(newConfig);
    if (isConfigured) {
      onReasoningToggle(newConfig);
    }
  };

  const handleMaxTokensChange = (tokens: number) => {
    const newConfig = { ...reasoningConfig, maxOutputTokens: tokens };
    setReasoningConfig(newConfig);
    if (isConfigured) {
      onReasoningToggle(newConfig);
    }
  };

  const handleExcludeToggle = () => {
    const newConfig = { ...reasoningConfig, exclude: !reasoningConfig.exclude };
    setReasoningConfig(newConfig);
    if (isConfigured) {
      onReasoningToggle(newConfig);
    }
  };

  // Mouse enter/leave handlers
  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (wasRecentlyActive && !isConfigured) {
      setWasRecentlyActive(false);
    }
  };

  // Close settings when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Determine if we should show the expanded button
  const showExpandedWithActive = isConfigured;
  const showManualExpanded = !isConfigured && isHovered && wasRecentlyActive;

  if (!env.NEXT_PUBLIC_REASONING_ENABLED || env.NEXT_PUBLIC_REASONING_ENABLED !== 'true') {
    return null;
  }

  // Always show the button, even if model doesn't support reasoning
  // When clicked on unsupported model, it will show a toast message

  return (
    <div
      className="relative mt-1.5"
      ref={dropdownRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showExpandedWithActive ? (
        // Active reasoning button - matching image/video button style
        (<button
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
            <Brain className="h-5 w-5 text-white" />
            
            <span className="text-sm font-medium whitespace-nowrap text-white">
              {String(t('reasoningText'))}
            </span>
            
            <div 
              onClick={handleSettingsClick}
              className="flex items-center cursor-pointer ml-1"
            >
              <div className="flex items-center px-1 py-0 rounded-full border border-white/40 hover:bg-white/10">
                <ChevronDown className={cn(
                  "h-3 w-3 text-white transition-transform",
                  showSettings && "rotate-180"
                )} />
              </div>
            </div>
          </div>
        </button>)
      ) : showManualExpanded ? (
        // Manually expanded inactive button - for hover after deactivation
        (<button
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
            <Brain className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            
            <span className="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-[#9E9E9E]">
              {String(t('reasoningText'))}
            </span>
          </div>
        </button>)
      ) : (
        // Collapsed button
        (<CollapsibleButton
          icon={<Brain className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
          text={String(t('reasoningText'))}
          onClick={handleButtonClick}
          disabled={disabled}
          isActive={false}
        />)
      )}
      {/* Settings Modal - matching image/video generation style */}
      {showSettings && isConfigured && (
        <motion.div 
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 bottom-[calc(100%+10px)] z-[100] w-64 rounded-xl bg-white dark:bg-[#2F2F2F] shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ pointerEvents: 'auto' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-3 p-3 overflow-y-auto scroll-container max-h-[24rem]">
            {/* Effort Level (for models that support it) */}
            {(reasoningMethod === 'effort' || reasoningMethod === 'both') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('reasoningEffort'))}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => handleEffortChange(level)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg transition-colors",
                        reasoningConfig.effort === level
                          ? "bg-orange-600 text-white dark:bg-orange-500"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      )}
                    >
                      {String(t(level as 'low' | 'medium' | 'high'))}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Max Tokens (for models that support it) */}
            {(reasoningMethod === 'max_tokens' || reasoningMethod === 'both') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {String(t('maxReasoningTokens'))}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1000}
                    max={32000}
                    step={1000}
                    value={reasoningConfig.maxOutputTokens}
                    onChange={(e) => handleMaxTokensChange(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[3rem]">
                    {reasoningConfig.maxOutputTokens?.toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Exclude Reasoning Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {String(t('hideReasoning'))}
              </label>
              <button
                type="button"
                onClick={handleExcludeToggle}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  reasoningConfig.exclude
                    ? "bg-orange-600 dark:bg-orange-500"
                    : "bg-gray-200 dark:bg-gray-700"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    reasoningConfig.exclude ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {/* Model Info */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {activeModel?.displayName || currentModel}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {String(t('reasoningMethod'))}: {reasoningMethod}
                  </p>
                </div>
                <Brain className="h-4 w-4 text-orange-500 dark:text-orange-400 opacity-50" />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
