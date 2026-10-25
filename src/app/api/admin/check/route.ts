import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Admin Session Cache
 * Prevents excessive admin status checks by caching results per session
 */
class AdminSessionCache {
  private static instance: AdminSessionCache;
  private cache = new Map<string, { isAdmin: boolean; timestamp: number; ttl: number }>();
  private readonly cacheTTL = 300000; // 5 minutes cache
  private readonly cleanupInterval = 600000; // 10 minutes cleanup interval
  private cleanupTimer: NodeJS.Timeout | null = null;

  static getInstance(): AdminSessionCache {
    if (!AdminSessionCache.instance) {
      AdminSessionCache.instance = new AdminSessionCache();
    }
    return AdminSessionCache.instance;
  }

  private constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  private cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > value.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.admin(`Cleaned ${cleanedCount} expired admin session cache entries`);
    }
  }

  checkCache(sessionId: string): boolean | null {
    const cached = this.cache.get(sessionId);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(sessionId);
      return null;
    }
    
    return cached.isAdmin;
  }

  setCache(sessionId: string, isAdmin: boolean) {
    this.cache.set(sessionId, {
      isAdmin,
      timestamp: Date.now(),
      ttl: this.cacheTTL
    });
  }

  clearCache(sessionId?: string) {
    if (sessionId) {
      this.cache.delete(sessionId);
    } else {
      this.cache.clear();
    }
  }
}

// Lazy initialization of admin client
let adminClient: any = null;

function getAdminClient() {
  if (!adminClient) {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration is missing');
    }
    
    adminClient = createAdminClient(supabaseUrl, supabaseServiceKey);
  }
  return adminClient;
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const cookieStore = await cookies();
  const cache = AdminSessionCache.getInstance();

  try {
    // --- Strictly check for the admin_session cookie --- 
    const adminSessionCookie = cookieStore.get('admin_session');
    
    if (!adminSessionCookie || !adminSessionCookie.value) {
      logger.admin('No admin_session cookie found');
      
      const duration = Date.now() - startTime;
      logger.api('GET', '/api/admin/check', 200, duration);
      
      return NextResponse.json({ isAdmin: false });
    }
    
    const userId = adminSessionCookie.value;
    
    // Check cache first
    const cachedResult = cache.checkCache(userId);
    if (cachedResult !== null) {
      logger.debug('Admin-Check', `Using cached admin status for user ${userId}: ${cachedResult}`);
      
      const duration = Date.now() - startTime;
      logger.api('GET', '/api/admin/check', 200, duration);
      
      return NextResponse.json({ isAdmin: cachedResult });
    }
    
    // Verify the user ID from the cookie is actually in the admin_users table
    const { data: isAdminData, error: isAdminError } = await getAdminClient().rpc(
      'is_admin',
      { user_uuid: userId }
    );

    if (isAdminError) {
      logger.error('Admin-Check', 'Error checking admin status via RPC', isAdminError);
      // If RPC fails, treat as not admin for safety
      
      const duration = Date.now() - startTime;
      logger.api('GET', '/api/admin/check', 500, duration);
      
      return NextResponse.json({ isAdmin: false });
    }
    
    const isAdmin = !!isAdminData;
    
    if (!isAdmin) {
      logger.debug('Admin-Check', 'admin_session cookie present, but user ID not found in admin_users table');
    } else {
      logger.debug('Admin-Check', `User ${userId} verified as admin via RPC`);
    }
    
    // Cache the result
    cache.setCache(userId, isAdmin);
    
    const duration = Date.now() - startTime;
    logger.api('GET', '/api/admin/check', 200, duration);
    
    return NextResponse.json({ isAdmin });

  } catch (error) {
    logger.error('Admin-Check', 'Generic error checking admin status', error);
    
    const duration = Date.now() - startTime;
    logger.api('GET', '/api/admin/check', 500, duration);
    
    return NextResponse.json({ isAdmin: false });
  }
} 