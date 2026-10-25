/**
 * Enhanced RAG Retrieval with Temporal and Financial Intelligence
 * 
 * Provides intelligent document retrieval that adapts to query type,
 * temporal requirements, and financial data precision needs
 */

import { supabase, getSupabaseAdmin } from './supabase';
import { getQueryEmbedding } from './document-processor';
import { analyzeQuery, validateTemporalMatch, createSearchFilters, type TemporalQueryContext } from './temporal-query-detector';
import { logger } from './logger';
import { env } from './env';

export interface EnhancedSearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  metadata: any;
  temporal_score: number;
  financial_score: number;
  final_score: number;
  match_reason: string;
}

export interface EnhancedRetrievalOptions {
  maxResults?: number;
  enableTemporalBoost?: boolean;
  enableFinancialBoost?: boolean;
  requireTemporalMatch?: boolean;
  fallbackToLowerThreshold?: boolean;
  organizationId?: string | null; // For multi-tenant filtering
  userId?: string | null; // For personal workspace filtering
}


/**
 * Main enhanced retrieval function
 */
export async function enhancedRetrieveChunks(
  query: string,
  options: EnhancedRetrievalOptions = {}
): Promise<{
  chunks: EnhancedSearchResult[];
  queryContext: TemporalQueryContext;
  retrievalStrategy: string;
  totalFound: number;
}> {
  const {
    maxResults = parseInt(process.env.RAG_FINAL_RESULT_COUNT || '25'),
    enableTemporalBoost = process.env.RAG_TEMPORAL_BOOST !== 'false',
    enableFinancialBoost = process.env.RAG_FINANCIAL_BOOST !== 'false',
    requireTemporalMatch = process.env.RAG_TEMPORAL_MATCHING === 'true',
    fallbackToLowerThreshold = process.env.RAG_FALLBACK_LOWER_THRESHOLD !== 'false',
    organizationId = null,
    userId = null
  } = options;

  logger.db(`[Enhanced RAG] Analyzing query: "${query}"`);
  logger.db(`[Enhanced RAG] Organization context: ${organizationId || 'personal workspace (flat)'}`);

  // Step 1: Analyze query to determine context and strategy
  const queryContext = analyzeQuery(query);
  logger.db(`[Enhanced RAG] Query analysis: ${queryContext.reasoningText}`);
  logger.db(`[Enhanced RAG] Strategy: ${queryContext.searchStrategy}, Precision: ${queryContext.requiredPrecision}`);
  logger.db(`[Enhanced RAG] Suggested threshold: ${queryContext.suggestedThreshold}`);

  // Step 2: Generate query embedding
  const queryEmbedding = await getQueryEmbedding(query);

  // Step 3: Execute retrieval based on strategy
  let results: EnhancedSearchResult[] = [];
  let retrievalStrategy = '';

  switch (queryContext.searchStrategy) {
    case 'exact_match':
      results = await exactMatchRetrieval(query, queryEmbedding, queryContext, maxResults, organizationId, userId);
      retrievalStrategy = 'Exact Match (Temporal/Financial Precision)';
      break;

    case 'multi_stage':
      results = await multiStageRetrieval(query, queryEmbedding, queryContext, maxResults, organizationId, userId);
      retrievalStrategy = 'Multi-Stage (Temporal + Financial)';
      break;

    case 'temporal_boost':
      results = await temporalBoostedRetrieval(query, queryEmbedding, queryContext, maxResults, organizationId, userId);
      retrievalStrategy = 'Temporal Boosted';
      break;

    default:
      results = await semanticOnlyRetrieval(query, queryEmbedding, queryContext, maxResults, organizationId, userId);
      retrievalStrategy = 'Semantic Only';
  }

  // Step 4: Apply fallback if no results and enabled
  // Step 4: Apply fallback if no results OR very few results and enabled
  // We check if we have very few results (less than 3) to ensure we provide some context
  if ((results.length === 0 || (results.length < 3 && fallbackToLowerThreshold)) && queryContext.suggestedThreshold > 0.35) {
    logger.db(`[Enhanced RAG] Few or no results found (${results.length}), trying fallback with lower threshold`);
    const fallbackResults = await fallbackRetrieval(query, queryEmbedding, maxResults, organizationId, userId);

    // Merge results, avoiding duplicates
    const existingIds = new Set(results.map(r => r.chunk_id));
    for (const res of fallbackResults) {
      if (!existingIds.has(res.chunk_id)) {
        results.push(res);
        existingIds.add(res.chunk_id);
      }
    }

    retrievalStrategy += ' + Fallback';
  }

  // Step 5: Post-process and score results
  const finalResults = await postProcessResults(results, queryContext);

  logger.db(`[Enhanced RAG] Retrieved ${finalResults.length} chunks using ${retrievalStrategy}`);
  if (finalResults.length > 0) {
    logger.db(`[Enhanced RAG] Top result score: ${finalResults[0].final_score.toFixed(3)}`);
    logger.db(`[Enhanced RAG] Match reasons: ${finalResults.slice(0, 3).map(r => r.match_reason).join(', ')}`);
  }

  return {
    chunks: finalResults,
    queryContext,
    retrievalStrategy,
    totalFound: finalResults.length
  };
}

