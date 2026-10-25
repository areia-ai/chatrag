/**
 * Multi-Stage Adaptive Retrieval Strategy
 * 
 * Intelligently adjusts retrieval approach based on:
 * - Query complexity and type
 * - Initial result quality
 * - Document distribution
 * - User intent patterns
 */

import { supabase } from './supabase';
import { getQueryEmbedding } from './document-processor';
import { applyMMR, type ScoredChunk } from './mmr-scorer';
import { applyBM25Scoring } from './bm25-scorer';
import { enhanceQuery, shouldEnhanceQuery } from './query-enhancer-local';
import { rerankChunks, type ChunkWithScore } from './reranker-local';

export interface AdaptiveRetrievalConfig {
  maxStages?: number; // Maximum retrieval stages (default: 3)
  minConfidence?: number; // Minimum confidence to stop early (default: 0.8)
  adaptiveThreshold?: boolean; // Dynamically adjust similarity threshold
  expansionFactor?: number; // How much to expand search in each stage
  diversityWeight?: number; // Weight for diversity vs relevance
  enableFeedback?: boolean; // Use relevance feedback
}

export interface RetrievalStage {
  stage: number;
  strategy: 'semantic' | 'keyword' | 'hybrid' | 'expansion';
  chunks: ChunkWithScore[];
  confidence: number;
  metrics: {
    averageSimilarity: number;
    topSimilarity: number;
    coverage: number;
    diversity: number;
    coherence: number;
  };
}

export interface AdaptiveRetrievalResult {
  finalChunks: ChunkWithScore[];
  stages: RetrievalStage[];
  totalConfidence: number;
  strategy: string;
  reasoningText: string;
}

/**
 * Analyze query characteristics to determine retrieval strategy
 */
function analyzeQueryCharacteristics(query: string): {
  complexity: 'simple' | 'moderate' | 'complex';
  type: 'factual' | 'analytical' | 'comparative' | 'exploratory';
  specificity: 'specific' | 'general' | 'broad';
  intent: 'lookup' | 'understand' | 'compare' | 'explore';
} {
  const wordCount = query.split(/\s+/).length;
  const hasQuestionWord = /^(what|when|where|who|why|how|which)/i.test(query);
  const hasComparison = /\b(compare|versus|vs|difference|between|better|worse)\b/i.test(query);
  const hasAnalysis = /\b(analyze|explain|describe|understand|reasoning|impact|effect)\b/i.test(query);
  const hasSpecificTerms = /\b(specific|exact|particular|only|just)\b/i.test(query);
  const hasBroadTerms = /\b(all|every|comprehensive|overview|general|summary)\b/i.test(query);
  
  // Determine complexity
  let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
  if (wordCount > 15 || hasComparison || hasAnalysis) {
    complexity = 'complex';
  } else if (wordCount > 8) {
    complexity = 'moderate';
  }
  
  // Determine type
  let type: 'factual' | 'analytical' | 'comparative' | 'exploratory' = 'factual';
  if (hasComparison) {
    type = 'comparative';
  } else if (hasAnalysis) {
    type = 'analytical';
  } else if (hasBroadTerms || !hasQuestionWord) {
    type = 'exploratory';
  }
  
  // Determine specificity
  let specificity: 'specific' | 'general' | 'broad' = 'general';
  if (hasSpecificTerms || wordCount < 5) {
    specificity = 'specific';
  } else if (hasBroadTerms) {
    specificity = 'broad';
  }
  
  // Determine intent
  let intent: 'lookup' | 'understand' | 'compare' | 'explore' = 'lookup';
  if (hasComparison) {
    intent = 'compare';
  } else if (hasAnalysis || complexity === 'complex') {
    intent = 'understand';
  } else if (type === 'exploratory') {
    intent = 'explore';
  }
  
  return { complexity, type, specificity, intent };
}

/**
 * Calculate retrieval confidence based on result quality
 */
