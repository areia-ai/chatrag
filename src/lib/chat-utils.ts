import type { ToolCallPart, ToolResultPart } from 'ai';
import type { ContentPart } from '@/types/chat';

interface PrepareToolCallOptions {
  toolCall: ToolCallPart;
  initialExplanation?: string;
}

interface PrepareToolResultOptions {
  toolCall: ToolCallPart;
  toolResult: ToolResultPart;
  resultExplanation?: string;
}

// Type guards for content part types
export function isToolCallPart(part: ContentPart): boolean {
  return part.type === 'tool_call' || part.type === 'tool-call';
}

export function isToolResultPart(part: ContentPart): boolean {
  return part.type === 'tool_result';
}

export function isTextPart(part: ContentPart): boolean {
  return part.type === 'text';
}

/**
 * DirectStreamRenderer - A direct DOM manipulation approach for text streaming
 * This helps ensure stream updates are visible even when React is not re-rendering properly
 */
export class DirectStreamRenderer {
  private containerId: string;
  private containerElement: HTMLElement | null = null;
  private content: string = '';
  private cursorPosition: number = 0;
  private animationTimeout: NodeJS.Timeout | null = null;
  private isTyping: boolean = false;
  private pendingUpdates: boolean = false;
  private lastRenderTime: number = 0;
  private allowDomManipulation: boolean = true;
  private onRenderUpdate: ((text: string) => void) | null = null;

  constructor(containerId: string, onRenderUpdate?: (text: string) => void) {
    this.containerId = containerId;
    this.lastRenderTime = Date.now();
    this.onRenderUpdate = onRenderUpdate || null;
  }

  public initialize(): void {
    // Only initialize if we're in browser environment
    if (typeof document !== 'undefined') {
      this.containerElement = document.getElementById(this.containerId);
      console.log(`[DirectStreamRenderer] Initialized for container: ${this.containerId}, found: ${!!this.containerElement}`);
    }
  }

  public update(newContent: string): void {
    if (this.content === newContent) return;
    
    console.log(`[DirectStreamRenderer] Content update: ${newContent.length} chars, previous: ${this.content.length} chars`);
    this.content = newContent;
    this.pendingUpdates = true;
    
    if (!this.isTyping && this.allowDomManipulation) {
      this.startAnimation();
    }
  }

  public disableDomManipulation(): void {
    this.allowDomManipulation = false;
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }
    this.isTyping = false;
  }

  public enableDomManipulation(): void {
    this.allowDomManipulation = true;
    if (this.pendingUpdates) {
      this.startAnimation();
    }
  }

  public forceFullRender(): void {
    if (!this.containerElement || !this.allowDomManipulation) return;
    
    // Force a complete render of all content
    try {
      // First try to use the application's markdown processor if available
      if (typeof window !== 'undefined' && (window as any).marked) {
        this.containerElement.innerHTML = (window as any).marked.parse(this.content);
      } else {
        this.containerElement.textContent = this.content;
      }
    } catch (e) {
      console.error('[DirectStreamRenderer] Error rendering with markdown, falling back to text:', e);
      this.containerElement.textContent = this.content;
    }
    
    this.cursorPosition = this.content.length;
    this.pendingUpdates = false;
    
    // Notify the callback if provided
    if (this.onRenderUpdate) {
      this.onRenderUpdate(this.content);
    }
  }

  private startAnimation(): void {
    if (!this.containerElement || !this.allowDomManipulation) return;
    
    this.isTyping = true;
    const animate = () => {
      if (!this.containerElement || !this.allowDomManipulation) {
        this.isTyping = false;
        return;
      }
      
      const currentTime = Date.now();
      const timeSinceLastRender = currentTime - this.lastRenderTime;
      
      // Adjust character rate for more natural typing
      // Start slower and accelerate as needed based on remaining content
      let charsToAdd = 1;
      const remaining = this.content.length - this.cursorPosition;
      
      // Gradually increase characters added for longer content
      // This provides a more natural typing effect while still handling large content efficiently
      if (remaining > 200) {
        charsToAdd = 8; // Faster for very long content
      } else if (remaining > 100) {
        charsToAdd = 4; // Medium speed for longer content
      } else if (remaining > 50) {
        charsToAdd = 2; // Slower as we approach the end
      } else {
        charsToAdd = 1; // Slowest at the end for dramatic effect
      }
      
      // Update cursor and get chunk to display
      const newPosition = Math.min(this.cursorPosition + charsToAdd, this.content.length);
      const contentToRender = this.content.substring(0, newPosition);
      this.cursorPosition = newPosition;
      
      // Update DOM with new content
      try {
        // First try to use the application's markdown processor if available
        if (typeof window !== 'undefined' && (window as any).marked) {
          this.containerElement.innerHTML = (window as any).marked.parse(contentToRender);
        } else {
          this.containerElement.textContent = contentToRender;
        }
      } catch (e) {
        console.error('[DirectStreamRenderer] Error rendering content:', e);
        this.containerElement.textContent = contentToRender;
      }
      
      this.lastRenderTime = currentTime;
      
      // Notify the callback if provided
      if (this.onRenderUpdate) {
        this.onRenderUpdate(contentToRender);
      }
      
      // Continue animation if there's still content to render
      if (this.cursorPosition < this.content.length) {
        // Variable delay based on content position for more natural effect
        // Slower at the beginning and end, faster in the middle
        let delay = 30; // Base delay
        
        const progressPercentage = this.cursorPosition / this.content.length;
        if (progressPercentage < 0.1) {
          // Beginning of content - slightly slower
          delay = 40;
        } else if (progressPercentage > 0.9) {
          // End of content - slightly slower
          delay = 50;
        } else if (remaining > 100) {
          // Middle of long content - faster
          delay = 15;
        }
        
        this.animationTimeout = setTimeout(animate, delay);
      } else {
        this.isTyping = false;
        this.pendingUpdates = false;
        console.log('[DirectStreamRenderer] Animation complete');
      }
    };
    
    // Start the animation loop with a slight initial delay for UI to settle
    this.animationTimeout = setTimeout(animate, 50);
  }
}

