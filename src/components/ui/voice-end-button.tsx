'use client';

import { useVoiceStore } from '@/lib/stores/voice-store';
import { cn } from '@/lib/utils';
import { AudioLines } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';

interface VoiceEndButtonProps {
    isActive: boolean;
    onClick: () => void;
    disabled?: boolean;
}

export function VoiceEndButton({ isActive, onClick, disabled }: VoiceEndButtonProps) {
    const { t } = useLanguage();
    const userAmplitude = useVoiceStore((state) => state.userAmplitude);

    // Helper to calculate dynamic bar height
    // Base height 4px, max additional height 12px based on amplitude
    // Different bars respond with different sensitivities/phases for organic look
    const getHeight = (index: number) => {
        if (!isActive) return '4px';

        // Non-linear response to make it more sensitive
        const amp = Math.pow(userAmplitude, 0.5); // Square root to boost low values

        // Random-ish multipliers for each bar
        const multipliers = [0.8, 1.2, 1.0, 0.9];
        const baseHeight = 4; // px
        const dynamicRange = 12; // px

        // Add a minimum movement so it looks alive even at low volume
        const value = Math.max(0.1, amp * multipliers[index % multipliers.length]);

        return `${baseHeight + value * dynamicRange}px`;
    };

    if (!isActive) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    "inline-flex w-9 h-9 items-center justify-center rounded-tl-xl rounded-tr-xl rounded-bl-xl rounded-br-3xl transition-all duration-200 group relative",
                    "bg-[#FF6417] hover:bg-[#E55000] dark:bg-[#E6E6E6] dark:hover:bg-[#D4D4D4]",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                disabled={disabled}
                aria-label={t('voiceModeUseVoiceMode')}
            >
                <AudioLines className="h-5 w-5 text-white dark:text-[#1A1A1A] transform -translate-x-[1px] -translate-y-[1px]" />

                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+4px)] px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap">
                    {t('voiceModeUseVoiceMode')}
                </div>
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex h-9 px-4 gap-2 items-center justify-center rounded-full transition-all duration-200",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            disabled={disabled}
            aria-label={t('voiceModeEnd')}
        >
            {/* Dynamic Waveform */}
            <div className="flex items-center gap-0.5 h-4 items-center" style={{ alignItems: 'center' }}>
                {[0, 1, 2, 3].map((i) => (
                    <span
                        key={i}
                        className="w-1 bg-current rounded-full transition-all duration-75 ease-out"
                        style={{
                            height: getHeight(i),
                            // No idle animation, just static minimum height
                            transition: 'height 0.075s ease-out'
                        }}
                    />
                ))}
            </div>
            <span className="text-sm font-medium">{t('voiceModeEnd')}</span>
        </button>
    );
}