/**
 * Execute vector search with organization filtering when in multi-tenant mode
 */
async function executeVectorSearch(
  queryEmbedding: number[],
  matchCount: number,
  threshold: number,
  organizationId: string | null,
  userId: string | null
): Promise<any[]> {
  const deploymentMode = env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE;

  if (deploymentMode === 'multi-tenant') {
    // Workspace-scoped search for both org and personal (no cross-fallback)
    logger.db(`[Enhanced RAG] Using workspace search (org=${organizationId || 'personal'}, user=${userId || 'anon'})`);

    const { data: chunks, error } = await supabase
      .rpc('match_documents_by_workspace', {
        p_org_id: organizationId || null,
        p_user_id: userId,
        p_query_embedding: queryEmbedding,
        p_match_count: matchCount,
        p_min_similarity: threshold
      });

    if (error) {
      logger.error('Enhanced RAG', 'Error in workspace vector search', error);
      return [];
    }

    return (chunks || []).map((chunk: any) => ({
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      content: chunk.content,
      similarity: chunk.similarity,
      metadata: chunk.metadata
    }));
  } else {
    // Use standard search for strict single-tenant deployments
    logger.db(`[Enhanced RAG] Using single-tenant search`);
    logger.db(`[Enhanced RAG] RPC params: match_count=${matchCount}, threshold=${threshold}, embedding_length=${queryEmbedding.length}`);
    logger.db(`[Enhanced RAG] Embedding first 5 values: [${queryEmbedding.slice(0, 5).join(', ')}]`);

    const { data: chunks, error } = await supabase
      .rpc('match_document_chunks', {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        similarity_threshold: threshold
      });

    if (error) {
      logger.error('Enhanced RAG', 'Error in single-tenant vector search', error);
      return [];
    }

    logger.db(`[Enhanced RAG] RPC returned ${chunks?.length || 0} chunks`);
    if (chunks && chunks.length > 0) {
      logger.db(`[Enhanced RAG] First chunk: id=${chunks[0].chunk_id}, similarity=${chunks[0].similarity}`);
    }

    return chunks || [];
  }
}

/**
 * Exact match retrieval for high-precision temporal/financial queries
 */
async function exactMatchRetrieval(
  query: string,
  queryEmbedding: number[],
  context: TemporalQueryContext,
  maxResults: number,
  organizationId: string | null,
  userId: string | null
): Promise<EnhancedSearchResult[]> {
  logger.db(`[Enhanced RAG] Executing exact match retrieval`);

  // Use higher similarity threshold for exact matches
  const threshold = Math.max(context.suggestedThreshold, 0.7);

  const chunks = await executeVectorSearch(
    queryEmbedding,
    Math.min(maxResults * 2, 50), // Retrieve more for filtering
    threshold,
    organizationId,
    userId
  );

  if (!chunks || chunks.length === 0) {
    logger.db(`[Enhanced RAG] No chunks found with threshold ${threshold}`);
    return [];
  }

  // Filter and score results based on temporal/financial requirements
  const scoredResults = chunks
    .map((chunk: any) => processChunkResult(chunk, context, 'exact_match'))
    .filter(result => {
      // For exact match, only include chunks that meet temporal requirements
      if (context.isTemporalQuery && context.requireTemporalMatch) {
        const validation = validateTemporalMatch(result.metadata, context);
        return validation.isValid && validation.score >= 0.8;
      }
      return true;
    })
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, maxResults);

  logger.db(`[Enhanced RAG] Exact match found ${scoredResults.length} qualifying chunks`);
  return scoredResults;
}

