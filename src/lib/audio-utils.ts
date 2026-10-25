// Keep track of the current audio element and state
let currentAudio: HTMLAudioElement | null = null;
let currentMediaSource: MediaSource | null = null;
let currentSourceBuffer: SourceBuffer | null = null;

// Global shared AudioContext
let sharedAudioContext: AudioContext | null = null;
let audioContextInitialized = false;
let audioUnlockListenersAdded = false;
let audioUnlocked = false;

// PERSISTENT AUDIO ELEMENT FOR iOS
// iOS Safari requires audio to be played during a user gesture to "unlock" it.
// Once an Audio element has been played during a user gesture, it can be reused
// for programmatic playback. This is the key to making notification sounds work
// after AI responses (which are NOT user gestures).
let unlockedAudioElement: HTMLAudioElement | null = null;

// Base64-encoded silent MP3 - required for iOS Safari audio unlock
const SILENT_MP3_BASE64 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYVAQCmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYVAQCmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Get the unlocked audio element (for iOS programmatic playback)
export function getUnlockedAudioElement(): HTMLAudioElement | null {
  return unlockedAudioElement;
}

// Check if iOS audio is unlocked
export function isIOSAudioUnlocked(): boolean {
  return audioUnlocked && unlockedAudioElement !== null;
}

// CRITICAL FOR MOBILE: Set up unlock listeners on first user interaction
// iOS Safari requires audio to be initiated from a direct DOM event handler
function setupAudioUnlockListeners() {
  if (typeof window === 'undefined' || audioUnlockListenersAdded) return;

  const unlockEvents = ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'];

  const unlockAudio = async () => {
    if (audioUnlocked) return;

    console.log('[Audio] Attempting to unlock audio on user interaction...');

    try {
      // CRITICAL: Create the persistent Audio element during user gesture
      // This element will be reused for all future notification sounds
      unlockedAudioElement = new Audio();
      unlockedAudioElement.setAttribute('playsinline', 'true');
      unlockedAudioElement.setAttribute('webkit-playsinline', 'true');
      unlockedAudioElement.volume = 0.01;

      // Load silent audio and play it to unlock
      unlockedAudioElement.src = SILENT_MP3_BASE64;

      try {
        await unlockedAudioElement.play();
        console.log('[Audio] Persistent Audio element unlocked successfully!');
      } catch (e) {
        console.warn('[Audio] Persistent Audio element play failed:', e);
      }

      // Also unlock Web Audio API context for non-iOS devices
      if (!sharedAudioContext) {
        sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('[Audio] AudioContext created, state:', sharedAudioContext.state);
      }

      if (sharedAudioContext.state === 'suspended') {
        try {
          await sharedAudioContext.resume();
          console.log('[Audio] AudioContext resumed, state:', sharedAudioContext.state);
        } catch (e) {
          console.warn('[Audio] AudioContext resume failed:', e);
        }
      }

      // Play silent buffer through Web Audio API
      try {
        const silentBuffer = sharedAudioContext.createBuffer(1, 1, 22050);
        const silentSource = sharedAudioContext.createBufferSource();
        silentSource.buffer = silentBuffer;
        silentSource.connect(sharedAudioContext.destination);
        silentSource.start(0);
        console.log('[Audio] Silent buffer played through AudioContext');
      } catch (e) {
        console.warn('[Audio] Silent buffer play failed:', e);
      }

      audioUnlocked = true;
      audioContextInitialized = true;

      // Remove listeners after unlock
      unlockEvents.forEach(event => {
        document.body.removeEventListener(event, unlockAudio, true);
        document.removeEventListener(event, unlockAudio, true);
      });

      console.log('[Audio] Audio unlock complete. Persistent element created:', !!unlockedAudioElement);
    } catch (e) {
      console.warn('[Audio] Audio unlock failed, will retry:', e);
    }
  };

  // Add listeners to both body and document with capture=true
  unlockEvents.forEach(event => {
    document.body.addEventListener(event, unlockAudio, true);
    document.addEventListener(event, unlockAudio, true);
  });

  audioUnlockListenersAdded = true;
  console.log('[Audio] Unlock listeners registered for:', unlockEvents.join(', '));
}

// Auto-setup unlock listeners when this module is imported
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAudioUnlockListeners);
  } else {
    setupAudioUnlockListeners();
  }
}

