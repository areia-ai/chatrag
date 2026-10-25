'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useConnectionState,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import '@livekit/components-styles';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import OglOrb from './ogl-orb';
import { cn } from '@/lib/utils';

interface VoiceOrbOverlayProps {
    /** Whether voice mode is active */
    isActive: boolean;
    /** Audio amplitude for orb reaction */
    amplitude?: number;
    /** Additional class name */
    className?: string;
}

/**
 * Voice Orb Overlay - Renders the OGL orb in the center of the chat area
 * This is NOT a full-screen overlay - it's positioned within the existing UI
 */
export default function VoiceOrbOverlay({
    isActive,
    amplitude = 0,
    className,
}: VoiceOrbOverlayProps) {
    const [orbSize, setOrbSize] = useState(400);

    // Calculate orb size based on window size
    useEffect(() => {
        const updateSize = () => {
            const maxSize = Math.min(window.innerWidth * 0.6, window.innerHeight * 0.5, 500);
            setOrbSize(Math.max(300, maxSize));
        };

        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    if (!isActive) return null;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={cn(
                "absolute inset-0 flex items-center justify-center pointer-events-none z-10",
                className
            )}
        >
            <OglOrb
                amplitude={amplitude}
                isActive={true}
                opacity={0.4}
                size={orbSize}
            />

            {/* "Start talking" text overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xl font-medium text-foreground/70">
                    Start talking
                </p>
            </div>
        </motion.div>
    );
}
