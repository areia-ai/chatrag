'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface VoiceBubbleProps {
    /** The transcription text */
    text: string;
    /** Whether this is a user message (right-aligned) or AI message (left-aligned) */
    isUser: boolean;
    /** Whether the text is still being streamed */
    isStreaming?: boolean;
    /** Timestamp of the message */
    timestamp?: Date;
    /** Additional class name */
    className?: string;
}

/**
 * Voice Bubble - Styled chat bubble for voice transcriptions
 * User messages appear right-aligned with italic/quoted style
 * AI messages appear left-aligned with regular style
 */
export default function VoiceBubble({
    text,
    isUser,
    isStreaming = false,
    timestamp,
    className,
}: VoiceBubbleProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
                "flex w-full",
                isUser ? "justify-end" : "justify-start",
                className
            )}
        >
            <div
                className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                    isUser ? [
                        // User bubble - right side, subtle background, italic quoted style
                        "bg-muted/60 text-foreground/90",
                        "italic",
                    ] : [
                        // AI bubble - left side, plain text
                        "bg-transparent text-foreground",
                    ]
                )}
            >
                {isUser ? (
                    // User messages appear as quoted transcription
                    <span className="text-foreground/80">"{text}"</span>
                ) : (
                    // AI messages appear as regular text
                    <span>
                        {text}
                        {isStreaming && (
                            <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/60 animate-pulse" />
                        )}
                    </span>
                )}

                {/* Optional timestamp */}
                {timestamp && (
                    <div className={cn(
                        "text-[10px] text-muted-foreground mt-1",
                        isUser ? "text-right" : "text-left"
                    )}>
                        {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