// State management
interface AudioState {
  isPlaying: boolean;
  isLoading: boolean;
}

const state: AudioState = {
  isPlaying: false,
  isLoading: false
};

let stateChangeCallback: ((state: AudioState) => void) | null = null;

// Function to update state and notify listeners
function updateState(newState: Partial<AudioState>) {
  Object.assign(state, newState);
  if (stateChangeCallback) {
    stateChangeCallback({ ...state });
  }
}

// Export function to initialize audio context on user interaction
export function initializeAudioContext(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    if (!sharedAudioContext) {
      // Only create AudioContext after user gesture to avoid browser warnings
      sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Debug: Shared AudioContext created after user gesture
    }

    // Check if context is suspended (common in Safari and sometimes Chrome)
    if (sharedAudioContext.state === 'suspended') {
      // Debug: AudioContext is suspended, attempting to resume

      // Get user agent to check for Safari
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

      if (isSafari) {
        // Debug: Detected Safari browser, waiting for resume promise
        // For Safari, we need to handle resume differently
        // The promise might be pending until user interaction
        sharedAudioContext.resume().then(() => {
          // Debug: Safari AudioContext resumed successfully
          audioContextInitialized = true;
        }).catch(err => {
          console.error('Failed to resume Safari AudioContext:', err);
        });
      } else {
        // For other browsers, we can try to resume immediately
        try {
          sharedAudioContext.resume();
          // Debug: AudioContext resumed successfully
          audioContextInitialized = true;
        } catch (err) {
          console.error('Error resuming AudioContext:', err);
          return false;
        }
      }
    } else {
      audioContextInitialized = true;
    }

    // Play a silent sound to fully activate the audio context
    try {
      const oscillator = sharedAudioContext.createOscillator();
      const gainNode = sharedAudioContext.createGain();
      gainNode.gain.value = 0; // Silent
      oscillator.connect(gainNode);
      gainNode.connect(sharedAudioContext.destination);
      oscillator.start();
      oscillator.stop(sharedAudioContext.currentTime + 0.001);
      // Debug: Successfully played silent sound to activate AudioContext
    } catch (error) {
      console.warn('Error playing silent sound:', error);
      // Continue anyway, as this is just an extra step
    }

    return true;
  } catch (error) {
    console.error('Error initializing shared AudioContext:', error);
    return false;
  }
}

// Check if audio context is ready
export function isAudioContextReady(): boolean {
  return !!sharedAudioContext && audioContextInitialized &&
    (sharedAudioContext.state === 'running' || sharedAudioContext.state === 'closed');
}

// Export function to register state change listener
export function onAudioStateChange(callback: (state: AudioState) => void) {
  stateChangeCallback = callback;
  // Initial state notification
  callback({ ...state });
  return () => {
    if (stateChangeCallback === callback) {
      stateChangeCallback = null;
    }
  };
}

// Cache for audio data during session
const audioCache = new Map<string, ArrayBuffer>();

// Callback for when audio finishes
let onAudioComplete: (() => void) | null = null;

// Function to get cached audio as blob
export function getCachedAudioBlob(text: string): Blob | null {
  const cached = audioCache.get(text);
  if (!cached) return null;
  return new Blob([cached], { type: 'audio/mpeg' });
}

// Function to check if audio is cached
export function isAudioCached(text: string): boolean {
  return audioCache.has(text);
}

// Function to generate a filename for the audio
export function generateAudioFilename(text: string): string {
  // Get first 30 characters of the text, remove special characters
  const textSnippet = text.slice(0, 30)
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  // Add timestamp for uniqueness
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return `ChatRAG-${textSnippet}-${timestamp}.mp3`;
}

/**
 * Generates a beep tone as a base64-encoded WAV data URL
 * This is used for iOS Safari which works better with HTML5 Audio than Web Audio API
 */
