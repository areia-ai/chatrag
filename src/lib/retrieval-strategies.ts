/**
 * Universal Retrieval Strategies for RAG Pipeline
 * 
 * This module implements domain-agnostic retrieval strategies to ensure
 * comprehensive data retrieval regardless of content type.
 */

import { supabase } from './supabase';
import { optimizedSearch } from './optimized-search';
import { getQueryEmbedding } from './document-processor';
import { BM25Scorer, applyBM25Scoring } from './bm25-scorer';
import { applyMMR, adaptiveMMR, calculateDiversityScore } from './mmr-scorer';
import { adaptiveRetrieval, intelligentFallback, type AdaptiveRetrievalConfig } from './adaptive-retrieval';

/**
 * Debug utility for conditional logging
 */
const DEBUG_RAG = process.env.DEBUG_RAG === 'true' || process.env.NODE_ENV === 'development';
const debugLog = (message: string, ...args: any[]) => {
  if (DEBUG_RAG) {
    console.log(message, ...args);
  }
};
const debugWarn = (message: string, ...args: any[]) => {
  if (DEBUG_RAG) {
    console.warn(message, ...args);
  }
};
const debugError = (message: string, ...args: any[]) => {
  // Always log errors, but prefix with debug context
  console.error(message, ...args);
};

export interface RetrievalConfig {
  enableAdjacentChunks: boolean;
  adjacencyWindow: number;
  enableHybridSearch: boolean;
  documentCompletenessThreshold: number;
  enableMultiPass: boolean;
  maxRetrievalPasses: number;
  completenessConfidence: number;
  initialMatchCount: number;
  similarityThreshold: number;
  enableMMR: boolean;
  mmrLambda: number;
  mmrTopK: number;
}

export interface ChunkResult {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  chunk_index?: number;
  total_chunks?: number;
}

export interface RetrievalResult {
  chunks: ChunkResult[];
  documentsRetrieved: string[];
  totalPasses: number;
  completenessScore: number;
  strategy: string;
}

/**
 * Get configuration from environment variables
 */
export function getRetrievalConfig(): RetrievalConfig {
  return {
    enableAdjacentChunks: process.env.RAG_ENABLE_ADJACENT_CHUNKS === 'true',
    adjacencyWindow: parseInt(process.env.RAG_ADJACENCY_WINDOW || '2'),
    enableHybridSearch: process.env.RAG_ENABLE_HYBRID_SEARCH === 'true',
    documentCompletenessThreshold: parseFloat(process.env.RAG_DOCUMENT_COMPLETENESS_THRESHOLD || '0.8'),
    enableMultiPass: process.env.RAG_ENABLE_MULTI_PASS === 'true',
    maxRetrievalPasses: parseInt(process.env.RAG_MAX_RETRIEVAL_PASSES || '3'),
    completenessConfidence: parseFloat(process.env.ENHANCED_RAG_MIN_CONFIDENCE || '0.7'),
    initialMatchCount: parseInt(process.env.RAG_INITIAL_MATCH_COUNT || '60'),
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.45'),
    enableMMR: true, // Always enable for Enhanced mode
    mmrLambda: parseFloat(process.env.ENHANCED_RAG_MMR_LAMBDA || '0.7'),
    mmrTopK: parseInt(process.env.ENHANCED_RAG_FINAL_RESULT_COUNT || '15')
  };
}

/**
 * Detect if query requires comprehensive retrieval
 */
export function requiresComprehensiveRetrieval(query: string): boolean {
  const comprehensivePatterns = [
    /\ball\b/i,
    /\bevery\b/i,
    /\bacross\b/i,
    /\bcomplete\b/i,
    /\bfull\b/i,
    /\bentire\b/i,
    /\bwhole\b/i,
    /\bfluctuat/i,
    /\btrend/i,
    /\bhistor/i,
    /\bover time\b/i,
    /\bcompare\b/i,
    /\blist\b/i,
    /\benumerat/i,
    /\beach\b/i
  ];
  
  return comprehensivePatterns.some(pattern => pattern.test(query));
}

/**
 * Calculate completeness score for retrieved chunks
 */
