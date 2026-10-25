import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '../../../lib/env';
import { v4 as uuidv4 } from 'uuid';
import Replicate from 'replicate';
import { fal } from '@fal-ai/client';
import OpenAI from 'openai';

// Verify API keys are available
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FAL_API_KEY = process.env.FAL_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const USE_REPLICATE_PROVIDER = process.env.USE_REPLICATE_PROVIDER === 'true';

// Initialize OpenAI client for prompt rewriting
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Check if we have the necessary API keys
if (USE_REPLICATE_PROVIDER && !REPLICATE_API_TOKEN) {
  console.error('REPLICATE_API_TOKEN is not defined in environment variables but USE_REPLICATE_PROVIDER is set to true');
}

if (!USE_REPLICATE_PROVIDER && !FAL_API_KEY) {
  console.error('FAL_API_KEY is not defined in environment variables but Fal.ai is the default provider');
}

// Configure Fal.ai client if API key is available
if (FAL_API_KEY) {
  fal.config({
    credentials: FAL_API_KEY
  });
  console.log('Fal.ai client configured with API key');
}

// Initialize Replicate client if API key is available
const replicateClient = REPLICATE_API_TOKEN ? new Replicate({ auth: REPLICATE_API_TOKEN }) : null;

// Model configuration from environment variables
const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || 'fal-ai/veo3/fast';
const FAL_VIDEO_TEXT_MODEL = process.env.FAL_VIDEO_TEXT_MODEL || 'fal-ai/veo3/fast';
const FAL_VIDEO_TEXT_FAST_MODEL = process.env.FAL_VIDEO_TEXT_FAST_MODEL || 'fal-ai/veo3/fast';
const FAL_VIDEO_IMAGE_MODEL = process.env.FAL_VIDEO_IMAGE_MODEL || 'fal-ai/veo3/image-to-video';
const FAL_VIDEO_IMAGE_FAST_MODEL = process.env.FAL_VIDEO_IMAGE_FAST_MODEL || 'fal-ai/veo3/fast/image-to-video';
const REPLICATE_VIDEO_MODEL = process.env.REPLICATE_VIDEO_MODEL || 'zsxkib/animate-3d';

// Log which provider we're using
const primaryProvider = USE_REPLICATE_PROVIDER ? 'Replicate' : 'Fal.ai';
const fallbackAvailable = !USE_REPLICATE_PROVIDER && REPLICATE_API_TOKEN ? '(with Replicate fallback)' : '(no fallback)';
console.log(`Video generation provider: ${primaryProvider} ${fallbackAvailable}`);
console.log('Available video models:', {
  textStandard: FAL_VIDEO_TEXT_MODEL,
  textFast: FAL_VIDEO_TEXT_FAST_MODEL,
  imageStandard: FAL_VIDEO_IMAGE_MODEL,
  imageFast: FAL_VIDEO_IMAGE_FAST_MODEL,
  legacy: FAL_VIDEO_MODEL
});

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

// Storage bucket and folder structure
const STORAGE_BUCKET = 'chat-videos';
const VIDEOS_FOLDER = 'generated-videos';
// Use UTC date to ensure consistency across timezones and environments
const datePrefix = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format in UTC

// Model configuration map with new Veo3 models
const VIDEO_MODELS = {
  // Legacy models (for backward compatibility)
  'pro-text': FAL_VIDEO_MODEL,
  'lite-text': 'fal-ai/bytedance/seedance/v1/lite/text-to-video',
  'pro-image': 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
  'lite-image': 'fal-ai/bytedance/seedance/v1/lite/image-to-video',

  // New Veo3 models explicit keys
  'text-standard': FAL_VIDEO_TEXT_MODEL,
  'text-fast': FAL_VIDEO_TEXT_FAST_MODEL,
  'image-standard': FAL_VIDEO_IMAGE_MODEL,
  'image-fast': FAL_VIDEO_IMAGE_FAST_MODEL
};

/**
 * Select the appropriate video model based on input parameters
 */
function selectVideoModel(
  requestedModel?: string,
  hasSourceImage?: boolean,
  useFastMode?: boolean
): string {
  console.log('Selecting video model:', { requestedModel, hasSourceImage, useFastMode });

  // Normalize fast/standard pickers
  const pickImageModel = () => (useFastMode ? VIDEO_MODELS['image-fast'] : VIDEO_MODELS['image-standard']);
  const pickTextModel = () => (useFastMode ? VIDEO_MODELS['text-fast'] : VIDEO_MODELS['text-standard']);

  // If a specific model key is requested, prefer it BUT guard against mismatches.
  if (requestedModel) {
    const key = requestedModel as keyof typeof VIDEO_MODELS;

    // If a valid key was provided
    if (VIDEO_MODELS[key]) {
      const keyStr = String(requestedModel);
      const isRequestedImage = keyStr.includes('image');
      const isRequestedText = keyStr.includes('text');

      // If the user selected a text model but we actually have a source image, switch to an image model.
      if (hasSourceImage && isRequestedText) {
        const model = pickImageModel();
        console.log('Requested text model with source image present. Switching to image-to-video model:', model);
        return model;
      }

      // If the user selected an image model but no source image is provided, switch to a text model.
      if (!hasSourceImage && isRequestedImage) {
        const model = pickTextModel();
        console.log('Requested image model without a source image. Switching to text-to-video model:', model);
        return model;
      }

      // Otherwise, honor the requested model
      const selectedModel = VIDEO_MODELS[key];
      console.log('Using requested model:', selectedModel);
      return selectedModel;
    }
  }

  // Auto-select based on input type and performance preference
  if (hasSourceImage) {
    const model = pickImageModel();
    console.log('Auto-selected image-to-video model:', model);
    return model;
  } else {
    const model = pickTextModel();
    console.log('Auto-selected text-to-video model:', model);
    return model;
  }
}

