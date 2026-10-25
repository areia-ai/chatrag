/**
 * Temporal Query Detection and Classification
 * 
 * Analyzes queries to determine if they require temporal-aware retrieval
 * and sets appropriate similarity thresholds and search strategies
 */

export interface TemporalQueryContext {
  isTemporalQuery: boolean;
  isFinancialQuery: boolean;
  isSpecificDataQuery: boolean;
  timeframe: string | null;
  financialMetrics: string[];
  requiredPrecision: 'low' | 'medium' | 'high' | 'exact';
  suggestedThreshold: number;
  searchStrategy: 'semantic_only' | 'temporal_boost' | 'exact_match' | 'multi_stage';
  requireTemporalMatch: boolean;
  reasoningText: string;
}

/**
 * Analyze query to determine temporal and financial context
 */
export function analyzeQuery(query: string): TemporalQueryContext {
  const normalizedQuery = query.toLowerCase();

  // Detect temporal patterns
  const temporalPatterns = {
    quarters: /\b(q[1-4]|first quarter|second quarter|third quarter|fourth quarter|quarter)\s*(\d{4})?\b/g,
    years: /\b(20\d{2}|fiscal year|fy)\b/g,
    periods: /\b(annual|yearly|monthly|quarterly)\b/g,
    ranges: /\b(between|from|to|during|in|for the period)\s+(\d{4}|\w+\s+\d{4})\b/g
  };

  // Detect financial patterns
  const financialPatterns = {
    metrics: /\b(revenue|profit|income|loss|earnings|sales|growth|margin|ebitda|roi|eps)\b/g,
    amounts: /\$\d+(?:[.,]\d+)*[bmk]?|\d+(?:[.,]\d+)*\s*(?:billion|million|thousand|percent|%)\b/g,
    statements: /\b(income statement|balance sheet|cash flow|financial statement|quarterly report|annual report)\b/g,
    performance: /\b(performance|results|comparison|analysis|trend|change|increase|decrease|decline)\b/g
  };

  // Detect specific data requests
  const specificDataPatterns = [
    /\bhow much\b/,
    /\bwhat was the\b/,
    /\bspecific(?:ally)?\b/,
    /\bexact(?:ly)?\b/,
    /\bnumber\b/,
    /\bamount\b/,
    /\bfigure\b/,
    /\bvalue\b/
  ];

  // Count matches
  const temporalMatches = Object.values(temporalPatterns).reduce((count, pattern) => {
    const matches = (normalizedQuery.match(pattern) || []);
    return count + matches.length;
  }, 0);

  const financialMatches = Object.values(financialPatterns).reduce((count, pattern) => {
    const matches = (normalizedQuery.match(pattern) || []);
    return count + matches.length;
  }, 0);

  const specificDataMatches = specificDataPatterns.reduce((count, pattern) => {
    return count + (pattern.test(normalizedQuery) ? 1 : 0);
  }, 0);

  // Extract timeframe
  const timeframe = extractTimeframe(normalizedQuery);

  // Extract financial metrics
  const financialMetrics = extractFinancialMetrics(normalizedQuery);

  // Determine context
  const isTemporalQuery = temporalMatches > 0;
  const isFinancialQuery = financialMatches > 0;
  const isSpecificDataQuery = specificDataMatches > 0 || financialMatches > 1;

  // Determine required precision
  let requiredPrecision: 'low' | 'medium' | 'high' | 'exact' = 'low';
  if (specificDataMatches > 0 && (isTemporalQuery || isFinancialQuery)) {
    requiredPrecision = 'exact';
  } else if (isTemporalQuery && isFinancialQuery) {
    requiredPrecision = 'high';
  } else if (isTemporalQuery || isFinancialQuery) {
    requiredPrecision = 'medium';
  }

  // Set similarity threshold based on precision (configurable via environment variables)
  const thresholdMap = {
    exact: parseFloat(process.env.RAG_EXACT_THRESHOLD || '0.75'),
    high: parseFloat(process.env.RAG_HIGH_THRESHOLD || '0.65'),
    medium: parseFloat(process.env.RAG_MEDIUM_THRESHOLD || '0.55'),
    low: parseFloat(process.env.RAG_LOW_THRESHOLD || '0.35')
  };
  const suggestedThreshold = thresholdMap[requiredPrecision];

  // Determine search strategy
  let searchStrategy: 'semantic_only' | 'temporal_boost' | 'exact_match' | 'multi_stage' = 'semantic_only';
  if (requiredPrecision === 'exact') {
    searchStrategy = 'exact_match';
  } else if (isTemporalQuery && isFinancialQuery) {
    searchStrategy = 'multi_stage';
  } else if (isTemporalQuery) {
    searchStrategy = 'temporal_boost';
  }

  // Determine if temporal match is required
  const requireTemporalMatch = requiredPrecision === 'exact' && isTemporalQuery;

  // Generate reasoning
  const reasoningText = generateReasoning(
    isTemporalQuery,
    isFinancialQuery,
    isSpecificDataQuery,
    requiredPrecision,
    temporalMatches,
    financialMatches
  );

  return {
    isTemporalQuery,
    isFinancialQuery,
    isSpecificDataQuery,
    timeframe,
    financialMetrics,
    requiredPrecision,
    suggestedThreshold,
    searchStrategy,
    requireTemporalMatch,
    reasoningText
  };
}

