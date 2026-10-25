'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useConnectionState,
    useDataChannel,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import '@livekit/components-styles';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import OglOrb from './ogl-orb';
import VoiceWaveform from './voice-waveform';
import VoiceBubble from './voice-bubble';
import { useVoiceMode, VoiceModePhase } from '@/lib/hooks/use-voice-mode';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';
import { useChatStore } from '@/lib/chat-store';

interface VoiceModeContainerProps {
    /** Whether voice mode is active */
    isActive: boolean;
    /** Callback when voice mode ends */
    onEnd: () => void;
    /** Callback when transcription is received */
    onTranscription?: (text: string, isUser: boolean) => void;
    /** Callback when voice chat is saved with the new chat ID */
    onVoiceChatSaved?: (chatId: string) => void;
    /** Additional class name */
    className?: string;
}

/**
 * Voice Mode Container - Main wrapper for the full-screen voice experience
 * Manages LiveKit connection, displays OGL orb, and shows transcription bubbles
 */
export default function VoiceModeContainer({
    isActive,
    onEnd,
    onTranscription,
    onVoiceChatSaved,
    className,
}: VoiceModeContainerProps) {
    const { t } = useLanguage();
    const { fetchChats, setCurrentChat } = useChatStore();
    const [token, setToken] = useState<string>('');
    const [serverUrl, setServerUrl] = useState<string>('');
    const [isConnecting, setIsConnecting] = useState(false);

    const {
        phase,
        amplitude,
        transcriptions,
        startVoiceMode,
        endVoiceMode,
        setPhase,
        addTranscription,
    } = useVoiceMode({
        onTranscription: (text, _, isUser) => {
            onTranscription?.(text, isUser);
        },
    });

    const transcriptionsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to latest transcription
    useEffect(() => {
        if (transcriptionsEndRef.current) {
            transcriptionsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcriptions]);

    // Ensure AudioContext is resumed before connecting
    const ensureAudioContext = useCallback(() => {
        try {
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    console.log('[VoiceModeContainer] AudioContext resumed');
                });
            }
        } catch (e) {
            console.warn('[VoiceModeContainer] Could not initialize AudioContext:', e);
        }
    }, []);

    // Fetch LiveKit token when voice mode becomes active
    useEffect(() => {
        if (!isActive) {
            setToken('');
            setServerUrl('');
            endVoiceMode();
            return;
        }

        const fetchToken = async () => {
            try {
                setIsConnecting(true);
                ensureAudioContext();
                await startVoiceMode();

                // Get Auth Session for User ID
                let userId = 'anon';
                try {
                    const { createClient } = await import('@/lib/supabase/client');
                    const supabase = createClient();
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session?.user?.id) {
                        userId = session.user.id;
                        console.log('[VoiceModeContainer] Authenticated as user:', userId);
                    }
                } catch (err) {
                    console.error('[VoiceModeContainer] Error fetching session:', err);
                }

                const identity = `user-${userId}-${Math.floor(Math.random() * 1000)}`;
                const resp = await fetch(`/api/livekit/token?room=chatrag-voice&username=${identity}`);
                const data = await resp.json();

                if (data.error) {
                    console.error('Failed to get token:', data.error);
                    onEnd();
                    return;
                }

                setToken(data.token);
                setServerUrl(data.serverUrl);
                setPhase('waiting');
            } catch (e) {
                console.error('[VoiceModeContainer] Error:', e);
                onEnd();
            } finally {
                setIsConnecting(false);
            }
        };

        fetchToken();
    }, [isActive, onEnd, ensureAudioContext, startVoiceMode, endVoiceMode, setPhase]);

    // Handle end button click - schedules chat refresh before unmounting
    const handleEnd = useCallback(() => {
        endVoiceMode();

        // Schedule the refresh BEFORE calling onEnd (which unmounts this component)
        // Using a closure that captures fetchChats and setCurrentChat
        const refreshChats = async () => {
            console.log('[VoiceModeContainer] Refreshing chats after voice session...');
            try {
                const chats = await fetchChats();

                // Find the most recently created chat (likely our voice chat)
                if (chats && chats.length > 0) {
                    // Chats are ordered by created_at descending, first one is newest
                    const newestChat = chats[0];
                    const chatAge = Date.now() - new Date(newestChat.created_at).getTime();

                    // If the newest chat was created within the last 10 seconds, it's likely our voice chat
                    if (chatAge < 10000) {
                        console.log('[VoiceModeContainer] Setting current chat to voice chat:', newestChat.id);
                        setCurrentChat(newestChat.id);
                        onVoiceChatSaved?.(newestChat.id);
                    }
                }
            } catch (error) {
                console.error('[VoiceModeContainer] Error refreshing chats:', error);
            }
        };

        // Use window.setTimeout to ensure it survives component unmount
        // 2s delay to allow voice agent to fully save conversation
        window.setTimeout(refreshChats, 2000);

        // Now close the voice mode UI
        onEnd();
    }, [endVoiceMode, onEnd, fetchChats, setCurrentChat, onVoiceChatSaved]);

    if (!isActive) return null;

    // Loading state while connecting
    if (isConnecting || !token) {
        return (
            <div className={cn(
                "fixed inset-0 z-50 bg-background flex items-center justify-center",
                className
            )}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4"
                >
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-muted-foreground">
                        {t('voiceModeConnecting') || 'Connecting...'}
                    </p>
                </motion.div>
            </div>
        );
    }

    return (
        <div className={cn(
            "fixed inset-0 z-50 bg-background",
            className
        )}>
            <LiveKitRoom
                video={false}
                audio={true}
                token={token}
                serverUrl={serverUrl}
                onDisconnected={handleEnd}
                data-lk-theme="default"
                className="h-full w-full"
            >
                <VoiceModeContent
                    phase={phase}
                    amplitude={amplitude}
                    transcriptions={transcriptions}
                    onEnd={handleEnd}
                    setPhase={setPhase}
                    addTranscription={addTranscription}
                />
                <RoomAudioRenderer />
            </LiveKitRoom>
        </div>
    );
}