// Function to ensure a folder exists in Supabase storage
async function ensureFolderExists(folderPath: string): Promise<boolean> {
  try {
    console.log(`Ensuring folder exists in storage: ${folderPath}`);
    // Supabase doesn't have explicit folder creation, but we can create a placeholder file
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(`${folderPath}/.placeholder`, new Blob([''], { type: 'text/plain' }), {
        upsert: true
      });

    if (error && error.message !== 'The resource already exists') {
      console.error(`Error creating folder: ${error.message}`);
      // Don't throw error, just log it - this makes the function more resilient in production
      return false;
    }

    console.log(`Folder ready: ${folderPath}`);
    return true;
  } catch (error: any) {
    console.error(`Failed to ensure folder exists: ${error.message || error}`);
    // Don't throw error, just log it and return false
    return false;
  }
}

// Try to create the storage bucket if it doesn't exist
(async () => {
  try {
    // Only execute this in development environment (NOT on Vercel)
    if (process.env.NODE_ENV === 'development') {
      // Check if the bucket exists
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const bucketExists = buckets?.some(bucket => bucket.name === STORAGE_BUCKET);

      if (!bucketExists) {
        console.log(`Creating storage bucket: ${STORAGE_BUCKET}`);
        const { error } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
          public: true,
          fileSizeLimit: 52428800 // 50MB limit
        });

        if (error) {
          console.error(`Error creating storage bucket: ${error.message}`);
        } else {
          console.log(`Storage bucket created: ${STORAGE_BUCKET}`);
        }
      }

      // Create a placeholder file to ensure folder exists
      console.log(`Ensuring folder structure exists: ${VIDEOS_FOLDER}`);
      await ensureFolderExists(VIDEOS_FOLDER);
    }
  } catch (error: any) {
    console.error('Error initializing storage:', error.message || error);
  }
})();

/**
 * Retrieve relevant document context for the prompt
 */
async function getDocumentContext(prompt: string): Promise<string> {
  console.log('Getting document context for prompt:', prompt);
  try {
    // Check if embeddings module is available
    let getQueryEmbedding;
    try {
      getQueryEmbedding = require('@/lib/document-processor').getQueryEmbedding;
    } catch (error) {
      console.log('No embedding module found, skipping context retrieval');
      return '';
    }

    // Create embedding for the prompt
    const embedding = await getQueryEmbedding(prompt);

    if (!embedding) {
      console.log('No embedding created for prompt, using no context');
      return '';
    }

    // Get relevant documents from vector database
    const { data: chunks, error } = await supabaseAdmin.rpc('match_document_chunks', {
      query_embedding: embedding,
      similarity_threshold: 0.3,
      match_count: 10
    });

    if (error) {
      console.error('Error retrieving document chunks:', error);
      return '';
    }

    if (!chunks || chunks.length === 0) {
      console.log('No relevant document chunks found');
      return '';
    }

    console.log(`Found ${chunks.length} relevant chunks from documents`);

    // Combine content from chunks
    const contextText = chunks.map((chunk: { content: string }) => chunk.content).join(' ');
    return contextText;
  } catch (error) {
    console.error('Error getting document context:', error);
    return '';
  }
}

/**
 * Use LLM to rewrite the user's prompt with exact facts from RAG context.
 * This ensures video AI models have specific numbers and details directly in the prompt.
 */
