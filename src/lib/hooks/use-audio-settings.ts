import { useEffect, useState } from 'react';

interface AudioSettings {
  ttsDisabled: boolean;
  sttDisabled: boolean;
  voiceProvider: 'openai' | 'elevenlabs';
  audioAutoplay: boolean;
}

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>({
    ttsDisabled: false,
    sttDisabled: false,
    voiceProvider: 'openai',
    audioAutoplay: false
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/config/audio-settings');
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
        }
      } catch (error) {
        console.error('Error fetching audio settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  return { ...settings, loading };
}