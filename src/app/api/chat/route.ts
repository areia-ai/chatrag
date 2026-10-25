import { streamText, tool, type ToolSet, type ToolCallPart, type ToolResultPart, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, UIMessage, stepCountIs } from 'ai';
import { z } from 'zod/v3';
// Use the dedicated OpenRouter provider
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getQueryEmbedding } from '@/lib/document-processor';
import { searchSimilarChunks, getSupabaseAdmin } from '@/lib/supabase';
import { env, getAppName } from '@/lib/env';
// Import enhanced RAG modules for dual-mode support
import { comprehensiveRetrieval, aggregateChunks, requiresComprehensiveRetrieval } from '@/lib/retrieval-strategies';
import { optimizedSearch } from '@/lib/optimized-search';
// Remove direct OpenRouter client import if using AI SDK provider
// import { getOpenRouterClient } from '@/lib/openrouter';
import { ContentPart, APIMessage, ExtendedMessage, fromAPIMessages, toMessage } from '@/types/chat';
import { ReasoningConfig, REASONING_MODELS } from '@/lib/types';
// Import enhanced RAG functionality
import { enhanceQueryWithReasoning, intelligentSearch, createEnhancedRAGPrompt } from '@/lib/thinking-rag-enhancer';
import { enhancedRetrieveChunks } from '@/lib/enhanced-rag-retrieval';
// Import URL extraction utilities
import { formatURLsForContext, type ExtractedURL } from '@/lib/url-extractor';
// Keep custom tool definitions if needed

import { ReadableStream } from 'stream/web';
// Import MCP integration
// import { enhanceModelWithMcpTools } from '@/lib/mcp/ai-sdk-integration';
import { NextRequest, NextResponse } from 'next/server';
import { withValidation } from '@/lib/api-middleware';
import { openai, createOpenAI } from '@ai-sdk/openai';
// Import performance optimizations
import { classifyQuery, shouldSkipMcp } from '@/lib/query-classifier';
import { getCachedTools, setCachedTools, getCachedConnection, setCachedConnection } from '@/lib/mcp-cache';
// Import UniversalMcpClient for YOLO mode execution
import { UniversalMcpClient } from '@/lib/mcp/universal-client';
import { ToolExecutionStateService } from '@/lib/tool-execution-state';
import { SystemPromptManager, SystemPromptTemplate } from '@/lib/system-prompt-manager';
import { Language } from '@/translations';
import { isMultiTenant } from '@/lib/deployment-mode';

// Use Node.js runtime instead of Edge
export const runtime = 'nodejs';

// Define document reference tool for function calling using the 'tool' helper
const documentReferenceTool = tool({
  description: 'IMPORTANT: This is a FUNCTION TOOL to track document usage internally. Call this tool when you use information from documents. DO NOT write "useDocument" as text in your response. This tool tracks which documents you referenced to answer the query.',
  inputSchema: z.object({
    documentId: z.string().describe('The ID of the document that was used'),
    documentName: z.string().describe('The name/filename of the document'),
    relevance: z.number().min(0).max(100).describe('How relevant this document was to the query (0-100)'),
    reason: z.string().describe('Why this document was used to answer the query')
  }),
  execute: async ({ documentId, documentName, relevance, reason }) => {
    // Log the document reference for tracking
    console.log('[Document Reference Tool] Document referenced:', {
      documentId,
      documentName,
      relevance,
      reason
    });

    // Format a nice source citation that can be included in the response
    const sourceText = `📚 **Source:** ${documentName} (Relevance: ${relevance}%)`;

    // Return a structured response with formatted source
    return {
      success: true,
      message: sourceText,
      // Allow this to be shown as a source citation
      internal: false,
      documentName,
      relevance
    };
  }
});

// Legacy document URL mapping - hardcoded URLs for specific documents
// Database metadata (external_url) takes precedence over these mappings
const DOCUMENT_URL_MAP: Record<string, string> = {
  // Add specific document mappings here
  // Example: "Filename.pdf": "https://example.com/source-page"
};


// At the top of the file
console.log('API ROUTE: Chat route module loaded');
console.log('API ROUTE: Environment check -', {
  OPENROUTER_API_KEY_STATUS: env.OPENROUTER_API_KEY ? 'Present' : 'Missing',
  OPENROUTER_API_KEY_LENGTH: env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY.length : 0,
  OPENROUTER_API_KEY_START: env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY.substring(0, 7) : 'n/a'
});

// 🔄 GMAIL INTENT ANALYSIS: Determine if user wants to send vs draft
function analyzeEmailIntent(userMessage: string): { shouldSend: boolean; confidence: number; reasoningText: string } {
  const message = userMessage.toLowerCase();

  // Strong send indicators
  const sendKeywords = ['send', 'email', 'immediately', 'now', 'dispatch', 'transmit', 'deliver'];
  const strongSendPhrases = ['send an email', 'send email', 'email to', 'send and email'];

  // Draft indicators
  const draftKeywords = ['draft', 'prepare', 'create draft', 'make a draft', 'compose draft'];

  let sendScore = 0;
  let draftScore = 0;
  let reasoning = '';

  // Check for strong send phrases first (higher weight)
  for (const phrase of strongSendPhrases) {
    if (message.includes(phrase)) {
      sendScore += 3;
      reasoning += `Strong send phrase: "${phrase}". `;
      break; // Only count one strong phrase
    }
  }

  // Check for send keywords
  const sendMatches = sendKeywords.filter(keyword => message.includes(keyword));
  if (sendMatches.length > 0) {
    sendScore += sendMatches.length * 2;
    reasoning += `Send keywords: ${sendMatches.join(', ')}. `;
  }

  // Check for draft keywords
  const draftMatches = draftKeywords.filter(keyword => message.includes(keyword));
  if (draftMatches.length > 0) {
    draftScore += draftMatches.length * 2;
    reasoning += `Draft keywords: ${draftMatches.join(', ')}. `;
  }

  // Calculate confidence and decision
  const totalScore = sendScore + draftScore;
  const shouldSend = sendScore > draftScore;
  const confidence = totalScore > 0 ? Math.max(sendScore, draftScore) / (totalScore + 2) : 0.1;

  return {
    shouldSend,
    confidence: Math.min(confidence, 0.95), // Cap at 95%
    reasoningText: reasoning.trim() || 'No clear indicators found'
  };
}

// Initialize AI providers based on configuration
const AI_PROVIDER = env.NEXT_PUBLIC_AI_PROVIDER as 'openai' | 'openrouter' | 'groq';

// Identify if the current provider supports tool calling
// Groq currently has limited or no tool calling support in the Vercel AI SDK integration
// OpenRouter support varies by model
const SUPPORTS_TOOLS = AI_PROVIDER === 'openai' || AI_PROVIDER === 'openrouter' || AI_PROVIDER === 'groq'; // Enable tools for OpenAI, OpenRouter, and Groq

// Initialize the OpenRouter provider
const resolvedSiteUrl =
  env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NEXT_PUBLIC_SITE_URL as string) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

const openrouterProvider = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY || '', // Ensure it's not undefined
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    'HTTP-Referer': resolvedSiteUrl,
    'X-Title': getAppName(),
  },
});

// Log provider initialization to verify it was created correctly
console.log('API ROUTE: AI Provider configured:', AI_PROVIDER);
console.log('API ROUTE: OpenRouter provider initialized:',
  !!openrouterProvider,
  'with API key starting with:',
  env.OPENROUTER_API_KEY ? `${env.OPENROUTER_API_KEY.substring(0, 7)}...` : 'none'
);
console.log('API ROUTE: OpenAI provider available:', !!openai);

// Helper function to parse OpenRouter-specific errors
function parseOpenRouterError(error: any): { code?: number; message?: string; details?: any } {
  try {
    // Check for common error properties
    if (error.statusCode || error.status) {
      return {
        code: error.statusCode || error.status,
        message: error.message,
        details: error.responseBody || error.body
      };
    }

    // Try to parse error message if it contains JSON
    if (error.message?.includes('"error"')) {
      // Extract JSON from error message
      const jsonMatch = error.message.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          code: parsed.error?.code || parsed.status || parsed.statusCode,
          message: parsed.error?.message || parsed.message,
          details: parsed
        };
      }
    }

    // Check for status codes in the error object itself
    if (error.status || error.statusCode || error.code) {
      return {
        code: error.status || error.statusCode || error.code,
        message: error.message || error.toString(),
        details: error
      };
    }

    // Fallback to basic error info
    return {
      message: error.message || error.toString() || 'Unknown error',
      details: error
    };
  } catch (parseError) {
    console.error('API ROUTE: Error parsing OpenRouter error:', parseError);
    return {
      message: error?.message || 'Failed to parse error',
      details: error
    };
  }
}

// Helper function to prepare reasoning configuration based on model capabilities
function prepareReasoningConfig(modelId: string, userReasoningConfig?: ReasoningConfig): any {
  // Check if reasoning is enabled globally
  const reasoningEnabled = env.NEXT_PUBLIC_REASONING_ENABLED === 'true';
  if (!reasoningEnabled || userReasoningConfig?.enabled === false) {
    return undefined;
  }

  // Get model capability from static map first
  let modelCapability = REASONING_MODELS[modelId];

  // If not found in static map, try pattern matching as fallback
  if (!modelCapability) {
    const lowerModelId = modelId.toLowerCase();

    // Check for known reasoning model patterns
    if (lowerModelId.includes('o1') || lowerModelId.includes('o3') || lowerModelId.includes('o4') || lowerModelId.includes('gpt-5')) {
      modelCapability = { supported: true, method: 'effort', defaultEffort: lowerModelId.includes('mini') ? 'medium' : 'high' };
    } else if (
      lowerModelId.includes('claude-3.7') ||
      lowerModelId.includes('claude-3.8') ||
      lowerModelId.includes('claude-sonnet-4') ||
      lowerModelId.includes('claude-sonnet-4.5') ||
      lowerModelId.includes('claude-opus-4.1')
    ) {
      modelCapability = { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 };
    } else if (lowerModelId.includes('deepseek-r1') || lowerModelId.includes('deepseek/deepseek-r1')) {
      modelCapability = { supported: true, method: 'both', defaultEffort: 'medium', maxTokensLimit: 16000 };
    } else if (lowerModelId.includes('gemini') && lowerModelId.includes('thinking')) {
      modelCapability = { supported: true, method: 'max_tokens', maxTokensLimit: 20000, minTokens: 1000 };
    } else {
      modelCapability = REASONING_MODELS.default;
    }
  }

  if (!modelCapability.supported) {
    console.log(`API ROUTE: Model ${modelId} does not support reasoning`);
    return undefined;
  }

  // Prepare reasoning configuration - return DIRECT object for OpenRouter API
  const reasoningConfig: any = {};

  // CRITICAL: For models that support 'both', we must send ONLY ONE parameter (effort OR max_tokens)
  if (modelCapability.method === 'both') {
    // Models with 'both' support EITHER effort OR max_tokens, not simultaneously
    // CRITICAL: Only enable reasoning if user explicitly requested it
    if (!userReasoningConfig?.enabled && !userReasoningConfig?.effort && !userReasoningConfig?.maxOutputTokens && !userReasoningConfig?.max_tokens) {
      console.log(`API ROUTE: User didn't enable reasoning for ${modelId}, skipping`);
      return undefined;
    }

    // Prioritize user's explicit choice
    if (userReasoningConfig?.effort) {
      // User explicitly specified effort
      reasoningConfig.effort = userReasoningConfig.effort;
      console.log(`API ROUTE: Using effort for ${modelId} (user specified):`, userReasoningConfig.effort);
    } else if (userReasoningConfig?.maxOutputTokens || userReasoningConfig?.max_tokens) {
      // User explicitly specified max_tokens
      const maxTokens = userReasoningConfig.maxOutputTokens || userReasoningConfig.max_tokens;
      const modelLimit = modelCapability.maxTokensLimit || 32000;
      const minTokens = modelCapability.minTokens || 1000;

      reasoningConfig.max_tokens = Math.min(Math.max(maxTokens ?? 0, minTokens), modelLimit);
      console.log(`API ROUTE: Using max_tokens for ${modelId} (user specified):`, reasoningConfig.max_tokens);
    } else if (userReasoningConfig?.enabled) {
      // User enabled reasoning but didn't specify method, default to effort for DeepSeek models
      reasoningConfig.effort = modelCapability.defaultEffort ||
        env.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT ||
        'medium';
      console.log(`API ROUTE: Using default effort for ${modelId}:`, reasoningConfig.effort);
    }
  } else if (modelCapability.method === 'effort') {
    // Model only supports effort (OpenAI o-series)
    // CRITICAL: Only enable reasoning if user explicitly requested it
    if (!userReasoningConfig?.enabled && !userReasoningConfig?.effort) {
      console.log(`API ROUTE: User didn't enable reasoning for ${modelId}, skipping`);
      return undefined;
    }

    reasoningConfig.effort = userReasoningConfig?.effort ||
      modelCapability.defaultEffort ||
      env.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT ||
      'medium';
    console.log(`API ROUTE: Using effort for OpenAI model ${modelId}:`, reasoningConfig.effort);
  } else if (modelCapability.method === 'max_tokens') {
    // Model only supports max_tokens (Anthropic, Gemini)
    // CRITICAL: Only enable reasoning if user explicitly requested it
    if (!userReasoningConfig?.enabled && !userReasoningConfig?.maxOutputTokens && !userReasoningConfig?.max_tokens) {
      console.log(`API ROUTE: User didn't enable reasoning for ${modelId}, skipping`);
      return undefined;
    }

    const maxTokens = userReasoningConfig?.maxOutputTokens ||
      userReasoningConfig?.max_tokens ||
      parseInt(env.NEXT_PUBLIC_MAX_REASONING_TOKENS || '8000');

    const modelLimit = modelCapability.maxTokensLimit || 32000;
    const minTokens = modelCapability.minTokens || 1000;

    reasoningConfig.max_tokens = Math.min(Math.max(maxTokens, minTokens), modelLimit);
    console.log(`API ROUTE: Using max_tokens for Anthropic/Gemini model ${modelId}:`, reasoningConfig.max_tokens);
  }

  // Always enable reasoning (OpenRouter API expects this)
  reasoningConfig.enabled = true;

  // Add exclude flag if specified
  if (userReasoningConfig?.exclude) {
    reasoningConfig.exclude = true;
    console.log(`API ROUTE: Excluding reasoning tokens from response for ${modelId}`);
  }

  console.log(`API ROUTE: Final OpenRouter-compatible reasoning config for ${modelId}:`, reasoningConfig);
  return reasoningConfig;
}

// Test AI provider connection based on configuration
async function testOpenRouterConnection(): Promise<{ valid: boolean; reason: string; message: string }> {
  console.log(`API ROUTE: Testing ${AI_PROVIDER} connection...`);

  if (AI_PROVIDER === 'openai') {
    // Test OpenAI connection
    if (!env.OPENAI_API_KEY) {
      console.error('API ROUTE: Cannot test OpenAI connection: API key is missing');
      return {
        valid: false,
        reason: 'MISSING_KEY',
        message: 'OpenAI API key is missing'
      };
    }

    console.log(`API ROUTE: OpenAI API key found, length: ${env.OPENAI_API_KEY.length}`);
    return {
      valid: true,
      reason: 'VALID',
      message: 'OpenAI API key is valid'
    };
  } else if (AI_PROVIDER === 'groq') {
    // Test Groq connection
    if (!env.GROQ_API_KEY) {
      console.error('API ROUTE: Cannot test Groq connection: API key is missing');
      return {
        valid: false,
        reason: 'MISSING_KEY',
        message: 'Groq API key is missing'
      };
    }
    return {
      valid: true,
      reason: 'VALID',
      message: 'Groq API key is valid'
    };
  } else {
    // Test OpenRouter connection
    try {
      if (!env.OPENROUTER_API_KEY) {
        console.error('API ROUTE: Cannot test OpenRouter connection: API key is missing');
        return {
          valid: false,
          reason: 'MISSING_KEY',
          message: 'OpenRouter API key is missing'
        };
      }

      console.log(`API ROUTE: API key found, length: ${env.OPENROUTER_API_KEY.length}, starts with: ${env.OPENROUTER_API_KEY.substring(0, 7)}`);

      // First, check the API key format
      const apiKeyPattern = /^sk-or-[a-zA-Z0-9-]{24,}$/;
      const isValidFormat = apiKeyPattern.test(env.OPENROUTER_API_KEY);

      if (!isValidFormat) {
        console.error('API ROUTE: OpenRouter API key has invalid format:',
          env.OPENROUTER_API_KEY.substring(0, 7) + '...');
        return {
          valid: false,
          reason: 'INVALID_FORMAT',
          message: `OpenRouter API key has invalid format (should start with sk-or-). Key starts with: ${env.OPENROUTER_API_KEY.substring(0, 7)}`
        };
      }

      console.log('API ROUTE: OpenRouter API key format is valid');

      // We won't make an actual test request here to avoid extra costs
      // In a production environment, you might want to make a lightweight request
      // to verify the API key works properly
      return {
        valid: true,
        reason: 'VALID',
        message: 'OpenRouter API key format is valid'
      };

    } catch (error: any) {
      console.error('API ROUTE: Error processing request:', error);
      return {
        valid: false,
        reason: 'TEST_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Run the test on module load
testOpenRouterConnection().then(result => {
  console.log('OpenRouter connection test result:', result);
});

// Check if web search is enabled at the application level
const isWebSearchEnabled = env.NEXT_PUBLIC_WEB_SEARCH_ENABLED === 'true';

// Check if MCP endpoint is enabled - using env object
const mcpZapierEndpoint = env.MCP_ZAPIER_ENDPOINT;
// Allow selection based on request
let mcpEndpointToUse: string | null = null;
const isMcpEnabled = !!mcpZapierEndpoint;

// Log which MCP endpoints are available
console.log('API ROUTE: MCP Endpoints Available:', {
  zapier: !!mcpZapierEndpoint
});

// Define the chunk type
interface Chunk {
  content: string;
  document_id: string;
  similarity: number;
}

// Define message content types
interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface DocumentContent {
  type: 'document';
  document: {
    id: string;
    name: string;
    text: string;
    chunks?: Array<{ content: string }>;
  };
}

type MessageContent = TextContent | ImageContent | DocumentContent;

interface StreamChunk {
  choices: {
    delta: {
      content?: string;
    };
  }[];
}

// Add these interfaces at the top of the file
interface DocumentChunk {
  content: string;
  embedding: number[];
}

interface TemporaryDocument {
  id: string;
  name: string;
  text: string;
  type: 'pdf' | 'doc' | 'docx' | 'txt';
  chunks: DocumentChunk[];
}

interface ProcessedChunk {
  content: string;
  similarity: number;
  document_id: string;
}

// Add this interface to track used documents
interface UsedDocument {
  id: string;
  name: string;
  filename: string;
  created_at?: string;
  content_preview?: string;
  similarity?: number; // For semantic search results
  matched_chunk?: string; // The chunk that matched the query
  explicitly_referenced?: boolean; // Whether this document was explicitly referenced in the user query
  image_url?: string; // URL of the image if this is an image document
  external_url?: string; // External URL associated with the document
}

// Regex patterns to detect tool requests - removed conflicting stock and weather patterns



// Add safe normalization helper for query strings - handles various content types
const normalize = (input: unknown): string => {
  if (typeof input === 'string') {
    return input.toLowerCase();
  } else if (Array.isArray(input) && input.length > 0) {
    // For array messages, try to find text parts
    const textPart = input.find(part => part.type === 'text');
    return textPart && typeof textPart.text === 'string' ? textPart.text.toLowerCase() : '';
  }
  // Return empty string for null/undefined/objects we can't lowercase
  return '';
};

const getLastUserText = (messages: APIMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      const textPart = message.content.find(part => part.type === 'text');
      if (textPart && typeof textPart.text === 'string') return textPart.text;
    }
  }
  return '';
};

const isSpanishText = (text: string): boolean => {
  if (!text) return false;
  const normalized = text.toLowerCase();
  if (/[¿¡]/.test(text)) return true;
  return /\b(qué|como|cómo|cuándo|dónde|por qué|porque|quién|cuál|cuánto|para qué|el|la|los|las|un|una|es|son|está|están|puede|puedo|hacer|tiene|tengo|hay|sobre|con|sin|desde|hasta|después|antes|mientras|aunque|entonces|también|además|ahora|hoy|ayer|mañana|aquí|allí|muy|más|menos|todo|nada|algo|alguien|nadie)\b/.test(normalized);
};


// Helper function to create a proper AI message for errors
function createErrorResponse(message: string) {
  // Format the error as a proper token stream similar to what the client expects
  return new Response(
    `3:"${message}"
  
0:
  
`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/plain'
      }
    }
  );
}

function buildNoKnowledgeBaseResponse(language: Language): string {
  if (language === 'es') {
    return `# Información no disponible

## Estado de la base de conocimiento
- No encontré esta información en tu base de conocimiento.
- La búsqueda web está desactivada, así que no puedo consultarla en línea.

¿Quieres que active la búsqueda web para verificarlo? ¿Prefieres subir un documento con esa información? ¿Hay algún detalle específico que deba buscar?`;
  }

  return `# Information Not Available

## Knowledge Base Status
- I couldn’t find this information in your knowledge base.
- Web search is turned off, so I can’t look it up online.

Would you like me to turn on web search and check? Do you want to upload a document that contains this information? Is there a specific detail you want me to focus on?`;
}

// Add the missing extractSignificantPhrases function above the main route handler
function extractSignificantPhrases(text: string, minWords = 3, maxWords = 7): string[] {
  // Split text into words
  const words = text.split(/\s+/);
  const phrases: string[] = [];

  // Generate phrases of 3-7 consecutive words
  for (let i = 0; i <= words.length - minWords; i++) {
    for (let phraseLength = minWords; phraseLength <= Math.min(maxWords, words.length - i); phraseLength++) {
      const phrase = words.slice(i, i + phraseLength).join(' ');
      // Only include phrases with sufficient length (characters)
      if (phrase.length >= 12) {
        phrases.push(phrase);
      }
    }
  }

  // Limit to a reasonable number of phrases to avoid excessive matching
  return phrases.filter((p, i) => i % 3 === 0).slice(0, 150);
}

// --- Zod Schemas for known Zapier MCP Tools ---
const zapierGmailFindEmailSchema = {
  inputSchema: z.object({
    query: z.string().describe("Search query string for Gmail. Use standard Gmail search operators. Examples: 'from:elonmusk', 'subject:important meeting', 'is:unread label:work', 'after:2024/01/15 before:2024/01/20'. For 'last email', try 'in:inbox count:1' or specify sender/subject if known.")
  }),
  description: "Finds an email message in Gmail using a specific search query string. Allows using standard Gmail search operators.",
};

const zapierGmailCreateDraftSchema = {
  inputSchema: z.object({
    to: z.string().describe("Recipient email address(es), comma-separated if multiple."),
    subject: z.string().describe("The subject line of the email draft."),
    body: z.string().describe("The body content of the email draft. Use markdown for formatting if needed.")
  }),
  description: "Creates a draft email message in Gmail.",
};

