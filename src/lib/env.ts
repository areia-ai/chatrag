import * as dotenv from 'dotenv';
import { logger } from './logger';

/**
 * Environment Configuration Singleton
 * Loads and validates environment variables only once per process
 */
class EnvironmentConfig {
  private static instance: EnvironmentConfig;
  private initialized = false;
  private envVars: any = null;

  private constructor() {
    this.initializeEnvironment();
  }

  static getInstance(): EnvironmentConfig {
    if (!EnvironmentConfig.instance) {
      EnvironmentConfig.instance = new EnvironmentConfig();
    }
    return EnvironmentConfig.instance;
  }

  private initializeEnvironment() {
    if (this.initialized) return;

    // Note: Next.js automatically loads .env.local files
    // We don't need to manually load dotenv in Next.js apps
    // dotenv.config is only needed for scripts running outside Next.js

    // Check if we're in build phase
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

    // Initialize environment variables object
    this.envVars = {
      // Public variables (available in both client and server)
      NEXT_PUBLIC_DEFAULT_LANGUAGE: process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || 'en',
      NEXT_PUBLIC_DEFAULT_THEME: process.env.NEXT_PUBLIC_DEFAULT_THEME || 'system',
      NEXT_PUBLIC_DEFAULT_BACKGROUND_IMAGE: process.env.NEXT_PUBLIC_DEFAULT_BACKGROUND_IMAGE || '',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || '',
      NEXT_PUBLIC_WEB_SEARCH_ENABLED: process.env.NEXT_PUBLIC_WEB_SEARCH_ENABLED || '',
      NEXT_PUBLIC_SHOW_SUGGESTIONS: process.env.NEXT_PUBLIC_SHOW_SUGGESTIONS || 'true',
      NEXT_PUBLIC_SUGGESTION_GROUPS: process.env.NEXT_PUBLIC_SUGGESTION_GROUPS || '',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
      NEXT_PUBLIC_STRIPE_PRICE_ID_PRO: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '',
      NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE || '',
      NEXT_PUBLIC_CUSTOM_SMTP_ENABLED: process.env.NEXT_PUBLIC_CUSTOM_SMTP_ENABLED || 'false',
      NEXT_PUBLIC_SMTP_FROM_NAME: process.env.NEXT_PUBLIC_SMTP_FROM_NAME || 'ChatRAG Support',
      NEXT_PUBLIC_SMTP_FROM_EMAIL: process.env.NEXT_PUBLIC_SMTP_FROM_EMAIL || 'support@example.com',
      NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'ChatRAG',
      NEXT_PUBLIC_SITE_TITLE: process.env.NEXT_PUBLIC_SITE_TITLE || '',
      NEXT_PUBLIC_FAVICON_URL: process.env.NEXT_PUBLIC_FAVICON_URL || '/favicon.ico',
      NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT: process.env.NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT || 'ChatRAG',
      NEXT_PUBLIC_SIDEBAR_BUTTON_URL: process.env.NEXT_PUBLIC_SIDEBAR_BUTTON_URL || 'https://www.chatrag.ai/',

      // Chat input border customization
      NEXT_PUBLIC_BORDER_WIDTH: process.env.NEXT_PUBLIC_CHAT_BORDER_WIDTH || process.env.NEXT_PUBLIC_BORDER_WIDTH || '2.5',
      NEXT_PUBLIC_BORDER_COLOR: process.env.NEXT_PUBLIC_CHAT_BORDER_COLOR || process.env.NEXT_PUBLIC_BORDER_COLOR || '#FF6417',
      NEXT_PUBLIC_BORDER_GRADIENT_ENABLED: process.env.NEXT_PUBLIC_CHAT_BORDER_GRADIENT_ENABLED || process.env.NEXT_PUBLIC_BORDER_GRADIENT_ENABLED || 'false',
      NEXT_PUBLIC_BORDER_GRADIENT_COLOR_1: process.env.NEXT_PUBLIC_CHAT_BORDER_GRADIENT_COLOR_1 || process.env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_1 || '#FF6417',
      NEXT_PUBLIC_BORDER_GRADIENT_COLOR_2: process.env.NEXT_PUBLIC_CHAT_BORDER_GRADIENT_COLOR_2 || process.env.NEXT_PUBLIC_BORDER_GRADIENT_COLOR_2 || '#FF1744',
      NEXT_PUBLIC_BORDER_ANIMATION_SPEED: process.env.NEXT_PUBLIC_CHAT_BORDER_ANIMATION_SPEED || process.env.NEXT_PUBLIC_BORDER_ANIMATION_SPEED || '14',
      NEXT_PUBLIC_BORDER_ENABLED: process.env.NEXT_PUBLIC_CHAT_BORDER_ENABLED || 'true',
      NEXT_PUBLIC_BORDER_LENGTH: process.env.NEXT_PUBLIC_CHAT_BORDER_LENGTH || '220',

      // Feature flags
      NEXT_PUBLIC_IMAGE_GENERATION_ENABLED: process.env.NEXT_PUBLIC_IMAGE_GENERATION_ENABLED || 'false',
      NEXT_PUBLIC_VIDEO_GENERATION_ENABLED: process.env.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED || 'false',
      NEXT_PUBLIC_3D_GENERATION_ENABLED: process.env.NEXT_PUBLIC_3D_GENERATION_ENABLED || 'false',
      NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED: process.env.NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED || process.env.NEXT_PUBLIC_MCP_TOOLS_ENABLED || 'false',
      NEXT_PUBLIC_MCP_SYSTEM_ENABLED: process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED || 'false',
      NEXT_PUBLIC_SHOW_SOURCES_ENABLED: process.env.NEXT_PUBLIC_SHOW_SOURCES_ENABLED || 'true',

      // Embed widget configuration
      NEXT_PUBLIC_EMBED_ENABLED: process.env.NEXT_PUBLIC_EMBED_ENABLED || 'false',
      NEXT_PUBLIC_EMBED_TITLE: process.env.NEXT_PUBLIC_EMBED_TITLE || 'ChatRAG Assistant',
      NEXT_PUBLIC_EMBED_PRIMARY_COLOR: process.env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR || '#FF6417',
      NEXT_PUBLIC_EMBED_POSITION: process.env.NEXT_PUBLIC_EMBED_POSITION || 'bottom-right',
      NEXT_PUBLIC_EMBED_AUTO_OPEN: process.env.NEXT_PUBLIC_EMBED_AUTO_OPEN || 'false',
      NEXT_PUBLIC_EMBED_GREETING: process.env.NEXT_PUBLIC_EMBED_GREETING || 'Hello! How can I help you today?',
      NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS: process.env.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS || '*',
      NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED: process.env.NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED || 'true',
      NEXT_PUBLIC_EMBED_SUGGESTIONS: process.env.NEXT_PUBLIC_EMBED_SUGGESTIONS || '',

      // Reasoning/Thinking configuration
      NEXT_PUBLIC_REASONING_ENABLED: process.env.NEXT_PUBLIC_REASONING_ENABLED || 'false',
      NEXT_PUBLIC_DEFAULT_REASONING_EFFORT: process.env.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT || 'medium',
      NEXT_PUBLIC_MAX_REASONING_TOKENS: process.env.NEXT_PUBLIC_MAX_REASONING_TOKENS || '8000',
      NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT: process.env.NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT || 'false',
      NEXT_PUBLIC_RAG_REASONING_ENABLED: process.env.NEXT_PUBLIC_RAG_REASONING_ENABLED || 'false',
      REASONING_COST_MULTIPLIER: process.env.REASONING_COST_MULTIPLIER || '1.5',

      // Deployment mode configuration
      // Note: We use NEXT_PUBLIC_ prefix so it's accessible in both client and server
      NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE: process.env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE || 'single-tenant',
      // Legacy alias for backward compatibility (server-side only)
      CHATRAG_DEPLOYMENT_MODE: process.env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE || process.env.CHATRAG_DEPLOYMENT_MODE || 'single-tenant',

      // Multi-tenant feature flags (optional in single-tenant mode)
      ENABLE_ORGANIZATIONS: process.env.ENABLE_ORGANIZATIONS === 'true',
      ENABLE_TEAM_INVITES: process.env.ENABLE_TEAM_INVITES === 'true',
      ENABLE_STORAGE_QUOTAS: process.env.ENABLE_STORAGE_QUOTAS === 'true',
      ENABLE_USAGE_ANALYTICS: process.env.ENABLE_USAGE_ANALYTICS === 'true',

      // Server-only variables (allow empty during build phase)
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || (isBuildPhase ? '' : undefined) || '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || (isBuildPhase ? '' : undefined) || '',
      LLAMA_CLOUD_API_KEY: process.env.LLAMA_CLOUD_API_KEY || '',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
      GMAIL_CONNECTED_ACCOUNT_ID: process.env.GMAIL_CONNECTED_ACCOUNT_ID || '',
      GMAIL_INTEGRATION_ID: process.env.GMAIL_INTEGRATION_ID || '',
      RESEND_API_KEY: process.env.RESEND_API_KEY || '',
      MCP_ZAPIER_ENDPOINT: process.env.MCP_ZAPIER_ENDPOINT || '',
      CHATRAG_INTERNAL_API_KEY: process.env.CHATRAG_INTERNAL_API_KEY || '',
      NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED: process.env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED || 'false',

      // WhatsApp Integration
      NEXT_PUBLIC_WHATSAPP_ENABLED: process.env.NEXT_PUBLIC_WHATSAPP_ENABLED || 'false',
      WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER || 'koyeb',
      KOYEB_BAILEYS_URL: process.env.KOYEB_BAILEYS_URL || '',
      KOYEB_API_KEY: process.env.KOYEB_API_KEY || '',
      FLYIO_BAILEYS_URL: process.env.FLYIO_BAILEYS_URL || '',
      FLYIO_API_KEY: process.env.FLYIO_API_KEY || '',
      WHATSAPP_WEBHOOK_SECRET: process.env.WHATSAPP_WEBHOOK_SECRET || '',
      WHATSAPP_WEBHOOK_URL: process.env.WHATSAPP_WEBHOOK_URL || '',
      WHATSAPP_MAX_SESSIONS_PER_USER: process.env.WHATSAPP_MAX_SESSIONS_PER_USER || '1',
      WHATSAPP_MESSAGE_QUEUE_SIZE: process.env.WHATSAPP_MESSAGE_QUEUE_SIZE || '100',

      // WhatsApp AI Configuration
      WHATSAPP_ENABLE_MCP: process.env.WHATSAPP_ENABLE_MCP || 'false',
      WHATSAPP_ENABLE_WEB_SEARCH: process.env.WHATSAPP_ENABLE_WEB_SEARCH || 'false',
      WHATSAPP_MAX_TOKENS: process.env.WHATSAPP_MAX_TOKENS || '4096',
      WHATSAPP_DEFAULT_MODEL: process.env.WHATSAPP_DEFAULT_MODEL || 'openai/gpt-4o-mini',

      // RAG system prompt
      RAG_SYSTEM_PROMPT: process.env.RAG_SYSTEM_PROMPT || '',
      RAG_PRE_CONTEXT: process.env.RAG_PRE_CONTEXT || '',
      RAG_POST_CONTEXT: process.env.RAG_POST_CONTEXT || '',

      // RAG configuration settings
      LLAMACLOUD_PARSING_MODE: process.env.LLAMACLOUD_PARSING_MODE || 'balanced',
      LLAMACLOUD_CHUNK_STRATEGY: process.env.LLAMACLOUD_CHUNK_STRATEGY || 'sentence',
      LLAMACLOUD_CHUNK_SIZE: process.env.LLAMACLOUD_CHUNK_SIZE || '768',
      LLAMACLOUD_CHUNK_OVERLAP: process.env.LLAMACLOUD_CHUNK_OVERLAP || '416',

      // Advanced LlamaParse configuration
      LLAMACLOUD_PARSE_MODE: process.env.LLAMACLOUD_PARSE_MODE || 'parse_page_with_agent',
      LLAMACLOUD_PARSE_MODEL: process.env.LLAMACLOUD_PARSE_MODEL || 'openai-gpt-4-1-mini',
      LLAMACLOUD_HIGH_RES_OCR: process.env.LLAMACLOUD_HIGH_RES_OCR || 'true',
      LLAMACLOUD_ADAPTIVE_LONG_TABLE: process.env.LLAMACLOUD_ADAPTIVE_LONG_TABLE || 'true',
      LLAMACLOUD_OUTLINED_TABLE_EXTRACTION: process.env.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION || 'true',
      LLAMACLOUD_OUTPUT_TABLES_AS_HTML: process.env.LLAMACLOUD_OUTPUT_TABLES_AS_HTML || 'true',

      // RAG settings
      RAG_BEHAVIOR_MODE: process.env.RAG_BEHAVIOR_MODE || 'strict',
      RAG_INITIAL_MATCH_COUNT: process.env.RAG_INITIAL_MATCH_COUNT,
      RAG_SIMILARITY_THRESHOLD: process.env.RAG_SIMILARITY_THRESHOLD,
      LLAMACLOUD_MULTIMODAL_PARSING: process.env.LLAMACLOUD_MULTIMODAL_PARSING || 'true',
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',

      // Embed widget server configuration
      EMBED_RATE_LIMIT: process.env.EMBED_RATE_LIMIT || '100',
      EMBED_REQUIRE_AUTH: process.env.EMBED_REQUIRE_AUTH || 'false',

      // Image generation configuration
      IMAGE_GENERATION_PROVIDER: process.env.IMAGE_GENERATION_PROVIDER || 'openai', // 'openai' | 'fal' | 'replicate'
      USE_OPENAI_IMAGE: process.env.USE_OPENAI_IMAGE || 'false',
      USE_FAL_PROVIDER: process.env.USE_FAL_PROVIDER || 'false',
      OPENAI_IMAGE_QUALITY: process.env.OPENAI_IMAGE_QUALITY || 'auto',
      OPENAI_IMAGE_BACKGROUND: process.env.OPENAI_IMAGE_BACKGROUND || 'opaque',
      OPENAI_IMAGE_FORMAT: process.env.OPENAI_IMAGE_FORMAT || 'png',
      OPENAI_IMAGE_MODERATION: process.env.OPENAI_IMAGE_MODERATION || 'auto',
      FAL_API_KEY: process.env.FAL_API_KEY || '',
      REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN || '',

      // Web search configuration
      EXA_API_KEY: process.env.EXA_API_KEY || '',

      // Chat title generation configuration (pure AI approach)
      CHAT_TITLE_MODEL: process.env.CHAT_TITLE_MODEL || 'anthropic/claude-haiku-4.5',
      CHAT_TITLE_TEMPERATURE: process.env.CHAT_TITLE_TEMPERATURE || '0.5',
      CHAT_TITLE_MAX_TOKENS: process.env.CHAT_TITLE_MAX_TOKENS || '100',
      // Legacy variables (unused but kept for TypeScript compatibility)
      CHAT_TITLE_MULTIMODAL_MODEL: process.env.CHAT_TITLE_MULTIMODAL_MODEL || 'openai/gpt-4o',
      CHAT_TITLE_MULTIMODAL_TOKENS: process.env.CHAT_TITLE_MULTIMODAL_TOKENS || '75',
      CHAT_TITLE_ENABLE_VISION: process.env.CHAT_TITLE_ENABLE_VISION || 'false',
      CHAT_TITLE_SPECIALIZED_HANDLERS: process.env.CHAT_TITLE_SPECIALIZED_HANDLERS || 'false',

      // Audio/Voice configuration
      NEXT_PUBLIC_VOICE_PROVIDER: process.env.NEXT_PUBLIC_VOICE_PROVIDER || 'openai',
      NEXT_PUBLIC_TTS_DISABLED: process.env.NEXT_PUBLIC_TTS_DISABLED || 'false',
      NEXT_PUBLIC_STT_DISABLED: process.env.NEXT_PUBLIC_STT_DISABLED || 'false',
      NEXT_PUBLIC_AUDIO_AUTOPLAY: process.env.NEXT_PUBLIC_AUDIO_AUTOPLAY || 'false',

      // AI Model Provider configuration
      NEXT_PUBLIC_AI_PROVIDER: process.env.NEXT_PUBLIC_AI_PROVIDER || 'openrouter',
      NEXT_PUBLIC_OPENAI_MODELS: process.env.NEXT_PUBLIC_OPENAI_MODELS || JSON.stringify([
        { id: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini' },
        { id: 'gpt-4.1', displayName: 'GPT-4.1' },
        { id: 'o3', displayName: 'o3' },
        { id: 'o4-mini', displayName: 'o4 Mini' }
      ]),
      NEXT_PUBLIC_OPENROUTER_MODELS: process.env.NEXT_PUBLIC_OPENROUTER_MODELS || JSON.stringify([
        { id: 'anthropic/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', isDefault: true },
        { id: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 Mini' },
        { id: 'openai/gpt-4.1', displayName: 'GPT-4.1' },
        { id: 'anthropic/claude-opus-4.1', displayName: 'Claude Opus 4.1' },
        { id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' },
        { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
        { id: 'meta-llama/llama-4-maverick', displayName: 'Llama 4 Maverick', isOpenSource: true },
        { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', displayName: 'Venice: Uncensored', isFree: true, isOpenSource: true, isUncensored: true }
      ]),
      NEXT_PUBLIC_GROQ_MODELS: process.env.NEXT_PUBLIC_GROQ_MODELS || JSON.stringify([
        { id: 'llama3-8b-8192', displayName: 'Llama 3 8B', isOpenSource: true },
        { id: 'llama3-70b-8192', displayName: 'Llama 3 70B', isOpenSource: true },
        { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B', isOpenSource: true },
        { id: 'gemma-7b-it', displayName: 'Gemma 7B', isOpenSource: true },
        { id: 'llama3-groq-70b-8192-tool-use-preview', displayName: 'Llama 3 Groq 70B Tool Use', isOpenSource: true },
        { id: 'deepseek-r1-distill-llama-70b', displayName: 'DeepSeek R1 Distill Llama 70B', isOpenSource: true, supportsReasoning: true, reasoningMethod: 'both' }
      ]),

      // ElevenLabs configuration
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
      ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL', // Default: Sarah voice
      ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      ELEVENLABS_VOICE_STABILITY: process.env.ELEVENLABS_VOICE_STABILITY || '0.5',
      ELEVENLABS_SIMILARITY_BOOST: process.env.ELEVENLABS_SIMILARITY_BOOST || '0.5',
      ELEVENLABS_SPEAKER_BOOST: process.env.ELEVENLABS_SPEAKER_BOOST || 'true',
      ELEVENLABS_VOICE_SPEED: process.env.ELEVENLABS_VOICE_SPEED || '1.0',

      // LiveKit Configuration
      LIVEKIT_URL: process.env.LIVEKIT_URL || '',
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || '',
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || '',

      // Nango Integration (Document Connectors) - Uses Connect Sessions
      NEXT_PUBLIC_NANGO_ENABLED: process.env.NEXT_PUBLIC_NANGO_ENABLED || 'false',
      NANGO_SECRET_KEY: process.env.NANGO_SECRET_KEY || '',
      NANGO_WEBHOOK_SECRET: process.env.NANGO_WEBHOOK_SECRET || '',
      NANGO_HOST: process.env.NANGO_HOST || 'https://api.nango.dev',
      NANGO_SUPPORTED_FILE_TYPES: process.env.NANGO_SUPPORTED_FILE_TYPES || 'pdf,doc,docx,txt,md,html,pptx,xlsx',
      NANGO_MAX_FILES_PER_SYNC: process.env.NANGO_MAX_FILES_PER_SYNC || '100',
      NANGO_SYNC_INTERVAL_HOURS: process.env.NANGO_SYNC_INTERVAL_HOURS || '1',

      // Connectors Management Configuration
      NEXT_PUBLIC_CONNECTORS_ENABLED: process.env.NEXT_PUBLIC_CONNECTORS_ENABLED || 'true',
      CONNECTORS_SHOW_ON_DASHBOARD: process.env.CONNECTORS_SHOW_ON_DASHBOARD || 'true',

      // Firecrawl Web Scraping Configuration
      NEXT_PUBLIC_FIRECRAWL_ENABLED: process.env.NEXT_PUBLIC_FIRECRAWL_ENABLED || 'false',
      NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD: process.env.NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD || 'true',
      FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || '',

      FIRECRAWL_ONLY_MAIN_CONTENT: process.env.FIRECRAWL_ONLY_MAIN_CONTENT || 'true',
      FIRECRAWL_WAIT_FOR_JS: process.env.FIRECRAWL_WAIT_FOR_JS || '2000',
    } as const;

    this.performValidation();
    this.initialized = true;
    logger.startup('ENV', 'Environment configuration initialized');
  }

  private performValidation() {
    // Skip validation during build phase
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

    // Validate required environment variables on the server side only (skip during build)
    if (typeof window === 'undefined' && !isBuildPhase) {
      const requiredServerVars = [
        'OPENAI_API_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ] as const;

      for (const envVar of requiredServerVars) {
        if (!this.envVars[envVar]) {
          // Only throw errors at runtime, not during build
          if (process.env.NODE_ENV === 'production') {
            logger.error('ENV', `${envVar} is required on the server but not set`);
          } else {
            throw new Error(`${envVar} is required on the server`);
          }
        }
      }
    }

    // Validate required public variables
    const requiredPublicVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY'
    ] as const;

    // Only throw validation errors in development
    if (process.env.NODE_ENV === 'development') {
      for (const envVar of requiredPublicVars) {
        if (!this.envVars[envVar]) {
          logger.error('ENV', `${envVar} is required but not set`);
        }
      }

      // Log critical validation errors only
      if (typeof window === 'undefined' && !this.envVars.OPENROUTER_API_KEY) {
        logger.warn('ENV', 'OPENROUTER_API_KEY is missing - some features may not work');
      }
    }
  }

  getEnv() {
    if (!this.initialized) {
      this.initializeEnvironment();
    }
    return this.envVars;
  }
}

// Create singleton instance and export environment variables
const envConfig = EnvironmentConfig.getInstance();
export const env = envConfig.getEnv();

// Helper function to get the application name
export function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || env.NEXT_PUBLIC_APP_NAME || 'ChatRAG';
}

// Helper function to get the site title (falls back to app name if not set)
export function getSiteTitle(): string {
  const siteTitle = process.env.NEXT_PUBLIC_SITE_TITLE || env.NEXT_PUBLIC_SITE_TITLE;
  return siteTitle || getAppName();
}

// Helper function to get the favicon URL
export function getFaviconUrl(): string {
  return process.env.NEXT_PUBLIC_FAVICON_URL || env.NEXT_PUBLIC_FAVICON_URL || '/favicon.ico';
}

export type Env = typeof env;
