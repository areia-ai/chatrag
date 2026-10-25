import { supabase } from './supabase';
import { enhanceQuery as enhanceQueryLocal, quickEnhanceQuery, shouldEnhanceQuery } from './query-enhancer-local';
import { rerankChunks, ChunkWithScore, shouldRerank } from './reranker-local';
import { rerank } from 'ai';
import { chatRagScorePreservingReranker } from './reranker-adapter';
import { getQueryEmbedding } from './document-processor';

/**
 * Optimized search implementation with configurable query enhancement and re-ranking
 * All optimizations are optional and controlled via environment variables
 */

export interface OptimizedSearchOptions {
  matchCount?: number;
  similarityThreshold?: number;
  performanceMode?: 'fast' | 'balanced' | 'accurate';
  useReranking?: boolean;
  useQueryEnhancement?: boolean;
  rerankingStrategy?: 'bm25' | 'hybrid' | 'keyword-boost';
  rerankTopK?: number;
  includeAdjacentChunks?: boolean;
  adjacencyWindow?: number;
}

// Simple in-memory cache for search results
const searchCache = new Map<string, { results: ChunkWithScore[], timestamp: number }>();
const CACHE_TTL = parseInt(process.env.NEXT_PUBLIC_RAG_CACHE_TTL || '3600') * 1000; // Convert to ms

/**
 * Clear expired cache entries
 */
function clearExpiredCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}

/**
 * Get configuration from environment variables
 */
function getConfiguration() {
  return {
    enhancementEnabled: process.env.NEXT_PUBLIC_RAG_QUERY_ENHANCEMENT_ENABLED === 'true',
    rerankingEnabled: process.env.NEXT_PUBLIC_RAG_RERANKING_ENABLED === 'true',
    rerankingStrategy: (process.env.NEXT_PUBLIC_RAG_RERANKING_STRATEGY || 'bm25') as 'bm25' | 'hybrid' | 'keyword-boost',
    cacheEnabled: process.env.NEXT_PUBLIC_RAG_CACHE_ENABLED === 'true',
    performanceMode: (process.env.NEXT_PUBLIC_RAG_PERFORMANCE_MODE || 'balanced') as 'fast' | 'balanced' | 'accurate',
    confidenceThreshold: parseFloat(process.env.NEXT_PUBLIC_RAG_ENHANCEMENT_CONFIDENCE_THRESHOLD || '0.7')
  };
}

/**
 * Main optimized search function with configuration checking
 */
export async function optimizedSearch(
  query: string,
  options: OptimizedSearchOptions = {}
): Promise<ChunkWithScore[]> {
  const config = getConfiguration();

  const {
    matchCount = 10,
    similarityThreshold = 0.5,
    performanceMode = config.performanceMode,
    useReranking = config.rerankingEnabled,
    useQueryEnhancement = config.enhancementEnabled,
    rerankingStrategy = config.rerankingStrategy,
    rerankTopK = 5
  } = options;

  // Check cache first if enabled
  if (config.cacheEnabled) {
    clearExpiredCache();
    const cacheKey = JSON.stringify({ query, matchCount, similarityThreshold, performanceMode });
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[Optimized Search] Returning cached results');
      return cached.results;
    }
  }

  try {
    // Step 1: Query Enhancement (if enabled and beneficial)
    let processedQuery = query;
    let enhancementConfidence = 0;

    if (useQueryEnhancement) {
      // Check if enhancement would be beneficial
      if (shouldEnhanceQuery(query)) {
        console.log('[Optimized Search] Enhancing query...');

        if (performanceMode === 'fast') {
          processedQuery = quickEnhanceQuery(query);
        } else {
          const enhanced = await enhanceQueryLocal(query);
          enhancementConfidence = enhanced.confidence;

          // Only use enhanced query if confidence is above threshold
          if (enhanced.confidence >= config.confidenceThreshold) {
            processedQuery = enhanced.enhanced;
            console.log(`[Optimized Search] Query enhanced (confidence: ${enhanced.confidence.toFixed(2)}): "${query}" -> "${processedQuery}"`);
            console.log(`[Optimized Search] Type: ${enhanced.type}, Keywords: ${enhanced.keywords.join(', ')}`);
          } else {
            console.log(`[Optimized Search] Enhancement confidence too low (${enhanced.confidence.toFixed(2)}), using original query`);
          }
        }
      } else {
        console.log('[Optimized Search] Query enhancement not needed');
      }
    }

    // Step 2: Generate embedding for query
    const queryEmbedding = await getQueryEmbedding(processedQuery);

    // Step 3: Perform vector search
    console.log(`[Optimized Search] Searching with mode: ${performanceMode}, enhancement: ${useQueryEnhancement}, reranking: ${useReranking}`);

    // For re-ranking, fetch more candidates
    const searchMatchCount = useReranking ? Math.min(matchCount * 3, 30) : matchCount;

    // Try optimized search first
    let chunks;
    let error;

    // Check if optimized function exists
    const { data: optimizedChunks, error: optimizedError } = await supabase
      .rpc('match_document_chunks_optimized', {
        query_embedding: queryEmbedding,
        match_count: searchMatchCount,
        similarity_threshold: similarityThreshold,
        performance_mode: performanceMode
      });

    if (!optimizedError && optimizedChunks) {
      chunks = optimizedChunks;
    } else {
      // Fallback to regular search
      console.log('[Optimized Search] Using standard search function');
      const { data: standardChunks, error: standardError } = await supabase
        .rpc('match_document_chunks', {
          query_embedding: queryEmbedding,
          match_count: searchMatchCount,
          similarity_threshold: similarityThreshold
        });

      chunks = standardChunks;
      error = standardError;
    }

    if (error) {
      console.error('[Optimized Search] Error in vector search:', error);
      throw error;
    }

    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      console.log('[Optimized Search] No chunks found or invalid format');
      return [];
    }

    console.log(`[Optimized Search] Found ${chunks.length} initial chunks`);

    // Convert to ChunkWithScore format
    let results: ChunkWithScore[] = chunks.map(chunk => ({
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      content: chunk.content,
      similarity: chunk.similarity,
      metadata: chunk.metadata || {}
    }));

    // Step 4: Apply re-ranking if enabled and beneficial
    if (useReranking && shouldRerank(query, results)) {
      console.log(`[Optimized Search] Re-ranking ${results.length} chunks with ${rerankingStrategy} strategy`);

      results = await rerankChunks(
        query, // Use original query for re-ranking for better keyword matching
        results,
        {
          strategy: rerankingStrategy,
          topK: rerankTopK,
          includeScores: false
        }
      );

      console.log(`[Optimized Search] Re-ranking complete, returning top ${results.length} chunks`);
    } else {
      // If not re-ranking, just take the requested number
      results = results.slice(0, matchCount);

      if (!useReranking) {
        console.log('[Optimized Search] Re-ranking disabled by configuration');
      } else {
        console.log('[Optimized Search] Re-ranking skipped (not beneficial for this query)');
      }
    }

    // Cache results if enabled
    if (config.cacheEnabled) {
      const cacheKey = JSON.stringify({ query, matchCount, similarityThreshold, performanceMode });
      searchCache.set(cacheKey, { results, timestamp: Date.now() });
    }

    // Log performance metrics
    logSearchMetrics(query, processedQuery, results, {
      ...options,
      enhancementConfidence
    });

    return results;
  } catch (error) {
    console.error('[Optimized Search] Error:', error);
    // Fallback to basic search
    return fallbackSearch(query, matchCount, similarityThreshold);
  }
}

