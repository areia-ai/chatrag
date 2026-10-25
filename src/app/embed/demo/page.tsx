'use client';

import { useState } from 'react';
import { env } from '@/lib/env';

export default function EmbedDemo() {
  const [embedType, setEmbedType] = useState<'script' | 'iframe'>('script');
  const [config, setConfig] = useState({
    title: env.NEXT_PUBLIC_EMBED_TITLE || 'ChatRAG Assistant',
    primaryColor: env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR || '#FF6417',
    position: env.NEXT_PUBLIC_EMBED_POSITION || 'bottom-right',
    autoOpen: env.NEXT_PUBLIC_EMBED_AUTO_OPEN === 'true',
    greeting: env.NEXT_PUBLIC_EMBED_GREETING || 'Hello! How can I help you today?',
  });

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const scriptCode = `<script async src="${currentUrl}/embed/chat.js" data-primary-color="${config.primaryColor}" data-position="${config.position}" data-auto-open="${config.autoOpen}" data-title="${encodeURIComponent(config.title)}"></script>`;

  const iframeCode = `<iframe src="${currentUrl}/embed/window" width="400" height="600" frameborder="0" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></iframe>`;

  const reactCode = `import { useEffect } from 'react';

export function ChatWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '${currentUrl}/embed/chat.js';
    script.async = true;
    script.setAttribute('data-primary-color', '${config.primaryColor}');
    script.setAttribute('data-position', '${config.position}');
    script.setAttribute('data-auto-open', '${config.autoOpen}');
    script.setAttribute('data-title', '${encodeURIComponent(config.title)}');
    document.body.appendChild(script);
    
    return () => {
      const existingScript = document.querySelector('script[src*="/embed/chat.js"]');
      if (existingScript) {
        document.body.removeChild(existingScript);
      }
    };
  }, []);
  
  return null; // Widget renders itself
}`;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  if (env.NEXT_PUBLIC_EMBED_ENABLED !== 'true') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-700 mb-4">
            Embed Demo Unavailable
          </h1>
          <p className="text-gray-500">
            The embed functionality is currently disabled. Enable it in your configuration to use this demo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">ChatRAG Embed Demo</h1>
              <p className="mt-1 text-sm text-gray-500">
                Test and customize your chat widget before embedding it on your website
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Configuration Panel */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Widget Configuration</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Widget Title
                  </label>
                  <input
                    type="text"
                    value={config.title}
                    onChange={(e) => setConfig({ ...config, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primary Color
                  </label>
                  <input
                    type="color"
                    value={config.primaryColor}
                    onChange={(e) => setConfig({ ...config, primaryColor: e.target.value })}
                    className="w-full h-10 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Position
                  </label>
                  <select
                    value={config.position}
                    onChange={(e) => setConfig({ ...config, position: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="top-left">Top Left</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={config.autoOpen}
                      onChange={(e) => setConfig({ ...config, autoOpen: e.target.checked })}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Auto-open chat</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Greeting Message
                  </label>
                  <input
                    type="text"
                    value={config.greeting}
                    onChange={(e) => setConfig({ ...config, greeting: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Embed Code */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Embed Code</h2>
              
              <div className="mb-4">
                <div className="flex space-x-4">
                  <button
                    onClick={() => setEmbedType('script')}
                    className={`px-4 py-2 rounded-md ${
                      embedType === 'script'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    Script Tag
                  </button>
                  <button
                    onClick={() => setEmbedType('iframe')}
                    className={`px-4 py-2 rounded-md ${
                      embedType === 'iframe'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    iFrame
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {embedType === 'script' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        HTML Script Tag
                      </label>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={scriptCode}
                          className="w-full h-20 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
                        />
                        <button
                          onClick={() => copyToClipboard(scriptCode)}
                          className="absolute top-2 right-2 px-2 py-1 bg-blue-500 text-white text-xs rounded"
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        React Component
                      </label>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={reactCode}
                          className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
                        />
                        <button
                          onClick={() => copyToClipboard(reactCode)}
                          className="absolute top-2 right-2 px-2 py-1 bg-blue-500 text-white text-xs rounded"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {embedType === 'iframe' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      iFrame Embed
                    </label>
                    <div className="relative">
                      <textarea
                        readOnly
                        value={iframeCode}
                        className="w-full h-20 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm"
                      />
                      <button
                        onClick={() => copyToClipboard(iframeCode)}
                        className="absolute top-2 right-2 px-2 py-1 bg-blue-500 text-white text-xs rounded"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Live Preview</h2>
              
              {embedType === 'script' && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 bg-gray-50 relative h-96">
                  <div className="text-center text-gray-500 mb-4">
                    <div className="text-4xl mb-2">🖥️</div>
                    <p>Your website content would appear here</p>
                    <p className="text-sm">The chat button will appear in the selected position</p>
                  </div>
                  
                  {/* Mock chat button */}
                  <button
                    className="absolute w-14 h-14 rounded-full text-white text-2xl shadow-lg hover:scale-110 transition-transform"
                    style={{
                      backgroundColor: config.primaryColor,
                      ...(config.position === 'bottom-right' && { bottom: '16px', right: '16px' }),
                      ...(config.position === 'bottom-left' && { bottom: '16px', left: '16px' }),
                      ...(config.position === 'top-right' && { top: '16px', right: '16px' }),
                      ...(config.position === 'top-left' && { top: '16px', left: '16px' }),
                    }}
                  >
                    💬
                  </button>
                </div>
              )}

              {embedType === 'iframe' && (
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <iframe
                    src="/embed/window"
                    width="100%"
                    height="500"
                    frameBorder="0"
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Integration Instructions</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Copy the embed code above</li>
                <li>• Paste it into your website&apos;s HTML</li>
                <li>• The widget will automatically load and be ready to use</li>
                <li>• Customize the appearance using the configuration panel</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
