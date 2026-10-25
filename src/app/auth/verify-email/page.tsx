'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type ThemeName = 'dark' | 'light';

const readPreferredTheme = (): ThemeName => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage?.getItem('ui-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export default function VerifyEmail() {
  const [theme, setTheme] = useState<ThemeName>(() => readPreferredTheme());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const htmlElement = document.documentElement;

    const syncFromClassList = () => {
      const nextTheme: ThemeName | null = htmlElement.classList.contains('dark')
        ? 'dark'
        : htmlElement.classList.contains('light')
          ? 'light'
          : null;

      if (nextTheme) {
        setTheme((current) => (current === nextTheme ? current : nextTheme));
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          syncFromClassList();
        }
      }
    });

    observer.observe(htmlElement, { attributes: true, attributeFilter: ['class'] });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? 'dark' : 'light');
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'ui-theme' && (event.newValue === 'light' || event.newValue === 'dark')) {
        setTheme((current) => (current === event.newValue ? current : (event.newValue as ThemeName)));
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Determine background colors based on theme
  const bgColor = theme === 'dark' ? 'bg-[#212121]' : 'bg-[#FFF1E5]';
  const cardBgColor = theme === 'dark' ? 'bg-[#2A2A2A]' : 'bg-[#FFFAF6]';
  const borderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
  const headingTextColor = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const subtitleTextColor = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const boxBgColor = theme === 'dark' ? 'bg-gray-800/30' : 'bg-gray-50';
  const boxTextColor = theme === 'dark' ? 'text-gray-400' : 'text-gray-600';
  const mutedTextColor = theme === 'dark' ? 'text-gray-500' : 'text-gray-500';
  const footerBgColor = theme === 'dark' ? 'bg-gray-800/20' : 'bg-gray-50';
  const footerBorderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-100';
  const iconBgColor = theme === 'dark' ? 'bg-purple-900/30' : 'bg-pink-100';
  const iconTextColor = theme === 'dark' ? 'text-purple-200' : 'text-pink-800';
  const linkColor = theme === 'dark' ? 'text-purple-200 hover:text-purple-100' : 'text-pink-800 hover:text-pink-900';

  return (
    <div className={`flex min-h-screen items-center justify-center p-4 ${bgColor}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className={`${cardBgColor} rounded-2xl shadow-lg border ${borderColor} overflow-hidden`}>
          <div className="px-8 pt-8 pb-6 text-center">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="flex justify-center mb-6"
            >
              <div className={cn(
                "flex items-center justify-center rounded-full w-20 h-20",
                iconBgColor, iconTextColor
              )}>
                <Mail size={36} />
              </div>
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className={`text-3xl font-bold mb-4 ${headingTextColor}`}
            >
              Check Your Email
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className={`text-lg ${subtitleTextColor} mb-6`}
            >
              We&apos;ve sent you a verification link
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className={`${boxBgColor} rounded-xl p-6 mb-6`}
            >
              <p className={boxTextColor}>
                Please check your inbox and click the verification link to complete your registration.
              </p>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              className={`text-sm ${mutedTextColor}`}
            >
              <p>Once verified, you&apos;ll be able to sign in and start using ChatRAG.</p>
            </motion.div>
          </div>
          
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className={`px-8 py-4 ${footerBgColor} border-t ${footerBorderColor}`}
          >
            <a 
              href="/auth" 
              className={cn(
                "flex items-center justify-center gap-2 text-sm font-medium",
                linkColor,
                "transition-colors"
              )}
            >
              <span>Back to login</span>
              <ArrowRight size={16} />
            </a>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
} 