/**
 * Fallback search without optimizations
 */
async function fallbackSearch(
  query: string,
  matchCount: number,
  similarityThreshold: number
): Promise<ChunkWithScore[]> {
  console.log('[Optimized Search] Using fallback search');

  try {
    const queryEmbedding = await getQueryEmbedding(query);

    const { data: chunks, error } = await supabase
      .rpc('match_document_chunks', {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        similarity_threshold: similarityThreshold
      });

    if (error || !chunks) {
      console.error('[Optimized Search] Fallback search error:', error);
      return [];
    }

    return chunks.map(chunk => ({
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      content: chunk.content,
      similarity: chunk.similarity,
      metadata: chunk.metadata
    }));
  } catch (error) {
    console.error('[Optimized Search] Fallback search error:', error);
    return [];
  }
}

/**
 * Log search performance metrics
 */
function logSearchMetrics(
  originalQuery: string,
  processedQuery: string,
  results: ChunkWithScore[],
  options: OptimizedSearchOptions & { enhancementConfidence?: number }
): void {
  const metrics = {
    originalQuery,
    processedQuery,
    queryEnhanced: originalQuery !== processedQuery,
    enhancementConfidence: options.enhancementConfidence,
    resultsCount: results.length,
    topSimilarity: results[0]?.similarity || 0,
    avgSimilarity: results.reduce((sum, r) => sum + r.similarity, 0) / (results.length || 1),
    performanceMode: options.performanceMode,
    reranked: options.useReranking,
    rerankingStrategy: options.rerankingStrategy,
    timestamp: new Date().toISOString()
  };

  console.log('[Optimized Search] Metrics:', JSON.stringify(metrics, null, 2));
}

/**
 * Search with automatic configuration from environment
 */
export async function searchWithOptimizations(
  query: string,
  options: Partial<OptimizedSearchOptions> = {}
): Promise<ChunkWithScore[]> {
  const config = getConfiguration();

  return optimizedSearch(query, {
    useQueryEnhancement: config.enhancementEnabled,
    useReranking: config.rerankingEnabled,
    rerankingStrategy: config.rerankingStrategy,
    performanceMode: config.performanceMode,
    ...options
  });
}

/**
 * Batch optimized search for multiple queries
 */
export async function batchOptimizedSearch(
  queries: string[],
  options: OptimizedSearchOptions = {}
): Promise<Map<string, ChunkWithScore[]>> {
  const results = new Map<string, ChunkWithScore[]>();

  // Process queries in parallel with concurrency limit
  const concurrency = 3;

  for (let i = 0; i < queries.length; i += concurrency) {
    const batch = queries.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(query => optimizedSearch(query, options))
    );

    batch.forEach((query, idx) => {
      results.set(query, batchResults[idx]);
    });
  }

  return results;
}

/**
 * Clear the search cache
 */
export function clearSearchCache() {
  searchCache.clear();
  console.log('[Optimized Search] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  clearExpiredCache();
  return {
    size: searchCache.size,
    entries: Array.from(searchCache.entries()).map(([key, value]) => ({
      key,
      age: Date.now() - value.timestamp,
      resultsCount: value.results.length
    }))
  };
}