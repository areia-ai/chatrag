import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getQueryEmbedding } from '@/lib/document-processor';
import { hybridRerank } from '@/lib/reranker-local';

// Use Node.js runtime
export const runtime = 'nodejs';

/**
 * Internal API Endpoint for Voice Agent RAG
 * 
 * Allows the standalone Node.js Voice Agent to query the Vector DB securely.
 * Protected by CHATRAG_INTERNAL_API_KEY.
 */
export async function POST(req: NextRequest) {
    try {
        // 1. Security Check
        const apiKey = req.headers.get('x-api-key');

        // Validate configuration
        if (!env.CHATRAG_INTERNAL_API_KEY) {
            console.error('[Internal RAG] CHATRAG_INTERNAL_API_KEY not configured on server');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Validate key
        if (apiKey !== env.CHATRAG_INTERNAL_API_KEY) {
            console.warn('[Internal RAG] Unauthorized access attempt');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse Body
        const body = await req.json();
        const { query, userId, matchCount = 5 } = body;

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid query' }, { status: 400 });
        }

        // 3. Generate Embedding
        // Uses the centralized embedding logic (OpenAI text-embedding-3-small by default)
        const queryEmbedding = await getQueryEmbedding(query);

        // 4. Retrieve Context (Initial Vector Search)
        const adminClient = getSupabaseAdmin();
        if (!adminClient) {
            throw new Error('Supabase Admin client unavailable');
        }

        let chunks: any[] = [];
        const initialFetchCount = matchCount * 2; // Fetch more candidates for reranking

        // Use specific RPC if userId provided to support workspace filtering
        if (userId) {
            // Based on src/lib/enhanced-rag-retrieval.ts usage
            const { data, error } = await adminClient.rpc('match_documents_by_workspace', {
                p_org_id: null, // Defaults to personal workspace context
                p_user_id: userId,
                p_query_embedding: queryEmbedding,
                p_match_count: (matchCount || 5) * 5,
                p_min_similarity: 0.15 // Significantly lowered to catch "logo" vs "speech bubble"
            });

            if (error) {
                console.error('[Internal RAG] RPC error (workspace):', error);
                throw error;
            }
            chunks = data || [];
        } else {
            // Fallback to global search
            const { data, error } = await adminClient.rpc('match_document_chunks', {
                query_embedding: queryEmbedding,
                match_count: (matchCount || 5) * 5,
                similarity_threshold: 0.15
            });

            if (error) {
                console.error('[Internal RAG] RPC error (global):', error);
                throw error;
            }
            chunks = data || [];
        }

        // 4b. KEYWORD FALLBACK:
        // Text-based retrieval for named entities (e.g. "ChatRAG logo") that vector search might miss
        // due to semantic gaps (e.g. description is "speech bubble icon").
        // 4b. KEYWORD FALLBACK:
        // Text-based retrieval for named entities (e.g. "ChatRAG logo") that vector search might miss

        let cleanQuery = '';
        let keywords: string[] = [];
        let searchKeywords: string[] = [];

        if (query.split(' ').length < 15) { // Increased word limit slightly
            // Clean query: remove possessives ('s) first, then punctuation
            // This ensures "ChatRAG's logo" becomes "chatrag logo" not "chatrags logo"
            cleanQuery = query.toLowerCase()
                .replace(/['’]s/g, '') // Remove possessive 's (straight and smart quotes)
                .replace(/[^\w\s]/g, ''); // Remove other special chars

            const stopWords = new Set(['the', 'is', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'by', 'at', 'show', 'me', 'what', 'where', 'can', 'you', 'please', 'who']);

            // Split by whitespace and filter
            keywords = cleanQuery.split(/\s+/).filter(w => !stopWords.has(w) && w.length > 2);

            // Add synonyms for common intent words
            const synonyms: Record<string, string[]> = {
                'creator': ['created', 'maker', 'founder', 'built'],
                'created': ['creator', 'maker', 'founder', 'built'],
                'maker': ['creator', 'created', 'founder'],
                'founder': ['creator', 'created'],
                'logo': ['icon', 'symbol']
            };

            // Expand keywords with synonyms
            const expandedKeywords = [...keywords];
            keywords.forEach(kw => {
                if (synonyms[kw]) {
                    expandedKeywords.push(...synonyms[kw]);
                }
            });
            // Deduplicate
            searchKeywords = [...new Set(expandedKeywords)];

            if (searchKeywords.length > 0) {
                console.log(`[Internal RAG] Keyword search for: ${searchKeywords.join(', ')}`);

                const existingIds = new Set(chunks.map(c => c.id));

                // STEP 0: EXPLICIT IMAGE FETCH (High Priority)
                // If query implies looking for an image/logo, specifically fetch chunks with image_url
                const isImageIntent = ['show', 'see', 'look', 'view', 'logo', 'image', 'picture', 'photo', 'icon', 'symbol', 'who', 'creator', 'created', 'founder', 'maker'].some(w => query.toLowerCase().includes(w));
                if (isImageIntent) {
                    console.log('[Internal RAG] Image intent detected, fetching explicit images...');

                    // Create OR conditions for image context/name matching any keyword
                    const imageConditions = searchKeywords.map(kw =>
                        `metadata->>image_context.ilike.%${kw}%,metadata->>name.ilike.%${kw}%`
                    ).join(',');

                    const { data: imageData, error: imageError } = await adminClient
                        .from('document_chunks')
                        .select('id, document_id, content, metadata')
                        .not('metadata->>image_url', 'is', 'null') // ONLY images
                        .or(imageConditions)
                        .limit(20);

                    if (!imageError && imageData && imageData.length > 0) {
                        let matchesToProcess = imageData;

                        // DISCRIMINATOR CHECK: 
                        // If user specifically asked for "logo", and we have results matching "logo", 
                        // filter out the loose matches (e.g. "ChatRAG creator") to avoid ambiguity.
                        if (query.toLowerCase().includes('logo')) {
                            const logoSpecificMatches = imageData.filter((img: { id: string; metadata?: { name?: string; image_context?: string } }) =>
                                (img.metadata?.name || '').toLowerCase().includes('logo') ||
                                (img.metadata?.image_context || '').toLowerCase().includes('logo')
                            );

                            if (logoSpecificMatches.length > 0) {
                                console.log(`[Internal RAG] 🎯 Found ${logoSpecificMatches.length} specific LOGO matches, filtering others...`);
                                matchesToProcess = logoSpecificMatches;
                            }
                        }
                        // DISCRIMINATOR CHECK: PERON/CREATOR
                        else if (['who', 'creator', 'founder', 'created', 'maker'].some(w => query.toLowerCase().includes(w))) {
                            const creatorMatches = imageData.filter((img: { id: string; metadata?: { name?: string; image_context?: string } }) => {
                                const meta = (img.metadata?.name || '') + ' ' + (img.metadata?.image_context || '');
                                return ['carlos', 'marcial', 'creator', 'founder', 'maker', 'author'].some(t => meta.toLowerCase().includes(t));
                            });

                            if (creatorMatches.length > 0) {
                                console.log(`[Internal RAG] 🎯 Found ${creatorMatches.length} specific CREATOR matches, filtering others...`);
                                matchesToProcess = creatorMatches;
                            }
                        }

                        console.log(`[Internal RAG] 🖼️ Processing ${matchesToProcess.length} explicit image matches`);
                        matchesToProcess.forEach((img: { id: string; metadata?: { name?: string; image_context?: string; image_url?: string } }) => {
                            if (existingIds.has(img.id)) {
                                // Update existing chunk score to max priority
                                const existingChunk = chunks.find(c => c.id === img.id);
                                if (existingChunk) {
                                    existingChunk.similarity = 3.0;
                                    console.log(`[Internal RAG] 🚀 Boosted existing image chunk: ${img.id}`);
                                }
                            } else {
                                chunks.push({
                                    ...img,
                                    similarity: 3.0 // MAX PRIORITY - Ensure these survive reranking
                                });
                                existingIds.add(img.id);
                            }
                        });
                    }
                }

                // STEP 1: Try LOOSE PHRASE MATCH first for highest precision using original keywords
                // Join keywords with % to match "chatrag logo", "chatrag-logo", "chatrag_logo"
                const keyPhrase = keywords.join('%');
                console.log(`[Internal RAG] Looking for loose phrase: "${keyPhrase}"`);

                // Query for chunks where name or image_context contains the phrase
                const phraseConditions = [
                    `metadata->>name.ilike.%${keyPhrase}%`,
                    `metadata->>image_context.ilike.%${keyPhrase}%`
                ];

                const { data: phraseData } = await adminClient
                    .from('document_chunks')
                    .select('id, document_id, content, metadata')
                    .or(phraseConditions.join(','))
                    .limit(100);

                if (phraseData && phraseData.length > 0) {
                    console.log(`[Internal RAG] ✅ EXACT PHRASE MATCH found ${phraseData.length} chunks for "${keyPhrase}"`);

                    const existingIds = new Set(chunks.map(c => c.id));
                    for (const pc of phraseData) {
                        if (!existingIds.has(pc.id)) {
                            chunks.push({
                                ...pc,
                                similarity: 2.0  // Super high score to guarantee top position
                            });
                            existingIds.add(pc.id);
                            console.log(`[Internal RAG] Added phrase match: "${pc.metadata?.name || pc.id}" with score 2.0`);
                        }
                    }
                }

                // STEP 2: Fall back to individual keyword matching
                let keywordQuery = adminClient
                    .from('document_chunks')
                    .select('id, document_id, content, metadata, embedding');

                // Construct OR filter for any keyword matching image_context or name
                const conditions: string[] = [];
                searchKeywords.forEach(kw => {
                    conditions.push(`metadata->>image_context.ilike.%${kw}%`);
                    // Use a safe cast or check for name existence if possible, but ilike handles nulls gracefully usually
                    conditions.push(`metadata->>name.ilike.%${kw}%`);

                    // Also search content text for people/creator queries since that info might be in the description
                    if (['creator', 'created', 'founder', 'maker', 'carlos', 'marcial'].includes(kw)) {
                        conditions.push(`content.ilike.%${kw}%`);
                    }
                });

                if (conditions.length > 0) {
                    keywordQuery = keywordQuery.or(conditions.join(','));
                    keywordQuery = keywordQuery.limit(50);

                    const { data: keywordData, error: keywordError } = await keywordQuery;

                    if (!keywordError && keywordData && keywordData.length > 0) {
                        console.log(`[Internal RAG] Keyword fallback found ${keywordData.length} chunks`);

                        // RELEVANCE SCORING
                        const scoredKeywordData = keywordData.map((kc: { id: string; metadata?: { image_context?: string; name?: string }; content?: string; embedding?: number[] }) => {
                            const matchText = [
                                kc.metadata?.image_context || '',
                                kc.metadata?.name || '',
                                kc.content || ''
                            ].join(' ').toLowerCase();

                            // Count how many ORIGINAL keywords match (not synonyms, to prioritize exact query)
                            let matchCount = 0;
                            // Also track if any strong identifiers match
                            let hasStrongMatch = false;

                            for (const kw of keywords) {
                                if (matchText.includes(kw)) {
                                    matchCount++;
                                    // "logo" or names are strong identifiers
                                    if (['logo', 'chatrag', 'carlos', 'marcial'].includes(kw)) {
                                        hasStrongMatch = true;
                                    }
                                }
                            }

                            // Boost score for specific entity types matches
                            const isLogoQuery = keywords.includes('logo');
                            const isLogoContent = matchText.includes('logo');

                            const isPersonQuery = ['creator', 'founder', 'carlos', 'who'].some(k => keywords.includes(k));
                            const isPersonContent = ['carlos', 'marcial', 'creator', 'founder'].some(k => matchText.includes(k));

                            // Penalize mismatches (e.g. asking for logo but getting person)
                            let penalty = 0;
                            if (isLogoQuery && !isLogoContent) penalty = 0.5;
                            if (isLogoContent && !isLogoQuery) penalty = 0.2; // Show logo less if not asked for

                            // Calculate relevance
                            let relevance = matchCount / Math.max(1, keywords.length);

                            // Bonus for semantic alignment
                            if (isLogoQuery && isLogoContent) relevance += 0.4;
                            if (isPersonQuery && isPersonContent) relevance += 0.4;

                            relevance -= penalty;

                            return {
                                ...kc,
                                keywordRelevance: Math.max(0.1, relevance) // Ensure non-negative
                            };
                        });

                        // Sort by relevance
                        scoredKeywordData.sort((a: { keywordRelevance: number }, b: { keywordRelevance: number }) => b.keywordRelevance - a.keywordRelevance);

                        // Only add chunks with decent relevance
                        const minRelevance = 0.25;
                        const relevantChunks = scoredKeywordData.filter((kc: { keywordRelevance: number }) => kc.keywordRelevance >= minRelevance);

                        if (relevantChunks.length > 0) {
                            console.log(`[Internal RAG] Adding ${relevantChunks.length} relevant keyword matches`);
                            relevantChunks.forEach((rc: { metadata?: { image_context?: string }; keywordRelevance: number }) => console.log(`   > ${rc.metadata?.image_context?.substring(0, 30)}... (Score: ${rc.keywordRelevance.toFixed(2)})`));
                        }

                        const existingIds = new Set(chunks.map(c => c.id));
                        for (const kc of relevantChunks.slice(0, 5)) {
                            if (!existingIds.has(kc.id)) {
                                chunks.push({
                                    ...kc,
                                    similarity: kc.keywordRelevance
                                });
                                existingIds.add(kc.id);
                            }
                        }
                    } else if (keywordError) {
                        console.warn('[Internal RAG] Keyword fallback error:', keywordError);
                    }
                }
            }
        }

        if (chunks.length === 0) {
            return NextResponse.json({ results: [] });
        }

        // 5. Normalization & Reranking
        // Map RPC results to the ChunkWithScore format expected by our reranker
        // Safety: Filter out any null/undefined chunks from RPC before processing
        const candidateChunks = chunks.filter(c => c).map(c => {
            // Enrich content with metadata for better reranking (so "logo" in filename counts)
            const enrichedContent = `${c.content || ''}\n[Metadata: ${c.metadata?.image_context || ''} ${c.metadata?.name || ''} ${c.metadata?.document_title || ''}]`;

            return {
                chunk_id: c.id || c.chunk_id || 'unknown',
                document_id: c.document_id || 'unknown',
                content: enrichedContent, // Use enriched content for scoring
                similarity: c.similarity || 0,
                metadata: c.metadata || {}
            };
        });

        if (candidateChunks.length === 0) {
            return NextResponse.json({ results: [], source_images: [] });
        }

        // Leverage local reranker directly (bypassing adapter index bug)
        const rerankedChunks = hybridRerank(
            query,
            candidateChunks,
            { topK: matchCount, includeScores: true }
        );

        // 6. Format Final Response
        const finalResults = rerankedChunks.map(c => ({
            ...c,
            similarity: c.rerankScore || c.similarity,
            image_url: c.metadata?.image_url || null
        }));

        // 7. Extract source images from chunks with image_url in metadata
        // 7. Extract source images with FINAL DISCRIMINATOR logic
        let imageChunks = finalResults.filter(r => r.image_url);

        // Re-detect intents for final filtering (scope safety)
        const qLower = query.toLowerCase();
        const isPersonIntent = ['who', 'creator', 'founder', 'created', 'maker', 'author'].some(w => qLower.includes(w));
        const isLogoIntent = qLower.includes('logo');

        if (isPersonIntent) {
            // Priority 1: Person Intent -> Show Person Only
            const personImages = imageChunks.filter(r => {
                const meta = (r.metadata?.name || '') + ' ' + (r.metadata?.image_context || '');
                return ['carlos', 'marcial', 'creator', 'founder', 'maker', 'author'].some(t => meta.toLowerCase().includes(t));
            });
            if (personImages.length > 0) {
                console.log(`[Internal RAG] 🎯 Final Filter: Enforcing user asked for CREATOR`);
                imageChunks = personImages;
            }
        } else if (isLogoIntent) {
            // Priority 2: Logo Intent -> Show Logo Only
            const logoImages = imageChunks.filter(r => {
                const meta = (r.metadata?.name || '') + ' ' + (r.metadata?.image_context || '');
                return meta.toLowerCase().includes('logo');
            });
            if (logoImages.length > 0) {
                console.log(`[Internal RAG] 🎯 Final Filter: Enforcing user asked for LOGO`);
                imageChunks = logoImages;
            }
        } else {
            // Priority 3: General Intent ("What is ChatRAG?") -> Default to Logo
            // If we have a Logo, hide the Person to avoid confusion
            const hasLogo = imageChunks.some(r => {
                const meta = (r.metadata?.name || '') + ' ' + (r.metadata?.image_context || '');
                return meta.toLowerCase().includes('logo');
            });

            if (hasLogo) {
                const originalCount = imageChunks.length;
                imageChunks = imageChunks.filter(r => {
                    const meta = (r.metadata?.name || '') + ' ' + (r.metadata?.image_context || '');
                    // Remove if it looks like a person/creator
                    return !['carlos', 'marcial', 'creator', 'founder', 'maker', 'author'].some(t => meta.toLowerCase().includes(t));
                });
                if (imageChunks.length < originalCount) {
                    console.log(`[Internal RAG] 🎯 Final Filter: General Query -> Defaulting to Brand (Hiding Person)`);
                }
            }
        }

        const sourceImages = imageChunks.map(r => ({
            url: r.image_url,
            name: r.metadata?.name || r.metadata?.filename || 'Source Image',
            type: r.metadata?.type || 'image/jpeg'
        }));

        if (sourceImages.length > 0) {
            console.log(`[Internal RAG] 🖼️ Found ${sourceImages.length} source images`);
        }

        return NextResponse.json({
            results: finalResults,
            source_images: sourceImages,
            debug_info: (process.env.NODE_ENV === 'development' || query.includes('debug')) ? {
                cleanQuery,
                keywords,
                searchKeywords: searchKeywords || []
            } : undefined
        });

    } catch (error: any) {
        console.error('[Internal RAG] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
