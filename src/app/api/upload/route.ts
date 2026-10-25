import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase/server';
import { processImageDocument } from '@/lib/document-processor';
import { logger } from '@/lib/logger';

/**
 * Dedicated file upload endpoint for MCP tool compatibility
 * Uploads files to Supabase Storage and returns downloadable URLs
 */

// Configuration
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const BUCKET_NAME = 'chat-images';

/**
 * Generate a unique filename with timestamp and random suffix
 */
function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop() || '';
  const nameWithoutExt = originalName.replace(`.${extension}`, '');
  const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `${sanitizedName}_${timestamp}_${randomSuffix}.${extension}`;
}

/**
 * Get the public download URL for a file in Supabase Storage
 */
function getDownloadUrl(filePath: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${baseUrl}/storage/v1/object/public/${BUCKET_NAME}/${filePath}?download`;
}

export async function POST(request: NextRequest) {
  try {
    logger.info('Upload API', 'File upload request received');

    // Check if supabaseAdmin is available
    if (!supabaseAdmin) {
      logger.error('Upload API', 'Supabase admin client not available');
      return NextResponse.json(
        { error: 'Storage service unavailable' },
        { status: 500 }
      );
    }

    // Parse FormData
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const sessionId = formData.get('sessionId') as string;

    logger.info('Upload API', `Processing ${files.length} files for session: ${sessionId || 'unknown'}`);

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    const uploadResults = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
          errors.push(`File ${file.name}: Unsupported file type ${file.type}`);
          continue;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          errors.push(`File ${file.name}: File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
          continue;
        }

        // Generate unique filename
        const uniqueFilename = generateUniqueFilename(file.name);
        const filePath = sessionId ? `${sessionId}/${uniqueFilename}` : uniqueFilename;

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        logger.info('Upload API', `Uploading file: ${file.name} (${file.size} bytes) as ${filePath}`);

        // Upload to Supabase Storage
        const { data, error } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(filePath, buffer, {
            contentType: file.type,
            duplex: 'half'
          });

        if (error) {
          logger.error('Upload API', `Upload failed for ${file.name}:`, error);
          errors.push(`File ${file.name}: Upload failed - ${error.message}`);
          continue;
        }

        // Generate download URL for MCP compatibility
        const downloadUrl = getDownloadUrl(filePath);

        uploadResults.push({
          originalName: file.name,
          fileName: uniqueFilename,
          filePath: filePath,
          downloadUrl: downloadUrl,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toISOString()
        });

        logger.info('Upload API', `Successfully uploaded: ${file.name} -> ${downloadUrl}`);

      } catch (fileError) {
        logger.error('Upload API', `Error processing file ${file.name}:`, fileError);
        errors.push(`File ${file.name}: Processing failed - ${fileError instanceof Error ? fileError.message : 'Unknown error'}`);
      }
    }

    // Return results
    const response = {
      success: uploadResults.length > 0,
      uploaded: uploadResults.length,
      total: files.length,
      files: uploadResults,
      errors: errors.length > 0 ? errors : undefined
    };

    logger.info('Upload API', `Upload complete: ${uploadResults.length}/${files.length} files uploaded`);

    // Trigger background RAG processing for images (RAG integration)
    // We don't await this to keep the upload response fast
    const processRag = formData.get('process_rag') === 'true';
    const imageContext = formData.get('image_context') as string | undefined;

    (async () => {
      try {
        // Only process for RAG if explicitly requested
        if (!processRag) {
          return;
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          logger.info('Upload API', `Starting background image processing for user ${user.id}`);

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const result = uploadResults.find(r => r.originalName === file.name);

            if (result && file.type.startsWith('image/')) {
              logger.info('Upload API', `Processing image for RAG: ${file.name}`);

              // Get file buffer again
              const arrayBuffer = await file.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              // Process in background without awaiting
              processImageDocument(file.name, buffer, {
                user_id: user.id,
                source: 'upload',
                image_url: result.downloadUrl,
                image_type: file.type,
                image_context: imageContext || undefined,
                source_file_id: result.filePath
              }).catch(err => {
                logger.error('Upload API', `Error in background image processing for ${file.name}:`, err);
              });
            }
          }
        } else {
          logger.warn('Upload API', 'No authenticated user found for image processing - skipping RAG indexing');
        }
      } catch (error) {
        logger.error('Upload API', 'Background image processing failed:', error);
      }
    })();

    if (uploadResults.length === 0) {
      return NextResponse.json(response, { status: 400 });
    }

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    logger.error('Upload API', 'Upload request failed:', error);

    return NextResponse.json(
      {
        error: 'Upload failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      message: 'Upload endpoint ready',
      maxFileSize: MAX_FILE_SIZE,
      allowedTypes: ALLOWED_TYPES,
      bucketName: BUCKET_NAME
    },
    { status: 200 }
  );
}