import { createClient } from '@supabase/supabase-js';
import { storeDocument } from './supabase';
import { env } from './env';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import type { ChunkWithEmbedding } from './types';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { createSemanticChunks, mergeSmallChunks, type ChunkingConfig } from './semantic-chunker';
import { generateText } from 'ai';
import { openai as aiOpenai } from '@ai-sdk/openai';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const LLAMA_CLOUD_API_BASE = 'https://api.cloud.llamaindex.ai/api';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Simple embedding functions to replace the deleted embedding-optimizer
async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw error;
  }
}

async function createBatchEmbeddings(chunks: string[]): Promise<{
  embeddings: number[][];
  cost: number;
  tokensUsed: number;
  cached: boolean[];
}> {
  try {
    // Process in batches of 100 to avoid API limits
    const batchSize = 100;
    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const response = await openai.embeddings.create({
        model: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        input: batch,
      });

      for (const data of response.data) {
        allEmbeddings.push(data.embedding);
      }

      totalTokens += response.usage?.total_tokens || 0;
    }

    // Simple cost estimation (text-embedding-3-small: $0.00002 per 1K tokens)
    const cost = (totalTokens / 1000) * 0.00002;

    return {
      embeddings: allEmbeddings,
      cost,
      tokensUsed: totalTokens,
      cached: new Array(chunks.length).fill(false), // No caching in simple implementation
    };
  } catch (error) {
    console.error('Error creating batch embeddings:', error);
    throw error;
  }
}

function estimateCost(chunks: string[]): { cost: number; tokens: number } {
  // Estimate tokens (roughly 4 characters per token)
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  // text-embedding-3-small: $0.00002 per 1K tokens
  const estimatedCost = (estimatedTokens / 1000) * 0.00002;

  return {
    cost: estimatedCost,
    tokens: estimatedTokens,
  };
}

// Legacy function for backward compatibility
async function generateEmbedding(text: string): Promise<number[]> {
  return createEmbedding(text);
}

async function getQueryEmbedding(query: string): Promise<number[]> {
  return createEmbedding(query);
}

// Estimate tokens based on characters (rough approximation)
function estimateTokens(text: string): number {
  // OpenAI's tokenizer generates roughly 4 characters per token
  return Math.ceil(text.length / 4);
}

function createTokenBasedChunks(text: string, maxTokens: number = 600, overlapTokens: number = 100): string[] {
  // Check if enhanced RAG mode is enabled
  const enhancedMode = process.env.NEXT_PUBLIC_RAG_MODE === 'enhanced';

  if (enhancedMode) {
    // Use semantic chunking for enhanced mode
    console.log('[Document Processor] Using semantic chunking for enhanced RAG mode');

    const chunkingConfig: ChunkingConfig = {
      targetTokens: 500,
      maxOutputTokens: 800,
      minTokens: 200,
      overlapTokens: 100,
      preserveStructure: true,
      adaptiveSize: true,
      sentenceBoundaries: true,
      paragraphBoundaries: true,
      sectionBoundaries: true
    };

    const semanticChunks = createSemanticChunks(text, chunkingConfig);

    // Merge any chunks that are too small
    const mergedChunks = mergeSmallChunks(semanticChunks, 200);

    // Extract just the content from semantic chunks
    const chunks = mergedChunks.map(chunk => chunk.content);

    console.log(`[Document Processor] Created ${chunks.length} semantic chunks`);
    console.log(`[Document Processor] Chunk types: ${mergedChunks.map(c => c.metadata.type).join(', ')}`);
    console.log(`[Document Processor] Average density: ${(mergedChunks.reduce((sum, c) => sum + c.metadata.density, 0) / mergedChunks.length).toFixed(2)}`);

    return chunks;
  }

  // Standard chunking for normal mode
  // Split into paragraphs first
  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const paragraphTokens = estimateTokens(paragraph);

    // If adding this paragraph would exceed max tokens, create a new chunk
    if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));

      // Keep paragraphs for overlap based on token count
      const overlapChunk: string[] = [];
      let overlapTokenCount = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const overlapParagraph = currentChunk[j];
        const overlapParagraphTokens = estimateTokens(overlapParagraph);
        if (overlapTokenCount + overlapParagraphTokens <= overlapTokens) {
          overlapChunk.unshift(overlapParagraph);
          overlapTokenCount += overlapParagraphTokens;
        } else {
          break;
        }
      }
      currentChunk = overlapChunk;
      currentTokens = overlapTokenCount;
    }

    currentChunk.push(paragraph);
    currentTokens += paragraphTokens;
  }

  // Add the last chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

