import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { checkRateLimit, getRateLimitIdentifier } from '@/lib/embed-rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod/v3';
import { ExtendedMessage, toAPIMessage } from '@/types/chat';
import { enhancedRetrieveChunks } from '@/lib/enhanced-rag-retrieval';
// Import URL extraction utilities
import { formatURLsForContext, createLinkUsageInstructions, type ExtractedURL } from '@/lib/url-extractor';
// Import enhanced RAG prompt for strict RAG-only behavior
import { createEnhancedRAGPrompt } from '@/lib/thinking-rag-enhancer';

// Use Node.js runtime instead of Edge
export const runtime = 'nodejs';

// Initialize OpenRouter provider
const openrouterProvider = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY || '', // Ensure it's not undefined
  baseURL: 'https://openrouter.ai/api/v1',
});

// Log provider initialization to verify it was created correctly
console.log('EMBED API: OpenRouter provider initialized:',
  !!openrouterProvider,
  'with API key starting with:',
  env.OPENROUTER_API_KEY ? `${env.OPENROUTER_API_KEY.substring(0, 7)}...` : 'none'
);

// Request validation schema
const embedChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })),
  model: z.string().optional().default('openai/gpt-4o-mini')
});

// Helper function to create a proper AI message for errors (same as main chat API)
function createErrorResponse(message: string) {
  // Format the error as a proper token stream similar to what the client expects
  return new Response(
    `3:"${message}"

0:

`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    }
  );
}