function generateBeepWavDataURL(soundType: string, volume: number): string {
  // Define frequencies for different sound types
  const frequencies: Record<string, number[]> = {
    'bell': [880, 1047],    // A5, C6 - bright bell tones
    'soft': [523, 659],     // C5, E5 - softer tones
    'low': [349, 392],      // F4, G4 - lower tones
    'subtle': [440, 494]    // A4, B4 - subtle tones
  };

  const freqs = frequencies[soundType] || frequencies.soft;
  const sampleRate = 22050;  // Lower sample rate for smaller file
  const duration = 0.3;      // 300ms total
  const numSamples = Math.floor(sampleRate * duration);

  // Create WAV file data
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  // Create buffer for WAV file
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // Subchunk1Size
  view.setUint16(20, 1, true);            // AudioFormat (PCM)
  view.setUint16(22, numChannels, true);  // NumChannels
  view.setUint32(24, sampleRate, true);   // SampleRate
  view.setUint32(28, byteRate, true);     // ByteRate
  view.setUint16(32, blockAlign, true);   // BlockAlign
  view.setUint16(34, bitsPerSample, true);// BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);     // Subchunk2Size

  // Generate audio samples - two-tone beep with envelope
  const vol = Math.min(1, Math.max(0.1, volume)) * 0.8; // Scale down to avoid clipping

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // Envelope: fade in and out
    let envelope = 1;
    const attackTime = 0.02;
    const releaseTime = 0.05;
    if (t < attackTime) {
      envelope = t / attackTime;
    } else if (t > duration - releaseTime) {
      envelope = (duration - t) / releaseTime;
    }

    // Two frequencies for a richer tone
    const sample1 = Math.sin(2 * Math.PI * freqs[0] * t);
    const sample2 = Math.sin(2 * Math.PI * freqs[1] * t) * 0.5;
    const sample = (sample1 + sample2) * envelope * vol;

    // Convert to 16-bit PCM
    const pcmValue = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, pcmValue, true);
  }

  // Convert to base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return 'data:audio/wav;base64,' + btoa(binary);
}

/**
 * Plays a notification sound.
 * 
 * iOS SAFARI COMPATIBILITY:
 * iOS Safari is very strict about Web Audio API but more lenient with HTML5 Audio.
 * This implementation uses HTML5 Audio with a base64-encoded WAV beep as the primary
 * method for iOS devices, with Web Audio API as a fallback for desktop browsers.
 * 
 * @param volume - Optional volume level between 0 and 1 (default 0.7)
 * @param soundType - Type of notification sound to play ('bell', 'soft', 'low', 'subtle') (default 'soft')
 * @returns Promise that resolves when the sound has finished playing
 */
