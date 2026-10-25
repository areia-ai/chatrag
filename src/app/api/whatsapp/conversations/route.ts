import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const supabaseClient = createClient();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    logger.info('WhatsApp Conversations', `Fetching conversations for user: ${user.id}`);

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Get all WhatsApp conversations for user
    const { data: conversations, error } = await supabase
      .from('whatsapp_conversations')
      .select(`
        *,
        chats!inner (
          id,
          title,
          messages,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error('WhatsApp Conversations', 'Failed to fetch conversations:', error);
      throw error;
    }

    // Get last message for each conversation
    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conv) => {
        // Get last message from chat
        const messages = conv.chats.messages || [];
        const lastMessage = messages[messages.length - 1];

        // Get unread count (messages after last user message)
        let unreadCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') break;
          if (messages[i].role === 'assistant') unreadCount++;
        }

        return {
          id: conv.id,
          chatId: conv.chat_id,
          phoneNumber: conv.phone_number,
          contactName: conv.contact_name || conv.phone_number,
          lastMessage: lastMessage ? {
            content: typeof lastMessage.content === 'string' 
              ? lastMessage.content 
              : lastMessage.content[0]?.text || 'Media message',
            timestamp: lastMessage.createdAt || conv.updated_at,
            isFromMe: lastMessage.role === 'assistant'
          } : null,
          unreadCount,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at
        };
      })
    );

    return NextResponse.json({
      conversations: conversationsWithLastMessage
    });
  } catch (error: any) {
    logger.error('WhatsApp Conversations', 'Failed to fetch conversations:', error);

    return NextResponse.json(
      { error: 'Failed to fetch WhatsApp conversations' },
      { status: 500 }
    );
  }
}

// Delete a conversation
export async function DELETE(request: NextRequest) {
  try {
    // Check authentication
    const supabaseClient = createClient();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get conversation ID from query params
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      );
    }

    logger.info('WhatsApp Conversations', `Deleting conversation: ${conversationId}`);

    // Verify ownership and delete
    const { error } = await supabase
      .from('whatsapp_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', user.id);

    if (error) {
      logger.error('WhatsApp Conversations', 'Failed to delete conversation:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error: any) {
    logger.error('WhatsApp Conversations', 'Failed to delete conversation:', error);

    return NextResponse.json(
      { error: 'Failed to delete conversation' },
      { status: 500 }
    );
  }
}