async function uploadAndParseDocument(filePath: string): Promise<{ chunks: string[] }> {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  // Advanced parsing configuration using new LlamaParse features
  const parse_mode = env.LLAMACLOUD_PARSE_MODE || 'parse_page_with_agent';
  const model = env.LLAMACLOUD_PARSE_MODEL || 'openai-gpt-4-1-mini';

  // Add parsing mode as form data field
  formData.append('parse_mode', parse_mode);

  // Only add model parameter for parse_page_with_agent mode
  if (parse_mode === 'parse_page_with_agent') {
    formData.append('model', model);
  }

  // Add advanced parsing features
  formData.append('high_res_ocr', env.LLAMACLOUD_HIGH_RES_OCR === 'true' ? 'true' : 'false');
  formData.append('adaptive_long_table', env.LLAMACLOUD_ADAPTIVE_LONG_TABLE === 'true' ? 'true' : 'false');
  formData.append('outlined_table_extraction', env.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION === 'true' ? 'true' : 'false');
  formData.append('output_tables_as_HTML', env.LLAMACLOUD_OUTPUT_TABLES_AS_HTML === 'true' ? 'true' : 'false');

  // Chunking configuration
  const parsing_config = {
    chunk_size: parseInt(env.LLAMACLOUD_CHUNK_SIZE),
    chunk_overlap: parseInt(env.LLAMACLOUD_CHUNK_OVERLAP),
    chunk_strategy: env.LLAMACLOUD_CHUNK_STRATEGY,
    include_chunks: true,
    include_metadata: true,
    include_images: env.LLAMACLOUD_MULTIMODAL_PARSING === 'true',
  };

  const output_config = {
    result_type: "markdown",
    language: "en"
  };

  formData.append('parsing_config', JSON.stringify(parsing_config));
  formData.append('output_config', JSON.stringify(output_config));

  if (parse_mode === 'parse_page_with_agent') {
    console.log(`Using advanced parsing mode: ${parse_mode} with model: ${model}`);
  } else {
    console.log(`Using parsing mode: ${parse_mode} (no model required)`);
  }
  console.log(`Features enabled: high_res_ocr=${env.LLAMACLOUD_HIGH_RES_OCR}, adaptive_long_table=${env.LLAMACLOUD_ADAPTIVE_LONG_TABLE}, outlined_table_extraction=${env.LLAMACLOUD_OUTLINED_TABLE_EXTRACTION}`);

  const uploadResponse = await fetch('https://api.cloud.llamaindex.ai/api/v1/parsing/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.LLAMA_CLOUD_API_KEY}`
    },
    body: formData
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
  }

  const uploadResult = await uploadResponse.json();
  console.log('Upload response:', uploadResult);

  if (!uploadResult.id) {
    throw new Error('No job ID in upload response');
  }

  const jobId = uploadResult.id;
  console.log('Job ID:', jobId);

  // Poll for job completion
  let attempts = 0;
  const maxAttempts = 60; // Maximum 60 attempts (5 minutes with 5 second intervals)

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before checking
    attempts++;

    const statusResponse = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${env.LLAMA_CLOUD_API_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!statusResponse.ok) {
      throw new Error(`Status check failed: ${statusResponse.status} ${statusResponse.statusText}`);
    }

    const statusResult = await statusResponse.json();
    console.log(`Job status (attempt ${attempts}/${maxAttempts}):`, statusResult.status);

    if (statusResult.status === 'SUCCESS') {
      console.log('Job completed successfully');
      break;
    } else if (statusResult.status === 'FAILED') {
      throw new Error('Job failed');
    } else if (statusResult.status === 'PENDING' || statusResult.status === 'PROCESSING') {
      continue;
    } else {
      console.log('Unknown status:', statusResult.status);
      throw new Error(`Unknown job status: ${statusResult.status}`);
    }
  }

  if (attempts >= maxAttempts) {
    throw new Error('Job timed out after 5 minutes');
  }

  // Get the results
  const resultResponse = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}/result/markdown`, {
    headers: {
      'Authorization': `Bearer ${env.LLAMA_CLOUD_API_KEY}`,
      'Accept': 'application/json'
    }
  });

  if (!resultResponse.ok) {
    throw new Error(`Failed to get results: ${resultResponse.status} ${resultResponse.statusText}`);
  }

  const resultData = await resultResponse.json();
  console.log('Received response:', {
    type: typeof resultData,
    hasMarkdown: 'markdown' in resultData,
    hasChunks: 'chunks' in resultData,
    length: resultData.markdown?.length || 0,
    numChunks: resultData.chunks?.length || 0
  });

  if (!resultData.chunks || !Array.isArray(resultData.chunks)) {
    console.log('No chunks in response, falling back to markdown content');
    const text = resultData.markdown;
    if (!text) {
      throw new Error('No markdown content in response');
    }

    // Use token-based chunks instead of simple paragraph chunks
    const chunks = createTokenBasedChunks(text);
    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks created from markdown content');
    }

    // Log chunk statistics
    const chunkStats = chunks.map(chunk => ({
      length: chunk.length,
      estimatedTokens: estimateTokens(chunk)
    }));

    console.log('Chunk statistics:', {
      totalChunks: chunks.length,
      averageTokens: Math.round(chunkStats.reduce((sum, stat) => sum + stat.estimatedTokens, 0) / chunks.length),
      minTokens: Math.min(...chunkStats.map(stat => stat.estimatedTokens)),
      maxOutputTokens: Math.max(...chunkStats.map(stat => stat.estimatedTokens))
    });

    return { chunks };
  }

  console.log(`Received ${resultData.chunks.length} chunks from LlamaParse`);
  return { chunks: resultData.chunks };
}

async function processChunksInBatches(chunks: string[], batchSize: number = 100): Promise<ChunkWithEmbedding[]> {
  console.log(`Starting to process ${chunks.length} chunks...`);
  const validChunks = chunks.filter(chunk => chunk.trim().length > 0);
  console.log(`Found ${validChunks.length} valid chunks after filtering`);

  if (validChunks.length === 0) {
    return [];
  }

  // Estimate cost before processing
  const costEstimate = estimateCost(validChunks);
  console.log(`Estimated embedding cost: $${costEstimate.cost.toFixed(6)} for ${costEstimate.tokens} tokens`);

  // Process all chunks in optimized batches
  console.log('Processing chunks with optimized batch embeddings...');
  const startTime = Date.now();

  const batchResult = await createBatchEmbeddings(validChunks);

  const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Embedding generation completed in ${elapsedTime}s`);
  console.log(`Actual cost: $${batchResult.cost.toFixed(6)} for ${batchResult.tokensUsed} tokens`);
  console.log(`Cache hit rate: ${batchResult.cached.filter(c => c).length}/${validChunks.length}`);

  // Convert to ChunkWithEmbedding format
  const results: ChunkWithEmbedding[] = validChunks.map((content, index) => ({
    content,
    embedding: batchResult.embeddings[index],
  }));

  console.log('Finished processing all chunks');
  return results;
}

