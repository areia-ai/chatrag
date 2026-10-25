import { useState } from 'react';
import { supabaseAuth } from '@/lib/supabase-auth';

export function useShareChat() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareChat = async (chatId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // First check if we have an active session
      const { data: { session } } = await supabaseAuth.auth.getSession();
      
      if (!session) {
        throw new Error('You must be logged in to share a chat');
      }

      const response = await fetch('/api/chats/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chatId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to share chat');
      }

      const { shareId } = await response.json();
      const shareUrl = `${window.location.origin}/shared/${shareId}`;
      
      return { shareUrl, shareId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to share chat';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    shareChat,
    isLoading,
    error,
  };
} 