/**
 * Extract specific timeframe from query
 */
function extractTimeframe(query: string): string | null {
  const timeframePatterns = [
    { pattern: /\b(q[1-4])\s+(\d{4})\b/g, format: (match: RegExpExecArray) => `${match[1].toUpperCase()} ${match[2]}` },
    {
      pattern: /\b(first|second|third|fourth)\s+quarter\s+(\d{4})\b/g, format: (match: RegExpExecArray) => {
        const quarterMap = { first: 'Q1', second: 'Q2', third: 'Q3', fourth: 'Q4' };
        return `${quarterMap[match[1] as keyof typeof quarterMap]} ${match[2]}`;
      }
    },
    { pattern: /\b(fiscal year|fy)\s*(\d{4}|\d{2})\b/g, format: (match: RegExpExecArray) => `FY${match[2]}` },
    { pattern: /\b(\d{4})\b/g, format: (match: RegExpExecArray) => match[1] },
  ];

  for (const { pattern, format } of timeframePatterns) {
    const match = pattern.exec(query);
    if (match) {
      return format(match);
    }
  }

  return null;
}

/**
 * Extract financial metrics mentioned in query
 */
function extractFinancialMetrics(query: string): string[] {
  const metricPatterns = [
    'revenue', 'profit', 'income', 'loss', 'earnings', 'sales', 'growth',
    'margin', 'ebitda', 'roi', 'eps', 'assets', 'liabilities', 'equity',
    'cash flow', 'expenses', 'operating income', 'net income'
  ];

  const foundMetrics = metricPatterns.filter(metric =>
    new RegExp(`\\b${metric.replace(/\s+/g, '\\s+')}\\b`, 'i').test(query)
  );

  return foundMetrics;
}

/**
 * Generate human-readable reasoning for the classification
 */
function generateReasoning(
  isTemporal: boolean,
  isFinancial: boolean,
  isSpecificData: boolean,
  precision: string,
  temporalMatches: number,
  financialMatches: number
): string {
  const reasons = [];

  if (isTemporal) {
    reasons.push(`Contains ${temporalMatches} temporal reference(s)`);
  }

  if (isFinancial) {
    reasons.push(`Contains ${financialMatches} financial term(s)`);
  }

  if (isSpecificData) {
    reasons.push('Requests specific data points');
  }

  if (precision === 'exact') {
    reasons.push('Requires exact match for temporal/financial data');
  } else if (precision === 'high') {
    reasons.push('Requires high precision for temporal-financial queries');
  }

  return reasons.join('; ') || 'General conversational query';
}

/**
 * Create search filters based on query analysis
 */
export function createSearchFilters(context: TemporalQueryContext): {
  temporalFilters: string[];
  financialFilters: string[];
  boostTerms: string[];
} {
  const temporalFilters = [];
  const financialFilters = [];
  const boostTerms = [];

  if (context.timeframe) {
    temporalFilters.push(context.timeframe);
    boostTerms.push(context.timeframe);
  }

  if (context.financialMetrics.length > 0) {
    financialFilters.push(...context.financialMetrics);
    boostTerms.push(...context.financialMetrics);
  }

  return {
    temporalFilters,
    financialFilters,
    boostTerms
  };
}

/**
 * Validate if a chunk matches temporal requirements
 */
export function validateTemporalMatch(chunkMetadata: any, context: TemporalQueryContext): {
  isValid: boolean;
  score: number;
  reason: string;
} {
  if (!context.isTemporalQuery || !context.timeframe) {
    return { isValid: true, score: 1.0, reason: 'No temporal validation required' };
  }

  const temporalEntities = chunkMetadata.temporal_entities || [];

  // Look for exact timeframe match
  const exactMatch = temporalEntities.find((entity: any) =>
    entity.normalized === context.timeframe
  );

  if (exactMatch) {
    return { isValid: true, score: 1.0, reason: `Exact match for ${context.timeframe}` };
  }

  // Look for year match if quarter not found
  if (context.timeframe.includes('Q') && context.timeframe.includes('20')) {
    const year = context.timeframe.match(/20\d{2}/)?.[0];
    const yearMatch = temporalEntities.find((entity: any) =>
      entity.normalized.includes(year!)
    );

    if (yearMatch) {
      return { isValid: true, score: 0.7, reason: `Year match for ${year}` };
    }
  }

  // For specific temporal queries, penalize chunks without temporal context
  if (context.requiredPrecision === 'exact') {
    return { isValid: false, score: 0.0, reason: `No temporal match for required ${context.timeframe}` };
  }

  return { isValid: true, score: 0.3, reason: 'No temporal match but allowing for context' };
}
