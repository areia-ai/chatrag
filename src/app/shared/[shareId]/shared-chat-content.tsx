'use client';

import { SharedChatLayout } from '@/components/ui/shared-chat-layout';

interface SharedChatContentProps {
  chat: {
    title: string;
    messages: any[];
    created_at: string;
    updated_at: string;
  };
}

export function SharedChatContent({ chat }: SharedChatContentProps) {
  return <SharedChatLayout chat={chat} />;
} 