'use client';

import { createContext, useContext, useState, useEffect } from 'react';

type FontFamily = 'inter' | 'merriweather' | 'source-code-pro' | 'atkinson-hyperlegible' | 'lexend' | 'open-sans' | 'lato';

interface FontContextType {
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

const FONT_STORAGE_KEY = 'selectedFont';

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [fontFamily, setFontFamilyState] = useState<FontFamily>(() => {
    // Initialize from localStorage if available, otherwise use default
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(FONT_STORAGE_KEY);
      if (stored && (stored === 'inter' || stored === 'merriweather' || stored === 'source-code-pro' || 
          stored === 'atkinson-hyperlegible' || stored === 'lexend' || stored === 'open-sans' || stored === 'lato')) {
        return stored as FontFamily;
      }
    }
    return 'inter';
  });

  const setFontFamily = (font: FontFamily) => {
    setFontFamilyState(font);
    localStorage.setItem(FONT_STORAGE_KEY, font);
  };

  // We're removing the effect that added classes to body
  // Each component will be responsible for applying the font family

  return (
    <FontContext.Provider value={{ fontFamily, setFontFamily }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont() {
  const context = useContext(FontContext);
  if (context === undefined) {
    throw new Error('useFont must be used within a FontProvider');
  }
  return context;
} 