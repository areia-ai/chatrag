import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: number;
    completion?: number;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  supported_parameters?: string[];
}

export interface DetectedModelCapabilities {
  id: string;
  displayName: string;
  isFree: boolean;
  contextLength: number;
  supportsReasoning: boolean;
  reasoningMethod: 'effort' | 'max_tokens' | 'both' | 'none';
  maxTokensLimit?: number;
  minTokens?: number;
  defaultEffort?: 'high' | 'medium' | 'low';
  description: string;
  confidence: 'high' | 'medium' | 'low';
  detectionReasons: string[];
}

/**
 * Intelligent reasoning detection based on model information
 */
function detectReasoningCapabilities(model: OpenRouterModelInfo): {
  supportsReasoning: boolean;
  reasoningMethod: 'effort' | 'max_tokens' | 'both' | 'none';
  maxTokensLimit?: number;
  minTokens?: number;
  defaultEffort?: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
  detectionReasons: string[];
} {
  const reasons: string[] = [];
  const lowerModelId = model.id.toLowerCase();
  const lowerName = (model.name || '').toLowerCase();
  const description = (model.description || '').toLowerCase();
  
  // High confidence reasoning model patterns
  const highConfidencePatterns = [
    { pattern: /o1|o3|o4|gpt-5/, method: 'effort' as const, reason: 'OpenAI reasoning-capable model' },
    { pattern: /claude-3\.[7-9]|claude-[4-9]|claude-sonnet-4(\.5)?|claude-opus-4\.1/, method: 'max_tokens' as const, reason: 'Claude 3.7+ with reasoning support' },
    { pattern: /deepseek-r1/, method: 'both' as const, reason: 'DeepSeek R1 reasoning model' },
    { pattern: /gemini.*thinking|gemini-2\.[0-9].*thinking/, method: 'max_tokens' as const, reason: 'Gemini thinking model' },
    { pattern: /glm-4\.5/, method: 'max_tokens' as const, reason: 'GLM-4.5 with thinking mode' },
    { pattern: /gpt-oss-120b|gpt-oss-20b/, method: 'max_tokens' as const, reason: 'OpenAI GPT-OSS with reasoning support' }
  ];

  // Medium confidence reasoning indicators
  const mediumConfidenceIndicators = [
    { pattern: /thinking|reasoning|cot|chain.of.thought/, reason: 'Contains thinking/reasoning keywords' },
    { pattern: /r1|reasoning/, reason: 'Model name suggests reasoning capability' },
    { pattern: /instruct.*reasoning|reasoning.*instruct/, reason: 'Instruction-tuned for reasoning' }
  ];

  // Check high confidence patterns
  for (const { pattern, method, reason } of highConfidencePatterns) {
    if (pattern.test(lowerModelId) || pattern.test(lowerName)) {
      reasons.push(reason);
      
      // Set appropriate limits based on method
      let maxTokensLimit: number | undefined;
      let minTokens: number | undefined;
      let defaultEffort: 'high' | 'medium' | 'low' | undefined;

      if (method === 'max_tokens' || method === 'both') {
        // Use context length to determine reasonable reasoning token limits
        const contextLength = model.context_length || model.top_provider?.context_length || 32000;
        maxTokensLimit = Math.min(32000, Math.floor(contextLength * 0.2)); // 20% of context for reasoning
        minTokens = Math.max(500, Math.floor(maxTokensLimit * 0.05)); // 5% minimum
      }

      if (method === 'effort' || method === 'both') {
        // Default effort based on model tier
        if (lowerModelId.includes('mini') || lowerModelId.includes('small')) {
          defaultEffort = 'low';
        } else if (lowerModelId.includes('preview') || lowerModelId.includes('pro')) {
          defaultEffort = 'high';
        } else {
          defaultEffort = 'medium';
        }
      }

      return {
        supportsReasoning: true,
        reasoningMethod: method,
        maxTokensLimit,
        minTokens,
        defaultEffort,
        confidence: 'high',
        detectionReasons: reasons
      };
    }
  }

  // Check medium confidence indicators
  let mediumConfidenceCount = 0;
  for (const { pattern, reason } of mediumConfidenceIndicators) {
    if (pattern.test(lowerModelId) || pattern.test(lowerName) || pattern.test(description)) {
      reasons.push(reason);
      mediumConfidenceCount++;
    }
  }

  // Check supported parameters for reasoning hints
  const supportedParams = model.supported_parameters || [];
  const hasReasoningParams = supportedParams.some(param => 
    /reasoning|thinking|cot/.test(param.toLowerCase())
  );
  
  if (hasReasoningParams) {
    reasons.push('Supports reasoning-related parameters');
    mediumConfidenceCount++;
    
    // If model explicitly supports "reasoning" parameter and has high-reasoning keywords, upgrade to high confidence
    if (supportedParams.includes('reasoning') && 
        (description.includes('reasoning') || description.includes('chain-of-thought'))) {
      const contextLength = model.context_length || model.top_provider?.context_length || 32000;
      const maxTokensLimit = Math.min(32000, Math.floor(contextLength * 0.2));
      
      return {
        supportsReasoning: true,
        reasoningMethod: 'max_tokens',
        maxTokensLimit,
        minTokens: Math.max(500, Math.floor(maxTokensLimit * 0.05)),
        defaultEffort: 'medium',
        confidence: 'high',
        detectionReasons: [...reasons, 'Explicit reasoning parameter support with reasoning-focused description']
      };
    }
  }

  // High context length might indicate reasoning capability
  const contextLength = model.context_length || model.top_provider?.context_length || 0;
  if (contextLength > 100000) {
    reasons.push('High context length suggests advanced capabilities');
    mediumConfidenceCount++;
  }

  // If we have enough medium confidence indicators, assume reasoning support
  if (mediumConfidenceCount >= 2) {
    // Default to max_tokens for unknown reasoning models
    const maxTokensLimit = Math.min(16000, Math.floor(contextLength * 0.15));
    
    return {
      supportsReasoning: true,
      reasoningMethod: 'max_tokens',
      maxTokensLimit: maxTokensLimit || 8000,
      minTokens: 1000,
      defaultEffort: 'medium',
      confidence: 'medium',
      detectionReasons: reasons
    };
  }

  // No reasoning capabilities detected
  return {
    supportsReasoning: false,
    reasoningMethod: 'none',
    confidence: 'low',
    detectionReasons: reasons.length > 0 ? reasons : ['No reasoning indicators found']
  };
}

