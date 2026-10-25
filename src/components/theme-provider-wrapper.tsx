'use client';

import React from 'react';
import { ThemeProvider } from "./theme-provider";

export function ThemeProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme={(process.env.NEXT_PUBLIC_DEFAULT_THEME as any) || 'system'} storageKey="ui-theme">
      {children}
    </ThemeProvider>
  );
} 