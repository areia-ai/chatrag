'use client';

import { ThemeProvider } from '@/components/theme-provider';

export default function SharedChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="shared-chat-theme">
      {children}
    </ThemeProvider>
  );
} 