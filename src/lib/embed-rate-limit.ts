import { env } from '@/lib/env';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (in production, use Redis or similar)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
  const limit = parseInt(env.EMBED_RATE_LIMIT);
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  
  const entry = rateLimitStore.get(identifier);
  
  if (!entry || now > entry.resetTime) {
    // First request or window expired
    const resetTime = now + windowMs;
    rateLimitStore.set(identifier, { count: 1, resetTime });
    return { allowed: true, remaining: limit - 1, resetTime };
  }
  
  if (entry.count >= limit) {
    // Rate limit exceeded
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }
  
  // Increment count
  entry.count++;
  rateLimitStore.set(identifier, entry);
  
  return { allowed: true, remaining: limit - entry.count, resetTime: entry.resetTime };
}

export function getRateLimitIdentifier(request: Request): string {
  // Try to get IP from various headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  
  const ip = forwarded?.split(',')[0] || realIp || cfConnectingIp || 'unknown';
  
  // Include origin to separate rate limits per domain
  const origin = request.headers.get('origin') || 'unknown';
  
  return `${ip}:${origin}`;
} 