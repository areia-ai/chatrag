/**
 * MCP Tools and Discovery Caching System
 * Reduces initialization overhead by caching MCP connections and tool metadata
 */

interface CachedMcpData {
  tools: any;
  serverHealth: any[];
  timestamp: number;
  ttl: number;
}

interface CachedConnection {
  client: any;
  timestamp: number;
  endpoint: any;
}

// Global cache objects
const toolsCache = new Map<string, CachedMcpData>();
const connectionsCache = new Map<string, CachedConnection>();

// Cache TTL settings (in milliseconds)
const TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CONNECTION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function getCachedTools(cacheKey: string = 'default'): CachedMcpData | null {
  const cached = toolsCache.get(cacheKey);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > cached.ttl) {
    toolsCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

export function setCachedTools(
  tools: any, 
  serverHealth: any[], 
  cacheKey: string = 'default',
  ttl: number = TOOLS_CACHE_TTL
): void {
  toolsCache.set(cacheKey, {
    tools,
    serverHealth,
    timestamp: Date.now(),
    ttl
  });
}

export function getCachedConnection(endpointUrl: string): any | null {
  const cached = connectionsCache.get(endpointUrl);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > CONNECTION_CACHE_TTL) {
    connectionsCache.delete(endpointUrl);
    return null;
  }
  
  return cached.client;
}

export function setCachedConnection(endpointUrl: string, client: any, endpoint: any): void {
  connectionsCache.set(endpointUrl, {
    client,
    timestamp: Date.now(),
    endpoint
  });
}

export function clearCache(): void {
  toolsCache.clear();
  connectionsCache.clear();
}

export function getCacheStats(): {
  toolsCacheSize: number;
  connectionsCacheSize: number;
  oldestToolsCache: number | null;
  oldestConnectionCache: number | null;
} {
  const now = Date.now();
  
  let oldestToolsCache: number | null = null;
  for (const cached of toolsCache.values()) {
    const age = now - cached.timestamp;
    if (oldestToolsCache === null || age > oldestToolsCache) {
      oldestToolsCache = age;
    }
  }
  
  let oldestConnectionCache: number | null = null;
  for (const cached of connectionsCache.values()) {
    const age = now - cached.timestamp;
    if (oldestConnectionCache === null || age > oldestConnectionCache) {
      oldestConnectionCache = age;
    }
  }
  
  return {
    toolsCacheSize: toolsCache.size,
    connectionsCacheSize: connectionsCache.size,
    oldestToolsCache,
    oldestConnectionCache
  };
}

// Cleanup function to remove expired entries
export function cleanupExpiredCache(): void {
  const now = Date.now();
  
  // Cleanup tools cache
  for (const [key, cached] of toolsCache.entries()) {
    if (now - cached.timestamp > cached.ttl) {
      toolsCache.delete(key);
    }
  }
  
  // Cleanup connections cache
  for (const [key, cached] of connectionsCache.entries()) {
    if (now - cached.timestamp > CONNECTION_CACHE_TTL) {
      connectionsCache.delete(key);
    }
  }
}

// Auto-cleanup every 10 minutes
setInterval(cleanupExpiredCache, 10 * 60 * 1000);