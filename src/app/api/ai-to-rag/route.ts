import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getQueryEmbedding } from '@/lib/document-processor';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/lib/env';
import OpenAI from 'openai';

// Initialize Supabase admin client
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Initialize OpenAI client for title generation
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Token-based chunking utilities (reuse from process-document)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function createTokenBasedChunks(text: string, maxTokens: number = 600, overlapTokens: number = 100): string[] {
  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const paragraphTokens = estimateTokens(paragraph);

    if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));

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

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

// Generate a title using OpenAI
async function generateTitle(content: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that generates concise, descriptive titles for AI-generated content. The title should be 5-10 words, capturing the main topic or purpose of the content. Do not include quotes or special formatting.'
        },
        {
          role: 'user',
          content: `Generate a concise title for this AI response:\n\n${content.substring(0, 1000)}...`
        }
      ],
      max_tokens: 50,
      temperature: 0.7,
    });

    const title = response.choices[0]?.message?.content?.trim() || 'AI Response';
    return title;
  } catch (error) {
    console.error('Error generating title:', error);
    // Fallback: Extract first sentence or use default
    const firstSentence = content.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
    return firstSentence ? firstSentence.substring(0, 50) + '...' : 'AI Response';
  }
}

// Store document and chunks in Supabase
async function storeAIResponseAsDocument(
  title: string,
  content: string,
  chunks: string[],
  metadata: {
    source: string;
    messageId: string;
    chatId?: string;
    generatedAt: string;
  },
  userId: string
) {
  const documentId = uuidv4();
  const filename = `${title} - ${new Date().toISOString().split('T')[0]}.md`;

  try {
    // Store the document
    const { data: document, error: documentError } = await supabaseAdmin
      .from('documents')
      .insert([{
        id: documentId,
        filename: filename,
        content: content,
        metadata: metadata,
        user_id: userId
      }])
      .select()
      .single();

    if (documentError) {
      console.error('Error storing document:', documentError);
      throw documentError;
    }

    // Process chunks with embeddings
    const BATCH_SIZE = 10;
    let successfulChunks = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      try {
        const embeddingResults = await Promise.allSettled(
          batch.map(chunk => getQueryEmbedding(chunk))
        );

        const chunkInserts = embeddingResults
          .map((result, index) => {
            if (result.status === 'fulfilled') {
              return {
                id: uuidv4(),
                document_id: documentId,
                content: batch[index],
                embedding: result.value
              };
            }
            console.error(`Failed to generate embedding for chunk at index ${i + index}:`,
              result.status === 'rejected' ? result.reason : 'Unknown error');
            return null;
          })
          .filter(Boolean);

        if (chunkInserts.length > 0) {
          const { error: chunkError } = await supabaseAdmin
            .from('document_chunks')
            .insert(chunkInserts);

          if (chunkError) {
            console.error(`Error storing chunk batch:`, chunkError);
          } else {
            successfulChunks += chunkInserts.length;
          }
        }
      } catch (batchError) {
        console.error(`Error processing batch:`, batchError);
      }
    }

    return {
      documentId,
      filename,
      successfulChunks,
      totalChunks: chunks.length
    };
  } catch (error) {
    console.error('Error in storeAIResponseAsDocument:', error);
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const { content, messageId, chatId, userId } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    console.log('Processing AI response for RAG:', {
      contentLength: content.length,
      messageId,
      chatId,
      userId
    });

    // Generate a title for the document
    const title = await generateTitle(content);
    console.log('Generated title:', title);

    // Create chunks from the content
    const chunks = createTokenBasedChunks(content, 600, 100);
    console.log(`Created ${chunks.length} chunks from AI response`);

    // Store the document and chunks
    const metadata = {
      source: 'ai_response',
      messageId,
      chatId,
      generatedAt: new Date().toISOString(),
    };

    const result = await storeAIResponseAsDocument(title, content, chunks, metadata, userId);
    console.log('Successfully stored AI response as document:', result);

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      filename: result.filename,
      title,
      chunksStored: result.successfulChunks,
      totalChunks: result.totalChunks
    });

  } catch (error) {
    console.error('Error processing AI response for RAG:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}