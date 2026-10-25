/**
 * BM25 Scoring Implementation for Hybrid Search
 * 
 * BM25 is a probabilistic ranking function used by search engines
 * to estimate the relevance of documents to a given search query.
 */

export interface Document {
  id: string;
  content: string;
}

export interface BM25Score {
  documentId: string;
  score: number;
}

/**
 * BM25 Scorer class
 */
export class BM25Scorer {
  private k1: number = 1.2; // Term frequency saturation parameter
  private b: number = 0.75; // Length normalization parameter
  private documents: Map<string, string[]> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private docFrequencies: Map<string, number> = new Map();
  private totalDocs: number = 0;

  constructor(documents: Document[], k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.indexDocuments(documents);
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2); // Filter out very short terms
  }

  /**
   * Index documents for BM25 scoring
   */
  private indexDocuments(documents: Document[]): void {
    this.totalDocs = documents.length;
    let totalLength = 0;

    // First pass: tokenize and calculate lengths
    for (const doc of documents) {
      const terms = this.tokenize(doc.content);
      this.documents.set(doc.id, terms);
      this.docLengths.set(doc.id, terms.length);
      totalLength += terms.length;

      // Count unique terms for document frequency
      const uniqueTerms = new Set(terms);
      uniqueTerms.forEach(term => {
        this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
      });
    }

    this.avgDocLength = totalLength / this.totalDocs;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term
   */
  private calculateIDF(term: string): number {
    const docFreq = this.docFrequencies.get(term) || 0;
    if (docFreq === 0) return 0;
    
    // Using the standard IDF formula with smoothing
    return Math.log((this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
  }

  /**
   * Calculate term frequency in a document
   */
  private calculateTermFrequency(term: string, docTerms: string[]): number {
    return docTerms.filter(t => t === term).length;
  }

  /**
   * Calculate BM25 score for a single document
   */
  private scoreDocument(docId: string, queryTerms: string[]): number {
    const docTerms = this.documents.get(docId);
    if (!docTerms) return 0;

    const docLength = this.docLengths.get(docId) || 0;
    let score = 0;

    for (const term of queryTerms) {
      const idf = this.calculateIDF(term);
      const tf = this.calculateTermFrequency(term, docTerms);
      
      if (tf > 0) {
        // BM25 formula
        const numerator = idf * tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        score += numerator / denominator;
      }
    }

    return score;
  }

  /**
   * Score all documents against a query
   */
  public scoreQuery(query: string): BM25Score[] {
    const queryTerms = this.tokenize(query);
    const scores: BM25Score[] = [];

    for (const [docId] of this.documents) {
      const score = this.scoreDocument(docId, queryTerms);
      if (score > 0) {
        scores.push({ documentId: docId, score });
      }
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get top K documents for a query
   */
  public getTopK(query: string, k: number): BM25Score[] {
    const scores = this.scoreQuery(query);
    return scores.slice(0, k);
  }
}

/**
 * Hybrid scoring function combining BM25 and semantic similarity
 */
export function hybridScore(
  bm25Score: number,
  semanticSimilarity: number,
  bm25Weight: number = 0.3
): number {
  const semanticWeight = 1 - bm25Weight;
  
  // Normalize BM25 score (assuming max score around 10)
  const normalizedBM25 = Math.min(bm25Score / 10, 1);
  
  // Combine scores
  return (normalizedBM25 * bm25Weight) + (semanticSimilarity * semanticWeight);
}

/**
 * Apply BM25 scoring to chunks
 */
export function applyBM25Scoring(
  chunks: Array<{ chunk_id: string; content: string; similarity: number }>,
  query: string,
  bm25Weight: number = 0.3
): Array<{ chunk_id: string; content: string; similarity: number; bm25Score: number; hybridScore: number }> {
  // Ensure chunks is a valid array
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }
  
  // Prepare documents for BM25
  const documents: Document[] = chunks.map(chunk => ({
    id: chunk.chunk_id,
    content: chunk.content
  }));

  // Create BM25 scorer
  const scorer = new BM25Scorer(documents);
  const bm25Scores = scorer.scoreQuery(query);

  // Create score map for quick lookup
  const scoreMap = new Map<string, number>();
  bm25Scores.forEach(score => {
    scoreMap.set(score.documentId, score.score);
  });

  // Apply hybrid scoring
  return chunks.map(chunk => {
    const bm25Score = scoreMap.get(chunk.chunk_id) || 0;
    const hybrid = hybridScore(bm25Score, chunk.similarity, bm25Weight);
    
    return {
      ...chunk,
      bm25Score,
      hybridScore: hybrid
    };
  }).sort((a, b) => b.hybridScore - a.hybridScore);
}