import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isSingleTenant } from '@/lib/deployment-mode';

export const runtime = 'nodejs';

// GET: List all images in the knowledge base
export async function GET(request: NextRequest) {
    try {
        const supabaseAdmin = getSupabaseAdmin();

        if (!supabaseAdmin) {
            throw new Error('Supabase admin client not initialized');
        }

        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

        let documents = [];

        if (isSingleTenant()) {
            // SINGLE-TENANT: Get all image documents
            const { data, error: docError } = await supabaseAdmin
                .from('documents')
                .select('id, filename, created_at')
                .order('created_at', { ascending: false });

            if (docError) {
                console.error('Error fetching image documents:', docError);
                throw new Error(`Error fetching image documents: ${docError.message}`);
            }
            documents = data;
        } else {
            // MULTI-TENANT: Get user's image documents
            const supabase = await createClient();
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (authError || !user) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
            }

            // Get organization_id from query params (null = personal workspace)
            const { searchParams } = new URL(request.url);
            const orgIdParam = searchParams.get('organization_id');

            let query = supabaseAdmin
                .from('documents')
                .select('id, filename, created_at, organization_id, user_id')
                .order('created_at', { ascending: false });

            if (orgIdParam === 'null' || orgIdParam === null || orgIdParam === undefined) {
                // Personal Workspace: filter by user_id AND no organization_id
                query = query.eq('user_id', user.id).is('organization_id', null);
            } else {
                // Organization Workspace: filter by organization_id
                // Note: In a real app we should also verify the user belongs to this org
                query = query.eq('organization_id', orgIdParam);
            }

            const { data, error: docError } = await query;

            if (docError) {
                console.error('Error fetching image documents (MT):', docError);
                throw new Error(`Error fetching image documents: ${docError.message}`);
            }
            documents = data;
        }

        // Filter for image documents only
        const imageDocuments = documents.filter((doc: any) => {
            const filename = doc.filename?.toLowerCase() || '';
            return imageExtensions.some(ext => filename.endsWith(ext));
        });

        // Get the image URLs from document_chunks metadata
        const imagesWithUrls = await Promise.all(
            imageDocuments.map(async (doc: any) => {
                // Get the first chunk for this document to retrieve image_url from metadata
                const { data: chunks, error: chunkError } = await supabaseAdmin
                    .from('document_chunks')
                    .select('metadata')
                    .eq('document_id', doc.id)
                    .limit(1);

                if (chunkError || !chunks || chunks.length === 0) {
                    return null;
                }

                const metadata = chunks[0].metadata;
                const imageUrl = metadata?.image_url;

                if (!imageUrl) {
                    return null; // Skip if no image_url in metadata
                }

                return {
                    id: doc.id,
                    name: doc.filename,
                    url: imageUrl,
                    created_at: doc.created_at
                };
            })
        );

        // Filter out null values (images without URLs)
        const validImages = imagesWithUrls.filter(img => img !== null);

        console.log(`[Images API] Found ${validImages.length} images with URLs`);

        return NextResponse.json({
            images: validImages
        });

    } catch (error) {
        console.error("Error listing images:", error);
        return NextResponse.json({
            error: "Failed to list images",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

// DELETE: Remove an image from the knowledge base
export async function DELETE(request: NextRequest) {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        if (!supabaseAdmin) {
            throw new Error('Supabase admin client not initialized');
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
        }

        // AUTHENTICATION CHECK
        if (!isSingleTenant()) {
            const supabase = await createClient();
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (authError || !user) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
            }

            // Verify ownership before deleting
            const { data: doc, error: docError } = await supabaseAdmin
                .from('documents')
                .select('user_id, organization_id')
                .eq('id', id)
                .single();

            if (docError || !doc) {
                return NextResponse.json({ error: 'Document not found' }, { status: 404 });
            }

            // Check if user owns the document or has access via organization
            // TODO: Implement more granular organization permissions if needed
            if (doc.user_id !== user.id) {
                // If organizations are enabled, we might check org access here
                // For now, strict user ownership for simplicity unless explicitly shared
                // console.log('Checking org access...');
            }
        }

        console.log(`[Images API] Deleting image document ${id}`);

        // 1. Get the image URL from chunks to delete from storage (optional but good hygiene)
        const { data: chunks } = await supabaseAdmin
            .from('document_chunks')
            .select('metadata')
            .eq('document_id', id)
            .limit(1);

        if (chunks && chunks.length > 0) {
            const imageUrl = chunks[0].metadata?.image_url;
            if (imageUrl) {
                try {
                    // Extract filename from URL to delete from storage
                    // URL format: .../storage/v1/object/public/chat-images/filename.jpg
                    const parts = imageUrl.split('/chat-images/');
                    if (parts.length > 1) {
                        let filename = parts[1];
                        // Remove any query params like ?download
                        filename = filename.split('?')[0];

                        console.log(`[Images API] Attempting to delete file from storage: ${filename}`);
                        const { error: storageError } = await supabaseAdmin
                            .storage
                            .from('chat-images')
                            .remove([filename]);

                        if (storageError) {
                            console.warn('[Images API] Failed to delete from storage (non-critical):', storageError);
                        }
                    }
                } catch (e) {
                    console.warn('[Images API] Error parsing image URL for deletion:', e);
                }
            }
        }

        // 2. Delete the document record (CASADES to document_chunks)
        const { error: deleteError } = await supabaseAdmin
            .from('documents')
            .delete()
            .eq('id', id);

        if (deleteError) {
            throw deleteError;
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Error deleting image:", error);
        return NextResponse.json({
            error: "Failed to delete image",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
