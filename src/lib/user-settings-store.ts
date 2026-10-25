import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from './supabase';
import { env } from './env';

export interface UserSettings {
  backgroundImage: string | null;
  notificationSoundEnabled: boolean;
  notificationSoundType: 'bell' | 'soft' | 'low' | 'subtle';
  fontSize: string;
  fontFamily: string;
  markdownEnabled: boolean;
  defaultModel: string;
  language: string;
  webSearchEnabled: boolean;
  voiceProvider: 'openai' | 'elevenlabs';
  elevenLabsVoiceId: string | null;
  ttsDisabled: boolean;
  sttDisabled: boolean;
  audioAutoplay: boolean;
}

interface UserSettingsState extends UserSettings {
  setBackgroundImage: (url: string | null) => void;
  uploadBackground: (file: File) => Promise<string | null>;
  setNotificationSoundEnabled: (enabled: boolean) => void;
  setNotificationSoundType: (type: 'bell' | 'soft' | 'low' | 'subtle') => void;
  setVoiceProvider: (provider: 'openai' | 'elevenlabs') => void;
  setElevenLabsVoiceId: (voiceId: string | null) => void;
  setTtsDisabled: (disabled: boolean) => void;
  setSttDisabled: (disabled: boolean) => void;
  setAudioAutoplay: (enabled: boolean) => void;
}

// Version for settings migration
const SETTINGS_VERSION = 3;

export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    (set, get) => ({
      backgroundImage: env.NEXT_PUBLIC_DEFAULT_BACKGROUND_IMAGE || null,
      notificationSoundEnabled: true, // Default to enabled
      notificationSoundType: 'soft', // Default to soft sound
      fontSize: 'default',
      fontFamily: 'default',
      markdownEnabled: true,
      defaultModel: 'anthropic/claude-sonnet-4.5',
      language: 'en',
      webSearchEnabled: false,
      voiceProvider: (env.NEXT_PUBLIC_VOICE_PROVIDER as 'openai' | 'elevenlabs') || 'openai',
      elevenLabsVoiceId: null,
      ttsDisabled: env.NEXT_PUBLIC_TTS_DISABLED === 'true',
      sttDisabled: env.NEXT_PUBLIC_STT_DISABLED === 'true',
      audioAutoplay: false,

      setBackgroundImage: (url) => {
        set({ backgroundImage: url });
      },

      setNotificationSoundEnabled: (enabled) => {
        set({ notificationSoundEnabled: enabled });
      },

      setNotificationSoundType: (type: 'bell' | 'soft' | 'low' | 'subtle') => {
        set({ notificationSoundType: type });
      },

      setVoiceProvider: (provider) => {
        set({ voiceProvider: provider });
      },

      setElevenLabsVoiceId: (voiceId) => {
        set({ elevenLabsVoiceId: voiceId });
      },

      setTtsDisabled: (disabled) => {
        set({ ttsDisabled: disabled });
      },

      setSttDisabled: (disabled) => {
        set({ sttDisabled: disabled });
      },

      setAudioAutoplay: (enabled) => {
        set({ audioAutoplay: enabled });
      },

      uploadBackground: async (file) => {
        try {
          const user = (await supabase.auth.getUser()).data.user;

          if (!user?.id) {
            console.error('User not authenticated');
            return null;
          }

          const fileExt = file.name.split('.').pop();
          const fileName = `${user.id}-bg-${Date.now()}.${fileExt}`;

          const { data, error } = await supabase.storage
            .from('backgrounds')
            .upload(fileName, file, {
              cacheControl: '3600',
              upsert: true
            });

          if (error) {
            console.error('Error uploading background:', error);
            return null;
          }

          const { data: urlData } = supabase.storage
            .from('backgrounds')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;

          // Save the URL to the user's settings
          set({ backgroundImage: publicUrl });

          return publicUrl;
        } catch (error) {
          console.error('Error in uploadBackground:', error);
          return null;
        }
      }
    }),
    {
      name: 'user-settings-storage',
      version: SETTINGS_VERSION,
      migrate: (persistedState: any, version: number) => {
        if (version < 3) {
          // Migrate from enabled to disabled flags
          const migratedState = {
            ...persistedState,
            voiceProvider: env.NEXT_PUBLIC_VOICE_PROVIDER || 'openai',
            elevenLabsVoiceId: null,
          };

          // Convert enabled to disabled
          if ('ttsEnabled' in persistedState) {
            migratedState.ttsDisabled = !persistedState.ttsEnabled;
            delete migratedState.ttsEnabled;
          } else {
            migratedState.ttsDisabled = env.NEXT_PUBLIC_TTS_DISABLED === 'true';
          }

          if ('sttEnabled' in persistedState) {
            migratedState.sttDisabled = !persistedState.sttEnabled;
            delete migratedState.sttEnabled;
          } else {
            migratedState.sttDisabled = env.NEXT_PUBLIC_STT_DISABLED === 'true';
          }

          return migratedState;
        }
        return persistedState;
      },
    }
  )
); 