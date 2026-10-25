'use client';

import React, { createContext, useContext, ReactNode, useId } from 'react';
import { Markdown as OriginalMarkdown } from '@/components/ui/markdown';
import { StreamingMarkdown } from '@/components/ui/streaming-markdown';

// Create context for Markdown configuration
interface MarkdownContextValue {
  isStreamingEnabled: boolean;
}

const MarkdownContext = createContext<MarkdownContextValue>({
  isStreamingEnabled: true, // Default to true
});

export const useMarkdown = () => useContext(MarkdownContext);

// Create an enhanced Markdown component that uses the context
const EnhancedMarkdown = (props: any) => {
  const context = useContext(MarkdownContext);
  const generatedId = useId();
  const messageId = props.id ?? `markdown-${generatedId}`;
  
  // For chat message content, apply streaming if enabled
  if (context.isStreamingEnabled && 
      // Check if this looks like a chat message by className or content
      (props.className?.includes('prose') || 
       (typeof props.children === 'string' && 
        (props.children.startsWith('#') || 
         props.children.includes('\n#'))))) {
    
    return <StreamingMarkdown {...props} isStreaming={true} messageId={messageId} />;
  }
  
  // Otherwise use the original component
  return <OriginalMarkdown {...props} />;
};

// Export our enhanced markdown component to be used in place of the original
export { EnhancedMarkdown as Markdown };

interface MarkdownProviderProps {
  children: ReactNode;
  isStreamingEnabled?: boolean;
}

/**
 * MarkdownProvider component
 * 
 * Provides a context for markdown rendering, allowing the application
 * to control markdown rendering behavior, including text streaming.
 */
export function MarkdownProvider({ 
  children, 
  isStreamingEnabled = true 
}: MarkdownProviderProps) {
  return (
    <MarkdownContext.Provider value={{ isStreamingEnabled }}>
      {children}
    </MarkdownContext.Provider>
  );
}
