/**
 * Local Query Enhancement for improved RAG retrieval
 * Works without external API calls for better performance and lower cost
 */

// Query type detection for optimization
export type QueryType = 'factual' | 'procedural' | 'conceptual' | 'comparison' | 'general';

export interface EnhancedQuery {
  original: string;
  enhanced: string;
  type: QueryType;
  keywords: string[];
  expansions: string[];
  confidence: number;
}

// Common typo corrections
const TYPO_CORRECTIONS: Record<string, string> = {
  'paymente': 'payment',
  'paymentes': 'payments',
  'intergration': 'integration',
  'intergrations': 'integrations',
  'chatrag': 'ChatRAG',
  'stripe': 'Stripe',
  'polar': 'Polar',
  'supabase': 'Supabase',
  'vercel': 'Vercel',
  'nextjs': 'Next.js',
  'react': 'React',
  'typescript': 'TypeScript',
  'javascript': 'JavaScript',
  'databse': 'database',
  'postgre': 'PostgreSQL',
  'postgresql': 'PostgreSQL',
  'rerank': 're-rank',
  'reranking': 're-ranking',
  'vectorsearch': 'vector search',
  'whatsapp': 'WhatsApp',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
};

// Synonym mappings for common terms
const SYNONYM_MAP: Record<string, string[]> = {
  // Actions
  'create': ['make', 'build', 'generate', 'construct', 'develop'],
  'delete': ['remove', 'destroy', 'eliminate', 'erase', 'clear'],
  'update': ['modify', 'change', 'edit', 'alter', 'revise'],
  'find': ['search', 'locate', 'discover', 'identify', 'retrieve'],
  'show': ['display', 'present', 'reveal', 'exhibit', 'demonstrate'],
  'use': ['utilize', 'employ', 'apply', 'implement', 'leverage'],
  'configure': ['setup', 'set up', 'initialize', 'adjust', 'customize'],
  'integrate': ['connect', 'link', 'combine', 'merge', 'incorporate'],
  'optimize': ['improve', 'enhance', 'refine', 'tune', 'boost'],
  'debug': ['troubleshoot', 'fix', 'diagnose', 'resolve', 'investigate'],
  
  // Technical terms
  'database': ['db', 'datastore', 'repository', 'storage'],
  'authentication': ['auth', 'login', 'signin', 'authorization', 'access'],
  'api': ['endpoint', 'service', 'interface', 'REST', 'GraphQL'],
  'vector': ['embedding', 'representation', 'feature', 'semantic'],
  'search': ['query', 'find', 'lookup', 'retrieve', 'match'],
  'document': ['file', 'content', 'text', 'data', 'record'],
  'payment': ['billing', 'subscription', 'checkout', 'transaction'],
  'model': ['AI', 'LLM', 'GPT', 'Claude', 'language model'],
  'chat': ['conversation', 'message', 'dialogue', 'communication'],
  'user': ['customer', 'client', 'member', 'account', 'person'],
  
  // RAG specific
  'rag': ['retrieval augmented generation', 'retrieval', 'augmented'],
  'chunk': ['segment', 'piece', 'fragment', 'section', 'portion'],
  'embedding': ['vector', 'representation', 'encoding', 'feature'],
  'similarity': ['relevance', 'closeness', 'match', 'likeness'],
  'context': ['information', 'background', 'content', 'knowledge'],
};

// Domain-specific expansions for ChatRAG
const DOMAIN_EXPANSIONS: Record<string, string[]> = {
  'chatrag': ['chat', 'rag', 'retrieval', 'augmented', 'generation'],
  'payment': ['stripe', 'polar', 'subscription', 'billing'],
  'authentication': ['github', 'oauth', 'magic link', 'email'],
  'model': ['openai', 'anthropic', 'claude', 'gpt', 'llm'],
  'database': ['supabase', 'postgresql', 'pgvector', 'vector'],
  'deployment': ['vercel', 'hosting', 'environment', 'production'],
  'whatsapp': ['messaging', 'chat', 'bot', 'integration'],
  'mcp': ['model context protocol', 'tools', 'integration'],
};

