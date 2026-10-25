'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Download, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';

interface ModelViewerProps {
  modelUrl: string;
  className?: string;
  showDownloadButton?: boolean;
  isLoading?: boolean;
}

export function ModelViewer({
  modelUrl,
  className,
  showDownloadButton = true,
  isLoading = false
}: ModelViewerProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [modelState, setModelState] = useState<'loading' | 'interactive' | 'error'>('loading');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const checkVisibilityRef = useRef<NodeJS.Timeout | null>(null);

  // Get the current theme
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Detect theme on mount and when it changes
  useEffect(() => {
    // Initial theme detection
    const isDarkMode = document.documentElement.classList.contains('dark');
    setTheme(isDarkMode ? 'dark' : 'light');

    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const isDarkMode = document.documentElement.classList.contains('dark');
          setTheme(isDarkMode ? 'dark' : 'light');

          // Notify iframe of theme change
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'theme-change',
              theme: isDarkMode ? 'dark' : 'light'
            }, '*');
          }
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Load the 3D model using model-viewer web component
  useEffect(() => {
    if (!modelUrl) return;

    // Reset state when URL changes
    setModelState('loading');

    // Set up event listener for iframe communication
    const handleMessage = (event: MessageEvent) => {
      // Strict check to ensure message comes from our iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      console.log('3D Model Message received:', event.data);

      if (event.data === 'model-loaded' || event.data === 'model-interactive') {
        console.log('Model loaded/interactive event validated');
        setModelState('interactive');
      } else if (event.data === 'model-error' && modelState !== 'interactive') {
        console.error('Model error event received');
        setModelState('error');
      }
    };

    window.addEventListener('message', handleMessage);

    // Polling mechanism: Check every second if the iframe is responsive/visible
    const pollInterval = setInterval(() => {
      if (modelState === 'loading' && iframeRef.current) {
        // If iframe has content window, it's a good sign
        if (iframeRef.current.contentWindow) {
          // We can also check if the iframe has height (is rendered)
          const rect = iframeRef.current.getBoundingClientRect();
          if (rect.height > 0) {
            console.log('Polling: Iframe is visible and active.');
          }
        }
      }
    }, 1000);

    // Fallback timer: Force interactive after 8 seconds if iframe is visible
    const timeoutId = setTimeout(() => {
      if (modelState === 'loading') {
        if (iframeRef.current && iframeRef.current.getBoundingClientRect().height > 0) {
          console.log('Timeout reached: Forcing interactive state as fallback');
          setModelState('interactive');
        } else {
          setModelState('error');
        }
      }
    }, 8000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [modelUrl, modelState]); // Keep modelState dependency to allow cleanup when state changes

  // Secondary check: If 3 seconds pass and we have a valid iframe ref, try to force update if we missed a message
  useEffect(() => {
    if (modelState === 'loading') {
      const aggressiveCheck = setTimeout(() => {
        if (iframeRef.current?.contentWindow) {
          console.log('Aggressive check: Iframe exists, assuming interactive');
          setModelState('interactive');
        }
      }, 3500); // 3.5 seconds
      return () => clearTimeout(aggressiveCheck);
    }
  }, [modelState]);

  // Handle download button click
  const handleDownload = async () => {
    try {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error('Failed to download model');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;

      // Extract filename from URL or use a default name
      const filename = modelUrl.split('/').pop() || 'model.glb';
      a.download = filename;

      document.body.appendChild(a);
      a.click();

      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading model:', error);
    }
  };

  // Force the model to be treated as interactive
  const forceInteractive = () => {
    console.log('User forced model to interactive state');
    setModelState('interactive');
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-[450px] md:h-[550px] rounded-lg overflow-hidden bg-transparent",
        className
      )}
    >
      {/* Model Viewer iframe - ALWAYS rendered */}
      {modelUrl && (
        <iframe
          ref={iframeRef}
          srcDoc={`
            <!DOCTYPE html>
            <html data-theme="${theme}">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
                <style>
                  html[data-theme="light"] {
                    --bg-color: transparent;
                  }
                  
                  html[data-theme="dark"] {
                    --bg-color: transparent;
                  }
                  
                  body { 
                    margin: 0; 
                    padding: 0; 
                    overflow: hidden; 
                    background-color: transparent;
                    touch-action: none; /* Prevent scrolling when interacting with model */
                  }
                  
                  model-viewer {
                    width: 100%;
                    height: 100vh;
                    --poster-color: transparent;
                    --progress-bar-height: 0px;
                    cursor: grab;
                    background-color: transparent;
                    touch-action: none; /* Double insurance for touch action */
                  }
                  
                  model-viewer:active {
                    cursor: grabbing;
                  }
                  
                  /* Hide default progress bar */
                  model-viewer::part(default-progress-bar) {
                    display: none;
                  }
                  
                  .interaction-prompt {
                    position: absolute;
                    top: 20px;
                    left: 20px;
                    background-color: rgba(0,0,0,0.7);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 8px;
                    font-family: sans-serif;
                    font-size: 14px;
                    pointer-events: none;
                    animation: fadeInOut 5s forwards;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    z-index: 100;
                  }
                  
                  .interaction-icon {
                    width: 18px;
                    height: 18px;
                    fill: white;
                    animation: pulse 2s infinite;
                  }
                  
                  @keyframes fadeInOut {
                    0% { opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { opacity: 0; }
                  }
                  
                  @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.2); }
                    100% { transform: scale(1); }
                  }
                </style>
                <script>
                  // Function to notify parent window when model is loaded/interactive
                  function notifyParent(event) {
                    if (event === 'load') {
                      console.log('Model loaded - notifying parent');
                      
                      // CYCLIC NOTIFICATION (Handshake)
                      // Send the loaded message repeatedly for a few seconds to ensure parent catches it
                      // even if the listener wasn't ready or was re-initialized.
                      let count = 0;
                      const notifyInterval = setInterval(() => {
                        window.parent.postMessage('model-loaded', '*');
                        count++;
                        if (count > 10) clearInterval(notifyInterval); // Stop after 5 seconds (10 * 500ms)
                      }, 500);

                      // Send immediately as well
                      window.parent.postMessage('model-loaded', '*');
                      
                      // Add interaction prompt after model is loaded
                      setTimeout(() => {
                        const prompt = document.createElement('div');
                        prompt.className = 'interaction-prompt';
                        
                        // Add icon
                        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        icon.setAttribute('class', 'interaction-icon');
                        icon.setAttribute('viewBox', '0 0 24 24');
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        path.setAttribute('d', 'M21 16V8l-8-5L5 8v8l8 5 8-5zM6.5 9.5L12 6l5.5 3.5L12 13 6.5 9.5zM7 11l4 2.5V19l-4-2.5V11zm10 0v5.5L13 19v-5.5L17 11z');
                        icon.appendChild(path);
                        
                        const text = document.createElement('span');
                        text.innerText = '${t('clickDragRotateModel')}';
                        
                        prompt.appendChild(icon);
                        prompt.appendChild(text);
                        document.body.appendChild(prompt);
                        
                        // Remove prompt after 8 seconds
                        setTimeout(() => {
                          if (prompt.parentNode) {
                            prompt.parentNode.removeChild(prompt);
                          }
                        }, 8000);
                      }, 1000);
                    } else if (event === 'error') {
                      console.error('Model error - notifying parent');
                      window.parent.postMessage('model-error', '*');
                    }
                  }
                  
                  // Listen for theme changes from parent
                  window.addEventListener('message', (event) => {
                    if (event.data && event.data.type === 'theme-change') {
                      document.documentElement.setAttribute('data-theme', event.data.theme);
                    }
                  });
                  
                  // Wait for the DOM to be ready
                  document.addEventListener('DOMContentLoaded', function() {
                    const modelViewer = document.querySelector('model-viewer');
                    
                    // Function to signal interactivity
                    const signalInteractive = (source) => {
                      console.log('User interaction detected (' + source + ') - signaling interactive');
                      window.parent.postMessage('model-interactive', '*');
                    };

                    // Make extra sure we notify the parent as soon as possible
                    const sendInteractiveMessages = () => {
                      if (modelViewer.modelIsVisible) {
                        window.parent.postMessage('model-interactive', '*');
                      }
                    };
                    
                    // Keep trying to notify parent of visibility
                    const visibilityInterval = setInterval(sendInteractiveMessages, 500);
                    
                    // Ensure we stop checking after 30 seconds (extended)
                    setTimeout(() => {
                      clearInterval(visibilityInterval);
                    }, 30000);
                    
                    // Respond to ANY interaction on the window (capture phase) to ensure we catch it
                    const interactions = ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'click', 'wheel', 'keydown'];
                    interactions.forEach(eventType => {
                      window.addEventListener(eventType, () => signalInteractive(eventType), { capture: true, passive: true });
                    });

                    // Respond to model specific events
                    modelViewer.addEventListener('camera-change', () => signalInteractive('camera-change'));
                    modelViewer.addEventListener('environment-change', () => signalInteractive('environment-change'));
                    
                    // Also detect visibility via observer
                    const observer = new IntersectionObserver((entries) => {
                      if (entries[0].isIntersecting) {
                        window.parent.postMessage('model-interactive', '*');
                      }
                    });
                    observer.observe(modelViewer);
                    
                    // Add standard load/error handlers
                    modelViewer.addEventListener('load', () => {
                      notifyParent('load');
                      // Try to fit model to view after it's loaded
                      setTimeout(() => {
                        try {
                          // Reset camera to same orientation but ensure units are in degrees
                          if (modelViewer.getCameraOrbit) {
                            const orbit = modelViewer.getCameraOrbit();
                            const toDeg = (rad) => rad * (180 / Math.PI);
                            modelViewer.cameraOrbit = \`\${toDeg(orbit.theta)}deg \${toDeg(orbit.phi)}deg auto\`;
                          }
                        } catch (e) {
                          console.error('Error adjusting camera:', e);
                        }
                      }, 100);
                    });
                    modelViewer.addEventListener('error', () => notifyParent('error'));
                    
                    // Prevent default touch actions for better interaction - but allow listeners to fire first
                    modelViewer.addEventListener('touchstart', (e) => {
                      // We rely on touch-action: none for the scrolling prevention
                      signalInteractive('touchstart-model');
                    }, {passive: true});
                  });
                </script>
              </head>
              <body>
                <model-viewer
                  src="${modelUrl}"
                  camera-controls
                  auto-rotate
                  interaction-prompt="auto"
                  interaction-prompt-threshold="0"
                  bounds="tight"
                  min-camera-orbit="auto auto auto"
                  max-camera-orbit="auto auto auto"
                  camera-orbit="auto auto 110%"
                  shadow-intensity="1.0"
                  exposure="1.0"
                  environment-image="neutral"
                  auto-rotate-delay="0"
                  rotation-per-second="30deg"
                  interaction-prompt-style="basic">
                </model-viewer>
              </body>
            </html>
          `}
          className="w-full h-full border-0 z-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="camera *; geolocation *; microphone *; accelerometer; magnetometer; gyroscope; xr-spatial-tracking"
          loading="lazy"
          title="3D Model Viewer"
        />
      )}

      {/* Error message with option to continue anyway */}
      {modelState === 'error' && !isLoading && (
        <div
          className="absolute bottom-4 left-4 right-4 bg-gray-900/30 backdrop-blur-sm p-4 rounded-lg z-20 text-center"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={forceInteractive}
              className="text-white bg-[#FF6417] hover:bg-[#E55000] dark:bg-[#FF6417] dark:hover:bg-[#E55000] rounded-lg px-4 py-2 font-medium text-sm flex items-center transition-colors"
            >
              Dismiss message and continue
            </button>
            <p className="text-xs text-gray-200">
              The model is visible but taking longer than expected to fully load
            </p>
          </div>
        </div>
      )}

      {/* Show download button when model URL is available - independent of interactive state */}
      {showDownloadButton && modelUrl && (
        <button
          onClick={handleDownload}
          className="absolute bottom-12 right-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/80 hover:bg-white dark:bg-black/80 dark:hover:bg-black text-gray-800 dark:text-white text-sm shadow-md transition z-30"
        >
          <Download className="h-4 w-4" />
          {t('download')}
        </button>
      )}
    </div>
  );
}

// Listen for messages from the iframe
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data === 'model-loaded') {
      const loadedEvent = new Event('model-loaded');
      window.dispatchEvent(loadedEvent);
    } else if (event.data === 'model-error') {
      const errorEvent = new Event('model-error');
      window.dispatchEvent(errorEvent);
    }
  });
} 
