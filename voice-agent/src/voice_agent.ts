import OpenAI from 'openai';
import axios from 'axios';
import { AssemblyAISTT } from './providers/assemblyai.js';
import { ResembleTTS } from './providers/resemble.js';

import { RAGClient } from './rag_client.js';
import { STTEvent, TTSProvider } from './providers/types.js';

export class VoicePipeline {
    private stt: AssemblyAISTT;
    private tts: TTSProvider;
    private rag: RAGClient;
    private llm: OpenAI;
    private llmProvider: 'openai' | 'groq' | 'openrouter';
    private onAudioOutput: (audio: Buffer) => void;
    private onTextOutput?: (payload: any) => void;
    private llmModel: string;

    // State
    private history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    private systemPrompt = `You are a helpful, knowledgeable voice assistant for ChatRAG.
    
    CORE INSTRUCTIONS:
    - Images are AUTOMATICALLY displayed alongside your response when available. Do NOT announce or describe them (e.g., avoid "Here is the image" or "Here is the logo"). The user can already see them.
    - NEVER say "I cannot display images" or "I am text-based" — you CAN show images.
    - NEVER speak URLs aloud. The frontend handles displaying links and images.
    - Keep your spoken responses concise (2-3 sentences where possible), as they are being read out loud.
    - Start your response directly. Do NOT use headers or titles to label your answer (e.g. avoid "Pricing:" or "## Answer").
    - Use Markdown formatting (bold **text**, lists) for readability in the text history.
    - Providing specific code snippets or technical details is allowed if asked.
    - Be conversational and friendly.
    - If you don't know the answer, admit it gracefully.
    - Do not hallucinate features that aren't in the provided context.
    `;

    // Playback cancellation - shared across all message processing
    private cancelCurrentPlayback = false;
    private isProcessing = false;
    private currentRequestId = 0;  // Track which request is current to cancel stale ones
    private userId?: string;

    // For chat persistence
    private ragApiUrl: string;
    private ragApiKey: string;

    // Barge-in cooldown - ignore transcripts for a period after interruption
    private lastCancellationTime = 0;
    private readonly BARGE_IN_COOLDOWN_MS = 600; // Optimized for low latency (was 1500ms)

    // Transcript debounce - combine rapid consecutive transcripts
    private pendingTranscript = '';
    private transcriptDebounceTimer: NodeJS.Timeout | null = null;
    private readonly TRANSCRIPT_DEBOUNCE_MS = 150; // Optimized for low latency (was 600ms)

    // Message Metadata Storage (for saving rich history)
    private messageMetadata = new Map<number, any>();


    constructor(config: {
        openaiApiKey: string,
        openrouterApiKey?: string,
        openaiBaseUrl?: string,
        llmModel?: string,
        assemblyApiKey: string,
        resembleApiKey?: string,
        resembleVoiceId?: string,
        ragApiUrl: string,
        ragApiKey: string,
        assemblyAiLanguage?: string,
        groqApiKey?: string, // Groq API key
        llmProvider?: 'openai' | 'groq' | 'openrouter', // LLM provider selection
        ttsProvider?: 'resemble' | 'hume', // TTS provider selection
        humeApiKey?: string, // Hume AI API key
        humeVoice?: string // Hume voice ID (UUID) or name (default: 'Ava Song')
    }, onAudioOutput: (audio: Buffer) => void, onTextOutput?: (payload: any) => void) {

        // Set provider (default to openai)
        this.llmProvider = config.llmProvider || 'openai';
        this.llmModel = config.llmModel || 'gpt-4o';
        this.onTextOutput = onTextOutput;

        if (this.llmProvider === 'groq') {
            console.log(`[VoicePipeline] Using Groq API with model: ${this.llmModel}`);
            this.llm = new OpenAI({
                apiKey: config.groqApiKey,
                baseURL: 'https://api.groq.com/openai/v1'
            });
        } else if (this.llmProvider === 'openrouter') {
            console.log(`[VoicePipeline] Using OpenRouter API with model: ${this.llmModel}`);
            this.llm = new OpenAI({
                apiKey: config.openrouterApiKey,
                baseURL: 'https://openrouter.ai/api/v1'
            });
        } else {
            // Default: OpenAI (with optional custom base URL for advanced users)
            const openaiConfig: { apiKey: string; baseURL?: string } = {
                apiKey: config.openaiApiKey
            };
            if (config.openaiBaseUrl) {
                openaiConfig.baseURL = config.openaiBaseUrl;
                console.log(`[VoicePipeline] Using custom base URL: ${config.openaiBaseUrl}`);
            } else {
                console.log(`[VoicePipeline] Using OpenAI API`);
            }
            this.llm = new OpenAI(openaiConfig);
            console.log(`[VoicePipeline] Using OpenAI LLM model: ${this.llmModel}`);
        }

        this.stt = new AssemblyAISTT(config.assemblyApiKey, 48000, config.assemblyAiLanguage || 'en');

        // TTS Provider Selection
        if (!config.resembleApiKey || !config.resembleVoiceId) {
            throw new Error('RESEMBLE_API_KEY and RESEMBLE_VOICE_ID are required when using Resemble TTS provider');
        }
        console.log('[VoicePipeline] Using Resemble AI TTS');
        this.tts = new ResembleTTS(config.resembleApiKey, config.resembleVoiceId);

        this.rag = new RAGClient(config.ragApiUrl, config.ragApiKey);
        this.onAudioOutput = onAudioOutput;

        // Store for chat persistence
        this.ragApiUrl = config.ragApiUrl;
        this.ragApiKey = config.ragApiKey;

        // Initialize Conversation History
        this.history.push({ role: 'system', content: this.systemPrompt });
    }

