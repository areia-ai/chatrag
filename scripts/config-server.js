const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { exec, spawn } = require('child_process');
const multer = require('multer');
const app = express();
const PORT = 3333;

// Resolve project root (one level up from this script directory)
const REPO_ROOT = path.resolve(__dirname, '..');

// Helper function to get deployment mode from .env.local
function getDeploymentMode() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    return 'single-tenant';
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=(\S+)/);
  return match ? match[1] : 'single-tenant';
}

function isMultiTenant() {
  return getDeploymentMode() === 'multi-tenant';
}

// Helper function to get env variable from .env.local
function getEnvVar(key) {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    return null;
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^${key}=(.*)$`, 'm');
  const match = envContent.match(regex);
  return match ? match[1].trim() : null;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getMainAppBaseUrl() {
  return normalizeBaseUrl(
    process.env.CHATRAG_APP_URL ||
    getEnvVar('CHATRAG_APP_URL') ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    getEnvVar('NEXT_PUBLIC_SITE_URL') ||
    'http://localhost:3000'
  );
}

function getMainAppUrl(apiPath) {
  return new URL(apiPath, getMainAppBaseUrl()).toString();
}

function createMainAppRequest(apiPath, method, headers = {}) {
  const target = new URL(apiPath, getMainAppBaseUrl());
  const client = target.protocol === 'https:' ? require('https') : require('http');

  return {
    client,
    url: target.toString(),
    options: {
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers
    }
  };
}

function mainAppConnectionError(error) {
  return {
    error: `Unable to connect to main ChatRAG app at ${getMainAppBaseUrl()}. Check CHATRAG_APP_URL or NEXT_PUBLIC_SITE_URL, and make sure the app server is running.`,
    details: error.message
  };
}

// Helper function to get Supabase config
function getSupabaseConfig() {
  return {
    url: getEnvVar('NEXT_PUBLIC_SUPABASE_URL'),
    serviceRoleKey: getEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  };
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const type = req.body.type || 'ai';
    const uploadDir = path.join(REPO_ROOT, 'public', 'logos', type);

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const type = req.body.type || 'ai';
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    cb(null, `${type}-logo-${timestamp}${extension}`);
  }
});

const upload = multer({ storage: storage });

// Separate multer config for document processing (needs memory storage for proxy)
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit
  }
});

// Create a directory for our UI files if it doesn't exist
const configUiDir = path.join(__dirname, 'config-ui');
if (!fs.existsSync(configUiDir)) {
  fs.mkdirSync(configUiDir, { recursive: true });
}

// Create a basic UI if it doesn't exist
if (!fs.existsSync(path.join(configUiDir, 'index.html'))) {
  // Copy UI files from the source to the target
  console.log('Creating config UI...');

  // Create index.html with basic content
  const indexHtml = fs.readFileSync(path.join(configUiDir, 'index.html'), 'utf8');

  // Inject our fix script
  const modifiedHtml = indexHtml.replace(
    '</body>',
    '    <script src="/config-ui-fix.js"></script>\n  </body>'
  );

  fs.writeFileSync(path.join(configUiDir, 'index.html'), modifiedHtml);
  console.log('Created index.html with fix script');
}

// Serve static files from the config-ui directory
app.use(express.static(configUiDir));
app.use(express.json());

// Also serve static files from the public directory
app.use(express.static(path.join(REPO_ROOT, 'public')));

// Default system prompt for RAG (used for backwards compatibility fallback only)
// New installations should use RAG_PRE_CONTEXT and RAG_POST_CONTEXT
const DEFAULT_SYSTEM_PROMPT = `You are a helpful and friendly AI assistant. Your primary goal is to provide accurate, useful information based on the documents and knowledge available to you.

When answering questions:
1. ALWAYS check the context first for relevant information
2. Use a warm, approachable tone while maintaining professionalism
3. Cite specific documents or sources when referencing the context
4. Break down complex topics into easy-to-understand explanations
5. If information isn't in the context, acknowledge this clearly

Context:
{{context}}

Based on the context provided, offer comprehensive and helpful answers. If specific information is missing, suggest how the user might rephrase their question or what additional information would be helpful.`;

// Default model configurations
const DEFAULT_OPENAI_MODELS = '[{"id":"gpt-4.1-mini","displayName":"GPT-4.1 Mini"},{"id":"gpt-4.1","displayName":"GPT-4.1"},{"id":"o3","displayName":"o3"},{"id":"o4-mini","displayName":"o4 Mini"}]';

const DEFAULT_OPENROUTER_MODELS = '[{"id":"anthropic/claude-sonnet-4.5","displayName":"Claude Sonnet 4.5","isDefault":true},{"id":"openai/gpt-5.2-chat","displayName":"GPT-5.2"},{"id":"openai/gpt-5-mini","displayName":"GPT-5 Mini"},{"id":"openai/gpt-5","displayName":"GPT-5"},{"id":"anthropic/claude-opus-4.1","displayName":"Claude Opus 4.1"},{"id":"google/gemini-2.5-flash-lite","displayName":"Gemini 2.5 Flash Lite"},{"id":"google/gemini-2.5-flash","displayName":"Gemini 2.5 Flash"},{"id":"meta-llama/llama-4-maverick","displayName":"Llama 4 Maverick","isOpenSource":true},{"id":"cognitivecomputations/dolphin-mistral-24b-venice-edition:free","displayName":"Venice: Uncensored","isFree":true,"isOpenSource":true,"isUncensored":true}]';

// API endpoint to get current .env values
app.get('/api/config', (req, res) => {
  try {
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, 'utf8')
      : '';

    const config = dotenv.parse(envContent || '');

    // Send the actual values since we're running locally
    res.json({
      config: config,
      hasFile: fs.existsSync(envPath),
      envPath: envPath // For debugging
    });
  } catch (error) {
    console.error('Error loading configuration:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to update .env.local file
app.post('/api/config', (req, res) => {
  try {
    // Allow either { config, fullValues } or just { config } in the request body
    // If only config is provided, use it as fullValues too
    const { config } = req.body;
    const rawFullValues = req.body.fullValues || req.body.config || req.body;

    // Filter out invalid environment variable names and template placeholders
    const fullValues = filterValidEnvVars(rawFullValues);

    // Debug logging
    console.log('API: Received config update request with keys:', Object.keys(fullValues).join(', '));

    if (!config && !fullValues) {
      return res.status(400).json({ error: "No configuration data provided" });
    }

    // Validate that we have actual configuration values
    const hasConfigValues = Object.keys(fullValues).some(key =>
      key.startsWith('NEXT_PUBLIC_') ||
      key.endsWith('_API_KEY') ||
      key.endsWith('_KEY')
    );

    if (!hasConfigValues) {
      console.error('API: No valid configuration values found in request');
      return res.status(400).json({ error: "No valid configuration values found. Please ensure you're sending the configuration data correctly." });
    }

    const envPath = path.join(REPO_ROOT, '.env.local');

    // Debug log
    console.log('Creating .env.local with defaults:');
    console.log('DEFAULT_OPENAI_MODELS:', DEFAULT_OPENAI_MODELS);
    console.log('DEFAULT_OPENROUTER_MODELS:', DEFAULT_OPENROUTER_MODELS);

    // First check if the file exists
    if (!fs.existsSync(envPath)) {
      // If it doesn't exist, create a new one with default structure
      const newContent = `# ChatRAG Configuration

# -----------------------------
# FEATURES
# -----------------------------
# Enable/disable authentication
${fullValues.NEXT_PUBLIC_AUTH_ENABLED !== undefined ? `NEXT_PUBLIC_AUTH_ENABLED=${fullValues.NEXT_PUBLIC_AUTH_ENABLED}` : 'NEXT_PUBLIC_AUTH_ENABLED=false'}
# Enable/disable web search functionality
${fullValues.NEXT_PUBLIC_WEB_SEARCH_ENABLED !== undefined ? `NEXT_PUBLIC_WEB_SEARCH_ENABLED=${fullValues.NEXT_PUBLIC_WEB_SEARCH_ENABLED}` : 'NEXT_PUBLIC_WEB_SEARCH_ENABLED=true'}
# Enable/disable image generation
${fullValues.NEXT_PUBLIC_IMAGE_GENERATION_ENABLED !== undefined ? `NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=${fullValues.NEXT_PUBLIC_IMAGE_GENERATION_ENABLED}` : 'NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=false'}
# Enable/disable video generation
${fullValues.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED !== undefined ? `NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=${fullValues.NEXT_PUBLIC_VIDEO_GENERATION_ENABLED}` : 'NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=false'}
# Enable/disable 3D model generation
${fullValues.NEXT_PUBLIC_3D_GENERATION_ENABLED !== undefined ? `NEXT_PUBLIC_3D_GENERATION_ENABLED=${fullValues.NEXT_PUBLIC_3D_GENERATION_ENABLED}` : 'NEXT_PUBLIC_3D_GENERATION_ENABLED=false'}
# Enable/disable MCP tools list UI
${fullValues.NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED !== undefined ? `NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=${fullValues.NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED}` : 'NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=false'}
# Enable/disable entire MCP system
${fullValues.NEXT_PUBLIC_MCP_SYSTEM_ENABLED !== undefined ? `NEXT_PUBLIC_MCP_SYSTEM_ENABLED=${fullValues.NEXT_PUBLIC_MCP_SYSTEM_ENABLED}` : 'NEXT_PUBLIC_MCP_SYSTEM_ENABLED=false'}
# Enable/disable source citations (e.g., **Source:** Document Name) in AI responses
${fullValues.NEXT_PUBLIC_SHOW_SOURCES_ENABLED !== undefined ? `NEXT_PUBLIC_SHOW_SOURCES_ENABLED=${fullValues.NEXT_PUBLIC_SHOW_SOURCES_ENABLED}` : 'NEXT_PUBLIC_SHOW_SOURCES_ENABLED=true'}

# -----------------------------
# AI MODELS
# -----------------------------
# OpenAI (Required for embeddings and optional model access)
${fullValues.OPENAI_API_KEY ? `OPENAI_API_KEY=${fullValues.OPENAI_API_KEY}` : 'OPENAI_API_KEY='}
# Embedding model: text-embedding-ada-002, text-embedding-3-small, text-embedding-3-large
${fullValues.OPENAI_EMBEDDING_MODEL !== undefined ? `OPENAI_EMBEDDING_MODEL=${fullValues.OPENAI_EMBEDDING_MODEL}` : 'OPENAI_EMBEDDING_MODEL=text-embedding-3-small'}

# OpenRouter (Required for accessing various AI models)
${fullValues.OPENROUTER_API_KEY ? `OPENROUTER_API_KEY=${fullValues.OPENROUTER_API_KEY}` : 'OPENROUTER_API_KEY='}

# AI Provider Selection
${fullValues.NEXT_PUBLIC_AI_PROVIDER !== undefined ? `NEXT_PUBLIC_AI_PROVIDER=${fullValues.NEXT_PUBLIC_AI_PROVIDER}` : 'NEXT_PUBLIC_AI_PROVIDER=openrouter'}

# Available Models Configuration (JSON format)
${fullValues.NEXT_PUBLIC_OPENAI_MODELS !== undefined ? `NEXT_PUBLIC_OPENAI_MODELS=${fullValues.NEXT_PUBLIC_OPENAI_MODELS}` : `NEXT_PUBLIC_OPENAI_MODELS=${DEFAULT_OPENAI_MODELS}`}
${fullValues.NEXT_PUBLIC_OPENROUTER_MODELS !== undefined ? `NEXT_PUBLIC_OPENROUTER_MODELS=${fullValues.NEXT_PUBLIC_OPENROUTER_MODELS}` : `NEXT_PUBLIC_OPENROUTER_MODELS=${DEFAULT_OPENROUTER_MODELS}`}

# Custom Token Limits
${fullValues.USE_CUSTOM_TOKEN_LIMIT !== undefined ? `USE_CUSTOM_TOKEN_LIMIT=${fullValues.USE_CUSTOM_TOKEN_LIMIT}` : 'USE_CUSTOM_TOKEN_LIMIT=false'}
${fullValues.MAX_COMPLETION_TOKENS !== undefined ? `MAX_COMPLETION_TOKENS=${fullValues.MAX_COMPLETION_TOKENS}` : 'MAX_COMPLETION_TOKENS=4096'}

# LlamaCloud (Used for document parsing)
${fullValues.LLAMA_CLOUD_API_KEY ? `LLAMA_CLOUD_API_KEY=${fullValues.LLAMA_CLOUD_API_KEY}` : 'LLAMA_CLOUD_API_KEY='}

# Image Generation
${fullValues.IMAGE_GENERATION_PROVIDER !== undefined ? `IMAGE_GENERATION_PROVIDER=${fullValues.IMAGE_GENERATION_PROVIDER}` : 'IMAGE_GENERATION_PROVIDER=fal'}
${fullValues.VIDEO_GENERATION_PROVIDER !== undefined ? `VIDEO_GENERATION_PROVIDER=${fullValues.VIDEO_GENERATION_PROVIDER}` : 'VIDEO_GENERATION_PROVIDER=fal'}
${fullValues.REPLICATE_API_TOKEN ? `REPLICATE_API_TOKEN=${fullValues.REPLICATE_API_TOKEN}` : 'REPLICATE_API_TOKEN='}
${fullValues.FAL_API_KEY ? `FAL_API_KEY=${fullValues.FAL_API_KEY}` : 'FAL_API_KEY='}
${fullValues.USE_REPLICATE_PROVIDER !== undefined ? `USE_REPLICATE_PROVIDER=${fullValues.USE_REPLICATE_PROVIDER}` : 'USE_REPLICATE_PROVIDER=false'}

# OpenAI Image Generation Settings
${fullValues.USE_OPENAI_IMAGE !== undefined ? `USE_OPENAI_IMAGE=${fullValues.USE_OPENAI_IMAGE}` : 'USE_OPENAI_IMAGE=false'}
${fullValues.OPENAI_IMAGE_QUALITY !== undefined ? `OPENAI_IMAGE_QUALITY=${fullValues.OPENAI_IMAGE_QUALITY}` : 'OPENAI_IMAGE_QUALITY=auto'}
${fullValues.OPENAI_IMAGE_BACKGROUND !== undefined ? `OPENAI_IMAGE_BACKGROUND=${fullValues.OPENAI_IMAGE_BACKGROUND}` : 'OPENAI_IMAGE_BACKGROUND=opaque'}
${fullValues.OPENAI_IMAGE_FORMAT !== undefined ? `OPENAI_IMAGE_FORMAT=${fullValues.OPENAI_IMAGE_FORMAT}` : 'OPENAI_IMAGE_FORMAT=png'}
${fullValues.OPENAI_IMAGE_MODERATION !== undefined ? `OPENAI_IMAGE_MODERATION=${fullValues.OPENAI_IMAGE_MODERATION}` : 'OPENAI_IMAGE_MODERATION=auto'}

# Web Search
${fullValues.EXA_API_KEY ? `EXA_API_KEY=${fullValues.EXA_API_KEY}` : 'EXA_API_KEY='}

# Web Scraper (Firecrawl)
${fullValues.NEXT_PUBLIC_FIRECRAWL_ENABLED !== undefined ? `NEXT_PUBLIC_FIRECRAWL_ENABLED=${fullValues.NEXT_PUBLIC_FIRECRAWL_ENABLED}` : 'NEXT_PUBLIC_FIRECRAWL_ENABLED=false'}
${fullValues.NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD !== undefined ? `NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD=${fullValues.NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD}` : 'NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD=true'}
${fullValues.FIRECRAWL_API_KEY ? `FIRECRAWL_API_KEY=${fullValues.FIRECRAWL_API_KEY}` : 'FIRECRAWL_API_KEY='}
${fullValues.FIRECRAWL_OUTPUT_FORMAT !== undefined ? `FIRECRAWL_OUTPUT_FORMAT=${fullValues.FIRECRAWL_OUTPUT_FORMAT}` : 'FIRECRAWL_OUTPUT_FORMAT=html'}
${fullValues.FIRECRAWL_ONLY_MAIN_CONTENT !== undefined ? `FIRECRAWL_ONLY_MAIN_CONTENT=${fullValues.FIRECRAWL_ONLY_MAIN_CONTENT}` : 'FIRECRAWL_ONLY_MAIN_CONTENT=true'}
${fullValues.FIRECRAWL_WAIT_FOR_JS !== undefined ? `FIRECRAWL_WAIT_FOR_JS=${fullValues.FIRECRAWL_WAIT_FOR_JS}` : 'FIRECRAWL_WAIT_FOR_JS=2000'}

# -----------------------------
# AUDIO
# -----------------------------
# Text-to-Speech Settings
${fullValues.NEXT_PUBLIC_TTS_DISABLED !== undefined ? `NEXT_PUBLIC_TTS_DISABLED=${fullValues.NEXT_PUBLIC_TTS_DISABLED}` : 'NEXT_PUBLIC_TTS_DISABLED=false'}
${fullValues.NEXT_PUBLIC_VOICE_PROVIDER !== undefined ? `NEXT_PUBLIC_VOICE_PROVIDER=${fullValues.NEXT_PUBLIC_VOICE_PROVIDER}` : 'NEXT_PUBLIC_VOICE_PROVIDER=openai'}

# ElevenLabs Configuration
${fullValues.ELEVENLABS_API_KEY ? `ELEVENLABS_API_KEY=${fullValues.ELEVENLABS_API_KEY}` : 'ELEVENLABS_API_KEY='}
${fullValues.ELEVENLABS_VOICE_ID !== undefined ? `ELEVENLABS_VOICE_ID=${fullValues.ELEVENLABS_VOICE_ID}` : 'ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL'}
${fullValues.ELEVENLABS_MODEL_ID !== undefined ? `ELEVENLABS_MODEL_ID=${fullValues.ELEVENLABS_MODEL_ID}` : 'ELEVENLABS_MODEL_ID=eleven_multilingual_v2'}
${fullValues.ELEVENLABS_VOICE_SPEED !== undefined ? `ELEVENLABS_VOICE_SPEED=${fullValues.ELEVENLABS_VOICE_SPEED}` : 'ELEVENLABS_VOICE_SPEED=1.0'}
${fullValues.ELEVENLABS_VOICE_STABILITY !== undefined ? `ELEVENLABS_VOICE_STABILITY=${fullValues.ELEVENLABS_VOICE_STABILITY}` : 'ELEVENLABS_VOICE_STABILITY=0.5'}
${fullValues.ELEVENLABS_SIMILARITY_BOOST !== undefined ? `ELEVENLABS_SIMILARITY_BOOST=${fullValues.ELEVENLABS_SIMILARITY_BOOST}` : 'ELEVENLABS_SIMILARITY_BOOST=0.5'}
${fullValues.ELEVENLABS_SPEAKER_BOOST !== undefined ? `ELEVENLABS_SPEAKER_BOOST=${fullValues.ELEVENLABS_SPEAKER_BOOST}` : 'ELEVENLABS_SPEAKER_BOOST=true'}

# Speech-to-Text Settings
${fullValues.NEXT_PUBLIC_STT_DISABLED !== undefined ? `NEXT_PUBLIC_STT_DISABLED=${fullValues.NEXT_PUBLIC_STT_DISABLED}` : 'NEXT_PUBLIC_STT_DISABLED=false'}

# Audio Playback
${fullValues.NEXT_PUBLIC_AUDIO_AUTOPLAY !== undefined ? `NEXT_PUBLIC_AUDIO_AUTOPLAY=${fullValues.NEXT_PUBLIC_AUDIO_AUTOPLAY}` : 'NEXT_PUBLIC_AUDIO_AUTOPLAY=false'}

# -----------------------------
# DATABASE
# -----------------------------
${fullValues.NEXT_PUBLIC_SUPABASE_URL ? `NEXT_PUBLIC_SUPABASE_URL=${fullValues.NEXT_PUBLIC_SUPABASE_URL}` : 'NEXT_PUBLIC_SUPABASE_URL='}
${fullValues.NEXT_PUBLIC_SUPABASE_ANON_KEY ? `NEXT_PUBLIC_SUPABASE_ANON_KEY=${fullValues.NEXT_PUBLIC_SUPABASE_ANON_KEY}` : 'NEXT_PUBLIC_SUPABASE_ANON_KEY='}
${fullValues.SUPABASE_SERVICE_ROLE_KEY ? `SUPABASE_SERVICE_ROLE_KEY=${fullValues.SUPABASE_SERVICE_ROLE_KEY}` : 'SUPABASE_SERVICE_ROLE_KEY='}

# -----------------------------
# DEPLOYMENT MODE
# -----------------------------
# Choose: single-tenant (shared knowledge base) or multi-tenant (org-based isolation)
# See DEPLOYMENT_MODES.md for details
${fullValues.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE ? `NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=${fullValues.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE}` : 'NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant'}

# -----------------------------
# AUTHENTICATION
# -----------------------------
${fullValues.NEXT_PUBLIC_SITE_URL ? `NEXT_PUBLIC_SITE_URL=${fullValues.NEXT_PUBLIC_SITE_URL}` : 'NEXT_PUBLIC_SITE_URL='}
${fullValues.CHATRAG_APP_URL ? `CHATRAG_APP_URL=${fullValues.CHATRAG_APP_URL}` : 'CHATRAG_APP_URL='}
${fullValues.NEXT_PUBLIC_GITHUB_CLIENT_ID ? `NEXT_PUBLIC_GITHUB_CLIENT_ID=${fullValues.NEXT_PUBLIC_GITHUB_CLIENT_ID}` : 'NEXT_PUBLIC_GITHUB_CLIENT_ID='}
${fullValues.GITHUB_CLIENT_SECRET ? `GITHUB_CLIENT_SECRET=${fullValues.GITHUB_CLIENT_SECRET}` : 'GITHUB_CLIENT_SECRET='}

# -----------------------------
# PAYMENTS
# -----------------------------
# Stripe Payment
${fullValues.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${fullValues.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}` : 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY='}
${fullValues.STRIPE_SECRET_KEY ? `STRIPE_SECRET_KEY=${fullValues.STRIPE_SECRET_KEY}` : 'STRIPE_SECRET_KEY='}
${fullValues.STRIPE_WEBHOOK_SECRET ? `STRIPE_WEBHOOK_SECRET=${fullValues.STRIPE_WEBHOOK_SECRET}` : 'STRIPE_WEBHOOK_SECRET='}
${fullValues.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO ? `NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=${fullValues.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO}` : 'NEXT_PUBLIC_STRIPE_PRICE_ID_PRO='}
${fullValues.NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE ? `NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE=${fullValues.NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE}` : 'NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE='}

# Polar Payment
${fullValues.POLAR_ACCESS_TOKEN ? `POLAR_ACCESS_TOKEN=${fullValues.POLAR_ACCESS_TOKEN}` : 'POLAR_ACCESS_TOKEN='}
${fullValues.POLAR_ORGANIZATION_ID ? `POLAR_ORGANIZATION_ID=${fullValues.POLAR_ORGANIZATION_ID}` : 'POLAR_ORGANIZATION_ID='}
${fullValues.POLAR_WEBHOOK_SECRET ? `POLAR_WEBHOOK_SECRET=${fullValues.POLAR_WEBHOOK_SECRET}` : 'POLAR_WEBHOOK_SECRET='}
${fullValues.POLAR_ORGANIZATION_SLUG ? `POLAR_ORGANIZATION_SLUG=${fullValues.POLAR_ORGANIZATION_SLUG}` : 'POLAR_ORGANIZATION_SLUG='}
${fullValues.NEXT_PUBLIC_POLAR_PRICE_ID_PRO ? `NEXT_PUBLIC_POLAR_PRICE_ID_PRO=${fullValues.NEXT_PUBLIC_POLAR_PRICE_ID_PRO}` : 'NEXT_PUBLIC_POLAR_PRICE_ID_PRO='}
${fullValues.NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE ? `NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE=${fullValues.NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE}` : 'NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE='}
${fullValues.NEXT_PUBLIC_POLAR_CHECKOUT_PRO ? `NEXT_PUBLIC_POLAR_CHECKOUT_PRO=${fullValues.NEXT_PUBLIC_POLAR_CHECKOUT_PRO}` : 'NEXT_PUBLIC_POLAR_CHECKOUT_PRO='}
${fullValues.NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE ? `NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE=${fullValues.NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE}` : 'NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE='}

# -----------------------------
# EMAIL
# -----------------------------
${fullValues.NEXT_PUBLIC_CUSTOM_SMTP_ENABLED !== undefined ? `NEXT_PUBLIC_CUSTOM_SMTP_ENABLED=${fullValues.NEXT_PUBLIC_CUSTOM_SMTP_ENABLED}` : 'NEXT_PUBLIC_CUSTOM_SMTP_ENABLED=false'}
${fullValues.NEXT_PUBLIC_SMTP_FROM_NAME ? `NEXT_PUBLIC_SMTP_FROM_NAME=${fullValues.NEXT_PUBLIC_SMTP_FROM_NAME}` : 'NEXT_PUBLIC_SMTP_FROM_NAME='}
${fullValues.NEXT_PUBLIC_SMTP_FROM_EMAIL ? `NEXT_PUBLIC_SMTP_FROM_EMAIL=${fullValues.NEXT_PUBLIC_SMTP_FROM_EMAIL}` : 'NEXT_PUBLIC_SMTP_FROM_EMAIL='}
${fullValues.RESEND_API_KEY ? `RESEND_API_KEY=${fullValues.RESEND_API_KEY}` : 'RESEND_API_KEY='}

# -----------------------------
# BRANDING
# -----------------------------
# Application Name
${fullValues.NEXT_PUBLIC_APP_NAME !== undefined ? `NEXT_PUBLIC_APP_NAME=${fullValues.NEXT_PUBLIC_APP_NAME}` : 'NEXT_PUBLIC_APP_NAME=ChatRAG'}

# Sidebar Button
${fullValues.NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT !== undefined ? `NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT=${fullValues.NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT}` : 'NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT=ChatRAG'}
${fullValues.NEXT_PUBLIC_SIDEBAR_BUTTON_URL !== undefined ? `NEXT_PUBLIC_SIDEBAR_BUTTON_URL=${fullValues.NEXT_PUBLIC_SIDEBAR_BUTTON_URL}` : 'NEXT_PUBLIC_SIDEBAR_BUTTON_URL=https://www.chatrag.ai/'}

# Header Logo
${fullValues.NEXT_PUBLIC_HEADER_LOGO_TYPE !== undefined ? `NEXT_PUBLIC_HEADER_LOGO_TYPE=${fullValues.NEXT_PUBLIC_HEADER_LOGO_TYPE}` : 'NEXT_PUBLIC_HEADER_LOGO_TYPE=text'}
${fullValues.NEXT_PUBLIC_HEADER_LOGO_TEXT !== undefined ? `NEXT_PUBLIC_HEADER_LOGO_TEXT=${fullValues.NEXT_PUBLIC_HEADER_LOGO_TEXT}` : 'NEXT_PUBLIC_HEADER_LOGO_TEXT=ChatRAG'}
${fullValues.NEXT_PUBLIC_HEADER_LOGO_URL ? `NEXT_PUBLIC_HEADER_LOGO_URL=${fullValues.NEXT_PUBLIC_HEADER_LOGO_URL}` : 'NEXT_PUBLIC_HEADER_LOGO_URL='}

# Welcome Text
${fullValues.NEXT_PUBLIC_WELCOME_TEXT !== undefined ? `NEXT_PUBLIC_WELCOME_TEXT=${fullValues.NEXT_PUBLIC_WELCOME_TEXT}` : 'NEXT_PUBLIC_WELCOME_TEXT=Welcome to ChatRAG'}
${fullValues.NEXT_PUBLIC_WELCOME_TEXT_MODE !== undefined ? `NEXT_PUBLIC_WELCOME_TEXT_MODE=${fullValues.NEXT_PUBLIC_WELCOME_TEXT_MODE}` : 'NEXT_PUBLIC_WELCOME_TEXT_MODE=custom'}
${fullValues.NEXT_PUBLIC_WELCOME_TEXT_GRADIENT !== undefined ? `NEXT_PUBLIC_WELCOME_TEXT_GRADIENT=${fullValues.NEXT_PUBLIC_WELCOME_TEXT_GRADIENT}` : 'NEXT_PUBLIC_WELCOME_TEXT_GRADIENT=orange'}
${fullValues.NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS !== undefined ? `NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS=${fullValues.NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS}` : 'NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS={}'}
${fullValues.NEXT_PUBLIC_WELCOME_MESSAGES !== undefined ? `NEXT_PUBLIC_WELCOME_MESSAGES=${fullValues.NEXT_PUBLIC_WELCOME_MESSAGES}` : 'NEXT_PUBLIC_WELCOME_MESSAGES=[]'}
${fullValues.NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS !== undefined ? `NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS=${fullValues.NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS}` : 'NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS={}'}
${fullValues.NEXT_PUBLIC_MANUAL_USERNAME !== undefined ? `NEXT_PUBLIC_MANUAL_USERNAME=${fullValues.NEXT_PUBLIC_MANUAL_USERNAME}` : 'NEXT_PUBLIC_MANUAL_USERNAME='}

# AI Response Logo
${fullValues.NEXT_PUBLIC_AI_LOGO_TYPE !== undefined ? `NEXT_PUBLIC_AI_LOGO_TYPE=${fullValues.NEXT_PUBLIC_AI_LOGO_TYPE}` : 'NEXT_PUBLIC_AI_LOGO_TYPE=default'}
${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_URL ? `NEXT_PUBLIC_AI_RESPONSE_LOGO_URL=${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_URL}` : 'NEXT_PUBLIC_AI_RESPONSE_LOGO_URL='}
${fullValues.NEXT_PUBLIC_USE_DEFAULT_AI_LOGO !== undefined ? `NEXT_PUBLIC_USE_DEFAULT_AI_LOGO=${fullValues.NEXT_PUBLIC_USE_DEFAULT_AI_LOGO}` : 'NEXT_PUBLIC_USE_DEFAULT_AI_LOGO=true'}
${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER !== undefined ? `NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER}` : 'NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=true'}
${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE !== undefined ? `NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=${fullValues.NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE}` : 'NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=3'}

# Favicon & Site Title
${fullValues.NEXT_PUBLIC_SITE_TITLE !== undefined ? `NEXT_PUBLIC_SITE_TITLE=${fullValues.NEXT_PUBLIC_SITE_TITLE}` : 'NEXT_PUBLIC_SITE_TITLE=ChatRAG'}
${fullValues.NEXT_PUBLIC_FAVICON_URL ? `NEXT_PUBLIC_FAVICON_URL=${fullValues.NEXT_PUBLIC_FAVICON_URL}` : 'NEXT_PUBLIC_FAVICON_URL='}

# -----------------------------
# SAVED CHATS
# -----------------------------
# Chat Title Generation
${fullValues.CHAT_TITLE_MODEL !== undefined ? `CHAT_TITLE_MODEL=${fullValues.CHAT_TITLE_MODEL}` : 'CHAT_TITLE_MODEL=anthropic/claude-haiku-4.5'}
${fullValues.CHAT_TITLE_TEMPERATURE !== undefined ? `CHAT_TITLE_TEMPERATURE=${fullValues.CHAT_TITLE_TEMPERATURE}` : 'CHAT_TITLE_TEMPERATURE=0.5'}
${fullValues.CHAT_TITLE_MAX_TOKENS !== undefined ? `CHAT_TITLE_MAX_TOKENS=${fullValues.CHAT_TITLE_MAX_TOKENS}` : 'CHAT_TITLE_MAX_TOKENS=100'}

# -----------------------------
# SUGGESTIONS
# -----------------------------
${fullValues.NEXT_PUBLIC_SHOW_SUGGESTIONS !== undefined ? `NEXT_PUBLIC_SHOW_SUGGESTIONS=${fullValues.NEXT_PUBLIC_SHOW_SUGGESTIONS}` : 'NEXT_PUBLIC_SHOW_SUGGESTIONS=true'}
${fullValues.NEXT_PUBLIC_SUGGESTION_GROUPS !== undefined ? `NEXT_PUBLIC_SUGGESTION_GROUPS=${fullValues.NEXT_PUBLIC_SUGGESTION_GROUPS}` : 'NEXT_PUBLIC_SUGGESTION_GROUPS=[]'}

# -----------------------------
# EMBED WIDGET
# -----------------------------
${fullValues.NEXT_PUBLIC_EMBED_ENABLED !== undefined ? `NEXT_PUBLIC_EMBED_ENABLED=${fullValues.NEXT_PUBLIC_EMBED_ENABLED}` : 'NEXT_PUBLIC_EMBED_ENABLED=false'}
${fullValues.NEXT_PUBLIC_EMBED_TITLE !== undefined ? `NEXT_PUBLIC_EMBED_TITLE=${fullValues.NEXT_PUBLIC_EMBED_TITLE}` : 'NEXT_PUBLIC_EMBED_TITLE=ChatRAG Assistant'}
${fullValues.NEXT_PUBLIC_EMBED_PRIMARY_COLOR !== undefined ? `NEXT_PUBLIC_EMBED_PRIMARY_COLOR=${fullValues.NEXT_PUBLIC_EMBED_PRIMARY_COLOR}` : 'NEXT_PUBLIC_EMBED_PRIMARY_COLOR=#FF6417'}
${fullValues.NEXT_PUBLIC_EMBED_POSITION !== undefined ? `NEXT_PUBLIC_EMBED_POSITION=${fullValues.NEXT_PUBLIC_EMBED_POSITION}` : 'NEXT_PUBLIC_EMBED_POSITION=bottom-right'}
${fullValues.NEXT_PUBLIC_EMBED_AUTO_OPEN !== undefined ? `NEXT_PUBLIC_EMBED_AUTO_OPEN=${fullValues.NEXT_PUBLIC_EMBED_AUTO_OPEN}` : 'NEXT_PUBLIC_EMBED_AUTO_OPEN=false'}
${fullValues.NEXT_PUBLIC_EMBED_GREETING !== undefined ? `NEXT_PUBLIC_EMBED_GREETING=${fullValues.NEXT_PUBLIC_EMBED_GREETING}` : 'NEXT_PUBLIC_EMBED_GREETING=Hello! How can I help you today?'}
${fullValues.NEXT_PUBLIC_EMBED_MODEL !== undefined ? `NEXT_PUBLIC_EMBED_MODEL=${fullValues.NEXT_PUBLIC_EMBED_MODEL}` : 'NEXT_PUBLIC_EMBED_MODEL='}
${fullValues.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS !== undefined ? `NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS=${fullValues.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS}` : 'NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS=*'}
${fullValues.EMBED_REQUIRE_AUTH !== undefined ? `EMBED_REQUIRE_AUTH=${fullValues.EMBED_REQUIRE_AUTH}` : 'EMBED_REQUIRE_AUTH=false'}

# -----------------------------
# WHATSAPP
# -----------------------------
${fullValues.NEXT_PUBLIC_WHATSAPP_ENABLED !== undefined ? `NEXT_PUBLIC_WHATSAPP_ENABLED=${fullValues.NEXT_PUBLIC_WHATSAPP_ENABLED}` : 'NEXT_PUBLIC_WHATSAPP_ENABLED=false'}
${fullValues.WHATSAPP_PROVIDER ? `WHATSAPP_PROVIDER=${fullValues.WHATSAPP_PROVIDER}` : 'WHATSAPP_PROVIDER=koyeb'}
${fullValues.KOYEB_BAILEYS_URL ? `KOYEB_BAILEYS_URL=${fullValues.KOYEB_BAILEYS_URL}` : 'KOYEB_BAILEYS_URL='}
${fullValues.KOYEB_API_KEY ? `KOYEB_API_KEY=${fullValues.KOYEB_API_KEY}` : 'KOYEB_API_KEY='}
${fullValues.FLYIO_BAILEYS_URL ? `FLYIO_BAILEYS_URL=${fullValues.FLYIO_BAILEYS_URL}` : 'FLYIO_BAILEYS_URL='}
${fullValues.FLYIO_API_KEY ? `FLYIO_API_KEY=${fullValues.FLYIO_API_KEY}` : 'FLYIO_API_KEY='}
${fullValues.WHATSAPP_WEBHOOK_SECRET ? `WHATSAPP_WEBHOOK_SECRET=${fullValues.WHATSAPP_WEBHOOK_SECRET}` : 'WHATSAPP_WEBHOOK_SECRET='}
${fullValues.WHATSAPP_WEBHOOK_URL ? `WHATSAPP_WEBHOOK_URL=${fullValues.WHATSAPP_WEBHOOK_URL}` : 'WHATSAPP_WEBHOOK_URL='}
${fullValues.WHATSAPP_ENABLE_MCP !== undefined ? `WHATSAPP_ENABLE_MCP=${fullValues.WHATSAPP_ENABLE_MCP}` : 'WHATSAPP_ENABLE_MCP=false'}
${fullValues.WHATSAPP_ENABLE_WEB_SEARCH !== undefined ? `WHATSAPP_ENABLE_WEB_SEARCH=${fullValues.WHATSAPP_ENABLE_WEB_SEARCH}` : 'WHATSAPP_ENABLE_WEB_SEARCH=false'}
${fullValues.WHATSAPP_DEFAULT_MODEL !== undefined ? `WHATSAPP_DEFAULT_MODEL=${fullValues.WHATSAPP_DEFAULT_MODEL}` : 'WHATSAPP_DEFAULT_MODEL='}
${fullValues.WHATSAPP_MAX_TOKENS !== undefined ? `WHATSAPP_MAX_TOKENS=${fullValues.WHATSAPP_MAX_TOKENS}` : 'WHATSAPP_MAX_TOKENS=2048'}
${fullValues.WHATSAPP_MAX_SESSIONS_PER_USER !== undefined ? `WHATSAPP_MAX_SESSIONS_PER_USER=${fullValues.WHATSAPP_MAX_SESSIONS_PER_USER}` : 'WHATSAPP_MAX_SESSIONS_PER_USER=5'}
${fullValues.WHATSAPP_MESSAGE_QUEUE_SIZE !== undefined ? `WHATSAPP_MESSAGE_QUEUE_SIZE=${fullValues.WHATSAPP_MESSAGE_QUEUE_SIZE}` : 'WHATSAPP_MESSAGE_QUEUE_SIZE=10'}

# -----------------------------
# RAG SETTINGS
# -----------------------------
${fullValues.RAG_PRE_CONTEXT ? `RAG_PRE_CONTEXT=${fullValues.RAG_PRE_CONTEXT}` : 'RAG_PRE_CONTEXT='}
${fullValues.RAG_POST_CONTEXT ? `RAG_POST_CONTEXT=${fullValues.RAG_POST_CONTEXT}` : 'RAG_POST_CONTEXT='}

# -----------------------------
# REASONING/THINKING MODELS
# -----------------------------
# Enable reasoning/thinking capabilities for supported models
${fullValues.NEXT_PUBLIC_REASONING_ENABLED !== undefined ? `NEXT_PUBLIC_REASONING_ENABLED=${fullValues.NEXT_PUBLIC_REASONING_ENABLED}` : 'NEXT_PUBLIC_REASONING_ENABLED=true'}
# Default reasoning effort level: low, medium, high
${fullValues.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT !== undefined ? `NEXT_PUBLIC_DEFAULT_REASONING_EFFORT=${fullValues.NEXT_PUBLIC_DEFAULT_REASONING_EFFORT}` : 'NEXT_PUBLIC_DEFAULT_REASONING_EFFORT=medium'}
# Maximum reasoning tokens (for models that support it)
${fullValues.NEXT_PUBLIC_MAX_REASONING_TOKENS !== undefined ? `NEXT_PUBLIC_MAX_REASONING_TOKENS=${fullValues.NEXT_PUBLIC_MAX_REASONING_TOKENS}` : 'NEXT_PUBLIC_MAX_REASONING_TOKENS=8000'}
# Show reasoning process in UI by default
${fullValues.NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT !== undefined ? `NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT=${fullValues.NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT}` : 'NEXT_PUBLIC_SHOW_REASONING_BY_DEFAULT=false'}
# Enable reasoning for RAG responses
${fullValues.NEXT_PUBLIC_RAG_REASONING_ENABLED !== undefined ? `NEXT_PUBLIC_RAG_REASONING_ENABLED=${fullValues.NEXT_PUBLIC_RAG_REASONING_ENABLED}` : 'NEXT_PUBLIC_RAG_REASONING_ENABLED=true'}
# Cost multiplier for reasoning tokens
${fullValues.REASONING_COST_MULTIPLIER !== undefined ? `REASONING_COST_MULTIPLIER=${fullValues.REASONING_COST_MULTIPLIER}` : 'REASONING_COST_MULTIPLIER=1.5'}

# -----------------------------
# DOCUMENT PROCESSING
# -----------------------------
${fullValues.NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD !== undefined ? `NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD=${fullValues.NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD}` : 'NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD=false'}
${fullValues.NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED !== undefined ? `NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=${fullValues.NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED}` : 'NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=true'}

# -----------------------------
# RAG CONFIGURATION (Unified Optimized System)
# -----------------------------
# Unified RAG Settings - All features can be toggled individually
${fullValues.RAG_MULTI_PASS !== undefined ? `RAG_MULTI_PASS=${fullValues.RAG_MULTI_PASS}` : 'RAG_MULTI_PASS=true'}
${fullValues.RAG_ADAPTIVE_RETRIEVAL !== undefined ? `RAG_ADAPTIVE_RETRIEVAL=${fullValues.RAG_ADAPTIVE_RETRIEVAL}` : 'RAG_ADAPTIVE_RETRIEVAL=true'}
${fullValues.RAG_QUERY_ENHANCEMENT !== undefined ? `RAG_QUERY_ENHANCEMENT=${fullValues.RAG_QUERY_ENHANCEMENT}` : 'RAG_QUERY_ENHANCEMENT=false'}
${fullValues.RAG_ADJACENT_CHUNKS !== undefined ? `RAG_ADJACENT_CHUNKS=${fullValues.RAG_ADJACENT_CHUNKS}` : 'RAG_ADJACENT_CHUNKS=true'}
${fullValues.RAG_CACHE_ENABLED !== undefined ? `RAG_CACHE_ENABLED=${fullValues.RAG_CACHE_ENABLED}` : 'RAG_CACHE_ENABLED=true'}
${fullValues.RAG_ADJACENCY_WINDOW !== undefined ? `RAG_ADJACENCY_WINDOW=${fullValues.RAG_ADJACENCY_WINDOW}` : 'RAG_ADJACENCY_WINDOW=2'}
${fullValues.RAG_MATCH_MULTIPLIER !== undefined ? `RAG_MATCH_MULTIPLIER=${fullValues.RAG_MATCH_MULTIPLIER}` : 'RAG_MATCH_MULTIPLIER=3'}

# RAG Optimization Parameters
# Optimized for finding specific information with high accuracy
${fullValues.RAG_MMR_LAMBDA !== undefined ? `RAG_MMR_LAMBDA=${fullValues.RAG_MMR_LAMBDA}` : 'RAG_MMR_LAMBDA=0.85'}
${fullValues.RAG_MIN_CONFIDENCE !== undefined ? `RAG_MIN_CONFIDENCE=${fullValues.RAG_MIN_CONFIDENCE}` : 'RAG_MIN_CONFIDENCE=0.7'}
${fullValues.RAG_FINAL_RESULT_COUNT !== undefined ? `RAG_FINAL_RESULT_COUNT=${fullValues.RAG_FINAL_RESULT_COUNT}` : 'RAG_FINAL_RESULT_COUNT=25'}
${fullValues.RAG_DIVERSITY_WEIGHT !== undefined ? `RAG_DIVERSITY_WEIGHT=${fullValues.RAG_DIVERSITY_WEIGHT}` : 'RAG_DIVERSITY_WEIGHT=0.15'}

# RAG Advanced Settings
${fullValues.RAG_ENABLE_ADJACENT_CHUNKS !== undefined ? `RAG_ENABLE_ADJACENT_CHUNKS=${fullValues.RAG_ENABLE_ADJACENT_CHUNKS}` : 'RAG_ENABLE_ADJACENT_CHUNKS=true'}
${fullValues.RAG_MAX_RETRIEVAL_PASSES !== undefined ? `RAG_MAX_RETRIEVAL_PASSES=${fullValues.RAG_MAX_RETRIEVAL_PASSES}` : 'RAG_MAX_RETRIEVAL_PASSES=2'}
${fullValues.RAG_COMPLETENESS_CONFIDENCE !== undefined ? `RAG_COMPLETENESS_CONFIDENCE=${fullValues.RAG_COMPLETENESS_CONFIDENCE}` : 'RAG_COMPLETENESS_CONFIDENCE=0.7'}
${fullValues.RAG_PERFORMANCE_MODE !== undefined ? `RAG_PERFORMANCE_MODE=${fullValues.RAG_PERFORMANCE_MODE}` : 'RAG_PERFORMANCE_MODE=accurate'}
${fullValues.RAG_RERANKING !== undefined ? `RAG_RERANKING=${fullValues.RAG_RERANKING}` : 'RAG_RERANKING=true'}
${fullValues.RAG_RERANKING_STRATEGY !== undefined ? `RAG_RERANKING_STRATEGY=${fullValues.RAG_RERANKING_STRATEGY}` : 'RAG_RERANKING_STRATEGY=hybrid'}

# Number of documents to retrieve (optimized for accuracy)
${fullValues.RAG_INITIAL_MATCH_COUNT !== undefined ? `RAG_INITIAL_MATCH_COUNT=${fullValues.RAG_INITIAL_MATCH_COUNT}` : 'RAG_INITIAL_MATCH_COUNT=60'}
# Minimum similarity threshold (optimized for accuracy)
${fullValues.RAG_SIMILARITY_THRESHOLD !== undefined ? `RAG_SIMILARITY_THRESHOLD=${fullValues.RAG_SIMILARITY_THRESHOLD}` : 'RAG_SIMILARITY_THRESHOLD=0.45'}

# RAG Behavior Mode: strict, balanced, flexible, bypass
${fullValues.RAG_BEHAVIOR_MODE !== undefined ? `RAG_BEHAVIOR_MODE=${fullValues.RAG_BEHAVIOR_MODE}` : 'RAG_BEHAVIOR_MODE=strict'}

# Temporal and Financial Intelligence (Unified RAG)
${fullValues.RAG_TEMPORAL_BOOST !== undefined ? `RAG_TEMPORAL_BOOST=${fullValues.RAG_TEMPORAL_BOOST}` : 'RAG_TEMPORAL_BOOST=true'}
${fullValues.RAG_FINANCIAL_BOOST !== undefined ? `RAG_FINANCIAL_BOOST=${fullValues.RAG_FINANCIAL_BOOST}` : 'RAG_FINANCIAL_BOOST=true'}
${fullValues.RAG_TEMPORAL_MATCHING !== undefined ? `RAG_TEMPORAL_MATCHING=${fullValues.RAG_TEMPORAL_MATCHING}` : 'RAG_TEMPORAL_MATCHING=false'}
${fullValues.RAG_FALLBACK_LOWER_THRESHOLD !== undefined ? `RAG_FALLBACK_LOWER_THRESHOLD=${fullValues.RAG_FALLBACK_LOWER_THRESHOLD}` : 'RAG_FALLBACK_LOWER_THRESHOLD=true'}

# Query Analysis Thresholds
${fullValues.RAG_EXACT_THRESHOLD !== undefined ? `RAG_EXACT_THRESHOLD=${fullValues.RAG_EXACT_THRESHOLD}` : 'RAG_EXACT_THRESHOLD=0.75'}
${fullValues.RAG_HIGH_THRESHOLD !== undefined ? `RAG_HIGH_THRESHOLD=${fullValues.RAG_HIGH_THRESHOLD}` : 'RAG_HIGH_THRESHOLD=0.65'}
${fullValues.RAG_MEDIUM_THRESHOLD !== undefined ? `RAG_MEDIUM_THRESHOLD=${fullValues.RAG_MEDIUM_THRESHOLD}` : 'RAG_MEDIUM_THRESHOLD=0.55'}
${fullValues.RAG_LOW_THRESHOLD !== undefined ? `RAG_LOW_THRESHOLD=${fullValues.RAG_LOW_THRESHOLD}` : 'RAG_LOW_THRESHOLD=0.45'}

# Key Terms Configuration
${fullValues.RAG_EXTRACT_KEY_TERMS !== undefined ? `RAG_EXTRACT_KEY_TERMS=${fullValues.RAG_EXTRACT_KEY_TERMS}` : 'RAG_EXTRACT_KEY_TERMS=true'}
${fullValues.RAG_MAX_KEY_TERMS !== undefined ? `RAG_MAX_KEY_TERMS=${fullValues.RAG_MAX_KEY_TERMS}` : 'RAG_MAX_KEY_TERMS=10'}
# LlamaCloud configuration
${fullValues.LLAMACLOUD_PARSING_MODE !== undefined ? `LLAMACLOUD_PARSING_MODE=${fullValues.LLAMACLOUD_PARSING_MODE}` : 'LLAMACLOUD_PARSING_MODE=balanced'}
${fullValues.LLAMACLOUD_CHUNK_STRATEGY !== undefined ? `LLAMACLOUD_CHUNK_STRATEGY=${fullValues.LLAMACLOUD_CHUNK_STRATEGY}` : 'LLAMACLOUD_CHUNK_STRATEGY=sentence'}
${fullValues.LLAMACLOUD_CHUNK_SIZE !== undefined ? `LLAMACLOUD_CHUNK_SIZE=${fullValues.LLAMACLOUD_CHUNK_SIZE}` : 'LLAMACLOUD_CHUNK_SIZE=1000'}
${fullValues.LLAMACLOUD_CHUNK_OVERLAP !== undefined ? `LLAMACLOUD_CHUNK_OVERLAP=${fullValues.LLAMACLOUD_CHUNK_OVERLAP}` : 'LLAMACLOUD_CHUNK_OVERLAP=300'}
${fullValues.LLAMACLOUD_MULTIMODAL_PARSING !== undefined ? `LLAMACLOUD_MULTIMODAL_PARSING=${fullValues.LLAMACLOUD_MULTIMODAL_PARSING}` : 'LLAMACLOUD_MULTIMODAL_PARSING=true'}

# Advanced LlamaParse configuration
${fullValues.LLAMACLOUD_PARSE_MODE !== undefined ? `LLAMACLOUD_PARSE_MODE=${fullValues.LLAMACLOUD_PARSE_MODE}` : 'LLAMACLOUD_PARSE_MODE=parse_page_with_agent'}
${fullValues.LLAMACLOUD_PARSE_MODEL !== undefined ? `LLAMACLOUD_PARSE_MODEL=${fullValues.LLAMACLOUD_PARSE_MODEL}` : 'LLAMACLOUD_PARSE_MODEL=gemini-2.5-pro'}
${fullValues.LLAMACLOUD_HIGH_RES_OCR !== undefined ? `LLAMACLOUD_HIGH_RES_OCR=${fullValues.LLAMACLOUD_HIGH_RES_OCR}` : 'LLAMACLOUD_HIGH_RES_OCR=true'}
${fullValues.LLAMACLOUD_ADAPTIVE_LONG_TABLE !== undefined ? `LLAMACLOUD_ADAPTIVE_LONG_TABLE=${fullValues.LLAMACLOUD_ADAPTIVE_LONG_TABLE}` : 'LLAMACLOUD_ADAPTIVE_LONG_TABLE=true'}
${fullValues.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION !== undefined ? `LLAMACLOUD_OUTLINED_TABLE_EXTRACTION=${fullValues.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION}` : 'LLAMACLOUD_OUTLINED_TABLE_EXTRACTION=true'}
${fullValues.LLAMACLOUD_OUTPUT_TABLES_AS_HTML !== undefined ? `LLAMACLOUD_OUTPUT_TABLES_AS_HTML=${fullValues.LLAMACLOUD_OUTPUT_TABLES_AS_HTML}` : 'LLAMACLOUD_OUTPUT_TABLES_AS_HTML=true'}

# -----------------------------
# DEBUGGING
# -----------------------------
${fullValues.DEBUG_RAG !== undefined ? `DEBUG_RAG=${fullValues.DEBUG_RAG}` : 'DEBUG_RAG=false'}

# -----------------------------
# MCP CONFIGURATION
# -----------------------------
${fullValues.MCP_ZAPIER_ENDPOINT ? `MCP_ZAPIER_ENDPOINT=${fullValues.MCP_ZAPIER_ENDPOINT}` : 'MCP_ZAPIER_ENDPOINT='}
${fullValues.MCP_CONTEXT7_ENDPOINT ? `MCP_CONTEXT7_ENDPOINT=${fullValues.MCP_CONTEXT7_ENDPOINT}` : 'MCP_CONTEXT7_ENDPOINT='}
${fullValues.MCP_21ST_DEV_ENDPOINT ? `MCP_21ST_DEV_ENDPOINT=${fullValues.MCP_21ST_DEV_ENDPOINT}` : 'MCP_21ST_DEV_ENDPOINT='}
${fullValues.MCP_BRAVE_SEARCH_ENDPOINT ? `MCP_BRAVE_SEARCH_ENDPOINT=${fullValues.MCP_BRAVE_SEARCH_ENDPOINT}` : 'MCP_BRAVE_SEARCH_ENDPOINT='}
${fullValues.MCP_CUSTOM_SERVERS !== undefined ? `MCP_CUSTOM_SERVERS=${fullValues.MCP_CUSTOM_SERVERS}` : 'MCP_CUSTOM_SERVERS=[]'}

# -----------------------------
# ADMIN
# -----------------------------
${fullValues.ADMIN_EMAIL ? `ADMIN_EMAIL=${fullValues.ADMIN_EMAIL}` : 'ADMIN_EMAIL='}
${fullValues.ADMIN_PASSWORD ? `ADMIN_PASSWORD=${fullValues.ADMIN_PASSWORD}` : 'ADMIN_PASSWORD='}`

      fs.writeFileSync(envPath, newContent);
    } else {
      // If it exists, try to update values while preserving structure
      const rawContent = fs.readFileSync(envPath, 'utf8');
      const lines = rawContent.split('\n');

      // Create a new array to store the updated content
      const updatedLines = lines.map(line => {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || line.trim() === '') {
          return line;
        }

        // Check if this is a variable definition
        const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
        if (match) {
          const key = match[1];

          // If we have a new value for this key, update it
          if (fullValues.hasOwnProperty(key)) {
            // RAG context values are saved as plain text (no encoding)
            let valueToWrite = fullValues[key];

            // Convert booleans to strings explicitly
            if (typeof valueToWrite === 'boolean') {
              valueToWrite = valueToWrite ? 'true' : 'false';
            } else if (valueToWrite === null || valueToWrite === undefined) {
              valueToWrite = '';
            } else {
              valueToWrite = String(valueToWrite);
              // Quote values containing # to prevent them being treated as comments
              if (valueToWrite.includes('#') && !valueToWrite.startsWith('"')) {
                valueToWrite = `"${valueToWrite}"`;
              }
            }

            return `${key}=${valueToWrite}`;
          }
        }

        // Otherwise, keep the original line
        return line;
      });

      // Append any missing keys that were not in the original file
      Object.entries(fullValues).forEach(([key, value]) => {
        // Validate the environment variable name before adding
        if (!isValidEnvVarName(key)) {
          console.warn(`[Config] Skipping invalid environment variable name: ${key}`);
          return;
        }

        // Skip template placeholders or values that look like template syntax
        if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
          console.warn(`[Config] Skipping template placeholder value for ${key}: ${value}`);
          return;
        }

        const alreadyExists = updatedLines.some((l) => l.startsWith(`${key}=`));
        if (!alreadyExists) {
          // Convert booleans to strings explicitly
          let valueToWrite = value;
          if (typeof valueToWrite === 'boolean') {
            valueToWrite = valueToWrite ? 'true' : 'false';
          } else if (valueToWrite === null || valueToWrite === undefined) {
            valueToWrite = '';
          } else {
            valueToWrite = String(valueToWrite);
            // Quote values containing # to prevent them being treated as comments
            if (valueToWrite.includes('#') && !valueToWrite.startsWith('"')) {
              valueToWrite = `"${valueToWrite}"`;
            }
          }
          updatedLines.push(`${key}=${valueToWrite}`);
        }
      });

      // Write the updated content
      fs.writeFileSync(envPath, updatedLines.join('\n'));
    }

    res.json({
      success: true,
      message: '.env.local updated successfully!'
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to validate environment variable names
function isValidEnvVarName(key) {
  // Environment variables must:
  // - Start with a letter
  // - Contain only letters, numbers, and underscores
  // - Not contain hyphens or other special characters
  return /^[A-Z][A-Z0-9_]*$/i.test(key);
}

// Helper function to filter out invalid environment variable names
function filterValidEnvVars(fullValues) {
  const validVars = {};
  const invalidKeys = [];

  Object.entries(fullValues).forEach(([key, value]) => {
    // Skip admin form fields and other temporary fields
    if (key === 'newAdminEmail' || key === 'newAdminPassword' ||
      key === 'new-model-id' || key === 'new-model-name' ||
      key === 'ai-provider-select' || key === 'templateName' ||
      key === 'templateDescription' || key === 'translationTargetLanguage' ||
      key === 'translationProvider') {
      console.warn(`[Config] Filtered out form field: ${key}`);
      return;
    }

    // Check if the key is a valid environment variable name
    if (!isValidEnvVarName(key)) {
      invalidKeys.push(key);
      console.warn(`[Config] Filtered out invalid env var name: ${key}`);
      return;
    }

    // Skip template placeholders or values that look like template syntax
    if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
      console.warn(`[Config] Filtered out template placeholder for ${key}: ${value}`);
      return;
    }

    // Skip certain problematic values
    if (key === 'Context' || (typeof value === 'string' && value === '{{context}}')) {
      console.warn(`[Config] Filtered out problematic value for ${key}: ${value}`);
      return;
    }

    validVars[key] = value;
  });

  if (invalidKeys.length > 0) {
    console.log(`[Config] Filtered out ${invalidKeys.length} invalid keys:`, invalidKeys);
  }

  return validVars;
}

// Helper function to parse .env file content
function parseEnvFile(content) {
  const vars = {};
  if (!content) return vars;

  // Split by lines and process each line
  const lines = content.split('\n');
  for (const line of lines) {
    // Skip comments and empty lines
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    // Match variable definitions
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      vars[key] = value;
    }
  }

  return vars;
}

