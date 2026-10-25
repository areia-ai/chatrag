import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { z } from 'zod/v3';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import Replicate from 'replicate';
import { fal } from '@fal-ai/client';

// Provider selection flags / keys
const FAL_API_KEY = process.env.FAL_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const USE_REPLICATE_PROVIDER = process.env.USE_REPLICATE_PROVIDER === 'true';

// Model configuration from environment variables
const FAL_3D_MODEL = process.env.FAL_3D_MODEL || 'fal-ai/trellis';
const REPLICATE_3D_MODEL = process.env.REPLICATE_3D_MODEL || 'firtoz/trellis:4876f2a8da1c544772dffa32e8889da4a1bab3a1f5c1937bfcfccb99ae347251';

// Warn when keys missing
if (!USE_REPLICATE_PROVIDER && !FAL_API_KEY) {
  console.error('FAL_API_KEY is not set but Fal.ai is the default provider');
}

if (USE_REPLICATE_PROVIDER && !REPLICATE_API_TOKEN) {
  console.error('REPLICATE_API_TOKEN is not configured but USE_REPLICATE_PROVIDER=true');
}

// Configure Fal client when key present
if (FAL_API_KEY) {
  fal.config({ credentials: FAL_API_KEY });
  console.log('Fal.ai client configured for 3-D route');
}

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

// Initialize Replicate client (fallback)
const replicate = REPLICATE_API_TOKEN ? new Replicate({ auth: REPLICATE_API_TOKEN }) : null;

// Log provider choice
const primaryProvider = !USE_REPLICATE_PROVIDER ? 'Fal.ai' : 'Replicate';
console.log(`3-D generation provider: ${primaryProvider}`);

// Storage bucket for 3D models
const STORAGE_BUCKET = '3d-models';

// Validate request body
const requestSchema = z.object({
  prompt: z.string().optional(),
  texturedMesh: z.boolean().default(false),
  useContext: z.boolean().default(false),
  imageData: z.string().optional(), // Base64 encoded image data
  // New parameters for Trellis model
  textureSize: z.number().default(2048),
  meshSimplify: z.number().default(0.9),
  ssSamplingSteps: z.number().default(38)
});

// Define error response interface
interface ErrorResponse {
  error: string;
  rawError?: unknown;
}

// Helper function to download a file from a URL
async function downloadFile(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  return response;
}