    async start() {
        console.log('[VoicePipeline] Starting...');

        // Start STT Listener with debounce to combine split transcripts
        await this.stt.start(async (event: STTEvent) => {
            if (event.type === 'final') {
                // Check for barge-in cooldown
                const timeSinceCancellation = Date.now() - this.lastCancellationTime;
                if (timeSinceCancellation < this.BARGE_IN_COOLDOWN_MS) {
                    console.log(`[VoicePipeline] ⏳ Ignoring transcript during barge-in cooldown (${timeSinceCancellation}ms since interruption): "${event.text}"`);
                    return;
                }

                console.log(`[User] ${event.text}`);

                // Filter out noise/filler words that shouldn't trigger a response
                const noiseWords = ['lol', 'hmm', 'um', 'uh', 'okay', 'ok', 'yeah', 'yep', 'nope', 'huh', 'ah', 'oh', 'mhm', 'aha'];
                const cleanedText = event.text.trim().toLowerCase();
                if (noiseWords.includes(cleanedText) || cleanedText.length < 3) {
                    console.log(`[VoicePipeline] 🔇 Ignoring noise/filler word: "${event.text}"`);
                    return;
                }

                // DEBOUNCE: Accumulate transcripts and wait for more
                // This handles cases where STT splits one sentence into multiple parts
                this.pendingTranscript = this.pendingTranscript
                    ? `${this.pendingTranscript} ${event.text.trim()}`
                    : event.text.trim();

                // Clear any existing timer
                if (this.transcriptDebounceTimer) {
                    clearTimeout(this.transcriptDebounceTimer);
                }

                console.log(`[VoicePipeline] 📝 Buffered transcript: "${this.pendingTranscript}" (waiting ${this.TRANSCRIPT_DEBOUNCE_MS}ms for more)`);

                // Set new timer to process after debounce period
                this.transcriptDebounceTimer = setTimeout(async () => {
                    const fullTranscript = this.pendingTranscript;
                    this.pendingTranscript = '';
                    this.transcriptDebounceTimer = null;

                    console.log(`[VoicePipeline] ✅ Processing combined transcript: "${fullTranscript}"`);

                    // Broadcast user text (formatted for display)
                    const formattedText = this.formatTranscript(fullTranscript);
                    const userMsgId = `user-${Date.now()}`;
                    this.onTextOutput?.({
                        type: 'transcription',
                        role: 'user',
                        text: formattedText,
                        isPartial: false,
                        id: userMsgId
                    });

                    await this.processUserMessage(fullTranscript, userMsgId); // Use original for RAG search
                }, this.TRANSCRIPT_DEBOUNCE_MS);
            } else {
                // Log interim results (VAD handles barge-in, not this)
                console.log(`[Interim] ${event.text}`);
            }
        });

        console.log('[VoicePipeline] Ready.');
    }

