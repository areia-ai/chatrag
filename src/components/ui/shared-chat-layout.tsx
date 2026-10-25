'use client';

import { format } from 'date-fns';
import { ChatMessage } from '@/components/ui/chat-message';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useLanguage } from '@/components/providers/language-provider';

interface SharedChatLayoutProps {
  chat: {
    title: string;
    messages: any[];
    created_at: string;
    updated_at: string;
  };
}

export function SharedChatLayout({ chat }: SharedChatLayoutProps) {
  const { t } = useLanguage();
  
  return (
    <div className="flex flex-col h-screen bg-[#FFF1E5] dark:bg-[#1A1A1A]">
      {/* Sticky Header - stays at top during scroll */}
      <div className="sticky top-0 z-50 w-full h-16 border-b border-[#FFE0D0] dark:border-[#2F2F2F] bg-[#FFF1E5]/75 dark:bg-[#1A1A1A]/75 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{chat.title}</h1>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ({t('created')} {format(new Date(chat.created_at), 'MMM d, yyyy')})
            </span>
          </div>
          <div className="flex items-center border border-[#FFE0D0] dark:border-[#2F2F2F] rounded-lg py-0.5" style={{ background: 'transparent' }}>
            <div className="px-0.5">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area - Directly apply all classes to the overflow container */}
      <div 
        className="flex-1 overflow-y-auto group/chatscroll
                   scrollbar scrollbar-w-3
                   group-hover/chatscroll:scrollbar-track-[#FFF1E5] 
                   group-hover/chatscroll:dark:scrollbar-track-[#212121]
                   scrollbar-thumb-[#EADDD7] dark:scrollbar-thumb-[#2F2F2F]
                   group-hover/chatscroll:scrollbar-thumb-[#D4C0B6] 
                   group-hover/chatscroll:dark:scrollbar-thumb-[#424242]"
      >
        <div className="container px-4">
          <div className="space-y-4 py-4 mb-4">
            {chat.messages.map((message: any, index: number) => (
              <ChatMessage
                key={message.id || index}
                message={message}
                isLastMessage={index === chat.messages.length - 1}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Sticky Footer - stays at bottom during scroll */}
      <div className="sticky bottom-0 z-50 w-full h-16 border-t border-[#FFE0D0] dark:border-[#2F2F2F] bg-[#FFF1E5]/75 dark:bg-[#1A1A1A]/75 backdrop-blur-md">
        <div className="container flex h-16 items-center px-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('sharedChatReadOnly')}
          </p>
        </div>
      </div>
    </div>
  );
} 