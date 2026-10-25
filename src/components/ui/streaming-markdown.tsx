'use client';

import React, { useMemo, useId } from 'react';
// We need to import the original to avoid circular dependencies
import { Markdown as OriginalMarkdown, MarkdownProps } from '@/components/ui/markdown';
import { StreamProcessor } from './stream-processor';
import { memo } from 'react';
import { useTextSize } from "@/components/providers/text-size-provider";
import { useFont } from "@/components/providers/font-provider";
import { cn } from "@/lib/utils";

interface StreamingMarkdownProps extends MarkdownProps {
  isStreaming?: boolean;
  messageId?: string;
}

/**
 * StreamingMarkdown component
 * 
 * A wrapper around the Markdown component that adds text streaming capabilities.
 * Will stream content when isStreaming is true, or display it normally when false.
 * 
 * Compatible with the existing Markdown component API for seamless integration.
 */
function StreamingMarkdownComponent({
  children,
  isStreaming = false,
  messageId,
  className = "prose break-words dark:prose-invert",
  components,
  id,
  ...rest
}: StreamingMarkdownProps) {
  const generatedId = useId();
  const uniqueId = messageId || id || generatedId;
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();
  const [content, setContent] = useState<string>(typeof children === 'string' ? children : '');
  
  // Update content when children prop changes
  useEffect(() => {
    if (typeof children === 'string' && children !== content) {
      setContent(children);
    }
  }, [children, content]);
  
  // Apply text size and font classes
  const composedClassName = useMemo(() => {
    return cn(
      className,
      `text-size-${textSize}`,
      `font-${fontFamily}`
    );
  }, [className, textSize, fontFamily]);
  
  // If streaming is enabled and we have content and messageId, use the StreamProcessor
  if (isStreaming && content && uniqueId) {
    return (
      <StreamProcessor
        messageId={uniqueId}
        content={content}
        isStreaming={true}
        containerClassName={composedClassName}
      />
    );
  }
  
  // If not streaming, just render the markdown normally with the original component
  return <OriginalMarkdown className={className} components={components} id={id} {...rest}>{children}</OriginalMarkdown>;
}

// Memoize the component for better performance
const StreamingMarkdown = memo(StreamingMarkdownComponent);
StreamingMarkdown.displayName = "StreamingMarkdown";

export { StreamingMarkdown };
