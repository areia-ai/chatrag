/**
 * Local Re-ranking system for improved retrieval precision
 * Uses BM25 and hybrid approaches without external API calls
 */

export interface ChunkWithScore {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  rerankScore?: number;
  metadata?: Record<string, any>;
}

export interface RerankOptions {
  strategy?: 'bm25' | 'hybrid' | 'keyword-boost';
  topK?: number;
  includeScores?: boolean;
}

// Cache for document statistics (IDF values)
const documentStatsCache = new Map<string, number>();

/**
 * Calculate BM25 score for a document
 * Proper implementation with IDF and document length normalization
 */
function calculateBM25Score(
  query: string,
  document: string,
  avgDocLength: number,
  totalDocs: number,
  docFrequencies: Map<string, number>
): number {
  // BM25 parameters (tunable)
  const k1 = 1.2; // Term frequency saturation parameter
  const b = 0.75; // Document length normalization parameter
  
  // Tokenize query and document
  const queryTerms = tokenize(query);
  const docTerms = tokenize(document);
  const docLength = docTerms.length;
  
  // Calculate term frequencies in document
  const termFreq = new Map<string, number>();
  docTerms.forEach(term => {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  });
  
  let score = 0;
  
  // Calculate score for each query term
  queryTerms.forEach(term => {
    const tf = termFreq.get(term) || 0;
    if (tf === 0) return;
    
    // Calculate IDF (Inverse Document Frequency)
    const df = docFrequencies.get(term) || 1;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5));
    
    // Calculate normalized term frequency
    const normalizedTF = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
    
    score += idf * normalizedTF;
  });
  
  return score;
}

/**
 * Tokenize text for BM25 processing
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(token => token.length > 2); // Filter short tokens
}

/**
 * Calculate document statistics for BM25
 */
function calculateDocumentStats(chunks: ChunkWithScore[]): {
  avgDocLength: number;
  docFrequencies: Map<string, number>;
} {
  let totalLength = 0;
  const docFrequencies = new Map<string, number>();
  const processedTerms = new Set<string>();
  
  chunks.forEach(chunk => {
    const terms = tokenize(chunk.content);
    totalLength += terms.length;
    
    // Track unique terms per document for IDF
    processedTerms.clear();
    terms.forEach(term => {
      if (!processedTerms.has(term)) {
        docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
        processedTerms.add(term);
      }
    });
  });
  
  return {
    avgDocLength: totalLength / chunks.length,
    docFrequencies
  };
}

/**
 * BM25-based re-ranking
 */
export function bm25Rerank(
  query: string,
  chunks: ChunkWithScore[],
  options: RerankOptions = {}
): ChunkWithScore[] {
  const { topK = 5, includeScores = true } = options;
  
  if (chunks.length === 0) return [];
  if (chunks.length <= topK) return chunks;
  
  // Calculate document statistics
  const { avgDocLength, docFrequencies } = calculateDocumentStats(chunks);
  const totalDocs = chunks.length;
  
  // Calculate BM25 scores for each chunk
  const rankedChunks = chunks.map(chunk => {
    const bm25Score = calculateBM25Score(
      query,
      chunk.content,
      avgDocLength,
      totalDocs,
      docFrequencies
    );
    
    return {
      ...chunk,
      rerankScore: bm25Score
    };
  });
  
  // Sort by BM25 score
  rankedChunks.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
  
  // Get top K results
  const topChunks = rankedChunks.slice(0, topK);
  
  // Optionally remove scores
  if (!includeScores) {
    topChunks.forEach(chunk => delete chunk.rerankScore);
  }
  
  return topChunks;
}

/**
 * Keyword boost re-ranking
 * Boosts chunks that contain exact query phrases
 */