export async function playNotificationSound(volume: number = 0.7, soundType: 'bell' | 'soft' | 'low' | 'subtle' = 'soft'): Promise<void> {
  console.log('[playNotificationSound] Called with volume:', volume, 'soundType:', soundType);

  // Safety check for non-browser environments
  if (typeof window === 'undefined') {
    return;
  }

  // Detect iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  console.log('[playNotificationSound] Is iOS device:', isIOS);

  try {
    // For iOS devices, use the PRE-UNLOCKED Audio element
    // This is the key: we reuse the element that was unlocked during user gesture
    if (isIOS) {
      console.log('[playNotificationSound] Using pre-unlocked Audio element for iOS');
      console.log('[playNotificationSound] Unlocked element exists:', !!unlockedAudioElement);

      // Generate the beep tone as base64 WAV
      const beepWav = generateBeepWavDataURL(soundType, volume);

      // CRITICAL: Use the pre-unlocked Audio element, not a new one
      // This element was created and played during a user gesture, so it can
      // now be reused for programmatic playback
      if (unlockedAudioElement) {
        console.log('[playNotificationSound] Using unlocked element for playback');

        // Update the source to the beep sound
        unlockedAudioElement.src = beepWav;
        unlockedAudioElement.volume = Math.min(1, Math.max(0.1, volume));

        return new Promise((resolve, reject) => {
          const handleEnded = () => {
            console.log('[playNotificationSound] Unlocked element playback ended successfully');
            unlockedAudioElement!.removeEventListener('ended', handleEnded);
            unlockedAudioElement!.removeEventListener('error', handleError);
            resolve();
          };

          const handleError = (e: Event) => {
            console.error('[playNotificationSound] Unlocked element error:', e);
            unlockedAudioElement!.removeEventListener('ended', handleEnded);
            unlockedAudioElement!.removeEventListener('error', handleError);
            reject(e);
          };

          unlockedAudioElement!.addEventListener('ended', handleEnded);
          unlockedAudioElement!.addEventListener('error', handleError);

          unlockedAudioElement!.play()
            .then(() => {
              console.log('[playNotificationSound] Unlocked element play() succeeded!');
            })
            .catch((e) => {
              console.error('[playNotificationSound] Unlocked element play() failed:', e);
              // Fallback: try creating a new Audio element anyway
              console.log('[playNotificationSound] Attempting fallback with new Audio element...');
              const fallbackAudio = new Audio(beepWav);
              fallbackAudio.volume = Math.min(1, Math.max(0.1, volume));
              fallbackAudio.play()
                .then(() => console.log('[playNotificationSound] Fallback succeeded'))
                .catch((e2) => console.error('[playNotificationSound] Fallback also failed:', e2));
              reject(e);
            });
        });
      } else {
        // No unlocked element - user hasn't interacted with the page yet
        console.warn('[playNotificationSound] No unlocked Audio element available - user needs to interact with page first');

        // Still try with a new element (might work if called from user gesture like Play Sound button)
        const audio = new Audio(beepWav);
        audio.volume = Math.min(1, Math.max(0.1, volume));
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');

        return new Promise((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = (e) => reject(e);
          audio.play().catch(reject);
        });
      }
    }

    // For non-iOS devices, use Web Audio API (which is more flexible)
    console.log('[playNotificationSound] Using Web Audio API method for non-iOS');

    // Ensure unlock listeners are set up
    setupAudioUnlockListeners();

    // Create AudioContext if it doesn't exist
    if (!sharedAudioContext) {
      sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextInitialized = true;
    }

    // Resume if suspended
    if (sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume();
    }

    console.log('[playNotificationSound] AudioContext state:', sharedAudioContext.state);

    // Define the tone pairs for each sound type (first tone, second tone)
    const tonePairs = {
      'bell': [780, 880],     // Higher pitched bell tones
      'soft': [520, 580],     // Medium pitched, softer tones
      'low': [350, 380],      // Low pitched tones
      'subtle': [450, 490]    // Subtle, closer together tones
    };

    // Define durations for each sound type (first tone, gap, second tone)
    const durations = {
      'bell': [0.2, 0.05, 0.3],
      'soft': [0.15, 0.05, 0.25],
      'low': [0.25, 0.1, 0.4],
      'subtle': [0.1, 0.05, 0.15]
    };

    // Get the selected tone pair and durations
    const tones = tonePairs[soundType] || tonePairs.soft;
    const timing = durations[soundType] || durations.soft;
    const totalDuration = (timing[0] + timing[1] + timing[2]) * 1000;

    // Debug: Using two-tone notification sound

    // Create gain node for volume control
    const gainNode = sharedAudioContext!.createGain();
    gainNode.connect(sharedAudioContext!.destination);
    gainNode.gain.value = Math.min(1, Math.max(0, volume));
    // Debug: Audio gain set

    // First tone
    const oscillator1 = sharedAudioContext!.createOscillator();
    oscillator1.type = 'sine';
    oscillator1.frequency.value = tones[0];
    oscillator1.connect(gainNode);

    // Schedule the first tone
    const startTime = sharedAudioContext!.currentTime;
    oscillator1.start(startTime);
    oscillator1.stop(startTime + timing[0]);

    // Second tone (after delay)
    const oscillator2 = sharedAudioContext!.createOscillator();
    oscillator2.type = 'sine';
    oscillator2.frequency.value = tones[1];
    oscillator2.connect(gainNode);

    // Schedule the second tone
    const secondToneStart = startTime + timing[0] + timing[1];
    oscillator2.start(secondToneStart);
    oscillator2.stop(secondToneStart + timing[2]);

    // Set envelope for each oscillator
    // First tone fade out
    gainNode.gain.setValueAtTime(gainNode.gain.value, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + timing[0]);

    // Second tone fade in and out
    gainNode.gain.setValueAtTime(gainNode.gain.value, secondToneStart);
    gainNode.gain.exponentialRampToValueAtTime(0.001, secondToneStart + timing[2]);

    // Return a promise that resolves after the sound is finished
    return new Promise((resolve) => {
      setTimeout(() => {
        // Debug: Notification sound completed
        resolve();
      }, totalDuration + 100); // Add a small buffer
    });
  } catch (error) {
    console.error('Error playing notification sound:', error);
    // Don't throw, just log and continue
  }
}

