import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isSingleTenant } from '@/lib/deployment-mode';
import { verifyUserOrganizationAccess } from '@/lib/auth/organization-handler';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Use authenticated client for workspace filtering
    const supabase = await createClient();
    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not initialized');
    }

    // SINGLE-TENANT MODE: Shared knowledge base, no user/org filtering on documents
    if (isSingleTenant()) {
      // In single-tenant mode, all documents are shared (no user_id or organization_id filtering)
      const { data: documents, error: docError } = await supabaseAdmin
        .from('documents')
        .select('id, filename, created_at, metadata, source, source_provider, source_file_id, source_connection_id');

      if (docError) {
        console.error('Error fetching documents:', docError);
        throw new Error(`Error fetching documents: ${docError.message}`);
      }

      const statusFixEnabled = process.env.CONFIG_UI_STATUS_FIX !== 'false';

      // Get chunk counts for each document in batch
      const documentsWithChunks = await Promise.all(
        documents.map(async (doc: any) => {
          const { count, error: countError } = await supabaseAdmin
            .from('document_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', doc.id);

          if (countError) {
            console.error(`Error counting chunks for document ${doc.id}:`, countError);
            return {
              ...doc,
              chunk_count: 0,
              ...(statusFixEnabled && { status: 'unknown' as const })
            };
          }

          const status = count && count > 0 ? 'ready' : 'processing';

          return {
            ...doc,
            chunk_count: count,
            ...(statusFixEnabled && { status })
          };
        })
      );

      const totalChunks = documentsWithChunks.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0);
      if (process.env.NODE_ENV === 'development') {
        console.log(`Documents (single-tenant): ${documents.length} docs, ${totalChunks} total chunks`);
      }

      // Filter out image documents - they are managed via Image RAG section
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
      const nonImageDocuments = documentsWithChunks.filter((doc: any) => {
        const filename = doc.filename?.toLowerCase() || '';
        return !imageExtensions.some(ext => filename.endsWith(ext));
      });

      return NextResponse.json({
        documents: nonImageDocuments.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      });
    }

    // MULTI-TENANT MODE: User/org filtering required
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get organization_id from query params (null = personal workspace)
    const { searchParams } = new URL(request.url);
    const orgIdParam = searchParams.get('organization_id');

    // Build query based on workspace type
    let query = supabaseAdmin
      .from('documents')
      .select('id, filename, created_at, organization_id, user_id, metadata, source, source_provider, source_file_id, source_connection_id');

    if (orgIdParam === 'null' || orgIdParam === null || orgIdParam === undefined) {
      // Personal Workspace (flat): no organization, just user_id
      query = query
        .is('organization_id', null)
        .eq('user_id', user.id);
    } else {
      // Personal Project or Team Workspace: validate access, then filter by organization_id.
      const access = await verifyUserOrganizationAccess(user.id, orgIdParam);

      if (!access.hasAccess) {
        return NextResponse.json(
          { error: 'You are not a member of this organization. Select a workspace that belongs to the signed-in user, or invite this user to the selected workspace before listing documents.' },
          { status: 403 }
        );
      }

      query = query.eq('organization_id', orgIdParam);
    }

    const { data: documents, error: docError } = await query;

    if (docError) {
      console.error('Error fetching documents:', docError);
      throw new Error(`Error fetching documents: ${docError.message}`);
    }

    const statusFixEnabled = process.env.CONFIG_UI_STATUS_FIX !== 'false';

    // Get chunk counts for each document in batch
    const documentsWithChunks = await Promise.all(
      documents.map(async (doc: any) => {
        const { count, error: countError } = await supabase
          .from('document_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', doc.id);

        if (countError) {
          console.error(`Error counting chunks for document ${doc.id}:`, countError);
          return {
            ...doc,
            chunk_count: 0,
            // Include status only if the feature flag is enabled
            ...(statusFixEnabled && { status: 'unknown' as const })
          };
        }

        // Derive a basic status from the presence of processed chunks.
        // If no chunks have been stored yet, we assume the document is still processing. Otherwise it's ready.
        const status = count && count > 0 ? 'ready' : 'processing';

        return {
          ...doc,
          chunk_count: count,
          ...(statusFixEnabled && { status })
        };
      })
    );

    // Log summary only when requested
    const totalChunks = documentsWithChunks.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0);
    if (process.env.NODE_ENV === 'development') {
      console.log(`Documents: ${documents.length} docs, ${totalChunks} total chunks`);
    }

    // Filter out image documents - they are managed via Image RAG section
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    const nonImageDocuments = documentsWithChunks.filter((doc: any) => {
      const filename = doc.filename?.toLowerCase() || '';
      return !imageExtensions.some(ext => filename.endsWith(ext));
    });

    return NextResponse.json({
      documents: nonImageDocuments.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    });
  } catch (error) {
    console.error("Error listing documents:", error);
    return NextResponse.json({
      error: "Failed to list documents",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
