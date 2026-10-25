import type { ParsedDocument, DocumentChunk, ChunkWithEmbedding } from './types';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { DBMessage, ExtendedMessage } from '@/types/chat';
import { generateTitle } from './title-generator';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { logger } from './logger';
import { extractEnhancedMetadata, type EnhancedMetadata } from './temporal-metadata-extractor';
import { enrichChunkWithURLs, extractURLs } from './url-extractor';

/**
 * Supabase Connection Manager
 * Manages client initialization with singleton pattern and smart logging
 */
class SupabaseManager {
  private static instance: SupabaseManager;
  private initialized = false;
  private _supabase: any = null;
  private _supabaseAdmin: any = null;

  private constructor() {
    this.initialize();
  }

  static getInstance(): SupabaseManager {
    if (!SupabaseManager.instance) {
      SupabaseManager.instance = new SupabaseManager();
    }
    return SupabaseManager.instance;
  }

  private initialize() {
    if (this.initialized) return;

    // Check if we're in build phase
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

    // Skip initialization during build phase
    if (isBuildPhase) {
      logger.debug('Supabase', 'Skipping initialization during build phase');
      this.initialized = true;
      return;
    }

    // Validate environment variables (only at runtime)
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
    }

    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
    }

    // Log connection info only once (debug level)
    logger.debug('Supabase', 'Connection initialized');

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    // Use the existing auth client for operations instead of creating a new one
    // This ensures we use the same auth session across the entire app
    this._supabase = createBrowserClient();

    // Create a client with the service role key for admin operations (server-side only)
    this._supabaseAdmin = typeof window === 'undefined' && supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : null;

    this.initialized = true;
    logger.startup('Supabase', 'Connection manager initialized');
  }

  getClient() {
    if (!this.initialized) {
      this.initialize();
    }
    return this._supabase;
  }

  getAdminClient() {
    if (!this.initialized) {
      this.initialize();
    }
    return this._supabaseAdmin;
  }
}

// Export functions to get clients (lazy initialization)
let supabaseManager: SupabaseManager | null = null;

export function getSupabase() {
  if (!supabaseManager) {
    supabaseManager = SupabaseManager.getInstance();
  }
  return supabaseManager.getClient();
}

export function getSupabaseAdmin() {
  if (!supabaseManager) {
    supabaseManager = SupabaseManager.getInstance();
  }
  return supabaseManager.getAdminClient();
}

// For backward compatibility, export as const but only initialize when accessed
export const supabase = new Proxy({} as any, {
  get(target, prop) {
    const client = getSupabase();
    return client[prop];
  }
});

export const supabaseAdmin = new Proxy({} as any, {
  get(target, prop) {
    const client = getSupabaseAdmin();
    return client ? client[prop] : undefined;
  }
});

export type Chat = {
  id: string;
  user_id: string;
  title: string;
  messages: DBMessage[];
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  folder_id?: string;
  titlePending?: boolean; // True while AI is generating the title
};

// Simple UUID v4 generator
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Document source metadata for tracking origin
 */
interface DocumentSourceMetadata {
  user_id?: string;
  organization_id?: string | null;
  source?: 'upload' | 'nango' | 'api' | 'scrape';
  source_provider?: string;
  source_file_id?: string;
  source_connection_id?: string;
  image_url?: string;
  image_type?: string;
  [key: string]: unknown;
}

/**
 * Store a parsed document and its chunks in Supabase
 * @param filename - The name of the document file
 * @param content - The full content of the document
 * @param chunks - Array of document chunks with embeddings
 * @param metadata - Optional metadata for the document (includes source tracking)
 * @returns Promise resolving to the document ID
 */
