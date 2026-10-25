import { createClient as createBrowserClient } from '@/lib/supabase/client'; // Import browser client utility
import { AuthError, AuthResponse } from '@supabase/supabase-js';
import { env } from './env';

const siteUrl = env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '');

// Removed the old supabaseAuth export as it's replaced by the SSR utilities
// export const supabaseAuth = createBrowserClient(...);

// --- Keep Type Definitions ---
export type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: {
    name?: string;
    avatar_url?: string;
  };
};
export type Provider = 'google' | 'github';

// --- Refactored Client-Side Actions ---

// Use the browser client for client-side actions like sign-in
export async function signInWithEmail(email: string, password: string, rememberMe: boolean = false): Promise<{
  data: AuthResponse['data'] | null;
  error: AuthError | null;
}> {
  // Create a client instance specifically for this function call
  const supabase = createBrowserClient(); 
  try {
    console.log('Attempting to sign in with email:', email);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Supabase auth error:', error);
      return { data: null, error };
    }
    
    console.log('Sign in successful, user ID:', data.user?.id);
    // The @supabase/ssr client handles cookie/session propagation automatically.
    
    return { data, error: null };
  } catch (error) {
    console.error('Error signing in:', error);
    return { 
      data: null, 
      error: error instanceof AuthError ? error : new AuthError('An unexpected error occurred') 
    };
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<{
  data: AuthResponse['data'] | null;
  error: AuthError | null;
}> {
  const supabase = createBrowserClient();
  try {
    // Check if custom SMTP is enabled
    const customSmtpEnabled = env.NEXT_PUBLIC_CUSTOM_SMTP_ENABLED === 'true';
    console.log(`SignUp: Custom SMTP ${customSmtpEnabled ? 'enabled' : 'disabled'}`);
    
    // If custom SMTP is enabled, we need to set emailRedirectTo
    const options = {
      ...(customSmtpEnabled ? {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      } : {
        // When using default Supabase email, we don't need to set redirect
        // as it will be configured in the Supabase dashboard
      })
    };
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options
    });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error signing up:', error);
    return { data: null, error: error as AuthError };
  }
}

export async function signInWithSocial(provider: Provider): Promise<void> {
  const supabase = createBrowserClient();
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
      }
    });
    if (error) throw error;
  } catch (error) {
    console.error('Error signing in with social:', error);
    throw error as AuthError;
  }
}

// getCurrentUser might become redundant if useAuth from AuthProvider is used
/*
export async function getCurrentUser() {
  const supabase = createBrowserClient(); 
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
*/

// Note: The original signOut function was removed as it's handled in AuthProvider now.