const zapierGmailCreateDraftReplySchema = {
  inputSchema: z.object({
    thread_id: z.string().describe("The thread ID of the email to reply to. This should be extracted from a previously found email."),
    to: z.string().optional().describe("Recipient email address(es). Usually auto-populated from the original email."),
    subject: z.string().optional().describe("The subject line. Usually auto-generated as 'Re: [original subject]'."),
    body: z.string().describe("The body content of the reply email."),
    cc: z.string().optional().describe("CC recipients, comma-separated if multiple."),
    bcc: z.string().optional().describe("BCC recipients, comma-separated if multiple."),
    from: z.string().optional().describe("From email address. Usually uses your default Gmail address."),
    from_name: z.string().optional().describe("From name. Usually uses your default Gmail name."),
    signature: z.string().optional().describe("Whether to add your default signature (true/false).")
  }),
  description: "Creates a draft reply to an existing email thread. Requires thread_id from a previously found email.",
};
// --- End Zod Schemas ---

// Helper function to summarize Gmail find email results
const summarizeGmailFindEmail = (data: any): string => {
  try {
    const messages = Array.isArray(data) ? data : [data];
    const summaries: string[] = [];

    messages.forEach((msg: any, idx: number) => {
      let subject = '';
      let from = '';
      let date = '';
      let snippet = '';

      // Gmail messages may have payload.headers or top‑level headers
      const headers = msg?.payload?.headers || msg?.headers || [];
      if (Array.isArray(headers)) {
        headers.forEach((h: any) => {
          const name = (h?.name || '').toLowerCase();
          if (name === 'subject') subject = h?.value || subject;
          if (name === 'from') from = h?.value || from;
          if (name === 'date') date = h?.value || date;
        });
      }

      snippet = msg?.snippet || '';

      summaries.push(
        `• Email ${idx + 1}: "${subject || 'No Subject'}" from ${from || 'Unknown Sender'}${date ? ' on ' + date : ''}.${snippet ? ' Snippet: ' + snippet.slice(0, 120).replace(/\n/g, ' ') + '…' : ''
        }`
      );
    });

    return summaries.join('\n');
  } catch (err) {
    console.error('API ROUTE: Failed to summarize Gmail result:', err);
    return 'Email found, but could not extract a readable summary.';
  }
};

// Update the interface to include an optional result
interface ToolApprovalState {
  [toolCallId: string]: {
    approved: boolean;
    toolCall: any;
    result: any; // Add result field to store pre-fetched result
  };
}

// Initialize global state containers if not already present
if (typeof (globalThis as any).toolApprovalState === 'undefined') {
  console.log('API ROUTE: Initializing global toolApprovalState');
  (globalThis as any).toolApprovalState = {};
} else {
  console.log('API ROUTE: Global toolApprovalState already exists with keys:',
    Object.keys((globalThis as any).toolApprovalState).length);
}

if (typeof (globalThis as any).persistentMcpClient === 'undefined') {
  console.log('API ROUTE: Initializing global persistentMcpClient');
  (globalThis as any).persistentMcpClient = null;
} else {
  console.log('API ROUTE: Global persistentMcpClient already exists',
    (globalThis as any).persistentMcpClient ? '(initialized)' : '(null)');
}

// Use the global state containers when needed
const toolApprovalState: ToolApprovalState = (globalThis as any).toolApprovalState;
let persistentMcpClient: any = (globalThis as any).persistentMcpClient;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Note: Tool-specific query detection removed - now using universal MCP tool routing

/**
 * Transform Google Calendar tool parameters to fix Zapier's counterintuitive time logic
 * 
 * Zapier Google Calendar Find Event parameters work as follows:
 * - start_time: LATEST timestamp (upper boundary) - events must END BEFORE this time
 * - end_time: EARLIEST timestamp (lower boundary) - events must START AFTER this time
 * 
 * This is the opposite of what users expect, so we need to transform the parameters.
 */
// 🔧 FIX 2: Helper function to extract image prompt from user query
function extractImagePromptFromQuery(query: string): any {
  // Extract image description from user query
  const match = query.match(/(?:image|picture|photo).*?(?:of|with)\s+(.+?)(?:\.|$|,|\.)/i);
  if (match) {
    return { input: match[1].trim() };
  }

  // Fallback: use entire query minus command words
  const cleaned = query.replace(/(?:use|mcp|tool|create|image|generate)/gi, '').trim();
  return { input: cleaned || 'generate an image' };
}

function transformCalendarParameters(toolName: string, params: any, userQuery: string): any {
  if (!toolName.includes('calendar') || !toolName.includes('find_event')) {
    return params; // Only transform calendar find event tools
  }

  console.log('API ROUTE: Transforming calendar parameters for:', toolName);
  console.log('API ROUTE: Original parameters:', params);
  console.log('API ROUTE: User query:', userQuery);

  const transformedParams = { ...params };
  const now = new Date();

  // Analyze the user query to determine the intended time range
  const queryLower = userQuery.toLowerCase();

  // Determine the time range based on user intent
  let timeRange = 'upcoming'; // default

  if (queryLower.includes('today') || queryLower.includes('this day')) {
    timeRange = 'today';
  } else if (queryLower.includes('tomorrow')) {
    timeRange = 'tomorrow';
  } else if (queryLower.includes('this week') || queryLower.includes('week')) {
    timeRange = 'this_week';
  } else if (queryLower.includes('next week')) {
    timeRange = 'next_week';
  } else if (queryLower.includes('this month') || queryLower.includes('month')) {
    timeRange = 'this_month';
  } else if (queryLower.includes('next') || queryLower.includes('upcoming') || queryLower.includes('future')) {
    timeRange = 'upcoming';
  } else if (queryLower.includes('past') || queryLower.includes('previous') || queryLower.includes('last')) {
    timeRange = 'past';
  }

  // Calculate the correct time boundaries based on Zapier's logic
  let startTimeBoundary: string; // This is the LATEST time (upper boundary)
  let endTimeBoundary: string;   // This is the EARLIEST time (lower boundary)

  switch (timeRange) {
    case 'today':
      // For today's events: start after beginning of today, end before end of today
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      endTimeBoundary = todayStart.toISOString();
      startTimeBoundary = todayEnd.toISOString();
      break;

    case 'tomorrow':
      // For tomorrow's events
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
      endTimeBoundary = tomorrowStart.toISOString();
      startTimeBoundary = tomorrowEnd.toISOString();
      break;

    case 'this_week':
      // For this week's events
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // End of week (Saturday)
      weekEnd.setHours(23, 59, 59, 999);
      endTimeBoundary = weekStart.toISOString();
      startTimeBoundary = weekEnd.toISOString();
      break;

    case 'next_week':
      // For next week's events
      const nextWeekStart = new Date(now);
      nextWeekStart.setDate(now.getDate() - now.getDay() + 7); // Start of next week
      nextWeekStart.setHours(0, 0, 0, 0);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
      nextWeekEnd.setHours(23, 59, 59, 999);
      endTimeBoundary = nextWeekStart.toISOString();
      startTimeBoundary = nextWeekEnd.toISOString();
      break;

    case 'this_month':
      // For this month's events
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      endTimeBoundary = monthStart.toISOString();
      startTimeBoundary = monthEnd.toISOString();
      break;

    case 'past':
      // For past events: events that ended before now
      const pastStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); // 1 year ago
      endTimeBoundary = pastStart.toISOString();
      startTimeBoundary = now.toISOString();
      break;

    case 'upcoming':
    default:
      // For upcoming events: start after now, end before 1 month from now
      const futureEnd = new Date(now);
      futureEnd.setMonth(now.getMonth() + 1); // 1 month from now
      endTimeBoundary = now.toISOString();
      startTimeBoundary = futureEnd.toISOString();
      break;
  }

  // Apply the transformed parameters
  transformedParams.end_time = endTimeBoundary;   // EARLIEST time (lower boundary)
  transformedParams.start_time = startTimeBoundary; // LATEST time (upper boundary)

  // Remove any conflicting parameters that might have been set incorrectly
  delete transformedParams.timeMin;
  delete transformedParams.timeMax;

  // Add instructions to help Zapier understand what we're looking for
  const timeRangeDescriptions = {
    'today': "today's events",
    'tomorrow': "tomorrow's events",
    'this_week': "this week's events",
    'next_week': "next week's events",
    'this_month': "this month's events",
    'past': "past events",
    'upcoming': "upcoming events"
  };

  // Define a type for the keys of timeRangeDescriptions
  type TimeRangeKey = keyof typeof timeRangeDescriptions;

  // Ensure timeRange is a valid key before accessing, or default
  const description = timeRangeDescriptions[timeRange as TimeRangeKey] || 'upcoming events';
  transformedParams.instructions = `Find ${description} in my Google Calendar`;

  console.log('API ROUTE: Transformed calendar parameters:', transformedParams);
  console.log('API ROUTE: Time range detected:', timeRange);
  console.log('API ROUTE: Boundary explanation: Events must START after', endTimeBoundary, 'and END before', startTimeBoundary);

  return transformedParams;
}

/**
 * Extract media URLs from conversation history for Google Drive uploads
 * Searches through recent messages to find generated media content parts
 * and extracts the actual URLs for upload
 */
function extractMediaFromConversation(toolName: string, params: any, messages: any[]): any {
  console.log('🎯 [MEDIA EXTRACTION] Starting extraction for tool:', toolName);
  console.log('🎯 [MEDIA EXTRACTION] Original params:', params);
  console.log('🎯 [MEDIA EXTRACTION] Messages count:', messages.length);

  // Only process Google Drive upload tools
  if (!toolName.includes('google_drive') && !toolName.includes('upload')) {
    return params;
  }

  // Create enhanced parameters
  const enhancedParams = { ...params };

  // Search through recent messages (last 10) to find both generated and attached media
  const recentMessages = messages.slice(-10).reverse(); // Most recent first

  for (const message of recentMessages) {
    // Check both assistant messages (for generated media) and user messages (for attached media)
    if (message.role !== 'assistant' && message.role !== 'user') continue;

    // Check if message has original content parts (preserved from custom types)
    const contentToCheck = (message as any)._originalContentParts || (message as any).content;

    console.log('🎯 [MEDIA EXTRACTION] Checking message:', {
      role: message.role,
      contentType: typeof contentToCheck,
      isArray: Array.isArray(contentToCheck),
      hasOriginalParts: !!(message as any)._originalContentParts,
      contentSample: typeof contentToCheck === 'string'
        ? contentToCheck.substring(0, 100)
        : Array.isArray(contentToCheck)
          ? `Array with ${contentToCheck.length} parts`
          : 'Other type',
      originalContent: (message as any)._originalContentParts ? JSON.stringify((message as any)._originalContentParts, null, 2) : 'none'
    });

    // Handle both string content and ContentPart arrays
    if (Array.isArray(contentToCheck)) {
      for (const part of contentToCheck as ContentPart[]) {
        console.log('🎯 [MEDIA EXTRACTION] Checking content part:', {
          type: part.type,
          hasGeneratedImages: !!part.generated_images,
          hasVideoUrl: !!part.video_url,
          hasModelUrl: !!part.model_url,
          fullPart: JSON.stringify(part, null, 2)
        });

        // Extract generated image URLs
        if (part.type === 'generated_image' && part.generated_images && part.generated_images.length > 0) {
          const imageUrl = part.generated_images[0]; // Use first image
          console.log('🎯 [MEDIA EXTRACTION] Found generated image URL:', imageUrl);

          enhancedParams.file_url = imageUrl;
          enhancedParams.filename = enhancedParams.filename || 'generated-image.png';

          // Extract prompt if available for better filename
          if (part.prompt) {
            const cleanPrompt = part.prompt.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const shortPrompt = cleanPrompt.substring(0, 30);
            enhancedParams.filename = `${shortPrompt}.png`;
          }

          console.log('🎯 [MEDIA EXTRACTION] Enhanced params with image:', enhancedParams);
          return enhancedParams; // Return immediately on first found media
        }

        // Extract attached image URLs from user messages
        if (part.type === 'image_url' && part.image_url && part.image_url.url) {
          const imageUrl = part.image_url.url;
          console.log('🎯 [MEDIA EXTRACTION] Found attached image URL (image_url type):', imageUrl);

          // For attached images, let the injection system handle the URL
          // Don't set file_url here, let the approval route inject it
          enhancedParams.filename = 'attached-image.png';

          console.log('🎯 [MEDIA EXTRACTION] Enhanced params for attached image:', enhancedParams);
          return enhancedParams;
        }

        // 🔧 FIX: Also check for attached images stored as generated_image type with isAttachedImage flag
        if (part.type === 'generated_image' && part.isAttachedImage && part.generated_images && part.generated_images.length > 0) {
          const imageUrl = part.generated_images[0];
          console.log('🎯 [MEDIA EXTRACTION] Found attached image URL (generated_image type with isAttachedImage flag):', imageUrl);

          // Set the file_url for attached images since they're already downloadable URLs
          enhancedParams.file_url = imageUrl;
          enhancedParams.filename = enhancedParams.filename || 'attached-image.png';

          console.log('🎯 [MEDIA EXTRACTION] Enhanced params for attached image (generated_image type):', enhancedParams);
          return enhancedParams;
        }

        // Extract video URLs
        if (part.type === 'generated_video') {
          let videoUrl = null;

          // Check both video_url and generated_videos array
          if (part.video_url) {
            videoUrl = part.video_url;
          } else if (part.generated_videos && part.generated_videos.length > 0) {
            videoUrl = part.generated_videos[0]; // Use first video
          }

          if (videoUrl) {
            console.log('🎯 [MEDIA EXTRACTION] Found generated video URL:', videoUrl);

            enhancedParams.file_url = videoUrl;
            enhancedParams.filename = enhancedParams.filename || 'generated-video.mp4';

            if (part.prompt) {
              const cleanPrompt = part.prompt.replace(/[^a-z0-9]/gi, '-').toLowerCase();
              const shortPrompt = cleanPrompt.substring(0, 30);
              enhancedParams.filename = `${shortPrompt}.mp4`;
            }

            console.log('🎯 [MEDIA EXTRACTION] Enhanced params with video:', enhancedParams);
            return enhancedParams;
          }
        }

        // Extract 3D model URLs
        if (part.type === 'generated_3d_model' && part.model_url) {
          const modelUrl = part.model_url;
          console.log('🎯 [MEDIA EXTRACTION] Found generated 3D model URL:', modelUrl);

          enhancedParams.file_url = modelUrl;
          enhancedParams.filename = enhancedParams.filename || 'generated-model.glb';

          if (part.prompt) {
            const cleanPrompt = part.prompt.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const shortPrompt = cleanPrompt.substring(0, 30);
            enhancedParams.filename = `${shortPrompt}.glb`;
          }

          console.log('🎯 [MEDIA EXTRACTION] Enhanced params with 3D model:', enhancedParams);
          return enhancedParams;
        }
      }
    }
  }

  console.log('🎯 [MEDIA EXTRACTION] No media found in recent messages');
  return params;
}

// Helper function to extract media URLs for Gmail attachments
function extractMediaForGmailAttachment(toolName: string, params: any, messages: any[]): any {
  console.log('📎 [GMAIL ATTACHMENT] Starting extraction for tool:', toolName);
  console.log('📎 [GMAIL ATTACHMENT] Original params:', params);

  // Only process Gmail tools
  if (!toolName.includes('gmail_')) {
    return params;
  }

  // Create enhanced parameters
  const enhancedParams = { ...params };

  // Check if user already provided an attachment URL
  const existingAttachment = params.attachments || params.attachment_url || params.file_url ||
    params.media_url || params.image_url ||
    params.video_url || params.attachment;

  if (existingAttachment) {
    console.log('📎 [GMAIL ATTACHMENT] Using provided attachment URL:', existingAttachment);
    enhancedParams.attachment_url = existingAttachment;
    return enhancedParams;
  }

  // Search through recent messages to find generated media
  const recentMessages = messages.slice(-10).reverse(); // Most recent first
  console.log('📎 [GMAIL ATTACHMENT] Searching through', recentMessages.length, 'recent messages');

  for (const message of recentMessages) {
    // Check both user and assistant messages for media content
    if (message.role !== 'assistant' && message.role !== 'user') continue;

    console.log('📎 [GMAIL ATTACHMENT] Checking message from', message.role);

    // Check if message has original content parts
    const contentToCheck = (message as any)._originalContentParts || (message as any).content;
    console.log('📎 [GMAIL ATTACHMENT] Content to check:', Array.isArray(contentToCheck) ? `Array with ${contentToCheck.length} items` : typeof contentToCheck);

    if (Array.isArray(contentToCheck)) {
      for (const part of contentToCheck as ContentPart[]) {
        console.log('📎 [GMAIL ATTACHMENT] Processing content part:', part.type);

        // Extract uploaded image URLs (image_url type)
        if (part.type === 'image_url' && part.image_url?.url) {
          const imageUrl = part.image_url.url;
          console.log('📎 [GMAIL ATTACHMENT] Found uploaded image for attachment:', imageUrl);

          // Store URL in internal parameter for transformation
          enhancedParams.attachment_url = imageUrl;

          console.log('📎 [GMAIL ATTACHMENT] Enhanced params with uploaded image attachment URL');
          return enhancedParams;
        }

        // Extract generated image URLs
        if (part.type === 'generated_image' && part.generated_images && part.generated_images.length > 0) {
          const imageUrl = part.generated_images[0];
          console.log('📎 [GMAIL ATTACHMENT] Found generated image for attachment:', imageUrl);

          // Store URL in internal parameter for transformation
          enhancedParams.attachment_url = imageUrl;

          console.log('📎 [GMAIL ATTACHMENT] Enhanced params with generated image attachment URL');
          return enhancedParams;
        }

        // Extract video URLs
        if (part.type === 'generated_video') {
          const videoUrl = part.video_url || (part.generated_videos && part.generated_videos[0]);

          if (videoUrl) {
            console.log('📎 [GMAIL ATTACHMENT] Found generated video for attachment:', videoUrl);

            // Store URL in internal parameter for transformation
            enhancedParams.attachment_url = videoUrl;

            console.log('📎 [GMAIL ATTACHMENT] Enhanced params with video attachment URL');
            return enhancedParams;
          }
        }

        // Extract 3D model URLs
        if (part.type === 'generated_3d_model' && part.model_url) {
          const modelUrl = part.model_url;
          console.log('📎 [GMAIL ATTACHMENT] Found generated 3D model for attachment:', modelUrl);

          // Store URL in internal parameter for transformation
          enhancedParams.attachment_url = modelUrl;

          console.log('📎 [GMAIL ATTACHMENT] Enhanced params with 3D model attachment URL');
          return enhancedParams;
        }
      }
    }
  }

  console.log('📎 [GMAIL ATTACHMENT] No media found for attachment');
  return params;
}

/**
 * Clean malformed useDocument calls from AI responses
 * These should be processed internally, not shown to users
 */
function cleanMalformedDocumentCalls(text: string): string {
  // Pattern to match malformed useDocument calls with various formatting issues
  const patterns = [
    // Basic pattern: useDocument({...})
    /useDocument\s*\([^)]*\)/gi,
    // Pattern with missing quotes/colons
    /useDocument\s*\{[^}]*\}/gi,
    // Pattern with line breaks
    /useDocument\s*[\(\{][\s\S]*?[\)\}]/gi,
    // Common typos
    /use[Dd]ocument.*?(?:elevance|relevence|relavance).*?[\)\}]/gi,
  ];

  let cleaned = text;
  patterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, (match) => {
      console.warn('[Response Cleaning] Removed malformed useDocument call:', match.substring(0, 100));
      return '';
    });
  });

  // Clean up any resulting double spaces or empty lines
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  return cleaned;
}