/**
 * Creates a direct stream renderer that bypasses React state for streaming updates
 */
export function createDirectStreamRenderer(messageId: string, onRenderUpdate?: (text: string) => void): DirectStreamRenderer {
  const uniqueId = `direct-stream-${messageId}-${Date.now()}`;
  return new DirectStreamRenderer(uniqueId, onRenderUpdate);
}

/**
 * Prepares a tool call for storage in the database,
 * ensuring all necessary fields are preserved.
 */
export function prepareToolCallForStorage(options: PrepareToolCallOptions): any {
  try {
    const { toolCall, initialExplanation } = options;
    
    // Normalize field names for storage
    return {
      type: 'tool_call',
      id: toolCall.toolCallId || (toolCall as any).id || `fallback_tc_${Date.now()}`,
      tool: toolCall.toolName || (toolCall as any).tool || 'unknown_tool',
      toolName: toolCall.toolName || (toolCall as any).tool || 'unknown_tool', // Ensure both fields exist
      toolCallId: toolCall.toolCallId || (toolCall as any).id || `fallback_tc_${Date.now()}`, // Ensure both fields exist
      args: toolCall.args || {},
      proposalExplanation: initialExplanation,
      isApproved: false // Tool calls start as not approved
    };
  } catch (error) {
    console.error('[chat-utils] Error in prepareToolCallForStorage:', error);
    // Return a minimal valid tool call object
    return {
      type: 'tool_call',
      id: `error_tc_${Date.now()}`,
      tool: 'unknown_tool',
      toolName: 'unknown_tool',
      toolCallId: `error_tc_${Date.now()}`,
      args: {},
      isApproved: false
    };
  }
}

/**
 * Prepares a tool result for storage in the database,
 * ensuring all necessary fields are preserved.
 */
