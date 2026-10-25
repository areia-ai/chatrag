import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { VoicePipeline } from './voice_agent.js';
import { AccessToken } from 'livekit-server-sdk';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    RemoteTrackPublication,
    RemoteTrack,
    TrackKind,
    AudioStream,
    AudioSource,
    AudioFrame,
    LocalAudioTrack,
    TrackPublishOptions,
    TrackSource
} from '@livekit/rtc-node';
import { v4 as uuidv4 } from 'uuid';
import * as silero from '@livekit/agents-plugin-silero';
import { VADEventType, initializeLogger } from '@livekit/agents';

// Load environment variables from .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

// Sine wave test mode - set SINE_TEST_MODE=true in .env to test LiveKit audio pipeline
const SINE_TEST_MODE = process.env.SINE_TEST_MODE === 'true';

/**
 * Generate a pure sine wave buffer for testing audio pipeline
 * @param durationSec Duration in seconds
 * @param frequency Frequency in Hz (default 440 = A4 note)
 */
function generateSineWave(durationSec: number, frequency: number = 440): Buffer {
    const sampleRate = 16000;
    const numSamples = sampleRate * durationSec;
    const buffer = Buffer.alloc(numSamples * 2); // 16-bit = 2 bytes per sample

    for (let i = 0; i < numSamples; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate);
        const int16Val = Math.round(sample * 32767 * 0.5); // 50% volume to prevent clipping
        buffer.writeInt16LE(int16Val, i * 2);
    }

    return buffer;
}

console.log('Voice Agent starting...');
console.log(`[DEBUG] SINE_TEST_MODE env value: "${process.env.SINE_TEST_MODE}" (parsed as: ${SINE_TEST_MODE})`);
if (SINE_TEST_MODE) {
    console.log('🔊 SINE TEST MODE ENABLED - Will publish test tone instead of TTS');
}

// Validate Config
const config = {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '', // Separate key for OpenRouter
    openaiBaseUrl: process.env.OPENAI_BASE_URL || '', // Optional: for OpenRouter etc.
    groqApiKey: process.env.GROQ_API_KEY || '', // Groq API Key
    llmProvider: (process.env.VOICE_AGENT_LLM_PROVIDER || 'openai') as 'openai' | 'groq' | 'openrouter', // Select provider
    llmModel: process.env.VOICE_AGENT_MODEL || 'gpt-4o', // Configurable model
    assemblyApiKey: process.env.ASSEMBLYAI_API_KEY || '',
    resembleApiKey: process.env.RESEMBLE_API_KEY || '',
    resembleVoiceId: process.env.RESEMBLE_VOICE_ID || '',
    ragApiUrl: process.env.CHATRAG_INTERNAL_API_URL || 'http://localhost:3000/api/internal/voice-rag',
    ragApiKey: process.env.CHATRAG_INTERNAL_API_KEY || '',
    livekitUrl: process.env.LIVEKIT_URL || '',
    livekitApiKey: process.env.LIVEKIT_API_KEY || '',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET || '',
    assemblyAiLanguage: process.env.ASSEMBLYAI_LANGUAGE || 'en',
    displayMode: process.env.VOICE_DISPLAY_MODE || 'orb',
    // TTS Provider Configuration
    ttsProvider: (process.env.TTS_PROVIDER || 'resemble') as 'resemble' | 'hume',
    humeApiKey: process.env.HUME_API_KEY || '',
    humeVoice: process.env.HUME_VOICE || 'Ava Song',
};

// These fields are optional and should not trigger the "missing" warning
const optionalKeys = ['openrouterApiKey', 'openaiBaseUrl', 'llmModel', 'assemblyAiLanguage', 'humeApiKey', 'humeVoice', 'ttsProvider'];

const missingKeys = Object.entries(config).filter(([key, val]) => {
    // Skip optional keys
    if (optionalKeys.includes(key)) return false;
    // Check if value is missing or placeholder
    return !val || val.includes('your_') || val === 'placeholder';
});