export function keywordBoostRerank(
  query: string,
  chunks: ChunkWithScore[],
  options: RerankOptions = {}
): ChunkWithScore[] {
  const { topK = 5, includeScores = true } = options;
  
  if (chunks.length <= topK) return chunks;
  
  // Extract important phrases from query
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  
  // Generate n-grams (phrases) from query
  const phrases: string[] = [];
  for (let n = Math.min(3, queryWords.length); n >= 1; n--) {
    for (let i = 0; i <= queryWords.length - n; i++) {
      phrases.push(queryWords.slice(i, i + n).join(' '));
    }
  }
  
  // Score each chunk based on phrase matches
  const rankedChunks = chunks.map(chunk => {
    const contentLower = chunk.content.toLowerCase();
    let keywordScore = 0;
    let matchCount = 0;
    
    phrases.forEach((phrase, idx) => {
      // Longer phrases get higher weight
      const weight = phrase.split(' ').length;
      
      // Count occurrences
      const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = (contentLower.match(regex) || []).length;
      
      if (matches > 0) {
        matchCount += matches;
        keywordScore += matches * weight * weight; // Quadratic weight for longer phrases
      }
    });
    
    // Normalize score
    const normalizedScore = Math.min(keywordScore / (phrases.length * 2), 1);
    
    // Combine with original similarity score
    const combinedScore = chunk.similarity * 0.6 + normalizedScore * 0.4;
    
    return {
      ...chunk,
      rerankScore: combinedScore,
      metadata: {
        ...chunk.metadata,
        keywordMatches: matchCount
      }
    };
  });
  
  // Sort by combined score
  rankedChunks.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
  
  const topChunks = rankedChunks.slice(0, topK);
  
  if (!includeScores) {
    topChunks.forEach(chunk => delete chunk.rerankScore);
  }
  
  return topChunks;
}

/**
 * Semantic re-ranking focused on semantic similarity optimization
 */
export function semanticRerank(
  query: string,
  chunks: ChunkWithScore[],
  options: RerankOptions = {}
): ChunkWithScore[] {
  const { topK = 5, includeScores = true } = options;
  
  if (chunks.length <= topK) return chunks;
  
  // Calculate enhanced semantic scores based on multiple factors
  const semanticResults = chunks.map(chunk => {
    const baseScore = chunk.similarity;
    
    // Query term coverage boost
    const queryTerms = new Set(tokenize(query));
    const chunkTerms = new Set(tokenize(chunk.content));
    const termOverlap = [...queryTerms].filter(term => chunkTerms.has(term)).length;
    const coverageBoost = termOverlap / queryTerms.size;
    
    // Content quality factors
    const contentLength = chunk.content.length;
    const lengthScore = Math.min(contentLength / 1000, 1); // Normalize to 0-1, prefer longer content up to 1000 chars
    
    // Semantic coherence (simple approximation)
    const sentences = chunk.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const coherenceScore = Math.min(sentences.length / 5, 1); // Prefer 3-5 sentences
    
    // Combined semantic score with optimized weights for accuracy
    const enhancedScore = 
      baseScore * 0.7 +              // 70% original similarity
      coverageBoost * 0.2 +          // 20% term coverage
      lengthScore * 0.05 +           // 5% content length
      coherenceScore * 0.05;         // 5% coherence
    
    return {
      ...chunk,
      rerankScore: enhancedScore,
      metadata: {
        ...chunk.metadata,
        scoreBreakdown: {
          semantic: baseScore,
          coverage: coverageBoost,
          length: lengthScore,
          coherence: coherenceScore
        }
      }
    };
  });
  
  // Sort by enhanced semantic score
  semanticResults.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
  
  const topChunks = semanticResults.slice(0, topK);
  
  if (!includeScores) {
    topChunks.forEach(chunk => {
      delete chunk.rerankScore;
      delete chunk.metadata?.scoreBreakdown;
    });
  }
  
  return topChunks;
}

/**
 * Hybrid re-ranking combining BM25 and semantic similarity (Enhanced for Accuracy)
 */
export function hybridRerank(
  query: string,
  chunks: ChunkWithScore[],
  options: RerankOptions = {}
): ChunkWithScore[] {
  const { topK = 5, includeScores = true } = options;
  
  if (chunks.length <= topK) return chunks;
  
  // Get BM25 scores
  const bm25Results = bm25Rerank(query, chunks, { topK: chunks.length, includeScores: true });
  
  // Get keyword boost scores
  const keywordResults = keywordBoostRerank(query, chunks, { topK: chunks.length, includeScores: true });
  
  // Create score maps for easy lookup
  const bm25Scores = new Map(bm25Results.map(c => [c.chunk_id, c.rerankScore || 0]));
  const keywordScores = new Map(keywordResults.map(c => [c.chunk_id, c.rerankScore || 0]));
  
  // Normalize scores to 0-1 range
  const maxBM25 = Math.max(...Array.from(bm25Scores.values()));
  const maxKeyword = Math.max(...Array.from(keywordScores.values()));
  
  // Combine scores with optimized weights for higher accuracy
  const hybridResults = chunks.map(chunk => {
    const bm25Score = (bm25Scores.get(chunk.chunk_id) || 0) / (maxBM25 || 1);
    const keywordScore = (keywordScores.get(chunk.chunk_id) || 0) / (maxKeyword || 1);
    const semanticScore = chunk.similarity;
    
    // Enhanced weighted combination (optimized for accuracy)
    const semanticWeight = parseFloat(process.env.ENHANCED_RAG_SEMANTIC_WEIGHT || '0.8');
    const keywordWeight = parseFloat(process.env.ENHANCED_RAG_KEYWORD_WEIGHT || '0.2');
    
    const hybridScore = 
      semanticScore * semanticWeight +    // 80% semantic similarity (increased for accuracy)
      bm25Score * (keywordWeight * 0.6) + // 12% BM25 term relevance  
      keywordScore * (keywordWeight * 0.4); // 8% exact phrase matching
    
    return {
      ...chunk,
      rerankScore: hybridScore,
      metadata: {
        ...chunk.metadata,
        scoreBreakdown: {
          semantic: semanticScore,
          bm25: bm25Score,
          keyword: keywordScore,
          weights: { semantic: semanticWeight, keyword: keywordWeight }
        }
      }
    };
  });
  
  // Sort by hybrid score
  hybridResults.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
  
  const topChunks = hybridResults.slice(0, topK);
  
  if (!includeScores) {
    topChunks.forEach(chunk => {
      delete chunk.rerankScore;
      delete chunk.metadata?.scoreBreakdown;
    });
  }
  
  return topChunks;
}