function calculateConfidence(chunks: ChunkWithScore[], query: string): number {
  if (!chunks || chunks.length === 0) return 0;
  
  // Factor 1: Top similarity score
  const topSimilarity = Math.max(...chunks.map(c => c.similarity));
  
  // Factor 2: Average similarity of top chunks
  const topK = Math.min(5, chunks.length);
  const avgTopSimilarity = chunks.slice(0, topK)
    .reduce((sum, c) => sum + c.similarity, 0) / topK;
  
  // Factor 3: Similarity drop-off rate
  const dropOffRate = chunks.length > 1 
    ? (chunks[0].similarity - chunks[Math.min(4, chunks.length - 1)].similarity) / chunks[0].similarity
    : 0;
  
  // Factor 4: Query term coverage (simple approximation)
  const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length > 3));
  let coveredTerms = 0;
  for (const term of queryTerms) {
    if (chunks.slice(0, topK).some(c => c.content.toLowerCase().includes(term))) {
      coveredTerms++;
    }
  }
  const coverage = queryTerms.size > 0 ? coveredTerms / queryTerms.size : 1;
  
  // Calculate weighted confidence
  const confidence = (
    topSimilarity * 0.3 +
    avgTopSimilarity * 0.3 +
    (1 - dropOffRate) * 0.2 +
    coverage * 0.2
  );
  
  return Math.min(Math.max(confidence, 0), 1);
}

/**
 * Calculate diversity score for chunks
 */
function calculateDiversity(chunks: ChunkWithScore[]): number {
  if (chunks.length <= 1) return 1;
  
  // Get unique document IDs
  const uniqueDocs = new Set(chunks.map(c => c.document_id));
  const docDiversity = uniqueDocs.size / chunks.length;
  
  // Calculate content diversity (simplified - based on unique terms)
  const allTerms = new Set<string>();
  const termFrequency = new Map<string, number>();
  
  for (const chunk of chunks) {
    const terms = chunk.content.toLowerCase().split(/\s+/)
      .filter(t => t.length > 4); // Only consider meaningful terms
    
    for (const term of terms) {
      allTerms.add(term);
      termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    }
  }
  
  // Calculate term diversity (inverse of average frequency)
  const avgFrequency = Array.from(termFrequency.values())
    .reduce((sum, f) => sum + f, 0) / termFrequency.size;
  const termDiversity = 1 / (avgFrequency / chunks.length);
  
  return (docDiversity * 0.5 + Math.min(termDiversity, 1) * 0.5);
}

/**
 * Calculate coherence score (how well chunks relate to each other)
 */
function calculateCoherence(chunks: ChunkWithScore[]): number {
  if (chunks.length <= 1) return 1;
  
  let totalOverlap = 0;
  let comparisons = 0;
  
  // Check term overlap between consecutive chunks
  for (let i = 0; i < chunks.length - 1; i++) {
    const terms1 = new Set(
      chunks[i].content.toLowerCase().split(/\s+/)
        .filter(t => t.length > 4)
    );
    const terms2 = new Set(
      chunks[i + 1].content.toLowerCase().split(/\s+/)
        .filter(t => t.length > 4)
    );
    
    const intersection = new Set([...terms1].filter(t => terms2.has(t)));
    const union = new Set([...terms1, ...terms2]);
    
    if (union.size > 0) {
      totalOverlap += intersection.size / union.size;
      comparisons++;
    }
  }
  
  return comparisons > 0 ? totalOverlap / comparisons : 0;
}

/**
 * Perform semantic retrieval stage
 */
async function semanticRetrievalStage(
  query: string,
  embedding: number[],
  limit: number,
  threshold: number
): Promise<ChunkWithScore[]> {
  console.log(`[Adaptive Retrieval] Semantic search: limit=${limit}, threshold=${threshold}`);
  
  const { data, error } = await supabase
    .rpc('match_document_chunks', {
      query_embedding: embedding,
      match_count: limit,
      similarity_threshold: threshold
    });
  
  if (error) {
    console.error('[Adaptive Retrieval] Semantic search error:', error);
    return [];
  }
  
  if (!data) {
    console.log('[Adaptive Retrieval] No data returned from RPC call');
    return [];
  }
  
  if (!Array.isArray(data)) {
    console.log('[Adaptive Retrieval] Data is not an array:', typeof data, data);
    return [];
  }
  
  console.log(`[Adaptive Retrieval] Raw RPC result: ${data.length} items`);
  if (data.length > 0) {
    console.log('[Adaptive Retrieval] First item structure:', Object.keys(data[0]));
    console.log('[Adaptive Retrieval] First item similarities:', data.slice(0, 3).map(d => d.similarity));
  }
  
  const results = data.map((chunk: any) => ({
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    content: chunk.content,
    similarity: chunk.similarity,
    metadata: chunk.metadata || {}
  }));
  
  console.log(`[Adaptive Retrieval] Processed ${results.length} chunks for semantic stage`);
  return results;
}

/**
 * Perform keyword retrieval stage
 */
