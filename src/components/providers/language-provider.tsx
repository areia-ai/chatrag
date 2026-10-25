'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { Language, TranslationKeys, translations } from '@/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKeys) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANGUAGE_STORAGE_KEY = 'selectedLanguage';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    // Initialize from localStorage if available, otherwise use default
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored && (stored === 'en' || stored === 'es' || stored === 'pt' || stored === 'lt' || stored === 'zh' || stored === 'hi' || stored === 'ar' || stored === 'ja' || stored === 'de' || stored === 'ru' || stored === 'fr' || stored === 'ko' || stored === 'yo' || stored === 'am' || stored === 'sw' || stored === 'sr' || stored === 'sl' || stored === 'hr')) {
        return stored as Language;
      }
    }
    return (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE as Language) || 'en';
  });

  // Function to set language and save to localStorage
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  };

  // Translation function
  const t = (key: TranslationKeys): string => {
    return translations[language][key] || translations.en[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
} 