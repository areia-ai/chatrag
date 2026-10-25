import { env } from './env';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

export interface ElevenLabsTTSOptions {
  text: string;
  voice_id?: string;
  model_id?: string;
  voice_settings?: ElevenLabsVoiceSettings;
  output_format?: string;
}

export interface ElevenLabsSTTOptions {
  audio: Blob;
  model_id?: string;
  language_code?: string;
}

class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private voicesCache: ElevenLabsVoice[] | null = null;
  private voicesCacheTime = 0;
  private CACHE_DURATION = 1000 * 60 * 60; // 1 hour

  constructor() {
    this.apiKey = env.ELEVENLABS_API_KEY;
  }

  private getHeaders(): HeadersInit {
    return {
      'xi-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get available voices from ElevenLabs
   */
  async getVoices(): Promise<ElevenLabsVoice[]> {
    // Return cached voices if still valid
    if (this.voicesCache && Date.now() - this.voicesCacheTime < this.CACHE_DURATION) {
      return this.voicesCache;
    }

    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch voices: ${response.statusText}`);
      }

      const data = await response.json();
      this.voicesCache = data.voices;
      this.voicesCacheTime = Date.now();
      return data.voices;
    } catch (error) {
      console.error('Error fetching ElevenLabs voices:', error);
      return [];
    }
  }

  /**
   * Convert text to speech using ElevenLabs
   * Returns a ReadableStream for real-time audio streaming
   */
  async textToSpeech(options: ElevenLabsTTSOptions): Promise<ReadableStream<Uint8Array>> {
    const {
      text,
      voice_id = env.ELEVENLABS_VOICE_ID,
      model_id = env.ELEVENLABS_MODEL_ID,
      voice_settings = {
        stability: parseFloat(env.ELEVENLABS_VOICE_STABILITY),
        similarity_boost: parseFloat(env.ELEVENLABS_SIMILARITY_BOOST),
        use_speaker_boost: env.ELEVENLABS_SPEAKER_BOOST === 'true',
        speed: parseFloat(env.ELEVENLABS_VOICE_SPEED),
      },
      output_format = 'mp3_44100_128',
    } = options;

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${voice_id}/stream`,
      {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id,
          voice_settings,
          output_format,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs TTS failed: ${error}`);
    }

    // Return the response body as a stream
    if (!response.body) {
      throw new Error('No response body from ElevenLabs');
    }

    return response.body;
  }

  /**
   * Convert text to speech and return as Blob
   */
  async textToSpeechBlob(options: ElevenLabsTTSOptions): Promise<Blob> {
    const stream = await this.textToSpeech(options);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine all chunks into a single Blob
      return new Blob(chunks, { type: 'audio/mpeg' });
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Convert speech to text using ElevenLabs
   */
  async speechToText(options: ElevenLabsSTTOptions): Promise<string> {
    const {
      audio,
      model_id = 'eleven_turbo_v2',
      language_code,
    } = options;

    const formData = new FormData();
    formData.append('audio', audio);
    formData.append('model_id', model_id);
    if (language_code) {
      formData.append('language_code', language_code);
    }

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs STT failed: ${error}`);
    }

    const data = await response.json();
    return data.text || '';
  }

  /**
   * Get voice details by ID
   */
  async getVoiceDetails(voiceId: string): Promise<ElevenLabsVoice | null> {
    try {
      const response = await fetch(`${this.baseUrl}/voices/${voiceId}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch voice details: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching voice details:', error);
      return null;
    }
  }

  /**
   * Check if ElevenLabs is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

// Export singleton instance
export const elevenLabsService = new ElevenLabsService();

// Export convenience functions
export const elevenLabsTextToSpeech = (options: ElevenLabsTTSOptions) => 
  elevenLabsService.textToSpeech(options);

export const elevenLabsSpeechToText = (options: ElevenLabsSTTOptions) =>
  elevenLabsService.speechToText(options);

export const getElevenLabsVoices = () =>
  elevenLabsService.getVoices();

export const isElevenLabsConfigured = () =>
  elevenLabsService.isConfigured();