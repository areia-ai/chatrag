'use client';

import { useChat } from '@ai-sdk/react';
import { useState, useRef, useEffect } from 'react';

/**
 * Lightweight markdown renderer for embed widget
 * Handles links, bold, italic, and line breaks
 */
function renderMarkdown(text: string): JSX.Element {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let keyCounter = 0;

  // Pattern for markdown links: [text](url)
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index);
      parts.push(processInlineFormatting(textBefore, keyCounter++));
    }

    // Add the link
    const linkText = match[1];
    let url = match[2];

    // Clean URL: remove any trailing punctuation that might have been incorrectly captured
    // This handles cases where URLs might have trailing ), ., ), etc.
    url = url.replace(/[)\].,;:]+$/, '');

    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 underline break-all"
      >
        {linkText}
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    parts.push(processInlineFormatting(remainingText, keyCounter++));
  }

  return <>{parts}</>;
}

/**
 * Process inline formatting like bold and italic
 */
function processInlineFormatting(text: string, baseKey: number): JSX.Element {
  const parts: (string | JSX.Element)[] = [];
  const current = text;

  // Handle bold **text**
  const boldPattern = /\*\*([^*]+)\*\*/g;
  const segments = current.split(boldPattern);

  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      // Odd indices are bold text
      parts.push(<strong key={`bold-${baseKey}-${i}`}>{segment}</strong>);
    } else {
      // Even indices are regular text, check for italic
      const italicPattern = /\*([^*]+)\*/g;
      const italicSegments = segment.split(italicPattern);

      italicSegments.forEach((italicSeg, j) => {
        if (j % 2 === 1) {
          parts.push(<em key={`italic-${baseKey}-${i}-${j}`}>{italicSeg}</em>);
        } else if (italicSeg) {
          parts.push(italicSeg);
        }
      });
    }
  });

  return <>{parts}</>;
}

interface EmbedConfig {
  embedEnabled: boolean;
  appName: string;
  chatTitle: string;
  welcomeMessage: string;
  primaryColor: string;
  chatPosition: string;
  autoOpen: boolean;
  allowedDomains: string[];
  requireAuth: boolean;
  showSuggestions: boolean;
}

export default function EmbedWindow() {
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize with empty messages - we'll add the greeting later
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages
  } = useChat({
    body: {
      model: 'openai/gpt-4o-mini'
    },
    api: '/api/embed/chat'
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    async function loadConfiguration() {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const configUrl = `/api/config/embed/live?${urlParams.toString()}`;
        
        console.log('Loading embed configuration from:', configUrl);
        
        const response = await fetch(configUrl);
        const data = await response.json();
        
        console.log('Configuration response:', data);
        
        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        
        if (!data.success) {
          throw new Error(data.error || 'Failed to load configuration');
        }
        
        if (!data.config.embedEnabled) {
          throw new Error('Embed widget is disabled. Please enable it in your environment configuration.');
        }
        
        setConfig(data.config);
        
        // Add greeting message after config loads
        if (data.config.welcomeMessage) {
          setMessages([{
            id: 'greeting',
            role: 'assistant',
            content: data.config.welcomeMessage,
          }]);
        }
        
      } catch (err) {
        console.error('Error loading embed configuration:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    }

    loadConfiguration();
  }, [setMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto mb-2"></div>
          <p className="text-gray-500">Loading chat...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !config) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center max-w-md p-6">
          <h1 className="text-xl font-semibold text-red-600 mb-2">
            Configuration Error
          </h1>
          <p className="text-gray-600 mb-4">
            {error || 'Failed to load configuration'}
          </p>
          <div className="text-left text-sm text-gray-500">
            <p className="font-medium mb-2">Please check:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                NEXT_PUBLIC_EMBED_ENABLED is set to <code>true</code>
              </li>
              <li>Your ChatRAG server is running</li>
              <li>Browser console for details</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Main chat interface
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div 
        className="flex items-center justify-center p-4 text-white font-semibold"
        style={{ backgroundColor: config.primaryColor }}
      >
        <h1 className="text-lg">{config.chatTitle}</h1>
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${
                message.role === 'user'
                  ? 'text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 rounded-bl-sm'
              }`}
              style={{
                backgroundColor: message.role === 'user' ? config.primaryColor : undefined,
              }}
            >
              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {renderMarkdown(message.content)}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-lg rounded-bl-sm px-4 py-2">
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-opacity-50"
            style={{ 
              '--tw-ring-color': config.primaryColor + '80'
            } as React.CSSProperties}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 text-white rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            style={{ backgroundColor: config.primaryColor }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}