'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export type VoiceModePhase = 'idle' | 'connecting' | 'waiting' | 'listening' | 'conversation';

interface UseVoiceModeOptions {
    onTranscription?: (text: string, isFinal: boolean, isUser: boolean) => void;
    onError?: (error: Error) => void;
    onPhaseChange?: (phase: VoiceModePhase) => void;
}

interface VoiceModeState {
    isActive: boolean;
    phase: VoiceModePhase;
    amplitude: number;
    isConnected: boolean;
    error: Error | null;
    transcriptions: Array<{
        id: string;
        text: string;
        isUser: boolean;
        timestamp: Date;
    }>;
}

interface UseVoiceModeReturn extends VoiceModeState {
    startVoiceMode: () => Promise<void>;
    endVoiceMode: () => void;
    setPhase: (phase: VoiceModePhase) => void;
    addTranscription: (text: string, isUser: boolean) => void;
    clearTranscriptions: () => void;
}

export function useVoiceMode(options: UseVoiceModeOptions = {}): UseVoiceModeReturn {
    const { onTranscription, onError, onPhaseChange } = options;

    const [state, setState] = useState<VoiceModeState>({
        isActive: false,
        phase: 'idle',
        amplitude: 0,
        isConnected: false,
        error: null,
        transcriptions: [],
    });

    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);

    // Cleanup function
    const cleanup = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        analyserRef.current = null;
        dataArrayRef.current = null;
    }, []);

    // Analyze audio for amplitude
    const analyzeAudio = useCallback(() => {
        if (!analyserRef.current || !dataArrayRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        // Calculate average amplitude
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
            sum += dataArrayRef.current[i];
        }
        const average = sum / dataArrayRef.current.length;
        const normalizedAmplitude = average / 255;

        setState(prev => ({ ...prev, amplitude: normalizedAmplitude }));

        animationFrameRef.current = requestAnimationFrame(analyzeAudio);
    }, []);

    // Start microphone capture for amplitude analysis
    const startAudioCapture = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;

            source.connect(analyser);
            analyserRef.current = analyser;

            const bufferLength = analyser.frequencyBinCount;
            dataArrayRef.current = new Uint8Array(bufferLength);

            // Start amplitude analysis
            analyzeAudio();
        } catch (error) {
            console.error('[useVoiceMode] Failed to start audio capture:', error);
            const err = error instanceof Error ? error : new Error('Failed to access microphone');
            setState(prev => ({ ...prev, error: err }));
            onError?.(err);
        }
    }, [analyzeAudio, onError]);

    // Start voice mode
    const startVoiceMode = useCallback(async () => {
        setState(prev => ({
            ...prev,
            isActive: true,
            phase: 'connecting',
            error: null,
            transcriptions: [],
        }));
        onPhaseChange?.('connecting');

        try {
            // Start audio capture for amplitude visualization
            await startAudioCapture();

            // Move to waiting phase (LiveKit connection handled separately by voice-mode-container)
            setState(prev => ({ ...prev, phase: 'waiting' }));
            onPhaseChange?.('waiting');
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Failed to start voice mode');
            setState(prev => ({
                ...prev,
                isActive: false,
                phase: 'idle',
                error: err
            }));
            onError?.(err);
        }
    }, [startAudioCapture, onPhaseChange, onError]);

    // End voice mode
    const endVoiceMode = useCallback(() => {
        cleanup();
        setState({
            isActive: false,
            phase: 'idle',
            amplitude: 0,
            isConnected: false,
            error: null,
            transcriptions: [],
        });
        onPhaseChange?.('idle');
    }, [cleanup, onPhaseChange]);

    // Set phase manually (for external control)
    const setPhase = useCallback((phase: VoiceModePhase) => {
        setState(prev => ({ ...prev, phase }));
        onPhaseChange?.(phase);
    }, [onPhaseChange]);

    // Add transcription
    const addTranscription = useCallback((text: string, isUser: boolean) => {
        const transcription = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text,
            isUser,
            timestamp: new Date(),
        };

        setState(prev => ({
            ...prev,
            transcriptions: [...prev.transcriptions, transcription],
            // Transition to conversation phase on first AI response
            phase: prev.phase === 'waiting' && !isUser ? 'conversation' : prev.phase,
        }));

        onTranscription?.(text, true, isUser);
    }, [onTranscription]);

    // Clear transcriptions
    const clearTranscriptions = useCallback(() => {
        setState(prev => ({ ...prev, transcriptions: [] }));
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);

    return {
        ...state,
        startVoiceMode,
        endVoiceMode,
        setPhase,
        addTranscription,
        clearTranscriptions,
    };
}