export function prepareToolResultForStorage(options: PrepareToolResultOptions): any {
  try {
    const { toolCall, toolResult, resultExplanation } = options;
    
    // Normalize tool call fields
    const toolCallId = toolCall.toolCallId || (toolCall as any).id || `fallback_tc_${Date.now()}`;
    const toolName = toolCall.toolName || (toolCall as any).tool || 'unknown_tool';
    
    // Try to extract explanation from the result if one wasn't explicitly provided
    let extractedExplanation = resultExplanation;
    let normalizedResult = toolResult.result;
    
    // Handle nested content structure from MCP
    if (normalizedResult && typeof normalizedResult === 'object') {
      const resultAny = normalizedResult as any;
      if (resultAny.content && Array.isArray(resultAny.content)) {
        const textPart = resultAny.content.find((part: any) => part.type === 'text');
        if (textPart && textPart.text) {
          try {
            // Check if text looks like JSON
            if ((textPart.text.startsWith('{') && textPart.text.endsWith('}')) ||
                (textPart.text.startsWith('[') && textPart.text.endsWith(']'))) {
              // Try to parse nested JSON in the text property
              normalizedResult = JSON.parse(textPart.text);
            } else {
              normalizedResult = textPart.text;
              if (!extractedExplanation) {
                extractedExplanation = textPart.text;
              }
            }
          } catch (e) {
            console.log(`[chat-utils] Error parsing content text:`, e);
            normalizedResult = textPart.text;
            if (!extractedExplanation) {
              extractedExplanation = textPart.text;
            }
          }
        }
      }
    }
    
    if (!extractedExplanation) {
      if (typeof normalizedResult === 'string' && 
          !normalizedResult.startsWith('{') && 
          !normalizedResult.startsWith('[')) {
        extractedExplanation = normalizedResult;
      } else if (normalizedResult && typeof normalizedResult === 'object') {
        const resObj = normalizedResult as any;
        if (resObj.message && typeof resObj.message === 'string') extractedExplanation = resObj.message;
        else if (resObj.explanation && typeof resObj.explanation === 'string') extractedExplanation = resObj.explanation;
        else if (resObj.text && typeof resObj.text === 'string') extractedExplanation = resObj.text;
      }
    }
    
    // Check if this result has an explicit approval status
    const hasExplicitApproval = 'isApproved' in toolResult && typeof toolResult.isApproved === 'boolean';
    
    // Default to true for results (for backward compatibility), 
    // but use explicit value if provided
    const isApproved = hasExplicitApproval ? toolResult.isApproved : true;
    
    return {
      type: 'tool_result',
      id: `${toolCallId}_result`,
      tool: toolName,
      toolName: toolName, // Ensure both fields exist
      toolCallId: toolCallId, // Store reference to original tool call
      result: normalizedResult,
      isError: toolResult.isError || false,
      isApproved: isApproved,
      resultExplanation: extractedExplanation
    };
  } catch (error) {
    console.error('[chat-utils] Error in prepareToolResultForStorage:', error);
    // Return a minimal valid tool result object
    return {
      type: 'tool_result',
      id: `error_tr_${Date.now()}`,
      tool: 'unknown_tool',
      toolName: 'unknown_tool',
      toolCallId: `error_tc_${Date.now()}`,
      result: null,
      isError: true,
      isApproved: false,
      resultExplanation: 'Error occurred while processing tool result.'
    };
  }
}

/**
 * Updates existing message content with tool calls and results
 * to ensure they have the necessary fields for persistence.
 */
