import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PUT /api/folders/[id] - Update a folder
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const folderId = params.id;
    const body = await request.json();
    const { name, color, pinned } = body;

    // Build update object
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name.trim();
    if (color !== undefined) updateData.color = color;
    if (pinned !== undefined) updateData.pinned = pinned;

    // Update folder
    const { error } = await supabase
      .from('folders')
      .update(updateData)
      .eq('id', folderId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error updating folder:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PUT /api/folders/[id]:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE /api/folders/[id] - Delete a folder
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const folderId = params.id;
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const deleteChats = searchParams.get('deleteChats') === 'true';

    // Call the database function to handle deletion
    const { error } = await supabase
      .rpc('delete_folder', { 
        folder_uuid: folderId, 
        delete_chats: deleteChats 
      });

    if (error) {
      console.error('Error deleting folder:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/folders/[id]:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// PATCH /api/folders/[id]/pin - Toggle folder pin status
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const folderId = params.id;

    // First, get the current pinned status
    const { data: folder, error: fetchError } = await supabase
      .from('folders')
      .select('pinned')
      .eq('id', folderId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Toggle the pinned status
    const { error: updateError } = await supabase
      .from('folders')
      .update({ 
        pinned: !folder.pinned,
        updated_at: new Date().toISOString()
      })
      .eq('id', folderId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error toggling folder pin:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, pinned: !folder.pinned });
  } catch (error: any) {
    console.error('Error in PATCH /api/folders/[id]/pin:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}