// API endpoint to get RAG system prompt - PROXY TO MAIN APP
app.get('/api/config/rag-prompt', async (req, res) => {
  try {
    console.log('[RAG API] Proxying GET request to main app');
    const response = await fetch(getMainAppUrl('/api/config/rag-prompt'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    // Transform the response to match config-ui expectations
    const transformedData = {
      preContext: data.preContext || '',
      postContext: data.postContext || '',
      fullPrompt: data.assembledPrompt || '',
      hasCustomPrompt: !!(data.preContext || data.postContext),
      warning: data.warning
    };

    res.json(transformedData);
  } catch (error) {
    console.error('Error proxying RAG system prompt GET request:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to update RAG system prompt - PROXY TO MAIN APP
app.post('/api/config/rag-prompt', async (req, res) => {
  try {
    const { preContext, postContext } = req.body;

    console.log('[RAG API] Proxying POST request to main app:', {
      preContextLength: preContext?.length || 0,
      postContextLength: postContext?.length || 0
    });

    const response = await fetch(getMainAppUrl('/api/config/rag-prompt'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preContext,
        postContext
      })
    });

    const data = await response.json();

    // Transform the response to match config-ui expectations
    const transformedData = {
      success: data.success,
      fullPrompt: data.assembledPrompt,
      message: data.message,
      error: data.error
    };

    res.json(transformedData);
  } catch (error) {
    console.error('Error proxying RAG system prompt POST request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy for file uploads - handles RAG image uploads
app.post('/api/upload', documentUpload.array('files'), async (req, res) => {
  try {
    console.log('[Upload Proxy] Proxying upload request to main app (Native Fetch/FormData)');
    // format-data is likely needed, assume we will add require('form-data') at top
    // const FormData = require('form-data'); // Removed in favor of native FormData
    const formData = new FormData();

    // Append files using native Blob
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        const fileBlob = new Blob([file.buffer], { type: file.mimetype });
        formData.append('files', fileBlob, file.originalname);
      });
    }

    // Append text fields
    if (req.body.process_rag) {
      formData.append('process_rag', req.body.process_rag);
    }
    if (req.body.image_context) {
      formData.append('image_context', req.body.image_context);
    }

    // Forward authentication headers (Cookie, Authorization) so the backend knows the user
    const headers = {};
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

    // Rely on fetch to set the correct multipart headers (Content-Type) with boundary
    const response = await fetch(getMainAppUrl('/api/upload'), {
      method: 'POST',
      headers: headers,
      body: formData,
    });

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error('Error proxying upload request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy for images listing - fetches images from the knowledge base
app.get('/api/images', async (req, res) => {
  try {
    console.log('[Images Proxy] Proxying GET request to main app');

    // Forward authentication headers (Cookie, Authorization)
    const headers = {
      'Content-Type': 'application/json',
    };
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

    const response = await fetch(getMainAppUrl('/api/images'), {
      method: 'GET',
      headers: headers,
    });

    const data = await response.json();
    console.log(`[Images Proxy] Got ${data.images?.length || 0} images`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Images Proxy] Error proxying images request:', error);
    res.status(500).json({ error: 'Failed to fetch images: ' + error.message });
  }
});

// Proxy for deleting images
app.delete('/api/images', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Image ID is required' });
    }

    console.log(`[Images Proxy] Proxying DELETE request for image ${id} to main app`);

    // Forward authentication headers (Cookie, Authorization)
    const headers = {
      'Content-Type': 'application/json',
    };
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

    const response = await fetch(getMainAppUrl(`/api/images?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: headers,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Images Proxy] Error proxying delete request:', error);
    res.status(500).json({ error: 'Failed to delete image: ' + error.message });
  }
});

// Proxy for Nango API routes - PROXY TO MAIN APP
// Handles /api/nango/* endpoints from config UI
app.all(/^\/api\/nango\//, async (req, res) => {
  try {
    const apiPath = req.path; // Keep the full path
    const queryString = new URLSearchParams(req.query).toString();
    const url = getMainAppUrl(`${apiPath}${queryString ? '?' + queryString : ''}`);

    console.log(`[Nango Proxy] ${req.method} ${url}`);

    // Build headers - forward Authorization header from config-ui
    const headers = {
      'Content-Type': 'application/json',
    };

    // Forward Authorization header if present (for config-ui admin auth)
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
      console.log(`[Nango Proxy] Forwarding Authorization header`);
    }

    const options = {
      method: req.method,
      headers,
      timeout: 30000, // 30 second timeout
    };

    // Include request body for POST/PATCH/PUT/DELETE requests
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type');

    // Handle different content types
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    console.log(`[Nango Proxy] Response status: ${response.status}, Data:`, JSON.stringify(data).substring(0, 200));

    res.status(response.status);

    // Set response headers
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    res.send(data);
  } catch (error) {
    console.error('[Nango Proxy] Error proxying request:', error);
    res.status(500).json({ error: 'Failed to proxy Nango API request: ' + error.message });
  }
});

// Proxy for scraper API routes - PROXY TO MAIN APP
// Handles /api/scrapers/* endpoints from config UI
app.all(/^\/api\/scrapers\//, async (req, res) => {
  try {
    const apiPath = req.path;
    const queryString = new URLSearchParams(req.query).toString();
    const url = getMainAppUrl(`${apiPath}${queryString ? '?' + queryString : ''}`);

    console.log(`[Scraper Proxy] ${req.method} ${url}`);

    const headers = {
      'Content-Type': 'application/json',
    };

    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }

    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const options = {
      method: req.method,
      headers,
      timeout: 300000,
    };

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : await response.text();

    if (contentType) {
      res.set('Content-Type', contentType);
    }

    res.status(response.status).send(data);
  } catch (error) {
    console.error('[Scraper Proxy] Error proxying request:', error);
    res.status(500).json({ error: 'Failed to proxy scraper API request: ' + error.message });
  }
});

// API endpoint to create a new .env.local with template
app.post('/api/config/create', (req, res) => {
  try {
    const { template = 'standard' } = req.body;
    const envPath = path.join(REPO_ROOT, '.env.local');

    // Check if file already exists and if force flag is not set
    if (fs.existsSync(envPath) && !req.body.force) {
      return res.status(400).json({
        error: '.env.local already exists. Please use the configuration editor to modify it or set force=true to overwrite.'
      });
    }

    // Generate template content based on selection
    let templateContent = '';

    switch (template) {
      case 'minimal':
        templateContent = getMinimalTemplate();
        break;
      case 'full':
        templateContent = getFullTemplate();
        break;
      case 'standard':
      default:
        templateContent = getStandardTemplate();
        break;
    }

    // Write the file
    fs.writeFileSync(envPath, templateContent);

    // Return the config for immediate display
    const config = dotenv.parse(templateContent);

    res.json({
      success: true,
      message: '.env.local created successfully!',
      config: config
    });
  } catch (error) {
    console.error('Error creating config file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Mask sensitive values (now returns the actual values since we're running locally)
function maskSensitiveValues(config) {
  return config; // Return unmodified config
}

// Helper functions to generate templates
// Helper function to get environment values
function getEnvValue(key) {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    return '';
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const config = dotenv.parse(envContent);
  return config[key] || '';
}

function getMinimalTemplate() {
  return `# ChatRAG Minimal Configuration
# Enable/disable key features
NEXT_PUBLIC_AUTH_ENABLED=false
NEXT_PUBLIC_WEB_SEARCH_ENABLED=false
NEXT_PUBLIC_SHOW_SUGGESTIONS=true
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=false
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=false
NEXT_PUBLIC_3D_GENERATION_ENABLED=false
NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=false
NEXT_PUBLIC_MCP_SYSTEM_ENABLED=false
NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=true

# Required AI Model APIs
OPENAI_API_KEY=
OPENROUTER_API_KEY=

# Supabase (Required for database and auth)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Deployment Mode (single-tenant or multi-tenant)
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
CHATRAG_APP_URL=http://localhost:3000

# Embed Widget (disabled by default)
NEXT_PUBLIC_EMBED_ENABLED=false
NEXT_PUBLIC_EMBED_TITLE=ChatRAG Assistant
NEXT_PUBLIC_EMBED_PRIMARY_COLOR=#FF6417
NEXT_PUBLIC_EMBED_POSITION=bottom-right
NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED=true
NEXT_PUBLIC_EMBED_SUGGESTIONS=["What can you help me with?","How does this work?","Tell me about your features","Get started guide"]

# Audio/Voice Settings
NEXT_PUBLIC_VOICE_PROVIDER=openai
NEXT_PUBLIC_TTS_DISABLED=false
NEXT_PUBLIC_STT_DISABLED=false
NEXT_PUBLIC_AUDIO_AUTOPLAY=false
`;
}

function getStandardTemplate() {
  return `# ChatRAG Configuration
# Generated by setup tool

# -----------------------------
# FEATURES
# -----------------------------
NEXT_PUBLIC_AUTH_ENABLED=${getEnvValue('NEXT_PUBLIC_AUTH_ENABLED') || 'false'}
NEXT_PUBLIC_WEB_SEARCH_ENABLED=${getEnvValue('NEXT_PUBLIC_WEB_SEARCH_ENABLED') || 'true'}
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_IMAGE_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_VIDEO_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_3D_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_3D_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=${getEnvValue('NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED') || getEnvValue('NEXT_PUBLIC_MCP_TOOLS_ENABLED') || 'false'}
NEXT_PUBLIC_MCP_SYSTEM_ENABLED=${getEnvValue('NEXT_PUBLIC_MCP_SYSTEM_ENABLED') || 'false'}

# -----------------------------
# AI MODELS
# -----------------------------
# OpenAI - Required for embeddings
OPENAI_API_KEY=${getEnvValue('OPENAI_API_KEY')}
OPENAI_EMBEDDING_MODEL=${getEnvValue('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small'}

# OpenRouter - Used for various AI models
OPENROUTER_API_KEY=${getEnvValue('OPENROUTER_API_KEY')}

# AI Provider Selection
NEXT_PUBLIC_AI_PROVIDER=${getEnvValue('NEXT_PUBLIC_AI_PROVIDER') || 'openrouter'}

# Available Models Configuration (JSON format)
NEXT_PUBLIC_OPENAI_MODELS=${getEnvValue('NEXT_PUBLIC_OPENAI_MODELS') || DEFAULT_OPENAI_MODELS}
NEXT_PUBLIC_OPENROUTER_MODELS=${getEnvValue('NEXT_PUBLIC_OPENROUTER_MODELS') || DEFAULT_OPENROUTER_MODELS}

# LlamaCloud - Used for document processing
LLAMA_CLOUD_API_KEY=${getEnvValue('LLAMA_CLOUD_API_KEY') || ''}

# Image Generation
IMAGE_GENERATION_PROVIDER=${getEnvValue('IMAGE_GENERATION_PROVIDER') || 'fal'}
VIDEO_GENERATION_PROVIDER=${getEnvValue('VIDEO_GENERATION_PROVIDER') || 'fal'}
REPLICATE_API_TOKEN=${getEnvValue('REPLICATE_API_TOKEN') || ''}
FAL_API_KEY=${getEnvValue('FAL_API_KEY') || ''}
USE_REPLICATE_PROVIDER=${getEnvValue('USE_REPLICATE_PROVIDER') || 'false'}

# Model Configuration
OPENAI_IMAGE_MODEL=${getEnvValue('OPENAI_IMAGE_MODEL') || 'gpt-image-1'}
FAL_IMAGE_MODEL=${getEnvValue('FAL_IMAGE_MODEL') || 'fal-ai/bytedance/seedream/v4/text-to-image'}
FAL_IMAGE_TO_IMAGE_MODEL=${getEnvValue('FAL_IMAGE_TO_IMAGE_MODEL') || 'fal-ai/nano-banana/edit'}
REPLICATE_IMAGE_MODEL=${getEnvValue('REPLICATE_IMAGE_MODEL') || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b'}
FAL_VIDEO_MODEL=${getEnvValue('FAL_VIDEO_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_TEXT_MODEL=${getEnvValue('FAL_VIDEO_TEXT_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_TEXT_FAST_MODEL=${getEnvValue('FAL_VIDEO_TEXT_FAST_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_IMAGE_MODEL=${getEnvValue('FAL_VIDEO_IMAGE_MODEL') || 'fal-ai/veo3/image-to-video'}
FAL_VIDEO_IMAGE_FAST_MODEL=${getEnvValue('FAL_VIDEO_IMAGE_FAST_MODEL') || 'fal-ai/veo3/fast/image-to-video'}
REPLICATE_VIDEO_MODEL=${getEnvValue('REPLICATE_VIDEO_MODEL') || 'firtoz/kandinsky-video-v1:ff4709dd1f088d9cbef17e8075f93fb9b96ab7b39e7f0e665a7f0d50e909c0e0'}
FAL_3D_MODEL=${getEnvValue('FAL_3D_MODEL') || 'fal-ai/trellis'}
REPLICATE_3D_MODEL=${getEnvValue('REPLICATE_3D_MODEL') || 'firtoz/trellis:4876f2a8da1c544772dffa32e8889da4a1bab3a1f5c1937bfcfccb99ae347251'}

# Web Search
EXA_API_KEY=${getEnvValue('EXA_API_KEY') || ''}

# -----------------------------
# AUDIO
# -----------------------------
NEXT_PUBLIC_TTS_DISABLED=${getEnvValue('NEXT_PUBLIC_TTS_DISABLED') || 'false'}
NEXT_PUBLIC_VOICE_PROVIDER=${getEnvValue('NEXT_PUBLIC_VOICE_PROVIDER') || 'openai'}
NEXT_PUBLIC_STT_DISABLED=${getEnvValue('NEXT_PUBLIC_STT_DISABLED') || 'false'}
NEXT_PUBLIC_AUDIO_AUTOPLAY=${getEnvValue('NEXT_PUBLIC_AUDIO_AUTOPLAY') || 'false'}

# ElevenLabs Configuration (optional)
ELEVENLABS_API_KEY=${getEnvValue('ELEVENLABS_API_KEY')}
ELEVENLABS_VOICE_ID=${getEnvValue('ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL'}
ELEVENLABS_MODEL_ID=${getEnvValue('ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2'}
ELEVENLABS_VOICE_STABILITY=${getEnvValue('ELEVENLABS_VOICE_STABILITY') || '0.5'}
ELEVENLABS_SIMILARITY_BOOST=${getEnvValue('ELEVENLABS_SIMILARITY_BOOST') || '0.5'}
ELEVENLABS_SPEAKER_BOOST=${getEnvValue('ELEVENLABS_SPEAKER_BOOST') || 'true'}
ELEVENLABS_VOICE_SPEED=${getEnvValue('ELEVENLABS_VOICE_SPEED') || '1.0'}

# -----------------------------
# DATABASE
# -----------------------------
NEXT_PUBLIC_SUPABASE_URL=${getEnvValue('NEXT_PUBLIC_SUPABASE_URL')}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')}
SUPABASE_SERVICE_ROLE_KEY=${getEnvValue('SUPABASE_SERVICE_ROLE_KEY')}

# -----------------------------
# AUTHENTICATION
# -----------------------------
NEXT_PUBLIC_SITE_URL=${getEnvValue('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000'}
CHATRAG_APP_URL=${getEnvValue('CHATRAG_APP_URL') || getEnvValue('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000'}

# -----------------------------
# EMAIL
# -----------------------------
RESEND_API_KEY=${getEnvValue('RESEND_API_KEY') || ''}

# -----------------------------
# BRANDING
# -----------------------------
NEXT_PUBLIC_APP_NAME=${getEnvValue('NEXT_PUBLIC_APP_NAME') || 'ChatRAG'}
NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT=${getEnvValue('NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT') || 'ChatRAG'}
NEXT_PUBLIC_SIDEBAR_BUTTON_URL=${getEnvValue('NEXT_PUBLIC_SIDEBAR_BUTTON_URL') || 'https://www.chatrag.ai/'}
NEXT_PUBLIC_HEADER_LOGO_TYPE=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_TYPE') || 'text'}
NEXT_PUBLIC_HEADER_LOGO_TEXT=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_TEXT') || 'ChatRAG'}
NEXT_PUBLIC_HEADER_LOGO_URL=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_URL') || ''}
NEXT_PUBLIC_AI_RESPONSE_LOGO_URL=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_URL') || ''}
NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER') || 'true'}
NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE') || '3'}

# -----------------------------
# SUGGESTIONS
# -----------------------------
NEXT_PUBLIC_SHOW_SUGGESTIONS=${getEnvValue('NEXT_PUBLIC_SHOW_SUGGESTIONS') || 'true'}

# -----------------------------
# EMBED WIDGET
# -----------------------------
NEXT_PUBLIC_EMBED_ENABLED=${getEnvValue('NEXT_PUBLIC_EMBED_ENABLED') || 'false'}
NEXT_PUBLIC_EMBED_TITLE=${getEnvValue('NEXT_PUBLIC_EMBED_TITLE') || 'ChatRAG Assistant'}
NEXT_PUBLIC_EMBED_PRIMARY_COLOR=${getEnvValue('NEXT_PUBLIC_EMBED_PRIMARY_COLOR') || '#FF6417'}
NEXT_PUBLIC_EMBED_POSITION=${getEnvValue('NEXT_PUBLIC_EMBED_POSITION') || 'bottom-right'}
NEXT_PUBLIC_EMBED_AUTO_OPEN=${getEnvValue('NEXT_PUBLIC_EMBED_AUTO_OPEN') || 'false'}
NEXT_PUBLIC_EMBED_GREETING=${getEnvValue('NEXT_PUBLIC_EMBED_GREETING') || 'Hello! How can I help you today?'}
NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS=${getEnvValue('NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS') || '*'}
EMBED_REQUIRE_AUTH=${getEnvValue('EMBED_REQUIRE_AUTH') || 'false'}
NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED=${getEnvValue('NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED') || 'true'}
NEXT_PUBLIC_EMBED_SUGGESTIONS=${getEnvValue('NEXT_PUBLIC_EMBED_SUGGESTIONS') || '["What can you help me with?","How does this work?","Tell me about your features","Get started guide"]'}

# -----------------------------
# DOCUMENT PROCESSING
# -----------------------------
NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=${getEnvValue('NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED') || 'false'}

# -----------------------------
# RAG OPTIMIZATION
# -----------------------------
# Number of documents to retrieve (optimized for accuracy)
RAG_INITIAL_MATCH_COUNT=${getEnvValue('RAG_INITIAL_MATCH_COUNT') || '60'}
# Minimum similarity threshold (optimized for accuracy)
RAG_SIMILARITY_THRESHOLD=${getEnvValue('RAG_SIMILARITY_THRESHOLD') || '0.45'}
# RAG Behavior Mode: strict, balanced, flexible, bypass
RAG_BEHAVIOR_MODE=${getEnvValue('RAG_BEHAVIOR_MODE') || 'strict'}
# LlamaCloud configuration
LLAMACLOUD_PARSING_MODE=${getEnvValue('LLAMACLOUD_PARSING_MODE') || 'balanced'}
LLAMACLOUD_CHUNK_STRATEGY=${getEnvValue('LLAMACLOUD_CHUNK_STRATEGY') || 'sentence'}
LLAMACLOUD_CHUNK_SIZE=${getEnvValue('LLAMACLOUD_CHUNK_SIZE') || '1000'}
LLAMACLOUD_CHUNK_OVERLAP=${getEnvValue('LLAMACLOUD_CHUNK_OVERLAP') || '300'}
LLAMACLOUD_MULTIMODAL_PARSING=${getEnvValue('LLAMACLOUD_MULTIMODAL_PARSING') || 'true'}

# Advanced LlamaParse configuration
LLAMACLOUD_PARSE_MODE=${getEnvValue('LLAMACLOUD_PARSE_MODE') || 'parse_page_with_agent'}
LLAMACLOUD_PARSE_MODEL=${getEnvValue('LLAMACLOUD_PARSE_MODEL') || 'gemini-2.5-pro'}
LLAMACLOUD_HIGH_RES_OCR=${getEnvValue('LLAMACLOUD_HIGH_RES_OCR') || 'true'}
LLAMACLOUD_ADAPTIVE_LONG_TABLE=${getEnvValue('LLAMACLOUD_ADAPTIVE_LONG_TABLE') || 'true'}
LLAMACLOUD_OUTLINED_TABLE_EXTRACTION=${getEnvValue('LLAMACLOUD_OUTLINED_TABLE_EXTRACTION') || 'true'}
LLAMACLOUD_OUTPUT_TABLES_AS_HTML=${getEnvValue('LLAMACLOUD_OUTPUT_TABLES_AS_HTML') || 'true'}

# -----------------------------
# RAG MODE CONFIGURATION
# -----------------------------
# -----------------------------
# RAG CONFIGURATION (Unified Optimized System)
# -----------------------------
# Unified RAG Settings - All features can be toggled individually
RAG_MULTI_PASS=${getEnvValue('RAG_MULTI_PASS') || 'true'}
RAG_ADAPTIVE_RETRIEVAL=${getEnvValue('RAG_ADAPTIVE_RETRIEVAL') || 'true'}
RAG_QUERY_ENHANCEMENT=${getEnvValue('RAG_QUERY_ENHANCEMENT') || 'false'}
RAG_ADJACENT_CHUNKS=${getEnvValue('RAG_ADJACENT_CHUNKS') || 'true'}
RAG_CACHE_ENABLED=${getEnvValue('RAG_CACHE_ENABLED') || 'true'}
RAG_ADJACENCY_WINDOW=${getEnvValue('RAG_ADJACENCY_WINDOW') || '2'}
RAG_MATCH_MULTIPLIER=${getEnvValue('RAG_MATCH_MULTIPLIER') || '3'}

# RAG Optimization Parameters
# Optimized for finding specific information with high accuracy
RAG_MMR_LAMBDA=${getEnvValue('RAG_MMR_LAMBDA') || '0.85'}
RAG_MIN_CONFIDENCE=${getEnvValue('RAG_MIN_CONFIDENCE') || '0.7'}
RAG_FINAL_RESULT_COUNT=${getEnvValue('RAG_FINAL_RESULT_COUNT') || '25'}
RAG_DIVERSITY_WEIGHT=${getEnvValue('RAG_DIVERSITY_WEIGHT') || '0.15'}

# RAG Advanced Settings
RAG_ENABLE_ADJACENT_CHUNKS=${getEnvValue('RAG_ENABLE_ADJACENT_CHUNKS') || 'true'}
RAG_MAX_RETRIEVAL_PASSES=${getEnvValue('RAG_MAX_RETRIEVAL_PASSES') || '2'}
RAG_COMPLETENESS_CONFIDENCE=${getEnvValue('RAG_COMPLETENESS_CONFIDENCE') || '0.7'}
RAG_PERFORMANCE_MODE=${getEnvValue('RAG_PERFORMANCE_MODE') || 'accurate'}
RAG_RERANKING=${getEnvValue('RAG_RERANKING') || 'true'}
RAG_RERANKING_STRATEGY=${getEnvValue('RAG_RERANKING_STRATEGY') || 'hybrid'}

# Temporal and Financial Intelligence (Unified RAG)
RAG_TEMPORAL_BOOST=${getEnvValue('RAG_TEMPORAL_BOOST') || 'true'}
RAG_FINANCIAL_BOOST=${getEnvValue('RAG_FINANCIAL_BOOST') || 'true'}
RAG_TEMPORAL_MATCHING=${getEnvValue('RAG_TEMPORAL_MATCHING') || 'false'}
RAG_FALLBACK_LOWER_THRESHOLD=${getEnvValue('RAG_FALLBACK_LOWER_THRESHOLD') || 'true'}

# Query Analysis Thresholds
RAG_EXACT_THRESHOLD=${getEnvValue('RAG_EXACT_THRESHOLD') || '0.75'}
RAG_HIGH_THRESHOLD=${getEnvValue('RAG_HIGH_THRESHOLD') || '0.65'}
RAG_MEDIUM_THRESHOLD=${getEnvValue('RAG_MEDIUM_THRESHOLD') || '0.55'}
RAG_LOW_THRESHOLD=${getEnvValue('RAG_LOW_THRESHOLD') || '0.45'}

# Key Terms Configuration
RAG_EXTRACT_KEY_TERMS=${getEnvValue('RAG_EXTRACT_KEY_TERMS') || 'true'}
RAG_MAX_KEY_TERMS=${getEnvValue('RAG_MAX_KEY_TERMS') || '10'}

# -----------------------------
# DEBUGGING
# -----------------------------
DEBUG_RAG=${getEnvValue('DEBUG_RAG') || 'false'}

# -----------------------------
# MCP CONFIGURATION
# -----------------------------
MCP_ZAPIER_ENDPOINT=${getEnvValue('MCP_ZAPIER_ENDPOINT') || ''}
MCP_CUSTOM_SERVERS=${getEnvValue('MCP_CUSTOM_SERVERS') || '[]'}
`;
}

function getFullTemplate() {
  return `# ChatRAG Configuration - FULL
# Generated by setup tool

# -----------------------------
# FEATURES
# -----------------------------
NEXT_PUBLIC_AUTH_ENABLED=${getEnvValue('NEXT_PUBLIC_AUTH_ENABLED') || 'false'}
NEXT_PUBLIC_WEB_SEARCH_ENABLED=${getEnvValue('NEXT_PUBLIC_WEB_SEARCH_ENABLED') || 'true'}
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_IMAGE_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_VIDEO_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_3D_GENERATION_ENABLED=${getEnvValue('NEXT_PUBLIC_3D_GENERATION_ENABLED') || 'false'}
NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED=${getEnvValue('NEXT_PUBLIC_MCP_TOOLS_LIST_ENABLED') || getEnvValue('NEXT_PUBLIC_MCP_TOOLS_ENABLED') || 'false'}
NEXT_PUBLIC_MCP_SYSTEM_ENABLED=${getEnvValue('NEXT_PUBLIC_MCP_SYSTEM_ENABLED') || 'false'}

# -----------------------------
# AI MODELS
# -----------------------------
# OpenAI - Required for embeddings
OPENAI_API_KEY=${getEnvValue('OPENAI_API_KEY')}
OPENAI_EMBEDDING_MODEL=${getEnvValue('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small'}

# OpenRouter - Used for various AI models
OPENROUTER_API_KEY=${getEnvValue('OPENROUTER_API_KEY')}

# AI Provider Selection
NEXT_PUBLIC_AI_PROVIDER=${getEnvValue('NEXT_PUBLIC_AI_PROVIDER') || 'openrouter'}

# Available Models Configuration (JSON format)
NEXT_PUBLIC_OPENAI_MODELS=${getEnvValue('NEXT_PUBLIC_OPENAI_MODELS') || DEFAULT_OPENAI_MODELS}
NEXT_PUBLIC_OPENROUTER_MODELS=${getEnvValue('NEXT_PUBLIC_OPENROUTER_MODELS') || DEFAULT_OPENROUTER_MODELS}

# Custom Token Limits
USE_CUSTOM_TOKEN_LIMIT=${getEnvValue('USE_CUSTOM_TOKEN_LIMIT') || 'false'}
MAX_COMPLETION_TOKENS=${getEnvValue('MAX_COMPLETION_TOKENS') || '4096'}

# LlamaCloud - Used for document processing
LLAMA_CLOUD_API_KEY=${getEnvValue('LLAMA_CLOUD_API_KEY') || ''}

# Image Generation
IMAGE_GENERATION_PROVIDER=${getEnvValue('IMAGE_GENERATION_PROVIDER') || 'fal'}
VIDEO_GENERATION_PROVIDER=${getEnvValue('VIDEO_GENERATION_PROVIDER') || 'fal'}
REPLICATE_API_TOKEN=${getEnvValue('REPLICATE_API_TOKEN') || ''}
FAL_API_KEY=${getEnvValue('FAL_API_KEY') || ''}
USE_REPLICATE_PROVIDER=${getEnvValue('USE_REPLICATE_PROVIDER') || 'false'}

# OpenAI Image Generation Settings
USE_OPENAI_IMAGE=${getEnvValue('USE_OPENAI_IMAGE') || 'false'}
OPENAI_IMAGE_QUALITY=${getEnvValue('OPENAI_IMAGE_QUALITY') || 'auto'}
OPENAI_IMAGE_BACKGROUND=${getEnvValue('OPENAI_IMAGE_BACKGROUND') || 'opaque'}
OPENAI_IMAGE_FORMAT=${getEnvValue('OPENAI_IMAGE_FORMAT') || 'png'}
OPENAI_IMAGE_MODERATION=${getEnvValue('OPENAI_IMAGE_MODERATION') || 'auto'}

# Model Configuration
OPENAI_IMAGE_MODEL=${getEnvValue('OPENAI_IMAGE_MODEL') || 'gpt-image-1'}
FAL_IMAGE_MODEL=${getEnvValue('FAL_IMAGE_MODEL') || 'fal-ai/bytedance/seedream/v4/text-to-image'}
FAL_IMAGE_TO_IMAGE_MODEL=${getEnvValue('FAL_IMAGE_TO_IMAGE_MODEL') || 'fal-ai/nano-banana/edit'}
REPLICATE_IMAGE_MODEL=${getEnvValue('REPLICATE_IMAGE_MODEL') || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b'}
FAL_VIDEO_MODEL=${getEnvValue('FAL_VIDEO_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_TEXT_MODEL=${getEnvValue('FAL_VIDEO_TEXT_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_TEXT_FAST_MODEL=${getEnvValue('FAL_VIDEO_TEXT_FAST_MODEL') || 'fal-ai/veo3/fast'}
FAL_VIDEO_IMAGE_MODEL=${getEnvValue('FAL_VIDEO_IMAGE_MODEL') || 'fal-ai/veo3/image-to-video'}
FAL_VIDEO_IMAGE_FAST_MODEL=${getEnvValue('FAL_VIDEO_IMAGE_FAST_MODEL') || 'fal-ai/veo3/fast/image-to-video'}
REPLICATE_VIDEO_MODEL=${getEnvValue('REPLICATE_VIDEO_MODEL') || 'firtoz/kandinsky-video-v1:ff4709dd1f088d9cbef17e8075f93fb9b96ab7b39e7f0e665a7f0d50e909c0e0'}
FAL_3D_MODEL=${getEnvValue('FAL_3D_MODEL') || 'fal-ai/trellis'}
REPLICATE_3D_MODEL=${getEnvValue('REPLICATE_3D_MODEL') || 'firtoz/trellis:4876f2a8da1c544772dffa32e8889da4a1bab3a1f5c1937bfcfccb99ae347251'}

# Web Search
EXA_API_KEY=${getEnvValue('EXA_API_KEY') || ''}

# -----------------------------
# AUDIO
# -----------------------------
# Text-to-Speech Settings
NEXT_PUBLIC_TTS_DISABLED=${getEnvValue('NEXT_PUBLIC_TTS_DISABLED') || 'false'}
NEXT_PUBLIC_VOICE_PROVIDER=${getEnvValue('NEXT_PUBLIC_VOICE_PROVIDER') || 'openai'}

# ElevenLabs Configuration
ELEVENLABS_API_KEY=${getEnvValue('ELEVENLABS_API_KEY')}
ELEVENLABS_VOICE_ID=${getEnvValue('ELEVENLABS_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL'}
ELEVENLABS_MODEL_ID=${getEnvValue('ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2'}
ELEVENLABS_VOICE_SPEED=${getEnvValue('ELEVENLABS_VOICE_SPEED') || '1.0'}
ELEVENLABS_VOICE_STABILITY=${getEnvValue('ELEVENLABS_VOICE_STABILITY') || '0.5'}
ELEVENLABS_SIMILARITY_BOOST=${getEnvValue('ELEVENLABS_SIMILARITY_BOOST') || '0.5'}
ELEVENLABS_SPEAKER_BOOST=${getEnvValue('ELEVENLABS_SPEAKER_BOOST') || 'true'}

# Speech-to-Text Settings
NEXT_PUBLIC_STT_DISABLED=${getEnvValue('NEXT_PUBLIC_STT_DISABLED') || 'false'}

# Audio Playback
NEXT_PUBLIC_AUDIO_AUTOPLAY=${getEnvValue('NEXT_PUBLIC_AUDIO_AUTOPLAY') || 'false'}

# -----------------------------
# DATABASE
# -----------------------------
NEXT_PUBLIC_SUPABASE_URL=${getEnvValue('NEXT_PUBLIC_SUPABASE_URL')}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${getEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')}
SUPABASE_SERVICE_ROLE_KEY=${getEnvValue('SUPABASE_SERVICE_ROLE_KEY')}

# -----------------------------
# AUTHENTICATION
# -----------------------------
NEXT_PUBLIC_SITE_URL=${getEnvValue('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000'}
CHATRAG_APP_URL=${getEnvValue('CHATRAG_APP_URL') || getEnvValue('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000'}
NEXT_PUBLIC_GITHUB_CLIENT_ID=${getEnvValue('NEXT_PUBLIC_GITHUB_CLIENT_ID') || ''}
GITHUB_CLIENT_SECRET=${getEnvValue('GITHUB_CLIENT_SECRET') || ''}

# -----------------------------
# PAYMENTS
# -----------------------------
# Stripe Payment
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${getEnvValue('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY') || ''}
STRIPE_SECRET_KEY=${getEnvValue('STRIPE_SECRET_KEY') || ''}
STRIPE_WEBHOOK_SECRET=${getEnvValue('STRIPE_WEBHOOK_SECRET') || ''}
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=${getEnvValue('NEXT_PUBLIC_STRIPE_PRICE_ID_PRO') || ''}
NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE=${getEnvValue('NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE') || ''}

# Polar Payment
POLAR_ACCESS_TOKEN=${getEnvValue('POLAR_ACCESS_TOKEN') || ''}
POLAR_ORGANIZATION_ID=${getEnvValue('POLAR_ORGANIZATION_ID') || ''}
POLAR_WEBHOOK_SECRET=${getEnvValue('POLAR_WEBHOOK_SECRET') || ''}
POLAR_ORGANIZATION_SLUG=${getEnvValue('POLAR_ORGANIZATION_SLUG') || ''}
NEXT_PUBLIC_POLAR_PRICE_ID_PRO=${getEnvValue('NEXT_PUBLIC_POLAR_PRICE_ID_PRO') || ''}
NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE=${getEnvValue('NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE') || ''}
NEXT_PUBLIC_POLAR_CHECKOUT_PRO=${getEnvValue('NEXT_PUBLIC_POLAR_CHECKOUT_PRO') || ''}
NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE=${getEnvValue('NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE') || ''}

# -----------------------------
# EMAIL
# -----------------------------
NEXT_PUBLIC_CUSTOM_SMTP_ENABLED=${getEnvValue('NEXT_PUBLIC_CUSTOM_SMTP_ENABLED') || 'false'}
NEXT_PUBLIC_SMTP_FROM_NAME=${getEnvValue('NEXT_PUBLIC_SMTP_FROM_NAME') || 'ChatRAG Support'}
NEXT_PUBLIC_SMTP_FROM_EMAIL=${getEnvValue('NEXT_PUBLIC_SMTP_FROM_EMAIL') || 'support@example.com'}
RESEND_API_KEY=${getEnvValue('RESEND_API_KEY') || ''}

# -----------------------------
# BRANDING
# -----------------------------
# Application Name
NEXT_PUBLIC_APP_NAME=${getEnvValue('NEXT_PUBLIC_APP_NAME') || 'ChatRAG'}

# Sidebar Button
NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT=${getEnvValue('NEXT_PUBLIC_SIDEBAR_BUTTON_TEXT') || 'ChatRAG'}
NEXT_PUBLIC_SIDEBAR_BUTTON_URL=${getEnvValue('NEXT_PUBLIC_SIDEBAR_BUTTON_URL') || 'https://www.chatrag.ai/'}

# Header Logo
NEXT_PUBLIC_HEADER_LOGO_TYPE=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_TYPE') || 'text'}
NEXT_PUBLIC_HEADER_LOGO_TEXT=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_TEXT') || 'ChatRAG'}
NEXT_PUBLIC_HEADER_LOGO_URL=${getEnvValue('NEXT_PUBLIC_HEADER_LOGO_URL') || ''}

# Welcome Text
NEXT_PUBLIC_WELCOME_TEXT=${getEnvValue('NEXT_PUBLIC_WELCOME_TEXT') || 'Welcome to ChatRAG'}
NEXT_PUBLIC_WELCOME_TEXT_MODE=${getEnvValue('NEXT_PUBLIC_WELCOME_TEXT_MODE') || 'custom'}
NEXT_PUBLIC_WELCOME_TEXT_GRADIENT=${getEnvValue('NEXT_PUBLIC_WELCOME_TEXT_GRADIENT') || 'orange'}
NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS=${getEnvValue('NEXT_PUBLIC_WELCOME_TEXT_TRANSLATIONS') || '{}'}
NEXT_PUBLIC_WELCOME_MESSAGES=${getEnvValue('NEXT_PUBLIC_WELCOME_MESSAGES') || '[]'}
NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS=${getEnvValue('NEXT_PUBLIC_WELCOME_MESSAGES_TRANSLATIONS') || '{}'}
NEXT_PUBLIC_MANUAL_USERNAME=${getEnvValue('NEXT_PUBLIC_MANUAL_USERNAME') || ''}

# AI Response Logo
NEXT_PUBLIC_AI_LOGO_TYPE=${getEnvValue('NEXT_PUBLIC_AI_LOGO_TYPE') || 'default'}
NEXT_PUBLIC_AI_RESPONSE_LOGO_URL=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_URL') || ''}
NEXT_PUBLIC_USE_DEFAULT_AI_LOGO=${getEnvValue('NEXT_PUBLIC_USE_DEFAULT_AI_LOGO') || 'true'}
NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER') || 'true'}
NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=${getEnvValue('NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE') || '3'}

# Favicon & Site Title
NEXT_PUBLIC_SITE_TITLE=${getEnvValue('NEXT_PUBLIC_SITE_TITLE') || 'ChatRAG'}
NEXT_PUBLIC_FAVICON_URL=${getEnvValue('NEXT_PUBLIC_FAVICON_URL') || ''}

# -----------------------------
# SAVED CHATS
# -----------------------------
# Chat Title Generation
CHAT_TITLE_MODEL=${getEnvValue('CHAT_TITLE_MODEL') || 'anthropic/claude-haiku-4.5'}
CHAT_TITLE_TEMPERATURE=${getEnvValue('CHAT_TITLE_TEMPERATURE') || '0.5'}
CHAT_TITLE_MAX_TOKENS=${getEnvValue('CHAT_TITLE_MAX_TOKENS') || '100'}

# -----------------------------
# SUGGESTIONS
# -----------------------------
NEXT_PUBLIC_SHOW_SUGGESTIONS=${getEnvValue('NEXT_PUBLIC_SHOW_SUGGESTIONS') || 'true'}
NEXT_PUBLIC_SUGGESTION_GROUPS=${getEnvValue('NEXT_PUBLIC_SUGGESTION_GROUPS') || '[]'}

# -----------------------------
# EMBED WIDGET
# -----------------------------
NEXT_PUBLIC_EMBED_ENABLED=${getEnvValue('NEXT_PUBLIC_EMBED_ENABLED') || 'false'}
NEXT_PUBLIC_EMBED_TITLE=${getEnvValue('NEXT_PUBLIC_EMBED_TITLE') || 'ChatRAG Assistant'}
NEXT_PUBLIC_EMBED_PRIMARY_COLOR=${getEnvValue('NEXT_PUBLIC_EMBED_PRIMARY_COLOR') || '#FF6417'}
NEXT_PUBLIC_EMBED_POSITION=${getEnvValue('NEXT_PUBLIC_EMBED_POSITION') || 'bottom-right'}
NEXT_PUBLIC_EMBED_AUTO_OPEN=${getEnvValue('NEXT_PUBLIC_EMBED_AUTO_OPEN') || 'false'}
NEXT_PUBLIC_EMBED_GREETING=${getEnvValue('NEXT_PUBLIC_EMBED_GREETING') || 'Hello! How can I help you today?'}
NEXT_PUBLIC_EMBED_MODEL=${getEnvValue('NEXT_PUBLIC_EMBED_MODEL') || ''}
NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS=${getEnvValue('NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS') || '*'}
EMBED_REQUIRE_AUTH=${getEnvValue('EMBED_REQUIRE_AUTH') || 'false'}
NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED=${getEnvValue('NEXT_PUBLIC_EMBED_SUGGESTIONS_ENABLED') || 'true'}
NEXT_PUBLIC_EMBED_SUGGESTIONS=${getEnvValue('NEXT_PUBLIC_EMBED_SUGGESTIONS') || '["What can you help me with?","How does this work?","Tell me about your features","Get started guide"]'}

# -----------------------------
# WHATSAPP
# -----------------------------
NEXT_PUBLIC_WHATSAPP_ENABLED=${getEnvValue('NEXT_PUBLIC_WHATSAPP_ENABLED') || 'false'}
WHATSAPP_PROVIDER=${getEnvValue('WHATSAPP_PROVIDER') || 'koyeb'}
KOYEB_BAILEYS_URL=${getEnvValue('KOYEB_BAILEYS_URL') || ''}
KOYEB_API_KEY=${getEnvValue('KOYEB_API_KEY') || ''}
FLYIO_BAILEYS_URL=${getEnvValue('FLYIO_BAILEYS_URL') || ''}
FLYIO_API_KEY=${getEnvValue('FLYIO_API_KEY') || ''}
WHATSAPP_WEBHOOK_SECRET=${getEnvValue('WHATSAPP_WEBHOOK_SECRET') || ''}
WHATSAPP_WEBHOOK_URL=${getEnvValue('WHATSAPP_WEBHOOK_URL') || ''}
WHATSAPP_ENABLE_MCP=${getEnvValue('WHATSAPP_ENABLE_MCP') || 'false'}
WHATSAPP_ENABLE_WEB_SEARCH=${getEnvValue('WHATSAPP_ENABLE_WEB_SEARCH') || 'false'}
WHATSAPP_DEFAULT_MODEL=${getEnvValue('WHATSAPP_DEFAULT_MODEL') || ''}
WHATSAPP_MAX_TOKENS=${getEnvValue('WHATSAPP_MAX_TOKENS') || '2048'}
WHATSAPP_MAX_SESSIONS_PER_USER=${getEnvValue('WHATSAPP_MAX_SESSIONS_PER_USER') || '5'}
WHATSAPP_MESSAGE_QUEUE_SIZE=${getEnvValue('WHATSAPP_MESSAGE_QUEUE_SIZE') || '10'}

# -----------------------------
# RAG SETTINGS
# -----------------------------
# The system assembles the prompt as: PRE_CONTEXT + {{context}} + POST_CONTEXT
RAG_PRE_CONTEXT=${getEnvValue('RAG_PRE_CONTEXT') || ''}
RAG_POST_CONTEXT=${getEnvValue('RAG_POST_CONTEXT') || ''}

# -----------------------------
# DOCUMENT PROCESSING
# -----------------------------
NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD=${getEnvValue('NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD') || 'false'}
NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED=${getEnvValue('NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED') || 'false'}

# -----------------------------
# RAG OPTIMIZATION
# -----------------------------
# Number of documents to retrieve (optimized for accuracy)
RAG_INITIAL_MATCH_COUNT=${getEnvValue('RAG_INITIAL_MATCH_COUNT') || '60'}
# Minimum similarity threshold (optimized for accuracy)
RAG_SIMILARITY_THRESHOLD=${getEnvValue('RAG_SIMILARITY_THRESHOLD') || '0.45'}
# RAG Behavior Mode: strict, balanced, flexible, bypass
RAG_BEHAVIOR_MODE=${getEnvValue('RAG_BEHAVIOR_MODE') || 'strict'}
# LlamaCloud configuration
LLAMACLOUD_PARSING_MODE=${getEnvValue('LLAMACLOUD_PARSING_MODE') || 'balanced'}
LLAMACLOUD_CHUNK_STRATEGY=${getEnvValue('LLAMACLOUD_CHUNK_STRATEGY') || 'sentence'}
LLAMACLOUD_CHUNK_SIZE=${getEnvValue('LLAMACLOUD_CHUNK_SIZE') || '1000'}
LLAMACLOUD_CHUNK_OVERLAP=${getEnvValue('LLAMACLOUD_CHUNK_OVERLAP') || '300'}
LLAMACLOUD_MULTIMODAL_PARSING=${getEnvValue('LLAMACLOUD_MULTIMODAL_PARSING') || 'true'}

# Advanced LlamaParse configuration
LLAMACLOUD_PARSE_MODE=${getEnvValue('LLAMACLOUD_PARSE_MODE') || 'parse_page_with_agent'}
LLAMACLOUD_PARSE_MODEL=${getEnvValue('LLAMACLOUD_PARSE_MODEL') || 'gemini-2.5-pro'}
LLAMACLOUD_HIGH_RES_OCR=${getEnvValue('LLAMACLOUD_HIGH_RES_OCR') || 'true'}
LLAMACLOUD_ADAPTIVE_LONG_TABLE=${getEnvValue('LLAMACLOUD_ADAPTIVE_LONG_TABLE') || 'true'}
LLAMACLOUD_OUTLINED_TABLE_EXTRACTION=${getEnvValue('LLAMACLOUD_OUTLINED_TABLE_EXTRACTION') || 'true'}
LLAMACLOUD_OUTPUT_TABLES_AS_HTML=${getEnvValue('LLAMACLOUD_OUTPUT_TABLES_AS_HTML') || 'true'}

# -----------------------------
# RAG MODE CONFIGURATION
# -----------------------------
# -----------------------------
# RAG CONFIGURATION (Unified Optimized System)
# -----------------------------
# Unified RAG Settings - All features can be toggled individually
RAG_MULTI_PASS=${getEnvValue('RAG_MULTI_PASS') || 'true'}
RAG_ADAPTIVE_RETRIEVAL=${getEnvValue('RAG_ADAPTIVE_RETRIEVAL') || 'true'}
RAG_QUERY_ENHANCEMENT=${getEnvValue('RAG_QUERY_ENHANCEMENT') || 'false'}
RAG_ADJACENT_CHUNKS=${getEnvValue('RAG_ADJACENT_CHUNKS') || 'true'}
RAG_CACHE_ENABLED=${getEnvValue('RAG_CACHE_ENABLED') || 'true'}
RAG_ADJACENCY_WINDOW=${getEnvValue('RAG_ADJACENCY_WINDOW') || '2'}
RAG_MATCH_MULTIPLIER=${getEnvValue('RAG_MATCH_MULTIPLIER') || '3'}

# RAG Optimization Parameters
# Optimized for finding specific information with high accuracy
RAG_MMR_LAMBDA=${getEnvValue('RAG_MMR_LAMBDA') || '0.85'}
RAG_MIN_CONFIDENCE=${getEnvValue('RAG_MIN_CONFIDENCE') || '0.7'}
RAG_FINAL_RESULT_COUNT=${getEnvValue('RAG_FINAL_RESULT_COUNT') || '25'}
RAG_DIVERSITY_WEIGHT=${getEnvValue('RAG_DIVERSITY_WEIGHT') || '0.15'}

# RAG Advanced Settings
RAG_ENABLE_ADJACENT_CHUNKS=${getEnvValue('RAG_ENABLE_ADJACENT_CHUNKS') || 'true'}
RAG_MAX_RETRIEVAL_PASSES=${getEnvValue('RAG_MAX_RETRIEVAL_PASSES') || '2'}
RAG_COMPLETENESS_CONFIDENCE=${getEnvValue('RAG_COMPLETENESS_CONFIDENCE') || '0.7'}
RAG_PERFORMANCE_MODE=${getEnvValue('RAG_PERFORMANCE_MODE') || 'accurate'}
RAG_RERANKING=${getEnvValue('RAG_RERANKING') || 'true'}
RAG_RERANKING_STRATEGY=${getEnvValue('RAG_RERANKING_STRATEGY') || 'hybrid'}

# Temporal and Financial Intelligence (Unified RAG)
RAG_TEMPORAL_BOOST=${getEnvValue('RAG_TEMPORAL_BOOST') || 'true'}
RAG_FINANCIAL_BOOST=${getEnvValue('RAG_FINANCIAL_BOOST') || 'true'}
RAG_TEMPORAL_MATCHING=${getEnvValue('RAG_TEMPORAL_MATCHING') || 'false'}
RAG_FALLBACK_LOWER_THRESHOLD=${getEnvValue('RAG_FALLBACK_LOWER_THRESHOLD') || 'true'}

# Query Analysis Thresholds
RAG_EXACT_THRESHOLD=${getEnvValue('RAG_EXACT_THRESHOLD') || '0.75'}
RAG_HIGH_THRESHOLD=${getEnvValue('RAG_HIGH_THRESHOLD') || '0.65'}
RAG_MEDIUM_THRESHOLD=${getEnvValue('RAG_MEDIUM_THRESHOLD') || '0.55'}
RAG_LOW_THRESHOLD=${getEnvValue('RAG_LOW_THRESHOLD') || '0.45'}

# Key Terms Configuration
RAG_EXTRACT_KEY_TERMS=${getEnvValue('RAG_EXTRACT_KEY_TERMS') || 'true'}
RAG_MAX_KEY_TERMS=${getEnvValue('RAG_MAX_KEY_TERMS') || '10'}

# -----------------------------
# DEBUGGING
# -----------------------------
DEBUG_RAG=${getEnvValue('DEBUG_RAG') || 'false'}

# -----------------------------
# MCP CONFIGURATION
# -----------------------------
MCP_ZAPIER_ENDPOINT=${getEnvValue('MCP_ZAPIER_ENDPOINT') || ''}
MCP_CONTEXT7_ENDPOINT=${getEnvValue('MCP_CONTEXT7_ENDPOINT') || ''}
MCP_21ST_DEV_ENDPOINT=${getEnvValue('MCP_21ST_DEV_ENDPOINT') || ''}
MCP_BRAVE_SEARCH_ENDPOINT=${getEnvValue('MCP_BRAVE_SEARCH_ENDPOINT') || ''}
MCP_CUSTOM_SERVERS=${getEnvValue('MCP_CUSTOM_SERVERS') || '[]'}

# -----------------------------
# ADMIN
# -----------------------------
ADMIN_EMAIL=${getEnvValue('ADMIN_EMAIL') || ''}
ADMIN_PASSWORD=${getEnvValue('ADMIN_PASSWORD') || ''}
`;
}

// API endpoint for uploading logo files
app.post('/api/config/upload-logo', upload.single('logoFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const type = req.body.type || 'ai';
    const relativePath = `/logos/${type}/${req.file.filename}`;

    console.log(`API: Logo file uploaded to ${relativePath}`);

    res.json({
      success: true,
      filePath: relativePath,
      message: 'Logo uploaded successfully'
    });
  } catch (error) {
    console.error('API: Error uploading logo:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for uploading favicon
app.post('/api/config/upload-favicon', multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(REPO_ROOT, 'public'));
    },
    filename: function (req, file, cb) {
      const extension = path.extname(file.originalname);
      cb(null, `favicon${extension}`);
    }
  })
}).single('favicon'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const relativePath = `/${req.file.filename}`;

    console.log(`API: Favicon uploaded to ${relativePath}`);

    res.json({
      success: true,
      url: relativePath,
      message: 'Favicon uploaded successfully'
    });
  } catch (error) {
    console.error('API: Error uploading favicon:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin API endpoints
app.get('/api/config/admin/status', async (req, res) => {
  try {
    console.log('API: Checking admin status');
    // Check if admin is configured in .env.local
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const config = dotenv.parse(envContent || '');

    // Basic environment configuration check
    const hasAdminConfig = !!(config.ADMIN_EMAIL && config.ADMIN_PASSWORD);
    const hasDbConfig = !!(config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);

    console.log(`API: Admin email configured: ${!!config.ADMIN_EMAIL}`);
    console.log(`API: Admin password configured: ${!!config.ADMIN_PASSWORD}`);
    console.log(`API: Database connection configured: ${hasDbConfig}`);

    let adminCount = 0;
    let error = null;

    // Only check database if DB configuration exists
    if (hasDbConfig) {
      try {
        const result = await execPromise('node -e "console.log(\'Database connection test\')"');
        console.log('API: Basic Node.js script execution successful');

        // Try a simple check for admin count
        const adminCountResult = await checkAdminUsers();
        adminCount = adminCountResult.adminCount || 0;
        error = adminCountResult.error;

        console.log(`API: Admin count from database: ${adminCount}`);
        if (error) {
          console.error('API: Error checking admin users:', error);
        }
      } catch (execError) {
        console.error('API: Error executing test script:', execError);
        error = execError;
      }
    } else {
      console.log('API: Skipping database check due to missing configuration');
    }

    res.json({
      isSetup: hasAdminConfig,
      adminCount: adminCount,
      hasDbConfig: hasDbConfig,
      hasError: !!error,
      errorMessage: error ? error.toString() : null,
      debug: {
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd()
      }
    });
  } catch (error) {
    console.error('API: Error checking admin status:', error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      isSetup: false,
      adminCount: 0
    });
  }
});

app.get('/api/config/admin/users', async (req, res) => {
  try {
    console.log('API: Fetching admin users');

    // Check if database configuration exists
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const config = dotenv.parse(envContent || '');

    const hasDbConfig = !!(config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);

    if (!hasDbConfig) {
      console.log('API: Missing database configuration, returning empty user list');
      return res.json({
        users: [],
        message: 'Database configuration is missing'
      });
    }

    // First try to use our specialized script
    try {
      // Run a script to get admin users from the database
      const { output, users, error } = await getAdminUsers();

      if (error) {
        console.warn('API: Error getting admin users with script:', error);
        // Return primary admin as fallback if it exists
        if (config.ADMIN_EMAIL) {
          console.log('API: Falling back to admin email from .env.local');
          return res.json({
            users: [
              {
                id: 'from-env-file',
                email: config.ADMIN_EMAIL,
                created_at: new Date().toISOString()
              }
            ],
            isPartial: true,
            message: 'Using fallback data from .env file'
          });
        }

        return res.json({
          users: [],
          error: error.message
        });
      }

      // Return users that were found
      return res.json({
        users: users || [],
        output: process.env.NODE_ENV === 'development' ? output : undefined
      });
    } catch (scriptError) {
      console.error('API: Error executing admin users script:', scriptError);

      // Fallback to admin from env file
      if (config.ADMIN_EMAIL) {
        return res.json({
          users: [
            {
              id: 'from-env-file',
              email: config.ADMIN_EMAIL,
              created_at: new Date().toISOString()
            }
          ],
          isPartial: true,
          error: scriptError.message
        });
      }

      // Return empty with error
      return res.json({
        users: [],
        error: scriptError.message
      });
    }
  } catch (error) {
    console.error('API: Fatal error getting admin users:', error);
    res.status(500).json({
      error: error.message,
      users: []
    });
  }
});

app.post('/api/config/admin/script', async (req, res) => {
  try {
    const { script } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'Script name is required' });
    }

    // Whitelist of allowed scripts
    const allowedScripts = [
      'setup-admin',
      'check-admin',
      'reset-admin-password',
      'list-admin-emails',
      'add-admin'
    ];

    if (!allowedScripts.includes(script)) {
      return res.status(400).json({ error: 'Invalid script name' });
    }

    const { output, error } = await runAdminScript(script);

    if (error) {
      return res.status(500).json({ error: error.message, output });
    }

    res.json({ output });
  } catch (error) {
    console.error('Error running admin script:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/admin/add', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    console.log('Adding admin user without password:', email);

    // Since we're not using passwords anymore, we need to directly add the user to admin_users table
    // This requires using Supabase admin client to find the user and add them
    const { createClient } = require('@supabase/supabase-js');

    // Get Supabase credentials from environment
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const envVars = dotenv.parse(envContent);

    const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, find the user by email
    const { data: users, error: findError } = await supabase.auth.admin.listUsers();

    if (findError) {
      console.error('Error finding user:', findError);
      return res.status(500).json({ error: 'Failed to find user' });
    }

    const user = users.users.find(u => u.email === email);

    if (!user) {
      return res.status(404).json({ error: 'User not found. Make sure they are registered first.' });
    }

    // Add user to admin_users table
    const { error: insertError } = await supabase
      .from('admin_users')
      .insert({ id: user.id })
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(400).json({ error: 'User is already an admin' });
      }
      console.error('Error adding admin:', insertError);
      return res.status(500).json({ error: 'Failed to add admin user' });
    }

    console.log(`Successfully added ${email} as admin`);
    res.json({ success: true, message: `${email} has been added as an admin` });
  } catch (error) {
    console.error('Error adding admin user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Setup admin endpoint - saves to .env.local and creates admin in Supabase
app.post('/api/admin/setup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log('Setting up primary admin:', email);

    // Get Supabase credentials from environment
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const envVars = dotenv.parse(envContent);

    const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'Supabase configuration missing. Please configure Database settings first.' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user exists in auth
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return res.status(500).json({ error: 'Failed to access user database' });
    }

    let userId;
    const existingUser = users.users.find(u => u.email === email);

    if (existingUser) {
      console.log(`User ${email} already exists, updating password`);
      userId = existingUser.id;

      // Update password
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        userId,
        { password }
      );

      if (updateError) {
        console.error('Error updating password:', updateError);
        return res.status(500).json({ error: 'Failed to update user password' });
      }
    } else {
      console.log(`Creating new user: ${email}`);
      // Create new user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (createError) {
        console.error('Error creating user:', createError);
        return res.status(500).json({ error: `Failed to create user: ${createError.message}` });
      }

      userId = newUser.user.id;
    }

    // Check if user is already an admin
    const { data: existingAdmin, error: adminCheckError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .single();

    if (adminCheckError && adminCheckError.code !== 'PGRST116') {
      console.error('Error checking admin status:', adminCheckError);
      return res.status(500).json({ error: 'Failed to check admin status' });
    }

    if (!existingAdmin) {
      // Add user to admin_users table
      const { error: insertError } = await supabase
        .from('admin_users')
        .insert({
          id: userId,
          created_by: userId
        });

      if (insertError) {
        console.error('Error adding to admin_users:', insertError);
        return res.status(500).json({ error: 'Failed to add admin privileges' });
      }
    }

    // Update .env.local with admin credentials
    const lines = envContent.split('\n');
    let adminEmailFound = false;
    let adminPasswordFound = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('ADMIN_EMAIL=')) {
        lines[i] = `ADMIN_EMAIL=${email}`;
        adminEmailFound = true;
      } else if (lines[i].startsWith('ADMIN_PASSWORD=')) {
        lines[i] = `ADMIN_PASSWORD=${password}`;
        adminPasswordFound = true;
      }
    }

    // If not found, add them at the end
    if (!adminEmailFound) {
      lines.push(`ADMIN_EMAIL=${email}`);
    }
    if (!adminPasswordFound) {
      lines.push(`ADMIN_PASSWORD=${password}`);
    }

    // Write back to .env.local
    fs.writeFileSync(envPath, lines.join('\n'));

    console.log(`✅ Successfully set up admin: ${email}`);
    res.json({
      success: true,
      message: `Admin ${email} has been set up successfully! You can now activate admin access in the Settings → Admin tab.`,
      userId
    });
  } catch (error) {
    console.error('Error setting up admin:', error);
    res.status(500).json({ error: error.message });
  }
});

// Password reset endpoint removed - no longer needed in passwordless system

app.post('/api/config/admin/remove', async (req, res) => {
  try {
    const { adminId } = req.body;

    if (!adminId) {
      return res.status(400).json({ error: 'Admin ID is required' });
    }

    // Run a script to remove the admin user
    const { output, error } = await removeAdminUser(adminId);

    if (error) {
      return res.status(500).json({ error: error.message, output });
    }

    res.json({ success: true, output });
  } catch (error) {
    console.error('Error removing admin user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for admin operations
async function checkAdminUsers() {
  try {
    // Execute a script to check the admin_users table
    const result = await execPromise('node scripts/config-ui/admin/check-admin.js');

    // Parse the output to get the admin count
    const adminCount = (result.match(/Found (\d+) admins/i) || [])[1];

    return {
      adminCount: parseInt(adminCount || '0', 10),
      output: result
    };
  } catch (error) {
    console.error('Error checking admin users:', error);
    return { error, adminCount: 0 };
  }
}

async function getAdminUsers() {
  try {
    // First try to use our specialized list-admin-emails script
    const adminEmailsScriptPath = path.join(REPO_ROOT, 'scripts', 'config-ui', 'admin', 'list-admin-emails.js');

    if (fs.existsSync(adminEmailsScriptPath)) {
      // Use the dedicated script that properly fetches emails
      const result = await execPromise('node scripts/config-ui/admin/list-admin-emails.js');

      // Try to extract admin info from the output
      const adminUsers = [];
      const emailRegex = /- Email: (.+), ID: ([a-f0-9-]+), Created: (.+)/g;
      let match;

      while ((match = emailRegex.exec(result)) !== null) {
        adminUsers.push({
          id: match[2],
          email: match[1],
          created_at: match[3]
        });
      }

      // If we found users, return them
      if (adminUsers.length > 0) {
        return {
          users: adminUsers,
          output: result
        };
      }

      // Otherwise fall back to the check-admin script
    }

    // Fall back to using check-admin script and parsing its output
    const result = await execPromise('node scripts/config-ui/admin/check-admin.js');

    // Extract admin IDs from the output
    const adminUsers = [];
    const adminIdRegex = /Admin ID: ([a-f0-9-]+), Created at: ([\d\-T:.Z]+)/g;
    let match;

    while ((match = adminIdRegex.exec(result)) !== null) {
      adminUsers.push({
        id: match[1],
        created_at: match[2],
        // For now, we can't easily get the email, so just use a placeholder
        email: 'admin@example.com'
      });
    }

    return {
      users: adminUsers,
      output: result
    };
  } catch (error) {
    console.error('Error getting admin users:', error);
    return { error, users: [] };
  }
}

async function runAdminScript(scriptName, envFile = null) {
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'config-ui', 'admin', `${scriptName}.js`);

  if (!fs.existsSync(scriptPath)) {
    return { error: new Error(`Script not found: ${scriptName}.js`) };
  }

  try {
    // Set up environment variables for the script
    const env = { ...process.env };

    // If a custom env file is provided, load it
    if (envFile && fs.existsSync(envFile)) {
      const customEnv = dotenv.parse(fs.readFileSync(envFile));
      Object.assign(env, customEnv);
    } else {
      // Load the .env.local file
      const envPath = path.join(REPO_ROOT, '.env.local');
      if (fs.existsSync(envPath)) {
        const localEnv = dotenv.parse(fs.readFileSync(envPath));
        Object.assign(env, localEnv);
      }
    }

    // Execute the script
    const result = await execPromise(`node scripts/config-ui/admin/${scriptName}.js`, { env });
    return { output: result };
  } catch (error) {
    console.error(`Error running script ${scriptName}:`, error);
    return { error, output: error.stdout };
  }
}

async function removeAdminUser(adminId) {
  // Create a custom script to remove a specific admin user
  const tempScriptPath = path.join(REPO_ROOT, 'scripts', 'tmp-remove-admin.js');

  const scriptContent = `
// Temporary script to remove admin user
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.local'
});

// Create Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, supabaseServiceKey);

async function removeAdmin() {
  try {
    const adminId = '${adminId}';
    console.log(\`Removing admin with ID: \${adminId}...\`);
    
    // Delete from admin_users table
    const { error: deleteError } = await adminClient
      .from('admin_users')
      .delete()
      .eq('id', adminId);
      
    if (deleteError) {
      console.error('Error deleting admin user:', deleteError);
      return;
    }
    
    console.log(\`✅ Successfully removed admin user with ID \${adminId}!\`);
    
  } catch (error) {
    console.error('Unexpected error during admin removal:', error);
  }
}

// Run the function
removeAdmin()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
`;

  try {
    // Write the temporary script
    fs.writeFileSync(tempScriptPath, scriptContent);

    // Execute the script
    const result = await execPromise(`node ${tempScriptPath}`);

    // Clean up the temporary script
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }

    return { output: result };
  } catch (error) {
    console.error('Error removing admin user:', error);

    // Clean up the temporary script even if there was an error
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }

    return { error, output: error.stdout };
  }
}

// Helper function to promisify exec
function execPromise(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// API endpoint to get environment variable
app.get('/api/config/get-env', (req, res) => {
  try {
    const varName = req.query.var;
    if (!varName) {
      return res.status(400).json({ error: 'No variable name provided' });
    }

    // Read the current env file content
    const envFilePath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';

    const envVars = parseEnvFile(envContent);

    // Return the variable value if it exists
    if (varName in envVars) {
      console.log(`API: Returning environment variable ${varName}:`, envVars[varName]);
      return res.json({ success: true, value: envVars[varName] });
    } else {
      // For the border setting, default to true if not found
      if (varName === 'NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER') {
        console.log(`API: Variable ${varName} not found, returning default 'true'`);
        return res.json({ success: true, value: 'true' });
      }
      return res.json({ success: false, message: 'Variable not found' });
    }
  } catch (error) {
    console.error('API: Error fetching environment variable:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get logo settings
app.get('/api/config/get-logo', (req, res) => {
  try {
    const type = req.query.type || 'ai'; // 'ai' or 'header'

    // Read the current env file content
    const envFilePath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';

    const envVars = parseEnvFile(envContent);

    // For AI logo
    if (type === 'ai') {
      // Get the logo size and ensure it's a valid number between 1 and 5
      let logoSize = 3; // Default to medium (3)
      if (envVars.hasOwnProperty('NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE')) {
        const parsedSize = parseInt(envVars['NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE']);
        if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 5) {
          logoSize = parsedSize;
        }
      }

      const response = {
        logoUrl: envVars['NEXT_PUBLIC_AI_RESPONSE_LOGO_URL'] || null,
        showBorder: envVars.hasOwnProperty('NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER')
          ? envVars['NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER'].toLowerCase() === 'true'
          : true, // Default to true if not set
        logoSize: logoSize
      };

      console.log(`API: Returning AI logo settings:`, response);
      return res.json(response);
    }

    // For header logo
    if (type === 'header') {
      const logoType = envVars['NEXT_PUBLIC_HEADER_LOGO_TYPE'] || 'text';

      const response = {
        logoType,
        logoText: envVars['NEXT_PUBLIC_HEADER_LOGO_TEXT'] || 'ChatRAG',
        logoUrl: envVars['NEXT_PUBLIC_HEADER_LOGO_URL'] || null
      };

      console.log(`API: Returning header logo settings:`, response);
      return res.json(response);
    }

    res.status(400).json({ error: 'Invalid logo type. Use "ai" or "header".' });
  } catch (error) {
    console.error('API: Error fetching logo settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for Live Preview to connect to the main ChatRAG embed API
app.post('/api/embed/chat/proxy', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding chat request to main ChatRAG app...');

    // Prepare the request to the main ChatRAG app
    const postData = JSON.stringify(req.body);

    const { client, options } = createMainAppRequest('/api/embed/chat', 'POST', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    });

    // Create the request to the main app
    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Set response headers
      res.statusCode = proxyRes.statusCode;

      // Forward response headers, especially important for streaming
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Stream the response back to the client
      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Successfully completed streaming response');
      });
    });

    // Handle proxy request errors
    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      if (!res.headersSent) {
        res.status(500).json(mainAppConnectionError(error));
      }
    });

    // Handle client connection errors
    req.on('error', (error) => {
      console.error('❌ Config Proxy: Client connection error:', error);
      proxyReq.destroy();
    });

    // Send the request body to the main app
    proxyReq.write(postData);
    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy error: Unexpected error occurred.',
        details: error.message
      });
    }
  }
});

// Proxy endpoint for fetching documents from the main ChatRAG app
app.get('/api/documents', async (req, res) => {
  try {
    // Build query string with organization_id if provided
    let queryString = '';
    if (req.query.organization_id !== undefined) {
      queryString = `?organization_id=${encodeURIComponent(req.query.organization_id)}`;
    }

    console.log('🔄 Config Proxy: Forwarding documents fetch request to main ChatRAG app...');
    console.log('📂 Organization ID:', req.query.organization_id || 'null (flat personal workspace)');

    // Forward cookies from the browser for authentication
    const cookieHeader = req.headers.cookie || '';

    const { client, options } = createMainAppRequest('/api/documents' + queryString, 'GET', {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader  // Forward authentication cookies
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Documents fetch completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for deleting documents from the main ChatRAG app
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    console.log(`🔄 Config Proxy: Forwarding document delete request for ${docId} to main ChatRAG app...`);

    // Forward cookies from the browser for authentication
    const cookieHeader = req.headers.cookie || '';

    const { client, options } = createMainAppRequest(`/api/documents/${docId}`, 'DELETE', {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader  // Forward authentication cookies
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Document delete completed');
        try {
          if (data) {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
          } else {
            res.json({ success: true });
          }
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for document processing to connect to the main ChatRAG app
app.post('/api/process-document', documentUpload.single('file'), async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding document processing request to main ChatRAG app...');
    console.log('📁 File received:', req.file ? req.file.originalname : 'No file');
    console.log('📝 Body:', req.body);
    console.log('📂 Organization ID:', req.body.organization_id || 'null (flat personal workspace)');

    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Forward cookies from the browser for authentication
    const cookieHeader = req.headers.cookie || '';

    // Use fetch API for easier form data handling
    const FormData = require('form-data');
    const form = new FormData();

    // Add the file from multer
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Add other form fields
    if (req.body.isTemporary) {
      form.append('isTemporary', req.body.isTemporary);
    }

    // Add organization_id for multi-tenant mode
    if (req.body.organization_id) {
      form.append('organization_id', req.body.organization_id);
      console.log('📂 Adding organization_id to form:', req.body.organization_id);
    }

    const { client, options } = createMainAppRequest('/api/process-document', 'POST', {
        ...form.getHeaders(),
        'Cookie': cookieHeader  // Forward authentication cookies
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Stream response back
      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Document processing request completed');
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      if (!res.headersSent) {
        res.status(500).json(mainAppConnectionError(error));
      }
    });

    // Pipe the form data to the request
    form.pipe(proxyReq);

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy error occurred',
        details: error.message
      });
    }
  }
});

// Proxy endpoint for organizations (for workspace selector in multi-tenant mode)
// Uses the authenticated main app route so users only see workspaces they can upload into.
app.get('/api/organizations', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding organizations request to main ChatRAG app...');
    console.log('📋 Deployment mode:', getDeploymentMode());

    if (!isMultiTenant()) {
      console.log('ℹ️ Config Proxy: Single-tenant mode, returning empty organizations');
      return res.json({ personal: [], teams: [], all: [] });
    }

    const cookieHeader = req.headers.cookie || '';

    const { client, options } = createMainAppRequest('/api/organizations', 'GET', {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      res.statusCode = proxyRes.statusCode;

      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Organizations request completed');
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Server error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for AI model configuration (GET)
app.get('/api/config/models', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding model config GET request to main ChatRAG app...');

    const { client, options } = createMainAppRequest('/api/config/models', 'GET', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Model config GET completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for AI model configuration (POST)
app.post('/api/config/models', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding model config POST request to main ChatRAG app...');

    // Prepare the request to the main ChatRAG app
    const postData = JSON.stringify(req.body);

    const { client, options } = createMainAppRequest('/api/config/models', 'POST', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    });

    // Create the request to the main app
    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Set response headers
      res.statusCode = proxyRes.statusCode;

      // Forward response headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Model config POST completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    // Handle proxy request errors
    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      if (!res.headersSent) {
        res.status(500).json(mainAppConnectionError(error));
      }
    });

    // Handle client connection errors
    req.on('error', (error) => {
      console.error('❌ Config Proxy: Client connection error:', error);
      proxyReq.destroy();
    });

    // Send the request body to the main app
    proxyReq.write(postData);
    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy error: Unexpected error occurred.',
        details: error.message
      });
    }
  }
});

// Proxy endpoint for environment reload (POST)
app.post('/api/config/reload', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding environment reload request to main ChatRAG app...');

    const { client, options } = createMainAppRequest('/api/config/reload', 'POST', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Environment reload completed');
        try {
          if (data) {
            const jsonData = JSON.parse(data);
            console.log(`🔄 Reloaded ${jsonData.updatedKeys?.length || 0} environment variables`);
            res.json(jsonData);
          } else {
            res.json({ success: true, message: 'Environment reloaded' });
          }
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for OpenRouter model info (GET)
app.get('/api/config/openrouter-model-info', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding OpenRouter model info request to main ChatRAG app...');

    // Build the query string from request parameters
    const queryString = req.url.split('?')[1] || '';
    const path = `/api/config/openrouter-model-info${queryString ? '?' + queryString : ''}`;

    const { client, options } = createMainAppRequest(path, 'GET', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers (especially CORS headers)
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: OpenRouter model info completed');
        try {
          if (data) {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
          } else {
            res.json({ error: 'Empty response from main app' });
          }
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for OpenRouter API test (GET)
app.get('/api/config/test-openrouter', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding OpenRouter test request to main ChatRAG app...');

    const { client, options } = createMainAppRequest('/api/config/test-openrouter', 'GET', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers (especially CORS headers)
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: OpenRouter test completed');
        try {
          if (data) {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
          } else {
            res.json({ error: 'Empty response from main app' });
          }
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for Connectors Configuration (GET)
app.get('/api/config/connectors', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding connectors GET request to main ChatRAG app...');

    const { client, options } = createMainAppRequest('/api/config/connectors', 'GET', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      res.statusCode = proxyRes.statusCode;
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Connectors GET completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for Connectors Configuration (PUT)
app.put('/api/config/connectors', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding connectors PUT request to main ChatRAG app...');

    const postData = JSON.stringify(req.body);

    const { client, options } = createMainAppRequest('/api/config/connectors', 'PUT', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      res.statusCode = proxyRes.statusCode;
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: Connectors PUT completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.write(postData);
    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for MCP servers (GET)
app.get('/api/mcp/servers', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding MCP servers GET request to main ChatRAG app...');

    const { client, options } = createMainAppRequest('/api/mcp/servers', 'GET', {
        'Content-Type': 'application/json'
    });

    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Forward status code
      res.statusCode = proxyRes.statusCode;

      // Forward headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: MCP servers GET completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      res.status(500).json(mainAppConnectionError(error));
    });

    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    res.status(500).json({
      error: 'Proxy error occurred',
      details: error.message
    });
  }
});

// Proxy endpoint for MCP servers (POST)
app.post('/api/mcp/servers', async (req, res) => {
  try {
    console.log('🔄 Config Proxy: Forwarding MCP servers POST request to main ChatRAG app...');

    // Prepare the request to the main ChatRAG app
    const postData = JSON.stringify(req.body);

    const { client, options } = createMainAppRequest('/api/mcp/servers', 'POST', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    });

    // Create the request to the main app
    const proxyReq = client.request(options, (proxyRes) => {
      console.log(`📡 Config Proxy: Main app responded with status ${proxyRes.statusCode}`);

      // Set response headers
      res.statusCode = proxyRes.statusCode;

      // Forward response headers
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });

      // Collect the response data
      let data = '';
      proxyRes.on('data', chunk => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('✅ Config Proxy: MCP servers POST completed');
        try {
          const jsonData = JSON.parse(data);
          res.json(jsonData);
        } catch (error) {
          console.error('❌ Config Proxy: Error parsing response:', error);
          res.status(500).json({ error: 'Invalid response from main app' });
        }
      });
    });

    // Handle proxy request errors
    proxyReq.on('error', (error) => {
      console.error('❌ Config Proxy: Error connecting to main ChatRAG app:', error);
      if (!res.headersSent) {
        res.status(500).json(mainAppConnectionError(error));
      }
    });

    // Handle client connection errors
    req.on('error', (error) => {
      console.error('❌ Config Proxy: Client connection error:', error);
      proxyReq.destroy();
    });

    // Send the request body to the main app
    proxyReq.write(postData);
    proxyReq.end();

  } catch (error) {
    console.error('❌ Config Proxy: Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy error: Unexpected error occurred.',
        details: error.message
      });
    }
  }
});

// API endpoint for generating welcome messages
app.post('/api/generate-welcome-messages', async (req, res) => {
  try {
    const { count = 10, style = 'friendly and engaging', includeUsername = true } = req.body;

    // Read API keys from .env.local
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const config = dotenv.parse(envContent || '');

    const apiKey = config.OPENAI_API_KEY || config.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        error: 'Missing API key. Please configure OPENAI_API_KEY or OPENROUTER_API_KEY'
      });
    }

    const prompt = `Generate ${count} unique welcome messages for a chat application. 
    Style: ${style}
    ${includeUsername ? 'Include {Username} placeholder in about half of the messages.' : 'Do not include username placeholders.'}
    
    Requirements:
    - Each message should be concise (under 15 words)
    - Vary the tone: some casual, some professional, some enthusiastic
    - Make them feel welcoming and inviting
    - Use {Username} exactly as shown (with curly braces) when including the username
    
    Return ONLY a JSON array of strings, no additional text or explanation.`;

    let messages = [];

    if (config.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that generates creative welcome messages for a chat application.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.9,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // Parse the JSON response
      try {
        messages = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          messages = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse AI response');
        }
      }
    } else if (config.OPENROUTER_API_KEY) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3333',
          'X-Title': 'ChatRAG Config'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that generates creative welcome messages for a chat application.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.9,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // Parse the JSON response
      try {
        messages = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          messages = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse AI response');
        }
      }
    }

    // Validate the messages
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid response format from AI');
    }

    // Filter and clean messages
    messages = messages
      .filter(msg => typeof msg === 'string' && msg.trim().length > 0)
      .map(msg => msg.trim())
      .slice(0, count);

    res.json({ messages });
  } catch (error) {
    console.error('Error generating welcome messages:', error);
    res.status(500).json({
      error: 'Failed to generate welcome messages',
      details: error.message
    });
  }
});

// API endpoint for AI-powered translation
app.post('/api/translate', async (req, res) => {
  try {
    const { targetLanguage, texts, provider = 'openai', model } = req.body;

    if (!targetLanguage || !texts || !Array.isArray(texts)) {
      return res.status(400).json({
        error: 'Missing required parameters: targetLanguage and texts array'
      });
    }

    // Read API keys from .env.local
    const envPath = path.join(REPO_ROOT, '.env.local');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const config = dotenv.parse(envContent || '');

    let apiKey;
    let translationModel;

    if (provider === 'openrouter') {
      apiKey = config.OPENROUTER_API_KEY;
      translationModel = model || 'openai/gpt-4o-mini';

      if (!apiKey) {
        return res.status(400).json({
          error: 'OpenRouter API key not configured. Please add OPENROUTER_API_KEY to your configuration.'
        });
      }
    } else {
      // Default to OpenAI
      apiKey = config.OPENAI_API_KEY;
      translationModel = model || 'gpt-4o-mini';

      if (!apiKey) {
        return res.status(400).json({
          error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your configuration.'
        });
      }
    }

    console.log(`🌐 Translation request: ${texts.length} texts to ${targetLanguage} using ${provider}`);

    // Prepare the translation prompt
    const systemPrompt = `You are a professional translator. Translate the following texts to ${targetLanguage}. 
Keep the translations natural and contextually appropriate.
Return ONLY a JSON array with the translated texts in the same order as provided.
Do not include any explanation or additional text.`;

    const userPrompt = `Translate these texts to ${targetLanguage}:\n${JSON.stringify(texts, null, 2)}`;

    try {
      let translatedTexts;

      if (provider === 'openrouter') {
        // Use OpenRouter API
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3333',
            'X-Title': 'ChatRAG Config Translation'
          },
          body: JSON.stringify({
            model: translationModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 2000
          })
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('OpenRouter API error:', error);
          throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        translatedTexts = JSON.parse(content);

      } else {
        // Use OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: translationModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 2000
          })
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('OpenAI API error:', error);
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        translatedTexts = JSON.parse(content);
      }

      // Validate the response
      if (!Array.isArray(translatedTexts) || translatedTexts.length !== texts.length) {
        throw new Error('Invalid translation response format');
      }

      console.log(`✅ Successfully translated ${translatedTexts.length} texts`);

      res.json({
        success: true,
        translations: translatedTexts,
        targetLanguage,
        provider
      });

    } catch (apiError) {
      console.error('Translation API error:', apiError);
      res.status(500).json({
        error: 'Translation failed. Please check your API keys and try again.',
        details: apiError.message
      });
    }

  } catch (error) {
    console.error('Translation endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error during translation',
      details: error.message
    });
  }
});

// Create HTTP server with keepalive settings
const http = require('http');
const server = http.createServer(app);

// Configure server keepalive and timeout settings
server.keepAliveTimeout = 120000; // 2 minutes (default is 5 seconds)
server.headersTimeout = 121000; // Slightly higher than keepAliveTimeout
server.timeout = 0; // Disable automatic socket timeout

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} is already in use. Please close the other instance or use a different port.`);
    process.exit(1);
  }
});

// Handle client connection errors
server.on('clientError', (err, socket) => {
  console.error('❌ Client connection error:', err);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

// Prevent server from closing on errors
process.on('uncaughtException', (error) => {
  console.error('⚠️ Uncaught exception (server will continue):', error);
  // Don't exit, keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled promise rejection:', reason);
  // Don't exit, keep server running
});

// Check for .env.local before starting
const { checkAndCreateEnvFile } = require('./init-env');
checkAndCreateEnvFile();

// Start the server and automatically open the browser
server.listen(PORT, () => {
  console.log(`\n🔧 ChatRAG Config Tool running at http://localhost:${PORT}`);
  console.log(`\n✨ Open this URL in your browser to configure ChatRAG`);
  console.log(`\n🔄 Live Preview proxy ready - will forward chat requests to ${getMainAppBaseUrl()}`);
  console.log(`\n📄 Document processing proxy ready - will forward document requests to ${getMainAppBaseUrl()}`);
  console.log(`\n🌐 Translation API ready - will use OpenAI/OpenRouter for translations`);
  console.log(`\n⚡ Server configured with enhanced keepalive settings to prevent disconnections`);

  // Try to auto-open the browser (works on most systems)
  try {
    const startCmd = process.platform === 'win32' ? 'start' :
      (process.platform === 'darwin' ? 'open' : 'xdg-open');
    const { exec } = require('child_process');
    exec(`${startCmd} http://localhost:${PORT}`);
    console.log(`\n🌐 Browser opening automatically...`);
  } catch (err) {
    console.log(`\n🌐 Please open http://localhost:${PORT} in your browser`);
  }
});