/**
 * Multi-stage retrieval combining semantic, temporal, and financial signals
 */
async function multiStageRetrieval(
  query: string,
  queryEmbedding: number[],
  context: TemporalQueryContext,
  maxResults: number,
  organizationId: string | null,
  userId: string | null
): Promise<EnhancedSearchResult[]> {
  logger.db(`[Enhanced RAG] Executing multi-stage retrieval`);

  // Stage 1: Semantic search with moderate threshold
  const stage1Threshold = context.suggestedThreshold;
  const stage1Count = maxResults * 2; // Fetch more candidates for filtering
  const stage1Chunks = await executeVectorSearch(
    queryEmbedding,
    stage1Count,
    stage1Threshold,
    organizationId,
    userId
  );

  if (!stage1Chunks || stage1Chunks.length === 0) {
    logger.db(`[Enhanced RAG] Stage 1 (semantic) found no results`);
    return [];
  }

  // Stage 2: Filter and boost based on temporal/financial criteria
  const processedResults = stage1Chunks
    .map((chunk: any) => processChunkResult(chunk, context, 'multi_stage'))
    .filter(result => {
      // Apply temporal validation if required
      if (context.isTemporalQuery) {
        const validation = validateTemporalMatch(result.metadata, context);
        return validation.isValid && validation.score >= 0.5;
      }
      return true;
    })
    .sort((a, b) => b.final_score - a.final_score);

  // Stage 3: Select top results ensuring diversity
  const finalResults = ensureResultDiversity(processedResults, maxResults);

  logger.db(`[Enhanced RAG] Multi-stage completed: ${stage1Chunks.length} → ${processedResults.length} → ${finalResults.length}`);
  return finalResults;
}

/**
 * Temporal boosted retrieval for time-sensitive queries
 */
async function temporalBoostedRetrieval(
  query: string,
  queryEmbedding: number[],
  context: TemporalQueryContext,
  maxResults: number,
  organizationId: string | null,
  userId: string | null
): Promise<EnhancedSearchResult[]> {
  logger.db(`[Enhanced RAG] Executing temporal boosted retrieval`);

  const chunks = await executeVectorSearch(
    queryEmbedding,
    maxResults * 2,
    context.suggestedThreshold,
    organizationId,
    userId
  );

  if (!chunks || chunks.length === 0) {
    return [];
  }

  const results = chunks
    .map((chunk: any) => processChunkResult(chunk, context, 'temporal_boost'))
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, maxResults);

  logger.db(`[Enhanced RAG] Temporal boost found ${results.length} chunks`);
  return results;
}

/**
 * Standard semantic-only retrieval
 */
async function semanticOnlyRetrieval(
  query: string,
  queryEmbedding: number[],
  context: TemporalQueryContext,
  maxResults: number,
  organizationId: string | null,
  userId: string | null
): Promise<EnhancedSearchResult[]> {
  logger.db(`[Enhanced RAG] Executing semantic-only retrieval`);

  const chunks = await executeVectorSearch(
    queryEmbedding,
    maxResults,
    context.suggestedThreshold,
    organizationId,
    userId
  );

  if (!chunks || chunks.length === 0) {
    return [];
  }

  const results = chunks.map((chunk: any) => processChunkResult(chunk, context, 'semantic'));
  logger.db(`[Enhanced RAG] Semantic-only found ${results.length} chunks`);
  return results;
}

/**
 * Fallback retrieval with lower threshold
 */