// Helper function to upload base64 image to temporary storage and get URL
async function getImageUrl(base64Image: string): Promise<string> {
  try {
    // Remove data:image/jpeg;base64, prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    
    // Convert base64 to binary
    const binaryData = Buffer.from(base64Data, 'base64');
    
    // Create a blob
    const blob = new Blob([binaryData]);
    
    // Generate a unique filename for the temporary image
    const tempImageId = uuidv4();
    const tempFileName = `temp/${tempImageId}.jpg`;
    
    // Upload to Supabase
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(tempFileName, blob, {
        contentType: 'image/jpeg',
        cacheControl: '3600' // 1 hour
      });
      
    if (error) {
      throw error;
    }
    
    // Get public URL for the uploaded image
    const { data: urlData } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(tempFileName);
      
    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading temporary image:', error);
    throw new Error('Failed to process image data');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  console.log('Received 3D generation request');
  
  // Verify that at least one provider is usable
  if (!USE_REPLICATE_PROVIDER) {
    if (!FAL_API_KEY) {
      return NextResponse.json({ error: 'FAL_API_KEY is not configured but Fal.ai is the default provider' }, { status: 500 });
    }
  } else {
    if (!REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'REPLICATE_API_TOKEN is not configured. Please check server environment variables.' }, { status: 500 });
    }
  }

  try {
    // Parse request body
    const body = await request.json();
    const { prompt, texturedMesh, useContext, imageData, textureSize, meshSimplify, ssSamplingSteps } = requestSchema.parse(body);
    
    if (!imageData) {
      return NextResponse.json({ error: 'Image data is required for 3D generation' }, { status: 400 });
    }

    console.log('Processing 3D generation with params:', { 
      hasPrompt: !!prompt, 
      texturedMesh,
      textureSize,
      meshSimplify,
      ssSamplingSteps,
      hasImageData: !!imageData
    });

    // Upload the image data to get a URL that Replicate can access
    const imageUrl = await getImageUrl(imageData);
    console.log('Uploaded temp image for Replicate:', imageUrl);
    
    // Build input payload following Fal.ai Trellis schema
    const trellisInput: Record<string, any> = {
      image_url: imageUrl,
      // Acceptable enums: 512, 1024, 2048
      texture_size: textureSize,
      mesh_simplify: meshSimplify,
      ss_sampling_steps: ssSamplingSteps
    };

    // Replicate model still expects "images" array field – build separately for fallback
    const replicateInput: Record<string, any> = {
      image_url: imageUrl,
      images: [imageUrl],
      texture_size: textureSize,
      mesh_simplify: meshSimplify,
      ss_sampling_steps: ssSamplingSteps
    };

    let modelUrl: string | undefined;
    let extraOutput: any = undefined;

    if (!USE_REPLICATE_PROVIDER && FAL_API_KEY) {
      console.log(`Submitting 3-D job to Fal.ai model: ${FAL_3D_MODEL}`);
      const submission = await fal.queue.submit(FAL_3D_MODEL, { input: trellisInput as any });
      console.log('Fal.ai submission id:', submission.request_id);

      // Poll for status until the job is completed
      let attempts = 0;
      const maxAttempts = 60; // up to 10 minutes if we poll every 10s
      let statusRes: any;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          statusRes = await fal.queue.status(FAL_3D_MODEL, {
            requestId: submission.request_id,
          });
        } catch (statusError) {
          // If we encounter a transient error, wait and retry
          console.warn('Fal.ai status check error (will retry):', statusError);
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }

        if (statusRes?.status === 'COMPLETED') {
          break;
        }
        if (statusRes?.status === 'FAILED') {
          throw new Error('Fal.ai Trellis failed');
        }
        // Wait 10 seconds before next poll
        await new Promise(r => setTimeout(r, 10000));
      }

      if (!statusRes || statusRes.status !== 'COMPLETED') {
        throw new Error('Fal.ai Trellis timed out');
      }

      // Fetch the final result
      let resultData: any;
      try {
        resultData = await fal.queue.result(FAL_3D_MODEL, {
          requestId: submission.request_id,
        });
      } catch (resultErr) {
        console.error('Fal.ai result retrieval error:', resultErr);
        throw new Error('Failed to retrieve 3D model from Fal.ai');
      }

      // Extract model URL from various possible keys
      modelUrl = resultData?.data?.model_mesh?.url ||
                 resultData?.output?.model_mesh?.url ||
                 resultData?.data?.model_url ||
                 resultData?.output?.model_url ||
                 resultData?.model_url;
      extraOutput = resultData?.data || resultData?.output;
      console.log('Fal.ai modelUrl:', modelUrl);
    } else {
      if (!replicate) throw new Error('Replicate client not configured');
      console.log(`Calling Replicate model: ${REPLICATE_3D_MODEL}`);
      const output = await replicate.run(REPLICATE_3D_MODEL as `${string}/${string}:${string}`, { input: replicateInput as any });
      console.log('Replicate response:', JSON.stringify(output, null, 2));
      modelUrl = (output as any).model_file;
      extraOutput = output;
    }

    if (!modelUrl) {
      throw new Error('No model file URL returned by provider');
    }

    // Download the 3D model file from Replicate
    console.log('Downloading 3D model from:', modelUrl);
    const modelResponse = await downloadFile(modelUrl);
    const modelBlob = await modelResponse.blob();
    
    // Generate a filename for Supabase storage
    const uniqueId = uuidv4();
    const datePrefix = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const fileName = `${datePrefix}/${uniqueId}.glb`;
    
    console.log('Uploading 3D model to Supabase storage:', {
      bucket: STORAGE_BUCKET,
      fileName,
      blobSize: modelBlob.size
    });
    
    // Upload to Supabase
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, modelBlob, {
        contentType: 'model/gltf-binary',
        cacheControl: '31536000' // Cache for 1 year
      });
      
    if (error) {
      console.error('Error uploading 3D model to Supabase:', error);
      
      // If upload fails, return the original URL
      console.log('Returning original model URL from Replicate as fallback');
      return NextResponse.json({ modelUrl });
    }
    
    // Get the public URL from Supabase
    const { data: urlData } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(fileName);
      
    console.log('3D model stored in Supabase:', urlData.publicUrl);
    
    // Return the Supabase URL along with additional Replicate outputs
    return NextResponse.json({ 
      modelUrl: urlData.publicUrl,
      colorVideo: typeof extraOutput?.color_video === 'string' ? extraOutput.color_video : null,
      normalVideo: typeof extraOutput?.normal_video === 'string' ? extraOutput.normal_video : null,
      combinedVideo: typeof extraOutput?.combined_video === 'string' ? extraOutput.combined_video : null,
      gaussianPly: typeof extraOutput?.gaussian_ply === 'string' ? extraOutput.gaussian_ply : null
    });
    
  } catch (error) {
    console.error('Error generating 3D model:', error);
    
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Failed to generate 3D model',
    };
    
    if (error instanceof Error) {
      errorResponse.rawError = error.stack;
    }
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
} 