// Helper function to safely append chunk to source buffer
async function appendChunkToSourceBuffer(chunk: Uint8Array): Promise<void> {
  if (!currentSourceBuffer || !currentMediaSource) return;

  // Check if MediaSource is still open
  if (currentMediaSource.readyState !== 'open') {
    // Debug: MediaSource is not open, cannot append chunk
    return;
  }

  return new Promise((resolve, reject) => {
    const appendChunk = () => {
      try {
        if (!currentSourceBuffer || !currentMediaSource) {
          reject(new Error('SourceBuffer or MediaSource was cleared'));
          return;
        }

        if (currentMediaSource.readyState !== 'open') {
          reject(new Error('MediaSource is not open'));
          return;
        }

        if (currentSourceBuffer.updating) {
          currentSourceBuffer.addEventListener('updateend', appendChunk, { once: true });
          return;
        }

        currentSourceBuffer.appendBuffer(chunk);
        resolve();
      } catch (error) {
        console.error('Error appending chunk:', error);
        reject(error);
      }
    };
    appendChunk();
  });
}

export async function textToSpeech(text: string, onComplete?: () => void, options?: { provider?: string; voiceId?: string }): Promise<Blob> {
  // Debug: Starting Text-to-Speech

  // Set completion callback
  onAudioComplete = onComplete || null;

  // Set initial loading state
  updateState({ isLoading: true, isPlaying: false });

  // Stop any currently playing audio
  await stopAudioPlayback();

  // Cache key for this request
  const provider = options?.provider || 'openai';
  const voiceId = options?.voiceId;
  const cacheKey = `${provider}-${text}`;

  // Will hold cloned response for mobile fallback
  let responseClone: Response | null = null;
  let response: Response;

  try {
    // Check cache first
    const cached = audioCache.get(cacheKey);
    if (cached) {
      // Debug: Using cached audio
      const blob = new Blob([cached], { type: 'audio/mpeg' });
      await playAudio(blob);
      return blob;
    }

    // MOBILE DETECTION: Check if device is mobile
    const isMobile = typeof window !== 'undefined' && (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.matchMedia('(pointer: coarse)').matches
    );

    // GET URL STRATEGY (Instant Streaming for Mobile)
    // iOS/Mobile Safari streams best when directly setting audio.src = url
    // This bypasses the fetch -> blob -> play cycle which causes delays

    // Check URL length for GET request suitability
    let getUrl = `/api/audio?action=speech&text=${encodeURIComponent(text)}&provider=${provider}`;
    if (voiceId) {
      getUrl += `&voiceId=${encodeURIComponent(voiceId)}`;
    }

    // If we're on mobile and the URL is within safe limits (~2000 chars),
    // we use the direct URL approach. 
    if (isMobile && getUrl.length < 2048) {
      console.log('[Audio] Using direct URL streaming for mobile (Fastest)');

      // Start playing immediately
      await playAudio(getUrl);

      // Return a dummy blob to satisfy type signature
      return new Blob([], { type: 'audio/mpeg' });
    }

    // fallback/Desktop/Long-Text Path: Make POST request
    const formData = new FormData();
    formData.append('text', text);
    formData.append('action', 'speech');

    if (options?.provider) {
      formData.append('provider', options.provider);
    }

    if (options?.voiceId) {
      formData.append('voiceId', options.voiceId);
    }

    // Make API request
    response = await fetch('/api/audio', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok || !response.body) {
      throw new Error('Failed to convert text to speech');
    }

    // Check if MediaSource is available at all
    const hasMediaSourceSupport = typeof MediaSource !== 'undefined' &&
      typeof MediaSource.isTypeSupported === 'function' &&
      MediaSource.isTypeSupported('audio/mpeg');

    // If MediaSource is completely unavailable, use non-streaming
    if (!hasMediaSourceSupport) {
      console.log('[Audio] MediaSource not supported, using non-streaming fallback');
      const audioBlob = await response.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();
      audioCache.set(cacheKey, arrayBuffer);
      await playAudio(audioBlob);
      return audioBlob;
    }

    // iOS/Mobile specific: clone response for potential fallback
    // Note: response.clone() must be called before the body is consumed
    responseClone = isMobile ? response.clone() : null;

    // Try streaming approach first (works on desktop and newer mobile browsers)
    currentMediaSource = new MediaSource();
    currentAudio = new Audio();
    const mediaSourceUrl = URL.createObjectURL(currentMediaSource);
    currentAudio.src = mediaSourceUrl;

    // Set mobile-friendly attributes for streaming audio
    currentAudio.setAttribute('playsinline', 'true');
    currentAudio.setAttribute('webkit-playsinline', 'true');

    // Set up audio event handlers early
    let playbackStarted = false;
    currentAudio.oncanplay = () => {
      if (!playbackStarted && currentAudio) {
        // Debug: Starting playback
        currentAudio.play().catch(error => {
          console.error('Error starting playback:', error);
        });
        playbackStarted = true;
        updateState({ isLoading: false, isPlaying: true });
      }
    };

    currentAudio.onended = () => {
      // Debug: Playback ended naturally
      handlePlaybackEnd();
    };

    currentAudio.onerror = () => {
      const error = currentAudio?.error;
      console.error('Audio playback error:', error ? {
        code: error.code,
        message: error.message
      } : 'Unknown error');
      handlePlaybackEnd();
    };

    // Wait for MediaSource to open with timeout
    // iOS Safari sometimes stalls here without erroring
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('MediaSource open timeout'));
      }, 2000); // 2 second timeout for initial setup

      const onSourceOpen = () => {
        clearTimeout(timeoutId);
        try {
          // Debug: MediaSource opened
          if (!currentMediaSource || currentMediaSource.readyState !== 'open') {
            reject(new Error('MediaSource is not in open state'));
            return;
          }

          const sourceBuffer = currentMediaSource.addSourceBuffer('audio/mpeg');
          currentSourceBuffer = sourceBuffer;
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      currentMediaSource!.addEventListener('sourceopen', onSourceOpen, { once: true });
    });

    // Process the stream
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { value: chunk, done } = await reader.read();

      if (done) {
        // Debug: Stream complete
        if (currentSourceBuffer && currentMediaSource?.readyState === 'open') {
          await new Promise<void>((resolve) => {
            const endStream = () => {
              if (currentMediaSource?.readyState === 'open') {
                currentMediaSource.endOfStream();
              }
              resolve();
            };

            // Check if SourceBuffer exists and is updating
            const sourceBuffer = currentSourceBuffer;
            if (sourceBuffer && sourceBuffer.updating) {
              sourceBuffer.addEventListener('updateend', endStream, { once: true });
            } else {
              endStream();
            }
          });
        }
        break;
      }

      // Debug: Received chunk
      chunks.push(chunk);
      totalLength += chunk.length;

      // Append chunk to source buffer
      try {
        await appendChunkToSourceBuffer(chunk);
      } catch (error) {
        console.error('Error appending chunk:', error);
        handlePlaybackEnd();
        throw error;
      }
    }

    // Combine chunks for caching
    const completeBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      completeBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Cache the complete audio with provider-specific key
    audioCache.set(cacheKey, completeBuffer.buffer);
    // Debug: Audio cached successfully

    // Return the complete audio blob
    return new Blob([completeBuffer], { type: 'audio/mpeg' });
  } catch (error) {
    console.error('Error in textToSpeech:', error);

    // On mobile, if streaming failed, try non-streaming fallback with cloned response
    if (responseClone) {
      console.log('[Audio] Streaming failed on mobile, trying non-streaming fallback');
      try {
        handlePlaybackEnd(); // Clean up failed streaming attempt
        const audioBlob = await responseClone.blob();
        const arrayBuffer = await audioBlob.arrayBuffer();
        audioCache.set(cacheKey, arrayBuffer);
        await playAudio(audioBlob);
        return audioBlob;
      } catch (fallbackError) {
        console.error('Non-streaming fallback also failed:', fallbackError);
        handlePlaybackEnd();
        throw fallbackError;
      }
    }

    handlePlaybackEnd();
    throw error;
  }
}

