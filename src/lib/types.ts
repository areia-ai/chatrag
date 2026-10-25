export interface ParsedDocument {
  id: string;
  filename: string;
  content: string;
  chunks: DocumentChunk[];
  metadata: Record<string, any>;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
}

export interface ChunkWithEmbedding {
  content: string;
  embedding: number[];
}

export interface ReasoningConfig {
  effort?: 'high' | 'medium' | 'low';
  max_tokens?: number;
  exclude?: boolean;
  enabled?: boolean;
  maxOutputTokens?: number;
}

export interface ReasoningDetails {
  content?: string;
  token_count?: number;
  model?: string;
  effort?: string;
  timestamp?: string;
}

export interface ModelReasoningCapability {
  supported: boolean;
  method: 'effort' | 'max_tokens' | 'both' | 'none';
  defaultEffort?: 'high' | 'medium' | 'low';
  maxTokensLimit?: number;
  minTokens?: number;
}

export const REASONING_MODELS: Record<string, ModelReasoningCapability> = {
  // OpenAI o-series
  'openai/o3-mini': { supported: true, method: 'effort', defaultEffort: 'medium' },
  'openai/o1': { supported: true, method: 'effort', defaultEffort: 'medium' },
  'openai/o1-preview': { supported: true, method: 'effort', defaultEffort: 'medium' },
  'openai/o1-mini': { supported: true, method: 'effort', defaultEffort: 'low' },
  'openai/o3': { supported: true, method: 'effort', defaultEffort: 'high' },
  'openai/o4': { supported: true, method: 'effort', defaultEffort: 'high' },
  'openai/o4-mini': { supported: true, method: 'effort', defaultEffort: 'medium' },

  // Anthropic Claude 3.7+ and 4
  'anthropic/claude-3.7-sonnet': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-3.7-opus': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-3.7-haiku': { supported: true, method: 'max_tokens', maxTokensLimit: 16000, minTokens: 500 },
  'anthropic/claude-3.8-sonnet': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-3.8-opus': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-sonnet-4': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-sonnet-4.5': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'anthropic/claude-opus-4.1': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },

  // DeepSeek R1 (all variants)
  // NOTE: 'method: both' means the model supports EITHER effort OR max_tokens (not simultaneously)
  // OpenRouter API will reject requests that include both parameters for DeepSeek models
  'deepseek/deepseek-r1': { supported: true, method: 'both', defaultEffort: 'medium', maxTokensLimit: 16000 },
  'deepseek/deepseek-r1-0528': { supported: true, method: 'both', defaultEffort: 'medium', maxTokensLimit: 16000 },
  'deepseek/deepseek-r1-distill': { supported: true, method: 'both', defaultEffort: 'low', maxTokensLimit: 8000 },
  'deepseek/deepseek-r1-distill-0528': { supported: true, method: 'both', defaultEffort: 'low', maxTokensLimit: 8000 },

  // Google Gemini thinking models
  'google/gemini-2.0-flash-thinking-exp': { supported: true, method: 'max_tokens', maxTokensLimit: 16000, minTokens: 1000 },
  'google/gemini-2.0-flash-thinking': { supported: true, method: 'max_tokens', maxTokensLimit: 20000, minTokens: 1000 },
  'google/gemini-2.0-pro-thinking': { supported: true, method: 'max_tokens', maxTokensLimit: 30000, minTokens: 1500 },
  'google/gemini-2.5-pro-preview': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 1000 },
  'google/gemini-2.5-pro-thinking': { supported: true, method: 'max_tokens', maxTokensLimit: 32000, minTokens: 2000 },

  // OpenAI GPT-OSS models with reasoning support
  'openai/gpt-oss-120b': { supported: true, method: 'max_tokens', maxTokensLimit: 26000, minTokens: 1300 },
  'openai/gpt-oss-20b': { supported: true, method: 'max_tokens', maxTokensLimit: 16000, minTokens: 1000 },

  // OpenAI GPT-5 family (effort-based reasoning)
  'openai/gpt-5': { supported: true, method: 'effort', defaultEffort: 'high' },
  'openai/gpt-5.2-chat': { supported: true, method: 'effort', defaultEffort: 'low' },
  'openai/gpt-5-mini': { supported: true, method: 'effort', defaultEffort: 'medium' },
  // Intentionally not adding gpt-5-nano to reasoning map (used for basic tasks)

  // Z.AI GLM models with thinking mode
  'z-ai/glm-4.5': { supported: true, method: 'max_tokens', maxTokensLimit: 16000, minTokens: 1000 },
  'z-ai/glm-4.5-air': { supported: true, method: 'max_tokens', maxTokensLimit: 16000, minTokens: 1000 },

  // Default for unknown models
  default: { supported: false, method: 'none' }
};