/**
 * Metadata for document processing
 */
interface ProcessDocumentMetadata {
  user_id: string;
  organization_id?: string | null;
  source?: 'upload' | 'api' | 'scrape';
  source_provider?: string;
  source_file_id?: string;
  source_connection_id?: string;
  image_url?: string;
  image_type?: string;
  image_context?: string;
  [key: string]: any;
}

async function processDocument(
  filename: string,
  buffer: Buffer,
  metadata: ProcessDocumentMetadata
): Promise<string> {
  console.log(`Processing document: ${filename}`);

  try {
    // Create a temporary file to store the buffer
    const tempDir = path.join(os.tmpdir(), 'chatrag');
    await mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, filename);
    await writeFile(tempFilePath, buffer);

    let chunks: string[];

    // Optimize: If the file is already Markdown, process locally without LlamaCloud
    if (filename.toLowerCase().endsWith('.md')) {
      console.log('File is already Markdown, skipping LlamaCloud parsing...');
      const text = buffer.toString('utf-8');
      chunks = createTokenBasedChunks(text);
      console.log(`Created ${chunks.length} chunks locally`);
    } else {
      // Upload and parse the document with LlamaCloud REST API
      console.log('Started uploading and processing the file with LlamaCloud');
      const result = await uploadAndParseDocument(tempFilePath);
      chunks = result.chunks;
    }

    // Clean up temp file
    await unlink(tempFilePath);

    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks returned from LlamaParse');
    }

    console.log(`Received ${chunks.length} chunks from LlamaCloud`);
    console.log('Sample chunk:', chunks[0].substring(0, 200) + '...');

    // Process chunks and generate embeddings
    const processedChunks = await processChunksInBatches(chunks);
    console.log(`Successfully processed ${processedChunks.length} chunks with embeddings`);

    // Store document chunks in Supabase with user_id and metadata
    const documentId = await storeDocument(filename, chunks.join('\n\n'), processedChunks, {
      ...metadata,
      user_id: metadata.user_id,
      organization_id: metadata.organization_id || null,
      source: metadata.source || 'upload',
      source_provider: metadata.source_provider,
      source_file_id: metadata.source_file_id,
      source_connection_id: metadata.source_connection_id,
    });
    console.log(`Stored document with ID: ${documentId}`);

    return documentId;
  } catch (error) {
    console.error('Error processing document:', error);
    throw error;
  }
}