// Helper function to play audio and manage state
async function playAudio(source: Blob | string): Promise<void> {
  // Debug: Starting audio playback
  try {
    if (currentAudio) {
      await stopAudioPlayback();
    }

    // Determine URL from source
    const audioUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

    // Try to use the unlocked audio element for iOS compatibility
    // The unlocked element was created during user gesture and can be reused
    if (unlockedAudioElement && audioUnlocked) {
      console.log('[Audio] Using unlocked audio element for playback');
      currentAudio = unlockedAudioElement;
      currentAudio.volume = 1.0; // Reset volume from unlock
    } else {
      console.log('[Audio] Creating new audio element for playback');
      currentAudio = new Audio();
    }

    // Set mobile-friendly attributes
    currentAudio.setAttribute('playsinline', 'true');
    currentAudio.setAttribute('webkit-playsinline', 'true');

    // Set preload to auto for faster loading
    currentAudio.preload = 'auto';

    return new Promise((resolve, reject) => {
      if (!currentAudio) return reject(new Error('No audio element'));

      let hasStartedPlaying = false;

      // Try to play as soon as possible - don't wait for full buffer
      const tryPlay = () => {
        if (hasStartedPlaying || !currentAudio) return;
        hasStartedPlaying = true;

        currentAudio.play()
          .then(() => {
            console.log('[Audio] Playback started successfully');
            updateState({ isLoading: false, isPlaying: true });
          })
          .catch(err => {
            console.error('Error starting playback:', err);
            // On iOS, if play fails with unlocked element, try new Audio
            if (currentAudio === unlockedAudioElement) {
              console.log('[Audio] Unlocked element failed, trying new Audio element');
              hasStartedPlaying = false;
              currentAudio = new Audio();
              currentAudio.setAttribute('playsinline', 'true');
              currentAudio.setAttribute('webkit-playsinline', 'true');
              currentAudio.preload = 'auto';
              currentAudio.src = audioUrl;
              // Try again with new element
              currentAudio.onloadeddata = tryPlay;
              currentAudio.load();
            } else {
              handlePlaybackEnd();
              reject(err);
            }
          });
      };

      // Use loadeddata for fastest start (fires when first frame is available)
      currentAudio.onloadeddata = tryPlay;

      // Also try on canplay as backup
      currentAudio.oncanplay = tryPlay;

      currentAudio.onended = () => {
        console.log('[Audio] Playback ended');
        handlePlaybackEnd();
        resolve();
      };

      currentAudio.onerror = () => {
        const error = currentAudio?.error;
        const errorDetails = error ? {
          code: error.code,
          message: error.message
        } : 'Unknown error';
        console.error('Audio playback error:', errorDetails);
        handlePlaybackEnd();
        reject(new Error(`Playback failed: ${error?.message || 'Unknown error'}`));
      };

      // Set source and start loading
      currentAudio.src = audioUrl;
      currentAudio.load();

      // Also try playing immediately - some browsers allow this
      // This is a "race" - first successful play wins
      setTimeout(() => {
        if (!hasStartedPlaying && currentAudio) {
          console.log('[Audio] Attempting immediate play');
          tryPlay();
        }
      }, 100);
    });
  } catch (error) {
    console.error('Error in playAudio:', error);
    handlePlaybackEnd();
    throw error;
  }
}