/**
 * Main re-ranking function with strategy selection
 */
export async function rerankChunks(
  query: string,
  chunks: ChunkWithScore[],
  options: RerankOptions = {}
): Promise<ChunkWithScore[]> {
  const { strategy = 'semantic', ...restOptions } = options; // Changed default to semantic
  
  // Return early if no chunks or already at desired size
  if (chunks.length === 0) return [];
  if (chunks.length <= (options.topK || 5)) return chunks;
  
  // Apply enhanced top-K from configuration  
  const enhancedTopK = parseInt(process.env.ENHANCED_RAG_RERANK_TOP_K || restOptions.topK?.toString() || '20');
  const finalOptions = { ...restOptions, topK: enhancedTopK };
  
  switch (strategy) {
    case 'bm25':
      return bm25Rerank(query, chunks, finalOptions);
    
    case 'keyword-boost':
      return keywordBoostRerank(query, chunks, finalOptions);
      
    case 'semantic':
      return semanticRerank(query, chunks, finalOptions);
    
    case 'hybrid':
    default:
      return hybridRerank(query, chunks, finalOptions);
  }
}

/**
 * Evaluate re-ranking performance
 */
export function evaluateReranking(
  originalChunks: ChunkWithScore[],
  rerankedChunks: ChunkWithScore[]
): {
  topKChanges: number;
  averagePositionChange: number;
  newInTopK: string[];
  scoreImprovement: number;
} {
  const topK = Math.min(5, rerankedChunks.length);
  const originalTopK = originalChunks.slice(0, topK);
  const rerankedTopK = rerankedChunks.slice(0, topK);
  
  // Track position changes
  let topKChanges = 0;
  let totalPositionChange = 0;
  const newInTopK: string[] = [];
  
  rerankedTopK.forEach((chunk, newPos) => {
    const oldPos = originalChunks.findIndex(c => c.chunk_id === chunk.chunk_id);
    
    if (oldPos !== newPos) {
      topKChanges++;
    }
    
    if (oldPos >= topK) {
      newInTopK.push(chunk.chunk_id);
    }
    
    totalPositionChange += Math.abs(oldPos - newPos);
  });
  
  // Calculate score improvement
  const originalAvgScore = originalTopK.reduce((sum, c) => sum + c.similarity, 0) / topK;
  const rerankedAvgScore = rerankedTopK.reduce((sum, c) => sum + (c.rerankScore || c.similarity), 0) / topK;
  const scoreImprovement = ((rerankedAvgScore - originalAvgScore) / originalAvgScore) * 100;
  
  return {
    topKChanges,
    averagePositionChange: totalPositionChange / topK,
    newInTopK,
    scoreImprovement
  };
}

/**
 * Check if re-ranking would be beneficial for the query
 */
export function shouldRerank(query: string, chunks: ChunkWithScore[]): boolean {
  // Don't rerank if too few chunks
  if (chunks.length <= 5) return false;
  
  // Don't rerank if query is too short
  if (query.split(' ').length < 3) return false;
  
  // Check if there's significant score variance (indicating potential for improvement)
  const scores = chunks.slice(0, 10).map(c => c.similarity);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
  
  // If scores are very similar, re-ranking could help differentiate
  return variance < 0.01 || variance > 0.1;
}