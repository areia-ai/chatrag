const fs = require('fs');
const path = require('path');

// Resolve project root (one level up from scripts directory)
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env.local');

// Default model configurations
const DEFAULT_OPENAI_MODELS = '[{"id":"gpt-4.1-mini","displayName":"GPT-4.1 Mini"},{"id":"gpt-4.1","displayName":"GPT-4.1"},{"id":"o3","displayName":"o3"},{"id":"o4-mini","displayName":"o4 Mini"}]';

const DEFAULT_OPENROUTER_MODELS = '[{"id":"anthropic/claude-sonnet-4.5","displayName":"Claude Sonnet 4.5","isDefault":true},{"id":"openai/gpt-5.2-chat","displayName":"GPT-5.2"},{"id":"openai/gpt-4.1-mini","displayName":"GPT-4.1 Mini"},{"id":"openai/gpt-4.1","displayName":"GPT-4.1"},{"id":"anthropic/claude-opus-4.1","displayName":"Claude Opus 4.1"},{"id":"google/gemini-2.5-flash-lite","displayName":"Gemini 2.5 Flash Lite"},{"id":"google/gemini-2.5-flash","displayName":"Gemini 2.5 Flash"},{"id":"meta-llama/llama-4-maverick","displayName":"Llama 4 Maverick","isOpenSource":true},{"id":"cognitivecomputations/dolphin-mistral-24b-venice-edition:free","displayName":"Venice: Uncensored","isFree":true,"isOpenSource":true,"isUncensored":true}]';

// Groq free tier has strict rate limits - only Llama 3.3 70B works reliably with RAG contexts
// Users with paid Groq tiers can add more models: llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
const DEFAULT_GROQ_MODELS = '[{"id":"llama-3.3-70b-versatile","displayName":"Llama 3.3 70B"}]';

// Default RAG system prompt components (pre and post context)
// The system assembles: PRE_CONTEXT + {{context}} + POST_CONTEXT
const DEFAULT_RAG_PRE_CONTEXT = 'You are a helpful and friendly AI assistant. Your primary goal is to provide accurate, useful information based on the documents and knowledge available to you.\n\nWhen answering questions:\n1. ALWAYS check the context first for relevant information\n2. Use a warm, approachable tone while maintaining professionalism\n3. Cite specific documents or sources when referencing the context\n4. Break down complex topics into easy-to-understand explanations\n5. If information isn\'t in the context, acknowledge this clearly';

const DEFAULT_RAG_POST_CONTEXT = 'Based on the context provided, offer comprehensive and helpful answers. If specific information is missing, suggest how the user might rephrase their question or what additional information would be helpful.';