async function rewritePromptWithContext(originalPrompt: string, context: string): Promise<string> {
  console.log('📝 Rewriting prompt with context using LLM...');

  if (!openai) {
    console.log('⚠️ OpenAI client not available, using basic context enhancement');
    // Fallback to basic enhancement if no OpenAI
    return `${originalPrompt}

IMPORTANT - Use these exact facts from the knowledge base:
${context}

Remember: Include the exact prices, numbers, and details mentioned above.`;
  }

  try {
    const systemPrompt = `You are a smart prompt editor for AI video generation.
The user wants to create a video and has provided relevant context from their knowledge base.
Your job is to "fill in the blanks" by injecting the EXACT facts, numbers, prices, and details from the context into the user's prompt.

Rules:
- PRESERVE the user's original wording, style, and structure as much as possible.
- Only modify the prompt to insert specific specific numbers, prices, or facts where they are missing or alluded to.
- Do NOT rewrite the entire prompt. Just enrich it with the facts.
- If the user asks to "say how much it costs", replace/augment that part with the actual price (e.g., "saying it costs $269").

Example:
Original: "Video of a woman talking about the Pro plan price and how it compares to Basic."
Context: "The Pro plan is $49 a month. Basic is $19 a month."
Rewritten: "Video of a woman talking about the Pro plan price at $49 a month and how it compares to Basic at $19 a month."`;

    const userMessage = `Original video prompt: ${originalPrompt}

Knowledge base context with accurate information:
${context}

Rewrite the prompt to naturally fill in the missing facts and numbers from the context.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3, // Low temperature for factual accuracy
      max_tokens: 1000
    });

    const rewrittenPrompt = response.choices[0]?.message?.content || originalPrompt;
    console.log('✅ LLM rewrote prompt successfully');
    console.log('📝 Original prompt:', originalPrompt.substring(0, 100) + '...');
    console.log('📝 Rewritten prompt:', rewrittenPrompt.substring(0, 200) + '...');

    return rewrittenPrompt;
  } catch (error) {
    console.error('❌ Error rewriting prompt with LLM:', error);
    // Fallback to original prompt with basic context
    return `${originalPrompt}

Use these exact details: ${context.substring(0, 500)}`;
  }
}

// Add a utility function for retrying external fetch requests
async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`External fetch attempt ${attempt + 1}/${maxRetries} to ${url}`);

      // Create an AbortController with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        // Clear the timeout since the request completed
        clearTimeout(timeoutId);

        // Check if the response is valid
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      lastError = error;
      console.warn(`Fetch attempt ${attempt + 1} failed:`, error.message);

      // Special handling for abort errors
      if (error.name === 'AbortError') {
        console.warn('Request was aborted due to timeout');
      }

      // Don't wait after the last attempt
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 1000, 10000);
        console.log(`Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // If we get here, all attempts failed
  throw lastError || new Error('All fetch attempts failed');
}

// Define interfaces for API responses
interface ReplicateStatusResponse {
  id?: string;
  status?: string;
  error?: string;
  output?: string[];
  [key: string]: any;
}

interface FalStatusResponse {
  request_id?: string;
  status?: string;
  error?: string;
  output?: {
    video_url?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export async function POST(req: NextRequest) {
  try {
    console.log('=== Video Generation Request ===');
    // Add detailed error tracking
    let stage = 'parsing-request';

    const { prompt, useContext, model, aspectRatio, resolution, frameCount, duration, cameraFixed, sourceImage, generateAudio, useFastMode } = await req.json();
    // Support both legacy `frameCount` and new `duration` - normalize to a string like "8s"
    let videoDuration: string | undefined;
    if (typeof duration === 'string') {
      videoDuration = duration.endsWith('s') ? duration : `${duration}s`;
    } else if (typeof duration === 'number') {
      videoDuration = `${duration}s`;
    } else if (typeof frameCount === 'number' || typeof frameCount === 'string') {
      const fc = typeof frameCount === 'string' ? parseInt(frameCount, 10) : frameCount;
      videoDuration = Number.isFinite(fc as number) ? `${fc}s` : undefined;
    }
    const hasSourceImage = !!(sourceImage);

    console.log('Received prompt:', prompt);
    console.log('Model:', model || 'auto-select');
    console.log('Use context:', useContext ? 'Yes' : 'No');
    console.log('Aspect ratio:', aspectRatio || 'Default');
    console.log('Resolution:', resolution || 'Default');
    console.log('Duration:', videoDuration || 'Default (8s)');
    console.log('Camera Fixed:', cameraFixed || false);
    console.log('Has source image:', hasSourceImage);
    console.log('Use fast mode:', useFastMode !== false ? 'Yes' : 'No');
    console.log('Generate audio:', generateAudio !== false ? 'Yes' : 'No');
    console.log('Provider:', primaryProvider);
    console.log('Environment:', process.env.NODE_ENV);

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Verify API key is available before making API calls
    stage = 'checking-api-keys';
    if (!USE_REPLICATE_PROVIDER && !FAL_API_KEY) {
      return NextResponse.json(
        { error: 'FAL_API_KEY is not configured. Please check server environment variables.' },
        { status: 500 }
      );
    }

    if (USE_REPLICATE_PROVIDER && !REPLICATE_API_TOKEN) {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN is not configured. Please check server environment variables.' },
        { status: 500 }
      );
    }

    // Get document context if enabled
    stage = 'context-enhancement';
    let enhancedPrompt = prompt;

    if (useContext) {
      try {
        const context = await getDocumentContext(prompt);

        if (context) {
          console.log('Adding document context to prompt');
          // Use LLM to rewite the prompt with exact facts
          enhancedPrompt = await rewritePromptWithContext(prompt, context);
          console.log('Enhanced prompt length:', enhancedPrompt.length);
        } else {
          console.log('No document context found, using original prompt');
        }
      } catch (error) {
        console.error('Error getting context but continuing with original prompt:', error);
        // Continue with original prompt rather than failing completely
      }
    }

    let videoUrl: string | undefined;

    // Select the appropriate model using the new selection function
    const selectedModel = selectVideoModel(model, hasSourceImage, useFastMode !== false);
    const isImageModel = selectedModel.includes('image-to-video');

    console.log('Final selected model:', selectedModel);
    console.log('Is image-to-video model:', isImageModel);

    // Generate video using appropriate provider
    if (!USE_REPLICATE_PROVIDER && FAL_API_KEY) {
      stage = 'fal-api-request';
      console.log('Sending prompt to Fal.ai:', enhancedPrompt.substring(0, 100) + '...');
      console.log('Using model:', selectedModel);

      try {
        // Build input parameters based on model type
        const inputParams: any = {
          prompt: enhancedPrompt
        };

        // Add aspect ratio for both text and image models (Veo3 supports it)
        if (aspectRatio) {
          inputParams.aspect_ratio = aspectRatio;
        }

        if (resolution && resolution !== 'default') {
          inputParams.resolution = resolution;
        }

        // Duration handling
        // For Veo3 image-to-video endpoints, only "8s" is permitted. Force it to avoid 422.
        if (isImageModel) {
          inputParams.duration = "8s";
        } else {
          // For text-to-video endpoints, respect provided duration if any, otherwise default to 8s
          inputParams.duration = videoDuration || "8s";
        }

        // camera_fixed is not supported by the Veo3 image-to-video endpoint; include only for text models
        if (!isImageModel && cameraFixed !== undefined) {
          inputParams.camera_fixed = cameraFixed;
        }

        // Add generate_audio parameter (Fal.ai uses underscore format)
        if (generateAudio !== undefined) {
          inputParams.generate_audio = generateAudio;
        }

        // For image-to-video models, add the source image with correct parameter name
        if (isImageModel && sourceImage) {
          // For Veo3 image-to-video models, use image_url parameter
          if (typeof sourceImage === 'string' && sourceImage.startsWith('data:image')) {
            inputParams.image_url = sourceImage;
          } else if (typeof sourceImage === 'string' && sourceImage.startsWith('http')) {
            inputParams.image_url = sourceImage;
          } else if (typeof sourceImage === 'object' && sourceImage.base64) {
            inputParams.image_url = sourceImage.base64;
          } else if (typeof sourceImage === 'object' && sourceImage.url) {
            inputParams.image_url = sourceImage.url;
          } else {
            console.warn('Invalid source image format for Veo3 model:', typeof sourceImage);
          }
        }

        console.log('Input parameters:', Object.keys(inputParams));

        stage = 'fal-queue-submit';
        const submission = await fal.queue.submit(selectedModel, {
          input: inputParams
        });

        console.log(`Request submitted to Fal.ai with ID: ${submission.request_id}`);

        // Poll for the result with timeout
        let resultData: ReplicateStatusResponse | FalStatusResponse | null = null;
        let attempts = 0;
        const maxAttempts = 60; // 10 minutes total (60 * 10 seconds)

        // Ensure the folder structure exists - but don't fail if it can't be created
        console.log('Ensuring folder structure exists:', VIDEOS_FOLDER);
        await ensureFolderExists(VIDEOS_FOLDER).catch(err => console.error('Folder creation failed but continuing:', err));
        console.log('Continuing with video generation...');

        // Create a streaming response to provide progress updates
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              // Helper function to send progress updates
              const sendProgress = (progress: number, status: string) => {
                const message = JSON.stringify({ progress, status });
                controller.enqueue(new TextEncoder().encode(message + '\n'));
              };

              // Initial progress
              sendProgress(5, 'Starting video generation...');

              while (attempts < maxAttempts) {
                attempts++;
                stage = `fal-status-check-${attempts}`;
                try {
                  console.log(`Checking result status, attempt ${attempts}/${maxAttempts}...`);

                  // Check the status first to get logs
                  const status = await fal.queue.status(selectedModel, {
                    requestId: submission.request_id
                  });

                  // Check if we have a valid status response
                  if (status && typeof status === 'object') {
                    const statusObj = status as { status?: string; error?: string };

                    // Check for errors
                    if (statusObj.error) {
                      throw new Error(`API error: ${statusObj.error}`);
                    }

                    // Determine the current status
                    const currentStatus = statusObj.status || 'unknown';
                    let progress = Math.min(75, 10 + (attempts * 2)); // Gradually increase progress
                    let statusMessage = `Processing video (${currentStatus})...`;

                    // Handle different status states
                    if (currentStatus === 'succeeded' || currentStatus === 'completed') {
                      resultData = status as ReplicateStatusResponse | FalStatusResponse;
                      progress = 80;
                      statusMessage = 'Video generated successfully! Downloading...';
                      break; // Exit the polling loop
                    } else if (currentStatus === 'failed') {
                      throw new Error('Video generation failed');
                    }

                    // Send progress update
                    sendProgress(progress, statusMessage);
                  }

                  // If we get a valid status that's not in progress, we can get the result
                  if (status &&
                    typeof status === 'object' &&
                    'status' in status &&
                    status.status !== 'IN_PROGRESS' &&
                    status.status !== 'IN_QUEUE') {
                    // Get the result
                    stage = 'fal-get-result';
                    resultData = await fal.queue.result(selectedModel, {
                      requestId: submission.request_id
                    });
                    console.log('Video generation completed with Fal.ai');

                    // Send progress update
                    controller.enqueue(encoder.encode(JSON.stringify({
                      progress: 95,
                      status: 'Video generated, preparing download',
                      stage: 'DOWNLOADING'
                    }) + '\n'));

                    break;
                  } else {
                    // Still processing
                    console.log(`Request status: ${status && typeof status === 'object' && 'status' in status ? status.status : 'UNKNOWN'}, waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before checking again
                  }
                } catch (error: any) {
                  console.error('Error checking request status:', error);
                  if (error && typeof error === 'object' && 'body' in error) {
                    try {
                      console.error('Fal.ai status error body:', JSON.stringify((error as any).body, null, 2));
                    } catch { }
                  }

                  // If the status endpoint returns a validation error (422), try alternate flows
                  if ((error?.status === 422) || (error?.name === 'ValidationError')) {
                    try {
                      // Attempt to fetch the result directly
                      stage = 'fal-get-result-after-422';
                      resultData = await fal.queue.result(selectedModel, {
                        requestId: submission.request_id
                      });
                      if (resultData) {
                        console.log('Retrieved result directly after 422 status error');
                        break;
                      }
                    } catch (directErr) {
                      console.warn('Direct result retrieval after 422 failed:', directErr);
                      // As a last resort, subscribe to the job which works across many models
                      try {
                        stage = 'fal-subscribe-fallback';
                        const subRes: any = await fal.subscribe(selectedModel, {
                          input: inputParams,
                          logs: true,
                        });
                        resultData = subRes;
                        console.log('Subscribe fallback returned data');
                        break;
                      } catch (subErr) {
                        console.error('Subscribe fallback failed:', subErr);
                      }
                    }
                  }

                  // Send error update but don't fail yet
                  controller.enqueue(encoder.encode(JSON.stringify({
                    progress: Math.min(80, 5 + attempts * 2),
                    status: 'Encountered an issue, retrying...',
                    stage: 'ERROR_RETRY'
                  }) + '\n'));

                  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before trying again
                }
              }

              if (!resultData) {
                throw new Error('Timeout waiting for Fal.ai video generation');
              }

              // Extract video URL from the response
              if (resultData) {
                console.log('Attempting to extract video URL from resultData:', JSON.stringify(resultData, null, 2));
                console.log('resultData type:', typeof resultData);
                console.log('resultData keys:', Object.keys(resultData));

                if (!USE_REPLICATE_PROVIDER) {
                  // For Fal.ai
                  const falResult = resultData as FalStatusResponse;
                  console.log('Checking Fal.ai response structure:');
                  console.log('- Has output property:', !!falResult.output);
                  if (falResult.output) console.log('- output keys:', Object.keys(falResult.output));
                  console.log('- Has data property:', !!falResult.data);
                  if (falResult.data) console.log('- data keys:', Object.keys(falResult.data));

                  // Check all possible locations for the video URL in the Fal.ai response
                  if (falResult.output?.video_url) {
                    videoUrl = falResult.output.video_url;
                    console.log('Found video URL in output.video_url:', videoUrl);
                  } else if (falResult.data && typeof falResult.data === 'object') {
                    const dataObj = falResult.data as Record<string, any>;
                    console.log('Examining data object:', dataObj);

                    // Check for video URL in different possible locations
                    if (dataObj.video && typeof dataObj.video === 'object' && dataObj.video.url) {
                      videoUrl = dataObj.video.url;
                      console.log('Found video URL in data.video.url:', videoUrl);
                    } else if (dataObj.video && typeof dataObj.video === 'string') {
                      videoUrl = dataObj.video;
                      console.log('Found video URL in data.video (string):', videoUrl);
                    } else if (dataObj.url) {
                      videoUrl = dataObj.url;
                      console.log('Found video URL in data.url:', videoUrl);
                    } else if (dataObj.video_url) {
                      videoUrl = dataObj.video_url;
                      console.log('Found video URL in data.video_url:', videoUrl);
                    }
                  }
                } else {
                  // For Replicate
                  const replicateResult = resultData as ReplicateStatusResponse;
                  videoUrl = Array.isArray(replicateResult.output) && replicateResult.output.length > 0
                    ? replicateResult.output[0]
                    : undefined;
                }
              }

              // If we still don't have a video URL, try to extract it from the raw response
              if (!videoUrl && resultData) {
                console.log('Attempting to extract video URL from raw response...');

                // Convert to string and search for URL patterns
                const responseStr = JSON.stringify(resultData);
                const urlMatches = responseStr.match(/(https?:\/\/[^\s"]+\.mp4)/g);

                if (urlMatches && urlMatches.length > 0) {
                  videoUrl = urlMatches[0];
                  console.log('Extracted video URL using regex:', videoUrl);
                }
              }

              // If we still don't have a URL, check if there's any URL in the response
              if (!videoUrl && resultData) {
                console.log('Attempting to find any URL in the response...');
                const responseStr = JSON.stringify(resultData);
                const anyUrlMatches = responseStr.match(/(https?:\/\/[^\s"]+)/g);

                if (anyUrlMatches && anyUrlMatches.length > 0) {
                  // Filter for likely video URLs (containing common video domains or extensions)
                  const videoUrlCandidates = anyUrlMatches.filter(url =>
                    url.includes('.mp4') ||
                    url.includes('video') ||
                    url.includes('media') ||
                    url.includes('cdn') ||
                    url.includes('storage')
                  );

                  if (videoUrlCandidates.length > 0) {
                    videoUrl = videoUrlCandidates[0];
                    console.log('Found potential video URL:', videoUrl);
                  }
                }
              }

              // If we still don't have a URL, try to get the result directly
              if (!videoUrl && !USE_REPLICATE_PROVIDER) {
                console.log('No video URL found in status response, trying to get result directly');

                try {
                  const result = await fal.queue.result(selectedModel, {
                    requestId: submission.request_id
                  });

                  console.log('Direct result response:', JSON.stringify(result, null, 2));

                  // Try to extract URL from the result - more comprehensive approach
                  if (result) {
                    // First, convert the result to a string to search for URLs
                    const resultStr = JSON.stringify(result);
                    console.log('Searching for video URLs in result string');

                    // Look for MP4 URLs in the entire response
                    const mp4UrlMatches = resultStr.match(/(https?:\/\/[^\s"]+\.mp4)/g);
                    if (mp4UrlMatches && mp4UrlMatches.length > 0) {
                      videoUrl = mp4UrlMatches[0];
                      console.log('Found MP4 URL using regex:', videoUrl);
                    } else {
                      // Try to navigate the object structure
                      if (typeof result === 'object') {
                        const resultObj = result as Record<string, any>;

                        // Check all possible locations based on observed responses
                        if (resultObj.output?.video_url) {
                          videoUrl = resultObj.output.video_url;
                          console.log('Found video URL in output.video_url');
                        } else if (resultObj.data?.video?.url) {
                          videoUrl = resultObj.data.video.url;
                          console.log('Found video URL in data.video.url');
                        } else if (resultObj.data?.video && typeof resultObj.data.video === 'string') {
                          videoUrl = resultObj.data.video;
                          console.log('Found video URL in data.video (string)');
                        } else if (resultObj.data?.url) {
                          videoUrl = resultObj.data.url;
                          console.log('Found video URL in data.url');
                        } else if (resultObj.data?.video_url) {
                          videoUrl = resultObj.data.video_url;
                          console.log('Found video URL in data.video_url');
                        } else {
                          // Deep search for any property that might contain a URL
                          const findUrlInObject = (obj: Record<string, any>, path = ''): string | null => {
                            for (const [key, value] of Object.entries(obj)) {
                              const currentPath = path ? `${path}.${key}` : key;

                              if (typeof value === 'string' && value.match(/https?:\/\/.*\.mp4/)) {
                                console.log(`Found URL in ${currentPath}:`, value);
                                return value;
                              } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                                const nestedUrl = findUrlInObject(value, currentPath);
                                if (nestedUrl) return nestedUrl;
                              } else if (Array.isArray(value)) {
                                for (let i = 0; i < value.length; i++) {
                                  const item = value[i];
                                  if (typeof item === 'string' && item.match(/https?:\/\/.*\.mp4/)) {
                                    console.log(`Found URL in ${currentPath}[${i}]:`, item);
                                    return item;
                                  } else if (item && typeof item === 'object') {
                                    const nestedUrl = findUrlInObject(item, `${currentPath}[${i}]`);
                                    if (nestedUrl) return nestedUrl;
                                  }
                                }
                              }
                            }
                            return null;
                          };

                          const foundUrl = findUrlInObject(resultObj);
                          if (foundUrl) {
                            videoUrl = foundUrl;
                          }
                        }
                      }
                    }
                  }

                  if (videoUrl) {
                    console.log('Found video URL in direct result:', videoUrl);
                  } else {
                    console.error('Could not find video URL in result:', result);
                  }
                } catch (resultError) {
                  console.error('Error getting direct result:', resultError);
                }
              }

              if (!videoUrl) {
                // Last resort: Try to get the request ID and construct a fallback message
                const requestId = submission.request_id;

                // Try one more approach - directly use the raw response from Fal.ai
                try {
                  // Get the raw result again to ensure we have the latest data
                  const rawResult = await fal.queue.result(selectedModel, {
                    requestId: submission.request_id
                  });

                  console.log('FINAL ATTEMPT - Raw result from Fal.ai:', JSON.stringify(rawResult, null, 2));

                  // Send the entire raw response to the client
                  controller.enqueue(encoder.encode(JSON.stringify({
                    progress: 100,
                    status: 'Video generated, sending raw response to client',
                    stage: 'RAW_RESPONSE',
                    rawResponse: rawResult
                  }) + '\n'));

                  // Try one more approach - if the raw result has a video URL that we can't parse,
                  // try to download it directly and send the base64 encoded data
                  try {
                    console.log('Attempting direct video download from Fal.ai...');

                    // Convert the raw result to a string and search for URL patterns
                    const responseStr = JSON.stringify(rawResult);
                    const urlMatches = responseStr.match(/(https?:\/\/[^\s"]+\.mp4)/g);

                    if (urlMatches && urlMatches.length > 0) {
                      const potentialUrl = urlMatches[0];
                      console.log('Found potential video URL for direct download:', potentialUrl);

                      // Try to download the video
                      const videoResponse = await fetchWithRetry(potentialUrl, {
                        headers: {
                          'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
                        }
                      });

                      if (videoResponse.ok) {
                        console.log('Successfully downloaded video directly, sending as base64');
                        const videoBlob = await videoResponse.blob();

                        // Convert blob to base64
                        const buffer = await videoBlob.arrayBuffer();
                        const base64 = Buffer.from(buffer).toString('base64');

                        // Send the base64 encoded video
                        controller.enqueue(encoder.encode(JSON.stringify({
                          progress: 100,
                          status: 'Video downloaded directly',
                          stage: 'DIRECT_DOWNLOAD',
                          videoBase64: base64,
                          contentType: videoBlob.type
                        }) + '\n'));
                      }
                    }
                  } catch (downloadError) {
                    console.error('Direct video download failed:', downloadError);
                  }

                  // Don't throw an error, let the client try to extract the URL
                  return;
                } catch (finalError) {
                  console.error('Final attempt to get raw result failed:', finalError);

                  // Send a special error message that includes the request ID
                  controller.enqueue(encoder.encode(JSON.stringify({
                    progress: 100,
                    status: 'Video generated but URL extraction failed',
                    stage: 'COMPLETED_WITH_ERROR',
                    error: 'Could not extract video URL from the response',
                    requestId: requestId,
                    rawResponse: JSON.stringify(resultData).substring(0, 500) // Include part of the raw response for debugging
                  }) + '\n'));

                  throw new Error(`No video URL found in the response. Request ID: ${requestId}`);
                }
              }

              // Log the exact URL we're using
              console.log('Extracted video URL for fetch:', videoUrl);

              // Send progress update
              controller.enqueue(encoder.encode(JSON.stringify({
                progress: 96,
                status: 'Downloading video from generation service',
                stage: 'DOWNLOADING'
              }) + '\n'));

              // Download video from Fal.ai URL
              stage = 'download-video';
              console.log('Downloading video from Fal.ai URL:', videoUrl);
              try {
                const videoResponse = await fetchWithRetry(videoUrl, {
                  headers: {
                    'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
                  }
                });

                console.log('Video download response status:', videoResponse.status);
                console.log('Video download response headers:', Object.fromEntries(videoResponse.headers.entries()));

                const videoBlob = await videoResponse.blob();
                console.log('Downloaded video blob size:', videoBlob.size, 'bytes, type:', videoBlob.type);

                if (videoBlob.size === 0) {
                  throw new Error('Downloaded video has zero size');
                }

                // Send progress update
                controller.enqueue(new TextEncoder().encode(JSON.stringify({
                  progress: 98,
                  status: 'Storing video in cloud storage',
                  stage: 'STORING'
                }) + '\n'));

                // Store video in Supabase with an organized path
                // Format: generated-videos/YYYY-MM-DD/source_model-id.mp4
                stage = 'upload-to-supabase';
                const modelName = model || 'pro-text';
                const videoSource = !USE_REPLICATE_PROVIDER ? `fal-seedance-${modelName}` : 'replicate-wan';
                const filename = `${VIDEOS_FOLDER}/${datePrefix}/${videoSource}-${uuidv4()}.mp4`;

                console.log('Uploading video to Supabase:', filename, 'size:', videoBlob.size);

                const { data, error } = await supabaseAdmin.storage
                  .from(STORAGE_BUCKET)
                  .upload(filename, videoBlob, {
                    contentType: 'video/mp4',
                    cacheControl: '31536000' // Cache for 1 year
                  });

                if (error) {
                  console.error('Error uploading to Supabase:', error);
                  // Try to get more details about the error
                  console.error('Error details:', JSON.stringify(error, null, 2));

                  // Try a fallback approach with a different content type
                  console.log('Trying fallback upload with application/octet-stream content type');
                  const fallbackResult = await supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .upload(`${filename}-fallback`, videoBlob, {
                      contentType: 'application/octet-stream',
                      cacheControl: '31536000'
                    });

                  if (fallbackResult.error) {
                    console.error('Fallback upload also failed:', fallbackResult.error);
                    throw error;
                  } else {
                    console.log('Fallback upload succeeded');
                    // Use the fallback URL
                    const { data: fallbackUrlData } = supabaseAdmin.storage
                      .from(STORAGE_BUCKET)
                      .getPublicUrl(`${filename}-fallback`);

                    videoUrl = fallbackUrlData.publicUrl;
                  }
                } else {
                  // Get the public URL
                  const { data: urlData } = supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .getPublicUrl(filename);

                  videoUrl = urlData.publicUrl;
                }

                console.log('Video stored in Supabase:', videoUrl);

                // Send final progress update with the video URL
                controller.enqueue(new TextEncoder().encode(JSON.stringify({
                  progress: 100,
                  status: 'Video generation complete',
                  stage: 'COMPLETED',
                  video: videoUrl
                }) + '\n'));
              } catch (downloadError: any) {
                console.error('Error downloading or uploading video:', downloadError);
                throw new Error(`Failed to download or upload video: ${downloadError.message}`);
              }

              // Close the stream
              controller.close();
            } catch (error: any) {
              console.error('Error in streaming response:', error);
              controller.enqueue(encoder.encode(JSON.stringify({
                error: error.message || 'Unknown error occurred',
                stage: stage
              }) + '\n'));
              controller.close();
            }
          }
        });

        // Return the streaming response
        return new Response(stream, {
          headers: {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      } catch (error: any) {
        console.error('Error in Fal.ai video generation:', error);
        if (error && typeof error === 'object' && 'body' in error) {
          try { console.error('Fal.ai error body:', JSON.stringify((error as any).body, null, 2)); } catch { }
        }

        // If there's a network error or timeout with Fal.ai, try using Replicate as fallback
        if (!REPLICATE_API_TOKEN) {
          throw new Error(`Fal.ai error (${stage}): ${error.message || 'Unknown error'}`);
        }

        console.log('Attempting to use Replicate as fallback due to Fal.ai error');
        // Add stage for fallback to Replicate
        stage = 'replicate-fallback';
      }
    } else if (replicateClient) {
      // Fall back to Replicate if configured
      console.log('Sending prompt to Replicate:', enhancedPrompt.substring(0, 100) + '...');

      try {
        // Create input object with all parameters
        const replicateInput: any = {
          prompt: enhancedPrompt
        };

        // Add aspect ratio parameter if provided
        if (aspectRatio) {
          // Use the original aspect ratio format directly (16:9 or 9:16)
          console.log(`Using original aspect ratio format for Replicate: ${aspectRatio}`);
          replicateInput.aspect_ratio = aspectRatio;
        }

        // Add resolution parameter if provided
        if (resolution) {
          replicateInput.resolution = resolution;
        }

        // Add frame count parameter if provided
        if (videoDuration) {
          // Some Replicate endpoints accept `num_frames`, keep the legacy name
          replicateInput.num_frames = videoDuration;
        }

        console.log('Submitting request to Replicate with params:', replicateInput);

        // Use Replicate API to generate the video
        const output = await replicateClient.run(
          REPLICATE_VIDEO_MODEL as `${string}/${string}:${string}`,
          { input: replicateInput }
        );

        console.log('Video generation completed with Replicate');

        if (!output) {
          throw new Error('No output returned from Replicate');
        }

        console.log('Raw Replicate output:', output);

        // The Replicate output can be a string URL, an array with a URL, or an object with a URL property
        let replicateVideoUrl: string | null = null;

        // Try to extract the URL from different possible output formats
        if (Array.isArray(output) && output.length > 0) {
          // If it's an array, use the first element (which is likely the video URL)
          replicateVideoUrl = String(output[0]);
          console.log('Using first element of output array as video URL');
        } else if (typeof output === 'object' && output !== null) {
          // If it's an object, look for common properties that might contain the URL
          const outputObj = output as Record<string, any>;
          if (outputObj.video) {
            replicateVideoUrl = String(outputObj.video);
            console.log('Using video property as video URL');
          } else if (outputObj.url) {
            replicateVideoUrl = String(outputObj.url);
            console.log('Using url property as video URL');
          } else if (outputObj.output) {
            // The output might be nested in an 'output' property
            if (typeof outputObj.output === 'string') {
              replicateVideoUrl = outputObj.output;
              console.log('Using output string property as video URL');
            } else if (Array.isArray(outputObj.output) && outputObj.output.length > 0) {
              replicateVideoUrl = String(outputObj.output[0]);
              console.log('Using first element of output.output array as video URL');
            } else {
              console.error('Unexpected Replicate output structure:', outputObj);
            }
          } else {
            console.error('Unexpected Replicate output structure:', outputObj);
          }
        } else if (typeof output === 'string') {
          // Assume it's a direct string URL
          replicateVideoUrl = output;
          console.log('Using direct output as video URL');
        }

        // If we couldn't find a URL, log a detailed error
        if (!replicateVideoUrl) {
          console.error('Could not extract video URL from Replicate response. Full output:', JSON.stringify(output, null, 2));
          throw new Error('Could not extract video URL from Replicate response');
        }

        if (!replicateVideoUrl.startsWith('http')) {
          console.error('Invalid URL format from Replicate:', replicateVideoUrl);
          throw new Error('Invalid video URL returned from Replicate');
        }

        console.log('Extracted Replicate video URL:', replicateVideoUrl);

        // Download video from the URL
        console.log('Downloading video from Replicate URL:', replicateVideoUrl);
        const response = await fetchWithRetry(replicateVideoUrl, {
          headers: {
            'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
          }
        }).catch(error => {
          console.error('Failed to download video from Replicate after multiple attempts:', error);
          throw new Error(`Failed to download video from Replicate URL: ${error.message}`);
        });
        const videoBlob = await response.blob();

        // Store video in Supabase with an organized path
        // Format: generated-videos/YYYY-MM-DD/source_model-id.mp4
        const modelName = model || 'pro-text';
        const videoSource = !USE_REPLICATE_PROVIDER ? `fal-seedance-${modelName}` : 'replicate-wan';
        const filename = `${VIDEOS_FOLDER}/${datePrefix}/${videoSource}-${uuidv4()}.mp4`;

        const { data, error } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(filename, videoBlob, {
            contentType: 'video/mp4',
            cacheControl: '31536000' // Cache for 1 year
          });

        if (error) {
          console.error('Error uploading to Supabase:', error);
          throw error;
        }

        // Get the public URL
        const { data: urlData } = supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(filename);

        videoUrl = urlData.publicUrl;
        console.log('Video stored in Supabase:', videoUrl);
      } catch (error: any) {
        console.error('Error in Replicate video generation:', error);
        throw error;
      }
    } else {
      throw new Error('No video provider configured');
    }

    // Ensure we have a valid video URL before returning
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      console.error('Invalid or missing video URL about to be returned:', videoUrl);
      throw new Error('Failed to generate a valid video URL');
    }

    // Log the final response we're sending
    console.log('Returning successful response with video URL:', videoUrl);

    return NextResponse.json({
      video: videoUrl,
      success: true
    });

  } catch (error: any) {
    console.error('Error generating video:', error);
    // Provide more detailed error information
    let errorMessage = 'Failed to generate video';
    if (error instanceof Error) {
      errorMessage = error.message;

      // Include information about which stage failed
      if (error.message.includes('stage:')) {
        // Already contains stage info
      } else if (typeof error.message === 'string') {
        errorMessage = `${errorMessage} (${error.message})`;
      }

      // Check for specific authentication errors
      if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        if (!USE_REPLICATE_PROVIDER) {
          errorMessage = 'Authentication failed with Fal.ai API. Please check your FAL_API_KEY in environment variables.';
        } else {
          errorMessage = 'Authentication failed with Replicate API. Please check your REPLICATE_API_TOKEN in environment variables.';
        }
      }

      // Check for Vercel-specific errors
      if (errorMessage.includes('ENOENT') || errorMessage.includes('file system')) {
        errorMessage = 'Server file system error. This is expected on Vercel and doesn\'t affect video generation.';
      }
    }

    // Return a more detailed error to help with debugging
    return NextResponse.json(
      {
        error: errorMessage,
        env: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 