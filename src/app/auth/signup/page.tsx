'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { env } from '@/lib/env';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClientComponentClient();

  // Get plan and checkout_id from URL params
  const plan = searchParams.get('plan');
  const checkoutId = searchParams.get('checkout_id');

  // Add useEffect to detect the current theme from localStorage
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

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Check if custom SMTP is enabled
      const customSmtpEnabled = env.NEXT_PUBLIC_CUSTOM_SMTP_ENABLED === 'true';
      console.log(`SignUp Page: Custom SMTP ${customSmtpEnabled ? 'enabled' : 'disabled'}`);
      
      // Prepare options based on SMTP setting
      const options = {
        ...(customSmtpEnabled ? {
          emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        } : {}),
        // Always include this metadata
        data: {
          plan_type: plan,
          checkout_id: checkoutId
        }
      };
      
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options
      });

      if (signUpError) throw signUpError;

      // Redirect to confirmation page
      router.push('/auth/verify-email');
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up');
    } finally {
      setLoading(false);
    }
  };

  // Determine colors based on theme
  const bgColor = theme === 'dark' ? 'bg-[#1A1A1A]' : 'bg-[#FFF1E5]';
  const cardBgColor = theme === 'dark' ? 'bg-zinc-800' : 'bg-white';
  const cardBorderColor = theme === 'dark' ? 'border border-gray-700' : 'border border-gray-200';
  const headingTextColor = theme === 'dark' ? 'text-zinc-100' : 'text-gray-900';
  const subTextColor = theme === 'dark' ? 'text-zinc-400' : 'text-gray-600';
  const labelColor = theme === 'dark' ? 'text-zinc-300' : 'text-gray-700';
  const inputBgColor = theme === 'dark' ? 'bg-zinc-700' : 'bg-white';
  const inputBorderColor = theme === 'dark' ? 'border-gray-600' : 'border-gray-300';
  const inputTextColor = theme === 'dark' ? 'text-zinc-100' : 'text-gray-900';
  const ringColor = theme === 'dark' ? 'focus:ring-orange-500' : 'focus:ring-blue-500';
  const buttonBgColor = theme === 'dark' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700';
  const errorTextColor = theme === 'dark' ? 'text-red-400' : 'text-red-500';

  return (
    <div className={`flex min-h-screen items-center justify-center p-4 ${bgColor}`}>
      <div className={`w-full max-w-md ${cardBgColor} rounded-lg shadow-md p-8 ${cardBorderColor}`}>
        <div className="text-center mb-8">
          <h1 className={`text-2xl font-bold ${headingTextColor}`}>Complete Your Registration</h1>
          <p className={subTextColor}>
            Create your account to access {plan?.toUpperCase()} features
          </p>
        </div>
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className={`block text-sm font-medium ${labelColor}`}>
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              required
              className={`w-full px-3 py-2 border ${inputBorderColor} rounded-md focus:outline-none focus:ring-2 ${ringColor} ${inputBgColor} ${inputTextColor}`}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className={`block text-sm font-medium ${labelColor}`}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              required
              className={`w-full px-3 py-2 border ${inputBorderColor} rounded-md focus:outline-none focus:ring-2 ${ringColor} ${inputBgColor} ${inputTextColor}`}
            />
          </div>
          {error && (
            <div className={`text-sm ${errorTextColor}`}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className={`w-full ${buttonBgColor} text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 ${ringColor} focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
} 