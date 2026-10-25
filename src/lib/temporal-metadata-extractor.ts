/**
 * Temporal and Financial Metadata Extractor
 * 
 * Extracts temporal entities, financial data, and contextual information
 * from document chunks to improve RAG retrieval accuracy
 */

export interface TemporalEntity {
  type: 'quarter' | 'year' | 'fiscal_year' | 'month' | 'date_range' | 'specific_date';
  value: string;
  normalized: string;
  confidence: number;
  position: number;
}

export interface FinancialEntity {
  type: 'revenue' | 'profit' | 'loss' | 'growth_rate' | 'percentage' | 'currency_amount' | 'metric';
  value: string;
  normalized: number | null;
  unit: string | null;
  confidence: number;
  position: number;
}

export interface DocumentSection {
  type: 'header' | 'table' | 'paragraph' | 'list' | 'financial_statement' | 'executive_summary';
  title: string | null;
  confidence: number;
}

export interface EnhancedMetadata {
  temporal_entities: TemporalEntity[];
  financial_entities: FinancialEntity[];
  section_type: DocumentSection;
  key_terms: string[];
  numerical_density: number;
  temporal_density: number;
  chunk_semantic_type: 'financial_data' | 'temporal_context' | 'narrative' | 'mixed' | 'general';
}

/**
 * Extract temporal entities from text content
 */
export function extractTemporalEntities(content: string): TemporalEntity[] {
  const entities: TemporalEntity[] = [];
  
  // Patterns for different temporal formats
  const patterns = [
    // Quarter patterns (Q1 2023, Q3 2022, third quarter 2023, etc.)
    {
      regex: /\b(Q[1-4]|[Ff]irst [Qq]uarter|[Ss]econd [Qq]uarter|[Tt]hird [Qq]uarter|[Ff]ourth [Qq]uarter)\s+(\d{4})\b/g,
      type: 'quarter' as const,
      normalizer: (match: string) => {
        const normalized = match.replace(/first quarter/i, 'Q1')
                                .replace(/second quarter/i, 'Q2')
                                .replace(/third quarter/i, 'Q3')
                                .replace(/fourth quarter/i, 'Q4');
        return normalized.toUpperCase();
      }
    },
    // Fiscal year patterns
    {
      regex: /\b[Ff]iscal [Yy]ear (\d{4}|\d{2})\b/g,
      type: 'fiscal_year' as const,
      normalizer: (match: string) => {
        const year = match.match(/\d+/)?.[0];
        return year ? `FY${year.length === 2 ? '20' + year : year}` : match;
      }
    },
    // Year patterns (2023, 2022, etc.)
    {
      regex: /\b(19|20)\d{2}\b/g,
      type: 'year' as const,
      normalizer: (match: string) => match
    },
    // Month-year patterns
    {
      regex: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/g,
      type: 'month' as const,
      normalizer: (match: string) => match
    },
    // Date ranges
    {
      regex: /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
      type: 'date_range' as const,
      normalizer: (match: string) => match
    },
    // Specific dates
    {
      regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      type: 'specific_date' as const,
      normalizer: (match: string) => match
    }
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      entities.push({
        type: pattern.type,
        value: match[0],
        normalized: pattern.normalizer(match[0]),
        confidence: calculateTemporalConfidence(match[0], pattern.type),
        position: match.index
      });
    }
  });

  return entities.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract financial entities from text content
 */
export function extractFinancialEntities(content: string): FinancialEntity[] {
  const entities: FinancialEntity[] = [];
  
  const patterns = [
    // Currency amounts ($1.2B, $500M, $1,000, etc.)
    {
      regex: /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*([BMK]?)\b/g,
      type: 'currency_amount' as const,
      extractor: (match: RegExpExecArray) => {
        const [full, amount, suffix] = match;
        const multiplier = suffix === 'B' ? 1000000000 : suffix === 'M' ? 1000000 : suffix === 'K' ? 1000 : 1;
        const normalized = parseFloat(amount.replace(/,/g, '')) * multiplier;
        return { value: full, normalized, unit: 'USD' };
      }
    },
    // Percentages (5.2%, -3.1%, etc.)
    {
      regex: /([+-]?\d{1,3}(?:\.\d{1,2})?)\s*%/g,
      type: 'percentage' as const,
      extractor: (match: RegExpExecArray) => {
        const [full, amount] = match;
        return { value: full, normalized: parseFloat(amount), unit: '%' };
      }
    },
    // Growth rates and metrics
    {
      regex: /\b(revenue|profit|income|loss|growth|increase|decrease|decline)\b.*?([+-]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*([BMK%]?)\b/gi,
      type: 'metric' as const,
      extractor: (match: RegExpExecArray) => {
        const [full, term, amount, suffix] = match;
        const multiplier = suffix === 'B' ? 1000000000 : suffix === 'M' ? 1000000 : suffix === 'K' ? 1000 : suffix === '%' ? 1 : 1;
        const normalized = parseFloat(amount.replace(/,/g, '')) * multiplier;
        return { value: full, normalized, unit: suffix || null };
      }
    }
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const extracted = pattern.extractor(match);
      entities.push({
        type: pattern.type,
        value: extracted.value,
        normalized: extracted.normalized,
        unit: extracted.unit,
        confidence: calculateFinancialConfidence(extracted.value, pattern.type),
        position: match.index
      });
    }
  });

  return entities.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Determine document section type based on content patterns
 */