// Stop words to filter out
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'shall', 'it', 'its', 'they',
  'them', 'their', 'this', 'that', 'these', 'those'
]);

// Noise patterns to remove
const NOISE_PATTERNS = [
  /\b(please|can you|could you|help me|I need|I want|show me|tell me|explain)\b/gi,
  /\b(um|uh|like|you know|I mean|basically|actually|really)\b/gi,
];

/**
 * Main query enhancement function (local implementation)
 */
export async function enhanceQuery(query: string): Promise<EnhancedQuery> {
  // Step 1: Detect query type
  const queryType = detectQueryType(query);
  
  // Step 2: Clean and correct the query
  const cleaned = cleanQuery(query);
  
  // Step 3: Extract keywords
  const keywords = extractKeywords(cleaned);
  
  // Step 4: Generate local expansions
  const expansions = generateLocalExpansions(cleaned, queryType, keywords);
  
  // Step 5: Build enhanced query
  const enhanced = buildEnhancedQuery(cleaned, expansions, queryType);
  
  // Step 6: Calculate confidence
  const confidence = calculateConfidence(query, enhanced, expansions);
  
  return {
    original: query,
    enhanced,
    type: queryType,
    keywords,
    expansions,
    confidence
  };
}

/**
 * Detect the type of query for targeted enhancement
 */
function detectQueryType(query: string): QueryType {
  const lowerQuery = query.toLowerCase();
  
  if (/\b(what is|what are|define|meaning of|definition|explain)\b/.test(lowerQuery)) {
    return 'conceptual';
  }
  if (/\b(how to|how do|steps to|procedure|tutorial|guide|setup|configure)\b/.test(lowerQuery)) {
    return 'procedural';
  }
  if (/\b(compare|difference between|vs|versus|better than|which is)\b/.test(lowerQuery)) {
    return 'comparison';
  }
  if (/\b(when|where|who|how many|how much|price|cost|list|what)\b/.test(lowerQuery)) {
    return 'factual';
  }
  
  return 'general';
}

/**
 * Clean and correct the query
 */
function cleanQuery(query: string): string {
  let cleaned = query;
  
  // Apply typo corrections
  Object.entries(TYPO_CORRECTIONS).forEach(([typo, correct]) => {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    cleaned = cleaned.replace(regex, correct);
  });
  
  // Remove noise patterns
  NOISE_PATTERNS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove trailing punctuation except ?
  cleaned = cleaned.replace(/[.!,;:]+$/, '');
  
  return cleaned;
}

/**
 * Extract important keywords from the query
 */
function extractKeywords(query: string): string[] {
  // Split into words
  const words = query.toLowerCase().split(/\s+/);
  
  // Filter out stop words and keep important terms
  const keywords = words.filter(word => 
    word.length > 2 && 
    !STOP_WORDS.has(word) &&
    /^[a-z0-9\-]+$/i.test(word) // Allow hyphens for terms like "re-ranking"
  );
  
  // Add any domain-specific terms found
  const domainTerms: string[] = [];
  Object.keys(DOMAIN_EXPANSIONS).forEach(term => {
    if (query.toLowerCase().includes(term)) {
      domainTerms.push(term);
    }
  });
  
  // Combine and deduplicate
  return [...new Set([...keywords, ...domainTerms])];
}

/**
 * Generate expansions using local rules and mappings
 */