async function fallbackRetrieval(
  query: string,
  queryEmbedding: number[],
  maxResults: number,
  organizationId: string | null,
  userId: string | null
): Promise<EnhancedSearchResult[]> {
  logger.db(`[Enhanced RAG] Executing fallback retrieval with threshold 0.28`);

  const chunks = await executeVectorSearch(
    queryEmbedding,
    maxResults,
    0.28,
    organizationId,
    userId
  );

  if (!chunks || chunks.length === 0) {
    return [];
  }

  // Create minimal context for fallback processing
  const fallbackContext: TemporalQueryContext = {
    isTemporalQuery: false,
    isFinancialQuery: false,
    isSpecificDataQuery: false,
    timeframe: null,
    financialMetrics: [],
    requiredPrecision: 'low',
    suggestedThreshold: 0.28,
    searchStrategy: 'semantic_only',
    requireTemporalMatch: false,
    reasoningText: 'Fallback retrieval'
  };

  const results = chunks.map((chunk: any) => processChunkResult(chunk, fallbackContext, 'fallback'));
  logger.db(`[Enhanced RAG] Fallback found ${results.length} chunks`);
  return results;
}

/**
 * Process individual chunk result with enhanced scoring
 */
function processChunkResult(
  chunk: any,
  context: TemporalQueryContext,
  retrievalType: string
): EnhancedSearchResult {
  const metadata = chunk.metadata || {};

  // Base similarity score
  let finalScore = chunk.similarity;
  const matchReasons = [`similarity: ${chunk.similarity.toFixed(3)}`];

  // Temporal scoring
  let temporalScore = 0;
  if (context.isTemporalQuery && context.timeframe) {
    const validation = validateTemporalMatch(metadata, context);
    temporalScore = validation.score;

    if (validation.score > 0.8) {
      finalScore += 0.2; // Strong temporal match boost
      matchReasons.push('exact temporal match');
    } else if (validation.score > 0.5) {
      finalScore += 0.1; // Partial temporal match boost
      matchReasons.push('partial temporal match');
    }
  }

  // Financial scoring
  let financialScore = 0;
  if (context.isFinancialQuery) {
    const hasFinancialData = metadata.has_financial_data || false;
    const financialEntities = metadata.financial_entities || [];

    if (hasFinancialData && financialEntities.length > 0) {
      financialScore = 0.8;
      finalScore += 0.15; // Financial data boost
      matchReasons.push('contains financial data');
    } else if (hasFinancialData) {
      financialScore = 0.5;
      finalScore += 0.05;
      matchReasons.push('financial context');
    }

    // Check for specific financial metrics
    const matchingMetrics = context.financialMetrics.filter(metric =>
      chunk.content.toLowerCase().includes(metric.toLowerCase())
    );

    if (matchingMetrics.length > 0) {
      finalScore += matchingMetrics.length * 0.05;
      matchReasons.push(`matches: ${matchingMetrics.join(', ')}`);
    }
  }

  // High-value chunk boost
  if (metadata.is_high_value_chunk) {
    finalScore += 0.05;
    matchReasons.push('high-value chunk');
  }

  return {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    content: chunk.content,
    similarity: chunk.similarity,
    metadata: metadata,
    temporal_score: temporalScore,
    financial_score: financialScore,
    final_score: Math.min(finalScore, 1.0), // Cap at 1.0
    match_reason: matchReasons.join(', ')
  };
}

/**
 * Ensure diversity in results to avoid redundancy
 */
function ensureResultDiversity(results: EnhancedSearchResult[], maxResults: number): EnhancedSearchResult[] {
  const diverse: EnhancedSearchResult[] = [];
  const seenDocuments = new Set<string>();

  for (const result of results) {
    if (diverse.length >= maxResults) break;

    // Always include top results
    if (diverse.length < maxResults * 0.6) {
      diverse.push(result);
      seenDocuments.add(result.document_id);
    }
    // For remaining slots, prefer different documents
    else if (!seenDocuments.has(result.document_id) || diverse.length < maxResults * 0.8) {
      diverse.push(result);
      seenDocuments.add(result.document_id);
    }
  }

  return diverse;
}

/**
 * Post-process results for final ranking and filtering
 */
async function postProcessResults(
  results: EnhancedSearchResult[],
  context: TemporalQueryContext
): Promise<EnhancedSearchResult[]> {
  // Sort by final score
  results.sort((a, b) => b.final_score - a.final_score);

  // Log top results for debugging
  if (results.length > 0) {
    logger.db(`[Enhanced RAG] Top 3 results:`);
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const r = results[i];
      logger.db(`  ${i + 1}. Score: ${r.final_score.toFixed(3)} | ${r.match_reason}`);
      logger.db(`     Content: "${r.content.substring(0, 100)}..."`);
    }
  }

  return results;
}