// Helper function to retry OpenRouter API calls with exponential backoff
async function fetchWithRetry(url: string, options: any, maxRetries = 3): Promise<Response> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 API Attempt ${attempt}/${maxRetries}`);
      
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      // If successful or client error (4xx), return immediately
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      
      // For server errors (5xx), retry with exponential backoff
      if (response.status >= 500 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s delays
        console.log(`⏳ Server error ${response.status}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return response;
      
    } catch (error) {
      lastError = error as Error;
      console.error(`💥 Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('modelId');
    
    // Enhanced request logging
    console.log(`\n🔍 === OpenRouter Model Info API Request ===`);
    console.log(`📊 Timestamp: ${new Date().toISOString()}`);
    console.log(`🆔 Model ID requested: "${modelId}"`);
    console.log(`🌐 Request URL: ${request.url}`);
    console.log(`📱 User Agent: ${request.headers.get('user-agent') || 'N/A'}`);
    console.log(`🔗 Referer: ${request.headers.get('referer') || 'N/A'}`);
    console.log(`🏠 Origin: ${request.headers.get('origin') || 'N/A'}`);
    console.log(`🔑 API Key Status: ${env.OPENROUTER_API_KEY ? 'Present' : 'MISSING'}`);
    if (env.OPENROUTER_API_KEY) {
      console.log(`🔑 API Key Length: ${env.OPENROUTER_API_KEY.length} chars`);
      console.log(`🔑 API Key Prefix: ${env.OPENROUTER_API_KEY.substring(0, 8)}...`);
    }
    
    if (!modelId) {
      console.log(`❌ No model ID provided in request`);
      return NextResponse.json(
        { error: 'Model ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Processing request for model: ${modelId}`);

    // Fetch model information from OpenRouter with retry logic
    console.log(`📡 Calling OpenRouter API with retry logic: https://openrouter.ai/api/v1/models`);
    console.log(`🔑 API Key present: ${env.OPENROUTER_API_KEY ? 'YES' : 'NO'}`);
    
    const openRouterResponse = await fetchWithRetry('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://chatrag.com', // OpenRouter requires referer
        'X-Title': 'ChatRAG Model Configuration'
      },
    });

    console.log(`📊 OpenRouter API Response Status: ${openRouterResponse.status}`);
    
    if (!openRouterResponse.ok) {
      console.error(`❌ OpenRouter API error: ${openRouterResponse.status} ${openRouterResponse.statusText}`);
      const errorText = await openRouterResponse.text();
      console.error(`📝 Error details: ${errorText}`);
      
      return NextResponse.json(
        { 
          error: 'Failed to fetch model information from OpenRouter after retries',
          details: `API returned ${openRouterResponse.status}: ${errorText}`,
          retryable: openRouterResponse.status >= 500
        },
        { status: openRouterResponse.status }
      );
    }

    const modelsData = await openRouterResponse.json();
    const models: OpenRouterModelInfo[] = modelsData.data || [];
    
    console.log(`📋 Total models fetched: ${models.length}`);
    console.log(`🔍 Looking for model: "${modelId}"`);

    // Find the specific model with enhanced matching
    let model = models.find(m => m.id === modelId);
    
    if (!model) {
      // Try case-insensitive match
      model = models.find(m => m.id.toLowerCase() === modelId.toLowerCase());
    }
    
    if (!model) {
      // Try partial matching for fuzzy search
      const partialMatches = models.filter(m => 
        m.id.includes(modelId) || 
        modelId.includes(m.id) ||
        m.id.toLowerCase().includes(modelId.toLowerCase()) ||
        modelId.toLowerCase().includes(m.id.toLowerCase())
      );
      
      console.log(`🔍 Exact match failed. Found ${partialMatches.length} partial matches:`);
      partialMatches.forEach(m => {
        console.log(`   - ${m.id} (${m.name})`);
      });
      
      // If we have exactly one partial match, use it
      if (partialMatches.length === 1) {
        model = partialMatches[0];
        console.log(`✅ Using partial match: ${model.id}`);
      }
    }
    
    if (!model) {
      // Log some similar models for debugging
      const similarModels = models.filter(m => 
        m.id.includes('openai') || 
        m.id.includes('gpt') ||
        m.id.toLowerCase().includes('oss')
      ).slice(0, 5);
      
      console.log(`❌ Model not found: ${modelId}`);
      console.log(`🔍 Similar models available:`);
      similarModels.forEach(m => {
        console.log(`   - ${m.id} (${m.name})`);
      });
      
      return NextResponse.json(
        { 
          error: `Model '${modelId}' not found in OpenRouter catalog`,
          suggestions: similarModels.map(m => ({ id: m.id, name: m.name })),
          totalModels: models.length
        },
        { status: 404 }
      );
    }

    console.log(`✅ Found model: ${model.name}`);

    // Detect reasoning capabilities
    const reasoningCapabilities = detectReasoningCapabilities(model);
    
    console.log(`🧠 Reasoning detection for ${modelId}:`, reasoningCapabilities);

    // Build the detected capabilities response
    const capabilities: DetectedModelCapabilities = {
      id: model.id,
      displayName: model.name || modelId,
      isFree: model.pricing?.prompt === 0 && model.pricing?.completion === 0,
      contextLength: model.context_length || model.top_provider?.context_length || 4096,
      description: model.description || '',
      ...reasoningCapabilities
    };

    const response = NextResponse.json({
      success: true,
      model: capabilities,
      rawModel: model, // Include raw model data for debugging
      message: `Model information retrieved successfully with ${reasoningCapabilities.confidence} confidence reasoning detection`
    });

    // Add CORS headers
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

    return response;

  } catch (error) {
    console.error('Error fetching OpenRouter model info:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const response = NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch model information',
        details: errorMessage
      },
      { status: 500 }
    );
    
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  }
}

// Handle OPTIONS request for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}