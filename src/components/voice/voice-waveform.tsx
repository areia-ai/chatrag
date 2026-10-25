'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface VoiceWaveformProps {
    /** Audio amplitude value from 0 to 1 */
    amplitude?: number;
    /** Whether the waveform is active */
    isActive?: boolean;
    /** Number of bars/dots */
    barCount?: number;
    /** Size of each bar in pixels */
    barSize?: number;
    /** Gap between bars */
    gap?: number;
    /** Color of the bars */
    color?: string;
    /** Additional class name */
    className?: string;
}

/**
 * Voice Waveform - Animated dots that react to audio amplitude
 * Used in the "End" button to show voice activity
 */
export default function VoiceWaveform({
    amplitude = 0,
    isActive = true,
    barCount = 4,
    barSize = 4,
    gap = 3,
    color = 'currentColor',
    className,
}: VoiceWaveformProps) {
    const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

    // Animate bars based on amplitude
    useEffect(() => {
        if (!isActive) return;

        barsRef.current.forEach((bar, index) => {
            if (!bar) return;

            // Create offset for each bar to create wave effect
            const offset = index / barCount;
            const time = performance.now() / 300;

            // Base animation + audio-reactive boost
            const baseScale = 0.3 + Math.sin(time + offset * Math.PI * 2) * 0.2;
            const audioBoost = amplitude * 0.8;
            const scale = Math.min(1, baseScale + audioBoost);

            bar.style.transform = `scaleY(${scale})`;
        });
    }, [amplitude, isActive, barCount]);

    // CSS animation fallback when no amplitude data
    useEffect(() => {
        if (!isActive) return;

        let animationFrame: number;

        const animate = () => {
            barsRef.current.forEach((bar, index) => {
                if (!bar) return;

                const time = performance.now() / 300;
                const offset = index / barCount;

                // Gentle wave animation when no audio
                const scale = 0.4 + Math.sin(time + offset * Math.PI) * 0.3;

                // Only apply if amplitude is very low (no audio)
                if (amplitude < 0.05) {
                    bar.style.transform = `scaleY(${scale})`;
                }
            });

            animationFrame = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [isActive, barCount, amplitude]);

    if (!isActive) return null;

    return (
        <div
            className={cn("flex items-center justify-center", className)}
            style={{ gap }}
        >
            {Array.from({ length: barCount }).map((_, index) => (
                <span
                    key={index}
                    ref={el => { barsRef.current[index] = el; }}
                    className="transition-transform duration-75"
                    style={{
                        width: barSize,
                        height: barSize * 3,
                        backgroundColor: color,
                        borderRadius: barSize / 2,
                        transform: 'scaleY(0.4)',
                    }}
                />
            ))}
        </div>
    );
}
