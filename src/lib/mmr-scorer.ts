/**
 * Maximal Marginal Relevance (MMR) Implementation
 * 
 * MMR balances relevance and diversity in document retrieval
 * to avoid redundant information while maintaining relevance.
 * 
 * Formula: MMR = λ × Relevance - (1-λ) × MaxSimilarity
 * where λ controls the trade-off between relevance and diversity
 */

export interface MMRConfig {
  lambda?: number; // Trade-off parameter (0-1), higher = more relevance, lower = more diversity
  threshold?: number; // Minimum similarity threshold for considering documents similar
}

export interface ScoredChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  mmr_score?: number;
  selected?: boolean;
}

/**
 * Calculate cosine similarity between two text strings
 * This is a simple implementation - in production, you might want to use embeddings
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  // Jaccard similarity as a proxy for content similarity
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Apply MMR algorithm to rerank chunks for diversity
 * 
 * @param candidates - Array of chunks with similarity scores
 * @param topK - Number of chunks to select
 * @param config - MMR configuration parameters
 * @returns Reranked array of chunks with MMR scores
 */
export function applyMMR(
  candidates: ScoredChunk[],
  topK: number = 10,
  config: MMRConfig = {}
): ScoredChunk[] {
  const { lambda = 0.7, threshold = 0.3 } = config;
  
  if (!candidates || candidates.length === 0) return [];
  if (topK <= 0) return [];
  
  // Sort candidates by initial similarity score
  const sortedCandidates = [...candidates].sort((a, b) => b.similarity - a.similarity);
  
  const selected: ScoredChunk[] = [];
  const remaining = [...sortedCandidates];
  
  // Select first document (highest relevance)
  if (remaining.length > 0) {
    const first = remaining.shift()!;
    first.mmr_score = first.similarity;
    first.selected = true;
    selected.push(first);
  }
  
  // Iteratively select documents that maximize MMR
  while (selected.length < topK && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIndex = -1;
    
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      
      // Calculate relevance (query similarity)
      const relevance = candidate.similarity;
      
      // Calculate maximum similarity to already selected documents
      let maxSimilarity = 0;
      for (const selectedDoc of selected) {
        const similarity = calculateTextSimilarity(candidate.content, selectedDoc.content);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
      
      // Calculate MMR score
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }
    
    if (bestIndex >= 0) {
      const selected_chunk = remaining.splice(bestIndex, 1)[0];
      selected_chunk.mmr_score = bestScore;
      selected_chunk.selected = true;
      selected.push(selected_chunk);
    } else {
      break; // No more suitable documents
    }
  }
  
  // Add remaining documents with MMR scores but not selected
  remaining.forEach(chunk => {
    chunk.mmr_score = 0;
    chunk.selected = false;
  });
  
  return selected;
}

/**
 * Group chunks by document and apply MMR within groups
 * This ensures diversity across different documents
 */
export function applyMMRWithGrouping(
  candidates: ScoredChunk[],
  topK: number = 10,
  config: MMRConfig = {}
): ScoredChunk[] {
  if (!candidates || candidates.length === 0) return [];
  
  // Group chunks by document
  const documentGroups = new Map<string, ScoredChunk[]>();
  candidates.forEach(chunk => {
    const group = documentGroups.get(chunk.document_id) || [];
    group.push(chunk);
    documentGroups.set(chunk.document_id, group);
  });
  
  // Apply MMR within each document group
  const mmrResults: ScoredChunk[] = [];
  const chunksPerDoc = Math.ceil(topK / documentGroups.size);
  
  documentGroups.forEach((chunks, docId) => {
    const docMMR = applyMMR(chunks, Math.min(chunksPerDoc, chunks.length), config);
    mmrResults.push(...docMMR);
  });
  
  // Sort by MMR score and take top K
  return mmrResults
    .sort((a, b) => (b.mmr_score || 0) - (a.mmr_score || 0))
    .slice(0, topK);
}

/**
 * Calculate diversity score for a set of chunks
 * Higher score means more diverse content
 */
export function calculateDiversityScore(chunks: ScoredChunk[]): number {
  if (chunks.length <= 1) return 1;
  
  let totalSimilarity = 0;
  let comparisons = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      totalSimilarity += calculateTextSimilarity(chunks[i].content, chunks[j].content);
      comparisons++;
    }
  }
  
  // Diversity is inverse of average similarity
  const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0;
  return 1 - avgSimilarity;
}

/**
 * Adaptive MMR that adjusts lambda based on query type
 */
export function adaptiveMMR(
  candidates: ScoredChunk[],
  query: string,
  topK: number = 10
): ScoredChunk[] {
  // Detect query type and adjust lambda accordingly
  let lambda = 0.7; // Default balanced
  
  // Comprehensive queries need more diversity
  if (/\b(all|every|complete|comprehensive|full|entire)\b/i.test(query)) {
    lambda = 0.5; // More diversity
  }
  // Specific queries need more relevance
  else if (/\b(specific|exact|particular|single)\b/i.test(query)) {
    lambda = 0.9; // More relevance
  }
  // Comparison queries need balanced diversity
  else if (/\b(compare|versus|vs|between|difference)\b/i.test(query)) {
    lambda = 0.6; // Balanced with slight diversity bias
  }
  
  console.log(`[MMR] Using adaptive lambda: ${lambda} for query type`);
  
  return applyMMR(candidates, topK, { lambda });
}