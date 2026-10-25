import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SharedChatContent } from './shared-chat-content';

// Metadata generation using the documented pattern
export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ shareId: string }>
}): Promise<Metadata> {
  try {
    // Await params to comply with Next.js 15
    const { shareId } = await params;
    
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return {
        title: 'Shared Chat',
        description: 'View a shared chat conversation',
      };
    }
    
    const { data: chat, error } = await supabase
      .from('chats')
      .select('title')
      .eq('share_id', shareId)
      .eq('shared', true)
      .maybeSingle();

    if (error) {
      console.error('Error fetching shared chat metadata:', error);
      return {
        title: 'Shared Chat',
        description: 'View a shared chat conversation',
      };
    }

    return {
      title: chat?.title ? `${chat.title} - Shared Chat` : 'Shared Chat',
      description: 'View a shared chat conversation',
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'Shared Chat',
      description: 'View a shared chat conversation',
    };
  }
}

// Using the exact format from Next.js documentation for dynamic routes
export default async function Page({ 
  params 
}: { 
  params: Promise<{ shareId: string }>
}) {
  // Await params to comply with Next.js 15
  const { shareId } = await params;
  
  if (!shareId) {
    console.error('No shareId provided');
    notFound();
  }
  
  let safeChat: { title: string | null; messages: unknown[]; created_at: string; updated_at: string } | null = null;

  try {
    // Use getSupabaseAdmin() to get the admin client
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      console.error('Supabase admin client not available');
      notFound();
    }
    
    const { data: chat, error } = await supabase
      .from('chats')
      .select('title, messages, created_at, updated_at')
      .eq('share_id', shareId)
      .eq('shared', true)
      .maybeSingle();

    if (error) {
      console.error('Error fetching shared chat:', error);
      notFound();
    }

    if (!chat) {
      console.error(`No shared chat found with share_id: ${shareId}`);
      notFound();
    }

    // Ensure messages is always an array
    safeChat = {
      ...chat,
      messages: Array.isArray(chat.messages) ? chat.messages : []
    };

  } catch (error) {
    console.error('Error rendering shared chat page:', error);
    notFound();
  }

  if (!safeChat) {
    notFound();
  }

  return <SharedChatContent chat={safeChat} />;
}
