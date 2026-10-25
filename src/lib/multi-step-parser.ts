/**
 * Multi-Step Query Parser
 * Parses complex queries into sequential steps for proper execution
 */

import { classifyQuery, classifySingleStep, QueryClassification } from './query-classifier';

export interface QueryStep {
  id: string;
  text: string;
  type: 'rag' | 'mcp' | 'image_generation' | 'general';
  classification?: QueryClassification;
  requiresPreviousResult: boolean;
  originalIndex: number;
}

export interface MultiStepQuery {
  isMultiStep: boolean;
  steps: QueryStep[];
  originalQuery: string;
  confidence: number;
  transitionPhrases: string[];
}

// Patterns that indicate multi-step queries
const MULTI_STEP_PATTERNS = [
  /\band\s+then\b/i,
  /\bafterwards?\b/i,
  /\bnext\b.*\b(use|create|send|make|draft|write|check|find)\b/i,
  /\bafter\s+that\b/i,
  /\bonce\s+(you|that|this)/i,
  /\bfollowed\s+by\b/i,
  /\bthen\s+(use|create|send|make|draft|write|check|find)\b/i,
  /\bfinally\b/i,
  /\blastly\b/i,
  /\bsecondly\b/i,
  /\bfirst.*then\b/i,
];

// Delimiters that separate steps
const STEP_DELIMITERS = [
  /\.\s*(?:Then|Afterwards?|Next|After that|Finally|Lastly|Secondly)\b/gi,
  /\band\s+then\b/gi,
  /\.\s*(?:Once|When)\s+(?:you've?|that's?|this is)\s+(?:done|complete|finished)/gi,
  /(?:^|\.\s*)(?:First|Second|Third|1\.|2\.|3\.)\s*/gi,
];

// Keywords that indicate dependency on previous results
const DEPENDENCY_KEYWORDS = [
  /\bthis\b/i,
  /\bthat\b/i,
  /\bthe results?\b/i,
  /\bwhat (?:you|we) (?:found|discovered|learned)\b/i,
  /\babout what\b/i,
  /\bthe (?:above|previous)\b/i,
  /\bit\b(?:\s+(?:to|in|on))?\b/i,
];

// MCP-specific keywords for better detection
const MCP_KEYWORDS = [
  /\bgmail\b/i,
  /\bemail\b/i,
  /\bcalendar\b/i,
  /\bgoogle\s+drive\b/i,
  /\bzapier\b/i,
  /\bdraft\b/i,
  /\breply\b/i,
  /\bupload\b/i,
];

// RAG-specific keywords
const RAG_KEYWORDS = [
  /\bfind\s+(?:information|data|details)\b/i,
  /\bsearch\s+for\b/i,
  /\blook\s+(?:for|up)\b/i,
  /\btell\s+me\s+about\b/i,
  /\bwhat\s+(?:is|are|does|did)\b/i,
  /\bhow\s+(?:has|have|did|does)\b/i,
  /\bretrieve\b/i,
  /\bget\s+(?:information|data)\b/i,
];

/**
 * Determine the type of a query step
 */
function determineStepType(text: string): 'rag' | 'mcp' | 'image_generation' | 'general' {
  const lowerText = text.toLowerCase();

  // Check for MCP keywords first (more specific)
  for (const pattern of MCP_KEYWORDS) {
    if (pattern.test(lowerText)) {
      return 'mcp';
    }
  }

  // Check for image generation
  if (/(?:create|generate|make|draw|design|produce)\s+(?:an?\s+)?(?:image|picture|illustration|photo|artwork)/i.test(lowerText)) {
    return 'image_generation';
  }

  // Check for RAG keywords
  for (const pattern of RAG_KEYWORDS) {
    if (pattern.test(lowerText)) {
      return 'rag';
    }
  }

  // Use the query classifier for more nuanced detection
  const classification = classifySingleStep(text);
  if (classification.needsMcp) {
    return 'mcp';
  }
  if (classification.category === 'document_search') {
    return 'rag';
  }

  return 'general';
}

/**
 * Check if a step depends on previous results
 */
