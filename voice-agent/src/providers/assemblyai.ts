import { AssemblyAI, RealtimeTranscriber } from 'assemblyai';
import { STTProvider, STTEvent } from './types.js';

export class AssemblyAISTT implements STTProvider {
    private client: AssemblyAI;
    private transcriber: any = null;
    private apiKey: string;
    private sampleRate: number;
    private streamWriter: any = null;
    private language: string;

    constructor(apiKey: string, sampleRate: number = 48000, language: string = 'en') {
        this.apiKey = apiKey;
        this.sampleRate = sampleRate;
        this.language = language;
        this.client = new AssemblyAI({ apiKey });
        console.log(`[AssemblyAI] Initialized with sample rate: ${sampleRate}Hz, language: ${language}`);
    }

    private isConnected = false;
    private pushCount = 0;  // Debug counter

    async start(onTranscript: (event: STTEvent) => void): Promise<void> {
        // Initialize params
        const params: any = {
            sampleRate: this.sampleRate,
            wordBoost: ['ChatRAG', 'chatrag'], // Boost recognition of brand name
            endUtteranceSilenceThreshold: 300, // Optimized for low latency (was 1200ms)
            disablePartialTranscripts: false // optional
        };

        // For non-English languages, we must use the multilingual model.
        if (this.language !== 'en') {
            params.speechModel = 'universal-streaming-multilingual';
        }

        this.transcriber = this.client.streaming.transcriber(params);

        // MONKEY PATCH: The AssemblyAI Node SDK v4 does not currently map 'language_code' 
        // to the WebSocket URL parameters in `connectionUrl()`. We must patch it manually.
        if (this.language !== 'en') {
            const originalConnectionUrl = (this.transcriber as any).connectionUrl.bind(this.transcriber);
            (this.transcriber as any).connectionUrl = () => {
                const url = originalConnectionUrl();
                url.searchParams.append('language_code', this.language);
                return url;
            };
        }

        // Handle turn events (V3 Universal Streaming)
        this.transcriber.on('turn', (turn: any) => {
            // "end_of_turn: true" roughly maps to a "final" transcript in our pipeline logic
            // providing a stable sentence.
            // "end_of_turn: false" is an interim result.
            if (turn.transcript) {
                onTranscript({
                    type: turn.end_of_turn ? 'final' : 'interim',
                    text: turn.transcript,
                    metrics: { confidence: turn.end_of_turn_confidence || 1.0 }
                });
            }
        });

        this.transcriber.on('open', (event: any) => {
            console.log(`[AssemblyAI] Session opened.`);
            // V3 'open' event might not have sessionId or structured differently.
            // console.log('[AssemblyAI] Open payload:', JSON.stringify(event));
            this.isConnected = true;
        });

        this.transcriber.on('error', (error: any) => {
            console.error('[AssemblyAI] Error:', error);
            // Don't flip isConnected here necessarily, wait for close using 'close' event or if fatal
        });

        this.transcriber.on('close', (code: number, reason: string) => {
            console.log(`[AssemblyAI] Session closed: ${code} ${reason}`);
            this.isConnected = false;
            this.streamWriter = null;
        });

        console.log('[AssemblyAI] Connecting...');
        try {
            await this.transcriber.connect();
            console.log('[AssemblyAI] Connected. Stream ready.');
            this.isConnected = true; // Optimistic, usually open event fires too

            // Get the writer for the audio stream
            // V3 user docs: transcriber.stream() returns WritableStream
            // We need to cast to any to use getWriter if TS doesn't know it's a WritableStream
            const stream = this.transcriber.stream();
            this.streamWriter = stream.getWriter();
        } catch (error) {
            console.error('[AssemblyAI] Connection failed:', error);
            this.isConnected = false;
            throw error; // Re-throw to fail pipeline start
        }
    }

    pushAudio(audioChunk: Buffer): void {
        this.pushCount++;

        // Log every 100th push
        if (this.pushCount % 100 === 1) {
            console.log(`[AssemblyAI] pushAudio #${this.pushCount}, chunk size: ${audioChunk.byteLength} bytes, connected: ${this.isConnected}`);
        }

        if (!this.isConnected || !this.streamWriter) {
            // Silently drop or log once per second to avoid spam
            // console.warn('[AssemblyAI] Dropping audio chunk - not connected');
            return;
        }

        if (this.streamWriter) {
            try {
                // Write the chunk to the stream
                // Ensure the stream is writable?
                this.streamWriter.write(audioChunk.buffer.slice(audioChunk.byteOffset, audioChunk.byteOffset + audioChunk.byteLength))
                    .catch((err: any) => {
                        // Suppress "Socket is not open" spam mainly
                        if (err.message && err.message.includes('Socket is not open')) {
                            if (this.isConnected) {
                                console.warn('[AssemblyAI] Write failed: Socket closed unexpectedly.');
                                this.isConnected = false;
                            }
                        } else {
                            console.error('[AssemblyAI] Write error:', err.message);
                        }
                        // Optional: Reconnect logic could go here
                    });
            } catch (error) {
                console.error('[AssemblyAI] PushAudio synchronous error:', error);
            }
        }
    }

    async close(): Promise<void> {
        if (this.transcriber) {
            if (this.streamWriter) {
                try {
                    await this.streamWriter.close();
                } catch (e) {
                    console.error('Error closing stream writer', e);
                }
                this.streamWriter = null;
            }
            await this.transcriber.close();
            this.transcriber = null;
        }
    }
}