async function keywordRetrievalStage(
  query: string,
  limit: number
): Promise<ChunkWithScore[]> {
  // Extract keywords from query
  const keywords = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['what', 'when', 'where', 'who', 'why', 'how', 'which', 'this', 'that', 'with'].includes(w));
  
  console.log(`[Adaptive Retrieval] Keyword search: extracted ${keywords.length} keywords:`, keywords);
  
  if (keywords.length === 0) {
    console.log('[Adaptive Retrieval] No valid keywords found, skipping keyword search');
    return [];
  }
  
  // Try to use keyword search RPC if available
  try {
    console.log(`[Adaptive Retrieval] Calling search_chunks_by_keywords with query: "${keywords.join(' ')}", limit: ${limit}`);
    
    const { data, error } = await supabase
      .rpc('search_chunks_by_keywords', {
        search_query: keywords.join(' '),
        match_limit: limit
      });
    
    if (error) {
      console.error('[Adaptive Retrieval] Keyword search error:', error);
      return [];
    }
    
    if (!data) {
      console.log('[Adaptive Retrieval] Keyword search returned no data');
      return [];
    }
    
    if (!Array.isArray(data)) {
      console.log('[Adaptive Retrieval] Keyword search data is not an array:', typeof data);
      return [];
    }
    
    console.log(`[Adaptive Retrieval] Keyword search found ${data.length} results`);
    
    const results = data.map((chunk: any) => ({
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      content: chunk.content,
      similarity: chunk.similarity || chunk.rank || 0.5, // Use similarity, fallback to rank, then default
      metadata: chunk.metadata || {}
    }));
    
    console.log(`[Adaptive Retrieval] Processed ${results.length} chunks for keyword stage`);
    return results;
    
  } catch (e) {
    console.error('[Adaptive Retrieval] Keyword search exception:', e);
    return [];
  }
}

/**
 * Perform hybrid retrieval stage
 */