export function calculateCompletenessScore(
  chunks: ChunkResult[],
  query: string
): number {
  // Check document coverage
  const uniqueDocuments = new Set(chunks.map(c => c.document_id));
  const documentCoverage = Math.min(uniqueDocuments.size / 5, 1); // Assume 5 docs is comprehensive
  
  // Check chunk distribution across documents
  const documentChunkCounts = new Map<string, number>();
  chunks.forEach(chunk => {
    documentChunkCounts.set(
      chunk.document_id,
      (documentChunkCounts.get(chunk.document_id) || 0) + 1
    );
  });
  
  // Calculate average chunks per document
  const avgChunksPerDoc = chunks.length / uniqueDocuments.size;
  const chunkDensity = Math.min(avgChunksPerDoc / 5, 1); // Assume 5 chunks per doc is good
  
  // Check query term coverage
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  const contentText = chunks.map(c => c.content.toLowerCase()).join(' ');
  const termCoverage = queryTerms.filter(term => contentText.includes(term)).length / queryTerms.length;
  
  // Weighted completeness score
  return (documentCoverage * 0.3 + chunkDensity * 0.3 + termCoverage * 0.4);
}

/**
 * Retrieve adjacent chunks for better context (optimized batch version)
 */
export async function retrieveAdjacentChunks(
  chunks: ChunkResult[],
  adjacencyWindow: number
): Promise<ChunkResult[]> {
  if (!chunks || chunks.length === 0) return [];
  
  const additionalChunks: ChunkResult[] = [];
  const processedPairs = new Set<string>();
  
  try {
    // First, get all chunk indices in batch
    const chunkIds = chunks.map(c => c.chunk_id).filter(Boolean);
    if (chunkIds.length === 0) return [];
    
    const { data: chunkMetadata, error: metaError } = await supabase
      .from('document_chunks')
      .select('id, chunk_index, document_id')
      .in('id', chunkIds);
    
    if (metaError || !chunkMetadata) {
      debugWarn('[Adjacent Chunks] Error fetching chunk metadata:', metaError);
      return [];
    }
    
    // Build map of chunk_id to metadata for O(1) lookup
    const metaMap = new Map<string, { chunk_index: number; document_id: string }>();
    chunkMetadata.forEach(meta => {
      metaMap.set(meta.id, { chunk_index: meta.chunk_index, document_id: meta.document_id });
    });
    
    // Build list of all adjacent positions to query
    const adjacentQueries: { document_id: string; chunk_index: number; originalChunk: ChunkResult }[] = [];
    
    for (const chunk of chunks) {
      const meta = metaMap.get(chunk.chunk_id);
      if (!meta) continue;
      
      const chunkIndex = meta.chunk_index;
      
      // Add all adjacent positions within window
      for (let offset = 1; offset <= adjacencyWindow; offset++) {
        // Previous chunks
        const prevIndex = chunkIndex - offset;
        if (prevIndex >= 0) {
          const pairKey = `${chunk.document_id}-${prevIndex}`;
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            adjacentQueries.push({
              document_id: chunk.document_id,
              chunk_index: prevIndex,
              originalChunk: chunk
            });
          }
        }
        
        // Next chunks
        const nextIndex = chunkIndex + offset;
        const pairKey = `${chunk.document_id}-${nextIndex}`;
        if (!processedPairs.has(pairKey)) {
          processedPairs.add(pairKey);
          adjacentQueries.push({
            document_id: chunk.document_id,
            chunk_index: nextIndex,
            originalChunk: chunk
          });
        }
      }
    }
    
    // Batch query all adjacent chunks
    if (adjacentQueries.length === 0) return [];
    
    // Group queries by document for efficient querying
    const documentGroups = new Map<string, number[]>();
    adjacentQueries.forEach(query => {
      const indices = documentGroups.get(query.document_id) || [];
      indices.push(query.chunk_index);
      documentGroups.set(query.document_id, indices);
    });
    
    // Execute batch queries per document
    const batchPromises = Array.from(documentGroups.entries()).map(async ([docId, indices]) => {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('id, document_id, content, chunk_index')
        .eq('document_id', docId)
        .in('chunk_index', indices);
      
      if (error || !data) {
        debugWarn(`[Adjacent Chunks] Error querying document ${docId}:`, error);
        return [];
      }
      
      return data;
    });
    
    // Wait for all batch queries to complete
    const batchResults = await Promise.all(batchPromises);
    const allAdjacentChunks = batchResults.flat();
    
    // Build map of adjacent chunks for O(1) lookup
    const adjacentMap = new Map<string, { id: string; document_id: string; content: string; chunk_index: number }>();
    allAdjacentChunks.forEach(chunk => {
      const key = `${chunk.document_id}-${chunk.chunk_index}`;
      adjacentMap.set(key, chunk);
    });
    
    // Match queries with results and build final chunks
    for (const query of adjacentQueries) {
      const key = `${query.document_id}-${query.chunk_index}`;
      const adjacentChunk = adjacentMap.get(key);
      
      if (adjacentChunk) {
        additionalChunks.push({
          chunk_id: adjacentChunk.id,
          document_id: adjacentChunk.document_id,
          content: adjacentChunk.content,
          similarity: query.originalChunk.similarity * 0.8, // Slightly lower similarity for adjacent
          chunk_index: adjacentChunk.chunk_index
        });
      }
    }
    
    debugLog(`[Adjacent Chunks] Retrieved ${additionalChunks.length} adjacent chunks from ${adjacentQueries.length} queries`);
    
  } catch (error) {
    debugError('[Adjacent Chunks] Error in batch retrieval:', error);
  }
  
  return additionalChunks;
}

