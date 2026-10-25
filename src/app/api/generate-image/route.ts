import { NextRequest, NextResponse } from 'next/server';
import { getQueryEmbedding } from '@/lib/document-processor';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { fal } from '@fal-ai/client';
import Replicate from 'replicate';

// Get provider configuration
const IMAGE_GENERATION_PROVIDER = process.env.IMAGE_GENERATION_PROVIDER || 'fal';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FAL_API_KEY = process.env.FAL_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Backward compatibility flags
const USE_OPENAI_IMAGE = process.env.USE_OPENAI_IMAGE === 'true';
const USE_REPLICATE_PROVIDER = process.env.USE_REPLICATE_PROVIDER === 'true';

// Determine actual provider based on configuration
function getActiveProvider(): string {
  // Check backward compatibility flags first
  if (USE_OPENAI_IMAGE) return 'openai';
  if (USE_REPLICATE_PROVIDER) return 'replicate';

  // Use the new provider variable (defaults to fal)
  return IMAGE_GENERATION_PROVIDER;
}

// OpenAI configuration for GPT-Image-1
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'auto';
const OPENAI_IMAGE_BACKGROUND = process.env.OPENAI_IMAGE_BACKGROUND || 'opaque';
const OPENAI_IMAGE_FORMAT = process.env.OPENAI_IMAGE_FORMAT || 'png';
const OPENAI_IMAGE_MODERATION = process.env.OPENAI_IMAGE_MODERATION || 'auto';

// Initialize clients based on available API keys
const openaiClient = OPENAI_API_KEY ? new OpenAI({
  apiKey: OPENAI_API_KEY,
}) : null;

// Configure Fal.ai client if API key is available
if (FAL_API_KEY) {
  fal.config({ credentials: FAL_API_KEY });
}

// Initialize Replicate client
const replicateClient = REPLICATE_API_TOKEN ? new Replicate({ auth: REPLICATE_API_TOKEN }) : null;

// Log provider configuration
const activeProvider = getActiveProvider();
console.log(`Image generation provider: ${activeProvider}`);

// Initialize Supabase admin client for storage operations
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

// Storage bucket for generated images
const STORAGE_BUCKET = 'chat-images';

// Model configuration from environment variables
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const FAL_IMAGE_MODEL = process.env.FAL_IMAGE_MODEL || 'fal-ai/nano-banana';
const REPLICATE_IMAGE_MODEL = process.env.REPLICATE_IMAGE_MODEL || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';

// Fal.ai models (fallback for image-to-image if not configured)
const FAL_TEXT_TO_IMAGE_MODEL = FAL_IMAGE_MODEL;
const FAL_IMAGE_TO_IMAGE_MODEL = process.env.FAL_IMAGE_TO_IMAGE_MODEL || 'fal-ai/nano-banana/edit';

// Replicate models (fallback for image-to-image if not configured)
const REPLICATE_TEXT_TO_IMAGE_MODEL = REPLICATE_IMAGE_MODEL;
const REPLICATE_IMAGE_TO_IMAGE_MODEL = process.env.REPLICATE_IMAGE_TO_IMAGE_MODEL || 'stability-ai/stable-diffusion:ac732df83cea7fff18b8472768c88ad041fa750ff7682a21affe81863cbe77e4';

