'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useConnectionState,
    useTracks,
} from '@livekit/components-react';
import { ConnectionState, Track, RoomEvent, DisconnectReason } from 'livekit-client';
import '@livekit/components-styles';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// Dynamically import OglOrb to avoid SSR issues
const OglOrb = dynamic(() => import('./ogl-orb'), { ssr: false });
import { useVoiceStore } from '@/lib/stores/voice-store';

interface VoiceModeOverlayProps {
    isActive: boolean;
    onEnd?: () => void;
}

/**
 * Voice Mode Overlay with LiveKit Integration
 * Displays the OGL orb with live audio amplitude from the voice agent
 */
export default function VoiceModeOverlay({ isActive, onEnd }: VoiceModeOverlayProps) {
    const [token, setToken] = useState<string>('');
    const [serverUrl, setServerUrl] = useState<string>('');
    const [isConnecting, setIsConnecting] = useState(false);
    const [amplitude, setAmplitude] = useState(0);

    // Debugging states
    const [error, setError] = useState<Error | null>(null);
    const [disconnectReason, setDisconnectReason] = useState<DisconnectReason | undefined>(undefined);

    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animationFrameRef = useRef<number>(0);

    // Ensure AudioContext is resumed before connecting
    const ensureAudioContext = useCallback(() => {
        try {
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            audioContextRef.current = ctx;
        } catch (e) {
            console.warn('[VoiceModeOverlay] Could not initialize AudioContext:', e);
        }
    }, []);

    // Reset error state when activating
    useEffect(() => {
        if (isActive) {
            setError(null);
            setDisconnectReason(undefined);
        }
    }, [isActive]);

    // Fetch LiveKit token when activated
    useEffect(() => {
        if (!isActive) {
            setToken('');
            setServerUrl('');
            return;
        }

        const fetchToken = async () => {
            try {
                setIsConnecting(true);
                ensureAudioContext();

                let userId = 'anon';
                try {
                    const { createClient } = await import('@/lib/supabase/client');
                    const supabase = createClient();
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session?.user?.id) {
                        userId = session.user.id;
                    }
                } catch (err) {
                    console.error('[VoiceModeOverlay] Error fetching session:', err);
                }

                const identity = `user-${userId}-${Math.floor(Math.random() * 1000)}`;
                const resp = await fetch(`/api/livekit/token?room=chatrag-voice&username=${identity}`);
                const data = await resp.json();

                if (data.error) {
                    console.error('[VoiceModeOverlay] Failed to get token:', data.error);
                    return;
                }

                setToken(data.token);
                setServerUrl(data.serverUrl);
            } catch (e) {
                console.error('[VoiceModeOverlay] Token fetch error:', e);
            } finally {
                setIsConnecting(false);
            }
        };

        fetchToken();

        return () => {
            // Cleanup on unmount
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isActive, ensureAudioContext]);

    // Calculate orb size based on window - smaller on mobile to fit above input bar
    const orbSize = typeof window !== 'undefined'
        ? Math.min(300, window.innerWidth * 0.35, window.innerHeight * 0.25)
        : 300;

    if (!isActive) return null;

    if (error || disconnectReason !== undefined) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
                <div className="bg-card border border-destructive/50 shadow-lg rounded-xl p-6 max-w-sm w-full space-y-4">
                    <div className="flex items-center gap-2 text-destructive">
                        <Loader2 className="h-5 w-5" />
                        <h3 className="font-semibold">Connection Failed</h3>
                    </div>
                    <div className="text-sm text-foreground/80 space-y-2">
                        {error && <p><strong>Error:</strong> {error.message}</p>}
                        {disconnectReason !== undefined && (
                            <p><strong>Disconnect Reason:</strong> {DisconnectReason[disconnectReason] || disconnectReason}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                            Please check your connection and try again.
                        </p>
                    </div>
                    <button
                        onClick={() => onEnd?.()}
                        className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    if (isConnecting || !token) {
        return (
            <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center pb-[140px] md:pb-[120px]">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Connecting to voice agent...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-[-1] pointer-events-none">
            <LiveKitRoom
                video={false}
                audio={true}
                token={token}
                serverUrl={serverUrl}
                onDisconnected={(reason) => {
                    console.log('[VoiceModeOverlay] Disconnected from LiveKit', reason);
                    if (reason === DisconnectReason.CLIENT_INITIATED) {
                        onEnd?.();
                    } else {
                        setDisconnectReason(reason);
                    }
                }}
                onError={(err) => {
                    console.error('[VoiceModeOverlay] LiveKit Error:', err);
                    setError(err);
                }}
                data-lk-theme="default"
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent'
                }}
            >
                <VoiceOrbWithTracks amplitude={amplitude} setAmplitude={setAmplitude} orbSize={orbSize} />
                <RoomAudioRenderer />
            </LiveKitRoom>
        </div>
    );
}

// ... imports
import { useRoomContext } from '@livekit/components-react';

// ... VoiceModeOverlay component remains largely same, just wrapping VoiceOrbWithTracks

// Transcript Overlay Component
import { IconOpenAI } from '@/components/ui/icons';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { WordTiming, VoiceSourceImage } from '@/lib/stores/voice-store';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * WordSyncTypewriter - Reveals text word-by-word synchronized with TTS audio.
 * Uses word timing data from Resemble.ai for precise sync.
 * Falls back to character-based typewriter when timings unavailable.
 * 
 * When isPartial is true with no wordTimings, shows a loading indicator
 * to prevent showing text that will be replaced by word-synced animation.
 */
function WordSyncTypewriter({
    text,
    wordTimings,
    durationMs,
    isPartial,
    onContentUpdate
}: {
    text: string;
    wordTimings?: WordTiming[];
    durationMs?: number;
    isPartial?: boolean;
    onContentUpdate?: () => void;
}) {
    const [displayedText, setDisplayedText] = useState('');
    const animationRef = useRef<number>(0);
    const textRef = useRef(text);
    const startTimeRef = useRef<number | null>(null);

    // Track text changes
    useEffect(() => {
        textRef.current = text;
    }, [text]);

    // Reset on complete text change (new message)
    useEffect(() => {
        if (text.length === 0) {
            setDisplayedText('');
        }
    }, [text]);

    useEffect(() => {
        // Cancel any existing animation
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }

        // If this is a partial message waiting for word timings, show bouncing dots
        // This matches the thinking indicator in the main chat
        if (isPartial && (!wordTimings || wordTimings.length === 0)) {
            // Show bouncing dots via separate render path
            return;
        }

        // If we have word timings, use word-level sync (regardless of isPartial)
        if (wordTimings && wordTimings.length > 0) {
            console.log(`[WordSync] Starting animation: ${wordTimings.length} words, isPartial: ${isPartial}`);

            if (startTimeRef.current === null) {
                startTimeRef.current = performance.now();
            }

            const animationStartTime = startTimeRef.current;
            const lastWord = wordTimings[wordTimings.length - 1];
            const totalDurationSec = lastWord.end;

            const animateWords = () => {
                const elapsed = performance.now() - animationStartTime;
                const elapsedSec = elapsed / 1000;

                // Find words that should be visible
                let visibleText = '';

                for (let i = 0; i < wordTimings.length; i++) {
                    const { word, end } = wordTimings[i];

                    if (elapsedSec >= end) {
                        visibleText += word + ' ';
                    } else {
                        break;
                    }
                }

                const trimmed = visibleText.trimEnd();

                // No cursor - just show text
                if (elapsedSec < totalDurationSec) {
                    setDisplayedText(trimmed);
                    onContentUpdate?.();
                    animationRef.current = requestAnimationFrame(animateWords);
                } else {
                    // Animation complete - show all words from timings (no markdown shift)
                    const allWords = wordTimings.map(wt => wt.word).join(' ');
                    setDisplayedText(allWords);
                    onContentUpdate?.();
                    console.log('[WordSync] Animation complete');
                }
            };

            animationRef.current = requestAnimationFrame(animateWords);

            return () => {
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                }
            };
        }

        // Final message without word timings (e.g., greetings) - use character typewriter
        if (!isPartial && text) {
            const speed = durationMs && text.length > 0
                ? Math.max(30, Math.min(100, durationMs / text.length))
                : 50;

            let index = 0;
            const interval = setInterval(() => {
                const currentText = textRef.current;
                if (index < currentText.length) {
                    index++;
                    // No cursor - just show text
                    setDisplayedText(currentText.slice(0, index));
                    onContentUpdate?.();
                } else if (index === currentText.length && currentText.length > 0) {
                    setDisplayedText(currentText);
                    onContentUpdate?.();
                    clearInterval(interval);
                }
            }, speed);

            return () => clearInterval(interval);
        }
    }, [wordTimings, durationMs, text, isPartial]);

    // Show bouncing dots for partial messages until text AND word timings are available
    if (isPartial && (!text || !wordTimings || wordTimings.length === 0)) {
        return (
            <div className="flex items-center gap-1.5 py-2 pl-0.5">
                <div className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-[bounce_0.6s_infinite]" />
                <div className="h-2 w-2 rounded-full bg-yellow-500 dark:bg-yellow-400 animate-[bounce_0.6s_infinite_0.2s]" />
                <div className="h-2 w-2 rounded-full bg-orange-500 dark:bg-orange-400 animate-[bounce_0.6s_infinite_0.4s]" />
            </div>
        );
    }

    if (!text) return null;

    // Don't render anything if no displayedText yet (waiting for word timings)
    if (!displayedText) return null;

    return (
        <Markdown className="prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 break-words dark:prose-p:text-foreground/90 prose-p:text-foreground prose-headings:text-foreground prose-li:text-foreground prose-strong:text-foreground text-foreground [&>ul]:text-foreground [&>ol]:text-foreground">
            {displayedText}
        </Markdown>
    );
}

