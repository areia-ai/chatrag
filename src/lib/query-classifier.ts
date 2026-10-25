/**
 * Quick query classification to optimize chat performance
 * Determines if a query needs MCP tools or can be handled with simple responses
 */

import { matchMcpQuery, getAllToolPatterns } from './mcp/query-patterns';
import { parseMultiStepQuery, QueryStep } from './multi-step-parser';

export interface QueryClassification {
  needsMcp: boolean;
  confidence: number;
  category: 'conversational' | 'tool_required' | 'document_search' | 'complex' | 'multi_step';
  reasoningText: string;
  matchedServer?: string;
  matchedCategory?: string;
  isMultiStep?: boolean;
  steps?: QueryStep[];
  currentStep?: QueryStep;
}

const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|good morning|good afternoon|good evening)/i,
  /^(who are you|what are you|tell me about yourself)/i,
  /^(thank you|thanks|bye|goodbye)/i,
  /^(how are you|how's it going)/i,
  /^(what can you do|what do you do|help)/i,
];

// Get dynamic tool patterns from modular MCP system
const getMcpToolPatterns = (): RegExp[] => {
  try {
    return getAllToolPatterns();
  } catch (error) {
    console.warn('Error loading MCP tool patterns:', error);
    return [];
  }
};

// Non-MCP tool patterns (image generation, etc.)
const NON_MCP_TOOL_PATTERNS = [
  /create.*image|generate.*image|make.*image/i,
  /add.*tool|edit.*tool/i,  // Tool management
];

// Image editing patterns that should route to image generation (not MCP tools)
const IMAGE_EDITING_PATTERNS = [
  /edit.*image|image.*edit/i,
  /transform.*image|image.*transform/i,
  /modify.*image|image.*modify/i,
  /change.*image|image.*change/i,
  /alter.*image|image.*alter/i,
  /edit this|transform this|modify this|change this/i, // When used with attached image
  /turn.*into|make.*into|convert.*to/i, // Common transformation phrases
  /cyborg|robot|cartoon|painting|drawing/i, // Style transformation keywords
];

const DOCUMENT_SEARCH_PATTERNS = [
  /what.*about|tell me about|explain.*about/i,
  /pricing|price|cost|fee|plan|subscription|payment/i,
];

export function classifyQuery(query: string, hasAttachedImage: boolean = false): QueryClassification {
  const cleanQuery = query.trim().toLowerCase();

  // 🔍 DEBUG: Add detailed logging for query classification
  console.log('🔍 [QUERY CLASSIFIER] Input query:', `"${query}"`);
  console.log('🔍 [QUERY CLASSIFIER] Clean query:', `"${cleanQuery}"`);
  console.log('🔍 [QUERY CLASSIFIER] Has attached image:', hasAttachedImage);

  // Check for multi-step queries FIRST
  const multiStepParsed = parseMultiStepQuery(query);
  if (multiStepParsed.isMultiStep && multiStepParsed.confidence > 0.6) {
    console.log('🔍 [QUERY CLASSIFIER] → MULTI-STEP query detected with', multiStepParsed.steps.length, 'steps');
    console.log('🔍 [QUERY CLASSIFIER] Steps:', multiStepParsed.steps.map(s => ({ id: s.id, type: s.type })));

    // For multi-step, check if any step needs MCP
    const needsMcpAnyStep = multiStepParsed.steps.some(step => {
      const stepClassification = classifySingleStep(step.text, hasAttachedImage);
      return stepClassification.needsMcp;
    });

    return {
      needsMcp: needsMcpAnyStep,
      confidence: multiStepParsed.confidence,
      category: 'multi_step',
      reasoningText: `Multi-step query with ${multiStepParsed.steps.length} steps detected`,
      isMultiStep: true,
      steps: multiStepParsed.steps,
      currentStep: multiStepParsed.steps[0]
    };
  }

  // Check if MCP system is disabled
  const mcpSystemEnabled = process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED === 'true';
  if (!mcpSystemEnabled) {
    console.log('🔍 [QUERY CLASSIFIER] MCP System is DISABLED - skipping all tool checks');
    return {
      needsMcp: false,
      confidence: 1.0,
      category: 'conversational',
      reasoningText: 'MCP System is disabled - focusing on RAG functionality only'
    };
  }
  
  // Empty or very short queries
  if (cleanQuery.length < 3) {
    console.log('🔍 [QUERY CLASSIFIER] → TOO SHORT, returning conversational');
    return {
      needsMcp: false,
      confidence: 0.9,
      category: 'conversational',
      reasoningText: 'Query too short to require tools'
    };
  }

  // Check for image editing patterns FIRST when there's an attached image
  if (hasAttachedImage) {
    console.log('🔍 [QUERY CLASSIFIER] Checking IMAGE_EDITING_PATTERNS with attached image...');
    for (const pattern of IMAGE_EDITING_PATTERNS) {
      if (pattern.test(cleanQuery)) {
        console.log('🔍 [QUERY CLASSIFIER] → IMAGE EDITING pattern matched:', pattern);
        // For image editing, we want to route to image generation, NOT MCP tools
        return {
          needsMcp: false,  // Don't use MCP tools
          confidence: 0.95,
          category: 'tool_required', // Still mark as tool_required but needsMcp is false
          reasoningText: 'Image editing request with attached image - route to image generation'
        };
      }
    }
  }

  // Check for conversational patterns
  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      console.log('🔍 [QUERY CLASSIFIER] → CONVERSATIONAL pattern matched:', pattern);
      return {
        needsMcp: false,
        confidence: 0.85,
        category: 'conversational',
        reasoningText: 'Simple conversational query detected'
      };
    }
  }

  // Check for MCP tool patterns using modular system
  console.log('🔍 [QUERY CLASSIFIER] Checking MCP patterns...');
  const mcpMatch = matchMcpQuery(cleanQuery);

  if (mcpMatch.matched) {
    console.log(`🔍 [QUERY CLASSIFIER] → MCP pattern matched:`, {
      server: mcpMatch.serverName,
      category: mcpMatch.category,
      confidence: mcpMatch.confidence
    });
    return {
      needsMcp: true,
      confidence: mcpMatch.confidence,
      category: 'tool_required',
      reasoningText: mcpMatch.reasoningText,
      matchedServer: mcpMatch.serverName,
      matchedCategory: mcpMatch.category
    };
  }

  // Check for non-MCP tool patterns
  console.log('🔍 [QUERY CLASSIFIER] Checking non-MCP tool patterns...');
  for (const pattern of NON_MCP_TOOL_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      console.log('🔍 [QUERY CLASSIFIER] → NON-MCP tool pattern matched:', pattern);
      return {
        needsMcp: false,
        confidence: 0.85,
        category: 'tool_required',
        reasoningText: 'Query requires non-MCP tool (image generation, etc.)'
      };
    }
  }

  console.log('🔍 [QUERY CLASSIFIER] No tool patterns matched');

  // Check for document search patterns
  for (const pattern of DOCUMENT_SEARCH_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      console.log('🔍 [QUERY CLASSIFIER] → DOCUMENT SEARCH pattern matched:', pattern);
      return {
        needsMcp: false,
        confidence: 0.7,
        category: 'document_search',
        reasoningText: 'Query appears to be document/knowledge search'
      };
    }
  }

  // Default to simple response for basic questions
  if (cleanQuery.length < 50 && !cleanQuery.includes('?')) {
    console.log('🔍 [QUERY CLASSIFIER] → SHORT STATEMENT, returning conversational');
    return {
      needsMcp: false,
      confidence: 0.6,
      category: 'conversational',
      reasoningText: 'Short statement likely conversational'
    };
  }

  // Default to requiring MCP for complex queries
  console.log('🔍 [QUERY CLASSIFIER] → DEFAULT COMPLEX, returning needsMcp: true');
  return {
    needsMcp: true,
    confidence: 0.4,
    category: 'complex',
    reasoningText: 'Complex query may need tools'
  };
}