function getStandardTemplate() {
  return `# ChatRAG Configuration
# Generated automatically on first run
# Visit http://localhost:3333 (npm run config) to configure visually

# -----------------------------
# GENERAL
# -----------------------------
NEXT_PUBLIC_DEFAULT_LANGUAGE=en
# Default Theme (Options: system, dark, light)
NEXT_PUBLIC_DEFAULT_THEME=system
NEXT_PUBLIC_DEFAULT_BACKGROUND_IMAGE=

# -----------------------------
# FEATURES
# -----------------------------
NEXT_PUBLIC_AUTH_ENABLED=true
NEXT_PUBLIC_WEB_SEARCH_ENABLED=true
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=true
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=true
NEXT_PUBLIC_3D_GENERATION_ENABLED=true
NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=true
NEXT_PUBLIC_MCP_SYSTEM_ENABLED=true
NEXT_PUBLIC_SHOW_SOURCES_ENABLED=true

# -----------------------------
# WHATSAPP INTEGRATION
# -----------------------------
NEXT_PUBLIC_WHATSAPP_ENABLED=true

# WhatsApp Provider Configuration
WHATSAPP_PROVIDER=flyio
FLYIO_BAILEYS_URL=
FLYIO_API_KEY=
KOYEB_BAILEYS_URL=
KOYEB_API_KEY=
WHATSAPP_WEBHOOK_URL=
WHATSAPP_WEBHOOK_SECRET=
WHATSAPP_ENABLE_MCP=false
WHATSAPP_ENABLE_WEB_SEARCH=false
WHATSAPP_DEFAULT_MODEL=openai/gpt-4o-mini
WHATSAPP_MAX_TOKENS=2048
WHATSAPP_MAX_SESSIONS_PER_USER=5
WHATSAPP_MESSAGE_QUEUE_SIZE=10

# -----------------------------
# AI MODELS
# -----------------------------
# OpenAI - Required for embeddings
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# OpenAI Image Generation (legacy)
OPENAI_IMAGE_MODEL=gpt-image-1

# OpenRouter - Used for various AI models
OPENROUTER_API_KEY=

# Groq - Used for fast inference
GROQ_API_KEY=

# AI Provider Selection
# Options: 'openai' | 'openrouter' | 'groq'
NEXT_PUBLIC_AI_PROVIDER=openrouter

# Available Models Configuration (JSON format)
NEXT_PUBLIC_OPENAI_MODELS=${DEFAULT_OPENAI_MODELS}
NEXT_PUBLIC_OPENROUTER_MODELS=${DEFAULT_OPENROUTER_MODELS}
NEXT_PUBLIC_GROQ_MODELS=${DEFAULT_GROQ_MODELS}

# LlamaCloud - Used for document processing
LLAMA_CLOUD_API_KEY=

# Image Generation
IMAGE_GENERATION_PROVIDER=fal
VIDEO_GENERATION_PROVIDER=fal
REPLICATE_API_TOKEN=
FAL_API_KEY=
USE_REPLICATE_PROVIDER=false

# Fal.ai Model Configuration
FAL_IMAGE_MODEL=fal-ai/bytedance/seedream/v4/text-to-image
FAL_IMAGE_TO_IMAGE_MODEL=fal-ai/bytedance/seedream/v4/edit

# Video Models - Text to Video
FAL_VIDEO_MODEL=fal-ai/veo3/fast
FAL_VIDEO_TEXT_MODEL=fal-ai/veo3/fast
FAL_VIDEO_TEXT_FAST_MODEL=fal-ai/veo3/fast

# Video Models - Image to Video
FAL_VIDEO_IMAGE_MODEL=fal-ai/veo3/image-to-video
FAL_VIDEO_IMAGE_FAST_MODEL=fal-ai/veo3/fast/image-to-video

# Other Models
FAL_3D_MODEL=fal-ai/trellis

# Replicate Model Configuration (Fallback)
REPLICATE_3D_MODEL=firtoz/trellis:4876f2a8da1c544772dffa32e8889da4a1bab3a1f5c1937bfcfccb99ae347251

# Web Search
EXA_API_KEY=

# -----------------------------
# WEB SCRAPING (FIRECRAWL)
# -----------------------------
NEXT_PUBLIC_FIRECRAWL_ENABLED=false
NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD=true
FIRECRAWL_API_KEY=

FIRECRAWL_ONLY_MAIN_CONTENT=true
FIRECRAWL_WAIT_FOR_JS=2000

# -----------------------------
# AUDIO
# -----------------------------
NEXT_PUBLIC_TTS_DISABLED=false
NEXT_PUBLIC_VOICE_PROVIDER=openai
NEXT_PUBLIC_STT_DISABLED=false
NEXT_PUBLIC_AUDIO_AUTOPLAY=false

# ElevenLabs Configuration (optional)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_VOICE_STABILITY=0.5
ELEVENLABS_SIMILARITY_BOOST=0.5
ELEVENLABS_SPEAKER_BOOST=true
ELEVENLABS_VOICE_SPEED=1.0

# -----------------------------
# DATABASE (REQUIRED)
# -----------------------------
# Get these from your Supabase project settings
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# -----------------------------
# DEPLOYMENT MODE
# -----------------------------
# Choose deployment mode: single-tenant or multi-tenant
# single-tenant: Shared knowledge base with user-isolated chats (simpler setup)
# multi-tenant: Organization-based isolation with team features (advanced)
# See DEPLOYMENT_MODES.md for complete documentation
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant

# Multi-tenant features (only used when NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant)
ENABLE_ORGANIZATIONS=true
ENABLE_TEAM_INVITES=true
ENABLE_STORAGE_QUOTAS=true
ENABLE_USAGE_ANALYTICS=true

# -----------------------------
# AUTHENTICATION
# -----------------------------
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Config UI proxy target for the main ChatRAG app.
# Set this when the Config UI runs behind a reverse proxy or different host.
CHATRAG_APP_URL=http://localhost:3000

# GitHub OAuth (optional)
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# -----------------------------
# EMAIL
# -----------------------------
RESEND_API_KEY=

# Custom SMTP Settings (optional)
NEXT_PUBLIC_CUSTOM_SMTP_ENABLED=false
NEXT_PUBLIC_SMTP_FROM_NAME=ChatRAG Support
NEXT_PUBLIC_SMTP_FROM_EMAIL=support@example.com

# -----------------------------
# PAYMENTS - STRIPE
# -----------------------------
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=
NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE=

# -----------------------------
# PAYMENTS - POLAR
# -----------------------------
POLAR_ACCESS_TOKEN=
POLAR_ORGANIZATION_ID=
POLAR_WEBHOOK_SECRET=
POLAR_ORGANIZATION_SLUG=
NEXT_PUBLIC_POLAR_PRICE_ID_PRO=
NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE=
NEXT_PUBLIC_POLAR_CHECKOUT_PRO=
NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE=

# -----------------------------
# BRANDING
# -----------------------------
NEXT_PUBLIC_APP_NAME=ChatRAG
NEXT_PUBLIC_SITE_TITLE=
NEXT_PUBLIC_FAVICON_URL=/favicon.svg
NEXT_PUBLIC_HEADER_LOGO_TYPE=text
NEXT_PUBLIC_HEADER_LOGO_TEXT=ChatRAG
NEXT_PUBLIC_HEADER_LOGO_URL=
NEXT_PUBLIC_AI_RESPONSE_LOGO_URL=
NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=true
NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=3
NEXT_PUBLIC_AI_LOGO_TYPE=none
NEXT_PUBLIC_USE_DEFAULT_AI_LOGO=false

# -----------------------------
# SUGGESTIONS
# -----------------------------
NEXT_PUBLIC_SHOW_SUGGESTIONS=true

# -----------------------------
# WELCOME TEXT & PERSONALIZATION
# -----------------------------
NEXT_PUBLIC_WELCOME_TEXT=What can I help with?
NEXT_PUBLIC_WELCOME_TEXT_MODE=custom
NEXT_PUBLIC_WELCOME_TEXT_GRADIENT=none
NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS={}
NEXT_PUBLIC_WELCOME_MESSAGES=["Hey, {Username}! What can I help you with today?","Ready when you are.","Good to see you, {Username}.","What's on your mind?","Hi there, {Username}. How can I assist?","Let's get started!","Welcome back, {Username}!","How can I help?","Hey! Ready to dive in?","Hi, {Username}. What would you like to explore today?"]
NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS={}
NEXT_PUBLIC_MANUAL_USERNAME=

# -----------------------------
# NAME EXTRACTION
# -----------------------------
NEXT_PUBLIC_NAME_EXTRACTION_ENABLED=true
NEXT_PUBLIC_NAME_EXTRACTION_MODEL=gpt-4o-mini

# -----------------------------
# UI CUSTOMIZATION
# -----------------------------
NEXT_PUBLIC_CHAT_INPUT_TEXT_SIZE=18
NEXT_PUBLIC_SUGGESTION_GROUPS=

# Chat Input Border Animation
NEXT_PUBLIC_CHAT_BORDER_WIDTH=2.5
NEXT_PUBLIC_CHAT_BORDER_COLOR=#FF6417
NEXT_PUBLIC_CHAT_BORDER_GRADIENT_ENABLED=false
NEXT_PUBLIC_CHAT_BORDER_GRADIENT_COLOR_1=#FF6417
NEXT_PUBLIC_CHAT_BORDER_GRADIENT_COLOR_2=#FF1744
NEXT_PUBLIC_CHAT_BORDER_ANIMATION_SPEED=14
NEXT_PUBLIC_CHAT_BORDER_ENABLED=true
NEXT_PUBLIC_CHAT_BORDER_LENGTH=220

# -----------------------------
# EMBED WIDGET
# -----------------------------
NEXT_PUBLIC_EMBED_ENABLED=false
NEXT_PUBLIC_EMBED_TITLE=AI Assistant
NEXT_PUBLIC_EMBED_PRIMARY_COLOR=
NEXT_PUBLIC_EMBED_POSITION=bottom-right
NEXT_PUBLIC_EMBED_AUTO_OPEN=false
NEXT_PUBLIC_EMBED_GREETING=Hello! How can I help you today?
NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS=*
NEXT_PUBLIC_EMBED_MODEL=
EMBED_REQUIRE_AUTH=false

# Embed Widget Suggested Prompts
NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED=true
NEXT_PUBLIC_EMBED_SUGGESTIONS=["What can you help me with?","How does this work?","Tell me about your features","Get started guide"]

# -----------------------------
# DOCUMENT PROCESSING
# -----------------------------
NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=true
NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD=false

# -----------------------------
# RAG SYSTEM PROMPT
# -----------------------------
# The system assembles the prompt as: PRE_CONTEXT + {{context}} + POST_CONTEXT
# Use \\n for newlines within the values
RAG_PRE_CONTEXT=${DEFAULT_RAG_PRE_CONTEXT}
RAG_POST_CONTEXT=${DEFAULT_RAG_POST_CONTEXT}

# -----------------------------
# RAG CONFIGURATION
# -----------------------------
# Number of documents to retrieve (optimized for accuracy)
RAG_INITIAL_MATCH_COUNT=60
# Minimum similarity threshold (optimized for accuracy)
RAG_SIMILARITY_THRESHOLD=0.45

# -----------------------------
# RAG BEHAVIOR MODE
# -----------------------------
# Controls how strictly the AI follows your knowledge base
# strict: Only use knowledge base, refuse if info not found (default)
# balanced: Prioritize KB, supplement with general knowledge when helpful
# flexible: Use KB as one source among many, blend naturally
# bypass: Ignore knowledge base entirely, pure ChatGPT-like behavior
RAG_BEHAVIOR_MODE=strict

# -----------------------------
# RAG CONFIGURATION (Unified Optimized System)
# -----------------------------
# Unified RAG Settings - All features can be toggled individually
RAG_MULTI_PASS=true
RAG_ADAPTIVE_RETRIEVAL=true
RAG_QUERY_ENHANCEMENT=false
RAG_ADJACENT_CHUNKS=true
RAG_CACHE_ENABLED=true
RAG_ADJACENCY_WINDOW=2
RAG_MATCH_MULTIPLIER=3

# RAG Optimization Parameters  
# Optimized for finding specific information with high accuracy
RAG_MMR_LAMBDA=0.85
RAG_MIN_CONFIDENCE=0.7
RAG_FINAL_RESULT_COUNT=25
RAG_DIVERSITY_WEIGHT=0.15

# RAG Advanced Settings
RAG_ENABLE_ADJACENT_CHUNKS=true
RAG_ENABLE_HYBRID_SEARCH=false
RAG_MAX_RETRIEVAL_PASSES=2
RAG_COMPLETENESS_CONFIDENCE=0.7
RAG_PERFORMANCE_MODE=balanced
RAG_RERANKING=true
RAG_RERANKING_STRATEGY=hybrid

# RAG Frontend Settings (used by optimized-search.ts)
NEXT_PUBLIC_RAG_CACHE_ENABLED=true
NEXT_PUBLIC_RAG_CACHE_TTL=3600
NEXT_PUBLIC_RAG_QUERY_ENHANCEMENT_ENABLED=false
NEXT_PUBLIC_RAG_RERANKING_ENABLED=false
NEXT_PUBLIC_RAG_RERANKING_STRATEGY=hybrid
NEXT_PUBLIC_RAG_PERFORMANCE_MODE=balanced
NEXT_PUBLIC_RAG_ENHANCEMENT_CONFIDENCE_THRESHOLD=0.7

# Temporal and Financial Intelligence (Unified RAG)
RAG_TEMPORAL_BOOST=true
RAG_FINANCIAL_BOOST=true
RAG_TEMPORAL_MATCHING=false
RAG_FALLBACK_LOWER_THRESHOLD=true
RAG_TEMPORAL_CONFIDENCE_MIN=0.6
RAG_FINANCIAL_CONFIDENCE_MIN=0.7
RAG_EXTRACT_KEY_TERMS=true
RAG_MAX_KEY_TERMS=10
RAG_SEMANTIC_CLASSIFICATION=true

# Query Analysis Thresholds (Temporal/Financial Intelligence)
RAG_EXACT_THRESHOLD=0.75
RAG_HIGH_THRESHOLD=0.65
RAG_MEDIUM_THRESHOLD=0.55
RAG_LOW_THRESHOLD=0.45

# -----------------------------
# DEBUGGING
# -----------------------------
DEBUG_RAG=false

# -----------------------------
# TITLE GENERATION SYSTEM
# -----------------------------
# AI-powered title generation using Claude Haiku 4.5
CHAT_TITLE_MODEL=anthropic/claude-haiku-4.5
CHAT_TITLE_MAX_TOKENS=100
CHAT_TITLE_TEMPERATURE=0.5

# -----------------------------
# LLAMACLOUD DOCUMENT PARSING
# -----------------------------
# Basic parsing configuration
LLAMACLOUD_PARSING_MODE=balanced
LLAMACLOUD_CHUNK_STRATEGY=sentence
LLAMACLOUD_CHUNK_SIZE=2500
LLAMACLOUD_CHUNK_OVERLAP=992
LLAMACLOUD_MULTIMODAL_PARSING=true

# Advanced LlamaParse configuration
# Parse mode: parse_page_with_agent uses AI for intelligent parsing (10-90 credits/page)
LLAMACLOUD_PARSE_MODE=parse_page_with_agent
# Model for parsing: openai-gpt-4-1-mini is the most economical (10 credits/page)
LLAMACLOUD_PARSE_MODEL=openai-gpt-4-1-mini
# High resolution OCR for scanned documents (slower but more accurate)
LLAMACLOUD_HIGH_RES_OCR=true
# Adaptive long table detection and handling
LLAMACLOUD_ADAPTIVE_LONG_TABLE=true
# Extract outlined tables from documents
LLAMACLOUD_OUTLINED_TABLE_EXTRACTION=true
# Output tables as HTML for better formatting
LLAMACLOUD_OUTPUT_TABLES_AS_HTML=true

# -----------------------------
# MCP CONFIGURATION
# -----------------------------
MCP_ZAPIER_ENDPOINT=
MCP_CUSTOM_SERVERS=[]

# -----------------------------
# REASONING/THINKING MODELS
# -----------------------------
NEXT_PUBLIC_REASONING_ENABLED=true
NEXT_PUBLIC_DEFAULT_REASONING_EFFORT=medium
NEXT_PUBLIC_MAX_REASONING_TOKENS=8000
NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT=false
NEXT_PUBLIC_RAG_REASONING_ENABLED=false
REASONING_COST_MULTIPLIER=1.5

# -----------------------------
# NANGO INTEGRATION (Document Connectors)
# -----------------------------
# Enable/disable third-party document connectors (Google Drive, Notion, Dropbox, etc.)
NEXT_PUBLIC_NANGO_ENABLED=false

# Nango Secret Key - for backend SDK (get from https://app.nango.dev/dev/environment-settings)
NANGO_SECRET_KEY=

# Webhook signature verification secret (optional - set this in Nango dashboard)
NANGO_WEBHOOK_SECRET=

# Nango host (change for self-hosted deployments)
NANGO_HOST=https://api.nango.dev

# Sync configuration
NANGO_SUPPORTED_FILE_TYPES=pdf,doc,docx,txt,md,html,pptx,xlsx
NANGO_MAX_FILES_PER_SYNC=100
NANGO_SYNC_INTERVAL_HOURS=1

# -----------------------------
# CONNECTORS MANAGEMENT
# -----------------------------
# Enable/disable entire connectors feature
NEXT_PUBLIC_CONNECTORS_ENABLED=true
# Show connectors section on Document Dashboard
CONNECTORS_SHOW_ON_DASHBOARD=true

`;
}

