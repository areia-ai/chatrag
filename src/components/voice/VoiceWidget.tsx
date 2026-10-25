'use client';

import {
    LiveKitRoom,
    RoomAudioRenderer,
    BarVisualizer,
    ControlBar,
    useConnectionState,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import '@livekit/components-styles';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Loader2 } from 'lucide-react';

export default function VoiceWidget() {
    const [token, setToken] = useState<string>('');
    const [serverUrl, setServerUrl] = useState<string>('');
    const [isConnecting, setIsConnecting] = useState(false);
    const [shouldConnect, setShouldConnect] = useState(false);

    // Ensure AudioContext is resumed before connecting (fixes browser autoplay policy)
    const ensureAudioContext = useCallback(() => {
        try {
            // Create and immediately resume an AudioContext on user gesture
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    console.log('[VoiceWidget] AudioContext resumed successfully');
                });
            }
        } catch (e) {
            console.warn('[VoiceWidget] Could not initialize AudioContext:', e);
        }
    }, []);

    useEffect(() => {
        if (!shouldConnect) return;

        const fetchToken = async () => {
            try {
                setIsConnecting(true);

                // Get Auth Session for User ID
                let userId = 'anon';
                try {
                    // Dynamic import to avoid SSR issues if any
                    const { createClient } = await import('@/lib/supabase/client');
                    const supabase = createClient();
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session?.user?.id) {
                        userId = session.user.id;
                        console.log('[VoiceWidget] Authenticated as user:', userId);
                    }
                } catch (err) {
                    console.error('[VoiceWidget] Error fetching session:', err);
                }

                // Append random suffix to allow multiple tabs/sessions for same user if needed, 
                // but prefix with user ID for RAG context
                const identity = `user-${userId}-${Math.floor(Math.random() * 1000)}`;

                const resp = await fetch(`/api/livekit/token?room=chatrag-voice&username=${identity}`);
                const data = await resp.json();

                if (data.error) {
                    console.error('Failed to get token:', data.error);
                    return;
                }

                setToken(data.token);
                setServerUrl(data.serverUrl);
            } catch (e) {
                console.error(e);
            } finally {
                setIsConnecting(false);
            }
        };

        fetchToken();
    }, [shouldConnect]);

    if (!shouldConnect) {
        return (
            <Button
                onClick={() => {
                    ensureAudioContext();
                    setShouldConnect(true);
                }}
                variant="outline"
                size="sm"
                className="gap-2"
            >
                <Mic className="h-4 w-4" />
                Start Voice
            </Button>
        );
    }

    if (isConnecting || !token) {
        return (
            <Button disabled variant="outline" size="sm" className="gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting...
            </Button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 shadow-lg rounded-lg overflow-hidden bg-background border border-border">
            <LiveKitRoom
                video={false}
                audio={true}
                token={token}
                serverUrl={serverUrl}
                onDisconnected={() => setShouldConnect(false)}
                data-lk-theme="default"
                style={{ height: 'auto', minHeight: '100px', width: '300px' }}
            >
                <div className="flex flex-col p-4 gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm">Voice Agent</h3>
                        <ConnectionStatus />
                    </div>

                    <div className="h-16 flex items-center justify-center bg-muted/50 rounded">
                        {/* Visualizer requires a track reference which is complex to get without tracks hook. 
                     Keeping it simple for now or usage would be: 
                     const tracks = useTracks([Track.Source.Microphone]); 
                 */}
                        <div className="text-xs text-muted-foreground">Audio Visualizer Placeholder</div>
                    </div>

                    <ControlBar controls={{ microphone: true, camera: false, screenShare: false }} />
                    <RoomAudioRenderer />
                </div>
            </LiveKitRoom>
        </div>
    );
}

function ConnectionStatus() {
    const connectionState = useConnectionState();

    return (
        <span className="text-xs text-muted-foreground capitalize">
            {connectionState === ConnectionState.Connected ? 'Connected' : connectionState}
        </span>
    );
}