/**
 * Classify a single step (used internally for multi-step processing)
 */
export function classifySingleStep(query: string, hasAttachedImage: boolean = false): QueryClassification {
  const cleanQuery = query.trim().toLowerCase();

  // Check if MCP system is disabled
  const mcpSystemEnabled = process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED === 'true';
  if (!mcpSystemEnabled) {
    return {
      needsMcp: false,
      confidence: 1.0,
      category: 'conversational',
      reasoningText: 'MCP System is disabled'
    };
  }

  // Empty or very short queries
  if (cleanQuery.length < 3) {
    return {
      needsMcp: false,
      confidence: 0.9,
      category: 'conversational',
      reasoningText: 'Query too short'
    };
  }

  // Check for image editing patterns with attached image
  if (hasAttachedImage) {
    for (const pattern of IMAGE_EDITING_PATTERNS) {
      if (pattern.test(cleanQuery)) {
        return {
          needsMcp: false,
          confidence: 0.95,
          category: 'tool_required',
          reasoningText: 'Image editing request'
        };
      }
    }
  }

  // Check for conversational patterns
  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      return {
        needsMcp: false,
        confidence: 0.85,
        category: 'conversational',
        reasoningText: 'Conversational query'
      };
    }
  }

  // Check for MCP tool patterns
  const mcpMatch = matchMcpQuery(cleanQuery);
  if (mcpMatch.matched) {
    return {
      needsMcp: true,
      confidence: mcpMatch.confidence,
      category: 'tool_required',
      reasoningText: mcpMatch.reasoningText,
      matchedServer: mcpMatch.serverName,
      matchedCategory: mcpMatch.category
    };
  }

  // Check for non-MCP tool patterns
  for (const pattern of NON_MCP_TOOL_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      return {
        needsMcp: false,
        confidence: 0.85,
        category: 'tool_required',
        reasoningText: 'Non-MCP tool required'
      };
    }
  }

  // Check for document search patterns
  for (const pattern of DOCUMENT_SEARCH_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      return {
        needsMcp: false,
        confidence: 0.7,
        category: 'document_search',
        reasoningText: 'Document search query'
      };
    }
  }

  // Default
  if (cleanQuery.length < 50 && !cleanQuery.includes('?')) {
    return {
      needsMcp: false,
      confidence: 0.6,
      category: 'conversational',
      reasoningText: 'Short statement'
    };
  }

  // Default: no explicit tool patterns matched → treat as conversational and skip MCP
  return {
    needsMcp: false,
    confidence: 0.9,
    category: 'conversational',
    reasoningText: 'No tool patterns matched; handle conversationally without MCP'
  };
}

export function shouldSkipMcp(query: string, hasAttachedImage: boolean = false): boolean {
  // If MCP system is disabled, always skip
  const mcpSystemEnabled = process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED === 'true';
  if (!mcpSystemEnabled) {
    return true;
  }

  const classification = classifyQuery(query, hasAttachedImage);

  // For multi-step queries, don't skip MCP if any step needs it
  if (classification.isMultiStep) {
    // We should not skip MCP for multi-step queries that have MCP steps
    return !classification.needsMcp;
  }

  return !classification.needsMcp && classification.confidence > 0.6;
}