function checkAndCreateEnvFile() {
  // Check if .env.local already exists
  if (fs.existsSync(ENV_PATH)) {
    console.log('✅ .env.local file found');
    return false; // File already exists
  }

  console.log('\n📝 No .env.local file found. Creating one for you...');

  try {
    // Create the .env.local file with standard template
    const template = getStandardTemplate();
    fs.writeFileSync(ENV_PATH, template);

    console.log('✅ Created .env.local with default configuration (single-tenant mode)');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Add your Supabase credentials (required)');
    console.log('   2. Run the appropriate SQL setup in Supabase:');
    console.log('      - For single-tenant: supabase/single-tenant-setup.sql');
    console.log('      - For multi-tenant: supabase/multi-tenant-setup.sql');
    console.log('   3. Add your OpenAI API key (required for embeddings)');
    console.log('   4. Add your LlamaCloud API key (required for document processing/RAG)');
    console.log('   5. Add your OpenRouter API key (for AI models)');
    console.log('   6. Add your Groq API key (for fast AI models)');
    console.log('\n💡 Run "npm run config" to configure everything visually at http://localhost:3333');
    console.log('📖 See DEPLOYMENT_MODES.md for deployment mode documentation');
    console.log('');

    return true; // File was created
  } catch (error) {
    console.error('❌ Error creating .env.local:', error);
    process.exit(1);
  }
}

// Run the checks
const wasEnvCreated = checkAndCreateEnvFile();

// Export for use in other scripts
module.exports = { checkAndCreateEnvFile };
