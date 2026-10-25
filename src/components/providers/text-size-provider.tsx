'use client';

import { createContext, useContext, useState, useEffect } from 'react';

type TextSize = 'small' | 'default' | 'large';

interface TextSizeContextType {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const TextSizeContext = createContext<TextSizeContextType | undefined>(undefined);

const TEXT_SIZE_STORAGE_KEY = 'selectedTextSize';

export function TextSizeProvider({ children }: { children: React.ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    // Initialize from localStorage if available, otherwise use default
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
      if (stored && (stored === 'small' || stored === 'default' || stored === 'large')) {
        return stored;
      }
    }
    return 'default';
  });

  const setTextSize = (size: TextSize) => {
    setTextSizeState(size);
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  };

  // We're removing the effect that added classes to body
  // Each component will be responsible for applying the text size

  return (
    <TextSizeContext.Provider value={{ textSize, setTextSize }}>
      {children}
    </TextSizeContext.Provider>
  );
}

export function useTextSize() {
  const context = useContext(TextSizeContext);
  if (context === undefined) {
    throw new Error('useTextSize must be used within a TextSizeProvider');
  }
  return context;
} 