/**
 * Perform keyword-based search for hybrid approach
 */
export async function keywordSearch(
  query: string,
  limit: number = 10
): Promise<ChunkResult[]> {
  // Extract meaningful keywords (longer than 3 chars, not stopwords)
  const stopwords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'been']);
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopwords.has(word));
  
  if (keywords.length === 0) return [];
  
  // Build ILIKE conditions for each keyword
  const searchConditions = keywords.map(kw => `content ILIKE '%${kw}%'`).join(' OR ');
  
  // Use raw SQL for keyword search
  let data, error;
  try {
    const result = await supabase.rpc('search_chunks_by_keywords', {
      search_query: keywords.join(' '),
      match_limit: limit
    });
    data = result.data;
    error = result.error;
  } catch (e) {
    data = null;
    error = 'RPC not available';
  }
  
  // Fallback to basic search if RPC is not available
  if (!data || error) {
    const { data: chunks, error: searchError } = await supabase
      .from('document_chunks')
      .select('id, document_id, content')
      .or(searchConditions)
      .limit(limit);
    
    if (searchError || !chunks || !Array.isArray(chunks)) return [];
    
    // Calculate simple keyword match score
    return chunks.map(chunk => {
      const matchCount = keywords.filter(kw => 
        chunk.content.toLowerCase().includes(kw)
      ).length;
      
      return {
        chunk_id: chunk.id,
        document_id: chunk.document_id,
        content: chunk.content,
        similarity: matchCount / keywords.length
      };
    });
  }
  
  // Ensure data is an array before returning
  if (!Array.isArray(data)) return [];
  
  return data as ChunkResult[];
}

/**
 * Main comprehensive retrieval strategy
 */