// Helper function to handle playback end in all scenarios
function handlePlaybackEnd() {
  // Debug: Handling playback end
  updateState({ isPlaying: false, isLoading: false });

  // Clean up SourceBuffer only if MediaSource is still open
  if (currentSourceBuffer && currentMediaSource?.readyState === 'open') {
    try {
      currentSourceBuffer.abort();
    } catch (e) {
      console.error('Error aborting source buffer:', e);
    }
  }
  currentSourceBuffer = null;

  // Clean up MediaSource
  if (currentMediaSource) {
    try {
      if (currentMediaSource.readyState === 'open') {
        currentMediaSource.endOfStream();
      }
    } catch (e) {
      console.error('Error ending media source:', e);
    }
  }
  currentMediaSource = null;

  // Clean up Audio element
  if (currentAudio) {
    try {
      const srcUrl = currentAudio.src;
      currentAudio.pause();
      currentAudio.removeAttribute('src');
      currentAudio.load(); // Force release of resources
      if (srcUrl.startsWith('blob:')) {
        URL.revokeObjectURL(srcUrl);
      }
    } catch (e) {
      console.error('Error cleaning up audio element:', e);
    }
    currentAudio = null;
  }

  // Call completion callback if exists
  if (onAudioComplete) {
    // Debug: Calling completion callback
    onAudioComplete();
    onAudioComplete = null;
  }
}