async function processImageDocument(
  filename: string,
  buffer: Buffer,
  metadata: ProcessDocumentMetadata
): Promise<string> {
  console.log(`Processing image document: ${filename}`);

  try {
    // Generate description using Vision LLM
    console.log('Generating image description with Vision LLM...');

    // Convert buffer to base64 for the API
    const base64Image = buffer.toString('base64');
    const mimeType = filename.toLowerCase().endsWith('.png') ? 'image/png' :
      filename.toLowerCase().endsWith('.webp') ? 'image/webp' :
        filename.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg';

    const { text: description } = await generateText({
      model: aiOpenai('gpt-4o'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image in extreme detail to allow for future search retrieval. Include text found in the image, visual elements, colors, and context. If it is a chart or graph, describe the data points and trends.' },
            { type: 'image', image: `data:${mimeType};base64,${base64Image}` }
          ]
        }
      ]
    });

    console.log('Generated description length:', description.length);
    console.log('Sample description:', description.substring(0, 100) + '...');

    // Process the description as a document chunk
    const chunks = [description];

    // Process chunks and generate embeddings
    const processedChunks = await processChunksInBatches(chunks);
    console.log(`Successfully processed image description with embeddings`);

    // Store document chunks in Supabase with metadata including the image URL (if available)
    // Note: The actual image URL will be passed in the metadata from the upload route
    const documentId = await storeDocument(filename, description, processedChunks, {
      source: metadata.source || 'upload',
      source_provider: metadata.source_provider,
      source_file_id: metadata.source_file_id,
      source_connection_id: metadata.source_connection_id,
      image_type: mimeType,
      // Metadata passed from the caller should contain image_url
      ...metadata
    });
    console.log(`Stored image document with ID: ${documentId}`);

    return documentId;
  } catch (error) {
    console.error('Error processing image document:', error);
    throw error;
  }
}

export { processDocument, processImageDocument, getQueryEmbedding };
export type { ProcessDocumentMetadata };