export async function POST(req: NextRequest) {
  try {
    console.log('=== Image Generation Request ===');

    // Check if this is a multipart request with a file
    const contentType = req.headers.get('content-type') || '';
    let prompt = '', size = "1024x1024", aspectRatio = "1:1", numOutputs = 1, useContext = false, documentContent = '';
    let quality: string | undefined;
    let style: string | undefined;
    let background: string | undefined;
    let outputFormat: string | undefined;
    let compression: number | undefined;
    let moderation: string | undefined;
    let responseFormat: string | undefined;
    const sourceImages: File[] = [];
    let sourceImageUrl: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data with file upload
      const formData = await req.formData();
      prompt = formData.get('prompt') as string || '';
      aspectRatio = formData.get('aspectRatio') as string || '1:1';
      size = formData.get('size') as string || aspectRatio; // Backward compatibility
      numOutputs = parseInt(formData.get('numOutputs') as string || '1', 10);
      useContext = formData.get('useContext') === 'true';

      // Get optional parameters
      quality = formData.get('quality') as string || undefined;
      style = formData.get('style') as string || undefined;
      background = formData.get('background') as string || undefined;
      outputFormat = formData.get('outputFormat') as string || 'jpeg'; // Default to jpeg for FAL
      compression = formData.get('compression') ? parseInt(formData.get('compression') as string) : undefined;
      moderation = formData.get('moderation') as string || undefined;
      responseFormat = formData.get('responseFormat') as string || undefined;

      // Debug: Log all FormData keys to see what we're receiving
      console.log('FormData keys received:', Array.from(formData.keys()));

      // Handle source images (multiple for gpt-image-1)
      let imageIndex = 0;
      while (formData.has(`sourceImage${imageIndex}`)) {
        const img = formData.get(`sourceImage${imageIndex}`) as File;
        console.log(`Found sourceImage${imageIndex}:`, img?.name, img?.size, 'bytes');
        if (img) sourceImages.push(img);
        imageIndex++;
      }

      // Also check for single sourceImage for backward compatibility
      const singleImage = formData.get('sourceImage') as File;
      if (singleImage && sourceImages.length === 0) {
        console.log('Found single sourceImage (backward compatibility):', singleImage.name, singleImage.size, 'bytes');
        sourceImages.push(singleImage);
      }

      console.log('Received form data with', sourceImages.length, 'source images');
    } else {
      // Handle regular JSON request
      const jsonData = await req.json();
      prompt = jsonData.prompt;
      aspectRatio = jsonData.aspectRatio || '1:1';
      size = jsonData.size || aspectRatio; // Backward compatibility
      numOutputs = jsonData.numOutputs || 1;
      useContext = jsonData.useContext || false;
      documentContent = jsonData.documentContent || '';

      // Get optional parameters
      quality = jsonData.quality;
      style = jsonData.style;
      background = jsonData.background;
      outputFormat = jsonData.outputFormat || 'jpeg'; // Default to jpeg for FAL
      compression = jsonData.compression;
      moderation = jsonData.moderation;
      responseFormat = jsonData.responseFormat;

      // Handle direct sourceImageUrl from chat flow
      if (jsonData.sourceImageUrl) {
        console.log('Received sourceImageUrl directly:', jsonData.sourceImageUrl?.substring(0, 50) + '...');
        sourceImageUrl = jsonData.sourceImageUrl;
      }
    }

    console.log('Received prompt:', prompt);
    console.log('Aspect Ratio:', aspectRatio);
    console.log('Output Format:', outputFormat);
    console.log('Size (legacy):', size);
    console.log('Use document context:', useContext);
    console.log('Number of outputs:', numOutputs);
    console.log('Active provider:', activeProvider);
    if (quality) console.log('Quality:', quality);
    if (style) console.log('Style:', style);
    if (sourceImages.length > 0) console.log('Source images:', sourceImages.length);

    // Require prompt OR source images (allow image editing with no prompt)
    if (!prompt && sourceImages.length === 0 && !sourceImageUrl) {
      return NextResponse.json(
        { error: 'Either prompt or source images are required' },
        { status: 400 }
      );
    }

    // Verify API key is available for the selected provider
    if (activeProvider === 'openai' && !OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured. Please check server environment variables.' },
        { status: 500 }
      );
    }

    if (activeProvider === 'fal' && !FAL_API_KEY) {
      return NextResponse.json(
        { error: 'FAL_API_KEY is not configured. Please check server environment variables.' },
        { status: 500 }
      );
    }

    if (activeProvider === 'replicate' && !REPLICATE_API_TOKEN) {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN is not configured. Please check server environment variables.' },
        { status: 500 }
      );
    }

    // If we have source images, upload them to Supabase first to get URLs
    const sourceImageUrls: string[] = [];
    if (sourceImages.length > 0) {
      try {
        console.log('Uploading', sourceImages.length, 'source images to Supabase...');

        for (const [index, sourceImage] of sourceImages.entries()) {
          if (sourceImage && sourceImage instanceof Blob) {
            // Generate a unique filename
            const sourceFilename = `source/${uuidv4()}.${sourceImage.type.split('/')[1] || 'png'}`;

            // Upload to Supabase Storage
            const { data, error } = await supabaseAdmin.storage
              .from(STORAGE_BUCKET)
              .upload(sourceFilename, sourceImage, {
                contentType: sourceImage.type,
                cacheControl: '31536000' // Cache for 1 year
              });

            if (error) {
              console.error('Error uploading source image', index, 'to Supabase:', error);
              throw error;
            }

            // Get the public URL
            const { data: urlData } = supabaseAdmin.storage
              .from(STORAGE_BUCKET)
              .getPublicUrl(sourceFilename);

            sourceImageUrls.push(urlData.publicUrl);
            console.log('Source image', index, 'uploaded to:', urlData.publicUrl);
          }
        }

        // For backward compatibility, set sourceImageUrl to the first image
        if (sourceImageUrls.length > 0) {
          sourceImageUrl = sourceImageUrls[0];
        }
      } catch (error) {
        console.error('Failed to upload source images:', error);
        return NextResponse.json({ error: 'Failed to upload source images' }, { status: 500 });
      }
    } else if (sourceImageUrl) {
      // If sourceImageUrl is provided directly (from chat flow)
      console.log('Using provided sourceImageUrl for image-to-image generation');
      sourceImageUrls.push(sourceImageUrl);
    } else {
      // No source images provided
      console.log('No source images provided');
    }

    // Build the final prompt based on whether to use document context
    let finalPrompt = prompt || '';

    console.log('=== RAG Context Check ===');
    console.log('useContext flag:', useContext);
    console.log('prompt exists:', !!prompt);
    console.log('Will use RAG:', useContext && prompt);

    if (useContext && prompt) {
      try {
        console.log('🔍 RAG: Retrieving document context from vector database');
        console.log('🔍 RAG: Query prompt:', prompt);

        // Generate embedding for the prompt to find relevant chunks
        const queryEmbedding = await getQueryEmbedding(prompt);
        console.log('🔍 RAG: Generated prompt embedding for vector search');

        // Use supabaseAdmin directly to bypass RLS (like video generation does)
        // The searchSimilarChunks wrapper uses browser client which has no session context
        const { data: similarChunks, error: ragError } = await supabaseAdmin.rpc('match_document_chunks', {
          query_embedding: queryEmbedding,
          similarity_threshold: 0.3,
          match_count: 10
        });

        if (ragError) {
          console.error('🔍 RAG: Error querying chunks:', ragError);
        }
        console.log('🔍 RAG: Found similar chunks:', similarChunks?.length || 0);

        if (similarChunks && similarChunks.length > 0) {
          // Log chunk details for debugging
          similarChunks.forEach((chunk, idx) => {
            console.log(`🔍 RAG: Chunk ${idx} - similarity: ${chunk.similarity?.toFixed(3)}, content preview: ${chunk.content?.substring(0, 100)}...`);
          });

          // Prepare context from retrieved chunks
          let contextText = '';

          // Group chunks by document for better organization (like in chat API)
          const chunksByDocument = similarChunks.reduce((acc: any, chunk) => {
            if (!acc[chunk.document_id]) {
              acc[chunk.document_id] = [];
            }
            acc[chunk.document_id].push(chunk);
            return acc;
          }, {});

          // Add chunks grouped by document
          for (const chunks of Object.values(chunksByDocument)) {
            const sortedChunks = (chunks as any[])
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 3); // Take top 3 chunks per document for image generation

            contextText += sortedChunks
              .map(chunk => chunk.content.trim())
              .filter(content => content.length > 0)
              .join('\n---\n');
            contextText += '\n\n';
          }

          // Truncate if necessary to avoid exceeding token limits
          // Increased limit to capture more content including pricing info
          const truncatedContext = contextText.slice(0, 4000);
          console.log('🔍 RAG: Truncated context length:', truncatedContext.length);
          console.log('🔍 RAG: Context preview:', truncatedContext.substring(0, 500) + '...');

          // Build final prompt with context - emphasize using exact data
          finalPrompt = `IMPORTANT: Use the exact information from this document context when creating the image. Include actual product names, prices, and features mentioned below:

---
Document Context:
${truncatedContext}
---

Now create this image: ${prompt}

Remember: Use the exact prices, product names, and details from the context above - do not make up numbers.`;

          console.log('✅ RAG: Successfully augmented prompt with document context');
          console.log('✅ RAG: Final prompt length:', finalPrompt.length);
        } else {
          console.log('⚠️ RAG: No relevant document chunks found for context');
        }
      } catch (error) {
        console.error('❌ RAG: Error retrieving document context:', error);
        // Fallback to prompt without context if error occurs
      }
    } else {
      console.log('⚠️ RAG: Skipping RAG - useContext:', useContext, 'prompt:', !!prompt);
    }

    // For image editing without prompt, use a default prompt
    if (!finalPrompt && sourceImages.length > 0) {
      finalPrompt = 'Edit this image as requested';
    }

    // Generate images based on the active provider
    let generatedUrls: string[] = [];

    if (activeProvider === 'openai') {
      // OpenAI generation logic (existing code)
      if (!openaiClient) {
        return NextResponse.json({ error: 'OpenAI client not configured' }, { status: 500 });
      }

      console.log('Using OpenAI gpt-image-1 for image generation');
      console.log('Prompt:', finalPrompt.substring(0, 100) + '...');

      // Use provided size or default, with validation for OpenAI
      let openaiSize = size;

      // Map invalid sizes to valid OpenAI sizes
      const validOpenAISizes = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
      if (!validOpenAISizes.includes(openaiSize)) {
        console.log(`Invalid size '${openaiSize}' detected, mapping to valid OpenAI size`);

        // Map common aspect ratios to valid sizes
        switch (openaiSize) {
          case '1:1':
          case 'square':
            openaiSize = '1024x1024';
            break;
          case '16:9':
          case 'landscape':
            openaiSize = '1536x1024';
            break;
          case '9:16':
          case 'portrait':
            openaiSize = '1024x1536';
            break;
          default:
            openaiSize = 'auto';
            break;
        }
        console.log(`Mapped to: ${openaiSize}`);
      }

      // Use the provided background setting or environment default
      const finalBackground = background || OPENAI_IMAGE_BACKGROUND;

      try {
        const openaiParams: any = {
          model: OPENAI_IMAGE_MODEL,
          prompt: finalPrompt,
          n: numOutputs,
          size: openaiSize
        };

        // GPT-Image-1 specific parameters
        if (quality && ['auto', 'high', 'medium', 'low'].includes(quality)) {
          openaiParams.quality = quality;
        } else if (OPENAI_IMAGE_QUALITY !== 'auto') {
          openaiParams.quality = OPENAI_IMAGE_QUALITY;
        }

        if (finalBackground !== 'auto') {
          openaiParams.background = finalBackground;
        }

        if (outputFormat && ['png', 'jpeg', 'webp'].includes(outputFormat)) {
          openaiParams.output_format = outputFormat;
        } else if (OPENAI_IMAGE_FORMAT !== 'png') {
          openaiParams.output_format = OPENAI_IMAGE_FORMAT;
        }

        if (compression !== undefined && (outputFormat === 'jpeg' || outputFormat === 'webp')) {
          openaiParams.output_compression = compression;
        }

        if (moderation && ['auto', 'low'].includes(moderation)) {
          openaiParams.moderation = moderation;
        } else if (OPENAI_IMAGE_MODERATION !== 'auto') {
          openaiParams.moderation = OPENAI_IMAGE_MODERATION;
        }

        let openaiResponse;

        // Handle image editing if source images are provided
        if (sourceImageUrls.length > 0) {
          console.log('Using image editing with', sourceImageUrls.length, 'source images');

          // For OpenAI SDK, we need to pass File or Blob objects
          const sourceImageFiles: File[] = [];

          for (const [idx, imageUrl] of sourceImageUrls.entries()) {
            const response = await fetch(imageUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch source image ${idx}: ${response.status}`);
            }
            const blob = await response.blob();
            const file = new File([blob], `source-${idx}.png`, { type: blob.type });
            sourceImageFiles.push(file);
          }

          if (sourceImageFiles.length > 1) {
            // GPT-Image-1 supports multiple images in edit mode
            // Build form data for direct API call
            const formData = new FormData();
            sourceImageFiles.forEach((file, idx) => {
              formData.append(`image[]`, file);
            });
            formData.append('prompt', finalPrompt);
            formData.append('model', OPENAI_IMAGE_MODEL);
            formData.append('n', numOutputs.toString());
            formData.append('size', openaiSize);

            // Add optional parameters
            if (openaiParams.quality) formData.append('quality', openaiParams.quality);
            if (openaiParams.background) formData.append('background', openaiParams.background);
            if (openaiParams.output_format) formData.append('output_format', openaiParams.output_format);
            if (openaiParams.output_compression) formData.append('output_compression', openaiParams.output_compression.toString());
            if (openaiParams.moderation) formData.append('moderation', openaiParams.moderation);

            // Direct API call for multiple images
            const apiResponse = await fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
              },
              body: formData,
            });

            if (!apiResponse.ok) {
              const errorData = await apiResponse.json();
              console.error('OpenAI API error:', errorData);
              throw new Error(`OpenAI API error: ${apiResponse.status} ${errorData.error?.message || JSON.stringify(errorData)}`);
            }

            openaiResponse = await apiResponse.json();
          } else {
            // Single image edit using SDK
            const editParams: any = {
              image: sourceImageFiles[0],
              prompt: finalPrompt,
              n: numOutputs,
              size: openaiSize as any,
              model: OPENAI_IMAGE_MODEL as any
            };

            console.log('Calling OpenAI edit with params:', {
              ...editParams,
              image: 'File object',
              prompt: editParams.prompt.substring(0, 50) + '...'
            });

            // Use the SDK for single image edit
            openaiResponse = await openaiClient.images.edit(editParams);
          }
        } else {
          // Generate new images
          openaiResponse = await openaiClient.images.generate(openaiParams);
        }

        // Process and store images
        generatedUrls = await Promise.all(
          openaiResponse.data.map(async (imageData: { b64_json?: string; url?: string }, index: number) => {
            try {
              console.log(`Processing OpenAI image ${index}...`);

              let imageBuffer: ArrayBuffer;

              // Check for either URL or b64_json in the response
              if (imageData.url) {
                const imageResponse = await fetch(imageData.url);
                if (!imageResponse.ok) {
                  throw new Error(`Failed to fetch image from OpenAI URL: ${imageResponse.status}`);
                }
                imageBuffer = await imageResponse.arrayBuffer();
              } else if (imageData.b64_json) {
                const buffer = Buffer.from(imageData.b64_json, 'base64');
                imageBuffer = buffer.buffer.slice(
                  buffer.byteOffset,
                  buffer.byteOffset + buffer.byteLength
                );
              } else {
                throw new Error('Neither URL nor base64 data found in OpenAI response');
              }

              // Create a blob and upload to Supabase
              const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
              const filename = `generated/${uuidv4()}.png`;

              const { data, error } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(filename, imageBlob, {
                  contentType: 'image/png',
                  cacheControl: '31536000'
                });

              if (error) {
                console.error('Error uploading to Supabase:', error);
                throw error;
              }

              const { data: urlData } = supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(filename);

              console.log('Image stored in Supabase:', urlData.publicUrl);
              return urlData.publicUrl;
            } catch (error) {
              console.error('Error storing image:', error);
              return null;
            }
          })
        );
      } catch (error: any) {
        console.error('Error generating image with OpenAI:', error);

        if (error?.code === 'moderation_blocked' || error?.status === 400) {
          return NextResponse.json({
            error: 'Your request was blocked by OpenAI\'s safety system. Please modify your prompt and try again.',
            code: 'moderation_blocked',
            details: 'The content in your request may violate OpenAI\'s usage policies. Try rephrasing your prompt or using different terms.'
          }, { status: 400 });
        }

        throw error;
      }
    } else if (activeProvider === 'fal') {
      // Fal.ai generation logic
      console.log('Using Fal.ai for image generation');

      try {
        const hasSourceImage = sourceImageUrls.length > 0;
        const falModel = hasSourceImage ? FAL_IMAGE_TO_IMAGE_MODEL : FAL_TEXT_TO_IMAGE_MODEL;

        console.log(`Using Fal.ai model: ${falModel}`);
        console.log(`Parameters: aspect_ratio=${aspectRatio}, output_format=${outputFormat}, num_images=${numOutputs}`);

        // Prepare input based on model
        let falInput: any;

        if (hasSourceImage) {
          // Check if this is a Flux model (uses different API format)
          const isFluxModel = falModel.includes('flux');

          if (isFluxModel) {
            // Flux image-to-image models use singular image_url and strength parameter
            falInput = {
              prompt: finalPrompt,
              image_url: sourceImageUrls[0], // Flux expects singular image_url
              strength: 0.85, // How much to transform (0.0 = identical, 1.0 = completely new)
              num_inference_steps: 28,
              guidance_scale: 3.5,
              num_images: numOutputs,
              output_format: outputFormat || 'jpeg',
              enable_safety_checker: true,
            };
            console.log('Using Flux image-to-image format with strength:', falInput.strength);
          } else {
            // For nano-banana/edit model - use image_urls array format
            falInput = {
              prompt: finalPrompt,
              image_urls: sourceImageUrls, // nano-banana/edit accepts multiple images
              num_images: numOutputs,
              output_format: outputFormat,
              aspect_ratio: aspectRatio,
            };
          }
        } else {
          // For text-to-image generation
          const isFluxModel = falModel.includes('flux');

          if (isFluxModel) {
            // Flux text-to-image format
            falInput = {
              prompt: finalPrompt,
              num_images: numOutputs,
              output_format: outputFormat || 'jpeg',
              image_size: aspectRatio === '16:9' ? 'landscape_16_9' :
                aspectRatio === '9:16' ? 'portrait_16_9' :
                  aspectRatio === '4:3' ? 'landscape_4_3' :
                    aspectRatio === '3:4' ? 'portrait_4_3' : 'square',
              num_inference_steps: 28,
              guidance_scale: 3.5,
              enable_safety_checker: true,
            };
          } else {
            // For nano-banana text-to-image model
            falInput = {
              prompt: finalPrompt,
              num_images: numOutputs,
              output_format: outputFormat,
              aspect_ratio: aspectRatio,
            };
          }
        }

        // Use fal.subscribe for nano-banana models with streaming support
        console.log('Subscribing to Fal.ai with input:', { ...falInput, prompt: falInput.prompt?.substring(0, 50) + '...' });
        const result = await fal.subscribe(falModel, {
          input: falInput,
          logs: true,
          onQueueUpdate: (update) => {
            if (update.status === "IN_PROGRESS") {
              update.logs?.map((log) => log.message).forEach((msg) => console.log('[Fal.ai]', msg));
            }
          },
        });

        console.log('Fal.ai generation complete');

        // Handle nano-banana response format
        const images = result.data?.images || (result.data?.image ? [result.data] : [result.data]);

        // Process and store images
        generatedUrls = await Promise.all(
          images.slice(0, numOutputs).map(async (imageData: any, index: number) => {
            try {
              // Handle nano-banana response format (direct URL or object with url/image property)
              const imageUrl = imageData?.url || imageData?.image?.url || imageData?.image || imageData;
              console.log(`Processing Fal.ai image ${index}: ${imageUrl}`);

              const imageResponse = await fetch(imageUrl);
              if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image from Fal.ai: ${imageResponse.status}`);
              }

              const imageBuffer = await imageResponse.arrayBuffer();
              const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
              const filename = `generated/${uuidv4()}.png`;

              const { data, error } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(filename, imageBlob, {
                  contentType: 'image/png',
                  cacheControl: '31536000'
                });

              if (error) {
                console.error('Error uploading to Supabase:', error);
                throw error;
              }

              const { data: urlData } = supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(filename);

              console.log('Image stored in Supabase:', urlData.publicUrl);
              return urlData.publicUrl;
            } catch (error) {
              console.error('Error storing Fal.ai image:', error);
              return null;
            }
          })
        );
      } catch (error) {
        console.error('Error generating image with Fal.ai:', error);
        throw error;
      }
    } else if (activeProvider === 'replicate') {
      // Replicate generation logic
      if (!replicateClient) {
        return NextResponse.json({ error: 'Replicate client not configured' }, { status: 500 });
      }

      console.log('Using Replicate for image generation');

      try {
        const hasSourceImage = sourceImageUrls.length > 0;
        const replicateModel = hasSourceImage ? REPLICATE_IMAGE_TO_IMAGE_MODEL : REPLICATE_TEXT_TO_IMAGE_MODEL;

        console.log(`Using Replicate model: ${replicateModel}`);

        // Prepare input based on model
        const replicateInput: any = {
          prompt: finalPrompt,
          num_outputs: numOutputs,
        };

        // Add size parameters for SDXL
        if (replicateModel.includes('sdxl')) {
          const [width, height] = size.split('x').map(Number);
          replicateInput.width = width || 1024;
          replicateInput.height = height || 1024;
        }

        if (hasSourceImage) {
          replicateInput.image = sourceImageUrls[0];
          replicateInput.prompt_strength = 0.8; // How much to follow the prompt vs preserve the image
        }

        console.log('Running Replicate prediction with input:', {
          ...replicateInput,
          prompt: replicateInput.prompt?.substring(0, 50) + '...'
        });

        const output = await replicateClient.run(replicateModel as `${string}/${string}:${string}`, {
          input: replicateInput
        });

        console.log('Replicate generation complete');

        // Handle output which can be string, array, or other formats
        const images = Array.isArray(output) ? output : [output];

        // Process and store images
        generatedUrls = await Promise.all(
          images.slice(0, numOutputs).map(async (imageUrl: any, index: number) => {
            try {
              const url = typeof imageUrl === 'string' ? imageUrl : imageUrl.url;
              console.log(`Processing Replicate image ${index}: ${url}`);

              const imageResponse = await fetch(url);
              if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image from Replicate: ${imageResponse.status}`);
              }

              const imageBuffer = await imageResponse.arrayBuffer();
              const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
              const filename = `generated/${uuidv4()}.png`;

              const { data, error } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(filename, imageBlob, {
                  contentType: 'image/png',
                  cacheControl: '31536000'
                });

              if (error) {
                console.error('Error uploading to Supabase:', error);
                throw error;
              }

              const { data: urlData } = supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(filename);

              console.log('Image stored in Supabase:', urlData.publicUrl);
              return urlData.publicUrl;
            } catch (error) {
              console.error('Error storing Replicate image:', error);
              return null;
            }
          })
        );
      } catch (error) {
        console.error('Error generating image with Replicate:', error);
        throw error;
      }
    } else {
      return NextResponse.json({ error: `Unknown provider: ${activeProvider}` }, { status: 500 });
    }

    // Filter out any null URLs (failed uploads)
    const validUrls = generatedUrls.filter((url): url is string => url !== null);

    console.log('Returning response with permanent image URLs:', validUrls.length);

    // Return response with source image URL
    return NextResponse.json({
      images: validUrls,
      sourceImageUrl
    });
  } catch (error: any) {
    console.error('Error generating image:', error);

    // Check if this is a moderation error
    if (error?.code === 'moderation_blocked' || error?.status === 400) {
      return NextResponse.json({
        error: 'Your request was blocked by the safety system. Please modify your prompt and try again.',
        code: 'moderation_blocked',
        details: 'The content in your request may violate usage policies. Try rephrasing your prompt or using different terms.'
      }, { status: 400 });
    }

    // Return more specific error messages
    if (error instanceof Error) {
      return NextResponse.json({
        error: error.message || 'Error generating image',
        code: 'generation_failed'
      }, { status: 500 });
    }

    return NextResponse.json({
      error: 'An unexpected error occurred while generating the image',
      code: 'unknown_error'
    }, { status: 500 });
  }
}