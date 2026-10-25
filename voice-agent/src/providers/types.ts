export interface STTEvent {
    type: 'final' | 'interim';
    text: string;
    metrics?: {
        confidence: number;
    };
}

export interface STTProvider {
    /**
     * Start the STT session
     * @param onTranscript Callback for when transcript is received
     */
    start(onTranscript: (event: STTEvent) => void): Promise<void>;

    /**
     * Push audio chunk to the provider
     * @param audioChunk Buffer containing audio data
     */
    pushAudio(audioChunk: Buffer): void;

    /**
     * Close the session
     */
    close(): Promise<void>;
}

export interface TTSProvider {
    /**
     * Synthesize text to speech
     * @param text The text to convert
     * @returns A promise resolving to the audio buffer
     */
    synthesize(text: string): Promise<Buffer>;

    /**
     * Synthesize text with word-level timestamps for text-audio sync
     * @param text The text to convert
     * @returns Audio buffer and word timing information
     */
    synthesizeWithTimestamps(text: string): Promise<{
        audio: Buffer;
        wordTimings: Array<{ word: string; start: number; end: number }>;
    }>;

    /**
     * Stream synthesis (optional)
     */
    stream?(text: string): AsyncGenerator<Buffer>;
}