export async function POST(req: Request) {
  console.log('API ROUTE: Starting POST request handler');

  try {
    const { messages: rawMessages, data, imageStorage }: {
      messages: APIMessage[],
      data?: {
        chatId?: string, // Add chatId field
        organizationId?: string | null, // Add organization context for multi-tenant RAG
        settings?: {
          model?: string,
          webSearch?: boolean,
          mcpEnabled?: boolean, // Allow overriding MCP setting per request
          mcpProvider?: 'zapier', // Allow selecting which MCP provider to use
          reasoning?: { // Add reasoning configuration
            enabled?: boolean,
            effort?: 'high' | 'medium' | 'low',
            maxOutputTokens?: number,
            exclude?: boolean
          },
          language?: Language, // Add language selection for system prompts
          systemPromptTemplate?: SystemPromptTemplate // Add system prompt template selection
        },
        sessionId?: string, // Add optional sessionId for MCP tool persistence
        metadata?: any, // Add metadata field for debugging
        systemPromptOverride?: string, // WhatsApp and other overrides
        disableRAG?: boolean, // WhatsApp and other overrides
        ragMode?: 'strict' | 'balanced' | 'flexible' | 'bypass' // RAG behavior mode
      },
      imageStorage?: Record<string, string> // Add imageStorage for attached images
    } = await req.json();

    // Initialize Supabase client
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      console.error('API ROUTE: Supabase client not initialized');
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    // Extract WhatsApp-specific overrides
    const systemPromptOverride = data?.systemPromptOverride;
    const disableRAG = data?.disableRAG || false;

    // Extract RAG behavior mode (default: strict)
    const ragMode = data?.ragMode || (env.RAG_BEHAVIOR_MODE as 'strict' | 'balanced' | 'flexible' | 'bypass') || 'strict';
    const effectiveDisableRAG = disableRAG || ragMode === 'bypass';
    const userLanguage = data?.settings?.language || 'en';
    const fallbackLanguage =
      userLanguage === 'en' && isSpanishText(getLastUserText(rawMessages))
        ? 'es'
        : userLanguage;
    console.log('[RAG MODE] Using mode:', ragMode, '| Effective disable RAG:', effectiveDisableRAG);

    // Extract reasoning settings early for enhanced RAG detection
    const reasoningSettings = data?.settings?.reasoning;
    console.log('API ROUTE: [REASONING DEBUG] Received reasoning settings:', reasoningSettings);

    // console.log('[WHATSAPP DEBUG] System prompt override:', systemPromptOverride ? 'PROVIDED' : 'NOT PROVIDED');
    // console.log('[WHATSAPP DEBUG] Disable RAG:', disableRAG);

    // 🔍 DEBUG: Using immediate upload approach (imageStorage no longer needed)
    console.log('API ROUTE: [DEBUG] Using immediate upload approach - images already have permanent URLs');

    // Process messages to handle custom content types
    const originalMessages: ExtendedMessage[] = fromAPIMessages(rawMessages).map(msg => {
      if (typeof msg.content === 'string' && msg.content.includes('__content_parts__')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.__content_parts__ && Array.isArray(parsed.parts)) {
            return {
              ...msg,
              content: parsed.parts,
              metadata: {
                ...(msg.metadata || {}),
                originalContentParts: parsed.parts,
              },
              _originalContentParts: parsed.parts,
            } as ExtendedMessage & { _originalContentParts: ContentPart[] };
          }
        } catch (e) {
          console.log('Failed to parse serialized content parts:', e);
        }
      }

      if (Array.isArray(msg.content)) {
        const hasGeneratedMedia = msg.content.some(
          part =>
            part.type === 'generated_image' ||
            part.type === 'generated_video' ||
            part.type === 'generated_3d_model',
        );

        if (hasGeneratedMedia) {
          return {
            ...msg,
            metadata: {
              ...(msg.metadata || {}),
              originalContentParts: msg.content,
            },
            _originalContentParts: msg.content,
          } as ExtendedMessage & { _originalContentParts: ContentPart[] };
        }
      }

      return msg;
    });

    // Extract chatId and sessionId from data
    const chatId = data?.chatId;
    const sessionId = (data as any)?.data?.sessionId || data?.sessionId || crypto.randomUUID();

    console.log('API ROUTE: Using chatId:', chatId);
    console.log('API ROUTE: Using sessionId:', sessionId);
    console.log('API ROUTE: [DEBUG] Image processing simplified - using permanent URLs from message content');

    // 🔧 FIX: Declare downloadableUrls at higher scope for both image processing paths
    let downloadableUrls: string[] = [];

    // 🔍 DEBUG: Check message content (images now have permanent URLs)
    console.log('API ROUTE: [DEBUG] === MESSAGE CONTENT ANALYSIS ===');
    for (let i = 0; i < originalMessages.length; i++) {
      const msg = originalMessages[i];
      console.log(`API ROUTE: [DEBUG] Message ${i} (${msg.role}) content type:`, typeof msg.content);
      console.log(`API ROUTE: [DEBUG] Message ${i} content is array:`, Array.isArray(msg.content));
      if (Array.isArray(msg.content)) {
        const contentParts = msg.content.map(p => ({ type: p.type, hasImageUrl: !!p.image_url?.url }));
        console.log(`API ROUTE: [DEBUG] Message ${i} content parts:`, contentParts);
      }
    }

    // ⚡ PERFORMANCE OPTIMIZATION: Quick query classification
    const userMessages = originalMessages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];

    // Extract text from user message, handling both string and array content
    let userQuery = '';
    console.log('🔍 [API ROUTE] Last user message content type:', typeof lastUserMessage?.content);
    console.log('🔍 [API ROUTE] Last user message content:', lastUserMessage?.content);

    if (typeof lastUserMessage?.content === 'string') {
      userQuery = lastUserMessage.content;
      console.log('🔍 [API ROUTE] Extracted userQuery from string:', `"${userQuery}"`);
    } else if (Array.isArray(lastUserMessage?.content)) {
      // Extract text from array content (when images are present)
      const textPart = lastUserMessage.content.find(part => part.type === 'text');
      userQuery = textPart?.text || '';
      console.log('🔍 [API ROUTE] Found text part:', textPart);
      console.log('🔍 [API ROUTE] Extracted userQuery from array:', `"${userQuery}"`);
    }

    // Check if user message has images before classification
    const hasAttachedImage = Array.isArray(lastUserMessage?.content) &&
      lastUserMessage.content.some(part => part.type === 'image_url');

    console.log('🔍 [API ROUTE] About to classify query:', `"${userQuery}"`);
    console.log('🔍 [API ROUTE] Has attached image:', hasAttachedImage);
    const queryClassification = classifyQuery(userQuery, hasAttachedImage);
    console.log('🔍 [API ROUTE] Query classification result:', queryClassification);

    // Check for multi-step query
    let isHandlingMultiStep = false;
    let currentStepIndex = 0;
    let multiStepMetadata = null;

    if (queryClassification.isMultiStep && queryClassification.steps) {
      console.log('📝 [MULTI-STEP] Detected multi-step query with', queryClassification.steps.length, 'steps');
      console.log('📝 [MULTI-STEP] Steps:', queryClassification.steps.map(s => ({
        id: s.id,
        type: s.type,
        text: s.text.substring(0, 50) + '...'
      })));

      isHandlingMultiStep = true;

      // Check if we're continuing from a previous step
      const lastMessage = originalMessages[originalMessages.length - 2]; // -2 because last is current user message
      if (lastMessage?.multiStepMetadata) {
        currentStepIndex = (lastMessage.multiStepMetadata.currentStepIndex || 0) + 1;
        console.log('📝 [MULTI-STEP] Continuing from step', currentStepIndex);
      }

      multiStepMetadata = {
        isMultiStep: true,
        totalSteps: queryClassification.steps.length,
        currentStepIndex,
        currentStep: queryClassification.steps[currentStepIndex],
        remainingSteps: queryClassification.steps.slice(currentStepIndex + 1),
        originalQuery: userQuery
      };
    }

    // Check if MCP system is enabled globally
    const mcpSystemEnabled = process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED === 'true';
    if (!mcpSystemEnabled) {
      console.log('API ROUTE: MCP System is DISABLED globally - skipping all MCP functionality');
    }

    // Skip MCP for simple conversational queries to improve performance
    // For multi-step queries, check if ANY step needs MCP (not just current step)
    let shouldSkipMcpForPerformance = !mcpSystemEnabled || shouldSkipMcp(userQuery, hasAttachedImage);

    if (isHandlingMultiStep && multiStepMetadata && queryClassification.steps) {
      // For multi-step, check if ANY step needs MCP tools
      // This ensures the AI has access to all required tools for the entire multi-step process
      const anyStepNeedsMcp = queryClassification.steps.some(step =>
        step.type === 'mcp' || step.classification?.category === 'tool_required'
      );

      shouldSkipMcpForPerformance = !mcpSystemEnabled || !anyStepNeedsMcp;

      console.log('📝 [MULTI-STEP] Current step type:', multiStepMetadata.currentStep.type);
      console.log('📝 [MULTI-STEP] Any step needs MCP:', anyStepNeedsMcp);
      console.log('📝 [MULTI-STEP] Skip MCP for entire query:', shouldSkipMcpForPerformance);
      console.log('📝 [MULTI-STEP] Steps requiring MCP:',
        queryClassification.steps
          .filter(s => s.type === 'mcp' || s.classification?.category === 'tool_required')
          .map(s => ({ id: s.id, type: s.type, text: s.text.substring(0, 50) + '...' }))
      );
    }

    console.log('API ROUTE: Should skip MCP for performance:', shouldSkipMcpForPerformance);

    let usedDocuments: UsedDocument[] = [];
    let precomputedSourceImages: { name: string; size: number; type: string; url: string | undefined }[] = [];
    let webSearchResults: any[] = [];
    let webSearchToolCallId: string | undefined;

    // Check for image content in user messages and handle appropriately
    // Note: lastUserMessage already defined above for query classification
    let containsImage = false;
    let imageUrl = null;
    let textPrompt = '';

    // Process image content if present
    if (lastUserMessage && lastUserMessage.role === 'user' && Array.isArray(lastUserMessage.content)) {
      console.log('API ROUTE: User message contains array content, checking for images');

      // Extract text and image parts
      for (const part of lastUserMessage.content) {
        if (part.type === 'text') {
          textPrompt = part.text || '';
        } else if (part.type === 'image_url') {
          containsImage = true;
          imageUrl = part.image_url?.url;
          console.log('API ROUTE: Found image in user message');
        }
      }

      // Determine routing based on query classification
      if (containsImage && imageUrl) {
        // If query is classified as tool_required, continue with MCP processing
        // If query is NOT tool_required, route to image generation
        const shouldRouteToImageGeneration = !queryClassification.needsMcp;

        console.log('API ROUTE: Image found. Query needs MCP:', queryClassification.needsMcp);
        console.log('API ROUTE: Routing to image generation:', shouldRouteToImageGeneration);

        if (shouldRouteToImageGeneration) {
          console.log('API ROUTE: Handling image-to-image generation with prompt:', textPrompt);

          try {
            // Forward any authorization headers from the original request
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };

            // Copy auth headers from original request if present
            const authHeader = req.headers.get('authorization');
            if (authHeader) {
              headers['Authorization'] = authHeader;
            }

            // Copy cookie header for authentication
            const cookieHeader = req.headers.get('cookie');
            if (cookieHeader) {
              headers['Cookie'] = cookieHeader;
            }

            console.log('API ROUTE: Forwarding request to image generation API');

            // Send to image generation endpoint
            const origin = req.headers.get('origin') || 'http://localhost:3000';
            const apiUrl = new URL('/api/generate-image', origin).toString();
            console.log('API ROUTE: Sending request to image generation API:', apiUrl);

            const response = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                prompt: textPrompt || 'Generate a variation of this image',
                size: 'auto',
                numOutputs: 1,
                sourceImageUrl: imageUrl
              }),
            });

            if (!response.ok) {
              console.error('API ROUTE: Image generation failed:', response.statusText);
              return new Response(
                "There was an error processing your image. The image generation service returned an error.",
                { status: 500 }
              );
            }

            // Response should contain image URLs
            const imageData = await response.json();
            const generatedImages = imageData.images || [];

            console.log('API ROUTE: Image generation successful, got results:', generatedImages.length);

            if (generatedImages.length === 0) {
              return new Response(
                "The image generation service didn't return any images.",
                { status: 500 }
              );
            }

            // Helper function to format response with generated_image type for proper rendering
            const formatImageResponse = (text: string, imageUrl: string, sourceImageUrl?: string) => {
              // Format as array of content parts with text and generated_image
              const parts = [
                {
                  type: 'text',
                  text
                },
                {
                  type: 'generated_image',
                  generated_images: [imageUrl],
                  aspectRatio: 'auto',
                  sourceImageUrl: sourceImageUrl || imageData.sourceImageUrl || undefined
                }
              ];

              return {
                role: 'assistant',
                content: parts
              };
            };

            // Return a JSON response that signals to the client this is an image generation result
            // The client will use this to dispatch the same events as text-to-image generation
            console.log('API ROUTE: Returning image generation result as JSON');

            return new Response(JSON.stringify({
              isImageGeneration: true,
              images: generatedImages,
              prompt: textPrompt || 'Image edit',
              aspectRatio: 'auto',
              sourceImageUrl: imageUrl
            }), {
              headers: {
                'Content-Type': 'application/json',
              },
            });
          } catch (error) {
            console.error('API ROUTE: Error during image generation:', error);
            return new Response(
              "An error occurred during image generation.",
              { status: 500 }
            );
          }
        } else {
          // Query needs MCP tools and has images - extract image for MCP processing
          console.log('API ROUTE: Query needs MCP tools with image. Extracting image URL for MCP processing');

          // 🔧 FIX: Use downloadable URLs from image context manager instead of Base64 data
          let finalImageUrl = imageUrl;

          // Check if we have processed downloadable URLs from attached images
          if (downloadableUrls && downloadableUrls.length > 0) {
            finalImageUrl = downloadableUrls[0]; // Use the first downloadable URL
            console.log('API ROUTE: Using downloadable URL from image context manager:', finalImageUrl);
          } else if (imageUrl && imageUrl.startsWith('data:')) {
            // If we have Base64 data but no downloadable URLs, try to process it
            console.log('API ROUTE: Converting Base64 image to downloadable URL');

            try {
              const { processAttachedImages } = await import('@/lib/mcp/image-context-manager');
              const attachedImages = [{
                name: `attached-image-${Date.now()}.png`,
                dataUrl: imageUrl
              }];

              downloadableUrls = await processAttachedImages(sessionId, attachedImages);

              if (downloadableUrls.length > 0) {
                finalImageUrl = downloadableUrls[0];
                console.log('API ROUTE: Successfully converted Base64 to downloadable URL:', finalImageUrl);

                // 🔧 FIX: Add the processed image to message content (same as imageStorage path)
                const lastUserMessage = originalMessages[originalMessages.length - 1];
                if (lastUserMessage && lastUserMessage.role === 'user') {
                  let messageContent: any[] = [];
                  if (typeof lastUserMessage.content === 'string') {
                    messageContent.push({
                      type: 'text',
                      text: lastUserMessage.content
                    });
                  } else if (Array.isArray(lastUserMessage.content)) {
                    messageContent = [...lastUserMessage.content];
                  }

                  // Add the processed image as a content part (same format as generated images)
                  downloadableUrls.forEach((url, index) => {
                    messageContent.push({
                      type: 'generated_image',  // Use same type as generated images
                      generated_images: [url],  // Same structure as generated images
                      aspectRatio: 'auto',
                      isAttachedImage: true    // Flag to distinguish from actual generated images
                    });
                    console.log('API ROUTE: Added processed attached image content part:', url);
                  });

                  // Update the message content
                  lastUserMessage.content = messageContent;
                  console.log('API ROUTE: Updated user message with', downloadableUrls.length, 'processed attached image content parts');
                }
              } else {
                console.log('API ROUTE: Failed to convert Base64 to downloadable URL, keeping original');
              }
            } catch (error) {
              console.error('API ROUTE: Error converting Base64 to downloadable URL:', error);
              console.log('API ROUTE: Base64 conversion error details:', {
                errorMessage: error.message,
                errorStack: error.stack,
                imageUrlLength: imageUrl ? imageUrl.length : 0,
                sessionId: sessionId,
                hasImageUrl: !!imageUrl,
                imageUrlType: typeof imageUrl
              });
              // Keep original imageUrl as fallback
              finalImageUrl = imageUrl;
              downloadableUrls = []; // Ensure it's an empty array on error
            }
          }

          // Store image URL globally for MCP tool use
          if (!globalThis.mcpImageContext) {
            globalThis.mcpImageContext = {};
          }

          // Store the final image URL (preferably downloadable URL, not Base64)
          globalThis.mcpImageContext[sessionId] = {
            imageUrl: finalImageUrl,
            downloadableUrls: downloadableUrls || [finalImageUrl],
            extractedAt: Date.now()
          };

          // Also store with the image URL as backup for cross-session retrieval
          globalThis.mcpImageContext[finalImageUrl] = {
            imageUrl: finalImageUrl,
            downloadableUrls: downloadableUrls || [finalImageUrl],
            extractedAt: Date.now()
          };

          console.log('API ROUTE: Stored image URL for MCP tools:', finalImageUrl);
          console.log('API ROUTE: Stored downloadable URLs:', downloadableUrls || [finalImageUrl]);
          console.log('API ROUTE: Image storage keys:', Object.keys(globalThis.mcpImageContext));
        }
      }

      // 🔧 FIX: Only convert array content to string if NO images are present
      // If images ARE present, we need to keep the array format so the AI can actually see the images!
      if (!containsImage) {
        console.log('API ROUTE: Converting array content to string for AI compatibility (no images)');
        lastUserMessage.content = textPrompt;
      } else {
        console.log('API ROUTE: Keeping array content with images for AI vision capability');
        // Keep the original array content so the AI model can actually see the image
      }
    }

    // Determine if MCP should be used for this specific request
    // ⚡ PERFORMANCE OPTIMIZATION: Override MCP setting for simple queries
    const baseMcpSetting = data?.settings?.mcpEnabled !== undefined
      ? data.settings.mcpEnabled
      : isMcpEnabled;

    const useMcpForRequest = baseMcpSetting && !shouldSkipMcpForPerformance;
    console.log('API ROUTE: Base MCP setting:', baseMcpSetting);
    console.log('API ROUTE: Use MCP for this request:', useMcpForRequest);

    if (shouldSkipMcpForPerformance) {
      console.log('API ROUTE: ⚡ SKIPPING MCP for performance - classified as:', queryClassification.category);
    }

    // Universal MCP endpoint selection - use any available endpoint
    if (useMcpForRequest && mcpSystemEnabled) {
      const requestedProvider = data?.settings?.mcpProvider;

      console.log('API ROUTE: Using universal MCP endpoint selection');

      // Use the explicitly requested provider if available
      if (requestedProvider === 'zapier' && mcpZapierEndpoint) {
        mcpEndpointToUse = mcpZapierEndpoint;
        console.log('API ROUTE: Using explicitly requested Zapier MCP endpoint');
      } else {
        // Default selection logic - use any available endpoint
        if (mcpZapierEndpoint) {
          mcpEndpointToUse = mcpZapierEndpoint;
          console.log('API ROUTE: Using available Zapier MCP endpoint');
        } else {
          console.log('API ROUTE: No MCP endpoints available');
        }
      }
    }

    // Add system messages with unique IDs
    const formattingSystemMessage: ExtendedMessage = {
      id: 'system-format-instruction',
      role: 'system',
      content: `Always format your responses using this exact markdown structure:

1. Start with a single clear H1 heading using # (not ##)
2. Use ## for section headings (H2)
3. Use hyphen (-) not bullet character (•) for all bullet points
4. Never use asterisks (**) in headings or section titles
5. Keep whitespace between sections for readability
6. Always end your response with a short paragraph (2-3 sentences) that encourages the user to continue the conversation with you. This should include 2-3 specific follow-up questions the user might want to ask related to the topic.

Example format:
# Main Title

## First Section
- First bullet point
- Second bullet point
- Third bullet point

## Second Section
- First bullet point
- Second bullet point

Would you like to know more about specific aspects of this topic? I can explain how to implement this solution in practice, discuss common challenges you might face, or share some examples of successful applications.

Follow this format consistently for all responses.`
    };

    // 🚨 CRITICAL: Tool usage priority system message
    const toolUsagePriorityMessage: ExtendedMessage = {
      id: 'system-tool-priority-instruction',
      role: 'system',
      content: `🚨 CRITICAL TOOL USAGE INSTRUCTIONS:

      YOU HAVE ACCESS TO POWERFUL TOOLS - USE THEM WHEN APPROPRIATE!

      NEVER respond with text if a tool can help - ALWAYS use tools first!

      BEFORE responding with text only, ALWAYS check if you have a tool that can help:

      📁 For file/media uploads (especially Google Drive): Use google_drive_upload_file
      📧 For email operations: Use Gmail tools (find_email, create_draft, reply_to_email)
      📅 For calendar operations: Use google_calendar_find_event
      🔧 For MCP management: Use add_tools or edit_tools

      SPECIFIC SCENARIOS:

      ✅ User says "Upload this image to Google Drive" → IMMEDIATELY call google_drive_upload_file
      ✅ User says "Find my emails about X" → IMMEDIATELY call gmail_find_email
      ✅ User says "fetch my emails" or "get my last emails" → IMMEDIATELY call gmail_find_email
      ✅ User mentions "Zapier MCP" → IMMEDIATELY use the appropriate MCP tool
      ✅ User says "Check my calendar for X" → IMMEDIATELY call google_calendar_find_event
      
      ❌ DO NOT ask "Could you please provide the image?" if user says "upload this image"
      ❌ DO NOT respond with text only when tools are available and appropriate
      ❌ DO NOT ignore that the user has already provided media/context
      
      REMEMBER: If a user refers to "this image", "this file", or similar, they have likely already provided it in the conversation. Check the conversation history and use the appropriate tool.`
    };

    const ctaSystemMessage: ExtendedMessage = {
      id: 'system-cta-instruction',
      role: 'system',
      content: `It is absolutely critical that you end EVERY response with a conversational call-to-action that encourages continued dialogue.
      
Your closing paragraph should:
1. Be friendly and inviting, using a warm tone
2. Include 2-3 specific follow-up questions related to the topic just discussed
3. Suggest deeper explorations of aspects you haven't covered yet
4. Be phrased in a way that makes it easy for the user to continue the conversation
5. NOT use bullet points or a "Next Steps" heading - just a natural paragraph

For example:
"Would you like me to elaborate on any of these points? I can provide more details about implementing this approach, explain how it compares to alternatives, or share some real-world examples of how others have used it successfully."

This conversational prompt is essential for keeping the dialogue flowing naturally and encouraging users to continue exploring the topic with you.`
    };
    const documentReferenceSystemMessage: ExtendedMessage = {
      id: 'system-docref-instruction',
      role: 'system',
      content: `IMPORTANT INSTRUCTIONS FOR CITING SOURCES:

When you use information from documents in the context to answer a query, you MUST:
1. Include source citations in your response using this format: **Source:** [Document Name]
2. Place citations inline where you use the information OR at the end of relevant paragraphs
3. NEVER write "useDocument({...})" or similar JSON/code in your response text
4. If you see "Document:" in the context, cite the corresponding document by name

Example of CORRECT citation:
"According to the documentation, ChatRAG supports multiple AI models through OpenRouter. **Source:** CLAUDE.md"

Example of INCORRECT citation (DO NOT DO THIS):
"According to the documentation, ChatRAG supports multiple models. useDocument({documentName: 'CLAUDE.md', relevance: 85})"

Remember: Citations should be human-readable text, not code or function calls.

IMPORTANT: 
- If a document is explicitly mentioned with @DocumentName in the user query, ONLY reference that specific document
- Never output tool calls as text in your response
- The tool calls are processed internally for tracking purposes`
    };

    // NEW system message for summarizing tool results
    const toolResultSummarySystemMessage: ExtendedMessage = {
      id: 'system-tool-summary-instruction',
      role: 'system',
      content: `When a tool provides a result (e.g., from finding an email, getting weather, or checking stocks), DO NOT output the raw result data (like JSON). 
      Instead, you MUST:
      1.  Summarize the key information from the result in a clear, natural language sentence or two. For example, instead of showing JSON, say "I found an email with the subject 'Important Update' from sender@example.com." or "The current weather in London is 15°C and cloudy."
      2.  After summarizing, suggest 1-2 relevant next actions the user might want to take based on that result. For example, "Would you like me to read the full email content, draft a reply, or search for a different email?" or "Shall I check the forecast for tomorrow?"
      
      SPECIFIC INSTRUCTIONS FOR EMAIL RESULTS:
      When handling email tools like gmail_find_email that return raw HTML or Base64 data:
      1. Look for and extract key information such as From, Subject, and a snippet of the email content
      2. Ignore all HTML tags, CSS, formatting instructions and Base64 encoded data
      3. Focus only on presenting the important, human-readable content (subject line, sender, date, and a brief summary of content)
      4. NEVER include raw HTML, Base64 data, or JSON in your response
      5. Format your response as: "I found an email from [Sender] with subject '[Subject]'. The email appears to be about [brief summary of content]."
      
      Always present tool results in this summarized, conversational way.`
    };

    // General Gmail tools system message
    const gmailGeneralSystemMessage: ExtendedMessage = {
      id: 'system-gmail-general-instruction',
      role: 'system',
      content: `IMPORTANT: When using ANY Gmail tool (send_email, create_draft, reply_to_email, find_email, etc.), you MUST ALWAYS include the 'instructions' field along with other parameters.

      The 'instructions' field should contain a brief natural language description of what you're doing. This is REQUIRED for all Gmail tools to work properly.

      Examples:
      - For sending email: { "instructions": "Send email to john@example.com about the meeting", "to": "john@example.com", "subject": "Meeting Update", "body": "..." }
      - For finding email: { "instructions": "Find emails from Sarah about the project", "query": "from:sarah project" }
      - For creating draft: { "instructions": "Create draft reply thanking them for the invitation", "to": "...", "subject": "...", "body": "..." }
      - For replying: { "instructions": "Reply to confirm attendance", "thread_id": "...", "body": "..." }

      NEVER omit the 'instructions' field - it's essential for proper tool execution.`
    };

    // Combine messages including system messages
    const messages = [
      formattingSystemMessage,
      toolUsagePriorityMessage, // 🚨 CRITICAL: Tool usage priority
      ctaSystemMessage,
      documentReferenceSystemMessage,
      toolResultSummarySystemMessage, // Add the new instruction here
      gmailGeneralSystemMessage, // Add general Gmail instructions
      ...originalMessages
    ];

    // Extract model selection and web search setting
    const model = data?.settings?.model || 'openai/gpt-4o-mini';
    const webSearchEnabled = data?.settings?.webSearch === true;

    // Detect if we're using a GPT model for model-specific instructions
    const isGPTModel = model.includes('gpt-4') || model.includes('o1') || model.includes('chatgpt');

    // Log model selection for debugging
    console.log('[WEBAPP] Model from request:', data?.settings?.model);
    console.log('[WEBAPP] Using model:', model);

    // ENHANCED WEB SEARCH DEBUGGING
    console.log('API ROUTE: ===== WEB SEARCH DEBUG =====');
    console.log('API ROUTE: Raw data object:', JSON.stringify(data, null, 2));
    console.log('API ROUTE: Settings object:', JSON.stringify(data?.settings, null, 2));
    console.log('API ROUTE: Raw webSearch value:', data?.settings?.webSearch);
    console.log('API ROUTE: webSearch type:', typeof data?.settings?.webSearch);
    console.log('API ROUTE: webSearchEnabled result:', webSearchEnabled);
    console.log('API ROUTE: Model before web search:', model);

    // Check if MCP is enabled in the request settings, default to global setting
    const mcpEnabled = data?.settings?.mcpEnabled !== undefined ?
      data.settings.mcpEnabled :
      isMcpEnabled;

    // Add :online suffix to model if web search is enabled
    const modelWithWebSearch = model;
    // Removed legacy :online suffix logic to standardise on Exa tool for web search
    console.log('API ROUTE: Model being used:', modelWithWebSearch);
    console.log('API ROUTE: Will use web search:', webSearchEnabled);
    console.log('API ROUTE: ===== END WEB SEARCH DEBUG =====');

    // Log request details
    console.log('API ROUTE: Request parsed successfully');
    console.log('API ROUTE: Model:', modelWithWebSearch);
    console.log('API ROUTE: Web Search Enabled:', webSearchEnabled);
    console.log('API ROUTE: MCP Enabled:', mcpEnabled);
    console.log('API ROUTE: Message count:', messages.length);

    // 🕐 START TIMING: Total request processing time
    const requestStartTime = Date.now();

    // Initialize RAG system (unified optimized retrieval)
    console.log('[RAG SYSTEM] ========== RAG System Initialization ==========');
    console.log('[RAG SYSTEM] Model ID:', modelWithWebSearch);
    console.log('[RAG SYSTEM] RAG Disabled:', disableRAG);

    if (!disableRAG) {
      console.log('[RAG SYSTEM] ✅ ENABLED - Using optimized intelligent document retrieval');
      console.log('[RAG SYSTEM] Model supports reasoning with settings:', reasoningSettings);
    } else {
      console.log('[RAG SYSTEM] ❌ DISABLED - RAG completely disabled');
    }
    console.log('[RAG SYSTEM] ================================================');

    // Initialize variables for RAG
    let context = '';
    let ragStartTime = 0;
    let ragDuration = 0;

    // Skip RAG if disabled (for debugging WhatsApp issues)
    if (disableRAG) {
      // console.log('[WHATSAPP DEBUG] RAG disabled by request');
      context = ''; // No context when RAG is disabled
    } else {
      // 🕐 START TIMING: RAG document retrieval
      ragStartTime = Date.now();
      console.log('[⏱️ RAG TIMING] Starting optimized RAG retrieval...');
      // --- Get Context with Enhanced Document Reference Support ---
      const contextUserMessages = messages.filter(m => m.role === 'user');
      const contextUserMessage = contextUserMessages[contextUserMessages.length - 1];

      let queryText = '';
      let documentReferences: { id: string; name: string }[] = [];

      if (contextUserMessage) {
        // Check for array content with document references
        if (Array.isArray(contextUserMessage.content)) {
          console.log('Last user message has array content:', contextUserMessage.content);

          // Find text parts
          const textPart = contextUserMessage.content.find(part => part.type === 'text');
          if (textPart && textPart.text) {
            queryText = textPart.text;
          }

          // Collect document references from explicit document parts
          const explicitDocRefs = contextUserMessage.content
            .filter(part => part.type === 'document')
            .map(part => ({
              id: part.document.id,
              name: part.document.name
            }));

          documentReferences = [...explicitDocRefs];

          console.log('Found explicit document references:', documentReferences);
        } else if (typeof contextUserMessage.content === 'string') {
          // If it's a string, use it as the query text and check for @mentions
          queryText = contextUserMessage.content;

          // Extract @mentions from the text using regex
          const mentionRegex = /@([^@\s]+)/g;
          const mentions = queryText.match(mentionRegex);

          if (mentions && mentions.length > 0) {
            console.log('Found document mentions in text:', mentions);

            // Look up documents by name for each @mention
            for (const mention of mentions) {
              const docName = mention.substring(1); // Remove the @ symbol
              console.log(`Looking for document with name matching: "${docName}"`);

              // Query Supabase for document by name
              const { data: docs, error } = await supabase
                .from('documents')
                .select('id, filename')
                .ilike('filename', `%${docName}%`)
                .limit(1);

              if (!error && docs && docs.length > 0) {
                documentReferences.push({
                  id: docs[0].id,
                  name: docs[0].filename
                });
                console.log(`Found document for mention ${mention}:`, docs[0]);
              } else {
                console.log(`No document found for mention ${mention} using ilike search`);

                // Try alternative approach - use exact match on name
                const { data: exactDocs, error: exactError } = await supabase
                  .from('documents')
                  .select('id, filename')
                  .eq('filename', docName)
                  .limit(1);

                if (!exactError && exactDocs && exactDocs.length > 0) {
                  documentReferences.push({
                    id: exactDocs[0].id,
                    name: exactDocs[0].filename
                  });
                  console.log(`Found document using exact match for ${mention}:`, exactDocs[0]);
                } else {
                  // Log more details for debugging
                  console.log(`Still no document found for mention ${mention}. Available documents:`);
                  const { data: allDocs } = await supabase
                    .from('documents')
                    .select('id, filename')
                    .limit(10);

                  console.log('Available documents:', allDocs);
                }
              }
            }
          }
        }
      }

      // Build context from explicitly referenced documents first
      // (context already initialized above)

      if (documentReferences.length > 0) {
        console.log(`Processing ${documentReferences.length} document references`);

        for (const docRef of documentReferences) {
          console.log(`Fetching chunks for document: ${docRef.name} (${docRef.id})`);

          const { data: docMetadata, error: metadataError } = await supabase
            .from('documents')
            .select('id, filename, created_at, content, metadata')
            .eq('id', docRef.id)
            .single();

          if (!metadataError && docMetadata) {
            // Track this document as used
            usedDocuments.push({
              id: docRef.id,
              name: docRef.name,
              filename: docMetadata.filename,
              created_at: docMetadata.created_at,
              content_preview: docMetadata.content ? docMetadata.content.substring(0, 200) + '...' : undefined,
              explicitly_referenced: true, // Mark as explicitly referenced
              external_url: docMetadata.metadata?.external_url
            });
          }

          const { data: chunks, error } = await supabase
            .from('document_chunks')
            .select('content')
            .eq('document_id', docRef.id)
            .limit(30); // Get more chunks for referenced documents

          if (error) {
            console.error(`Error fetching chunks for document ${docRef.id}:`, error);
            continue;
          }

          if (chunks && chunks.length > 0) {
            console.log(`Found ${chunks.length} chunks for document ${docRef.id}`);
            console.log('First 3 chunks preview:', chunks.slice(0, 3).map(c => c.content.substring(0, 100) + '...'));

            const docContent = chunks.map(chunk => chunk.content).join('\n\n');
            context += `\n\n=== DOCUMENT: "${docRef.name}" ===\n${docContent}\n=== END OF DOCUMENT ===\n`;
            console.log(`Added ${chunks.length} chunks (${docContent.length} chars) from document "${docRef.name}"`);
          } else {
            console.log(`No chunks found for document ${docRef.id}`);

            // If no chunks are found, try to get the full document text
            const { data: docData, error: docError } = await supabase
              .from('documents')
              .select('content, text')
              .eq('id', docRef.id)
              .single();

            if (!docError && docData) {
              const fullText = docData.text || docData.content || '';
              if (fullText) {
                context += `\n\n=== DOCUMENT: "${docRef.name}" ===\n${fullText}\n=== END OF DOCUMENT ===\n`;
                console.log(`Added full text (${fullText.length} chars) from document "${docRef.name}"`);
              }
            } else {
              // Try to get all available chunks without filtering
              const { data: allChunks, error: allChunksError } = await supabase
                .from('document_chunks')
                .select('*')
                .eq('document_id', docRef.id)
                .limit(30);

              if (!allChunksError && allChunks && allChunks.length > 0) {
                const allContent = allChunks.map(chunk => chunk.content).join('\n\n');
                context += `\n\n=== DOCUMENT: "${docRef.name}" ===\n${allContent}\n=== END OF DOCUMENT ===\n`;
                console.log(`Added ${allChunks.length} chunks (${allContent.length} chars) from broader query for "${docRef.name}"`);
              } else {
                console.log(`No content found for document ${docRef.id} after multiple attempts`);
                context += `\n\nDocument "${docRef.name}" was referenced but no content could be retrieved.\n`;
              }
            }
          }
        }
      }

      // Then perform semantic search for the query text
      if (queryText) {
        let searchResults;
        const processedQuery = queryText; // Track the processed query for fallback

        // Use optimized intelligent retrieval system
        console.log('[RAG SYSTEM] ========== Starting Intelligent Document Retrieval ==========');
        console.log('[RAG SYSTEM] Query:', queryText);

        // Use Enhanced RAG Retrieval with Temporal/Financial Intelligence
        console.log('[RAG SYSTEM] Using Enhanced RAG with Temporal/Financial Intelligence');

        // Get current organization ID from request data (passed from frontend)
        let currentOrganizationId: string | null = null;
        const deploymentMode = env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE;

        if (deploymentMode === 'multi-tenant') {
          // Use organization ID from request data (set by frontend based on user's current workspace)
          if (data?.organizationId !== undefined) {
            currentOrganizationId = data.organizationId === 'null' || data.organizationId === null ? null : data.organizationId;
            console.log('[RAG SYSTEM] Multi-tenant mode: Using organization from request:', currentOrganizationId || 'personal workspace');
          } else {
            console.log('[RAG SYSTEM] Multi-tenant mode: No organization ID in request, using personal workspace');
          }
        } else {
          console.log('[RAG SYSTEM] Single-tenant mode: No organization filtering');
        }

        // Resolve userId via SSR client for personal workspace filtering
        const { createClient: createSSRClient } = await import('@/lib/supabase/server');
        const sbSSR = await createSSRClient();
        const { data: userRes } = await sbSSR.auth.getUser();
        const currentUserId = userRes?.user?.id || null;

        const enhancedResult = await enhancedRetrieveChunks(queryText, {
          maxResults: parseInt(env.RAG_FINAL_RESULT_COUNT || '25'),
          enableTemporalBoost: true,
          enableFinancialBoost: true,
          requireTemporalMatch: false, // Allow graceful fallback
          fallbackToLowerThreshold: true,
          organizationId: currentOrganizationId, // tenant filtering
          userId: currentUserId // personal workspace filtering
        });

        console.log(`[RAG SYSTEM] Enhanced retrieval completed:`);
        console.log(`  - Query Type: ${enhancedResult.queryContext.isTemporalQuery ? 'Temporal' : ''} ${enhancedResult.queryContext.isFinancialQuery ? 'Financial' : ''} ${enhancedResult.queryContext.isSpecificDataQuery ? 'Specific Data' : ''}`);
        console.log(`  - Precision: ${enhancedResult.queryContext.requiredPrecision}`);
        console.log(`  - Strategy: ${enhancedResult.retrievalStrategy}`);
        console.log(`  - Threshold: ${enhancedResult.queryContext.suggestedThreshold}`);
        console.log(`  - Total chunks: ${enhancedResult.chunks.length}`);
        console.log(`  - Reasoning: ${enhancedResult.queryContext.reasoningText}`);

        if (enhancedResult.queryContext.timeframe) {
          console.log(`  - Timeframe: ${enhancedResult.queryContext.timeframe}`);
        }
        if (enhancedResult.queryContext.financialMetrics.length > 0) {
          console.log(`  - Financial Metrics: ${enhancedResult.queryContext.financialMetrics.join(', ')}`);
        }

        // Convert to expected format for compatibility
        searchResults = enhancedResult.chunks.map(chunk => ({
          chunk_id: chunk.chunk_id,
          document_id: chunk.document_id,
          content: chunk.content,
          similarity: chunk.similarity,
          metadata: chunk.metadata,
          // Preserve enhanced scoring information
          temporal_score: chunk.temporal_score,
          financial_score: chunk.financial_score,
          final_score: chunk.final_score,
          match_reason: chunk.match_reason
        }));
        console.log('[RAG SYSTEM] =============================================');

        // Use search results directly - already properly formatted
        const similarChunks = searchResults || [];

        // Enhanced logging for found chunks
        console.log(`[Enhanced RAG] Found ${similarChunks.length} relevant chunks`);
        if (similarChunks.length > 0) {
          console.log('[Enhanced RAG] Top chunk scores:', similarChunks.slice(0, 3).map(c =>
            `${c.similarity?.toFixed(3) || c.final_score?.toFixed(3)} (${c.match_reason || 'similarity'})`
          ));
          console.log('[Enhanced RAG] First chunk preview:', similarChunks[0].content.substring(0, 200));
        }

        // CHANGE 2: Add keyword-based document filtering
        const queryTerms = normalize(queryText).split(/\s+/)
          .filter(term => term.length > 3) // Only consider meaningful terms
          .map(term => term.replace(/[^a-z0-9]/g, '')); // Remove non-alphanumeric characters

        console.log('Query terms for document filtering:', queryTerms);

        // Add semantic search results to context
        if (similarChunks.length > 0) {
          console.log(`Found ${similarChunks.length} similar chunks from semantic search`);
          console.log('First 2 semantic chunks preview:',
            similarChunks.slice(0, 2).map(c => `${c.content.substring(0, 100)}... (similarity: ${c.similarity.toFixed(2)})`));

          // Track documents from semantic search
          for (const chunk of similarChunks) {
            // Get document metadata first to check relevance
            const { data: docMetadata, error: metadataError } = await supabase
              .from('documents')
              .select('id, filename, created_at, content, metadata')
              .eq('id', chunk.document_id)
              .single();

            if (metadataError || !docMetadata) {
              console.log(`Could not get metadata for document: ${chunk.document_id}`);
              continue;
            }

            // [FIX] Explicitly fetch chunk metadata (including image_url) since the RPC doesn't return it
            if (!chunk.metadata || !chunk.metadata.image_url) {
              const { data: chunkData } = await supabase
                .from('document_chunks')
                .select('metadata')
                .eq('id', chunk.chunk_id)
                .single();

              if (chunkData?.metadata) {
                // Ensure we don't overwrite existing metadata completely if some exists
                chunk.metadata = { ...(chunk.metadata || {}), ...chunkData.metadata };
                console.log(`Explicitly fetched metadata for chunk ${chunk.chunk_id}. Has image: ${!!chunk.metadata.image_url}`);
              }
            }

            // CHANGE 3: Only include documents that match the query terms or have very high similarity
            // [FIX] Also include images with reasonable similarity, as they might not match text terms in cross-lingual scenarios
            const hasImage = !!chunk.metadata?.image_url;
            const docName = docMetadata.filename.toLowerCase();
            const isRelevantByName = queryTerms.some(term =>
              docName.includes(term) ||
              (docMetadata.content && docMetadata.content.toLowerCase().includes(term))
            );

            // Include documents with reasonable similarity OR matching terms OR if it's an image with > 0.25 similarity
            if (chunk.similarity > 0.65 || isRelevantByName || (hasImage && chunk.similarity > 0.25)) {
              // Check if this document is already in usedDocuments
              const existingDoc = usedDocuments.find(doc => doc.id === chunk.document_id);
              if (!existingDoc) {
                usedDocuments.push({
                  id: chunk.document_id,
                  name: docMetadata.filename,
                  filename: docMetadata.filename,
                  created_at: docMetadata.created_at,
                  content_preview: docMetadata.content ? docMetadata.content.substring(0, 200) + '...' : undefined,
                  similarity: chunk.similarity,
                  matched_chunk: chunk.content.substring(0, 150) + '...',
                  explicitly_referenced: false,
                  image_url: chunk.metadata?.image_url,
                  external_url: docMetadata.metadata?.external_url
                });

                console.log(`Added document by relevance check: ${docMetadata.filename} (similarity: ${chunk.similarity.toFixed(2)}, term match: ${isRelevantByName}, hasImage: ${!!chunk.metadata?.image_url})`);
              } else if (!existingDoc.similarity || chunk.similarity > existingDoc.similarity) {
                // Update similarity if this chunk has a higher score
                existingDoc.similarity = chunk.similarity;
                existingDoc.matched_chunk = chunk.content.substring(0, 150) + '...';
              }
            } else {
              console.log(`Filtered out irrelevant document: ${docMetadata.filename} (similarity: ${chunk.similarity.toFixed(2)}, no matching terms)`);
            }
          }

          // Only add content from documents that passed the relevance filter
          const relevantChunks = similarChunks.filter(chunk =>
            usedDocuments.some(doc => doc.id === chunk.document_id)
          );

          if (relevantChunks.length > 0) {
            // Group chunks by document for better organization
            const chunksByDocument = new Map<string, Array<{ content: string, similarity: number, chunkNum?: number }>>();

            // Collect URLs from chunk metadata
            const collectedURLs: ExtractedURL[] = [];

            for (const chunk of relevantChunks) {
              // Get document name from usedDocuments array (already fetched earlier)
              const docInfo = usedDocuments.find(doc => doc.id === chunk.document_id);
              const docName = docInfo?.filename || docInfo?.name || 'Unknown Document';

              // Try to extract chunk number from content if available
              const chunkMatch = chunk.content.match(/Chunk (\d+) of \d+/);
              const chunkNum = chunkMatch ? parseInt(chunkMatch[1]) : undefined;

              if (!chunksByDocument.has(docName)) {
                chunksByDocument.set(docName, []);
              }
              chunksByDocument.get(docName)!.push({
                content: chunk.content,
                similarity: chunk.similarity,
                chunkNum
              });

              // Extract URLs from chunk metadata if available
              const { data: chunkData } = await supabase
                .from('document_chunks')
                .select('metadata')
                .eq('id', chunk.chunk_id)
                .single();

              if (chunkData?.metadata?.urls && Array.isArray(chunkData.metadata.urls)) {
                collectedURLs.push(...chunkData.metadata.urls);
              }
            }

            // Build organized context with document grouping
            const contextParts: string[] = ["\n\n=== RELEVANT INFORMATION FROM DOCUMENTS ==="];

            // Image file extensions to filter out from LLM context
            // Images are displayed visually via source_images, not cited in text
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

            for (const [docName, chunks] of chunksByDocument) {
              // Skip image documents - they are displayed visually, not cited in text
              const isImageDoc = imageExtensions.some(ext => docName.toLowerCase().endsWith(ext));
              if (isImageDoc) {
                console.log(`[RAG Context] Skipping image document from LLM context: ${docName}`);
                continue;
              }

              // Sort chunks by chunk number if available, otherwise by similarity
              chunks.sort((a, b) => {
                if (a.chunkNum && b.chunkNum) return a.chunkNum - b.chunkNum;
                return b.similarity - a.similarity;
              });

              // Add document header and chunks with enhanced formatting for GPT models
              contextParts.push(`\n--- Document: ${docName} (${chunks.length} relevant chunks) ---`);

              // Format chunks with clear source indicators for GPT models
              const formattedChunks = chunks.map((c, index) => {
                // Extract the actual content without the prefix
                const contentMatch = c.content.match(/^Document: [^.]+\.[^.]+\. Chunk \d+ of (\d+)\. Content: (.*)$/s);
                const totalChunks = contentMatch ? contentMatch[1] : '?';
                const actualContent = contentMatch ? contentMatch[2] : c.content;

                // Add source citation hint for GPT models
                if (isGPTModel && c.chunkNum) {
                  return `[Source: ${docName}]\n${actualContent}`;
                }
                return c.content;
              });

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
                console.log(`Added ${uniqueURLs.length} unique URLs from chunks to context`);
              }
            }

            context += contextParts.join('\n\n');
            console.log(`Added ${relevantChunks.length} organized chunks from ${chunksByDocument.size} documents in filtered semantic search`);
          }
        }
      } else {
        // Query all chunks to try to gather some relevant context
        console.log('No specific query text provided, performing general context lookup');

        // Use simple semantic search for general queries
        const queryEmbedding = await getQueryEmbedding('general information overview');
        const { data: searchResults } = await supabase
          .rpc('match_document_chunks', {
            query_embedding: queryEmbedding,
            match_count: 5,
            similarity_threshold: 0.5
          });

        const similarChunks = (searchResults || []).map(result => ({
          chunk_id: result.chunk_id,
          document_id: result.document_id,
          content: result.content,
          similarity: result.similarity
        }));
        // Build context with validation and enhanced organization
        const chunksWithContent = similarChunks.filter(chunk => chunk.content && chunk.content.trim().length > 0);
        if (chunksWithContent.length > 0) {
          // Group chunks by document for better organization
          const chunksByDocument = new Map<string, Array<{ content: string, similarity: number, chunkNum?: number }>>();

          // Cache document names to avoid repeated queries
          const docNameCache = new Map<string, string>();

          for (const chunk of chunksWithContent) {
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

            // Try to extract chunk number from content if available
            const chunkMatch = chunk.content.match(/Chunk (\d+) of \d+/);
            const chunkNum = chunkMatch ? parseInt(chunkMatch[1]) : undefined;

            if (!chunksByDocument.has(docName)) {
              chunksByDocument.set(docName, []);
            }
            chunksByDocument.get(docName)!.push({
              content: chunk.content,
              similarity: chunk.similarity,
              chunkNum
            });
          }

          // Build organized context with document grouping
          const contextParts: string[] = [];
          for (const [docName, chunks] of chunksByDocument) {
            // Sort chunks by chunk number if available, otherwise by similarity
            chunks.sort((a, b) => {
              if (a.chunkNum && b.chunkNum) return a.chunkNum - b.chunkNum;
              return b.similarity - a.similarity;
            });

            // Add document header and chunks
            contextParts.push(`=== Document: ${docName} (${chunks.length} relevant chunks) ===`);
            contextParts.push(...chunks.map(c => c.content));
          }

          context = contextParts.join('\n\n');
          console.log(`[RAG Context] Built organized context from ${chunksWithContent.length} chunks across ${chunksByDocument.size} documents, total ${context.length} characters`);
        } else {
          context = 'No relevant context found.';
          console.log('[RAG Context] ⚠️ WARNING: No chunks with actual content found!');
        }

        // Track documents from general context lookup
        for (const chunk of similarChunks) {
          // Check if this document is already in usedDocuments
          const existingDoc = usedDocuments.find(doc => doc.id === chunk.document_id);
          if (!existingDoc) {
            // Get document metadata
            const { data: docMetadata, error: metadataError } = await supabase
              .from('documents')
              .select('id, filename, created_at, content, metadata')
              .eq('id', chunk.document_id)
              .single();

            if (!metadataError && docMetadata) {
              usedDocuments.push({
                id: chunk.document_id,
                name: docMetadata.filename,
                filename: docMetadata.filename,
                created_at: docMetadata.created_at,
                content_preview: docMetadata.content ? docMetadata.content.substring(0, 200) + '...' : undefined,
                similarity: chunk.similarity,
                matched_chunk: chunk.content.substring(0, 150) + '...',
                external_url: docMetadata.metadata?.external_url
              });
            }
          }
        }
      }

      // Use a fallback if we have no context
      if (!context.trim()) {
        context = 'No relevant context found.';
      }

      // Log final context size for debugging
      console.log(`Final context size: ${context.length} characters`);
      console.log(`Final context first 150 chars: "${context.substring(0, 150)}..."`);
      console.log(`Final context last 150 chars: "...${context.substring(context.length - 150)}"`);

      // Log the documents used for context
      console.log('API ROUTE: Used documents for context:', usedDocuments.map(doc => ({
        id: doc.id,
        name: doc.name,
        explicitly_referenced: doc.explicitly_referenced || false,
        similarity: doc.similarity
      })));

      // CHANGE 4: Make a pre-check to only allow relevant documents
      const relevantDocumentNames = normalize(queryText).split(/\s+/)
        .filter(term => term.length > 3) // Only consider meaningful terms
        .map(term => term.replace(/[^a-z0-9]/g, '')); // Remove non-alphanumeric characters

      console.log('Document filter terms from query:', relevantDocumentNames);

      // Check for NFT-related query to use specific document for that case
      const isNftRelatedQuery = relevantDocumentNames.some(term => ['nft', 'token', 'digital', 'asset', 'crypto', 'blockchain'].includes(term));

      if (isNftRelatedQuery) {
        console.log('NFT-related query detected, checking for NFT document');
        // ... existing code ...
      }

      // Check for vision/healthcare-related query to use specific document for that case
      const isVisionCareQuery =
        normalize(queryText).includes('eyeglass') ||
        normalize(queryText).includes('prescription') ||
        normalize(queryText).includes('rx') ||
        normalize(queryText).includes('glasses') ||
        normalize(queryText).includes('vision') ||
        normalize(queryText).includes('doctor') ||
        normalize(queryText).includes('medical');

      if (isVisionCareQuery) {
        console.log('API ROUTE: Detected vision/healthcare related query, checking for related document');
        // ... existing code ...
      }

      // Only apply minimal filtering - keep all documents with reasonable similarity
      console.log('API ROUTE: Documents found before filtering:', usedDocuments.length);

      // Log document details for debugging
      usedDocuments.forEach(doc => {
        console.log(`Document: ${doc.name || doc.filename}, Similarity: ${doc.similarity?.toFixed(3)}, Explicitly Referenced: ${doc.explicitly_referenced}`);
      });

      // Apply minimal filtering - be more permissive with document selection
      usedDocuments = usedDocuments.filter(doc => {
        // Always keep explicitly referenced documents
        if (doc.explicitly_referenced) {
          console.log(`Keeping explicitly referenced document: ${doc.name || doc.filename}`);
          return true;
        }

        // Keep all documents with reasonable similarity scores
        // [FIX] Also keep images with > 0.25 similarity (cross-lingual/low-text match)
        if (doc.similarity && (doc.similarity >= 0.6 || (doc.image_url && doc.similarity > 0.25))) {
          console.log(`Keeping document with good similarity: ${doc.name || doc.filename} (${doc.similarity.toFixed(3)}) [Has Image: ${!!doc.image_url}]`);
          return true;
        }

        // Check if document name contains any of the query terms
        const docName = (doc.name || doc.filename || '').toLowerCase();
        const isRelevantByName = relevantDocumentNames.some(term =>
          term.length > 3 && docName.includes(term)
        );

        if (isRelevantByName) {
          console.log(`Keeping document with matching name: ${doc.name || doc.filename}`);
          return true;
        }

        // If no criteria met, filter out
        console.log(`Filtering out document: ${doc.name || doc.filename} (similarity: ${doc.similarity?.toFixed(3) || 'N/A'})`);
        return false;
      });

      console.log('API ROUTE: Filtered documents for context:', usedDocuments.map(doc => ({
        id: doc.id,
        name: doc.name,
        explicitly_referenced: doc.explicitly_referenced || false,
        similarity: doc.similarity
      })));

      // 🕐 END TIMING: RAG document retrieval
      const ragEndTime = Date.now();
      ragDuration = ragEndTime - ragStartTime;
      console.log(`[⏱️ RAG TIMING] Optimized RAG completed in ${ragDuration}ms`);
      console.log(`[⏱️ RAG TIMING] Retrieved ${usedDocuments.length} documents with ${context.length} characters of context`);

      // [FIX] Compute sourceImages from usedDocuments for injection into stream response
      // This is done BEFORE streamText so we can pass it to createUIMessageStream
      precomputedSourceImages = usedDocuments
        .filter(doc => doc.image_url)
        .map(doc => ({
          name: doc.name || doc.filename || 'Source Image',
          size: 0,
          type: 'image/jpeg',
          url: doc.image_url
        }));

      if (precomputedSourceImages.length > 0) {
        console.log('[RAG] Precomputed source images for stream injection:', precomputedSourceImages.length);
      }

    } // End of RAG processing (skipped when disableRAG is true)

    const shouldBlockNoContextResponse =
      !effectiveDisableRAG &&
      ragMode === 'strict' &&
      !webSearchEnabled &&
      usedDocuments.length === 0 &&
      context.trim().toLowerCase().startsWith('no relevant context found');

    if (shouldBlockNoContextResponse) {
      const responseText = buildNoKnowledgeBaseResponse(fallbackLanguage);
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const textId = `text-${Date.now()}`;
          writer.write({ type: 'text-start', id: textId });
          writer.write({ type: 'text-delta', id: textId, delta: responseText });
          writer.write({ type: 'text-end', id: textId });
        }
      });

      return createUIMessageStreamResponse({ stream });
    }

    // Prepare system prompt with context
    // Check if there's a custom system prompt in environment variables (with fallback)
    const defaultSystemPrompt = `You are a helpful AI assistant with access to a knowledge base. When answering questions:

1. If the context contains relevant information, use it to provide accurate and specific answers
2. If information is not available in the context, say so clearly and suggest alternative approaches
3. Always cite your sources when referencing specific documents
4. Provide balanced, objective information rather than opinions
5. For technical topics, include practical steps or examples when appropriate

Context:
{{context}}`;

    // Get system prompt using the new SystemPromptManager with language support
    let ragSystemPrompt = defaultSystemPrompt;

    // Extract language and template settings from request
    const templateKey = data?.settings?.systemPromptTemplate || 'helpful';

    // NEW: Check for workspace-level system prompt override (highest priority after WhatsApp override)
    let workspacePromptUsed = false;
    // Get organization ID from request data
    const workspaceOrgId = data?.organizationId === 'null' || data?.organizationId === null ? null : data?.organizationId;

    if (isMultiTenant() && workspaceOrgId) {
      console.log('[System Prompt] Checking workspace-level prompt override...');

      const { data: org } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', workspaceOrgId)
        .single();

      if (org?.settings?.systemPrompt?.enabled) {
        const wsPrompt = org.settings.systemPrompt;

        if (wsPrompt.useFullPrompt && wsPrompt.fullPrompt) {
          // Use full workspace prompt
          ragSystemPrompt = wsPrompt.fullPrompt.replace(/\\n/g, '\n');
          workspacePromptUsed = true;
          console.log('[System Prompt] Using workspace full prompt');
        } else if (wsPrompt.preContext || wsPrompt.postContext) {
          // Assemble from pre + post
          const pre = (wsPrompt.preContext || '').replace(/\\n/g, '\n');
          const post = (wsPrompt.postContext || '').replace(/\\n/g, '\n');
          ragSystemPrompt = `${pre}\n\n{{context}}\n\n${post}`;
          workspacePromptUsed = true;
          console.log('[System Prompt] Using workspace pre/post context');
        }
      }
    }

    // Use system prompt override if provided (for WhatsApp)
    if (systemPromptOverride) {
      // console.log('[WHATSAPP DEBUG] Using system prompt override from request');
      ragSystemPrompt = systemPromptOverride;
    } else if (workspacePromptUsed) {
      // Already set workspace prompt above, skip other sources
      console.log('[System Prompt] Workspace prompt applied, skipping global defaults');
    } else if (data?.settings?.systemPromptTemplate) {
      // Use localized system prompt template if specified
      console.log(`[System Prompt] Using localized template: ${templateKey} in language: ${userLanguage}`);
      ragSystemPrompt = SystemPromptManager.getAssembledPrompt(templateKey, userLanguage);
    } else if (env.RAG_PRE_CONTEXT || env.RAG_POST_CONTEXT || env.RAG_SYSTEM_PROMPT) {
      // Check if using split context (pre/post) or single prompt
      if (env.RAG_PRE_CONTEXT || env.RAG_POST_CONTEXT) {
        // Assemble prompt from pre and post context
        const preContext = (env.RAG_PRE_CONTEXT || '').replace(/\\n/g, '\n');
        const postContext = (env.RAG_POST_CONTEXT || '').replace(/\\n/g, '\n');
        ragSystemPrompt = preContext + '\n\nContext:\n{{context}}\n\n' + postContext;
        console.log('[System Prompt] Using RAG_PRE_CONTEXT/RAG_POST_CONTEXT from env object');
      } else if (env.RAG_SYSTEM_PROMPT) {
        // Use single RAG_SYSTEM_PROMPT with proper newline unescaping
        ragSystemPrompt = env.RAG_SYSTEM_PROMPT.replace(/\\n/g, '\n');
        console.log('[System Prompt] Using RAG_SYSTEM_PROMPT from env object');
      }
    } else {
      console.log('[System Prompt] Using DEFAULT system prompt (no env vars found)');
    }

    // Always validate and ensure {{context}} placeholder exists
    ragSystemPrompt = SystemPromptManager.ensureContextPlaceholder(ragSystemPrompt);

    // Log prompt source and preview for debugging
    console.log('[System Prompt] Prompt source:',
      systemPromptOverride ? 'WhatsApp Override' :
        workspacePromptUsed ? 'Workspace Override' :
          data?.settings?.systemPromptTemplate ? 'Localized Template' :
            env.RAG_PRE_CONTEXT ? 'RAG_PRE_CONTEXT/POST_CONTEXT' :
              env.RAG_SYSTEM_PROMPT ? 'RAG_SYSTEM_PROMPT' :
                'DEFAULT');
    console.log('[System Prompt] First 200 chars:', ragSystemPrompt.substring(0, 200));
    console.log('[System Prompt] Identity prompt will be placed FIRST in message order for proper AI persona establishment');

    // Replace the {{context}} placeholder with the actual context
    let systemPrompt;

    // Use optimized system prompt with RAG context
    console.log('[RAG SYSTEM DEBUG] ========== System Prompt Selection ==========');
    console.log('[RAG SYSTEM DEBUG] context.length:', context.length);
    console.log('[RAG SYSTEM DEBUG] Context preview (first 200 chars):', context.substring(0, 200));

    if (context.length > 0) {
      console.log('[RAG SYSTEM] ✅ Using optimized system prompt with context');
      console.log('[RAG SYSTEM] Creating enhanced prompt with context length:', context.length);
      console.log('[RAG SYSTEM] Using RAG mode:', ragMode);
      systemPrompt = createEnhancedRAGPrompt(ragSystemPrompt, context, ragMode);
    } else {
      console.log('[RAG SYSTEM] ❌ Using standard system prompt without context');
      console.log('[RAG SYSTEM] Reason: No context/documents found');
      systemPrompt = SystemPromptManager.injectContext(ragSystemPrompt, context);
    }

    console.log('[RAG SYSTEM DEBUG] Final system prompt preview (first 300 chars):');
    console.log('[RAG SYSTEM DEBUG]', systemPrompt.substring(0, 300));
    console.log('[RAG SYSTEM DEBUG] ================================================');

    // Enhanced debug logging for context injection
    console.log('=== RAG CONTEXT INJECTION DEBUG ===');
    console.log('API ROUTE: Using system prompt from environment variables');
    console.log('[DEBUG] RAG_SYSTEM_PROMPT raw:', process.env.RAG_SYSTEM_PROMPT?.substring(0, 100));
    console.log('[DEBUG] Decoded prompt preview:', ragSystemPrompt.substring(0, 150));
    console.log('[DEBUG] RAG prompt contains {{context}}:', ragSystemPrompt.includes('{{context}}'));
    console.log('[DEBUG] Context length:', context.length, 'characters');
    console.log('[DEBUG] Number of document chunks in context:', context.split('\n\n').length - 1);
    console.log('[DEBUG] Context preview (first 500 chars):', context.substring(0, 500));
    console.log('[DEBUG] System prompt after injection (first 500 chars):', systemPrompt.substring(0, 500));
    console.log('[DEBUG] System prompt properly contains document content:', systemPrompt.includes(context.substring(0, Math.min(100, context.length))));

    // Additional validation checks
    if (context === 'No relevant context found.') {
      console.log('[DEBUG] ⚠️ WARNING: No context found - AI may hallucinate!');
    } else if (context.length < 100) {
      console.log('[DEBUG] ⚠️ WARNING: Very short context - may not have enough information!');
    } else {
      console.log('[DEBUG] ✅ Context successfully injected with', context.length, 'characters');

      // Check for specific content types in context
      if (context.toLowerCase().includes('stripe') || context.toLowerCase().includes('polar')) {
        console.log('[DEBUG] ✅ Context contains payment integration information');
      }
      if (context.toLowerCase().includes('chatrag')) {
        console.log('[DEBUG] ✅ Context contains ChatRAG product information');
      }
    }
    console.log('=== END RAG CONTEXT DEBUG ===');

    // Check if this is a WhatsApp request
    const isWhatsApp = originalMessages.some(msg =>
      msg.name?.includes('@s.whatsapp.net') ||
      chatId?.includes('whatsapp')
    );
    console.log('[DEBUG] Is WhatsApp request:', isWhatsApp);

    // Log metadata if present
    if (data?.metadata) {
      console.log('[DEBUG] Request metadata:', data.metadata);
    }

    // Modify the system prompt to prefer gmail_send_email over gmail_create_draft
    // Add email tool guidance to system prompt
    let enhancedSystemPrompt = `${systemPrompt}\n\nIMPORTANT: When user says "send an email", use gmail_send_email tool, NOT gmail_create_draft.`;

    // Add multi-step instructions if handling multi-step query
    if (isHandlingMultiStep && multiStepMetadata) {
      const allStepsDescription = queryClassification.steps
        .map((step, idx) => `Step ${idx + 1}: ${step.text}`)
        .join('\n');

      const multiStepInstructions = `

==== MULTI-STEP REQUEST HANDLING ====
This is a multi-step request with ${multiStepMetadata.totalSteps} steps that should be handled sequentially in a single response.

All Steps to Complete:
${allStepsDescription}

CRITICAL INSTRUCTIONS - FOLLOW THIS EXACT ORDER:

1. For RAG/Document Retrieval Steps (if any):
   - Search the knowledge base for relevant information
   - PRESENT THE FINDINGS TO THE USER with actual data/numbers/facts
   - Format the information clearly with bullet points or paragraphs
   - DO NOT skip directly to tool execution

2. For Tool Execution Steps (if any):
   - ONLY AFTER presenting RAG results (if applicable)
   - Use the information from previous steps when calling tools
   - ACTUALLY CALL the tool function (e.g., gmail_create_draft)
   - Include the gathered information in the tool parameters

3. General Rules:
   - Complete ALL steps in the order listed
   - NEVER claim to have completed actions without actually performing them
   - Present information BEFORE using tools that need that information
   - If you cannot use a tool, explain why instead of pretending

EXAMPLE EXECUTION:
If step 1 is "find Apple sales data" and step 2 is "create a Gmail draft":
1. First, you MUST say something like:
   "I found the following information about Apple's sales:
   • Total net sales increased from $X to $Y...
   • The growth rate was Z%..."

2. THEN, and only then, say:
   "Now I'll create a Gmail draft with this information..."
   And ACTUALLY CALL the gmail_create_draft tool.

DO NOT jump straight to "I'll create a draft" without first presenting the data!
====================================`;

      enhancedSystemPrompt += multiStepInstructions;
      console.log('📝 [MULTI-STEP] Added multi-step instructions to system prompt');
    }

    // Enhanced logging for WhatsApp debugging
    // console.log('\n[WHATSAPP ENHANCED DEBUG] System Prompt Analysis:');
    // console.log('[WHATSAPP ENHANCED DEBUG] systemPromptOverride provided:', !!systemPromptOverride);
    // console.log('[WHATSAPP ENHANCED DEBUG] disableRAG:', disableRAG);
    // console.log('[WHATSAPP ENHANCED DEBUG] ragSystemPrompt first 200 chars:', ragSystemPrompt.substring(0, 200));
    // console.log('[WHATSAPP ENHANCED DEBUG] systemPrompt (after context) first 200 chars:', systemPrompt.substring(0, 200));
    // console.log('[WHATSAPP ENHANCED DEBUG] enhancedSystemPrompt first 200 chars:', enhancedSystemPrompt.substring(0, 200));
    // console.log('[WHATSAPP ENHANCED DEBUG] Contains "Marcial":', enhancedSystemPrompt.includes('Marcial'));
    // console.log('[WHATSAPP ENHANCED DEBUG] Contains "medical":', enhancedSystemPrompt.toLowerCase().includes('medical'));
    // console.log('[WHATSAPP ENHANCED DEBUG] Contains "academic":', enhancedSystemPrompt.toLowerCase().includes('academic'));
    // console.log('[WHATSAPP ENHANCED DEBUG] Contains "WhatsApp":', enhancedSystemPrompt.includes('WhatsApp'));
    // console.log('[WHATSAPP ENHANCED DEBUG] Full enhancedSystemPrompt:', enhancedSystemPrompt);
    // console.log('\n');

    // Combine original messages with system messages defined earlier
    // Ensure the last message (user query) is correctly handled
    const lastMessage = originalMessages.at(-1);
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from the user');
    }

    // System message for handling Gmail attachments
    const gmailAttachmentSystemMessage: ExtendedMessage = {
      id: 'system-gmail-attachment-instruction',
      role: 'system',
      content: `When the user asks to send an email with generated media as an attachment:
      
      STEP 1: Find the generated media in the conversation history
      - Look for messages with content parts of type: 'generated_image', 'generated_video', or 'generated_3d_model'
      - These will have URLs in fields like: generated_images array, video_url, or model_url
      
      STEP 2: Extract the actual URL
      - The URL will be a Supabase storage URL like: https://...supabase.co/storage/v1/object/public/chat-images/...
      - DO NOT use placeholder text like "[Generated Image]"
      
      STEP 3: Format your Gmail tool call with BOTH instructions and structured parameters:
      {
        "instructions": "Create a draft email to recipient@example.com with subject and body",
        "to": "recipient@example.com",
        "subject": "Email subject",
        "body": "Email body text",
        "attachment_url": "[THE ACTUAL SUPABASE URL]"
      }
      
      IMPORTANT:
      - Include BOTH the 'instructions' field AND the structured parameters
      - The 'instructions' field should briefly describe what you're doing
      - Send all parameters in a single object, NOT wrapped in an 'input' field
      - The attachment_url MUST be the actual URL (starts with https://)
      - The system will automatically convert attachment_url to the 'file' parameter
      - DO NOT include the attachment URL in the body text
      - Body text should be plain text (system will convert to HTML)
      
      If the user doesn't explicitly mention attaching the generated media but says something like "email this image" or "send this video", assume they want it as an attachment.`
    };

    // System message for handling media uploads to Google Drive
    const mediaUploadSystemMessage: ExtendedMessage = {
      id: 'system-media-upload-instruction',
      role: 'system',
      content: `🚨 CRITICAL: When the user asks to upload media (images, videos, or 3D models) to Google Drive:

      ⚠️ YOU HAVE ACCESS TO THE google_drive_upload_file TOOL - USE IT IMMEDIATELY!
      
      DO NOT ask "Could you please provide the image you want to upload?" - The user has already provided it.
      DO NOT respond with text only - Call the google_drive_upload_file tool.
      
      When the user says "Upload this image to Google Drive" or similar:
      
      STEP 1: Find the media in the conversation history - check BOTH generated and attached media
      
      FOR GENERATED MEDIA:
      - Look for messages with content parts of type: 'generated_image', 'generated_video', or 'generated_3d_model'
      - These will have URLs in fields like: generated_images array, video_url, or model_url
      - For generated_image: Look for content.generated_images[0] (array of URLs)
      - For generated_video: Look for content.video_url or content.generated_videos[0]
      - For generated_3d_model: Look for content.model_url
      
      FOR ATTACHED MEDIA:
      - Look for user messages with image attachments
      - These appear as message content arrays with image_url parts
      - The system will automatically provide the correct image URL during tool execution
      - DO NOT generate placeholder URLs like "https://supabase.co/storage/v1/object/public/chat-images/abc123.png"
      
      STEP 2: Extract the actual URL
      - The URL will be a Supabase storage URL like: https://...supabase.co/storage/v1/object/public/chat-images/...
      - DO NOT use placeholder text like "[Generated Image]" or descriptions
      - Extract the ACTUAL URL string from the content part
      
      STEP 3: Call google_drive_upload_file with EXACTLY these parameters:
      {
        "instructions": "Upload [type] to Google Drive",
        "file": "[THE ACTUAL URL YOU EXTRACTED OR LEAVE EMPTY FOR ATTACHED IMAGES]",
        "new_name": "descriptive-name.ext"
      }
      
      CRITICAL REMINDERS FOR ATTACHED IMAGES:
      - If the user attached an image (not generated), DO NOT provide a fake URL in the 'file' parameter
      - For attached images, provide minimal parameters: {"instructions": "Upload image to Google Drive", "new_name": "image.png"}
      - The system will automatically inject the correct image URL during tool execution
      - NEVER generate placeholder URLs like "https://supabase.co/storage/v1/object/public/chat-images/abc123.png"
      
      CRITICAL REMINDERS FOR GENERATED MEDIA:
      - file MUST be the actual URL (starts with https://)
      - If you see multiple images, use the first one or ask which to upload
      - Common URL patterns:
        * Images: https://...supabase.co/storage/v1/object/public/chat-images/[id].png
        * Videos: https://...supabase.co/storage/v1/object/public/chat-videos/[id].mp4
        * 3D Models: https://...supabase.co/storage/v1/object/public/3d-models/[id].glb
      
      Example of CORRECT extraction from conversation:
      User: "Generate an image of a sunset"
      Assistant: [Shows generated image with URL https://...supabase.co/storage/v1/object/public/chat-images/abc123.png]
      User: "Upload this image to Google Drive"
      
      Your tool call MUST include:
      {
        "instructions": "Upload the sunset image to Google Drive",
        "file_url": "https://...supabase.co/storage/v1/object/public/chat-images/abc123.png",
        "filename": "sunset-image.png"
      }`
    };

    // Convert messages to AI SDK compatible format
    const convertedMessages = originalMessages.map(msg => {
      // If the message has custom content types, convert them to text
      if (Array.isArray(msg.content)) {
        console.log('API ROUTE: Converting message with array content, parts:', msg.content.length);
        const convertedParts = msg.content.map((part: any) => {
          if (part.type === 'image_url') {
            // 🔧 FIX: Keep image_url parts as-is for vision models to actually SEE the image!
            // Previously this was converting to text like "[Uploaded Image: URL]" which meant
            // the AI couldn't actually analyze the image - it would just hallucinate.
            const imageUrl = part.image_url?.url;
            console.log('API ROUTE: Preserving image_url content part for vision model:', imageUrl ? 'has URL' : 'no URL');
            // Return the part as-is so vision models can process the image
            return part;
          } else if (part.type === 'generated_image') {
            // Convert generated_image to text representation
            const urls = part.generated_images || [];
            // Distinguish between generated and attached images
            const imageLabel = part.isAttachedImage ? 'Attached Image' : 'Generated Image';
            const urlText = urls.length > 0 ? `[${imageLabel}: ${urls[0]}]` : `[${imageLabel}]`;
            console.log('API ROUTE: Converting generated image content part to text:', imageLabel, urls.length > 0 ? 'with URL' : 'no URL');
            return {
              type: 'text',
              text: urlText
            };
          } else if (part.type === 'generated_video') {
            const url = part.video_url || (part.generated_videos && part.generated_videos[0]);
            const urlText = url ? `[Generated Video: ${url}]` : '[Generated Video]';
            return {
              type: 'text',
              text: urlText
            };
          } else if (part.type === 'generated_3d_model') {
            const url = part.model_url;
            const urlText = url ? `[Generated 3D Model: ${url}]` : '[Generated 3D Model]';
            return {
              type: 'text',
              text: urlText
            };
          }
          // Keep other content types as-is
          return part;
        });

        return {
          ...msg,
          content: convertedParts
        };
      }

      return msg;
    });

    // Prepend the system messages to the original message history
    // IMPORTANT: Identity prompt MUST come FIRST to establish the AI's persona
    const systemContextMessage: ExtendedMessage = {
      id: 'system-context-prompt',
      role: 'system',
      content: enhancedSystemPrompt,
    };

    // Removed pricingToolNudge - relying on unified RAG pipeline with workspace isolation

    const messagesForModelExtended: ExtendedMessage[] = [
      systemContextMessage,
      formattingSystemMessage,
      toolUsagePriorityMessage,
      ctaSystemMessage,
      documentReferenceSystemMessage,
      toolResultSummarySystemMessage,
      gmailGeneralSystemMessage,
      gmailAttachmentSystemMessage,
      mediaUploadSystemMessage,
      ...convertedMessages,
    ];

    const messagesForModel = messagesForModelExtended.map(toMessage);

    // Log all system messages for WhatsApp debugging
    // console.log('\n[WHATSAPP ENHANCED DEBUG] All System Messages:');
    // messagesForModel.filter(m => m.role === 'system').forEach((msg, index) => {
    //   console.log(`[WHATSAPP ENHANCED DEBUG] System Message ${index + 1} (id: ${msg.id || 'no-id'}):`);
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Content preview:`, msg.content.substring(0, 200));
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Contains "Marcial":`, msg.content.includes('Marcial'));
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Contains "medical":`, msg.content.toLowerCase().includes('medical'));
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Contains "WhatsApp":`, msg.content.includes('WhatsApp'));
    // });
    // console.log('\n');

    // Also check for system messages in converted messages (from chat history)
    // console.log('[WHATSAPP ENHANCED DEBUG] Checking convertedMessages for system messages:');
    // convertedMessages.filter(m => m.role === 'system').forEach((msg, index) => {
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Found system message in history ${index + 1}:`);
    //   console.log(`[WHATSAPP ENHANCED DEBUG] Content:`, msg.content);
    // });
    // console.log('[WHATSAPP ENHANCED DEBUG] Total messages:', messagesForModel.length);
    // console.log('[WHATSAPP ENHANCED DEBUG] System messages count:', messagesForModel.filter(m => m.role === 'system').length);

    // Check AI provider API key validity
    console.log(`API ROUTE: Checking ${AI_PROVIDER} API key...`);
    const apiKeyCheck = await testOpenRouterConnection();
    console.log(`API ROUTE: ${AI_PROVIDER} API key check result:`, apiKeyCheck);

    if (!apiKeyCheck.valid) {
      console.error('API ROUTE: OPENROUTER_API_KEY validation failed:', apiKeyCheck.reason);

      // Return different messages based on the specific error
      let errorMessage = "I'm sorry, but the AI service is not properly configured. ";

      switch (apiKeyCheck.reason) {
        case 'MISSING_KEY':
          errorMessage += "The OpenRouter API key is missing. Please add it to your environment variables.";
          break;
        case 'INVALID_FORMAT':
          errorMessage += "The OpenRouter API key format is invalid. It should start with 'sk-or-' followed by alphanumeric characters.";
          break;
        case 'TEST_ERROR':
          errorMessage += `An error occurred while testing the API connection: ${apiKeyCheck.message}`;
          break;
        default:
          errorMessage += "Please check the OpenRouter API key in the environment variables.";
      }

      console.log('API ROUTE: Returning error response:', errorMessage);
      return createErrorResponse(errorMessage);
    }

    console.log('API ROUTE: Starting streamText call');

    // 🕐 START TIMING: AI generation
    const aiStartTime = Date.now();
    console.log(`[⏱️ AI TIMING] Starting optimized RAG AI generation with model: ${modelWithWebSearch}`);

    try {
      console.log('API ROUTE: Starting streamText call');
      console.log('API ROUTE: Provider init check:', !!openrouterProvider);
      console.log('API ROUTE: Model being used:', modelWithWebSearch);

      // Verify the modelId is valid - provide a fallback if needed
      const safeModelId = modelWithWebSearch || 'openai/gpt-4o-mini';

      // Get the provider function based on configuration
      let modelProvider;


      if (AI_PROVIDER === 'openai') {
        // Use OpenAI provider directly without the openai/ prefix
        const openaiModelId = safeModelId.replace('openai/', '').replace(':online', '');
        console.log('API ROUTE: Using OpenAI provider with model:', openaiModelId);
        modelProvider = openai(openaiModelId);
      } else if (AI_PROVIDER === 'groq') {
        // Use Groq provider
        // Strip 'groq/' prefix if present, as the Groq SDK expects just the model ID
        const groqModelId = safeModelId.replace(/^groq\//, '');
        console.log('API ROUTE: Using Groq provider with model:', groqModelId);

        const groq = createOpenAI({
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey: env.GROQ_API_KEY || '',
        });

        modelProvider = groq(groqModelId);
      } else {
        // Use OpenRouter provider
        console.log('API ROUTE: Using OpenRouter provider with model:', safeModelId);
        modelProvider = openrouterProvider(safeModelId);
      }

      if (!modelProvider) {
        console.error('API ROUTE: Failed to get model provider from OpenRouter');
        return createErrorResponse("I'm having trouble connecting to the AI service. The model provider could not be initialized.");
      }

      console.log('API ROUTE: Model provider initialized successfully');
      console.log('API ROUTE: Used documents for context:', usedDocuments.map(d => ({ id: d.id, name: d.name })));

      const extractedSources: string[] = [];
      const aiResponseText = '';

      // Prepare base application tools for AI SDK
      // Note: Specialized content tools removed - using unified RAG pipeline with workspace isolation
      const baseTools: Record<string, any> = {
        useDocument: documentReferenceTool
      };

      // Initialize MCP client if requested, only for tool discovery (NOT execution)
      let allTools: Record<string, any> = { ...baseTools };
      if (useMcpForRequest) {
        console.log('API ROUTE: Initializing MCP clients for tool discovery from ALL servers...');

        // ⚡ PERFORMANCE OPTIMIZATION: Check cache first
        const cacheKey = `mcp-tools-${queryClassification.category}`;
        const cachedToolData = getCachedTools(cacheKey);

        if (cachedToolData) {
          console.log('API ROUTE: ⚡ USING CACHED MCP TOOLS - cache age:', Date.now() - cachedToolData.timestamp, 'ms');

          // Use cached enhanced tools directly
          const approvalRequiredTools: Record<string, any> = {};
          Object.entries(cachedToolData.tools).forEach(([toolName, enhancedTool]: [string, any]) => {
            approvalRequiredTools[toolName] = tool({
              description: enhancedTool.description,
              inputSchema: enhancedTool.parameters || z.object({}),
              execute: async (params: any, meta?: any) => {
                console.log(`[CACHED TOOL] ${toolName} called with params:`, params);
                console.log(`[CACHED TOOL] Meta:`, meta);
                console.log(`[CACHED TOOL] Meta type:`, typeof meta);
                console.log(`[CACHED TOOL] Meta keys:`, meta ? Object.keys(meta) : 'meta is undefined');

                // Get toolCallId from meta - check different possible structures
                let toolCallId = meta?.toolCallId || meta?.id || '';

                // Log what we extracted
                console.log(`[CACHED TOOL] Extracted toolCallId: "${toolCallId}" from meta`);

                // If no toolCallId found, generate one
                if (!toolCallId) {
                  toolCallId = `cached-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                  console.log(`[CACHED TOOL] Generated toolCallId: ${toolCallId}`);
                }

                // Check if YOLO mode is enabled
                const yoloModeEnabled = env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true';
                console.log(`[CACHED TOOL] YOLO mode enabled: ${yoloModeEnabled}`);

                if (yoloModeEnabled) {
                  // Auto-approve and execute immediately
                  console.log(`[CACHED TOOL] Auto-approving tool ${toolName} due to YOLO mode`);

                  // Create tool execution state with 'running' status
                  if (sessionId) {
                    await ToolExecutionStateService.upsert({
                      chat_id: sessionId,
                      message_id: messagesForModel.length,
                      tool_call_id: toolCallId,
                      tool_name: toolName,
                      tool_params: params,
                      status: 'running'
                    });
                  }

                  try {
                    // Get universal client and execute the tool
                    const universalClient = UniversalMcpClient.getInstance();
                    const result = await universalClient.executeAnyTool(toolName, params);

                    // Update to completed status
                    if (sessionId) {
                      await ToolExecutionStateService.markCompleted(toolCallId, result);
                    }

                    return result;
                  } catch (error) {
                    // Update to error status
                    if (sessionId) {
                      await ToolExecutionStateService.markError(toolCallId, error instanceof Error ? error.message : 'Unknown error');
                    }
                    throw error;
                  }
                } else {
                  // Throw an error with proper metadata for approval UI
                  const approvalError = new Error('This tool requires explicit user approval before execution.');
                  // Add properties to the error object that will be used by the error handler
                  Object.assign(approvalError, {
                    toolCallId: toolCallId,
                    toolName: toolName,
                    toolArgs: params
                  });
                  throw approvalError;
                }
              }
            });
          });

          Object.assign(allTools, approvalRequiredTools);
          console.log('API ROUTE: ⚡ CACHED TOOLS LOADED:', Object.keys(approvalRequiredTools).length);
        } else {
          console.log('API ROUTE: Cache miss, initializing MCP tools from scratch...');

          try {
            // 🔧 FIX: Use UniversalMcpClient for proper Zapier support
            const { UniversalMcpClient } = await import('@/lib/mcp/universal-client');
            const universalClient = UniversalMcpClient.getInstance();

            console.log('API ROUTE: Using UniversalMcpClient for MCP discovery...');

            // Discover all tools from all servers
            const discoveredTools = await universalClient.discoverAllTools();
            console.log(`API ROUTE: UniversalMcpClient discovered ${discoveredTools.length} tools from all servers`);

            // Convert discovered tools to AI SDK format
            const allMcpTools: ToolSet = {};
            for (const mcpTool of discoveredTools) {
              // Create a tool that wraps the MCP tool execution
              const toolDefinition = await universalClient.getToolSchema(mcpTool.name);
              if (toolDefinition) {
                allMcpTools[mcpTool.name] = {
                  description: toolDefinition.description,
                  inputSchema: toolDefinition.inputSchema,
                  execute: async (params: any, meta?: any) => {
                    console.log(`[MCP TOOL] ${mcpTool.name} called with params:`, params);
                    console.log(`[MCP TOOL] Meta:`, meta);
                    console.log(`[MCP TOOL] Meta type:`, typeof meta);
                    console.log(`[MCP TOOL] Meta keys:`, meta ? Object.keys(meta) : 'meta is undefined');

                    // Get toolCallId from meta - check different possible structures
                    let toolCallId = meta?.toolCallId || meta?.id || '';

                    // Log what we extracted
                    console.log(`[MCP TOOL] Extracted toolCallId: "${toolCallId}" from meta`);

                    // If no toolCallId found, generate one
                    if (!toolCallId) {
                      toolCallId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                      console.log(`[MCP TOOL] Generated toolCallId: ${toolCallId}`);
                    }

                    // Check if YOLO mode is enabled
                    const yoloModeEnabled = env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true';
                    console.log(`[MCP TOOL] YOLO mode enabled: ${yoloModeEnabled}`);

                    if (yoloModeEnabled) {
                      // Auto-approve and execute immediately
                      console.log(`[MCP TOOL] Auto-approving tool ${mcpTool.name} due to YOLO mode`);

                      // Create tool execution state with 'running' status
                      if (sessionId) {
                        await ToolExecutionStateService.upsert({
                          chat_id: sessionId,
                          message_id: messagesForModel.length,
                          tool_call_id: toolCallId,
                          tool_name: mcpTool.name,
                          tool_params: params,
                          status: 'running'
                        });
                      }

                      try {
                        // Execute the tool directly
                        const result = await universalClient.executeAnyTool(mcpTool.name, params);

                        // Update to completed status
                        if (sessionId) {
                          await ToolExecutionStateService.markCompleted(toolCallId, result);
                        }

                        return result;
                      } catch (error) {
                        // Update to error status
                        if (sessionId) {
                          await ToolExecutionStateService.markError(toolCallId, error instanceof Error ? error.message : 'Unknown error');
                        }
                        throw error;
                      }
                    } else {
                      // Throw an error with proper metadata for approval UI
                      const approvalError = new Error('This tool requires explicit user approval before execution.');
                      // Add properties to the error object that will be used by the error handler
                      Object.assign(approvalError, {
                        toolCallId: toolCallId,
                        toolName: mcpTool.name,
                        toolArgs: params
                      });
                      throw approvalError;
                    }
                  }
                };
              }
            }

            // Store universal client for execution
            if (!persistentMcpClient) {
              persistentMcpClient = universalClient;
              (globalThis as any).persistentMcpClient = universalClient;
            }

            console.log(`API ROUTE: Aggregated ${Object.keys(allMcpTools).length} total tools from all servers:`, Object.keys(allMcpTools));

            // Use aggregated tools instead of single endpoint tools
            const mcpTools = allMcpTools;

            // Persistent client is already set in the loop above

            // 🚀 INITIALIZE UNIVERSAL MCP TOOLING SYSTEM
            console.log(`[Universal MCP] ===== INITIALIZING UNIVERSAL MCP TOOLING SYSTEM =====`);

            // Get user query for intelligent routing
            const lastUserMsg = messagesForModelExtended.filter(m => m.role === 'user').pop();
            const userQuery = lastUserMsg?.content || '';
            console.log(`[Universal MCP] Processing user query: "${userQuery}"`);

            // Extract recent conversation messages for context-aware tool selection
            // Filter out system messages and keep only user/assistant messages
            const recentConversation = messagesForModelExtended
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .slice(-10); // Last 10 messages for context

            console.log(`[Universal MCP] Passing ${recentConversation.length} recent messages for context-aware tool selection`);

            // Import and use the production router
            const { productionMcpRouter } = await import('@/lib/mcp/production-router');

            // Get enhanced tools through production router with conversation context
            console.log(`[Universal MCP] Getting enhanced tools through production router with context...`);
            const mcpResult = await productionMcpRouter.getEnhancedMcpTools(userQuery, allMcpTools, recentConversation, sessionId);
            const enhancedMcpTools = mcpResult.tools;

            console.log(`[Universal MCP] Production router selected ${Object.keys(enhancedMcpTools).length} tools for query`);
            console.log(`[Universal MCP] Selected tools:`, Object.keys(enhancedMcpTools));
            console.log(`[Universal MCP] Server health:`, mcpResult.serverHealth);
            console.log(`[Universal MCP] Routing decision confidence:`, mcpResult.routingDecisions[0]?.confidence || 0);

            // Store tools in global cache for approval route
            const global_cache = globalThis as any;
            if (!global_cache.mcpToolsCache) {
              global_cache.mcpToolsCache = new Map<string, { tools: any[], timestamp: number }>();
            }

            if (sessionId) {
              const toolsArray = Object.entries(enhancedMcpTools).map(([name, tool]) => ({
                name,
                ...tool
              }));

              global_cache.mcpToolsCache.set(sessionId, { tools: toolsArray, timestamp: Date.now() });
              console.log(`[Universal MCP] ===== TOOL CACHE STORAGE =====`);
              console.log(`[Universal MCP] Session ID: ${sessionId}`);
              console.log(`[Universal MCP] Stored ${toolsArray.length} tools: ${toolsArray.map(t => t.name).join(', ')}`);
              console.log(`[Universal MCP] Global cache sessions: ${Array.from(global_cache.mcpToolsCache.keys()).join(', ')}`);
              console.log(`[Universal MCP] Global cache size: ${global_cache.mcpToolsCache.size}`);
              console.log(`[Universal MCP] =============================`);
            } else {
              console.log(`[Universal MCP] WARNING: No sessionId provided, cannot cache tools!`);
            }

            console.log(`[Universal MCP] ===== UNIVERSAL MCP TOOLING SYSTEM READY =====`);

            // Create wrapper "stub" tools that require explicit approval before executing
            const approvalRequiredTools: Record<string, any> = {};

            // Log enhanced tools for debugging
            console.log(`[Universal MCP] Enhanced tools count: ${Object.keys(enhancedMcpTools).length}`);
            console.log(`[Universal MCP] Enhanced tools list:`, Object.keys(enhancedMcpTools));

            // For each enhanced MCP tool, create a stub that just records the call without executing
            Object.entries(enhancedMcpTools).forEach(([toolName, enhancedTool]) => {
              console.log(`[Universal MCP] Creating approval-required stub for tool: ${toolName}`);

              // Debug logging for tool (removed file system logging due to errors)

              // Use the enhanced tool's existing parameters and description (already processed by universal router)
              const zodSchema = enhancedTool.parameters || z.object({});
              const enhancedDescription = enhancedTool.description || `Execute ${toolName}`;

              console.log(`[Universal Router] Using enhanced tool: ${toolName}`, {
                description: enhancedDescription.substring(0, 100) + '...',
                hasParameters: !!zodSchema
              });

              // Create a stub version using tool() helper
              approvalRequiredTools[toolName] = tool({
                description: enhancedDescription,
                inputSchema: zodSchema,
                execute: async (params: any, meta?: any) => {
                  console.log(`[PARAM DEBUG] STUB EXECUTED: Tool ${toolName} called with params:`, params);
                  console.log(`[PARAM DEBUG] STUB EXECUTED: typeof params:`, typeof params);
                  console.log(`[PARAM DEBUG] STUB EXECUTED: Object.keys(params):`, Object.keys(params || {}));

                  // Get the user query for parameter transformation
                  const lastUserMsg = messagesForModelExtended.filter(m => m.role === 'user').pop();
                  const userQuery = typeof lastUserMsg?.content === 'string'
                    ? lastUserMsg.content
                    : JSON.stringify(lastUserMsg?.content ?? '');

                  // 🔧 FIX 2: Parameter Extraction Fallback
                  let transformedParams = params;

                  // If params are empty, try to extract from user query
                  if (!params || Object.keys(params).length === 0) {
                    console.log(`[PARAM EXTRACTION] Empty params detected for ${toolName}, attempting extraction from user query`);

                    // For image generation tools, extract image description
                    if (toolName.includes('create_image') || toolName.includes('image')) {
                      transformedParams = extractImagePromptFromQuery(userQuery);
                      console.log(`[PARAM EXTRACTION] Extracted image params:`, transformedParams);
                    }
                    // Add more extraction patterns for other tool types as needed
                  } else {
                    // Transform parameters if this is a calendar tool
                    if (toolName.includes('calendar') && toolName.includes('find_event')) {
                      console.log('API ROUTE: Applying calendar parameter transformation...');
                      transformedParams = transformCalendarParameters(toolName, params, userQuery);
                    }
                    // Transform parameters for Google Drive upload tools
                    else if ((toolName.includes('google_drive') && toolName.includes('upload')) ||
                      toolName === 'google_drive_upload_file') {
                      console.log('API ROUTE: Applying media extraction for Google Drive upload...');
                      transformedParams = extractMediaFromConversation(toolName, params, originalMessages);
                    }
                    // Transform parameters for Gmail tools with attachments
                    else if (toolName.includes('gmail_') && params) {
                      console.log('API ROUTE: Checking for Gmail attachment parameters...');

                      const attachmentUrl = params.attachment_url || params.file_url ||
                        params.media_url || params.image_url ||
                        params.video_url || params.attachment;

                      if (attachmentUrl || userQuery.toLowerCase().includes('attach')) {
                        console.log('API ROUTE: Gmail tool with potential attachment detected');
                        transformedParams = extractMediaForGmailAttachment(toolName, params, originalMessages);
                      }
                    }
                  }

                  console.log(`API ROUTE: Approval Required - Tool ${toolName} called. Final params:`, transformedParams);

                  // Debug logging for meta parameter
                  console.log(`[STUB TOOL] ${toolName} called with params:`, params);
                  console.log(`[STUB TOOL] Meta:`, meta);
                  console.log(`[STUB TOOL] Meta type:`, typeof meta);
                  console.log(`[STUB TOOL] Meta keys:`, meta ? Object.keys(meta) : 'meta is undefined');

                  // Store this call in the approval state for later execution when approved
                  let toolCallId = meta?.toolCallId || meta?.id || '';

                  // Log what we extracted
                  console.log(`[STUB TOOL] Extracted toolCallId: "${toolCallId}" from meta`);

                  // If no toolCallId found, generate one
                  if (!toolCallId) {
                    toolCallId = `pending-${Date.now()}`;
                    console.log(`[STUB TOOL] Generated toolCallId: ${toolCallId}`);
                  }

                  // Add sessionId to meta for tool persistence
                  const enhancedMeta = {
                    ...meta,
                    sessionId: sessionId // Add the session ID to metadata
                  };

                  // Update the global approval state, not just the local variable
                  (globalThis as any).toolApprovalState[toolCallId] = {
                    approved: false,
                    executed: false, // Add execution tracking flag
                    toolCall: {
                      name: toolName,
                      params: transformedParams, // Use transformed parameters
                      meta: enhancedMeta
                    },
                    result: null
                  };

                  // 🎯 CRITICAL DEBUG: Log parameter storage
                  console.log(`[PARAM DEBUG] Tool ${toolName} invoked with params:`, transformedParams);
                  console.log(`[PARAM DEBUG] Global state keys:`, Object.keys((globalThis as any).toolApprovalState));
                  console.log(`[PARAM DEBUG] Stored approval state:`, (globalThis as any).toolApprovalState[toolCallId]);

                  // Check if YOLO mode is enabled
                  const yoloModeEnabled = env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true';
                  console.log(`[ENHANCED TOOL] YOLO mode enabled: ${yoloModeEnabled}`);

                  if (yoloModeEnabled) {
                    // Auto-approve and execute immediately
                    console.log(`[ENHANCED TOOL] Auto-approving tool ${toolName} due to YOLO mode`);

                    // Use the existing toolCallId from meta
                    const actualToolCallId = toolCallId;

                    // Create tool execution state with 'running' status
                    if (sessionId) {
                      await ToolExecutionStateService.upsert({
                        chat_id: sessionId,
                        message_id: messagesForModel.length,
                        tool_call_id: actualToolCallId,
                        tool_name: toolName,
                        tool_params: transformedParams,
                        status: 'running'
                      });
                    }

                    try {
                      // Get universal client and execute the tool
                      const universalClient = UniversalMcpClient.getInstance();
                      const result = await universalClient.executeAnyTool(toolName, transformedParams);

                      // Update to completed status
                      if (sessionId) {
                        await ToolExecutionStateService.markCompleted(actualToolCallId, result);
                      }

                      return result;
                    } catch (error) {
                      // Update to error status
                      if (sessionId) {
                        await ToolExecutionStateService.markError(actualToolCallId, error instanceof Error ? error.message : 'Unknown error');
                      }
                      throw error;
                    }
                  } else {
                    // Throw the specific error that the stream handler expects
                    const approvalError = new Error(`This tool requires explicit user approval before execution. Please ask the user to approve this action.`);
                    // Add properties to the error object that will be used by the error handler
                    Object.assign(approvalError, {
                      toolCallId: toolCallId,
                      toolName: toolName,
                      toolArgs: transformedParams // Use transformed parameters in error too
                    });
                    throw approvalError;
                  }
                }
              });
            });

            // Combine base tools with the approval-required MCP tools
            allTools = { ...baseTools, ...approvalRequiredTools };

            // ⚡ PERFORMANCE OPTIMIZATION: Cache the enhanced tools for future requests
            const toolsToCache: Record<string, any> = {};
            Object.entries(enhancedMcpTools).forEach(([toolName, enhancedTool]) => {
              toolsToCache[toolName] = {
                description: enhancedTool.description,
                inputSchema: enhancedTool.parameters
              };
            });

            setCachedTools(toolsToCache, mcpResult.serverHealth, cacheKey);
            console.log('API ROUTE: ⚡ CACHED ENHANCED TOOLS for future requests:', Object.keys(toolsToCache).length);

            // 🔍 PHASE 2: Verify AI Tool Definition Reception
            console.log('API ROUTE: Created approval-required stubs for all MCP tools');
            Object.entries(approvalRequiredTools).forEach(([toolName, tool]) => {
              console.log(`[AI TOOLS DEBUG] Tool ${toolName} definition:`, {
                description: tool.description?.substring(0, 100) + '...',
                inputSchema: tool.parameters,
                hasExecute: typeof tool.execute === 'function'
              });

              // Special focus on create_image tool for testing
              if (toolName === 'create_image') {
                console.log(`[AI TOOLS DEBUG] SPECIAL FOCUS - create_image tool:`, {
                  fullDescription: tool.description,
                  parameterShape: tool.parameters.shape || 'No shape',
                  parameterKeys: Object.keys(tool.parameters.shape || {}),
                  zodDef: tool.parameters._def
                });
              }
            });
          } catch (mcpError) {
            console.error('API ROUTE: Error creating temporary MCP client for discovery:', mcpError);
            // Continue with base tools only
          }
        }
      }

      // 🔍 CRITICAL DEBUG: Log what messages are being sent to the AI
      console.log(`[PARAM DEBUG] Messages being sent to AI model:`, messagesForModelExtended.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.substring(0, 200) + '...' : '[non-string content]'
      })));
      // (Tool logging moved to after web search addition)

      // Add web search tool if web search is enabled (works with any provider)
      if (webSearchEnabled) {
        console.log('API ROUTE: Adding web search tool');

        // Import Exa dynamically to avoid loading it when not needed
        const Exa = (await import('exa-js')).default;
        const exaApiKey = env.EXA_API_KEY;

        if (!exaApiKey) {
          console.warn('API ROUTE: Web search enabled but EXA_API_KEY not found in environment');
        } else {
          const exa = new Exa(exaApiKey);

          allTools['webSearch'] = tool({
            description: 'Search the web for up-to-date information. Use this when you need current information about events, news, or facts that may have occurred after your training data.',
            inputSchema: z.object({
              query: z.string().min(1).max(100).describe('The search query to find information on the web'),
            }),
            execute: async ({ query }) => {
              console.log('API ROUTE: Web search tool called with Exa, query:', query);

              try {
                const { results } = await exa.searchAndContents(query, {
                  livecrawl: 'always',
                  numResults: 3,
                });

                console.log(`API ROUTE: Exa search returned ${results.length} results`);

                return results.map(result => ({
                  title: result.title,
                  url: result.url,
                  content: result.text?.slice(0, 1000), // Take just the first 1000 characters
                  publishedDate: result.publishedDate,
                }));
              } catch (error) {
                console.error('API ROUTE: Exa search error:', error);
                throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            },
          });

          console.log('API ROUTE: Web search tool added successfully with Exa');
        }
      }

      // 🚨 CRITICAL: Log detailed tool information for AI model debugging (MOVED HERE)
      console.log(`[PARAM DEBUG] Available tools being sent to AI:`, Object.keys(allTools));
      console.log('🔍 [AI TOOL DEBUG] ===== DETAILED TOOL ANALYSIS =====');
      console.log('🔍 [AI TOOL DEBUG] Total tools count:', Object.keys(allTools).length);

      Object.entries(allTools).forEach(([toolName, tool]) => {
        console.log(`🔍 [AI TOOL DEBUG] Tool: ${toolName}`);
        console.log(`🔍 [AI TOOL DEBUG]   Description: ${tool.description?.substring(0, 100)}...`);
        console.log(`🔍 [AI TOOL DEBUG]   Has parameters: ${!!tool.parameters}`);
        console.log(`🔍 [AI TOOL DEBUG]   Has execute: ${typeof tool.execute === 'function'}`);
        console.log(`🔍 [AI TOOL DEBUG]   Tool type: ${typeof tool}`);
      });
      console.log('🔍 [AI TOOL DEBUG] =====================================');

      // Log the messages being sent to the AI model for debugging
      console.log('API ROUTE: Messages being sent to AI model:');
      console.log('API ROUTE: Total messages:', messagesForModelExtended.length);
      console.log('API ROUTE: ✅ Identity prompt is now FIRST to establish AI persona');
      messagesForModelExtended.forEach((msg, index) => {
        const messageType = index === 0 ? ' (IDENTITY - AI PERSONA)' :
          msg.id === 'system-format-instruction' ? ' (formatting)' :
            msg.id === 'system-tool-priority-instruction' ? ' (tools)' :
              msg.id === 'system-cta-instruction' ? ' (call-to-action)' :
                msg.id === 'system-docref-instruction' ? ' (doc references)' : '';
        console.log(`API ROUTE: Message ${index + 1}${messageType}:`, {
          role: msg.role,
          id: msg.id || 'no-id',
          contentPreview: typeof msg.content === 'string' ? msg.content.substring(0, 200) + '...' : 'non-string content'
        });
      });

      // Log specifically the system prompts
      const systemMessagesForLogging = messagesForModelExtended.filter(msg => msg.role === 'system');
      console.log('API ROUTE: System messages count:', systemMessagesForLogging.length);
      systemMessagesForLogging.forEach((msg, index) => {
        console.log(`API ROUTE: System message ${index + 1}:`, {
          id: msg.id || 'no-id',
          contentLength: typeof msg.content === 'string' ? msg.content.length : 0,
          contentPreview: typeof msg.content === 'string' ? msg.content.substring(0, 300) + '...' : 'non-string content'
        });
      });

      // Helper function to determine appropriate token limits for different models
      function getMaxTokensForModel(modelId: string): number {
        // Check for environment variable override
        if (env.MAX_COMPLETION_TOKENS) {
          const envLimit = parseInt(env.MAX_COMPLETION_TOKENS);
          if (!isNaN(envLimit) && envLimit > 0) {
            console.log('API ROUTE: Using MAX_COMPLETION_TOKENS from env:', envLimit);
            return envLimit;
          }
        }

        // Specific limits for Claude 4 models (newer generation with higher capacity)
        if (modelId.includes('claude-sonnet-4') || modelId.includes('claude-4-sonnet')) {
          console.log('API ROUTE: Using Claude Sonnet 4 token limit: 16384');
          return 16384; // Conservative but sufficient for most responses (actual max is 64K)
        }
        if (modelId.includes('claude-opus-4') || modelId.includes('claude-4-opus')) {
          console.log('API ROUTE: Using Claude Opus 4 token limit: 16384');
          return 16384; // Conservative limit for Opus 4 (actual max is 32K)
        }

        // Specific limits for Claude 3.7/3.8 models
        if (modelId.includes('claude-3.7') || modelId.includes('claude-3.8')) {
          console.log('API ROUTE: Using Claude 3.7/3.8 token limit: 8192');
          return 8192; // Higher limit for newer Claude 3 models
        }

        // Default for other Claude/Anthropic models
        if (modelId.includes('claude') || modelId.includes('anthropic')) {
          console.log('API ROUTE: Using default Claude model token limit: 4096');
          return 4096; // Safe limit for older Claude models
        }

        // GPT models
        if (modelId.includes('gpt-5-mini')) {
          console.log('API ROUTE: Using GPT-5-mini token limit: 8192');
          return 8192; // Higher limit for cheaper model
        }
        if (modelId.includes('gpt-5')) {
          console.log('API ROUTE: Using GPT-5 token limit: 4096');
          return 4096; // Conservative default
        }
        if (modelId.includes('gpt-4.1-mini')) {
          console.log('API ROUTE: Using GPT-4.1-mini token limit: 8192');
          return 8192; // Higher limit for cheaper model
        }
        if (modelId.includes('gpt-4.1')) {
          console.log('API ROUTE: Using GPT-4.1 token limit: 4096');
          return 4096; // Standard limit
        }

        // Llama models
        if (modelId.includes('llama')) {
          console.log('API ROUTE: Using Llama model token limit: 4096');
          return 4096; // Standard limit for Llama
        }

        // Default for unknown models
        console.log('API ROUTE: Using default token limit: 4096');
        return 4096;
      }

      // Debug logging for WhatsApp issue
      // console.log('[WHATSAPP DEBUG] ===== FULL PROMPT ANALYSIS =====');
      // console.log('[WHATSAPP DEBUG] Is WhatsApp request:', isWhatsApp);
      // console.log('[WHATSAPP DEBUG] Number of messages:', messagesForModel.length);
      // console.log('[WHATSAPP DEBUG] Message roles:', messagesForModel.map(m => m.role));

      // Log system messages
      const whatsappSystemMessages = messagesForModelExtended.filter(m => m.role === 'system');
      // console.log('[WHATSAPP DEBUG] System messages count:', whatsappSystemMessages.length);
      // whatsappSystemMessages.forEach((msg, idx) => {
      //   console.log(`[WHATSAPP DEBUG] System message ${idx + 1}:`, {
      //     id: msg.id || 'no-id',
      //     contentLength: typeof msg.content === 'string' ? msg.content.length : 'not-string',
      //     preview: typeof msg.content === 'string' ? msg.content.substring(0, 200) : 'not-string-content'
      //   });
      // });

      // Find and log the main system prompt
      const mainSystemPrompt = messagesForModelExtended.find(m => m.id === 'system-context-prompt');
      // if (mainSystemPrompt && typeof mainSystemPrompt.content === 'string') {
      //   console.log('[WHATSAPP DEBUG] Main system prompt found:', {
      //     length: mainSystemPrompt.content.length,
      //     containsWhatsApp: mainSystemPrompt.content.includes('WhatsApp'),
      //     containsMarcial: mainSystemPrompt.content.includes('Marcial'),
      //     containsAcademic: mainSystemPrompt.content.includes('academic'),
      //     first500Chars: mainSystemPrompt.content.substring(0, 500)
      //   });
      // } else {
      //   console.log('[WHATSAPP DEBUG] Main system prompt NOT found or not string!');
      // }

      // Log RAG context if any
      const ragContext = context || 'No RAG context';
      // console.log('[WHATSAPP DEBUG] RAG context:', {
      //   length: ragContext.length,
      //   preview: ragContext.substring(0, 200),
      //   containsMarcial: ragContext.includes('Marcial')
      // });

      // Log the exact messages being sent to the AI model
      // console.log('\n[WHATSAPP FINAL DEBUG] Messages being sent to AI:');
      // console.log('[WHATSAPP FINAL DEBUG] Total messages:', messagesForModel.length);
      // console.log('[WHATSAPP FINAL DEBUG] Message breakdown:');
      // messagesForModel.forEach((msg, index) => {
      //   if (msg.role === 'system' && msg.id === 'system-context-prompt') {
      //     console.log(`[WHATSAPP FINAL DEBUG] Message ${index}: ${msg.role} (${msg.id || 'no-id'}) - MAIN SYSTEM PROMPT`);
      //     console.log('[WHATSAPP FINAL DEBUG] Full main system prompt:', msg.content);
      //   } else {
      //     console.log(`[WHATSAPP FINAL DEBUG] Message ${index}: ${msg.role} (${msg.id || 'no-id'}) - ${typeof msg.content === 'string' ? msg.content.substring(0, 100) + '...' : 'non-string content'}`);
      //   }
      // });
      // console.log('\n');

      // Extract reasoning configuration from request
      const reasoningSettings = data?.settings?.reasoning;
      console.log(`API ROUTE: [REASONING DEBUG] Model: ${safeModelId}`);
      console.log(`API ROUTE: [REASONING DEBUG] User reasoning settings:`, JSON.stringify(reasoningSettings, null, 2));

      const reasoningConfig = prepareReasoningConfig(safeModelId, reasoningSettings);
      console.log(`API ROUTE: [REASONING DEBUG] Final reasoning config to be sent:`, JSON.stringify(reasoningConfig, null, 2));

      // Log if reasoning is being applied (updated for direct structure)
      if (reasoningConfig) {
        console.log(`API ROUTE: [REASONING DEBUG] ✓ Reasoning ENABLED for ${safeModelId}`);
        if (reasoningConfig.effort) {
          console.log(`API ROUTE: [REASONING DEBUG] Using effort: ${reasoningConfig.effort}`);
        }
        if (reasoningConfig.max_tokens) {
          console.log(`API ROUTE: [REASONING DEBUG] Using max_tokens: ${reasoningConfig.max_tokens}`);
        }
        if (reasoningConfig.exclude) {
          console.log(`API ROUTE: [REASONING DEBUG] Reasoning excluded from response`);
        }
        if (reasoningConfig.enabled) {
          console.log(`API ROUTE: [REASONING DEBUG] Reasoning explicitly enabled`);
        }
      } else {
        console.log(`API ROUTE: [REASONING DEBUG] ✗ Reasoning DISABLED for ${safeModelId}`);
      }

      // Special handling for Claude Sonnet 4
      const isClaudeSonnet4 = safeModelId.includes('claude-sonnet-4') ||
        safeModelId.includes('claude-4-sonnet') ||
        safeModelId.includes('anthropic/claude-sonnet-4');

      // Convert UI messages to model messages required by streamText
      const modelMessages = await convertToModelMessages(messagesForModel);

      // Special handling for Claude Sonnet 4 - use different parameters
      const streamParams: any = {
        model: modelProvider,
        messages: modelMessages,
        tools: SUPPORTS_TOOLS ? allTools : undefined,
        toolChoice: SUPPORTS_TOOLS ? (isClaudeSonnet4 ? 'none' : 'auto') : undefined,
        stopWhen: stepCountIs(SUPPORTS_TOOLS ? 5 : 1),
        // Groq only supports tool streaming reliably on larger Llama models currently
        experimental_toolCallStreaming: SUPPORTS_TOOLS && (
          AI_PROVIDER !== 'groq' ||
          safeModelId.includes('llama-3.3-70b') ||
          safeModelId.includes('llama-3.1-70b')
        ),
        temperature: 0.1,
        maxOutputTokens: getMaxTokensForModel(safeModelId),
      };

      // For Claude Sonnet 4, DISABLE TOOLS to prevent truncation
      if (isClaudeSonnet4) {
        // CRITICAL: Remove tools entirely for Claude Sonnet 4
        // Tool calls cause premature text termination in this model
        delete streamParams.tools;
        delete streamParams.stopWhen;
        streamParams.toolChoice = 'none'; // Explicitly disable tool usage

        // Ensure maximum token output
        streamParams.maxOutputTokens = 16384;
        streamParams.max_tokens = 16384; // Alternative parameter name
        streamParams.maxCompletionTokens = 16384; // Another alternative

        // Add provider-specific metadata
        streamParams.experimental_providerMetadata = {
          openrouter: {
            max_tokens: 16384,
            temperature: 0.1,
            stop: [] // No stop sequences
          }
        };
      }

      // 🚀 GPT-5 OPTIMIZATION & Reasoning application
      const isGPT5Model = safeModelId.includes('gpt-5') || safeModelId.includes('openai/gpt-5');
      const mergeOpenRouterReasoning = (reasoning: Record<string, unknown>) => {
        streamParams.providerOptions = {
          ...(streamParams.providerOptions || {}),
          openrouter: {
            ...(streamParams.providerOptions?.openrouter || {}),
            reasoning
          }
        };
      };

      if (reasoningConfig) {
        if (AI_PROVIDER === 'openrouter') {
          console.log('API ROUTE: [REASONING DEBUG] Applying openrouter reasoning options');
          mergeOpenRouterReasoning(reasoningConfig);
        } else if (AI_PROVIDER === 'openai') {
          console.log('API ROUTE: [REASONING DEBUG] Applying OpenAI reasoning options');
          streamParams.providerOptions = {
            ...(streamParams.providerOptions || {}),
            openai: {
              ...(streamParams.providerOptions?.openai || {}),
              ...(reasoningConfig.effort ? { reasoningEffort: reasoningConfig.effort } : {})
            }
          };
          if (reasoningConfig.max_tokens) {
            streamParams.maxOutputTokens = Math.min(
              reasoningConfig.max_tokens,
              streamParams.maxOutputTokens ?? reasoningConfig.max_tokens
            );
          }
        }
      } else if (isGPT5Model) {
      if (AI_PROVIDER === 'openrouter') {
        console.log(`API ROUTE: [GPT-5 OPTIMIZATION] Applying minimal reasoning effort via provider options for ${safeModelId}`);
        mergeOpenRouterReasoning({
          enabled: true,
          effort: 'minimal'
        });
        } else if (AI_PROVIDER === 'openai') {
          console.log(`API ROUTE: [GPT-5 OPTIMIZATION] Applying minimal reasoningEffort for ${safeModelId}`);
          streamParams.providerOptions = {
            ...(streamParams.providerOptions || {}),
            openai: {
              ...(streamParams.providerOptions?.openai || {}),
              reasoningEffort: 'minimal'
            }
          };
        }
      }

      const normalizeWebSearchItems = (payload: any): any[] => {
        if (!payload) return [];
        const normalized = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
        if (Array.isArray(normalized)) return normalized;
        if (normalized && Array.isArray(normalized.results)) return normalized.results;
        if (normalized && Array.isArray(normalized.items)) return normalized.items;
        return [];
      };

      // First streamText call with merged tools and reasoning
      const result = await streamText({
        ...streamParams,
        onStepFinish: async (params: { text?: string; toolCalls?: ToolCallPart[]; toolResults?: ToolResultPart[] }) => {
          let { text, toolCalls = [] as ToolCallPart[], toolResults = [] as ToolResultPart[] } = params;

          // Clean any malformed useDocument calls from the text
          if (text && isGPTModel) {
            const originalText = text;
            text = cleanMalformedDocumentCalls(text);
            if (originalText !== text) {
              console.log('[Response Cleaning] Cleaned malformed useDocument calls from GPT response');
              // Update the params object with cleaned text
              (params as any).text = text;
            }
          }

          console.log('🔍 [AI STEP DEBUG] ===== AI STEP ANALYSIS =====');
          console.log('🔍 [AI STEP DEBUG] Text response:', text);
          console.log('🔍 [AI STEP DEBUG] Tool calls count:', toolCalls.length);
          console.log('🔍 [AI STEP DEBUG] Tool results count:', toolResults.length);

          if (process.env.NODE_ENV === 'development' && toolResults.length > 0) {
            const summarizePayload = (payload: any) => {
              if (payload === undefined) {
                return { type: 'undefined', keys: [], count: undefined };
              }
              const normalized =
                payload && typeof payload === 'object' && 'value' in payload
                  ? (payload as any).value
                  : payload;
              const isObject = normalized && typeof normalized === 'object';
              const keys = isObject && !Array.isArray(normalized) ? Object.keys(normalized) : [];
              const count = Array.isArray(normalized)
                ? normalized.length
                : Array.isArray((normalized as any)?.results)
                  ? (normalized as any).results.length
                  : Array.isArray((normalized as any)?.items)
                    ? (normalized as any).items.length
                    : undefined;
              const type = normalized === null ? 'null' : Array.isArray(normalized) ? 'array' : typeof normalized;
              return { type, keys, count };
            };

            console.log('API ROUTE: Tool results summary:', toolResults.map(result => ({
              toolName: (result as any).toolName,
              toolCallId: (result as any).toolCallId,
              result: summarizePayload((result as any).result),
              output: summarizePayload((result as any).output)
            })));
          }

          const webSearchResult = toolResults.find(result => result.toolName === 'webSearch');
          if (webSearchResult) {
            const outputPayload = (webSearchResult as any).output ?? (webSearchResult as any).result;
            const normalizedItems = normalizeWebSearchItems(outputPayload);
            if (normalizedItems.length > 0) {
              webSearchResults = normalizedItems;
              webSearchToolCallId = webSearchResult.toolCallId;
              if (process.env.NODE_ENV === 'development') {
                console.log('API ROUTE: Captured webSearch results for metadata:', {
                  toolCallId: webSearchToolCallId,
                  count: webSearchResults.length
                });
              }
            }
          }

          if (toolCalls.length > 0) {
            console.log('🔍 [AI STEP DEBUG] ✅ AI CALLED TOOLS:');
            toolCalls.forEach((call, index) => {
              console.log(`🔍 [AI STEP DEBUG]   Tool ${index + 1}: ${call.toolName}`);
              console.log(`🔍 [AI STEP DEBUG]   Args: ${JSON.stringify(call.args)}`);
            });
          } else {
            console.log('🔍 [AI STEP DEBUG] ❌ NO TOOLS CALLED - AI responded with text only');
            console.log('🔍 [AI STEP DEBUG] This indicates the AI either:');
            console.log('🔍 [AI STEP DEBUG]   1. Does not see the available tools');
            console.log('🔍 [AI STEP DEBUG]   2. Does not think tools are needed');
            console.log('🔍 [AI STEP DEBUG]   3. Cannot match the query to available tools');
          }
          console.log('🔍 [AI STEP DEBUG] ==============================');

          // Ensure toolResults is an array
          if (!Array.isArray(toolResults)) {
            console.log('API ROUTE: toolResults is not an array, skipping document sources');
            return;
          }

          // IMPORTANT: Filter out or transform any messageId objects that would appear as f:{messageId...}
          // in the streaming output. This removes them completely instead of relying on client-side cleanup.
          if (toolResults.length > 0) {
            const filteredResults = toolResults.filter(result => {
              // Keep all results except raw messageId objects
              if (result && Object.keys(result).length === 1 && 'messageId' in result) {
                console.log('API ROUTE: Filtering out messageId object from stream:', result);
                return false;
              }
              return true;
            });

            // Replace the original array with the filtered one
            toolResults.length = 0;
            filteredResults.forEach(item => toolResults.push(item));
            console.log('API ROUTE: Filtered toolResults to remove messageId objects');
          }

          // Make sure to include document sources in every response
          if (usedDocuments && usedDocuments.length > 0) {
            // Add debug information about documents
            console.log('API ROUTE: Adding document sources to toolResults:', usedDocuments.length);
            console.log('API ROUTE: Document sources sample:', usedDocuments.slice(0, 2).map(doc => ({
              id: doc.id,
              name: doc.name || doc.filename,
              similarity: doc.similarity
            })));

            // Add source_images part if any documents have images
            const sourceImages = usedDocuments
              .filter(doc => doc.image_url)
              .map(doc => ({
                name: doc.name || doc.filename || 'Source Image',
                size: 0,
                type: 'image/jpeg',
                url: doc.image_url
              }));

            // [DEBUG] Log source images
            if (sourceImages.length > 0) {
              console.log(`[RAG DEBUG] sourceImages created: ${sourceImages.map(img => img.url).join(', ')}`);
            } else {
              console.log('[RAG DEBUG] No source images found in usedDocuments');
            }

            // Add a special tool result that contains document sources AND images
            // We consolidate this into the tool-result so it's reliably delivered
            toolResults.push({
              type: 'tool-result',
              toolName: 'query_documents',
              toolCallId: 'document-sources-' + Date.now(),
              result: {
                documents: usedDocuments.map(doc => ({
                  id: doc.id,
                  name: doc.name || doc.filename,
                  filename: doc.filename,
                  created_at: doc.created_at,
                  similarity: doc.similarity,
                  content_preview: doc.content_preview || doc.matched_chunk || '',
                  uploadedAt: doc.created_at,
                  explicitly_referenced: doc.explicitly_referenced || false,
                  type: 'document',
                  documentId: doc.id,
                  provider: 'Document Database',
                  title: doc.name || doc.filename || 'Document Source',
                  image_url: doc.image_url,
                  url: doc.external_url || DOCUMENT_URL_MAP[doc.name || doc.filename] || undefined
                })),
                // [FIX] Add images directly to the tool result
                images: sourceImages
              }
            });

            // Add a separate metadata part...
            toolResults.push({
              type: 'metadata',
              usedDocuments: usedDocuments.map(doc => ({
                type: 'document' as const,  // Add the required type field
                id: doc.id,
                name: doc.name || doc.filename,
                filename: doc.filename,
                created_at: doc.created_at,
                content_preview: doc.content_preview || doc.matched_chunk || '',
                similarity: doc.similarity,
                uploadedAt: doc.created_at,
                explicitly_referenced: doc.explicitly_referenced || false,
                image_url: doc.image_url
              }))
            } as any);

            // [FIX] We DO need to push a separate source_images part because the frontend
            // directly looks for {type: 'source_images', source_images: [...]} in message.content
            if (sourceImages.length > 0) {
              toolResults.push({
                type: 'source_images',
                source_images: sourceImages
              } as any);
              console.log('[RAG DEBUG] Added top-level source_images part with', sourceImages.length, 'images');
            }

            // Log modification confirmation
            console.log('API ROUTE: Successfully added document sources to toolResults:',
              toolResults.length
            );
          } else {
            console.log('API ROUTE: No document sources to add');
          }

          // CRITICAL: Explicitly clear all tool results for MCP tools to force explicit approval
          if (toolResults.length > 0) {
            console.log('API ROUTE: Clearing auto-generated results to force explicit approval');
            toolResults.forEach(result => {
              // Clear all tool results except document sources and safe tools which don't need approval
              if (result && result.toolName !== 'query_documents' && result.toolName !== 'webSearch') {
                console.log(`API ROUTE: Clearing result for ${result.toolName} to force explicit approval`);
                // Set result to null to prevent auto-execution
                result.result = null;
              }
            });
          }

          // 🔄 GMAIL SMART TOOL REDIRECTION: Fix draft vs send selection
          // This happens BEFORE user sees the approval UI
          toolCalls.forEach((call: ToolCallPart) => {
            if (call.toolName === 'gmail_create_draft') {
              // Extract user message from tool call instructions (most reliable source)
              const userMessage = (call.args?.instructions as string) || '';
              const intentScore = analyzeEmailIntent(userMessage);

              console.log(`🔄 [CHAT REDIRECTION] Analyzing intent for draft call. User message: "${userMessage}"`);
              console.log(`🔄 [CHAT REDIRECTION] Intent analysis: ${JSON.stringify(intentScore)}`);

              // Redirect to send if user clearly intended to send (not draft)
              if (intentScore.shouldSend && intentScore.confidence >= 0.7) {
                console.log(`🔄 [CHAT REDIRECTION] HIGH CONFIDENCE SEND INTENT (${intentScore.confidence.toFixed(2)}). Redirecting gmail_create_draft → gmail_send_email`);
                call.toolName = 'gmail_send_email';

                console.log('🔄 [CHAT REDIRECTION] Tool successfully redirected to gmail_send_email BEFORE user approval');
              } else {
                console.log(`🔄 [CHAT REDIRECTION] Keeping as draft. Reason: ${intentScore.shouldSend ? 'Low confidence' : 'Draft intent detected'} (confidence: ${intentScore.confidence.toFixed(2)})`);
              }
            }
          });

          // Track toolCalls in approval state
          toolCalls.forEach((call: ToolCallPart) => {
            // Check if we already have a result for this tool call
            // This happens for tools that execute immediately (like webSearch or query_documents)
            const existingResult = toolResults.find(r => r.toolCallId === call.toolCallId);
            const isAllowedTool = call.toolName === 'webSearch' || call.toolName === 'query_documents';
            const hasResultPayload = !!(
              existingResult &&
              (existingResult.result !== undefined ||
                (existingResult as any).output !== undefined ||
                ((existingResult as any).output && (existingResult as any).output.value !== undefined))
            );

            // If we have a result AND it's an allowed tool, we treat it as already approved/executed
            if (existingResult && hasResultPayload && isAllowedTool) {
              console.log(`API ROUTE: Tool ${call.toolName} (${call.toolCallId}) already executed and allowed, skipping approval queue`);
              return;
            }

            if (!toolApprovalState[call.toolCallId]) {
              console.log(`API ROUTE: Adding tool call to approval state: ${call.toolCallId} (${call.toolName})`);
              // Update the global approval state, not just the local variable
              (globalThis as any).toolApprovalState[call.toolCallId] = {
                approved: false, // Always start unapproved
                executed: false, // Add execution tracking flag
                toolCall: {
                  name: call.toolName,
                  params: call.args,
                  meta: { toolCallId: call.toolCallId }
                },
                result: null
              };

              // 🎯 CRITICAL DEBUG: Log tool call parameter storage
              console.log(`[PARAM DEBUG] Tool call ${call.toolName} stored with args:`, call.args);
              console.log(`[PARAM DEBUG] Final approval state for ${call.toolCallId}:`, (globalThis as any).toolApprovalState[call.toolCallId]);
              console.log('API ROUTE: Requiring explicit approval for call:', call.toolCallId);
            }
          });

          // CRITICAL: Do NOT auto-execute tools here even if not MCP tools
          // No auto-execution code should be here
        },
        onFinish: async (event) => {
          console.log('API ROUTE: streamText finished, keeping MCP client open for user approval');

          // 🕐 END TIMING: AI generation and total request
          const aiEndTime = Date.now();
          const aiDuration = aiEndTime - aiStartTime;
          const totalDuration = aiEndTime - requestStartTime;

          console.log(`[⏱️ AI TIMING] Optimized RAG AI generation completed in ${aiDuration}ms`);
          console.log(`[⏱️ TOTAL TIMING] Complete optimized RAG request processed in ${totalDuration}ms`);
          console.log(`[⏱️ BREAKDOWN] RAG: ${ragDuration || 0}ms | AI: ${aiDuration}ms | Other: ${totalDuration - (ragDuration || 0) - aiDuration}ms`);

          // 📊 Performance summary for easy comparison
          console.log(`\n🚀 === OPTIMIZED RAG PERFORMANCE SUMMARY ===`);
          console.log(`📋 Mode: INTELLIGENT (Fast & Accurate)`);
          console.log(`⏱️  Total Time: ${totalDuration}ms`);
          console.log(`🔍 RAG Time: ${ragDuration || 0}ms`);
          console.log(`🤖 AI Time: ${aiDuration}ms`);
          console.log(`📚 Documents: ${usedDocuments.length}`);
          console.log(`📄 Context Size: ${context.length} chars`);
          console.log(`=========================================\n`);

          // Add fallback source display for GPT models if documents were used
          if (isGPTModel && usedDocuments.length > 0 && event.text) {
            // Check if the response already contains source citations
            const hasCitations = event.text.includes('**Source:**') ||
              event.text.includes('Source:') ||
              event.text.includes('📚');

            if (!hasCitations) {
              console.log('[Source Fallback] Adding automatic source citations for GPT model');
              // Create a formatted source list
              const sourceList = usedDocuments
                .filter(doc => doc.similarity && doc.similarity > 0.65)
                .map(doc => `📚 **Source:** ${doc.name}`)
                .join('\n');

              if (sourceList) {
                // Store the sources to be appended (this would need to be handled in the stream)
                (globalThis as any).fallbackSources = `\n\n---\n**Sources Used:**\n${sourceList}`;
              }
            }
          }

          // Handle reasoning details if present
          if (event.experimental_providerMetadata?.openrouter?.reasoning_content) {
            const reasoningContent = event.experimental_providerMetadata.openrouter.reasoning_content;
            console.log('API ROUTE: Reasoning content captured:', reasoningContent.substring(0, 100) + '...');

            // Store reasoning details for the response
            (globalThis as any).lastReasoningDetails = {
              content: reasoningContent,
              token_count: event.experimental_providerMetadata.openrouter.reasoning_tokens || 0,
              model: safeModelId,
              effort: reasoningSettings?.effort,
              timestamp: new Date().toISOString()
            };
          }

          // Deliberately NOT closing the MCP client here - it will be used for tool execution when approved

          // Set a cleanup timer to eventually clear the tool approval state and close the MCP client
          // This prevents resource leaks if the user never approves or cancels
          setTimeout(() => {
            console.log('API ROUTE: Cleanup timer triggered, checking if MCP client needs to be closed');
            // Check if there are any pending tool calls that haven't been processed
            const pendingToolCalls = Object.values((globalThis as any).toolApprovalState)
              .filter((state: any) => !state.executed && state.result === null);

            if (pendingToolCalls.length === 0 && (globalThis as any).persistentMcpClient) {
              console.log('API ROUTE: No pending tool calls, closing MCP client');
              // All tool calls have been processed or timed out, safe to close the client
              (globalThis as any).persistentMcpClient.disconnect().catch((closeError: Error) => {
                console.error('API ROUTE: Error closing MCP client during cleanup:', closeError);
              });
              (globalThis as any).persistentMcpClient = null;
            } else {
              console.log(`API ROUTE: ${pendingToolCalls.length} pending tool calls remain, keeping MCP client open`);
            }
          }, 5 * 60 * 1000); // 5 minutes timeout
        },
        onError: async (errorObj) => {
          const error = errorObj.error;
          console.log('API ROUTE: streamText error:', error);

          // Check if this is a tool execution approval error
          if (error &&
            typeof error === 'object' &&
            'name' in error &&
            'toolName' in error &&
            'toolCallId' in error &&
            'message' in error &&
            error.name === 'AI_ToolExecutionError' &&
            typeof error.message === 'string' &&
            error.message.includes('requires explicit user approval')) {

            console.log('API ROUTE: Tool execution approval error detected in onError handler');
            console.log('API ROUTE: Tool info:', { toolCallId: error.toolCallId, toolName: error.toolName });

            // Don't handle the approval message here - let getErrorMessage handle it
            // This prevents duplicate messages
            return;
          }

          // For all other errors, keep the client open but don't send approval UI
          console.log('API ROUTE: Error occurred but keeping MCP client open for tool approval');
        }
      });

      // [FIX] Use createUIMessageStream to inject source_images data part alongside AI response
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          // Write source_images and metadata FIRST before merging AI stream
          if (precomputedSourceImages.length > 0) {
            console.log('[RAG] Injecting source_images into stream:', precomputedSourceImages.length, 'images');
            writer.write({
              type: 'source_images' as any,
              source_images: precomputedSourceImages
            });
            writer.write({
              type: 'metadata' as any,
              usedDocuments: usedDocuments.map(doc => ({
                type: 'document' as const,
                id: doc.id,
                name: doc.name || doc.filename,
                filename: doc.filename,
                created_at: doc.created_at,
                similarity: doc.similarity,
                image_url: doc.image_url,
                url: doc.external_url || DOCUMENT_URL_MAP[doc.name || doc.filename] || undefined
              }))
            });
          }
          // Merge AI stream
          writer.merge(result.toUIMessageStream({ sendStart: precomputedSourceImages.length === 0 }));
        },
        onFinish: () => {
          const reasoningDetails = (globalThis as any).lastReasoningDetails;
          const metadata: any = {};

          // Add multi-step metadata if this is a multi-step query
          if (isHandlingMultiStep && multiStepMetadata) {
            metadata.multiStep = {
              isMultiStep: true,
              totalSteps: multiStepMetadata.totalSteps,
              currentStepIndex: multiStepMetadata.currentStepIndex,
              currentStep: {
                id: multiStepMetadata.currentStep.id,
                type: multiStepMetadata.currentStep.type,
                text: multiStepMetadata.currentStep.text
              },
              hasMoreSteps: multiStepMetadata.remainingSteps.length > 0,
              nextStep: multiStepMetadata.remainingSteps[0] || null,
              requiresToolApproval: multiStepMetadata.remainingSteps.some(s => s.type === 'mcp')
            };
            console.log('📝 [MULTI-STEP] Adding multi-step metadata to response');
          }

          // Add reasoning details if available
          if (reasoningDetails) {
            metadata.reasoningText = reasoningDetails;
            // Clean up after use
            delete (globalThis as any).lastReasoningDetails;
          }

          if (webSearchResults.length > 0) {
            metadata.webSearch = {
              toolCallId: webSearchToolCallId,
              results: webSearchResults
            };
          }

          // CRITICAL: For Claude Sonnet 4 with disabled tools, add document sources to metadata
          if (isClaudeSonnet4 && usedDocuments && usedDocuments.length > 0) {
            metadata.documentSources = usedDocuments.map(doc => ({
              id: doc.id,
              name: doc.name || doc.filename,
              similarity: doc.similarity,
              chunk_text: doc.chunk_text?.substring(0, 200) + '...'
            }));
          }

          return Object.keys(metadata).length > 0 ? metadata : undefined;
        },
        // Handle tool-related errors in the stream
        onError: error => {
          if (error instanceof Error) {
            console.error('API ROUTE: Tool execution error:', error);

            // Check if this is an approval-required error
            if (error.message && error.message.includes('requires explicit user approval')) {
              // Extract tool call info if available
              let toolCallId = (error as any).toolCallId || '';
              let toolName = (error as any).toolName || '';

              // DEBUG: Log the error object structure
              console.log('API ROUTE: [DEBUG] Error object structure:', {
                hasToolCallId: !!(error as any).toolCallId,
                hasToolName: !!(error as any).toolName,
                toolCallId: (error as any).toolCallId,
                toolName: (error as any).toolName,
                toolCallIdType: typeof (error as any).toolCallId,
                toolNameType: typeof (error as any).toolName,
                errorKeys: Object.keys(error as any)
              });

              // Check if toolCallId contains the toolName (concatenated without separator)
              // Pattern: call_XXXXXXgmail_create_draft or similar
              if (toolCallId && !toolName) {
                // Check for known tool patterns
                const toolPatterns = [
                  'gmail_', 'calendar_', 'drive_', // Zapier tools
                  'web_search', 'file_', 'sql_', // Other MCP tools
                ];

                for (const pattern of toolPatterns) {
                  const index = toolCallId.indexOf(pattern);
                  if (index > 0) {
                    // Found the pattern, split at this point
                    toolName = toolCallId.substring(index);
                    toolCallId = toolCallId.substring(0, index);
                    console.log('API ROUTE: [DEBUG] Split concatenated values:', {
                      original: (error as any).toolCallId,
                      toolCallId,
                      toolName
                    });
                    break;
                  }
                }

                // Alternative pattern matching for more complex cases
                if (!toolName) {
                  const match = toolCallId.match(/^(call_[a-zA-Z0-9]+)([a-z_]+)$/);
                  if (match) {
                    toolCallId = match[1];
                    toolName = match[2];
                    console.log('API ROUTE: [DEBUG] Regex split concatenated values:', {
                      original: (error as any).toolCallId,
                      toolCallId,
                      toolName
                    });
                  }
                }
              }

              // If we have both toolCallId and toolName, return a clean special format
              if (toolCallId && toolName) {
                console.log('API ROUTE: Including tool call info with error for tool approval UI:', { toolCallId, toolName });
                // Return a clean format without any JSON or other artifacts
                // Add logging to help debug the approval flow
                console.log(`API ROUTE: Creating approval-required message for toolCallId=${toolCallId}, toolName=${toolName}`);
                console.log(`API ROUTE: [DEBUG] Final approval message: __REQUIRES_APPROVAL__:${toolCallId}:${toolName}`);
                return `__REQUIRES_APPROVAL__:${toolCallId}:${toolName}`;
              } else {
                console.log('API ROUTE: [DEBUG] Missing toolCallId or toolName:', { toolCallId, toolName });
              }
            }

            // Standard error handling for non-approval errors
            if (process.env.NODE_ENV === 'development') {
              return `Tool execution failed: ${error.message}`;
            } else {
              return `Tool execution failed. Please try again or contact support.`;
            }
          }

          return 'An unknown error occurred during tool execution';
        }
      });

      // Return the stream response
      return createUIMessageStreamResponse({ stream });
    } catch (streamError) {
      console.error('API ROUTE: Error in streamText:', streamError);
      console.error('API ROUTE: Error details:', streamError instanceof Error ? streamError.message : String(streamError));
      console.error('API ROUTE: Error stack:', streamError instanceof Error ? streamError.stack : "No stack available");

      // Parse OpenRouter-specific errors for better error messages
      const errorDetails = parseOpenRouterError(streamError);
      console.log('API ROUTE: Parsed error details:', errorDetails);

      // Provide specific error messages based on error code
      let userFriendlyMessage = '';

      if (errorDetails.code === 403) {
        if (errorDetails.message?.includes('Key limit exceeded')) {
          userFriendlyMessage = 'Your OpenRouter API key has exceeded its usage limit. Please visit https://openrouter.ai/settings/keys to manage your API key and check your usage.';
        } else {
          userFriendlyMessage = 'Access denied. Please check that your OpenRouter API key is valid and has access to the selected model.';
        }
      } else if (errorDetails.code === 400) {
        if (errorDetails.message?.includes('reasoning')) {
          userFriendlyMessage = 'Invalid reasoning configuration for this model. The model does not support the requested reasoning parameters. Please check your reasoning settings.';
        } else {
          userFriendlyMessage = `Invalid request: ${errorDetails.message || 'Please check your input and try again.'}`;
        }
      } else if (errorDetails.code === 429) {
        userFriendlyMessage = 'Rate limit exceeded. Please wait a moment and try again.';
      } else if (errorDetails.code === 401) {
        userFriendlyMessage = 'Authentication failed. Please check that your OpenRouter API key is correctly configured in the environment variables.';
      } else {
        // Generic error message with details if available
        const errorInfo = errorDetails.message || 'An unknown error occurred';
        userFriendlyMessage = `I'm having trouble connecting to the AI service. Error: ${errorInfo}`;
      }

      // Return the user-friendly error message
      console.log('API ROUTE: Returning user-friendly error:', userFriendlyMessage);
      return createErrorResponse(userFriendlyMessage);
    }
  } catch (error) {
    // Ensure MCP client is closed on error
    if (persistentMcpClient) {
      await persistentMcpClient.disconnect().catch((closeError: Error) => {
        console.error('API ROUTE: Error closing MCP client:', closeError);
      });
      persistentMcpClient = null;
      // Also clear the global reference
      (globalThis as any).persistentMcpClient = null;
    }
    console.error('API ROUTE: Error in POST:', error);
    console.error('API ROUTE: Error details:', error instanceof Error ? error.message : String(error));
    console.error('API ROUTE: Error stack:', error instanceof Error ? error.stack : "No stack available");

    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

    // Return a friendly message as a properly formatted response
    console.log('API ROUTE: Returning error response:', errorMessage);
    return createErrorResponse(`I'm having trouble connecting to my AI services. The error was: ${errorMessage}. Please try again later.`);
  }
}
