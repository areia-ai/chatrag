import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

export function createClient() {
  // Check if we're in build phase
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
  
  // Return a dummy client during build phase
  if (isBuildPhase || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {} as any; // Return empty object during build
  }
  
  // Create a supabase client on the browser with project's credentials
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
} 