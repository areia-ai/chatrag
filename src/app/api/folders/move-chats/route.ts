import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/folders/move-chats - Move chats to a folder
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { chatIds, folderId } = body;

    if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
      return NextResponse.json({ error: 'Chat IDs are required' }, { status: 400 });
    }

    // Use the database function for batch operations
    const { data, error } = await supabase
      .rpc('move_chats_to_folder', { 
        chat_ids: chatIds, 
        target_folder_id: folderId || null
      });

    if (error) {
      console.error('Error moving chats to folder:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      updatedCount: data 
    });
  } catch (error: any) {
    console.error('Error in POST /api/folders/move-chats:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}