export function identifyDocumentSection(content: string): DocumentSection {
  const headerPatterns = [
    /^#{1,6}\s+/m,
    /^[A-Z\s]{5,}\s*$/m,
    /^\d+\.\s+[A-Z]/m
  ];
  
  const tablePatterns = [
    /\|.*\|/,
    /\t.*\t.*\t/,
    /^\s*\d+\s+\d+\s+\d+/m
  ];
  
  const financialStatementPatterns = [
    /\b(income statement|balance sheet|cash flow|financial statement|consolidated statement)\b/i,
    /\b(assets|liabilities|equity|revenue|expenses|net income)\b.*\$?\d/i
  ];

  // Check for financial statements first (highest priority)
  if (financialStatementPatterns.some(pattern => pattern.test(content))) {
    return {
      type: 'financial_statement',
      title: extractTitle(content, financialStatementPatterns),
      confidence: 0.9
    };
  }

  // Check for tables
  if (tablePatterns.some(pattern => pattern.test(content))) {
    return {
      type: 'table',
      title: extractTitle(content, tablePatterns),
      confidence: 0.8
    };
  }

  // Check for headers
  if (headerPatterns.some(pattern => pattern.test(content))) {
    return {
      type: 'header',
      title: extractTitle(content, headerPatterns),
      confidence: 0.7
    };
  }

  return {
    type: 'paragraph',
    title: null,
    confidence: 0.5
  };
}

/**
 * Calculate density scores for different content types
 */
export function calculateDensityScores(content: string): { numerical: number; temporal: number } {
  const totalLength = content.length;
  if (totalLength === 0) return { numerical: 0, temporal: 0 };

  // Count numerical entities
  const numericalMatches = content.match(/\d+(?:[,\.]\d+)*[%BMK]?/g) || [];
  const numericalDensity = numericalMatches.length / (totalLength / 100);

  // Count temporal entities
  const temporalMatches = content.match(/\b(Q[1-4]|20\d{2}|fiscal|quarter|year)\b/gi) || [];
  const temporalDensity = temporalMatches.length / (totalLength / 100);

  return { numerical: numericalDensity, temporal: temporalDensity };
}

/**
 * Determine semantic type of chunk based on content analysis
 */
export function determineChunkSemanticType(
  temporalEntities: TemporalEntity[],
  financialEntities: FinancialEntity[],
  section: DocumentSection,
  densityScores: { numerical: number; temporal: number }
): 'financial_data' | 'temporal_context' | 'narrative' | 'mixed' | 'general' {
  const hasFinancialData = financialEntities.length > 0 || densityScores.numerical > 2;
  const hasTemporalData = temporalEntities.length > 0 || densityScores.temporal > 1;

  if (section.type === 'financial_statement' || (hasFinancialData && densityScores.numerical > 5)) {
    return 'financial_data';
  }

  if (hasTemporalData && hasFinancialData) {
    return 'mixed';
  }

  if (hasTemporalData && densityScores.temporal > 2) {
    return 'temporal_context';
  }

  if (hasFinancialData) {
    return 'financial_data';
  }

  return 'general';
}

/**
 * Extract key terms for search optimization
 */
export function extractKeyTerms(content: string): string[] {
  // Skip key term extraction if disabled
  if (process.env.RAG_EXTRACT_KEY_TERMS === 'false') {
    return [];
  }

  // Common financial and business terms that should be preserved
  const importantPatterns = [
    /\b[A-Z]{2,}\b/g, // Acronyms
    /\b[Cc]ompany\s+[A-Z][a-z]+/g, // Company names
    /\b[Pp]roduct\s+[A-Z][a-z]+/g, // Product names
    /\b(revenue|profit|loss|growth|market|segment|division|region)\b/gi // Financial terms
  ];

  const keyTerms = new Set<string>();
  
  importantPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      keyTerms.add(match[0].toLowerCase());
    }
  });

  const maxTerms = parseInt(process.env.RAG_MAX_KEY_TERMS || '10');
  return Array.from(keyTerms).slice(0, maxTerms);
}

/**
 * Main function to extract enhanced metadata from chunk content
 */
export function extractEnhancedMetadata(content: string): EnhancedMetadata {
  const temporalEntities = extractTemporalEntities(content);
  const financialEntities = extractFinancialEntities(content);
  const section = identifyDocumentSection(content);
  const densityScores = calculateDensityScores(content);
  const keyTerms = extractKeyTerms(content);
  const chunkSemanticType = determineChunkSemanticType(temporalEntities, financialEntities, section, densityScores);

  return {
    temporal_entities: temporalEntities,
    financial_entities: financialEntities,
    section_type: section,
    key_terms: keyTerms,
    numerical_density: densityScores.numerical,
    temporal_density: densityScores.temporal,
    chunk_semantic_type: chunkSemanticType
  };
}

// Helper functions
function calculateTemporalConfidence(value: string, type: TemporalEntity['type']): number {
  // Higher confidence for more specific temporal references
  let baseConfidence = {
    quarter: 0.9,
    fiscal_year: 0.8,
    specific_date: 0.85,
    date_range: 0.8,
    month: 0.7,
    year: 0.6
  }[type] || 0.5;

  // Boost confidence for recent years
  const yearMatch = value.match(/20(\d{2})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 20) baseConfidence += 0.1; // 2020+
  }

  return Math.min(baseConfidence, 1.0);
}

function calculateFinancialConfidence(value: string, type: FinancialEntity['type']): number {
  const baseConfidence = {
    currency_amount: 0.9,
    percentage: 0.8,
    metric: 0.7
  }[type] || 0.5;

  // Boost confidence for larger amounts (more significant)
  if (value.includes('B') || value.includes('M')) {
    return Math.min(baseConfidence + 0.1, 1.0);
  }

  return baseConfidence;
}

function extractTitle(content: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      // Extract a meaningful title from the match
      return match[0].replace(/[#\|\t\d\.]/g, '').trim().substring(0, 100);
    }
  }
  return null;
}