    /**
     * Speak a greeting message to initiate the conversation.
     * Called when a user joins the voice session.
     */
    async speakGreeting(greeting?: string): Promise<void> {
        const defaultGreeting = "Hi there! I'm here to help. What would you like to know about ChatRAG?";
        const message = greeting || defaultGreeting;

        console.log(`[VoicePipeline] 🎙️ Speaking greeting: "${message}"`);

        try {
            // Synthesize the greeting
            if (!this.tts.stream) {
                // Fallback to synthesize if stream is not available
                const audio = await this.tts.synthesize(message);
                this.applyFadesInPlace(audio, 30);
                const durationMs = Math.round((audio.length / 32000) * 1000);
                console.log(`[VoicePipeline] Greeting audio duration: ${durationMs}ms`);
                this.onTextOutput?.({
                    type: 'transcription',
                    role: 'assistant',
                    text: message,
                    isPartial: false,
                    id: `greeting-${Date.now()}`,
                    audioDurationMs: durationMs
                });
                await this.onAudioOutput(audio);
                this.history.push({ role: 'assistant', content: message });
                console.log('[VoicePipeline] ✅ Greeting complete');
                return;
            }

            const audioStream = this.tts.stream(message);
            const audioChunks: Buffer[] = [];

            for await (const chunk of audioStream) {
                audioChunks.push(chunk);
            }

            const greetingAudio = Buffer.concat(audioChunks);
            this.applyFadesInPlace(greetingAudio, 30); // Consistent 30ms fade

            // Calculate duration (16kHz, 16-bit mono = 32000 bytes/sec)
            const durationMs = Math.round((greetingAudio.length / 32000) * 1000);
            console.log(`[VoicePipeline] Greeting audio duration: ${durationMs}ms`);

            // Broadcast greeting text FIRST to start typewriter immediately
            this.onTextOutput?.({
                type: 'transcription',
                role: 'assistant',
                text: message,
                isPartial: false,
                id: `greeting-${Date.now()}`,
                audioDurationMs: durationMs
            });

            // Send to audio output
            await this.onAudioOutput(greetingAudio);

            // Add to conversation history so the AI knows what it said
            this.history.push({ role: 'assistant', content: message });

            console.log('[VoicePipeline] ✅ Greeting complete');
        } catch (error) {
            console.error('[VoicePipeline] Error speaking greeting:', error);
        }
    }

    /**
     * Apply fade-in and fade-out to audio buffer IN PLACE to prevent pops
     */
    private applyFadesInPlace(audio: Buffer, fadeMs: number = 10, sampleRate: number = 16000): void {
        const fadeSamples = Math.floor(sampleRate * fadeMs / 1000);
        const totalSamples = audio.length / 2;

        // Fade in (first fadeSamples)
        for (let i = 0; i < Math.min(fadeSamples, totalSamples); i++) {
            const multiplier = i / fadeSamples;
            const sample = audio.readInt16LE(i * 2);
            audio.writeInt16LE(Math.round(sample * multiplier), i * 2);
        }

        // Fade out (last fadeSamples)
        for (let i = 0; i < Math.min(fadeSamples, totalSamples); i++) {
            const idx = totalSamples - 1 - i;
            const multiplier = i / fadeSamples;
            const sample = audio.readInt16LE(idx * 2);
            audio.writeInt16LE(Math.round(sample * multiplier), idx * 2);
        }
    }

    public setUserId(userId: string) {
        this.userId = userId;
        console.log(`[VoicePipeline] User ID set to: ${userId}`);
    }

    /**
     * Format a user transcript for clean display.
     * - Capitalizes first letter
     * - Corrects common speech-to-text misspellings (chatbrag -> ChatRAG)
     * - Adds question marks for question words (Who, What, Where, How, etc.)
     */
    private formatTranscript(text: string): string {
        if (!text || text.trim().length === 0) return text;

        let formatted = text.trim();

        // 1. Brand name corrections (case-insensitive replacements)
        const brandCorrections: Record<string, string> = {
            'chatbrag': 'ChatRAG',
            'chat rag': 'ChatRAG',
            'chatrag': 'ChatRAG',
            'chat r a g': 'ChatRAG',
            'chatr ag': 'ChatRAG',
            'chat-rag': 'ChatRAG',
        };

        for (const [wrong, correct] of Object.entries(brandCorrections)) {
            const regex = new RegExp(wrong, 'gi');
            formatted = formatted.replace(regex, correct);
        }

        // 2. Capitalize first letter
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);

        // 3. Add question mark if starts with question word and doesn't end with punctuation
        const questionWords = ['who', 'what', 'where', 'when', 'why', 'how', 'which', 'can', 'could', 'would', 'should', 'is', 'are', 'do', 'does', 'did', 'will'];
        const startsWithQuestion = questionWords.some(word =>
            formatted.toLowerCase().startsWith(word + ' ') || formatted.toLowerCase() === word
        );
        const endsWithPunctuation = /[.!?]$/.test(formatted);

        if (startsWithQuestion && !endsWithPunctuation) {
            formatted += '?';
        }

