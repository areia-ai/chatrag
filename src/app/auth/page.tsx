'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmail, signUpWithEmail, signInWithSocial } from '@/lib/supabase-auth';
import { Github, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const router = useRouter();

  useEffect(() => {
    // Check localStorage for theme preference
    const savedTheme = localStorage?.getItem('ui-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    } else {
      // Check system preference if no saved theme
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(systemPrefersDark ? 'dark' : 'light');
    }
    
    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          const htmlElement = document.documentElement;
          if (htmlElement.classList.contains('dark')) {
            setTheme('dark');
          } else if (htmlElement.classList.contains('light')) {
            setTheme('light');
          }
        }
      }
    });
    
    observer.observe(document.documentElement, { attributes: true });
    
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isLogin) {
        const result = await signInWithEmail(email, password, rememberMe);
        if (result.error) {
          setError(result.error.message);
          return;
        }
        
        console.log('Login successful, redirecting to /');
        // Wait a bit to allow the auth state to propagate
        setTimeout(() => {
          router.push('/');
        }, 500);
      } else {
        const result = await signUpWithEmail(email, password);
        if (result.error) {
          setError(result.error.message);
          return;
        }
        
        console.log('Sign up successful, redirecting to /auth/verify-email');
        // Wait a bit to allow the auth state to propagate
        setTimeout(() => {
          router.push('/auth/verify-email');
        }, 500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // Use dynamic classes based on theme
  const bgColor = theme === 'dark' ? 'bg-[#1A1A1A]' : 'bg-[#FFF1E5]';
  const cardBgColor = theme === 'dark' ? 'bg-zinc-800' : 'bg-white';
  const cardBorderColor = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const headingTextColor = theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900';
  const subTextColor = theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500';
  const inputBgColor = theme === 'dark' ? 'bg-zinc-700' : 'bg-gray-100';
  const inputTextColor = theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900';
  const inputPlaceholderColor = theme === 'dark' ? 'placeholder:text-zinc-500' : 'placeholder:text-zinc-400';
  const ringOffsetColor = theme === 'dark' ? 'focus:ring-offset-zinc-800' : 'focus:ring-offset-gray-100';
  const labelColor = theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700';
  const dividerColor = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const socialButtonBg = theme === 'dark' ? 'bg-zinc-700' : 'bg-gray-100';
  const socialButtonBgHover = theme === 'dark' ? 'hover:bg-zinc-600' : 'hover:bg-gray-200';
  const socialButtonTextColor = theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700';
  const socialIconColor = theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700';
  const errorBgColor = theme === 'dark' ? 'bg-red-900/20' : 'bg-red-50';

  return (
    <div className={`flex items-center justify-center min-h-screen w-full ${bgColor}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-4"
      >
        <div className={`${cardBgColor} rounded-2xl shadow-lg border ${cardBorderColor}`}>
          <div className="px-8 pt-8 pb-6">
            <h2 className={`text-3xl font-bold text-center ${headingTextColor} mb-2`}>
              {isLogin ? 'Welcome back' : 'Create an account'}
            </h2>
            <p className={`text-center ${subTextColor} text-sm`}>
              {isLogin ? 'Sign in to continue to ChatRAG' : 'Sign up to get started with ChatRAG'}
            </p>
          </div>
          <div className="px-8 pb-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className={`block text-sm font-medium ${labelColor} mb-1`}>
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className={cn(
                      `h-12 w-full ${inputBgColor} border-0 rounded-xl px-4`,
                      `${inputTextColor} ${inputPlaceholderColor}`,
                      `focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${ringOffsetColor}`,
                      "transition-all duration-200"
                    )}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="password" className={`block text-sm font-medium ${labelColor} mb-1`}>
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className={cn(
                      `h-12 w-full ${inputBgColor} border-0 rounded-xl px-4`,
                      `${inputTextColor} ${inputPlaceholderColor}`,
                      `focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${ringOffsetColor}`,
                      "transition-all duration-200"
                    )}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className={`h-4 w-4 rounded border-gray-600 text-orange-600 focus:ring-orange-600 ${ringOffsetColor}`}
                  />
                  <label htmlFor="remember-me" className={`ml-2 block text-sm ${labelColor}`}>
                    Remember me for 14 days
                  </label>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`text-red-500 text-sm text-center ${errorBgColor} py-2 px-4 rounded-lg`}
                >
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  "relative w-full h-12 flex items-center justify-center",
                  "bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-base font-semibold",
                  "transition-all duration-200",
                  `focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${ringOffsetColor}`,
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {isLogin ? 'Signing in...' : 'Signing up...'}
                  </>
                ) : (
                  isLogin ? 'Sign in' : 'Sign up'
                )}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className={`w-full border-t ${dividerColor}`}></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className={`px-2 ${subTextColor} ${cardBgColor}`}>
                    OR CONTINUE WITH
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    signInWithSocial('google').catch(err => 
                      setError(err instanceof Error ? err.message : 'Failed to sign in with Google')
                    );
                  }}
                  className={cn(
                    `h-12 flex items-center justify-center gap-2 rounded-xl`,
                    `${socialButtonBg} ${socialButtonTextColor}`,
                    `${socialButtonBgHover} transition-colors duration-200`,
                    `focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${ringOffsetColor}`
                  )}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span className="text-sm font-medium">Google</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    signInWithSocial('github').catch(err => 
                      setError(err instanceof Error ? err.message : 'Failed to sign in with GitHub')
                    );
                  }}
                  className={cn(
                    `h-12 flex items-center justify-center gap-2 rounded-xl`,
                    `${socialButtonBg} ${socialButtonTextColor}`,
                    `${socialButtonBgHover} transition-colors duration-200`,
                    `focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${ringOffsetColor}`
                  )}
                >
                  <Github className={`h-5 w-5 ${socialIconColor}`} />
                  <span className="text-sm font-medium">GitHub</span>
                </button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className={`text-sm ${subTextColor} hover:text-orange-500 font-medium transition-colors duration-200`}
                >
                  {isLogin ? 'Don\'t have an account? Sign up' : 'Already have an account? Sign in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
