import OpenAI from 'openai';
import { env, getAppName } from './env';

// Create a function that provides the OpenRouter client only if API key is available
let openRouterInstance: OpenAI | null = null;
let hasLoggedWarning = false; // Track if we've already logged the warning

export function getOpenRouterClient(): OpenAI | null {
  // Return cached instance if it exists
  if (openRouterInstance) return openRouterInstance;
  
  // Check if API key is available
  if (!env.OPENROUTER_API_KEY) {
    // Only log the warning once to avoid console spam
    if (!hasLoggedWarning) {
      console.warn('OPENROUTER_API_KEY is not configured. OpenRouter features are disabled.');
      hasLoggedWarning = true;
    }
    return null;
  }

  // Create and cache new instance
  openRouterInstance = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/areia-ai/chatrag', // Our GitHub repo as referer
      'X-Title': getAppName(), // Our app name
    },
    defaultQuery: {
      timeout: '120000', // 2 minute timeout
    },
    maxRetries: 3,
  });
  
  return openRouterInstance;
}

// For backward compatibility, export the client directly if available
export const openRouter = getOpenRouterClient(); 