function checkDependency(text: string, previousSteps: string[]): boolean {
  const lowerText = text.toLowerCase();

  // Check for explicit dependency keywords
  for (const pattern of DEPENDENCY_KEYWORDS) {
    if (pattern.test(lowerText)) {
      // Verify it's not a false positive by checking context
      // "this document" or "that file" might not be dependencies
      if (!/\b(?:this|that)\s+(?:document|file|image|picture)\b/i.test(lowerText)) {
        return true;
      }
    }
  }

  // Check for references to content from previous steps
  if (previousSteps.length > 0) {
    const prevContent = previousSteps.join(' ').toLowerCase();
    // Check if current step references specific terms from previous steps
    const prevKeyTerms = prevContent.match(/\b(?:apple|google|microsoft|sales|revenue|profit|data|information|results?)\b/gi);
    if (prevKeyTerms) {
      for (const term of prevKeyTerms) {
        if (lowerText.includes(term.toLowerCase()) &&
            /\b(?:about|regarding|concerning|with)\b/i.test(lowerText)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Split query into potential steps
 */
function splitIntoSteps(query: string): string[] {
  let steps: string[] = [];
  const remaining = query;

  // Try to split by various delimiters
  for (const delimiter of STEP_DELIMITERS) {
    const parts = remaining.split(delimiter);
    if (parts.length > 1) {
      // Found a delimiter that splits the query
      steps = parts.map(p => p.trim()).filter(p => p.length > 0);
      break;
    }
  }

  // If no delimiters found, try splitting by sentence + transition words
  if (steps.length === 0) {
    // Split by sentences first
    const sentences = query.split(/\.\s+/);
    let currentStep = '';

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const nextSentence = sentences[i + 1];

      // Check if next sentence starts with a transition
      if (nextSentence && /^(?:then|afterwards?|next|after that|finally)/i.test(nextSentence)) {
        // Current sentence is end of a step
        steps.push((currentStep + ' ' + sentence).trim());
        currentStep = '';
      } else {
        currentStep += (currentStep ? '. ' : '') + sentence;
      }
    }

    // Add remaining content as last step
    if (currentStep) {
      steps.push(currentStep.trim());
    }
  }

  // If still no steps or only one step, check for inline transitions
  if (steps.length <= 1) {
    const inlineMatch = query.match(/(.+?)\s+(?:and then|then|afterwards?|after that)\s+(.+)/i);
    if (inlineMatch) {
      steps = [inlineMatch[1].trim(), inlineMatch[2].trim()];
    }
  }

  // Final fallback - treat as single step
  if (steps.length === 0) {
    steps = [query];
  }

  return steps;
}

/**
 * Extract transition phrases from the query
 */
function extractTransitionPhrases(query: string): string[] {
  const transitions: string[] = [];
  const patterns = [
    /\band\s+then\b/gi,
    /\bafterwards?\b/gi,
    /\bafter\s+that\b/gi,
    /\bnext\b/gi,
    /\bfinally\b/gi,
    /\bthen\b/gi,
  ];

  for (const pattern of patterns) {
    const matches = query.match(pattern);
    if (matches) {
      transitions.push(...matches.map(m => m.toLowerCase()));
    }
  }

  return [...new Set(transitions)]; // Remove duplicates
}

/**
 * Parse a query into multiple steps
 */
export function parseMultiStepQuery(query: string): MultiStepQuery {
  // Quick check if it's potentially multi-step
  const hasMultiStepPattern = MULTI_STEP_PATTERNS.some(pattern => pattern.test(query));

  if (!hasMultiStepPattern) {
    // Not a multi-step query
    return {
      isMultiStep: false,
      steps: [{
        id: 'single-step',
        text: query,
        type: determineStepType(query),
        requiresPreviousResult: false,
        originalIndex: 0
      }],
      originalQuery: query,
      confidence: 1.0,
      transitionPhrases: []
    };
  }

  // Extract transition phrases
  const transitionPhrases = extractTransitionPhrases(query);

  // Split into steps
  const stepTexts = splitIntoSteps(query);

  // If we only got one step despite having transition patterns, it might be a complex single request
  if (stepTexts.length === 1) {
    return {
      isMultiStep: false,
      steps: [{
        id: 'single-step',
        text: query,
        type: determineStepType(query),
        requiresPreviousResult: false,
        originalIndex: 0
      }],
      originalQuery: query,
      confidence: 0.5, // Lower confidence since we detected patterns but couldn't split
      transitionPhrases
    };
  }

  // Build step objects
  const steps: QueryStep[] = [];
  const previousSteps: string[] = [];

  for (let i = 0; i < stepTexts.length; i++) {
    const text = stepTexts[i];
    const type = determineStepType(text);
    const requiresPreviousResult = i > 0 && checkDependency(text, previousSteps);

    steps.push({
      id: `step-${i + 1}`,
      text,
      type,
      classification: classifySingleStep(text),
      requiresPreviousResult,
      originalIndex: i
    });

    previousSteps.push(text);
  }

  // Calculate confidence based on various factors
  let confidence = 0.5;
  if (transitionPhrases.length > 0) confidence += 0.2;
  if (steps.length >= 2) confidence += 0.2;
  if (steps.some(s => s.type === 'mcp') && steps.some(s => s.type === 'rag')) confidence += 0.1;
  confidence = Math.min(confidence, 1.0);

  return {
    isMultiStep: true,
    steps,
    originalQuery: query,
    confidence,
    transitionPhrases
  };
}

/**
 * Check if a query requires multi-step execution
 */
export function isMultiStepQuery(query: string): boolean {
  const parsed = parseMultiStepQuery(query);
  return parsed.isMultiStep && parsed.confidence > 0.6;
}

/**
 * Get the next step to execute
 */
export function getNextStep(
  multiStepQuery: MultiStepQuery,
  completedSteps: string[]
): QueryStep | null {
  for (const step of multiStepQuery.steps) {
    if (!completedSteps.includes(step.id)) {
      return step;
    }
  }
  return null;
}

/**
 * Format step results for context in next step
 */
export function formatStepContext(
  stepId: string,
  result: any,
  type: 'rag' | 'mcp' | 'image_generation' | 'general'
): string {
  switch (type) {
    case 'rag':
      return `Based on the search results: ${result}`;
    case 'mcp':
      return `Tool execution result: ${result}`;
    case 'image_generation':
      return `Generated image: ${result}`;
    default:
      return `Previous result: ${result}`;
  }
}