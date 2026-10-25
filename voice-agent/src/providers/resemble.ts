import axios from 'axios';
import { TTSProvider } from './types.js';

export class ResembleTTS implements TTSProvider {
    private apiKey: string;
    private voiceId: string;
    private baseUrl = 'https://p.cluster.resemble.ai/v2';
    private headerStripped = false;

    constructor(apiKey: string, voiceId: string) {
        this.apiKey = apiKey;
        this.voiceId = voiceId;
    }

    private cleanTextForSpeech(text: string): string {
        return text
            // Remove bold/italic markers
            .replace(/\*\*|__|\*|_/g, '')
            // Remove headers (### Title -> Title)
            .replace(/^#+\s+/gm, '')
            // Remove links ([text](url) -> text)
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remove code blocks
            .replace(/```[\s\S]*?```/g, '')
            // Remove inline code
            .replace(/`([^`]+)`/g, '$1')
            // Remove list markers but keep content
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            // Clean up extra whitespace
            .replace(/\s+/g, ' ')
            .trim();
    }

    async synthesize(text: string): Promise<Buffer> {
        try {
            // Synchronous (Clip) API
            // Note: For real-time applications, use the stream endpoint usually.
            // But implementing the base interface first.
            const response = await axios.post(
                `${this.baseUrl}/projects/${process.env.RESEMBLE_PROJECT_ID || 'default'}/clips`, // Actually Resemble sync API structure varies.
                // Using the simpler endpoint often used:
                // POST https://p.cluster.resemble.ai/tts
                // But v2 API is preferred.
                {
                    title: 'Voice Agent Response',
                    body: this.cleanTextForSpeech(text),
                    voice_uuid: this.voiceId,
                    sample_rate: 44100, // or 16000
                    output_format: 'wav',
                    precision: 'PCM_16'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Resemble V2 Sync API returns a JSON with a URL to the file usually, unless using the 'sync' parameter?
            // Let's use the standard "Stream" endpoint for immediate audio bytes which is better for agents.

            return this.synthesizeStreamBuffer(this.cleanTextForSpeech(text));

        } catch (error) {
            console.error('[ResembleTTS] Error:', error);
            throw error;
        }
    }

    // Direct streaming implementation
    private async synthesizeStreamBuffer(text: string): Promise<Buffer> {
        try {
            const response = await axios.post(
                process.env.RESEMBLE_STREAM_URL || 'https://p.cluster.resemble.ai/stream',
                {
                    data: text,
                    voice_uuid: this.voiceId,
                    project_uuid: process.env.RESEMBLE_PROJECT_ID || '', // Optional often
                    sample_rate: 16000,
                    precision: 'PCM_16'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );

            return Buffer.from(response.data);
        } catch (error) {
            console.error('[ResembleTTS] Stream Error:', error);
            throw error;
        }
    }

    async *stream(text: string): AsyncGenerator<Buffer> {
        this.headerStripped = false; // Reset for each new stream
        try {
            const response = await axios.post(
                process.env.RESEMBLE_STREAM_URL || 'https://p.cluster.resemble.ai/stream',
                {
                    data: this.cleanTextForSpeech(text),
                    voice_uuid: this.voiceId,
                    sample_rate: 16000,
                    precision: 'PCM_16'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            for await (const chunk of response.data) {
                let buffer = Buffer.from(chunk);

                // Strip WAV header from first chunk if present
                if (!this.headerStripped) {
                    // Check for RIFF signature (WAV header)
                    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'RIFF') {
                        console.log('[ResembleTTS] Detected and stripping 44-byte WAV header');
                        buffer = buffer.subarray(44); // Skip standard WAV header
                    }
                    this.headerStripped = true;
                }

                if (buffer.length > 0) {
                    yield buffer;
                }
            }

        } catch (error) {
            console.error('[ResembleTTS] Stream Iterator Error:', error);
        }
    }

    /**
     * Synthesize text with word-level timestamps using the synchronous API.
     * Returns both audio buffer and word timing information for frontend sync.
     */
    async synthesizeWithTimestamps(text: string): Promise<{
        audio: Buffer;
        wordTimings: Array<{ word: string; start: number; end: number }>;
    }> {
        const cleanedText = this.cleanTextForSpeech(text);

        try {
            console.log(`[ResembleTTS] Synthesizing with timestamps: "${cleanedText.slice(0, 50)}..."`);
            console.log(`[ResembleTTS] Using voice_uuid: ${this.voiceId}`);

            // Build request body - project_uuid is optional
            const requestBody: Record<string, any> = {
                voice_uuid: this.voiceId,
                data: cleanedText,
                precision: 'PCM_16',
                output_format: 'wav',
                sample_rate: 16000
            };

            // Only add project_uuid if it's actually set
            if (process.env.RESEMBLE_PROJECT_ID) {
                requestBody.project_uuid = process.env.RESEMBLE_PROJECT_ID;
                console.log(`[ResembleTTS] Using project_uuid: ${process.env.RESEMBLE_PROJECT_ID}`);
            }

            const response = await axios.post(
                'https://f.cluster.resemble.ai/synthesize',
                requestBody,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                }
            );

            console.log(`[ResembleTTS] Sync API response keys:`, Object.keys(response.data));
            console.log(`[ResembleTTS] Has audio_timestamps:`, !!response.data.audio_timestamps);

            if (response.data.audio_timestamps) {
                console.log(`[ResembleTTS] audio_timestamps keys:`, Object.keys(response.data.audio_timestamps));
                console.log(`[ResembleTTS] graph_chars count:`, response.data.audio_timestamps.graph_chars?.length || 0);
            }

            const { audio_content, audio_timestamps } = response.data;

            // Decode base64 audio
            const audioBuffer = Buffer.from(audio_content, 'base64');

            // Strip 44-byte WAV header to get raw PCM
            const rawPcm = audioBuffer.subarray(44);

            // Convert character timings to word timings
            let wordTimings: Array<{ word: string; start: number; end: number }> = [];

            if (audio_timestamps?.graph_chars && audio_timestamps?.graph_times) {
                wordTimings = this.convertToWordTimings(
                    audio_timestamps.graph_chars,
                    audio_timestamps.graph_times
                );

                // VALIDATION: Check if timings are valid (not all identical)
                // If the first few words all start at 0 (or same value), it's broken.
                if (wordTimings.length > 2) {
                    const firstStart = wordTimings[0].start;
                    const secondStart = wordTimings[1].start;
                    const thirdStart = wordTimings[2].start;

                    if (firstStart === secondStart && secondStart === thirdStart) {
                        console.warn('[ResembleTTS] ⚠️ Detected broken timestamps (all identical). Switching to heuristic estimation.');
                        // Calculate total duration from raw PCM length
                        // 16kHz, 16-bit (2 bytes), 1 channel = 32000 bytes/sec
                        const durationSec = rawPcm.length / 32000;
                        wordTimings = this.estimateWordTimings(cleanedText, durationSec);
                    }
                }

                console.log(`[ResembleTTS] Extracted ${wordTimings.length} word timings`);
            } else {
                console.warn('[ResembleTTS] No audio_timestamps in response, using heuristic estimation');
                const durationSec = rawPcm.length / 32000; // 16kHz 16-bit mono
                wordTimings = this.estimateWordTimings(cleanedText, durationSec);
            }

            return {
                audio: rawPcm,
                wordTimings
            };
        } catch (error: any) {
            console.error('[ResembleTTS] SynthesizeWithTimestamps Error:', error?.response?.status, error?.response?.data || error.message);

            // Fallback: use streaming API without timestamps (empty array = no sync)
            console.log('[ResembleTTS] Falling back to stream API without timestamps');
            const audioChunks: Buffer[] = [];
            for await (const chunk of this.stream(text)) {
                audioChunks.push(chunk);
            }
            return {
                audio: Buffer.concat(audioChunks),
                wordTimings: []
            };
        }
    }

    /**
     * Estimated word timings based on character length when API fails.
     * Assumes constant speaking rate across the sentence (linear interpolation).
     */
    private estimateWordTimings(text: string, totalDurationSec: number): Array<{ word: string; start: number; end: number }> {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) return [];

        // Count total characters (excluding spaces for better weight)
        const totalChars = words.reduce((sum, word) => sum + word.length, 0);

        if (totalChars === 0) return [];

        const timings: Array<{ word: string; start: number; end: number }> = [];
        let currentTime = 0;

        // Add a small pause weight for spaces/punctuation implicitly by spreading duration
        // We'll trust char count ratio for now as it's robust

        for (const word of words) {
            // Calculate duration fraction based on word length
            const wordDuration = (word.length / totalChars) * totalDurationSec;

            timings.push({
                word: word,
                start: currentTime,
                end: currentTime + wordDuration
            });

            currentTime += wordDuration;
        }

        return timings;
    }

    /**
     * Convert character-level timings from Resemble API to word-level timings.
     * Aggregates characters between spaces into words with start/end times.
     */
    private convertToWordTimings(
        chars: string[],
        times: [number, number][]
    ): Array<{ word: string; start: number; end: number }> {
        const words: Array<{ word: string; start: number; end: number }> = [];
        let currentWord = '';
        let wordStart = 0;
        let wordEnd = 0;

        for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            const [start, end] = times[i];

            if (char === ' ') {
                // End of word - save if not empty
                if (currentWord.length > 0) {
                    words.push({
                        word: currentWord,
                        start: wordStart,
                        end: wordEnd
                    });
                }
                currentWord = '';
                // Next word will start after space
            } else {
                // Building a word
                if (currentWord.length === 0) {
                    wordStart = start;
                }
                currentWord += char;
                wordEnd = end;
            }
        }

        // Don't forget the last word if text doesn't end with space
        if (currentWord.length > 0) {
            words.push({
                word: currentWord,
                start: wordStart,
                end: wordEnd
            });
        }

        return words;
    }
}
