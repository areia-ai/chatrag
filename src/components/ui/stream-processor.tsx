'use client';

import { useEffect, useRef, useState } from 'react';
import { createDirectStreamRenderer, DirectStreamRenderer } from '@/lib/chat-utils';

interface StreamProcessorProps {
  messageId: string;
  content: string;
  isStreaming: boolean;
  containerClassName?: string;
}

/**
 * StreamProcessor component
 * 
 * This component handles streaming text animation for AI responses.
 * It uses the DirectStreamRenderer to provide a typing effect for incoming text.
 */
export function StreamProcessor({ 
  messageId, 
  content, 
  isStreaming,
  containerClassName = "prose break-words dark:prose-invert" 
}: StreamProcessorProps) {
  const streamRef = useRef<DirectStreamRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<string>('');
  const [containerId] = useState(() => `direct-stream-${messageId}-${Date.now()}`);
  const animationStartedRef = useRef(false);

  // Create stream renderer on mount
  useEffect(() => {
    if (!streamRef.current) {
      console.log(`[StreamProcessor] Creating stream renderer for message: ${messageId}`);
      streamRef.current = createDirectStreamRenderer(messageId);
    }
    
    return () => {
      // Clean up renderer on unmount
      if (streamRef.current) {
        streamRef.current.disableDomManipulation();
        streamRef.current = null;
      }
    };
  }, [messageId]);
  
  // Initialize streaming when component mounts
  useEffect(() => {
    if (streamRef.current && containerRef.current) {
      console.log(`[StreamProcessor] Setting container ID: ${containerId}`);
      containerRef.current.id = containerId;
      
      // Initialize the stream renderer after a short delay to ensure DOM is ready
      setTimeout(() => {
        if (streamRef.current) {
          streamRef.current.initialize();
          
          // If we already have content, start with it
          if (content && content.length > 0) {
            streamRef.current.update(content);
            animationStartedRef.current = true;
          }
        }
      }, 50);
    }
  }, [containerId, content]);
  
  // Update the stream content whenever it changes
  useEffect(() => {
    // Only process if we have a stream renderer and the content has changed
    if (streamRef.current && content !== contentRef.current) {
      contentRef.current = content;
      
      if (isStreaming) {
        // If streaming, update the stream with the new content
        streamRef.current.update(content);
        animationStartedRef.current = true;
      } else if (!animationStartedRef.current || content.length > 0) {
        // If not streaming but we haven't shown content yet, force a full render
        streamRef.current.forceFullRender();
        animationStartedRef.current = true;
      }
    }
  }, [content, isStreaming]);

  return (
    <div 
      ref={containerRef} 
      className={containerClassName}
      style={{ minHeight: '1.5em' }}
    >
      {/* This div will be populated by the DirectStreamRenderer */}
    </div>
  );
}