// Inner component that has access to LiveKit hooks
interface VoiceModeContentProps {
    phase: VoiceModePhase;
    amplitude: number;
    transcriptions: Array<{ id: string; text: string; isUser: boolean; timestamp: Date }>;
    onEnd: () => void;
    setPhase: (phase: VoiceModePhase) => void;
    addTranscription: (text: string, isUser: boolean) => void;
}

function VoiceModeContent({
    phase,
    amplitude,
    transcriptions,
    onEnd,
    setPhase,
    addTranscription,
}: VoiceModeContentProps) {
    const { t } = useLanguage();
    const connectionState = useConnectionState();
    const transcriptionsEndRef = useRef<HTMLDivElement>(null);

    // Listen for transcription data from voice-agent
    useDataChannel('transcription', (message) => {
        try {
            const data = JSON.parse(new TextDecoder().decode(message.payload));
            if (data.text && data.isFinal) {
                addTranscription(data.text, data.isUser);

                // Transition to conversation mode on first AI response
                if (!data.isUser && phase === 'waiting') {
                    setPhase('conversation');
                }
            }
        } catch (e) {
            console.error('[VoiceModeContent] Error parsing transcription:', e);
        }
    });

    // Update phase based on connection state
    useEffect(() => {
        if (connectionState === ConnectionState.Connected && phase === 'connecting') {
            setPhase('waiting');
        }
    }, [connectionState, phase, setPhase]);

    // Auto-scroll to latest transcription
    useEffect(() => {
        if (transcriptionsEndRef.current) {
            transcriptionsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcriptions]);

    const isWaitingPhase = phase === 'waiting' || phase === 'listening';
    const isConversationPhase = phase === 'conversation';

    return (
        <div className="relative h-full w-full flex flex-col">
            {/* OGL Orb - Background centered */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <OglOrb
                    amplitude={amplitude}
                    isActive={true}
                    opacity={isConversationPhase ? 0.2 : 0.35}
                    size={Math.min(500, typeof window !== 'undefined' ? window.innerWidth * 0.8 : 400)}
                />
            </div>

            {/* Main content area */}
            <div className="relative z-10 flex-1 flex flex-col">
                <AnimatePresence mode="wait">
                    {/* Waiting Phase - "Start talking" prompt */}
                    {isWaitingPhase && (
                        <motion.div
                            key="waiting"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                            className="flex-1 flex items-center justify-center"
                        >
                            <h2 className="text-2xl font-medium text-foreground/80">
                                {t('voiceModeStartTalking') || 'Start talking'}
                            </h2>
                        </motion.div>
                    )}

                    {/* Conversation Phase - Transcription bubbles */}
                    {isConversationPhase && (
                        <motion.div
                            key="conversation"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                            className="flex-1 overflow-y-auto px-4 py-6"
                        >
                            <div className="max-w-2xl mx-auto space-y-4">
                                {transcriptions.map((item) => (
                                    <VoiceBubble
                                        key={item.id}
                                        text={item.text}
                                        isUser={item.isUser}
                                        timestamp={item.timestamp}
                                    />
                                ))}
                                <div ref={transcriptionsEndRef} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bottom bar with End button */}
            <div className="relative z-10 p-6">
                <div className="max-w-2xl mx-auto flex justify-center">
                    <button
                        onClick={onEnd}
                        className={cn(
                            "flex items-center gap-2 px-6 py-3 rounded-full",
                            "bg-primary text-primary-foreground",
                            "hover:bg-primary/90 transition-colors",
                            "font-medium text-base"
                        )}
                    >
                        <VoiceWaveform
                            amplitude={amplitude}
                            isActive={true}
                            barCount={4}
                            barSize={4}
                            color="currentColor"
                        />
                        <span>{t('voiceModeEnd') || 'End'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