if (missingKeys.length > 0) {
    console.warn('---------------------------------------------------');
    console.warn('⚠️  MISSING OR PLACEHOLDER CONFIGURATION');
    console.warn('The agent cannot start fully until the following keys are set in agent/.env:');
    missingKeys.forEach(([key]) => console.warn(` - ${key}`));
    console.warn('---------------------------------------------------');
} else {
    runAgent();
}

async function runAgent() {
    // Initialize the LiveKit agents logger (required for VAD stream)
    initializeLogger({ pretty: true, level: 'info' });

    // 0. Load Silero VAD for local speech detection (barge-in/interruption)
    console.log('[Agent] Loading Silero VAD model...');
    const vad = await silero.VAD.load({
        sampleRate: 16000,  // We'll resample 48kHz to 16kHz for VAD
        minSpeechDuration: 1.0,  // 1 second of continuous speech to trigger (much less sensitive)
        minSilenceDuration: 0.5,  // 500ms silence to end speech
        activationThreshold: 0.9,  // Very high threshold to strictly reduce false positives from echo
    });
    console.log('[Agent] Silero VAD loaded successfully');

    // Create VAD stream at startup (not in event handler!)
    console.log('[Agent] Creating VAD stream...');
    const vadStream = vad.stream();
    console.log('[Agent] VAD stream created successfully');

    // Interruption state tracking
    let isAgentSpeaking = false;
    let abortPlayback = false;  // Flag to stop current audio playback
    let playbackStartTime = 0;  // Track when playback started for echo grace period
    let lastBargeInTime = 0;    // Track when last barge-in occurred for cooldown
    const BARGE_IN_COOLDOWN_MS = 5000;  // 5 second cooldown after any barge-in (prevent cascade)
    const PLAYBACK_GRACE_PERIOD_MS = 1500;  // 1.5 seconds grace at start of each playback

    // Set up VAD event listener for barge-in detection
    (async () => {
        for await (const event of vadStream) {
            if (event.type === VADEventType.START_OF_SPEECH) {
                // Only log and act when agent is speaking (barge-in scenario)
                if (isAgentSpeaking) {
                    const now = Date.now();

                    // Check for grace period (ignore interruptions at start of playback to prevent self-echo)
                    const timeSinceStart = now - playbackStartTime;
                    if (timeSinceStart < PLAYBACK_GRACE_PERIOD_MS) {
                        console.log(`[VAD] 🛡️ Ignoring barge-in during initial ${timeSinceStart}ms of playback (echo protection)`);
                        continue;
                    }

                    // Check for cooldown after previous barge-in
                    const timeSinceLastBargeIn = now - lastBargeInTime;
                    if (timeSinceLastBargeIn < BARGE_IN_COOLDOWN_MS) {
                        console.log(`[VAD] 🛡️ Ignoring barge-in during cooldown (${timeSinceLastBargeIn}ms since last)`);
                        continue;
                    }

                    console.log('[VAD] ⚡ BARGE-IN detected! User speaking over agent.');
                    abortPlayback = true;
                    lastBargeInTime = now;  // Start cooldown
                }
            }
            // Don't log END_OF_SPEECH - too noisy
        }
    })();

    // 1. Setup LiveKit Token
    const roomName = 'chatrag-voice';
    // Use a FIXED identity so only one agent can exist at a time
    // When a new agent connects with the same identity, the old one is kicked out
    const participantIdentity = 'voice-agent';

    // Use server-sdk for token generation (it's JS/TS compatible)
    const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity: participantIdentity,
    });
    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
    });
    const token = await at.toJwt();
    console.log(`[Agent] Generated token for ${participantIdentity}`);
    console.log(`[Agent] Display Mode Configured: ${config.displayMode}`);

    // 2. Setup Audio Output (Agent -> User)
    // 16kHz, 1 channel matches standard Resemble output
    const audioSource = new AudioSource(16000, 1);
    const audioTrack = LocalAudioTrack.createAudioTrack("agent-voice", audioSource);

    // 3. Initialize Pipeline - Audio Output Handler
    // This callback receives TTS audio (sentence-by-sentence) and sends it to LiveKit
    const SAMPLE_RATE = 16000;
    const CHANNELS = 1;

    // State tracking for audio publishing
    let isTrackPublished = false;

    // Playback synchronization - prevent concurrent audio capture
    let currentPlaybackId = 0;
    let isPlaybackActive = false;

    // 4. Connect to Room (Created early for pipeline access)
    const room = new Room();

    const pipeline = new VoicePipeline(config, async (completeAudioBuffer: Buffer) => {
        // Don't process audio until track is published
        if (!isTrackPublished) {
            console.log('[Agent] Track not published yet, dropping audio');
            return;
        }

        // Generate a unique ID for this playback session
        const myPlaybackId = ++currentPlaybackId;

        // Wait for any active playback to finish before starting
        while (isPlaybackActive) {
            // Check if we've been superseded by an even newer playback
            if (myPlaybackId !== currentPlaybackId) {
                console.log(`[Agent] Playback #${myPlaybackId} cancelled before starting (newer playback exists)`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Double-check we haven't been superseded
        if (myPlaybackId !== currentPlaybackId) {
            console.log(`[Agent] Playback #${myPlaybackId} cancelled (superseded by #${currentPlaybackId})`);
            return;
        }

        // Claim the playback lock
        isPlaybackActive = true;
        abortPlayback = false;
        isAgentSpeaking = true;
        playbackStartTime = Date.now();
        console.log(`[Agent] 🔊 Starting playback #${myPlaybackId}: ${completeAudioBuffer.length} bytes`);

        // Convert Buffer to Int16Array (matching sine wave test pattern)
        const totalSamples = completeAudioBuffer.length / 2; // 16-bit = 2 bytes per sample
        const audioInt16 = new Int16Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            audioInt16[i] = completeAudioBuffer.readInt16LE(i * 2);
        }

        // Send in larger chunks for SMOOTHER playback (200ms)
        // Larger frames = fewer chunk boundaries = less popping
        // Still allows barge-in detection every 200ms
        const FRAME_DURATION_MS = 200;
        const samplesPerFrame = Math.floor(SAMPLE_RATE * FRAME_DURATION_MS / 1000); // 3200 samples = 200ms

        for (let offset = 0; offset < totalSamples; offset += samplesPerFrame) {
            // 🔴 CHECK FOR INTERRUPTION before each chunk
            if (abortPlayback || myPlaybackId !== currentPlaybackId) {
                console.log(`[Agent] ⚡ Stopping playback #${myPlaybackId} at offset ${offset}/${totalSamples}`);
                break;
            }

            const frameSize = Math.min(samplesPerFrame, totalSamples - offset);
            const frameData = audioInt16.slice(offset, offset + frameSize);

            // AudioFrame(data, sampleRate, channels, samplesPerChannel)
            const frame = new AudioFrame(
                frameData,
                SAMPLE_RATE,
                CHANNELS,
                Math.trunc(frameSize / CHANNELS)
            );

            try {
                await audioSource.captureFrame(frame);
                // Reduced logging frequency - with 50ms chunks, log every 20th frame (~1 second)
                if (Math.floor(offset / samplesPerFrame) % 20 === 0) {
                    console.log(`[Agent] Playing: ${Math.round(offset / totalSamples * 100)}%`);
                }
            } catch (e: any) {
                console.error('[Agent] captureFrame error:', e.message || e);
                // If we get an InvalidState error, stop this playback
                if (e.message?.includes('InvalidState')) {
                    console.log(`[Agent] InvalidState detected, stopping playback #${myPlaybackId}`);
                    break;
                }
            }
        }

        // Release the lock
        isPlaybackActive = false;
        isAgentSpeaking = false;
        if (abortPlayback || myPlaybackId !== currentPlaybackId) {
            console.log(`[Agent] Playback #${myPlaybackId} interrupted`);
        } else {
            console.log(`[Agent] ✅ Playback #${myPlaybackId} complete`);
        }
    }, (payload: any) => {
        // onTextOutput callback - broadcast JSON via LiveKit Data
        // payload: { type: 'transcription', role, text, isPartial, id }
        if (room.localParticipant) {
            try {
                const str = JSON.stringify(payload);
                const encoder = new TextEncoder();
                const data = encoder.encode(str);
                room.localParticipant.publishData(data, { reliable: true });
            } catch (e) {
                console.error('[Agent] Error publishing text data:', e);
            }
        }
    });  // VAD handles barge-in now, no need for interim callback

    await pipeline.start();

    // Subscribe to tracks automatically
    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        if (!participant.identity.startsWith('user-')) return;
        console.log(`[LiveKit] User connected: ${participant.identity} - Resetting/Ensuring Clean History`);
        pipeline.reset();
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        // Use TrackKind from rtc-node
        if (track.kind === TrackKind.KIND_AUDIO) {
            console.log(`[LiveKit] Subscribed to audio track from ${participant.identity}`);

            // Only process audio from USER participants, not other agents
            if (!participant.identity.startsWith('user-')) {
                console.log(`[LiveKit] Ignoring audio from non-user participant: ${participant.identity}`);
                return;
            }

            console.log(`[LiveKit] Processing audio from user: ${participant.identity}`);

            // Extract User ID from identity (format: user-USER_ID-RANDOM)
            // Example: user-123e4567-e89b-12d3-a456-426614174000-832
            // We need to support the format user-{uuid}-{suffix}
            try {
                const parts = participant.identity.split('-');
                if (parts.length >= 6) {
                    // UUID has 5 parts + 'user' prefix + potential random suffix
                    // user-UUID-suffix format: the UUID is parts[1..5] joined by -
                    const userId = parts.slice(1, 6).join('-');
                    console.log(`[LiveKit] Extracted User ID: ${userId}`);
                    pipeline.setUserId(userId);
                } else {
                    console.warn(`[LiveKit] Could not extract UUID from identity: ${participant.identity}`);
                }
            } catch (e) {
                console.error('[LiveKit] Error parsing user identity:', e);
            }

            const audioStream = new AudioStream(track);
            let frameCount = 0;

            // VAD stream is created at startup - just log that we're using it
            console.log('[VAD] Using global VAD stream for barge-in detection');

            // Speak greeting to initiate the conversation
            // Use setTimeout to avoid blocking audio stream setup
            setTimeout(async () => {
                console.log('[Agent] 🎙️ Speaking welcome greeting...');
                await pipeline.speakGreeting();
            }, 500); // Small delay to ensure audio track is ready

            const processStream = async () => {
                console.log('[Audio] Starting processStream loop...');
                let bufferAccumulator: Buffer = Buffer.alloc(0);
                // AssemblyAI requires 50-1000ms chunks. At 48kHz 16-bit mono:
                // 100ms = 48000 * 0.1 * 2 = 9600 bytes
                const TARGET_SAMPLE_RATE = 48000;
                const MIN_BUFFER_SIZE = 9600; // 100ms at 48kHz 16-bit mono

                // Simple linear resampling function
                const resampleAudio = (inputBuffer: Buffer, inputRate: number, outputRate: number): Buffer => {
                    if (inputRate === outputRate) return inputBuffer;

                    const inputSamples = new Int16Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.length / 2);
                    const ratio = inputRate / outputRate;
                    const outputLength = Math.round(inputSamples.length / ratio);
                    const outputSamples = new Int16Array(outputLength);

                    for (let i = 0; i < outputLength; i++) {
                        const position = i * ratio;
                        const index = Math.floor(position);
                        const fraction = position - index;

                        if (index >= inputSamples.length - 1) {
                            outputSamples[i] = inputSamples[inputSamples.length - 1];
                        } else {
                            // Linear interpolation
                            const a = inputSamples[index];
                            const b = inputSamples[index + 1];
                            outputSamples[i] = Math.round(a + (b - a) * fraction);
                        }
                    }

                    return Buffer.from(outputSamples.buffer);
                };

                try {
                    for await (const frame of audioStream) {
                        frameCount++;
                        // DYNAMIC SAMPLE RATE DETECTION
                        const inputSampleRate = frame.sampleRate || 48000; // Default to 48k if undefined

                        // Log every 100 frames (about every 2 seconds at typical rates)
                        if (frameCount % 100 === 1) {
                            console.log(`[Audio Debug] Received frame #${frameCount}, size: ${frame.data.byteLength} bytes, rate: ${inputSampleRate}Hz`);
                        }

                        // 1. VAD PROCESSING (Target 16kHz)
                        // Dynamic resampling for VAD
                        const vadTargetRate = 16000;
                        const vadResampledBuffer = resampleAudio(
                            Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength),
                            inputSampleRate,
                            vadTargetRate
                        );
                        
                        // Create AudioFrame for VAD (16kHz)
                        const vadInt16 = new Int16Array(vadResampledBuffer.buffer, vadResampledBuffer.byteOffset, vadResampledBuffer.length / 2);
                        const vadFrame = new AudioFrame(
                            vadInt16,
                            vadTargetRate,
                            1,
                            vadInt16.length
                        );
                        vadStream.pushFrame(vadFrame);

                        // 2. STT PROCESSING (Target 48kHz for AssemblyAI)
                        // Get raw data
                        const rawBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
                        
                        // Resample to 48kHz if necessary
                        const sttBuffer = resampleAudio(rawBuffer, inputSampleRate, TARGET_SAMPLE_RATE);

                        bufferAccumulator = Buffer.concat([bufferAccumulator, sttBuffer]);

                        if (bufferAccumulator.length >= MIN_BUFFER_SIZE) {
                            pipeline.pushAudio(bufferAccumulator);
                            bufferAccumulator = Buffer.alloc(0);
                        }
                    }
                } catch (error) {
                    console.error('[LiveKit] Audio stream error:', error);
                }
            };

            processStream();
        }
    });

    // Handle user disconnect - save conversation to database
    room.on(RoomEvent.ParticipantDisconnected, async (participant: RemoteParticipant) => {
        // Only process user disconnections (not other agents)
        if (!participant.identity.startsWith('user-')) {
            console.log(`[LiveKit] Non-user participant disconnected: ${participant.identity}`);
            return;
        }

        console.log(`[LiveKit] User disconnected: ${participant.identity}`);
        console.log('[LiveKit] Saving voice conversation...');

        try {
            const chatId = await pipeline.saveConversation();
            if (chatId) {
                console.log(`[LiveKit] ✅ Voice conversation saved as chat: ${chatId}`);
            } else {
                console.log('[LiveKit] No conversation to save (either too short or error)');
            }
        } catch (error) {
            console.error('[LiveKit] Error saving conversation on disconnect:', error);
        } finally {
            // ALWAYS reset the pipeline history when a user leaves
            // This prevents the next user (or same user reconnecting) from seeing previous chat history
            pipeline.reset();
        }
    });

    try {
        await room.connect(config.livekitUrl, token);
        console.log(`[LiveKit] Connected to room: ${roomName}`);

        // 5. Publish Agent Audio
        if (!room.localParticipant) {
            throw new Error('Local participant not available after connection');
        }

        // Publish attributes (display mode)
        await room.localParticipant.setAttributes({
            displayMode: config.displayMode
        });
        console.log(`[LiveKit] Published attributes: displayMode=${config.displayMode}`);

        // FALLBACK: Also broadcast config via Data Packet to ensure frontend gets it
        const sendConfig = async () => {
            const configPayload = JSON.stringify({
                type: 'config',
                displayMode: config.displayMode
            });
            const encoder = new TextEncoder();
            if (room.localParticipant) {
                await room.localParticipant.publishData(encoder.encode(configPayload), { reliable: true });
                console.log(`[LiveKit] Broadcasted config packet: ${configPayload}`);
            } else {
                console.warn('[LiveKit] Cannot send config: localParticipant not available');
            }
        };

        // Send immediately
        await sendConfig();

        // Send whenever a user joins (to ensure they get the initial state)
        room.on(RoomEvent.ParticipantConnected, async () => {
            console.log('[LiveKit] New user connected, resending config...');
            await new Promise(r => setTimeout(r, 500)); // Short delay to ensure client is ready
            await sendConfig();
        });

        // Configure track publish options - SOURCE_MICROPHONE is required for audio
        const publishOptions = new TrackPublishOptions();
        publishOptions.source = TrackSource.SOURCE_MICROPHONE;

        await room.localParticipant.publishTrack(audioTrack, publishOptions);
        console.log('[LiveKit] Agent audio track published with SOURCE_MICROPHONE');

        // Wait for codec negotiation to complete before allowing audio capture
        console.log('[Agent] Waiting 1 second for track negotiation...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        isTrackPublished = true;
        console.log('[Agent] Track published and ready for audio capture');

        // 6. SINE TEST MODE - Wait for user then publish test tone
        if (SINE_TEST_MODE) {
            console.log('[Agent] SINE TEST MODE: Waiting for a user to join...');
            console.log('[Agent] Click "Start Voice" in the frontend to trigger the test.');

            // Function to play sine wave
            const playSineWave = async () => {
                // CRITICAL: Wait for track negotiation to complete before sending audio
                console.log('[Agent] User detected! Waiting 2 seconds for track negotiation...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                console.log('[Agent] 🎵 Playing 3-second 440Hz sine wave test tone...');

                // Generate sine wave directly as Int16Array
                const SAMPLE_RATE = 16000;
                const CHANNELS = 1;
                const DURATION_SEC = 3;
                const FREQUENCY = 440;
                const totalSamples = SAMPLE_RATE * DURATION_SEC;

                const sineInt16 = new Int16Array(totalSamples);
                for (let i = 0; i < totalSamples; i++) {
                    const sample = Math.sin(2 * Math.PI * FREQUENCY * i / SAMPLE_RATE);
                    sineInt16[i] = Math.round(sample * 32767 * 0.5); // 50% volume
                }

                // Send in 1-second chunks
                const FRAME_DURATION_SEC = 1;
                const samplesPerFrame = SAMPLE_RATE * FRAME_DURATION_SEC;

                for (let offset = 0; offset < totalSamples; offset += samplesPerFrame) {
                    const frameSize = Math.min(samplesPerFrame, totalSamples - offset);
                    const frameData = sineInt16.slice(offset, offset + frameSize);

                    // AudioFrame(data, sampleRate, channels, samplesPerChannel)
                    const frame = new AudioFrame(
                        frameData,
                        SAMPLE_RATE,
                        CHANNELS,
                        Math.trunc(frameSize / CHANNELS)
                    );

                    try {
                        await audioSource.captureFrame(frame);
                        console.log(`[Agent] Captured frame: ${frameSize} samples at offset ${offset}`);
                    } catch (e) {
                        console.error('[Agent] Sine test captureFrame error:', e);
                    }
                }
                console.log('[Agent] ✅ Sine wave test complete. Did you hear the tone?');
            };

            // Listen for user participants to join
            room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
                // Only trigger for user participants (not other agents)
                if (participant.identity.startsWith('user-')) {
                    console.log(`[Agent] User "${participant.identity}" joined!`);
                    playSineWave();
                }
            });

            // Also check if user is already in the room
            for (const [, participant] of room.remoteParticipants) {
                if (participant.identity.startsWith('user-')) {
                    console.log(`[Agent] User "${participant.identity}" already in room!`);
                    playSineWave();
                    break;
                }
            }
        }

    } catch (e) {
        console.error('[LiveKit] Connection Error:', e);
    }
}