export async function comprehensiveRetrieval(
  query: string,
  config?: Partial<RetrievalConfig>
): Promise<RetrievalResult> {
  const fullConfig = { ...getRetrievalConfig(), ...config };
  const allChunks = new Map<string, ChunkResult>();
  const documentsRetrieved = new Set<string>();
  let currentPass = 0;
  let completenessScore = 0;
  let strategy = 'standard';
  
  // Determine if comprehensive retrieval is needed
  const needsComprehensive = requiresComprehensiveRetrieval(query);
  if (needsComprehensive) {
    strategy = 'comprehensive';
    console.log('[Retrieval] Query requires comprehensive retrieval');
  }
  
  // Pass 1: Standard semantic search
  console.log('[Retrieval] Pass 1: Semantic search');
  const semanticResults = await optimizedSearch(query, {
    matchCount: needsComprehensive ? fullConfig.initialMatchCount * 2 : fullConfig.initialMatchCount,
    similarityThreshold: fullConfig.similarityThreshold,
    performanceMode: needsComprehensive ? 'accurate' : 'balanced'
  });
  
  // Ensure semanticResults is an array
  if (semanticResults && Array.isArray(semanticResults)) {
    semanticResults.forEach(chunk => {
      allChunks.set(chunk.chunk_id, chunk);
      documentsRetrieved.add(chunk.document_id);
    });
  }
  
  currentPass++;
  completenessScore = calculateCompletenessScore(Array.from(allChunks.values()), query);
  console.log(`[Retrieval] After pass ${currentPass}: ${allChunks.size} chunks, completeness: ${completenessScore.toFixed(2)}`);
  
  // Pass 2: Hybrid search if enabled and needed
  if (fullConfig.enableHybridSearch && completenessScore < fullConfig.completenessConfidence) {
    console.log('[Retrieval] Pass 2: Hybrid search with BM25 scoring');
    strategy = 'hybrid';
    
    // Get keyword search results
    const keywordResults = await keywordSearch(query, fullConfig.initialMatchCount);
    
    // Apply BM25 scoring to all chunks (semantic + keyword)
    const allChunksArray = Array.from(allChunks.values());
    const combinedChunks = [...allChunksArray, ...(keywordResults || [])];
    
    if (combinedChunks.length > 0) {
      const hybridScoredChunks = applyBM25Scoring(
        combinedChunks,
        query,
        parseFloat(process.env.ENHANCED_RAG_KEYWORD_WEIGHT || '0.2') // Optimized weight (20% BM25, 80% semantic)
      );
      
      // Update chunks with hybrid scores
      if (hybridScoredChunks && Array.isArray(hybridScoredChunks)) {
        hybridScoredChunks.forEach(chunk => {
          allChunks.set(chunk.chunk_id, chunk);
          documentsRetrieved.add(chunk.document_id);
        });
      }
    }
    
    currentPass++;
    completenessScore = calculateCompletenessScore(Array.from(allChunks.values()), query);
    console.log(`[Retrieval] After pass ${currentPass}: ${allChunks.size} chunks, completeness: ${completenessScore.toFixed(2)}`);
  }
  
  // Pass 3: Document completion - retrieve more chunks from already found documents
  if (needsComprehensive && documentsRetrieved.size > 0 && completenessScore < fullConfig.completenessConfidence) {
    console.log('[Retrieval] Pass 3: Document completion');
    strategy = 'comprehensive-document';
    
    for (const docId of documentsRetrieved) {
      // Get all chunks from this document
      const { data: docChunks, error } = await supabase
        .from('document_chunks')
        .select('id, document_id, content, chunk_index')
        .eq('document_id', docId)
        .order('chunk_index');
      
      if (!error && docChunks) {
        // Calculate document coverage
        const existingFromDoc = Array.from(allChunks.values()).filter(c => c.document_id === docId);
        const coverage = existingFromDoc.length / docChunks.length;
        
        // If coverage is below threshold, add more chunks
        if (coverage < fullConfig.documentCompletenessThreshold) {
          docChunks.forEach(chunk => {
            if (!allChunks.has(chunk.id)) {
              allChunks.set(chunk.id, {
                chunk_id: chunk.id,
                document_id: chunk.document_id,
                content: chunk.content,
                similarity: 0.6, // Default similarity for document completion
                total_chunks: docChunks.length,
                chunk_index: chunk.chunk_index
              });
            }
          });
        }
      }
    }
    
    currentPass++;
    completenessScore = calculateCompletenessScore(Array.from(allChunks.values()), query);
    console.log(`[Retrieval] After pass ${currentPass}: ${allChunks.size} chunks, completeness: ${completenessScore.toFixed(2)}`);
  }
  
  // Adjacent chunk retrieval if enabled
  if (fullConfig.enableAdjacentChunks) {
    console.log('[Retrieval] Retrieving adjacent chunks for context');
    const adjacentChunks = await retrieveAdjacentChunks(
      Array.from(allChunks.values()),
      fullConfig.adjacencyWindow
    );
    
    adjacentChunks.forEach(chunk => {
      if (!allChunks.has(chunk.chunk_id)) {
        allChunks.set(chunk.chunk_id, chunk);
      }
    });
    
    console.log(`[Retrieval] Added ${adjacentChunks.length} adjacent chunks`);
  }
  
  // Sort chunks by hybrid score (if available) or similarity, then by document and chunk index
  let finalChunks = Array.from(allChunks.values()).sort((a, b) => {
    // First sort by score (hybrid or similarity)
    const scoreA = (a as any).hybridScore || a.similarity;
    const scoreB = (b as any).hybridScore || b.similarity;
    if (Math.abs(scoreA - scoreB) > 0.1) {
      return scoreB - scoreA; // Higher score first
    }
    
    // Then by document and chunk index for coherent reading
    if (a.document_id !== b.document_id) {
      return a.document_id.localeCompare(b.document_id);
    }
    return (a.chunk_index || 0) - (b.chunk_index || 0);
  });
  
  // Apply MMR for diversity if enabled
  if (fullConfig.enableMMR && finalChunks.length > 0) {
    console.log('[Retrieval] Applying MMR for diversity enhancement');
    
    // Convert to MMR format
    const mmrCandidates = finalChunks.map(chunk => ({
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      content: chunk.content,
      similarity: (chunk as any).hybridScore || chunk.similarity,
      mmr_score: 0,
      selected: false
    }));
    
    // Apply adaptive MMR based on query
    const mmrResults = needsComprehensive 
      ? adaptiveMMR(mmrCandidates, query, fullConfig.mmrTopK)
      : applyMMR(mmrCandidates, fullConfig.mmrTopK, { lambda: fullConfig.mmrLambda });
    
    // Calculate diversity score
    const diversityScore = calculateDiversityScore(mmrResults);
    console.log(`[Retrieval] MMR applied: ${mmrResults.length} chunks selected, diversity score: ${diversityScore.toFixed(2)}`);
    
    // Update chunks with MMR scores
    finalChunks = mmrResults.map(result => {
      const originalChunk = allChunks.get(result.chunk_id);
      return {
        ...originalChunk!,
        similarity: result.mmr_score || result.similarity
      };
    });
    
    strategy += '-mmr';
  }
  
  return {
    chunks: finalChunks,
    documentsRetrieved: Array.from(documentsRetrieved),
    totalPasses: currentPass,
    completenessScore,
    strategy
  };
}