// Voice Source Images Display - Shows images retrieved from Image RAG
function VoiceSourceImages({ images }: { images: VoiceSourceImage[] }) {
    if (!images || images.length === 0) return null;

    // Detect if an image is a person/creator image (should be displayed larger)
    const isPersonImage = (img: VoiceSourceImage) => {
        const searchText = `${img.url} ${img.name}`.toLowerCase();
        const personKeywords = ['carlos', 'marcial', 'creator', 'founder', 'author', 'portrait', 'headshot'];
        return personKeywords.some(keyword => searchText.includes(keyword));
    };

    return (
        <div className="flex flex-wrap gap-2 mb-3 items-start">
            {images.map((img, i) => {
                const isPerson = isPersonImage(img);
                return (
                    <div
                        key={`${img.url}-${i}`}
                        className={cn(
                            "relative rounded-lg overflow-hidden border border-border/50 shadow-sm bg-muted/50",
                            isPerson
                                ? "w-48 h-48 sm:w-64 sm:h-64" // Larger for person/creator images
                                : "w-24 h-24 sm:w-32 sm:h-32"  // Standard size for logos/other images
                        )}
                    >
                        <img
                            src={img.url}
                            alt={img.name}
                            className="w-full h-full object-cover"
                            loading="eager"
                        />
                    </div>
                );
            })}
        </div>
    );
}