export async function POST(request: NextRequest) {
  console.log('EMBED API: POST request received');
  console.log('EMBED API: Environment check:', {
    EMBED_ENABLED: env.NEXT_PUBLIC_EMBED_ENABLED,
    OPENROUTER_KEY_PRESENT: !!env.OPENROUTER_API_KEY,
    OPENROUTER_KEY_LENGTH: env.OPENROUTER_API_KEY?.length || 0
  });

  try {
    // Check if embed is enabled (also allow in demo mode)
    const isDemoMode = env.NEXT_PUBLIC_DEMO_MODE === 'true';
    if (env.NEXT_PUBLIC_EMBED_ENABLED !== 'true' && !isDemoMode) {
      console.log('EMBED API: Embed functionality is disabled');
      return createErrorResponse('Embed functionality is disabled');
    }

    // Domain validation
    const allowedDomains = env.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS;
    if (allowedDomains !== '*') {
      const domains = allowedDomains.split(',').map((d: string) => d.trim());
      const requestOrigin = request.headers.get('origin');

      if (requestOrigin) {
        const isAllowed = domains.some((domain: string) => {
          if (domain.startsWith('*.')) {
            const baseDomain = domain.substring(2);
            return requestOrigin.endsWith(baseDomain);
          }
          return requestOrigin.includes(domain);
        });

        if (!isAllowed) {
          return createErrorResponse('Domain not allowed');
        }
      }
    }

    // Rate limiting
    const rateLimitId = getRateLimitIdentifier(request);
    const rateLimit = checkRateLimit(rateLimitId);

    if (!rateLimit.allowed) {
      return new NextResponse('Rate limit exceeded', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': env.EMBED_RATE_LIMIT,
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Parse and validate request body
    const body = await request.json();
    console.log('EMBED API: Request body:', { messagesCount: body.messages?.length, model: body.model });
    const { messages, model } = embedChatSchema.parse(body);

    // --- RAG RETRIEVAL: Get relevant documents from knowledge base ---
    console.log('[EMBED RAG] Starting document retrieval...');
    let context = '';

    // Get the last user message as the query
    const userMessages = messages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    const queryText = lastUserMessage?.content || '';

    if (queryText && queryText.trim().length > 0) {
      try {
        console.log('[EMBED RAG] Query:', queryText);

        // Retrieve relevant chunks using enhanced RAG
        const enhancedResult = await enhancedRetrieveChunks(queryText, {
          maxResults: parseInt(env.RAG_FINAL_RESULT_COUNT || '25'),
          enableTemporalBoost: true,
          enableFinancialBoost: true,
          requireTemporalMatch: false,
          fallbackToLowerThreshold: true
        });

        console.log(`[EMBED RAG] Retrieved ${enhancedResult.chunks.length} chunks using ${enhancedResult.retrievalStrategy}`);

        if (enhancedResult.chunks.length > 0) {
          // Format chunks into context
          const contextParts: string[] = ["\n\n=== RELEVANT INFORMATION FROM DOCUMENTS ==="];

          // Group chunks by document
          const chunksByDocument = new Map<string, Array<{ content: string, similarity: number }>>();

          // Collect URLs from chunk metadata
          const collectedURLs: ExtractedURL[] = [];

          // Cache document names to avoid repeated queries
          const docNameCache = new Map<string, string>();

          for (const chunk of enhancedResult.chunks) {
            // Fetch chunk metadata to extract URLs and document info
            const supabase = getSupabaseAdmin();

            // Get document name from cache or fetch from database
            let docName = docNameCache.get(chunk.document_id);
            if (!docName) {
              const { data: docData } = await supabase
                .from('documents')
                .select('filename')
                .eq('id', chunk.document_id)
                .single();
              docName = docData?.filename || 'Unknown Document';
              docNameCache.set(chunk.document_id, docName);
            }

            if (!chunksByDocument.has(docName)) {
              chunksByDocument.set(docName, []);
            }
            chunksByDocument.get(docName)!.push({
              content: chunk.content,
              similarity: chunk.similarity
            });

            // Fetch chunk metadata to extract URLs
            const { data: chunkData } = await supabase
              .from('document_chunks')
              .select('metadata')
              .eq('id', chunk.chunk_id)
              .single();

            if (chunkData?.metadata?.urls && Array.isArray(chunkData.metadata.urls)) {
              collectedURLs.push(...chunkData.metadata.urls);
            }
          }

          // Add organized chunks to context
          for (const [docName, chunks] of chunksByDocument) {
            contextParts.push(`\n--- Document: ${docName} (${chunks.length} relevant chunks) ---`);
            const formattedChunks = chunks.map(c => c.content);
            contextParts.push(...formattedChunks);
          }
          contextParts.push("=== END OF RELEVANT INFORMATION ===\n");

          // Add collected URLs to context if any were found
          if (collectedURLs.length > 0) {
            // Remove duplicates based on URL
            const uniqueURLs = Array.from(
              new Map(collectedURLs.map(url => [url.url, url])).values()
            );

            const urlSection = formatURLsForContext(uniqueURLs);
            if (urlSection) {
              contextParts.push(urlSection);
              console.log(`[EMBED RAG] Added ${uniqueURLs.length} unique URLs from chunks to context`);
            }
          }

          context = contextParts.join('\n\n');
          console.log(`[EMBED RAG] Built context with ${context.length} characters from ${chunksByDocument.size} documents`);
        } else {
          console.log('[EMBED RAG] No relevant chunks found');
          context = 'No relevant information found in the knowledge base for this query.';
        }
      } catch (error) {
        console.error('[EMBED RAG] Error during retrieval:', error);
        context = 'No relevant information found in the knowledge base for this query.';
      }
    } else {
      console.log('[EMBED RAG] No query text provided, skipping retrieval');
    }

    // Use the same system prompt format as the main chat API
    // Get the RAG system prompt from environment (same as main chat)
    let systemPrompt = `You are a helpful AI assistant with access to a knowledge base. When answering questions:

1. If the context contains relevant information, use it to provide accurate and specific answers
2. If information is not available in the context, say so clearly and suggest alternative approaches
3. Always cite your sources when referencing specific documents
4. Provide balanced, objective information rather than opinions
5. For technical topics, include practical steps or examples when appropriate

${createLinkUsageInstructions()}

Context:
{{context}}`;

    // Use the custom RAG system prompt if available
    if (env.RAG_SYSTEM_PROMPT) {
      try {
        // Safe decode function to handle multiple layers of URL encoding
        let ragPrompt = env.RAG_SYSTEM_PROMPT;
        let previous = '';
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops

        // Recursively decode until no more encoding detected
        while (ragPrompt !== previous && ragPrompt.includes('%') && iterations < maxIterations) {
          previous = ragPrompt;
          try {
            ragPrompt = decodeURIComponent(ragPrompt);
            iterations++;
          } catch (e) {
            console.warn('Decoding iteration failed:', e);
            break;
          }
        }

        if (iterations > 0) {
          console.log(`[Embed API] Successfully decoded system prompt after ${iterations} iterations`);
        }

        systemPrompt = ragPrompt;
      } catch (e) {
        console.log('EMBED API: Could not decode RAG_SYSTEM_PROMPT, using default');
      }
    }

    // Use enhanced RAG prompt for strict RAG-only behavior (same as main chat)
    console.log('[EMBED RAG] Injecting context into system prompt...');
    console.log('[EMBED RAG] Context length:', context.length);
    console.log('[EMBED RAG] System prompt contains {{context}}:', systemPrompt.includes('{{context}}'));

    // Use the same logic as main chat: if context exists, use enhanced prompt
    // This enforces strict RAG-only behavior preventing answers outside knowledge base
    const finalSystemPrompt = context.length > 0
      ? createEnhancedRAGPrompt(systemPrompt, context)
      : systemPrompt.replace('{{context}}', context);

    console.log('[EMBED RAG] Final system prompt preview (first 300 chars):', finalSystemPrompt.substring(0, 300));
    console.log('[EMBED RAG] Using enhanced RAG prompt:', context.length > 0);

    const systemMessage: ExtendedMessage = {
      id: 'embed-system-context',
      role: 'system',
      content: finalSystemPrompt
    };

    const userAndAssistantMessages: ExtendedMessage[] = messages.map((message, index) => ({
      id: `embed-${index}`,
      role: message.role,
      content: message.content
    }));

    const messagesForModelExtended: ExtendedMessage[] = [systemMessage, ...userAndAssistantMessages];
    // Convert to API message format (CoreMessage) for streamText, not UIMessage
    const messagesForModel = messagesForModelExtended.map(toAPIMessage);

    // Stream the response using OpenRouter (SAME AS MAIN CHAT API)
    console.log('EMBED API: Calling streamText with model:', model);
    console.log('EMBED API: Messages for model:', messagesForModel.length);
    console.log('EMBED API: OpenRouter provider check:', !!openrouterProvider);
    console.log('EMBED API: API key check:', !!env.OPENROUTER_API_KEY);

    // Use a more reliable model name (same as main chat uses)
    const safeModelId = model || 'openai/gpt-4o-mini';
    console.log('EMBED API: Using safe model ID:', safeModelId);

    // Get the provider function for the model (same as main chat)
    const modelProvider = openrouterProvider(safeModelId);

    if (!modelProvider) {
      console.error('EMBED API: Failed to get model provider from OpenRouter');
      return createErrorResponse("I'm having trouble connecting to the AI service. The model provider could not be initialized.");
    }

    console.log('EMBED API: Model provider initialized successfully');

    try {
      const result = await streamText({
        model: modelProvider,
        messages: messagesForModel,
        temperature: 0.1, // Use same temperature as main chat
        maxOutputTokens: 2000,
        // Don't include tools for embed API to keep it simple
      });

      console.log('EMBED API: streamText call successful, streaming to client');

      // Return the AI SDK stream directly (SAME AS MAIN CHAT API)
      return result.toUIMessageStreamResponse({
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Vary': 'Origin',
          'X-Content-Type-Options': 'nosniff',
          'X-RateLimit-Limit': env.EMBED_RATE_LIMIT,
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimit.resetTime).toISOString(),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });

    } catch (streamError) {
      console.error('=== EMBED API: STREAM ERROR ===');
      console.error('EMBED API: streamText failed:', streamError);
      console.error('EMBED API: streamText error message:', (streamError as Error).message);
      console.error('EMBED API: streamText error type:', (streamError as Error).constructor.name);
      console.error('EMBED API: streamText error stack:', (streamError as Error).stack);

      // Return a more detailed error response for debugging
      const errorDetails = {
        error: (streamError as Error).message,
        type: (streamError as Error).constructor.name,
        hasApiKey: !!env.OPENROUTER_API_KEY,
        keyLength: env.OPENROUTER_API_KEY?.length || 0,
        apiKeyPrefix: env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY.substring(0, 10) + '...' : 'none',
        model: model,
        safeModelId: safeModelId
      };

      console.error('EMBED API: Detailed error info:', errorDetails);

      // Return the actual error message for debugging
      const errorMessage = `OpenRouter Error: ${(streamError as Error).message}. Check server console for details.`;
      return createErrorResponse(errorMessage);
    }

  } catch (error) {
    console.error('=== EMBED API: MAIN CATCH BLOCK ===');
    console.error('EMBED API: Error occurred:', error);
    console.error('EMBED API: Error type:', error?.constructor?.name);
    console.error('EMBED API: Error message:', (error as Error)?.message);
    console.error('EMBED API: Error stack:', (error as Error)?.stack);

    if (error instanceof z.ZodError) {
      console.log('EMBED API: Zod validation error:', error.errors);
      return createErrorResponse('Validation error - check your message format');
    }

    // Return detailed error in a user-friendly format
    const errorMessage = `I'm having trouble processing your request. Please try again later.`;
    return createErrorResponse(errorMessage);
  }
}

export async function OPTIONS(request: NextRequest) {
  console.log('EMBED API: OPTIONS request received');

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'Vary': 'Origin'
    },
  });
} 
