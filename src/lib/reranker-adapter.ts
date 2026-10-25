import { RerankingModel } from 'ai';
import { hybridRerank, ChunkWithScore } from './reranker-local';

/**
 * Adapter to use our local reranking logic with standard AI SDK 6 APIs.
 * AI SDK 6 uses a standardized V3 specification for reranking models.
 */
export const chatRagLocalReranker: RerankingModel = {
    specificationVersion: 'v3',
    provider: 'chatrag-local',
    modelId: 'hybrid-bm25',
    async doRerank(options) {
        const { query, documents, topN } = options;

        // AI SDK 6 passes documents as an object with 'values'
        // Extract actual string values
        const docValues = (documents as any).values as string[];

        // 1. Convert standard AI SDK inputs (strings) to our local ChunkWithScore format
        const chunks: ChunkWithScore[] = docValues.map((doc, i) => ({
            chunk_id: i.toString(),
            document_id: 'unknown',
            content: doc,
            similarity: 0
        }));

        // Local logic uses hybrid reranking by default
        const reranked = hybridRerank(query, chunks, { topK: topN, includeScores: true });

        // Return in standard V3 format
        return {
            ranking: reranked.map(r => ({
                index: parseInt(r.chunk_id),
                relevanceScore: r.rerankScore || 0,
            }))
        };
    }
};

/**
 * Specialized adapter that accepts full ChunkWithScore objects
 * Compatible with the same interface, just casting the input values
 */
export const chatRagScorePreservingReranker: RerankingModel = {
    specificationVersion: 'v3',
    provider: 'chatrag-local',
    modelId: 'hybrid-preserves-scores',
    async doRerank(options) {
        const { query, documents, topN } = options;

        // In our optimized search usage, we pass objects. 
        // They arrive in the 'values' array.
        const inputChunks = (documents as any).values as ChunkWithScore[];

        const reranked = hybridRerank(query, inputChunks, { topK: topN, includeScores: true });

        return {
            ranking: reranked.map(r => ({
                index: parseInt(r.chunk_id) || 0,
                relevanceScore: r.rerankScore || 0,
                // Document persistence if needed, but 'ranking' primarily cares about index/score
            }))
        };
    }
};