// Floating images for orb-only mode (no text transcription)
function OrbModeImages() {
    const { transcripts } = useVoiceStore();

    // Get images from the latest assistant message
    const latestAssistant = [...transcripts].reverse().find(t => t.role === 'assistant');
    const images = latestAssistant?.source_images || [];

    if (images.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.3 }}
                className="absolute bottom-32 left-1/2 -translate-x-1/2 flex gap-3 z-20"
            >
                {images.slice(0, 3).map((img, i) => (
                    <motion.div
                        key={`orb-img-${img.url}-${i}`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.1 }}
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl backdrop-blur-sm"
                    >
                        <img
                            src={img.url}
                            alt={img.name}
                            className="w-full h-full object-cover"
                        />
                    </motion.div>
                ))}
            </motion.div>
        </AnimatePresence>
    );
}

// Transcript Overlay Component
function VoiceChatOverlay({ displayMode }: { displayMode: string }) {
    const { transcripts } = useVoiceStore();
    const scrollRef = useRef<HTMLDivElement>(null);

    // SSR-safe mobile detection using mounted pattern
    const [mounted, setMounted] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        setMounted(true);
        const checkMobile = () => setIsMobile(window.innerWidth < 640);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Auto-scroll to bottom
    const scrollToBottom = useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [transcripts, scrollToBottom]);

    // On desktop, hide text in 'orb' mode. On mobile (once mounted), always show text.
    // Before mounted, render nothing to avoid hydration mismatch
    if (!mounted) return null;
    if (displayMode === 'orb' && !isMobile) return null;

    // Use inline styles to ensure we break out of the parent container while respecting stacking context
    // Desktop: use fixed positioning to cover full viewport
    // Mobile: use absolute positioning with bottom anchor (existing behavior)
    return (
        <div
            style={{
                position: isMobile ? 'absolute' : 'fixed',
                left: isMobile ? '50%' : 0,
                top: isMobile ? undefined : 0,
                bottom: isMobile ? 0 : undefined,
                right: isMobile ? undefined : 0,
                transform: isMobile ? 'translateX(-50%)' : undefined,
                width: isMobile ? '100vw' : '100%',
                height: '100dvh',
                zIndex: -1, // Behind the form
                pointerEvents: 'auto',
                overflow: 'hidden' // Ensure no scrollbars on body
            }}
            className={cn(
                "w-full pointer-events-auto",
                isMobile ? "absolute inset-x-0 h-[100dvh]" : "fixed inset-0"
            )}
        >
            {/* Inner scroll container */}
            <div
                ref={scrollRef}
                className="w-full h-full overflow-y-auto no-scrollbar"
            >
                <div className={cn(
                    "mx-auto w-full max-w-3xl flex flex-col gap-4 min-h-full justify-center px-6",
                    isMobile ? "pt-16 pb-[450px]" : "pt-24 pb-[50vh]"
                )}>
                    {transcripts.map((msg, i) => {
                        const isLastAI = msg.role === 'assistant' && i === transcripts.length - 1;
                        return (
                            <div
                                key={msg.id || i}
                                className={cn(
                                    "flex w-full gap-4",
                                    msg.role === 'user' ? "justify-end" : "justify-start"
                                )}
                            >
                                {msg.role === 'assistant' && (
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-background/80 flex items-center justify-center border border-border/50 shadow-sm">
                                        <IconOpenAI className="w-5 h-5" />
                                    </div>
                                )}

                                <div className={cn(
                                    "flex flex-col",
                                    msg.role === 'user' ? "items-end" : "flex-1" // User: right-align, AI: expand
                                )}>
                                    {/* Source Images above assistant text */}
                                    {msg.role === 'assistant' && msg.source_images && msg.source_images.length > 0 && (
                                        <VoiceSourceImages images={msg.source_images} />
                                    )}

                                    <div
                                        className={cn(
                                            "rounded-2xl px-5 py-3 text-sm md:text-base",
                                            msg.role === 'user'
                                                ? "bg-[#EFE1D5] dark:bg-secondary/80 text-secondary-foreground backdrop-blur-md shadow-sm"
                                                : "max-w-[85%] bg-transparent p-0 shadow-none pt-1" // AI: Transparent, no shadow, added top padding for alignment
                                        )}
                                    >
                                        {msg.role === 'user' ? (
                                            <div className="font-medium whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</div>
                                        ) : (
                                            // Use WordSyncTypewriter for the active AI message to sync with voice
                                            isLastAI ? (
                                                <WordSyncTypewriter
                                                    text={msg.text}
                                                    wordTimings={msg.wordTimings}
                                                    durationMs={msg.audioDurationMs}
                                                    isPartial={msg.isPartial}
                                                    onContentUpdate={scrollToBottom}
                                                />
                                            ) : (
                                                // Previous AI messages: show plain text (no markdown) to avoid jarring format shift
                                                <div className="prose dark:prose-invert prose-p:leading-relaxed break-words dark:prose-p:text-foreground/90 prose-p:text-foreground text-foreground whitespace-pre-wrap">
                                                    {msg.wordTimings && msg.wordTimings.length > 0
                                                        ? msg.wordTimings.map(wt => wt.word).join(' ')
                                                        : msg.text}
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function VoiceOrbWithTracks({
    amplitude,
    setAmplitude,
    orbSize
}: {
    amplitude: number;
    setAmplitude: React.Dispatch<React.SetStateAction<number>>;
    orbSize: number;
}) {
    const connectionState = useConnectionState();
    const room = useRoomContext();
    const { addTranscript, updateTranscriptById, clearTranscripts, transcripts } = useVoiceStore();

    // Responsive detection for mobile orb positioning
    const [orbYOffset, setOrbYOffset] = useState(0);
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth < 640;
        }
        return false;
    });

    useEffect(() => {
        const updateOffset = () => {
            const width = window.innerWidth;
            const mobile = width < 640;
            setIsMobile(mobile);

            if (mobile) {
                // Mobile: shift orb up (58% of viewport height) for upper positioning
                // Uses absolute positioning within parent container
                setOrbYOffset(-window.innerHeight * 0.58);
            } else {
                // Desktop/tablet: use fixed positioning (handled in JSX)
                // No offset needed since fixed centers in viewport
                setOrbYOffset(0);
            }
        };

        updateOffset();
        window.addEventListener('resize', updateOffset);
        return () => window.removeEventListener('resize', updateOffset);
    }, []);

    // Get ALL microphone tracks (local and remote)
    const tracks = useTracks([Track.Source.Microphone]);

    // Find the AGENT'S track (remote user) - Ensure we target the voice agent specifically
    const agentTrack = tracks.find(t => !t.participant.isLocal && t.participant.identity.startsWith('voice-agent'));

    // Determine Display Mode (Reactive)
    const [displayMode, setDisplayMode] = useState<string | null>(null);

    useEffect(() => {
        if (!room) return;

        const updateFromParticipant = (p: any) => {
            if (p.identity.startsWith('voice-agent') && p.attributes) {
                const mode = p.attributes.displayMode;
                if (mode) {
                    console.log(`[VoiceOverlay] Found attributes for ${p.identity}:`, p.attributes);
                    setDisplayMode(mode);
                }
            }
        };

        const onAttributesChanged = (changed: Record<string, string>, p: any) => {
            updateFromParticipant(p);
        };

        const onParticipantConnected = (p: any) => {
            updateFromParticipant(p);
        };

        room.on(RoomEvent.ParticipantAttributesChanged, onAttributesChanged);
        room.on(RoomEvent.ParticipantConnected, onParticipantConnected);

        // Check existing participants
        for (const p of room.remoteParticipants.values()) {
            updateFromParticipant(p);
        }

        // Also check via direct track reference if available (Backup + Polling)
        const interval = setInterval(() => {
            if (agentTrack?.participant?.attributes?.displayMode) {
                const mode = agentTrack.participant.attributes.displayMode;
                if (mode !== displayMode) {
                    console.log(`[VoiceOverlay] Polling found new mode: ${mode}`);
                    setDisplayMode(mode);
                }
            }
        }, 1000);

        return () => {
            clearInterval(interval);
            room.off(RoomEvent.ParticipantAttributesChanged, onAttributesChanged);
            room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
        };
    }, [room, agentTrack?.participant?.attributes?.displayMode, displayMode]);

    // Handle Data Messages (Transcripts)
    useEffect(() => {
        if (!room) return;

        const handleData = (payload: Uint8Array, participant?: any) => {
            try {
                const decoder = new TextDecoder();
                const str = decoder.decode(payload);
                const data = JSON.parse(str);

                console.log('[VoiceOverlay] Received data message:', data);

                if (data.type === 'config') {
                    if (data.displayMode) {
                        console.log(`[VoiceOverlay] Updating display mode from config message: ${data.displayMode}`);
                        setDisplayMode(data.displayMode);
                    }
                } else if (data.type === 'transcription') {
                    // Log image data if present
                    if (data.source_images?.length > 0) {
                        console.log(`[VoiceOverlay] 🖼️ Transcript includes ${data.source_images.length} source images`);
                    }

                    if (data.isPartial) {
                        // Update existing message by ID or add if new - mark as partial
                        if (transcripts.some(t => t.id === data.id)) {
                            updateTranscriptById(data.id, data.text, data.audioDurationMs, data.wordTimings, true, data.source_images);
                        } else {
                            addTranscript({ ...data, isPartial: true, source_images: data.source_images });
                        }
                    } else {
                        // Final message - includes audioDurationMs and wordTimings for sync
                        console.log(`[VoiceOverlay] Final transcript with ${data.wordTimings?.length || 0} word timings`);
                        if (transcripts.some(t => t.id === data.id)) {
                            updateTranscriptById(data.id, data.text, data.audioDurationMs, data.wordTimings, false, data.source_images);
                        } else {
                            addTranscript({ ...data, isPartial: false, source_images: data.source_images });
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to parse data message', e);
            }
        };

        room.on(RoomEvent.DataReceived, handleData);
        return () => {
            room.off(RoomEvent.DataReceived, handleData);
        };
    }, [room, addTranscript, updateTranscriptById, transcripts]);

    // Clear transcripts on connect/disconnect
    useEffect(() => {
        if (connectionState === ConnectionState.Connected) {
            clearTranscripts();
        }
    }, [connectionState, clearTranscripts]);

    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animationFrameRef = useRef<number>(0);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // Initialize and Connect Audio
    useEffect(() => {
        if (!agentTrack?.publication?.track?.mediaStreamTrack) {
            return;
        }

        const setupAudio = async () => {
            try {
                // Ensure context exists and is running
                if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }

                const ctx = audioContextRef.current;

                // Cleanup old source
                if (sourceRef.current) {
                    sourceRef.current.disconnect();
                }

                // Resume if suspended (common browser policy)
                if (ctx.state === 'suspended') {
                    await ctx.resume();
                    console.log('[VoiceModeOverlay] AudioContext resumed');
                }

                const mediaStreamTrack = agentTrack.publication!.track!.mediaStreamTrack;
                const mediaStream = new MediaStream([mediaStreamTrack]);

                // Double check state before creation to avoid "construction not useful" error
                if (ctx.state === 'closed') {
                    console.warn('[VoiceModeOverlay] Context unexpectedly closed, recreating...');
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }

                if (!analyserRef.current) {
                    analyserRef.current = audioContextRef.current.createAnalyser();
                    analyserRef.current.fftSize = 256;
                    // Very low smoothing for maximum bounce/variation
                    analyserRef.current.smoothingTimeConstant = 0.1;
                }

                const source = audioContextRef.current.createMediaStreamSource(mediaStream);
                source.connect(analyserRef.current);
                sourceRef.current = source;
                console.log('[VoiceModeOverlay] Connected agent audio source');

            } catch (e) {
                console.error('[VoiceModeOverlay] Audio setup failed:', e);
            }
        };

        setupAudio();

        // Cleanup function for this effect
        return () => {
            // We generally DON'T want to close the context on every dep change,
            // only disconnect the specific source. 
            // Closing the context here was likely causing the race condition.
            if (sourceRef.current) {
                sourceRef.current.disconnect();
            }
        };

    }, [agentTrack?.publication?.track?.mediaStreamTrack]);

    // Cleanup context only on full unmount
    useEffect(() => {
        return () => {
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(console.error);
            }
        };
    }, []);

    // Analyze audio from tracks AND check attributes
    useEffect(() => {
        if (!agentTrack) {
            console.log('[VoiceModeOverlay] Waiting for agent track...');
        } else {
            const p = agentTrack.participant;
            console.log('[VoiceModeOverlay] Agent track found:', p.identity);
            console.log('[VoiceModeOverlay] Agent attributes:', JSON.stringify(p.attributes));

            if (p.attributes?.displayMode) {
                const mode = p.attributes.displayMode;
                console.log(`[VoiceModeOverlay] Setting display mode from track to: ${mode}`);
                setDisplayMode(mode);
            }
        }
    }, [agentTrack]);

    // Local Audio Analysis for UI Waveform
    const localTrack = tracks.find(t => t.participant.isLocal);
    const { setUserAmplitude } = useVoiceStore();
    const localAnalyserRef = useRef<AnalyserNode | null>(null);
    const localSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    useEffect(() => {
        if (!localTrack?.publication?.track?.mediaStreamTrack) return;

        const setupLocalAudio = () => {
            // Re-use the existing context if possible, or use the one created for agent
            // But for safety against race conditions with the agent setup which might recreate context,
            // let's rely on the main audioContextRef created in the agent setup, OR create a safe one.
            // Actually, it's safer to just peek at the track directly regardless of the agent context.
            // We can create a new context for local analysis to be completely independent?
            // No, browser might limit contexts.
            // Let's loop into the main animate function instead of a separate setup if possible.

            // Simple independent setup for local track:
            try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const source = ctx.createMediaStreamSource(new MediaStream([localTrack.publication!.track!.mediaStreamTrack]));
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 64; // Low res for simple UI
                analyser.smoothingTimeConstant = 0.5;
                source.connect(analyser);

                localAnalyserRef.current = analyser;
                localSourceRef.current = source;

                // Cleanup context on unmount of this effect
                return () => {
                    source.disconnect();
                    if (ctx.state !== 'closed') ctx.close();
                };
            } catch (e) {
                console.error('Failed to setup local audio analysis', e);
            }
        };

        const cleanup = setupLocalAudio();
        return cleanup;
    }, [localTrack]);


    // Analyze audio for amplitude
    useEffect(() => {
        const animate = () => {
            if (connectionState !== ConnectionState.Connected) {
                // Pulse when connecting/idle
                const time = Date.now() / 1000;
                setAmplitude(0.1 + Math.sin(time * 3) * 0.05);
                animationFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            if (analyserRef.current) {
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);

                // Calculate average volume with boost
                let sum = 0;
                // Focus on lower frequencies where voice usually is (first half of bins)
                const binCount = dataArray.length / 2;
                for (let i = 0; i < binCount; i++) {
                    sum += dataArray[i];
                }
                const average = sum / binCount;

                // Dynamic sensitivity: Boost low signals heavily
                // Cranked up to 5.0 for maximum reactivity
                let volume = (average / 128) * 5.0;
                volume = Math.min(1.0, Math.max(0.0, volume));

                // Add some noise floor gating
                if (volume < 0.05) volume = 0;

                // Smooth transition
                setAmplitude(prev => {
                    const diff = volume - prev;
                    // Super snappy response
                    // Attack 0.9 (Instant pop)
                    // Release 0.4 (Fast drop to allow bouncing between words)
                    const smoothing = diff > 0 ? 0.9 : 0.4;
                    return prev + diff * smoothing;
                });
            } else {
                setAmplitude(0.1);
            }

            // Update Local User Amplitude
            if (localAnalyserRef.current) {
                const data = new Uint8Array(localAnalyserRef.current.frequencyBinCount);
                localAnalyserRef.current.getByteFrequencyData(data);

                let sum = 0;
                for (let i = 0; i < data.length; i++) sum += data[i];
                const avg = sum / data.length;

                // Boost local mic a bit
                const norm = Math.min(1, (avg / 128) * 3.0);
                setUserAmplitude(norm);
            }

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [connectionState, setAmplitude, agentTrack, setUserAmplitude]);

    const showOrb = displayMode === 'orb' || displayMode === 'orb_text';
    const orbOpacity = displayMode === 'orb_text' ? 0.6 : 0.8;

    return (
        <div className="absolute inset-0 pointer-events-none">

            {/* Layer 1: The Orb - FIXED for desktop (viewport center), ABSOLUTE for mobile */}
            <div
                className={cn(
                    "z-0 flex items-center justify-center pointer-events-none",
                    isMobile ? "absolute inset-0" : "fixed inset-0"
                )}
                style={{ transform: isMobile ? `translateY(${orbYOffset}px)` : 'translateY(-8vh)' }}
            >
                {showOrb && (
                    <OglOrb
                        amplitude={amplitude}
                        isActive={connectionState === ConnectionState.Connected}
                        opacity={orbOpacity}
                        size={orbSize}
                    />
                )}
            </div>

            {/* Layer 2: Floating images for orb-only mode - FIXED for desktop */}
            {displayMode === 'orb' && (
                <div
                    className={cn(
                        "z-0 flex items-center justify-center pointer-events-none",
                        isMobile ? "absolute inset-0" : "fixed inset-0"
                    )}
                    style={{ transform: isMobile ? `translateY(${orbYOffset}px)` : 'translateY(-8vh)' }}
                >
                    <OrbModeImages />
                </div>
            )}

            {/* Layer 3: Text Overlay (Foreground, Scrollable) */}
            {/* Always render - component handles its own visibility internally */}
            <VoiceChatOverlay displayMode={displayMode || 'orb_text'} />

            {/* Layer 4: Status Indicator */}
            {connectionState !== ConnectionState.Connected && (
                <div
                    className={cn(
                        "z-20 flex items-center justify-center pointer-events-none",
                        isMobile ? "absolute inset-0" : "fixed inset-0"
                    )}
                    style={isMobile ? { transform: `translateY(${orbYOffset}px)` } : undefined}
                >
                    <div className="flex items-center gap-2 text-muted-foreground/60">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                        <span className="text-sm">Connecting...</span>
                    </div>
                </div>
            )}
        </div>
    );
}