/**
 * Enhanced retrieval with simplified approach
 * Standard mode with MORE coverage and BETTER selection
 */
export async function enhancedAdaptiveRetrieval(
  query: string,
  config?: Partial<RetrievalConfig>
): Promise<RetrievalResult> {
  debugLog('[Enhanced Retrieval] Using simplified enhanced strategy');
  
  const fullConfig = { ...getRetrievalConfig(), ...config };
  
  try {
    // Step 1: Get more initial results (2x the amount)
    const initialMatchCount = fullConfig.initialMatchCount * (parseInt(process.env.ENHANCED_RAG_MATCH_MULTIPLIER || '2'));
    const similarityThreshold = fullConfig.similarityThreshold;
    
    debugLog(`[Enhanced Retrieval] Retrieving ${initialMatchCount} chunks with threshold ${similarityThreshold}`);
    
    const initialResults = await optimizedSearch(query, {
      matchCount: initialMatchCount,
      similarityThreshold: similarityThreshold,
      performanceMode: 'accurate'
    });
    
    if (!initialResults || !Array.isArray(initialResults) || initialResults.length === 0) {
      debugLog('[Enhanced Retrieval] No initial results found');
      return {
        chunks: [],
        documentsRetrieved: [],
        totalPasses: 1,
        completenessScore: 0,
        strategy: 'enhanced-empty'
      };
    }
    
    // Step 2: Add adjacent chunks for better context
    let enhancedChunks = [...initialResults];
    let chunkMap: Map<string, ChunkResult> | null = null;
    
    try {
      if (fullConfig.enableAdjacentChunks && process.env.ENHANCED_RAG_ADJACENT_CHUNKS === 'true') {
        debugLog('[Enhanced Retrieval] Adding adjacent chunks');
        const adjacentChunks = await retrieveAdjacentChunks(
          initialResults,
          fullConfig.adjacencyWindow
        );
        
        // Merge without duplicates using Map for efficient deduplication
        chunkMap = new Map<string, ChunkResult>();
        [...initialResults, ...adjacentChunks].forEach(chunk => {
          if (chunk && chunk.chunk_id && !chunkMap!.has(chunk.chunk_id)) {
            chunkMap!.set(chunk.chunk_id, chunk);
          }
        });
        
        enhancedChunks = Array.from(chunkMap.values());
        debugLog(`[Enhanced Retrieval] Total chunks after adjacent: ${enhancedChunks.length}`);
      }
    } catch (error) {
      debugError('[Enhanced Retrieval] Error adding adjacent chunks, continuing with initial results:', error);
      // Continue with initial results if adjacent chunks fail
    } finally {
      // Clean up Map to prevent memory leaks
      if (chunkMap) {
        chunkMap.clear();
      }
    }
    
    // Step 3: Apply MMR for diversity (only if enabled)
    let finalChunks = enhancedChunks;
    const mmrLambda = parseFloat(process.env.ENHANCED_RAG_MMR_LAMBDA || '0.85'); // Increased from 0.7 to prioritize relevance
    const finalResultCount = parseInt(process.env.ENHANCED_RAG_FINAL_RESULT_COUNT || '25'); // Increased from 15
    
    try {
      if (enhancedChunks.length > finalResultCount) {
        debugLog(`[Enhanced Retrieval] Applying MMR with lambda=${mmrLambda} to select ${finalResultCount} chunks`);
        
        // Validate chunks have required properties
        const validChunks = enhancedChunks.filter(chunk => 
          chunk && 
          chunk.chunk_id && 
          chunk.document_id && 
          chunk.content && 
          typeof chunk.similarity === 'number'
        );
        
        if (validChunks.length === 0) {
          debugWarn('[Enhanced Retrieval] No valid chunks for MMR, using original chunks');
          finalChunks = enhancedChunks;
        } else {
          const mmrCandidates = validChunks.map(chunk => ({
            chunk_id: chunk.chunk_id,
            document_id: chunk.document_id,
            content: chunk.content,
            similarity: chunk.similarity,
            mmr_score: 0,
            selected: false
          }));
          
          const mmrResults = applyMMR(mmrCandidates, finalResultCount, { lambda: mmrLambda });
          
          if (mmrResults && mmrResults.length > 0) {
            finalChunks = mmrResults.map(result => ({
              chunk_id: result.chunk_id,
              document_id: result.document_id,
              content: result.content,
              similarity: result.mmr_score || result.similarity,
              chunk_index: enhancedChunks.find(c => c.chunk_id === result.chunk_id)?.chunk_index,
              total_chunks: enhancedChunks.find(c => c.chunk_id === result.chunk_id)?.total_chunks
            }));
            
            debugLog(`[Enhanced Retrieval] MMR reduced ${enhancedChunks.length} to ${finalChunks.length} chunks`);
          } else {
            debugWarn('[Enhanced Retrieval] MMR returned no results, using original chunks');
            finalChunks = enhancedChunks.slice(0, finalResultCount);
          }
        }
      }
    } catch (error) {
      debugError('[Enhanced Retrieval] Error in MMR processing, using original chunks:', error);
      finalChunks = enhancedChunks.slice(0, finalResultCount);
    }
    
    // Sort by similarity
    finalChunks.sort((a, b) => b.similarity - a.similarity);
    
    const documentsRetrieved = [...new Set(finalChunks.map(c => c.document_id))];
    const completenessScore = calculateCompletenessScore(finalChunks, query);
    
    debugLog(`[Enhanced Retrieval] Complete: ${finalChunks.length} chunks from ${documentsRetrieved.length} documents`);
    
    return {
      chunks: finalChunks,
      documentsRetrieved,
      totalPasses: 1, // Simplified to single pass
      completenessScore,
      strategy: 'enhanced-simplified'
    };
    
  } catch (error) {
    debugError('[Enhanced Retrieval] Error, using fallback:', error);
    
    // Simple fallback to standard search
    const fallbackResults = await optimizedSearch(query, {
      matchCount: fullConfig.initialMatchCount,
      similarityThreshold: fullConfig.similarityThreshold,
      performanceMode: 'balanced'
    });
    
    return {
      chunks: fallbackResults || [],
      documentsRetrieved: fallbackResults ? [...new Set(fallbackResults.map(c => c.document_id))] : [],
      totalPasses: 1,
      completenessScore: 0.5,
      strategy: 'fallback'
    };
  }
}