export function prepareMessageContentForStorage(content: any[]): any[] {
  // Safety check
  if (!Array.isArray(content)) {
    console.log('[prepareMessageContentForStorage] Input is not an array, returning as is');
    return content;
  }
  
  try {
    console.log(`[MCP Persistence] Preparing ${content.length} content parts for storage`);
    
    const prepared = content.map(part => {
      if (!part || typeof part !== 'object') {
        return part; // Can't process non-objects
      }
      
      try {
        // Normalize tool call type: 'tool-call' -> 'tool_call' for consistency
        if (part.type === 'tool-call') {
          console.log('[MCP Persistence] Normalizing tool-call to tool_call type');
          part = { ...part, type: 'tool_call' };
        }
        
        if (part.type === 'tool_call') {
          // Tool calls need to retain their proposalExplanation and approval state
          const hasExplicitApproval = 'isApproved' in part && typeof part.isApproved === 'boolean';
          
          // Normalize field names for consistency
          const toolCallId = part.id || part.toolCallId || `fallback_tc_${Date.now()}`;
          const toolName = part.tool || part.toolName || 'unknown_tool';
          
          // For tool calls, default to false unless specified
          const isApproved = hasExplicitApproval ? part.isApproved : false;
          
          const preparedToolCall = {
            ...part,
            type: 'tool_call', // Ensure consistent type
            id: toolCallId,
            toolCallId: toolCallId, // Ensure both fields exist
            tool: toolName,
            toolName: toolName, // Ensure both fields exist
            args: part.args || {},
            proposalExplanation: part.proposalExplanation || part.initialExplanationText,
            isApproved: isApproved,
            title: part.title // Preserve the title field
          };
          
          console.log(`[MCP Persistence] Prepared tool_call for storage:`, {
            tool: preparedToolCall.tool,
            hasExplanation: !!preparedToolCall.proposalExplanation,
            isApproved: preparedToolCall.isApproved
          });
          
          return preparedToolCall;
        }
        
        if (part.type === 'tool_result') {
          // For results, see if there's an explicit approval
          const hasExplicitApproval = 'isApproved' in part && typeof part.isApproved === 'boolean';
          
          // Normalize field names for consistency
          const toolCallId = part.toolCallId || part.id?.replace(/_result$/, '') || `fallback_tc_${Date.now()}`;
          const toolName = part.tool || part.toolName || 'unknown_tool';
          
          // Tool results default to true unless specified
          const isApproved = hasExplicitApproval ? part.isApproved : true;
          
          // If we have a resultExplanation, use it, otherwise try to extract from result
          let resultExplanation = part.resultExplanation;
          let parsedResult = part.result;
          
          // Handle nested content structure
          if (parsedResult && typeof parsedResult === 'object') {
            const resultAny = parsedResult as any;
            if (resultAny.content && Array.isArray(resultAny.content)) {
              const textPart = resultAny.content.find((cPart: any) => cPart.type === 'text');
              if (textPart && textPart.text) {
                try {
                  // Check if text looks like JSON
                  if ((textPart.text.startsWith('{') && textPart.text.endsWith('}')) ||
                      (textPart.text.startsWith('[') && textPart.text.endsWith(']'))) {
                    // Try to parse nested JSON in the text property
                    parsedResult = JSON.parse(textPart.text);
                  } else {
                    parsedResult = textPart.text;
                    if (!resultExplanation) {
                      resultExplanation = textPart.text;
                    }
                  }
                } catch (e) {
                  console.log(`[MCP Persistence] Error parsing content text:`, e);
                  parsedResult = textPart.text;
                  if (!resultExplanation) {
                    resultExplanation = textPart.text;
                  }
                }
              }
            }
          }
          
          if (!resultExplanation && parsedResult) {
            if (typeof parsedResult === 'string' && 
                !parsedResult.startsWith('{') && 
                !parsedResult.startsWith('[')) {
              resultExplanation = parsedResult;
            } else if (typeof parsedResult === 'object' && parsedResult !== null) {
              try {
                const resObj = parsedResult as any;
                if (resObj.message && typeof resObj.message === 'string') 
                  resultExplanation = resObj.message;
                else if (resObj.explanation && typeof resObj.explanation === 'string') 
                  resultExplanation = resObj.explanation;
                else if (resObj.text && typeof resObj.text === 'string') 
                  resultExplanation = resObj.text;
              } catch (exError) {
                console.error('[MCP Persistence] Error extracting explanation:', exError);
              }
            }
          }
          
          
          const preparedToolResult = {
            ...part,
            type: 'tool_result',
            id: part.id || `${toolCallId}_result`,
            toolCallId: toolCallId, // Ensure relationship to tool call
            tool: toolName,
            toolName: toolName, // Ensure both fields exist
            isApproved: isApproved,
            result: parsedResult,
            resultExplanation: resultExplanation
          };
          
          console.log(`[MCP Persistence] Prepared tool_result for storage:`, {
            tool: preparedToolResult.tool,
            hasExplanation: !!preparedToolResult.resultExplanation,
            isApproved: preparedToolResult.isApproved,
            hasResult: preparedToolResult.result !== undefined && preparedToolResult.result !== null
          });
          
          return preparedToolResult;
        }
        
        return part;
      } catch (partError) {
        console.error('[MCP Persistence] Error processing part for storage:', partError);
        return part; // Return original if there's an error
      }
    });
    
    return prepared;
  } catch (error) {
    console.error('[MCP Persistence] Error in prepareMessageContentForStorage:', error);
    return content; // Return original if there's an error
  }
}

// Update the createChatMessages function to preserve explanationText from tool calls
export function createChatMessages(messages: any[], includeImages = true): any[] {
  return messages.map(msg => {
    // Process content into standardized array format
    if (typeof msg.content === 'string') {
      // Check if this is an approval message with explanation text
      if (msg.content.includes('__REQUIRES_APPROVAL__') && msg.content.includes('|||EXPLANATION|||')) {
        // Keep the entire string including the explanation - it will be parsed correctly in the frontend
        console.log('[chat-utils] Preserved explanation text in approval message');
        return {
          ...msg,
          content: msg.content
        };
      }
      
      // Otherwise it's a normal text message
      return {
        ...msg,
        content: [{ type: 'text', text: msg.content }]
      };
    }
    
    // If it's already an array, preserve it but standardize/transform as needed
    if (Array.isArray(msg.content)) {
      // Process tool calls specifically to preserve their explanations
      const processedContent = msg.content.map((part: any) => {
        // If this is a tool call and we have explanationText in the metdata, preserve it
        if (part.type === 'tool-call' || part.type === 'tool_call') {
          // Make sure to include explanationText if it exists (might be in metadata)
          if (part.metadata?.explanationText) {
            console.log('[chat-utils] Found explanationText in tool call metadata, preserving it');
            return {
              ...part,
              // Ensure explanationText is persisted with the tool call
              explanationText: part.metadata.explanationText
            };
          }
        }
        return part;
      });
      
      return {
        ...msg,
        content: processedContent
      };
    }
    
    // If it's neither a string nor an array, return it unchanged
    return msg;
  });
} 