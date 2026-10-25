'use client';

import { useEffect, useRef, useState } from 'react';
import {
  playNotificationSound,
  initializeAudioContext,
  isAudioContextReady,
  testAudioSystem,
  ensureEventSystem
} from '@/lib/audio-utils';
import { useUserSettingsStore } from '@/lib/user-settings-store';
import { Button } from '@/components/ui/button';

export function NotificationSoundListener() {
  // Use a ref to keep track of whether we've played a sound recently to prevent duplicates
  const lastPlayedRef = useRef(0);
  // Track if we've attempted to initialize audio
  const [audioInitialized, setAudioInitialized] = useState(false);
  // Track if we need a manual activation
  const [needsManualActivation, setNeedsManualActivation] = useState(false);
  // Loading state for activation button
  const [activationLoading, setActivationLoading] = useState(false);
  // Add a reference to track if the component is mounted
  const isMounted = useRef(false);

  // DEBUG info for the UI
  const [debug, setDebug] = useState<{
    lastEventTime: string | null;
    listenersRegistered: boolean;
    audioContextState: string;
  }>({
    lastEventTime: null,
    listenersRegistered: false,
    audioContextState: 'uninitiated'
  });

  useEffect(() => {
    // Debug: NotificationSoundListener mounted
    isMounted.current = true;

    // Patch the event system to ensure reliable event dispatch
    ensureEventSystem();

    // Function to initialize audio context on user interaction
    const initAudio = () => {
      // Debug: Attempting to initialize AudioContext
      const success = initializeAudioContext();

      if (success) {
        // Debug: AudioContext initialized successfully
        setAudioInitialized(true);
        setNeedsManualActivation(false);
        setDebug(prev => ({
          ...prev,
          audioContextState: 'initialized'
        }));
      } else {
        // AudioContext initialization requires user interaction
        setNeedsManualActivation(true);
        setDebug(prev => ({
          ...prev,
          audioContextState: 'requires user gesture'
        }));
      }
      return success;
    };

    // Set up listeners for user interactions to initialize audio
    const userInteractionEvents = ['click', 'keydown', 'touchstart'];

    const handleUserInteraction = () => {
      // Debug: User interaction detected
      // Only try to initialize once from user interactions
      if (audioInitialized || isAudioContextReady()) {
        // Debug: Audio already initialized, skipping
        // Clean up event listeners after successful initialization
        userInteractionEvents.forEach(event => {
          document.removeEventListener(event, handleUserInteraction);
        });
        return;
      }

      const success = initAudio();
      if (success) {
        // Debug: Successfully initialized audio on user interaction
        // Clean up listeners if successful
        userInteractionEvents.forEach(event => {
          document.removeEventListener(event, handleUserInteraction);
        });
      }
    };

    // Add listeners for user interactions
    // Debug: Adding user interaction event listeners
    userInteractionEvents.forEach(event => {
      document.addEventListener(event, handleUserInteraction);
    });

    // Listen for AI stream completion
    const handleStreamCompleted = async (event: Event) => {
      console.log('[NotificationSound] Stream completed event received');

      // Update debug info
      setDebug(prev => ({
        ...prev,
        lastEventTime: new Date().toLocaleTimeString()
      }));

      // Prevent duplicate sounds (don't play if we played a sound within the last 2 seconds)
      const now = Date.now();
      if (now - lastPlayedRef.current < 2000) {
        console.log('[NotificationSound] Skipping - played too recently');
        return;
      }

      try {
        // Get the user preferences directly from store
        const { notificationSoundEnabled, notificationSoundType } = useUserSettingsStore.getState();
        console.log('[NotificationSound] Settings - enabled:', notificationSoundEnabled, 'type:', notificationSoundType);

        if (notificationSoundEnabled) {
          // Detect iOS - for iOS we use HTML5 Audio which doesn't need AudioContext
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

          // Only check AudioContext for non-iOS devices
          if (!isIOS && !isAudioContextReady()) {
            console.log('[NotificationSound] AudioContext not ready, attempting to initialize');
            const success = initAudio();
            if (!success) {
              console.log('[NotificationSound] Audio initialization failed, showing manual activation');
              setNeedsManualActivation(true);
              return;
            }
          }

          // Update the last played timestamp
          lastPlayedRef.current = now;

          console.log('[NotificationSound] Playing notification sound...');
          // Play the notification sound
          await playNotificationSound(0.8, notificationSoundType);
          console.log('[NotificationSound] Notification sound played successfully');
        } else {
          console.log('[NotificationSound] Sounds are disabled in settings');
        }
      } catch (error) {
        console.error('[NotificationSound] Error playing sound:', error);
      }
    };

    // Register event listener for the AI stream completion
    // Debug: Registering ai-stream-completed event listener
    window.addEventListener('ai-stream-completed', handleStreamCompleted);
    setDebug(prev => ({
      ...prev,
      listenersRegistered: true
    }));

    // Don't initialize audio immediately - wait for user interaction to avoid browser warnings

    // Manually test if the event listener is working
    setTimeout(() => {
      if (isMounted.current) {
        // Debug: Running event listener registration test
        // Create a test event
        const testEvent = new CustomEvent('ai-stream-completed', {
          detail: { test: true, source: 'init-test' }
        });

        // Get listeners count from our tracking
        const listeners = (window as any).__customEventListeners?.['ai-stream-completed'] || [];
        // Debug: Event listener registration test completed

        // Don't actually dispatch - this is just a registration test
      }
    }, 2000);

    return () => {
      // Debug: NotificationSoundListener cleanup
      isMounted.current = false;

      // Clean up all event listeners
      userInteractionEvents.forEach(event => {
        document.removeEventListener(event, handleUserInteraction);
      });
      window.removeEventListener('ai-stream-completed', handleStreamCompleted);
      // Debug: NotificationSoundListener cleanup complete

      setDebug(prev => ({
        ...prev,
        listenersRegistered: false
      }));
    };
  }, [audioInitialized]);

  // Handle manual activation
  const handleManualActivation = async () => {
    // Debug: Manual audio activation requested
    setActivationLoading(true);

    try {
      // First initialize the AudioContext
      const initSuccess = initializeAudioContext();

      if (!initSuccess) {
        // Manual activation failed - AudioContext could not be initialized
        return;
      }

      // Test the audio system by playing a test sound
      const testSuccess = await testAudioSystem();

      if (testSuccess) {
        setAudioInitialized(true);
        setNeedsManualActivation(false);
        // Debug: Audio system activated and tested successfully
        setDebug(prev => ({
          ...prev,
          audioContextState: 'activated manually'
        }));
      } else {
        // Audio test failed, still need manual activation
        setDebug(prev => ({
          ...prev,
          audioContextState: 'test failed'
        }));
      }
    } catch (error) {
      console.error('Error during manual activation:', error);
    } finally {
      setActivationLoading(false);
    }
  };

  // Only render the activation button if needed
  if (needsManualActivation) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 bg-card p-3 rounded-md shadow-md border border-border">
        <p className="text-sm text-muted-foreground">
          Audio notifications require activation
        </p>
        <Button
          size="sm"
          onClick={handleManualActivation}
          className="bg-primary text-white hover:bg-primary/90"
          disabled={activationLoading}
        >
          {activationLoading ? 'Activating...' : 'Enable Audio Notifications'}
        </Button>

        {/* Add debug info */}
        <details className="text-xs text-muted-foreground mt-2">
          <summary>Debug Info</summary>
          <div className="mt-1 space-y-1">
            <p>Listeners registered: {debug.listenersRegistered ? 'Yes' : 'No'}</p>
            <p>AudioContext state: {debug.audioContextState}</p>
            <p>Last event: {debug.lastEventTime || 'None'}</p>
          </div>
        </details>
      </div>
    );
  }

  // Otherwise render a minimal debug element
  return (
    <div className="fixed bottom-0 right-0 z-10 opacity-0 hover:opacity-100 transition-opacity">
      <div className="text-[8px] p-1 bg-muted/30 text-muted-foreground">
        NotificationSound: Ready
      </div>
    </div>
  );
} 