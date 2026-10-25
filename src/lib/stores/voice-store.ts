import { create } from 'zustand';

// Word timing information from TTS for text-audio sync
export interface WordTiming {
    word: string;
    start: number;  // seconds from audio start
    end: number;    // seconds from audio start
}

// Source image data for Image RAG in voice mode
export interface VoiceSourceImage {
    url: string;
    name: string;
    type: string;
}

interface Transcript {
    role: 'user' | 'assistant';
    text: string;
    id: string;
    isPartial?: boolean;
    audioDurationMs?: number;
    wordTimings?: WordTiming[];
    source_images?: VoiceSourceImage[];  // Images from Image RAG
}

interface VoiceStore {
    userAmplitude: number;
    setUserAmplitude: (amplitude: number) => void;

    // Transcript State
    transcripts: Transcript[];
    addTranscript: (transcript: Transcript) => void;
    updateTranscriptById: (id: string, text: string, audioDurationMs?: number, wordTimings?: WordTiming[], isPartial?: boolean, source_images?: VoiceSourceImage[]) => void;
    clearTranscripts: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
    userAmplitude: 0,
    setUserAmplitude: (amplitude) => set({ userAmplitude: amplitude }),

    // Transcript State
    transcripts: [],
    addTranscript: (transcript) => set((state) => {
        // Prevent duplicates
        if (state.transcripts.some(t => t.id === transcript.id)) {
            return state;
        }
        return {
            transcripts: [...state.transcripts, transcript]
        };
    }),
    updateTranscriptById: (id, text, audioDurationMs, wordTimings, isPartial, source_images) => set((state) => ({
        transcripts: state.transcripts.map((t) =>
            t.id === id ? {
                ...t,
                text,
                ...(audioDurationMs !== undefined && { audioDurationMs }),
                ...(wordTimings !== undefined && { wordTimings }),
                ...(isPartial !== undefined && { isPartial }),
                ...(source_images !== undefined && { source_images })
            } : t
        )
    })),
    clearTranscripts: () => set({ transcripts: [] }),
}));