        return formatted;
    }

    /**
     * Rewrite a user query using conversation history for better RAG retrieval.
     * This resolves pronouns like "it", "its", "this" to their actual referents.
     */
    private async rewriteQueryWithContext(userQuery: string): Promise<string> {
        // Check if there's any conversation history (including assistant greeting)
        const conversationMessages = this.history.filter(m => m.role !== 'system');
        if (conversationMessages.length === 0) {
            return userQuery;
        }

        // Build a mini-history for context
        const recentHistory = this.history
            .filter(m => m.role !== 'system')
            .slice(-6) // Last 3 exchanges
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');

        try {
            console.log('[QueryRewrite] Rewriting query with conversation context...');
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a query rewriter. Your ONLY job is to resolve pronouns (it, its, this, that, they) by replacing them with their referents from conversation history.

Rules:
1. ONLY resolve pronouns. Do NOT add extra context or descriptions.
2. If there are no pronouns, return the query UNCHANGED.
3. Keep output as SHORT as possible - ideally the same length as the input.
4. Output ONLY the rewritten query, nothing else.

Examples:
- "What is its price?" -> "What is ChatRAG's price?" (resolved "its")
- "Who created ChatRAG?" -> "Who created ChatRAG?" (no pronouns, return unchanged)
- "Tell me more about it" -> "Tell me more about ChatRAG" (resolved "it")`
                    },
                    {
                        role: 'user',
                        content: `Conversation history:\n${recentHistory}\n\nCurrent user query: "${userQuery}"\n\nRewrite this query to be self-contained:`
                    }
                ],
                max_tokens: 100,
                temperature: 0
            });

            const rewrittenQuery = response.choices[0]?.message?.content?.trim() || userQuery;
            if (rewrittenQuery !== userQuery) {
                console.log(`[QueryRewrite] Original: "${userQuery}" -> Rewritten: "${rewrittenQuery}"`);
            }
            return rewrittenQuery;
        } catch (error) {
            console.error('[QueryRewrite] Error rewriting query:', error);
            return userQuery; // Fall back to original query
        }
    }

    async processUserMessage(text: string, userInputId?: string) {
        // Generate a unique request ID for this message
        const requestId = Date.now();
        this.currentRequestId = requestId;

        // If already processing, cancel the current playback first
        if (this.isProcessing) {
            console.log('[VoicePipeline] ⚠️ New message while processing - cancelling current response');
            this.cancelCurrentPlayback = true;
            this.lastCancellationTime = Date.now(); // Start barge-in cooldown
            // Give a moment for the current playback to notice the cancellation
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Mark that we're now processing
        this.isProcessing = true;
        this.cancelCurrentPlayback = false;

        // 1. Contextual Query Rewriting for better RAG retrieval
        const rewrittenQuery = await this.rewriteQueryWithContext(text);

        // CHECK: Was this request superseded by a newer one?
        if (this.currentRequestId !== requestId) {
            console.log(`[VoicePipeline] 🛑 Request ${requestId} cancelled (superseded by ${this.currentRequestId})`);
            return;
        }

        // NOTE: We do NOT update the user transcript with the rewritten query.
        // The rewritten query is only used internally for better RAG retrieval.
        // The user should see exactly what they said, not an LLM-expanded version.

        // 2. RAG Retrieval with rewritten query
        const { context, sources, source_images } = await this.rag.query(rewrittenQuery, this.userId);

        // CHECK: Was this request superseded by a newer one?
        if (this.currentRequestId !== requestId) {
            console.log(`[VoicePipeline] 🛑 Request ${requestId} cancelled after RAG (superseded by ${this.currentRequestId})`);
            return;
        }

        // Log Image RAG retrieval
        if (source_images.length > 0) {
            console.log(`[VoicePipeline] 🖼️ Retrieved ${source_images.length} source images for voice response`);
        }

        // 2. Construct Prompt with Context
        let systemMessageWithContext = this.systemPrompt;
        if (context) {
            systemMessageWithContext += `\n\nCONTEXT:\n${context}`;
        }

        // NOTE: Images are automatically displayed by the frontend.
        // We do NOT inject image names/URLs into the LLM context to prevent it from narrating filenames.
        // The system prompt already tells the LLM that images are displayed automatically.

        // Prepare messages for LLM
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemMessageWithContext },
            ...this.history.filter(m => m.role !== 'system'),
            { role: 'user', content: rewrittenQuery } // Use rewritten query for LLM context
        ];

        // 3. LLM Generation with STREAMING
        console.log('[LLM] Generating response...');

        // CHECK: Was this request superseded by a newer one?
        if (this.currentRequestId !== requestId) {
            console.log(`[VoicePipeline] 🛑 Request ${requestId} cancelled before LLM (superseded by ${this.currentRequestId})`);
            this.isProcessing = false;
            return;
        }

        try {
            const stream = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: messages,
                stream: true,
            });

            // Start agent message - include source_images immediately for early display
            const agentMsgId = `agent-${Date.now()}`;
            this.onTextOutput?.({
                type: 'transcription',
                role: 'assistant',
                text: '',
                isPartial: true,
                id: agentMsgId,
                source_images: source_images  // Include source images in initial message
            });

            let fullResponse = '';
            let sentenceBuffer = '';
            let sentenceCount = 0;

            // Ordered audio queue: Map<sentenceNum, audioBuffer>
            const audioQueue = new Map<number, Buffer>();
            // Track audio duration per sentence for sync
            const sentenceDurations = new Map<number, number>();
            // Track word timings per sentence for word-level sync
            const wordTimingsMap = new Map<number, Array<{ word: string; start: number; end: number }>>();
            let cumulativeAudioDurationMs = 0;
            let nextSentenceToPlay = 1;
            let totalSentences = 0;
            let allSentencesQueued = false;

            // Playback loop - runs in background, plays sentences in order
            const playbackLoop = async () => {
                while (true) {
                    // Check for cancellation
                    if (this.cancelCurrentPlayback) {
                        console.log('[Playback] ⚠️ Cancelled by new message');
                        break;
                    }

                    // Check if we have the next sentence ready
                    if (audioQueue.has(nextSentenceToPlay)) {
                        const audio = audioQueue.get(nextSentenceToPlay)!;
                        audioQueue.delete(nextSentenceToPlay);

                        console.log(`[Playback] Playing sentence #${nextSentenceToPlay} in order`);
                        // AWAIT playback completion before moving to next sentence
                        await this.onAudioOutput(audio);
                        nextSentenceToPlay++;
                    }
                    // Check if we're done
                    else if (allSentencesQueued && nextSentenceToPlay > totalSentences) {
                        break;
                    }
                    // Wait a bit before checking again
                    else {
                        await new Promise(resolve => setTimeout(resolve, 30));
                    }
                }
            };

            // Start playback loop in background
            const playbackPromise = playbackLoop();

            // TTS completion handlers - now returns durations
            const ttsPromises: Promise<number>[] = [];

            // 4. Stream LLM -> Detect Sentences -> TTS each sentence immediately
            for await (const chunk of stream) {
                // Check for cancellation during LLM streaming
                if (this.cancelCurrentPlayback) {
                    console.log('[LLM] ⚠️ Cancelled by new message');
                    break;
                }

                const content = chunk.choices[0]?.delta?.content || '';
                if (!content) continue;

                fullResponse += content;
                sentenceBuffer += content;

                // Stream agent text updates (throttled slightly if needed, but per-token is usually fine)
                this.onTextOutput?.({
                    type: 'transcription',
                    role: 'assistant',
                    text: fullResponse,
                    isPartial: true,
                    id: agentMsgId
                });

                // IMPROVED: Check for sentence boundaries
                // Require punctuation followed by whitespace (space, newline) to avoid splitting "Dr." etc
                const sentenceEndMatch = sentenceBuffer.match(/^(.*?[.!?])(\s+)(.*)$/s);
                if (sentenceEndMatch) {
                    const completeSentence = sentenceEndMatch[1].trim();
                    sentenceBuffer = sentenceEndMatch[3];

                    if (completeSentence.length > 0) {
                        sentenceCount++;
                        const currentSentenceNum = sentenceCount;
                        console.log(`[TTS] Queueing sentence #${currentSentenceNum}: "${completeSentence.slice(0, 50)}..."`);

                        // Fire off TTS for this sentence (don't await - parallel synthesis)
                        const ttsPromise = this.synthesizeToQueue(
                            completeSentence,
                            currentSentenceNum,
                            audioQueue,
                            sentenceDurations,
                            wordTimingsMap
                        ).then(async (duration) => {
                            // BROADCAST INCREMENTAL TIMINGS
                            if (!this.cancelCurrentPlayback) {
                                const currentAllTimings: Array<{ word: string; start: number; end: number }> = [];
                                let cumulativeOffsetSec = 0;

                                for (let i = 1; i <= sentenceCount; i++) {
                                    if (wordTimingsMap.has(i) && sentenceDurations.has(i)) {
                                        const sentenceTimings = wordTimingsMap.get(i) || [];
                                        const sentenceDurationMs = sentenceDurations.get(i) || 0;

                                        for (const timing of sentenceTimings) {
                                            currentAllTimings.push({
                                                word: timing.word,
                                                start: timing.start + cumulativeOffsetSec,
                                                end: timing.end + cumulativeOffsetSec
                                            });
                                        }
                                        cumulativeOffsetSec += sentenceDurationMs / 1000;
                                    } else {
                                        break;
                                    }
                                }

                                if (currentAllTimings.length > 0) {
                                    console.log(`[VoicePipeline] Broadcasting incremental timings (stream): ${currentAllTimings.length} words`);
                                    this.onTextOutput?.({
                                        type: 'transcription',
                                        role: 'assistant',
                                        text: fullResponse,
                                        isPartial: true,
                                        id: agentMsgId,
                                        wordTimings: currentAllTimings,
                                        source_images: source_images
                                    });
                                }
                            }
                            return duration;
                        });
                        ttsPromises.push(ttsPromise);
                    }
                }
            }

            // Handle any remaining text that didn't end with punctuation
            if (!this.cancelCurrentPlayback && sentenceBuffer.trim().length > 0) {
                sentenceCount++;
                console.log(`[TTS] Queueing final fragment #${sentenceCount}: "${sentenceBuffer.trim().slice(0, 50)}..."`);
                const ttsPromise = this.synthesizeToQueue(
                    sentenceBuffer.trim(),
                    sentenceCount,
                    audioQueue,
                    sentenceDurations,
                    wordTimingsMap
                ).then(async (duration) => {
                    // BROADCAST INCREMENTAL TIMINGS
                    // Only broadcast if we have a contiguous block of sentences starting from 1
                    // This ensures we don't send timings for sentence 3 before sentence 2 is ready

                    const canBroadcast = () => {
                        // Check if we have durations for all sentences up to the current one
                        // Actually, we just need to broadcast what we have so far in order
                        // We track nextSequentialSentenceToBroadcast
                        return true;
                    };

                    if (!this.cancelCurrentPlayback) {
                        // Reconstruct all available timings in order
                        const currentAllTimings: Array<{ word: string; start: number; end: number }> = [];
                        let cumulativeOffsetSec = 0;

                        // We can only reliably calculate offsets for contiguous completed sentences
                        // But we want to show text ASAP. 
                        // Since audio playback is sequential, latency is mainly synthesis time.

                        // Iterate through all known sentences so far
                        for (let i = 1; i <= sentenceCount; i++) {
                            if (wordTimingsMap.has(i) && sentenceDurations.has(i)) {
                                const sentenceTimings = wordTimingsMap.get(i) || [];
                                const sentenceDurationMs = sentenceDurations.get(i) || 0;

                                for (const timing of sentenceTimings) {
                                    currentAllTimings.push({
                                        word: timing.word,
                                        start: timing.start + cumulativeOffsetSec,
                                        end: timing.end + cumulativeOffsetSec
                                    });
                                }
                                cumulativeOffsetSec += sentenceDurationMs / 1000;
                            } else {
                                // Stop at the first missing sentence to ensure timing consistency
                                // (If sentence 2 is missing, we can't know start time of sentence 3)
                                break;
                            }
                        }

                        if (currentAllTimings.length > 0) {
                            console.log(`[VoicePipeline] Broadcasting incremental timings: ${currentAllTimings.length} words`);
                            this.onTextOutput?.({
                                type: 'transcription',
                                role: 'assistant',
                                text: fullResponse, // Send current full text
                                isPartial: true, // Still partial
                                id: agentMsgId,
                                wordTimings: currentAllTimings,
                                source_images: source_images
                            });
                        }
                    }
                    return duration;
                });
                ttsPromises.push(ttsPromise);
            }

            if (!this.cancelCurrentPlayback) {
                console.log(`[Agent] ${fullResponse}`);
            }

            // Mark total sentences and that all are queued
            totalSentences = sentenceCount;
            allSentencesQueued = true;

            // Wait for all TTS to complete
            const durations = await Promise.all(ttsPromises);

            // Calculate total audio duration
            const totalAudioDurationMs = durations.reduce((sum, d) => sum + d, 0);
            console.log(`[VoicePipeline] Total audio duration: ${totalAudioDurationMs}ms for ${fullResponse.length} chars`);

            // Aggregate word timings across all sentences with cumulative time offsets
            const allWordTimings: Array<{ word: string; start: number; end: number }> = [];
            let cumulativeOffsetSec = 0;

            for (let i = 1; i <= totalSentences; i++) {
                const sentenceTimings = wordTimingsMap.get(i) || [];
                const sentenceDurationMs = sentenceDurations.get(i) || 0;

                // Offset each word's timing by cumulative duration of previous sentences
                for (const timing of sentenceTimings) {
                    allWordTimings.push({
                        word: timing.word,
                        start: timing.start + cumulativeOffsetSec,
                        end: timing.end + cumulativeOffsetSec
                    });
                }

                cumulativeOffsetSec += sentenceDurationMs / 1000;
            }

            console.log(`[VoicePipeline] Aggregated ${allWordTimings.length} word timings`);
            if (allWordTimings.length > 0) {
                console.log(`[VoicePipeline] First word: "${allWordTimings[0].word}" at ${allWordTimings[0].start}s`);
                console.log(`[VoicePipeline] Last word: "${allWordTimings[allWordTimings.length - 1].word}" at ${allWordTimings[allWordTimings.length - 1].end}s`);
            }

            // Send final text update WITH audioDurationMs and wordTimings for frontend sync
            if (!this.cancelCurrentPlayback) {
                const payload = {
                    type: 'transcription',
                    role: 'assistant',
                    text: fullResponse,
                    isPartial: false,
                    id: agentMsgId,
                    audioDurationMs: totalAudioDurationMs,
                    wordTimings: allWordTimings,
                    source_images: source_images  // Include source images in final message
                };
                console.log(`[VoicePipeline] Sending transcription with ${payload.wordTimings.length} word timings`);
                this.onTextOutput?.(payload);
            }

            // Wait for playback to finish
            await playbackPromise;

            // Update History only if not cancelled
            if (!this.cancelCurrentPlayback && fullResponse.length > 0) {
                // Save the REWRITTEN query to history so the user bubble shows the clarified intent
                // This fixes the issue where "How much is it?" is shown instead of "How much is ChatRAG?"
                // Strip quotes if present
                const cleanRewrittenQuery = rewrittenQuery.replace(/^["']|["']$/g, '');
                this.history.push({ role: 'user', content: cleanRewrittenQuery });

                // Save assistant response
                this.history.push({ role: 'assistant', content: fullResponse });

                // Store source metadata if available (sources OR images)
                const hasSources = sources && sources.length > 0;
                const hasImages = source_images && source_images.length > 0;
                if (hasSources || hasImages) {
                    // unexpected behavior: history length just increased by 2 (user + assistant)
                    // The assistant message is at index: length - 1
                    const assistantMsgIndex = this.history.length - 1;
                    this.messageMetadata.set(assistantMsgIndex, { sources, source_images });
                    console.log(`[VoicePipeline] 📎 Attached ${sources?.length || 0} sources and ${source_images?.length || 0} images to message #${assistantMsgIndex}`);
                }
            }

        } catch (error) {
            console.error('[VoicePipeline] Error processing message:', error);
        } finally {
            // Mark that we're done processing
            this.isProcessing = false;
        }
    }

    /**
     * Synthesize a sentence and add to the ordered queue.
     * Returns the audio duration in milliseconds.
     * Now uses timestamp-aware synthesis for word-level sync.
     */
    private async synthesizeToQueue(
        sentence: string,
        sentenceNum: number,
        queue: Map<number, Buffer>,
        sentenceDurations: Map<number, number>,
        wordTimingsMap?: Map<number, Array<{ word: string; start: number; end: number }>>
    ): Promise<number> {
        try {
            // Use timestamp-aware synthesis
            const { audio: sentenceAudio, wordTimings } = await this.tts.synthesizeWithTimestamps(sentence);

            // Apply longer fades to prevent pops between segments (30ms)
            this.applyFadesInPlace(sentenceAudio, 30);

            // Add small silence at the end for natural inter-sentence pause (50ms)
            const silenceSamples = Math.floor(16000 * 0.05); // 50ms at 16kHz
            const silenceBuffer = Buffer.alloc(silenceSamples * 2, 0); // 16-bit silence
            const audioWithPause = Buffer.concat([sentenceAudio, silenceBuffer]);

            // Calculate duration: audio is 16kHz, 16-bit (2 bytes per sample)
            const durationMs = Math.round((audioWithPause.length / 2) / 16000 * 1000);

            console.log(`[TTS] Sentence #${sentenceNum} ready: ${audioWithPause.length} bytes (${durationMs}ms), ${wordTimings.length} words`);

            // Store duration
            sentenceDurations.set(sentenceNum, durationMs);

            // Store word timings if map provided
            if (wordTimingsMap) {
                wordTimingsMap.set(sentenceNum, wordTimings);
                console.log(`[TTS] Stored ${wordTimings.length} word timings for sentence #${sentenceNum}`);
                if (wordTimings.length > 0) {
                    console.log(`[TTS] Sample: "${wordTimings[0].word}" at ${wordTimings[0].start}s - ${wordTimings[0].end}s`);
                }
            }

            // Add to queue - playback loop will pick it up in order
            queue.set(sentenceNum, audioWithPause);

            return durationMs;
        } catch (error) {
            console.error(`[TTS] Error synthesizing sentence #${sentenceNum}:`, error);
            return 0;
        }
    }

    // Input Mechanism commonly used by LiveKit Workers
    pushAudio(chunk: Buffer) {
        this.stt.pushAudio(chunk);
    }

    /**
     * Reset the pipeline state and clear conversation history.
     * Should be called when a new session starts or an old one ends.
     */
    public reset() {
        console.log('[VoicePipeline] resetting conversation history and state');
        this.history = [];
        this.history.push({ role: 'system', content: this.systemPrompt });
        this.messageMetadata.clear();
        this.cancelCurrentPlayback = true;
        this.isProcessing = false;
    }

    /**
     * Get the conversation history in a format suitable for saving to the database.
     * Excludes system prompts, returns only user and assistant messages.
     */
    public getConversationHistory(): Array<{ id: string; role: 'user' | 'assistant'; content: string | any[]; createdAt: Date }> {
        return this.history
            .map((m, originalIdx) => ({ m, originalIdx })) // Keep track of original index
            .filter(({ m }) => m.role !== 'system')
            .map(({ m, originalIdx }, idx) => {
                const metadata = this.messageMetadata.get(originalIdx);
                let content: string | any[] = m.content as string;

                // detailed logging
                // console.log(`[getConversationHistory] checking msg #${originalIdx} (${m.role}): metadata?`, metadata);

                // Check if we need to enrich the content with source metadata
                if (m.role === 'assistant' && (metadata?.sources || metadata?.source_images)) {
                    // Create the rich content structure expected by the frontend
                    // We structure it as a JSON array of ContentParts
                    const contentParts: any[] = [];

                    // [FIX] Add source_images FIRST (so they appear at top)
                    if (metadata.source_images && metadata.source_images.length > 0) {
                        contentParts.push({
                            type: 'source_images',
                            images: metadata.source_images.map((img: any) => ({
                                url: img.url,
                                name: img.name || 'Image',
                                type: img.type || 'image/jpeg'
                            }))
                        });
                    }

                    // Add text
                    contentParts.push({ type: 'text', text: m.content as string });

                    // Add sources if available
                    if (metadata.sources && metadata.sources.length > 0) {
                        contentParts.push({
                            type: 'tool_result',
                            toolCallId: `rag-${Date.now()}`,
                            toolName: 'knowledge_base',
                            result: {
                                documents: metadata.sources.map((s: any) => ({
                                    id: s.id,
                                    name: s.name,
                                    similarity: s.similarity
                                }))
                            }
                        });
                    }

                    content = contentParts;
                }

                return {
                    id: `voice-msg-${Date.now()}-${idx}`,
                    role: m.role as 'user' | 'assistant',
                    content: content,
                    createdAt: new Date()
                };
            });
    }

    /**
     * Check if there's a meaningful conversation to save.
     * Returns true if there's at least one user message and one assistant message.
     */
    public hasConversationToSave(): boolean {
        const userMessages = this.history.filter(m => m.role === 'user');
        const assistantMessages = this.history.filter(m => m.role === 'assistant');
        return userMessages.length > 0 && assistantMessages.length > 0;
    }

    /**
     * Save the conversation to the database via internal API.
     * Called when the voice session ends.
     * @returns The chat ID if successful, null otherwise
     */
    public async saveConversation(): Promise<string | null> {
        if (!this.hasConversationToSave()) {
            console.log('[VoicePipeline] No meaningful conversation to save');
            return null;
        }

        const messages = this.getConversationHistory();
        console.log(`[VoicePipeline] Saving conversation with ${messages.length} messages`);

        try {
            // Replace /voice-rag with /voice-chat in the API URL
            const voiceChatApiUrl = this.ragApiUrl.replace('/voice-rag', '/voice-chat');

            const response = await axios.post(
                voiceChatApiUrl,
                {
                    userId: this.userId,
                    messages: messages
                },
                {
                    headers: {
                        'x-api-key': this.ragApiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const chatId = response.data.chatId;
            console.log(`[VoicePipeline] ✅ Saved conversation as chat: ${chatId} (title: "${response.data.title}")`);
            return chatId;
        } catch (error: any) {
            console.error('[VoicePipeline] ❌ Error saving conversation:', error?.response?.data || error.message);
            return null;
        }
    }
}