function generateLocalExpansions(
  query: string,
  queryType: QueryType,
  keywords: string[]
): string[] {
  const expansions: string[] = [];
  
  // Add synonyms for keywords
  keywords.forEach(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    
    // Check synonym map
    if (SYNONYM_MAP[lowerKeyword]) {
      expansions.push(...SYNONYM_MAP[lowerKeyword].slice(0, 2));
    }
    
    // Check domain expansions
    if (DOMAIN_EXPANSIONS[lowerKeyword]) {
      expansions.push(...DOMAIN_EXPANSIONS[lowerKeyword].slice(0, 2));
    }
  });
  
  // Add query-type specific expansions
  switch (queryType) {
    case 'procedural':
      expansions.push('guide', 'steps', 'how-to');
      break;
    case 'conceptual':
      expansions.push('definition', 'overview', 'explanation');
      break;
    case 'comparison':
      expansions.push('versus', 'difference', 'comparison');
      break;
    case 'factual':
      expansions.push('information', 'details', 'data');
      break;
  }
  
  // Add contextual expansions based on query content
  if (query.toLowerCase().includes('error') || query.toLowerCase().includes('issue')) {
    expansions.push('troubleshoot', 'fix', 'resolve', 'problem');
  }
  
  if (query.toLowerCase().includes('api') || query.toLowerCase().includes('integration')) {
    expansions.push('endpoint', 'webhook', 'connection', 'service');
  }
  
  if (query.toLowerCase().includes('deploy') || query.toLowerCase().includes('host')) {
    expansions.push('vercel', 'production', 'environment', 'configuration');
  }
  
  // Deduplicate and limit expansions
  const uniqueExpansions = [...new Set(expansions)];
  return uniqueExpansions.slice(0, 6); // Limit to 6 expansions
}

/**
 * Build the final enhanced query
 */
function buildEnhancedQuery(
  cleaned: string,
  expansions: string[],
  queryType: QueryType
): string {
  // For short queries, add more expansions
  if (cleaned.split(' ').length <= 3) {
    return `${cleaned} ${expansions.join(' ')}`.trim();
  }
  
  // For factual queries, keep focused
  if (queryType === 'factual') {
    return `${cleaned} ${expansions.slice(0, 3).join(' ')}`.trim();
  }
  
  // For longer queries, add fewer expansions to avoid dilution
  if (cleaned.split(' ').length > 10) {
    return `${cleaned} ${expansions.slice(0, 2).join(' ')}`.trim();
  }
  
  // Default: add moderate expansions
  return `${cleaned} ${expansions.slice(0, 4).join(' ')}`.trim();
}

/**
 * Calculate confidence score for the enhancement
 */
function calculateConfidence(
  original: string,
  enhanced: string,
  expansions: string[]
): number {
  let confidence = 0.5; // Base confidence
  
  // Increase confidence if we found typos to correct
  const hasCorrections = Object.keys(TYPO_CORRECTIONS).some(typo => 
    original.toLowerCase().includes(typo)
  );
  if (hasCorrections) confidence += 0.2;
  
  // Increase confidence if we added relevant expansions
  if (expansions.length > 0) confidence += 0.1;
  if (expansions.length > 3) confidence += 0.1;
  
  // Increase confidence for longer queries (more context)
  const wordCount = original.split(' ').length;
  if (wordCount > 5) confidence += 0.1;
  
  // Cap at 1.0
  return Math.min(confidence, 1.0);
}

/**
 * Quick enhancement without deep processing
 */
export function quickEnhanceQuery(query: string): string {
  // Just do typo correction and basic cleaning
  let enhanced = query;
  
  // Apply typo corrections
  Object.entries(TYPO_CORRECTIONS).forEach(([typo, correct]) => {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    enhanced = enhanced.replace(regex, correct);
  });
  
  // Remove excessive noise
  enhanced = enhanced.replace(/\b(um|uh|like|you know|I mean|basically)\b/gi, '');
  enhanced = enhanced.replace(/\s+/g, ' ').trim();
  
  return enhanced;
}

/**
 * Check if query enhancement would be beneficial
 */
export function shouldEnhanceQuery(query: string): boolean {
  // Don't enhance very short queries
  if (query.length < 10) return false;
  
  // Don't enhance if it's just keywords
  if (!query.includes(' ')) return false;
  
  // Check if query would benefit from enhancement
  const hasTypos = Object.keys(TYPO_CORRECTIONS).some(typo => 
    query.toLowerCase().includes(typo)
  );
  
  const hasNoise = NOISE_PATTERNS.some(pattern => 
    pattern.test(query)
  );
  
  const couldExpand = Object.keys(SYNONYM_MAP).some(term => 
    query.toLowerCase().includes(term)
  );
  
  return hasTypos || hasNoise || couldExpand;
}

/**
 * Batch enhance multiple queries
 */
export async function batchEnhanceQueries(queries: string[]): Promise<EnhancedQuery[]> {
  return Promise.all(queries.map(query => enhanceQuery(query)));
}