// Function to stop current playback
export async function stopAudioPlayback() {
  // Debug: Stopping audio playback
  return new Promise<void>(resolve => {
    // Ensure handlePlaybackEnd is called only once
    const cleanup = () => {
      handlePlaybackEnd();
      resolve();
    };

    if (!currentAudio || currentAudio.paused) {
      cleanup();
      return;
    }

    // Set up one-time event listener for ended event
    currentAudio.addEventListener('ended', cleanup, { once: true });

    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      cleanup();
    } catch (e) {
      console.error('Error stopping audio:', e);
      cleanup();
    }
  });
}

export async function speechToText(audioBlob: Blob, options?: { provider?: string }): Promise<string> {
  const formData = new FormData();
  formData.append('action', 'transcribe');
  formData.append('file', new File([audioBlob], 'audio.webm', { type: 'audio/webm' }));

  // Add provider if specified
  if (options?.provider) {
    formData.append('provider', options.provider);
  }

  const response = await fetch('/api/audio', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Failed to convert speech to text');
  }

  const data = await response.json();
  return data.text;
}

export function startRecording(): Promise<MediaRecorder> {
  return new Promise((resolve, reject) => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm'
        });
        resolve(mediaRecorder);
      })
      .catch(reject);
  });
}

export function stopRecording(mediaRecorder: MediaRecorder): Promise<Blob> {
  return new Promise((resolve) => {
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      resolve(blob);
    };

    mediaRecorder.stop();
  });
}

// Test function to play a simple sound to verify audio is working
export async function testAudioSystem(): Promise<boolean> {
  // Debug: Testing audio system

  if (!isAudioContextReady()) {
    // Debug: AudioContext not ready, attempting to initialize
    const success = initializeAudioContext();
    if (!success) {
      console.error('Failed to initialize AudioContext for test');
      return false;
    }
  }

  try {
    // Play a very short test sound
    await playNotificationSound(0.3, 'subtle');
    // Debug: Audio test successful
    return true;
  } catch (error) {
    console.error('Audio test failed:', error);
    return false;
  }
}

// Helper function to manually trigger the AI stream completed event
// This is useful for testing the notification sound system
export function triggerStreamCompletedEvent(): void {
  // Debug: Manually triggering ai-stream-completed event
  const event = new Event('ai-stream-completed');
  window.dispatchEvent(event);
  // Debug: Event dispatched
}

// Helper function to ensure the event system is properly set up
export function ensureEventSystem(): void {
  if (typeof window !== 'undefined') {
    // Check if we have added the global event handler
    // We'll add a small script to the window that will help debug events
    if (!(window as any).__eventSystemPatched) {
      // Debug: Patching event system to ensure reliable custom events

      // This will catch any custom events and log them to help with debugging
      const originalDispatchEvent = window.dispatchEvent.bind(window);
      (window as any).dispatchEvent = function patchedDispatchEvent(event: Event) {
        if (event.type === 'ai-stream-completed') {
          // Debug: Dispatching ai-stream-completed event

          // Debug: Check for event listeners
          const listeners = (window as any).__customEventListeners?.['ai-stream-completed'] || [];
          // Debug: Found event listeners for ai-stream-completed
        }
        return originalDispatchEvent(event);
      };

      // Keep track of all custom event listeners
      (window as any).__customEventListeners = {};

      // Patch addEventListener to track custom event listeners
      const originalAddEventListener = window.addEventListener.bind(window);
      // Use any types to avoid TypeScript errors with overriding native methods
      (window as any).addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) {
        if (type === 'ai-stream-completed') {
          // Debug: Adding ai-stream-completed listener
          if (!(window as any).__customEventListeners[type]) {
            (window as any).__customEventListeners[type] = [];
          }
          (window as any).__customEventListeners[type].push(listener);
        }
        return originalAddEventListener(type, listener, options);
      };

      // Patch removeEventListener to track custom event listeners
      const originalRemoveEventListener = window.removeEventListener.bind(window);
      // Use any types to avoid TypeScript errors with overriding native methods
      (window as any).removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions
      ) {
        if (type === 'ai-stream-completed') {
          // Debug: Removing ai-stream-completed listener
          if ((window as any).__customEventListeners[type]) {
            (window as any).__customEventListeners[type] = (window as any).__customEventListeners[type]
              .filter((l: any) => l !== listener);
          }
        }
        return originalRemoveEventListener(type, listener, options);
      };

      // Mark as patched
      (window as any).__eventSystemPatched = true;
    }
  }
} 