/**
 * Smart chunk aggregation - merge related chunks
 */
export function aggregateChunks(chunks: ChunkResult[]): ChunkResult[] {
  // Ensure chunks is a valid array
  if (!chunks || !Array.isArray(chunks)) {
    console.warn('[aggregateChunks] Invalid chunks input, returning empty array');
    return [];
  }
  
  const aggregated: ChunkResult[] = [];
  const documentGroups = new Map<string, ChunkResult[]>();
  
  // Group by document
  chunks.forEach(chunk => {
    const group = documentGroups.get(chunk.document_id) || [];
    group.push(chunk);
    documentGroups.set(chunk.document_id, group);
  });
  
  // Process each document group
  documentGroups.forEach((docChunks, docId) => {
    // Sort by chunk index if available
    docChunks.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
    
    let currentAggregation: ChunkResult | null = null;
    
    docChunks.forEach((chunk, index) => {
      // Check if this chunk should be merged with the previous one
      const shouldMerge = currentAggregation && 
        chunk.chunk_index !== undefined &&
        currentAggregation.chunk_index !== undefined &&
        chunk.chunk_index === currentAggregation.chunk_index + 1;
      
      if (shouldMerge && currentAggregation) {
        // Merge chunks
        currentAggregation.content += '\n\n' + chunk.content;
        currentAggregation.similarity = Math.max(currentAggregation.similarity, chunk.similarity);
      } else {
        // Start new aggregation
        if (currentAggregation) {
          aggregated.push(currentAggregation);
        }
        currentAggregation = { ...chunk };
      }
    });
    
    // Add last aggregation
    if (currentAggregation) {
      aggregated.push(currentAggregation);
    }
  });
  
  return aggregated;
}