async function hybridRetrievalStage(
  query: string,
  embedding: number[],
  limit: number,
  threshold: number
): Promise<ChunkWithScore[]> {
  // Get both semantic and keyword results
  const [semanticResults, keywordResults] = await Promise.all([
    semanticRetrievalStage(query, embedding, limit, threshold),
    keywordRetrievalStage(query, limit)
  ]);
  
  // Apply BM25 scoring to semantic results
  const hybridResults = applyBM25Scoring(semanticResults, query, 0.3);
  
  // Merge with keyword results
  const resultMap = new Map<string, ChunkWithScore>();
  
  // Add hybrid scored results
  for (const result of hybridResults) {
    resultMap.set(result.chunk_id, {
      ...result,
      similarity: result.hybridScore || result.similarity
    });
  }
  
  // Add unique keyword results
  for (const result of keywordResults) {
    if (!resultMap.has(result.chunk_id)) {
      resultMap.set(result.chunk_id, result);
    }
  }
  
  // Sort by final score and return top results
  return Array.from(resultMap.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Perform query expansion stage
 */
async function expansionRetrievalStage(
  originalQuery: string,
  previousChunks: ChunkWithScore[],
  limit: number,
  threshold: number
): Promise<ChunkWithScore[]> {
  // Extract key terms from top previous results
  const topChunks = previousChunks.slice(0, 3);
  const extractedTerms = new Set<string>();
  
  for (const chunk of topChunks) {
    const terms = chunk.content.toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 5 && !originalQuery.toLowerCase().includes(t));
    
    // Add top frequent terms
    const termFreq = new Map<string, number>();
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }
    
    // Get top 3 most frequent new terms
    const sortedTerms = Array.from(termFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    for (const [term] of sortedTerms) {
      extractedTerms.add(term);
    }
  }
  
  // Create expanded query
  const expandedQuery = `${originalQuery} ${Array.from(extractedTerms).join(' ')}`;
  console.log(`[Adaptive Retrieval] Expanded query: "${expandedQuery}"`);
  
  // Get embedding for expanded query
  const { getQueryEmbedding } = await import('./document-processor');
  const expandedEmbedding = await getQueryEmbedding(expandedQuery);
  
  // Perform retrieval with expanded query
  return semanticRetrievalStage(expandedQuery, expandedEmbedding, limit, threshold);
}

/**
 * Main adaptive retrieval function
 */
export async function adaptiveRetrieval(
  query: string,
  config: AdaptiveRetrievalConfig = {}
): Promise<AdaptiveRetrievalResult> {
  const {
    maxStages = 3,
    minConfidence = parseFloat(process.env.ENHANCED_RAG_MIN_CONFIDENCE || '0.85'),
    adaptiveThreshold = true,
    expansionFactor = 1.5,
    diversityWeight = parseFloat(process.env.ENHANCED_RAG_DIVERSITY_WEIGHT || '0.15'),
    enableFeedback = true
  } = config;
  
  console.log(`[Adaptive Retrieval] Starting multi-stage retrieval for: "${query}"`);
  
  // Analyze query characteristics
  const characteristics = analyzeQueryCharacteristics(query);
  console.log(`[Adaptive Retrieval] Query analysis:`, characteristics);
  
  // Initialize retrieval parameters based on query
  const baseThreshold = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.45');
  let currentThreshold = baseThreshold;
  let currentLimit = 20;
  const stages: RetrievalStage[] = [];
  const allChunks = new Map<string, ChunkWithScore>();
  
  // Adjust initial parameters based on query characteristics
  if (characteristics.specificity === 'specific') {
    currentThreshold = baseThreshold + 0.05; // Slightly higher for specific queries
    currentLimit = 15;
  } else if (characteristics.specificity === 'broad') {
    currentThreshold = baseThreshold; // Use base for broad queries
    currentLimit = 30;
  } else {
    currentThreshold = baseThreshold; // Use base as default
    currentLimit = 20;
  }
  
  // Get query embedding
  const queryEmbedding = await getQueryEmbedding(query);
  
  // Stage 1: Initial retrieval based on query type
  let stage1Strategy: 'semantic' | 'keyword' | 'hybrid' = 'semantic';
  if (characteristics.type === 'factual' && characteristics.specificity === 'specific') {
    stage1Strategy = 'hybrid';
  } else if (characteristics.complexity === 'simple') {
    stage1Strategy = 'semantic';
  }
  
  console.log(`[Adaptive Retrieval] Stage 1: ${stage1Strategy} retrieval`);
  
  let stage1Chunks: ChunkWithScore[] = [];
  try {
    if (stage1Strategy === 'hybrid') {
      stage1Chunks = await hybridRetrievalStage(query, queryEmbedding, currentLimit, currentThreshold);
    } else {
      stage1Chunks = await semanticRetrievalStage(query, queryEmbedding, currentLimit, currentThreshold);
    }
  } catch (error) {
    console.error(`[Adaptive Retrieval] Stage 1 error:`, error);
    stage1Chunks = [];
  }
  
  // Add to combined results
  for (const chunk of stage1Chunks) {
    if (chunk && chunk.chunk_id && chunk.similarity !== undefined) {
      allChunks.set(chunk.chunk_id, chunk);
    } else {
      console.warn('[Adaptive Retrieval] Invalid chunk in stage 1 results:', chunk);
    }
  }
  
  console.log(`[Adaptive Retrieval] Stage 1 raw results: ${stage1Chunks.length} chunks`);
  console.log(`[Adaptive Retrieval] Stage 1 unique chunks added: ${allChunks.size} chunks`);
  
  // Calculate stage 1 metrics
  const stage1Confidence = calculateConfidence(stage1Chunks, query);
  const stage1Metrics = {
    averageSimilarity: stage1Chunks.length > 0 
      ? stage1Chunks.reduce((sum, c) => sum + c.similarity, 0) / stage1Chunks.length 
      : 0,
    topSimilarity: stage1Chunks.length > 0 
      ? Math.max(...stage1Chunks.map(c => c.similarity)) 
      : 0,
    coverage: stage1Confidence,
    diversity: calculateDiversity(stage1Chunks),
    coherence: calculateCoherence(stage1Chunks)
  };
  
  stages.push({
    stage: 1,
    strategy: stage1Strategy,
    chunks: stage1Chunks,
    confidence: stage1Confidence,
    metrics: stage1Metrics
  });
  
  console.log(`[Adaptive Retrieval] Stage 1 complete: ${stage1Chunks.length} chunks, confidence: ${stage1Confidence.toFixed(2)}`);
  console.log(`[Adaptive Retrieval] Stage 1 metrics:`, {
    avgSimilarity: stage1Metrics.averageSimilarity.toFixed(3),
    topSimilarity: stage1Metrics.topSimilarity.toFixed(3),
    diversity: stage1Metrics.diversity.toFixed(3),
    coherence: stage1Metrics.coherence.toFixed(3)
  });
  
  // Check if we need additional stages (Stricter confidence requirements)
  const effectiveMinConfidence = minConfidence;
  if ((stage1Confidence >= effectiveMinConfidence && stage1Chunks.length > 0) || stages.length >= maxStages) {
    console.log(`[Adaptive Retrieval] Stopping after stage 1: confidence=${stage1Confidence.toFixed(2)} >= ${effectiveMinConfidence} or max stages reached`);
    
    // Apply MMR for diversity
    const allChunksArray = Array.from(allChunks.values());
    console.log(`[Adaptive Retrieval] Applying MMR to ${allChunksArray.length} chunks`);
    
    const finalChunks = allChunksArray.length > 0 
      ? applyMMR(allChunksArray, Math.min(10, allChunksArray.length), { lambda: 1 - diversityWeight })
      : [];
    
    console.log(`[Adaptive Retrieval] Final chunks after MMR: ${finalChunks.length}`);
    
    return {
      finalChunks,
      stages,
      totalConfidence: stage1Confidence,
      strategy: stage1Strategy,
      reasoningText: `High confidence (${stage1Confidence.toFixed(2)}) achieved in first stage with ${stage1Strategy} retrieval.`
    };
  }
  
  console.log(`[Adaptive Retrieval] Stage 1 insufficient, proceeding to stage 2: confidence=${stage1Confidence.toFixed(2)} < ${minConfidence}`);
  
  // Early exit if no chunks found in stage 1 and we have low confidence
  if (stage1Chunks.length === 0) {
    console.log('[Adaptive Retrieval] No chunks found in stage 1, trying fallback with lower threshold');
    
    // Try with slightly lower threshold as fallback
    try {
      const fallbackChunks = await semanticRetrievalStage(query, queryEmbedding, currentLimit * 2, baseThreshold - 0.05);
      if (fallbackChunks.length > 0) {
        console.log(`[Adaptive Retrieval] Fallback found ${fallbackChunks.length} chunks with lower threshold`);
        
        const finalChunks = applyMMR(fallbackChunks, Math.min(10, fallbackChunks.length), { lambda: 1 - diversityWeight });
        
        return {
          finalChunks,
          stages: [{
            stage: 1,
            strategy: 'fallback-semantic',
            chunks: fallbackChunks,
            confidence: calculateConfidence(fallbackChunks, query),
            metrics: {
              averageSimilarity: fallbackChunks.reduce((sum, c) => sum + c.similarity, 0) / fallbackChunks.length,
              topSimilarity: Math.max(...fallbackChunks.map(c => c.similarity)),
              coverage: calculateConfidence(fallbackChunks, query),
              diversity: calculateDiversity(fallbackChunks),
              coherence: calculateCoherence(fallbackChunks)
            }
          }],
          totalConfidence: calculateConfidence(fallbackChunks, query),
          strategy: 'fallback',
          reasoningText: `Stage 1 returned no results with threshold ${currentThreshold}, fallback successful with threshold ${baseThreshold - 0.05}`
        };
      }
    } catch (fallbackError) {
      console.error('[Adaptive Retrieval] Fallback also failed:', fallbackError);
    }
  }
  
  // Stage 2: Adaptive expansion based on stage 1 results
  if (stages.length < maxStages) {
    let stage2Strategy: 'semantic' | 'keyword' | 'hybrid' | 'expansion' = 'expansion';
    
    // Decide stage 2 strategy based on stage 1 performance
    if (stage1Metrics.diversity < 0.3) {
      // Low diversity - try to get more varied results
      stage2Strategy = 'expansion';
      currentThreshold = baseThreshold;
      currentLimit = Math.floor(currentLimit * expansionFactor);
    } else if (stage1Metrics.coherence < 0.2) {
      // Low coherence - try keyword search
      stage2Strategy = 'keyword';
    } else if (stage1Metrics.averageSimilarity < (baseThreshold + 0.2)) {
      // Low similarity - try query expansion
      stage2Strategy = 'expansion';
    }
    
    console.log(`[Adaptive Retrieval] Stage 2: ${stage2Strategy} retrieval`);
    
    let stage2Chunks: ChunkWithScore[] = [];
    if (stage2Strategy === 'expansion') {
      stage2Chunks = await expansionRetrievalStage(query, stage1Chunks, currentLimit, currentThreshold);
    } else if (stage2Strategy === 'keyword') {
      stage2Chunks = await keywordRetrievalStage(query, currentLimit);
    } else {
      stage2Chunks = await hybridRetrievalStage(query, queryEmbedding, currentLimit, currentThreshold);
    }
    
    // Add new chunks to combined results
    for (const chunk of stage2Chunks) {
      if (!allChunks.has(chunk.chunk_id)) {
        allChunks.set(chunk.chunk_id, chunk);
      }
    }
    
    // Calculate stage 2 metrics
    const combinedChunks = Array.from(allChunks.values());
    const stage2Confidence = calculateConfidence(combinedChunks, query);
    const stage2Metrics = {
      averageSimilarity: combinedChunks.reduce((sum, c) => sum + c.similarity, 0) / combinedChunks.length,
      topSimilarity: Math.max(...combinedChunks.map(c => c.similarity)),
      coverage: stage2Confidence,
      diversity: calculateDiversity(combinedChunks),
      coherence: calculateCoherence(combinedChunks)
    };
    
    stages.push({
      stage: 2,
      strategy: stage2Strategy,
      chunks: stage2Chunks,
      confidence: stage2Confidence,
      metrics: stage2Metrics
    });
    
    console.log(`[Adaptive Retrieval] Stage 2 complete: ${stage2Chunks.length} new chunks, total confidence: ${stage2Confidence.toFixed(2)}`);
    
    // Check if we need stage 3 (Higher confidence requirement)
    if (stage2Confidence < effectiveMinConfidence && stages.length < maxStages) {
      // Stage 3: Final refinement
      console.log(`[Adaptive Retrieval] Stage 3: Final refinement with re-ranking`);
      
      // Re-rank all chunks using advanced scoring
      const rerankedChunks = await rerankChunks(
        query,
        combinedChunks,
        {
          strategy: 'hybrid',
          topK: Math.min(20, combinedChunks.length)
        }
      );
      
      // Apply MMR for final diversity
      const finalChunks = applyMMR(
        rerankedChunks,
        Math.min(10, rerankedChunks.length),
        { lambda: 1 - diversityWeight }
      );
      
      const finalConfidence = calculateConfidence(finalChunks, query);
      const finalMetrics = {
        averageSimilarity: finalChunks.reduce((sum, c) => sum + c.similarity, 0) / finalChunks.length,
        topSimilarity: Math.max(...finalChunks.map(c => c.similarity)),
        coverage: finalConfidence,
        diversity: calculateDiversity(finalChunks),
        coherence: calculateCoherence(finalChunks)
      };
      
      stages.push({
        stage: 3,
        strategy: 'hybrid',
        chunks: finalChunks,
        confidence: finalConfidence,
        metrics: finalMetrics
      });
      
      return {
        finalChunks,
        stages,
        totalConfidence: finalConfidence,
        strategy: 'multi-stage-adaptive',
        reasoningText: `Completed 3-stage adaptive retrieval. Final confidence: ${finalConfidence.toFixed(2)}. Strategies used: ${stages.map(s => s.strategy).join(' → ')}.`
      };
    }
  }
  
  // Apply final MMR for diversity
  const finalChunks = applyMMR(
    Array.from(allChunks.values()),
    Math.min(10, allChunks.size),
    { lambda: 1 - diversityWeight }
  );
  
  const finalConfidence = stages[stages.length - 1].confidence;
  
  return {
    finalChunks,
    stages,
    totalConfidence: finalConfidence,
    strategy: stages.length === 1 ? stage1Strategy : 'multi-stage-adaptive',
    reasoningText: `Completed ${stages.length}-stage adaptive retrieval. Final confidence: ${finalConfidence.toFixed(2)}. Strategies used: ${stages.map(s => s.strategy).join(' → ')}.`
  };
}

/**
 * Intelligent fallback for when adaptive retrieval fails
 */
export async function intelligentFallback(
  query: string,
  error: any
): Promise<ChunkWithScore[]> {
  console.log(`[Adaptive Retrieval] Fallback mode due to error:`, error);
  
  try {
    // Simple semantic search as fallback
    const embedding = await getQueryEmbedding(query);
    const fallbackThreshold = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.45') - 0.1;
    const { data } = await supabase
      .rpc('match_document_chunks', {
        query_embedding: embedding,
        match_count: 10,
        similarity_threshold: fallbackThreshold
      });
    
    if (data && data.length > 0) {
      return data.map((chunk: any) => ({
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        content: chunk.content,
        similarity: chunk.similarity,
        metadata: chunk.metadata || {}
      }));
    }
  } catch (fallbackError) {
    console.error('[Adaptive Retrieval] Fallback also failed:', fallbackError);
  }
  
  return [];
}