import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const { chatId } = await request.json();

    if (!chatId) {
      return NextResponse.json(
        { error: 'Chat ID is required' },
        { status: 400 }
      );
    }

    // Get the authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    // Create a Supabase client with the user's token
    const supabaseClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        global: {
          headers: {
            Authorization: authHeader
          }
        }
      }
    );

    // Get the current user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if the chat exists and belongs to the user
    const { data: chat, error: chatError } = await supabaseClient
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single();

    if (chatError || !chat) {
      return NextResponse.json(
        { error: 'Chat not found' },
        { status: 404 }
      );
    }

    // Generate a unique share ID if not already shared
    if (!chat.share_id) {
      const shareId = uuidv4();
      
      // Update the chat with share info
      const { error: updateError } = await supabaseClient
        .from('chats')
        .update({
          shared: true,
          share_id: shareId,
        })
        .eq('id', chatId)
        .eq('user_id', user.id);

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to share chat' },
          { status: 500 }
        );
      }

      return NextResponse.json({ shareId });
    }

    // If already shared, return the existing share ID
    return NextResponse.json({ shareId: chat.share_id });
  } catch (error) {
    console.error('Error sharing chat:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 