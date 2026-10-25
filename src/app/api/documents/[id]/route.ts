import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  if (!supabaseAdmin) {
    return new Response(
      JSON.stringify({ error: 'Database client is not available' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // First delete all associated chunks
    const { error: chunksError } = await supabaseAdmin
      .from('document_chunks')
      .delete()
      .match({ document_id: id });

    if (chunksError) {
      console.error('Error deleting document chunks:', chunksError);
      return new Response(
        JSON.stringify({ error: `Failed to delete document chunks: ${chunksError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Then delete the document
    const { error: documentError } = await supabaseAdmin
      .from('documents')
      .delete()
      .match({ id });

    if (documentError) {
      console.error('Error deleting document:', documentError);
      return new Response(
        JSON.stringify({ error: `Failed to delete document: ${documentError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error deleting document:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete document' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  if (!supabaseAdmin) {
    return new Response(
      JSON.stringify({ error: 'Database client is not available' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { external_url } = await request.json();

    // 1. Get current metadata
    const { data: doc, error: fetchError } = await supabaseAdmin
      .from('documents')
      .select('metadata')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching document:', fetchError);
      return new Response(
        JSON.stringify({ error: `Failed to fetch document: ${fetchError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Update metadata
    const updatedMetadata = {
      ...(doc?.metadata || {}),
      external_url: external_url
    };

    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({ metadata: updatedMetadata })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating document:', updateError);
      return new Response(
        JSON.stringify({ error: `Failed to update document: ${updateError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error updating document:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update document' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
} 