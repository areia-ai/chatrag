'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { AuthUser } from '@/lib/supabase-auth';
import type { SupabaseClient } from '@supabase/supabase-js'

type AuthContextType = {
  user: AuthUser | null;
  signOut: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  isAuthEnabled: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isAuthEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Debug: Initializing auth state
    // Debug: Auth enabled status
    
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      // Debug: Initial session check completed
      // Debug: Session existence check
      
      if (session?.user) {
        // Debug: User authenticated
        setUser(session.user as AuthUser);
        
        // If on auth page, redirect to home
        if (window.location.pathname.startsWith('/auth') && 
            !window.location.pathname.includes('/callback')) {
          // Debug: Redirecting from auth page to home
          router.push('/');
        }
      } else {
        // Debug: No authenticated user found initially
        setUser(null);
        
        // If auth is enabled and not on auth page, redirect to auth
        if (isAuthEnabled && 
            !window.location.pathname.startsWith('/auth')) {
          // Debug: Redirecting to auth page
          router.push('/auth');
        }
      }
      
      setLoading(false);
    }

    checkSession().catch(error => {
      console.error('AuthProvider: Error getting session:', error);
      setLoading(false);
      // Potentially redirect to auth on error too
      if (isAuthEnabled && !window.location.pathname.startsWith('/auth')) {
        router.push('/auth');
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Debug: Auth state changed
      // Debug: New session existence check
      
      const currentUser = session?.user as AuthUser | null;
      setUser(currentUser);

      if (currentUser) {
        // If user just signed in and is on auth page, redirect to home
        if (event === 'SIGNED_IN' && 
            window.location.pathname.startsWith('/auth') && 
            !window.location.pathname.includes('/callback')) {
          // Debug: User signed in, redirecting to home
          router.push('/');
        }
      } else {
        // If user just signed out and not on auth page, redirect to auth
        if (event === 'SIGNED_OUT' && 
            isAuthEnabled && 
            !window.location.pathname.startsWith('/auth')) {
          // Debug: User signed out, redirecting to auth
          router.push('/auth');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const signOut = async () => {
    try {
      // Debug: Signing out
      
      // Clear admin session when user signs out
      try {
        // Debug: Also clearing admin session
        await fetch('/api/admin/logout', {
          method: 'POST',
          credentials: 'include',
        });
        // Debug: Admin session cleared
      } catch (adminLogoutError) {
        console.error('Error clearing admin session:', adminLogoutError);
        // Continue with normal logout even if admin logout fails
      }
      
      // Proceed with normal user logout
      await supabase.auth.signOut();
      setUser(null);
      // Debug: Signed out successfully
      // Redirect handled by onAuthStateChange listener
      // router.push('/auth'); 
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const signInWithGitHub = async () => {
    // Debug: Signing in with GitHub
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });
  };

  if (loading) {
    // Return a minimal loading indicator with theme-aware styling
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FFF1E5] dark:bg-[#1A1A1A]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 dark:border-gray-100"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, signOut, signInWithGitHub, isAuthEnabled }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