async function storeDocument(filename: string, content: string, chunks: ChunkWithEmbedding[], metadata: DocumentSourceMetadata = {}) {
  // This function should only be called server-side
  if (typeof window !== 'undefined') {
    throw new Error('storeDocument can only be called server-side');
  }

  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin client is not available');
  }

  logger.db(`Storing document: ${filename} (${content.length} chars, ${chunks.length} chunks)`);

  const documentId = uuidv4();

  // Extract source metadata for column storage
  const { user_id, organization_id, source, source_provider, source_file_id, source_connection_id, ...restMetadata } = metadata;

  // user_id is required - throw error if not provided
  if (!user_id) {
    throw new Error('user_id is required to store a document');
  }

  // Store the document using the admin client to bypass RLS
  const { error: docError } = await supabaseAdmin
    .from('documents')
    .insert({
      id: documentId,
      filename,
      content,
      metadata: restMetadata,
      user_id: user_id,
      organization_id: organization_id || null,
      // Source tracking columns (for Nango integration)
      source: source || 'upload',
      source_provider: source_provider || null,
      source_file_id: source_file_id || null,
      source_connection_id: source_connection_id || null,
    });

  if (docError) {
    logger.error('Supabase', 'Error storing document', docError);
    throw new Error(`Error storing document: ${docError.message}`);
  }

  // Store the chunks using the admin client to bypass RLS
  const chunksToInsert = chunks.map((chunk, index) => {
    // Extract enhanced metadata for better retrieval
    const enhancedMetadata = extractEnhancedMetadata(chunk.content);

    // Extract URLs from chunk content
    const urlMetadata = extractURLs(chunk.content);

    // Create optimized content format that preserves important data
    // Remove redundant document prefix that wastes tokens
    const optimizedContent = chunk.content.trim();

    return {
      id: uuidv4(),
      document_id: documentId,
      content: optimizedContent,
      embedding: chunk.embedding,
      chunk_index: index,
      metadata: {
        ...metadata,
        document_title: filename,
        chunk_index: index,
        chunk_position: index + 1,
        total_chunks: chunks.length,

        // Enhanced metadata for better retrieval
        temporal_entities: enhancedMetadata.temporal_entities,
        financial_entities: enhancedMetadata.financial_entities,
        section_type: enhancedMetadata.section_type,
        key_terms: enhancedMetadata.key_terms,
        numerical_density: enhancedMetadata.numerical_density,
        temporal_density: enhancedMetadata.temporal_density,
        chunk_semantic_type: enhancedMetadata.chunk_semantic_type,

        // Additional indexing for search optimization
        has_temporal_data: enhancedMetadata.temporal_entities.length > 0,
        has_financial_data: enhancedMetadata.financial_entities.length > 0,
        is_high_value_chunk: enhancedMetadata.chunk_semantic_type === 'financial_data' ||
          enhancedMetadata.chunk_semantic_type === 'mixed',

        // URL metadata for link inclusion in AI responses
        urls: urlMetadata.urls,
        has_urls: urlMetadata.hasLinks,
        url_count: urlMetadata.linkCount,
        url_categories: [...new Set(urlMetadata.urls.map(u => u.category))],
      },
    };
  });

  const { error: chunksError } = await supabaseAdmin
    .from('document_chunks')
    .insert(chunksToInsert);

  if (chunksError) {
    logger.error('Supabase', 'Error storing chunks', chunksError);
    // If chunks fail to store, delete the document to maintain consistency
    await supabaseAdmin
      .from('documents')
      .delete()
      .match({ id: documentId });
    throw new Error(`Error storing document chunks: ${chunksError.message}`);
  }

  logger.db(`Successfully stored document ${documentId} with ${chunks.length} chunks`);
  return documentId;
}

/**
 * Search for relevant chunks using vector similarity
 * @param queryEmbedding - The embedding vector to search against
 * @param matchCount - Number of matches to return
 * @param similarityThreshold - Minimum similarity threshold
 * @returns Promise resolving to array of matching chunks with similarity scores
 */
async function searchSimilarChunks(
  queryEmbedding: number[],
  matchCount: number = 5,
  similarityThreshold: number = 0.7
): Promise<Array<{ chunk_id: string; document_id: string; content: string; similarity: number }>> {
  logger.db(`Searching for similar chunks with threshold ${similarityThreshold}, max ${matchCount} results`);
  logger.db(`Query embedding dimensions: ${queryEmbedding.length}`);

  const { data: chunks, error } = await supabase
    .rpc('match_document_chunks', {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      similarity_threshold: similarityThreshold,
    });

  if (error) {
    logger.error('Supabase', `Error searching chunks: ${error.message}`);
    throw new Error(`Error searching chunks: ${error.message}`);
  }

  logger.db(`Found ${chunks?.length || 0} similar chunks`);
  if (chunks && chunks.length > 0) {
    logger.db(`Top chunk similarity: ${chunks[0].similarity?.toFixed(3)}`);
    logger.db(`Lowest chunk similarity: ${chunks[chunks.length - 1].similarity?.toFixed(3)}`);
  }

  return chunks || [];
}

export async function createChat(messages: DBMessage[]): Promise<string | null> {
  try {
    logger.warn('Supabase', 'OLD createChat called - this should not happen after our fix!');
    // Generate a title that prioritizes AI content if available
    const title = generateTitle(messages);

    // First check user authentication
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      logger.error('Supabase', 'Auth session error when creating chat', sessionError);
      throw sessionError;
    }

    if (!session) {
      logger.error('Supabase', 'No authenticated session when creating chat');
      throw new Error('Not authenticated');
    }

    logger.db(`Creating chat for user: ${session.user.id}`);

    const { data, error } = await supabase
      .from('chats')
      .insert([
        {
          messages,
          title,
          created_at: new Date().toISOString(),
          user_id: session.user.id,
        }
      ])
      .select('id')
      .single();

    if (error) {
      logger.error('Supabase', 'Error creating chat', error);
      throw error;
    }

    logger.db(`Chat created successfully with ID: ${data?.id}`);
    return data?.id || null;
  } catch (error) {
    logger.error('Supabase', 'Error creating chat', error);
    return null;
  }
}

export async function updateChat(chatId: string, messages: DBMessage[]): Promise<boolean> {
  try {
    logger.warn('Supabase', 'OLD updateChat called - this should not happen after our fix!');
    // Generate a title that prioritizes AI content if available
    const title = generateTitle(messages);

    const { error } = await supabase
      .from('chats')
      .update({
        messages,
        title,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId);

    if (error) {
      logger.error('Supabase', 'Error updating chat', error);
      throw error;
    }

    logger.db(`Chat ${chatId} updated successfully`);
    return true;
  } catch (error) {
    logger.error('Supabase', 'Error updating chat', error);
    return false;
  }
}

export { storeDocument, searchSimilarChunks };
