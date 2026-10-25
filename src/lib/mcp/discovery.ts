import { logger } from '@/lib/logger';
import { McpServerConfig, getServerConfig } from './server-config';

export interface McpServer {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  type?: 'http' | 'sse' | 'streamable-http';
  authentication?: {
    type?: 'none' | 'bearer' | 'api-key' | 'basic';
    credentials?: {
      token?: string;
      apiKey?: string;
      username?: string;
      password?: string;
    };
  };
  settings?: {
    timeout?: number;
    retryAttempts?: number;
    enabledInChat?: boolean;
    enabledInEmbed?: boolean;
  };
  enabled: boolean;
}

export interface McpEndpoint {
  name: string;
  url: string;
  type?: 'http' | 'sse' | 'streamable-http';
  config?: McpServerConfig;
}

/**
 * Cached MCP Discovery Results
 */
interface CachedDiscoveryResult {
  endpoints: McpEndpoint[];
  timestamp: number;
  ttl: number;
}

/**
 * Universal MCP Discovery Service with Caching
 * Discovers all MCP servers from built-in endpoints and custom configuration
 * Implements singleton pattern with result caching to prevent multiple discoveries
 */
export class UniversalMcpDiscovery {
  private static instance: UniversalMcpDiscovery;
  private discoveryCache: CachedDiscoveryResult | null = null;
  private readonly cacheTTL = 60000; // 1 minute cache
  private isDiscovering = false;
  private discoveryPromise: Promise<McpEndpoint[]> | null = null;

  private constructor() {
    logger.startup('MCP-Discovery', 'Universal MCP Discovery initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UniversalMcpDiscovery {
    if (!UniversalMcpDiscovery.instance) {
      UniversalMcpDiscovery.instance = new UniversalMcpDiscovery();
    }
    return UniversalMcpDiscovery.instance;
  }
  
  /**
   * Discover all MCP servers from environment and configuration (with caching)
   */
  async discoverAllMcpServers(): Promise<McpEndpoint[]> {
    // Check cache first
    if (this.discoveryCache && Date.now() - this.discoveryCache.timestamp < this.discoveryCache.ttl) {
      return this.discoveryCache.endpoints;
    }

    // If already discovering, return the existing promise
    if (this.isDiscovering && this.discoveryPromise) {
      return this.discoveryPromise;
    }

    // Start new discovery
    this.isDiscovering = true;
    this.discoveryPromise = this.performDiscovery();

    try {
      const result = await this.discoveryPromise;
      
      // Cache the result
      this.discoveryCache = {
        endpoints: result,
        timestamp: Date.now(),
        ttl: this.cacheTTL
      };

      logger.mcp(`Discovery completed: ${result.length} servers found and cached`);
      return result;
    } finally {
      this.isDiscovering = false;
      this.discoveryPromise = null;
    }
  }

  /**
   * Perform the actual discovery work
   */
  private async performDiscovery(): Promise<McpEndpoint[]> {
    const discoveredEndpoints: McpEndpoint[] = [];
    
    // 1. Add built-in endpoints from environment variables
    const builtinEndpoints = this.getBuiltinEndpoints();
    discoveredEndpoints.push(...builtinEndpoints);
    
    // 2. Add custom servers from configuration
    const customEndpoints = await this.getCustomServerEndpoints();
    discoveredEndpoints.push(...customEndpoints);
    
    return discoveredEndpoints;
  }
  
  /**
   * Get built-in MCP endpoints from environment variables
   */
  private getBuiltinEndpoints(): McpEndpoint[] {
    const endpoints: McpEndpoint[] = [];
    const env = process.env;
    
    // Zapier MCP endpoint - Uses Streamable HTTP
    if (env.MCP_ZAPIER_ENDPOINT) {
      const config = getServerConfig({
        id: 'zapier',
        name: 'Zapier',
        endpoint: env.MCP_ZAPIER_ENDPOINT
      }, 'zapier');
      
      endpoints.push({
        name: 'Zapier',
        url: env.MCP_ZAPIER_ENDPOINT,
        type: 'streamable-http',
        config
      });
    }

    // Context7 MCP endpoint - Uses SSE
    if (env.MCP_CONTEXT7_ENDPOINT) {
      const config = getServerConfig({
        id: 'context7',
        name: 'Context7',
        endpoint: env.MCP_CONTEXT7_ENDPOINT
      }, 'generic_sse');
      
      endpoints.push({
        name: 'Context7',
        url: env.MCP_CONTEXT7_ENDPOINT,
        type: 'sse',
        config
      });
    }

    // 21st Dev Magic MCP endpoint - Uses SSE
    if (env.MCP_21ST_DEV_ENDPOINT) {
      const config = getServerConfig({
        id: '21st-dev',
        name: '21st Dev Magic',
        endpoint: env.MCP_21ST_DEV_ENDPOINT
      }, 'generic_sse');
      
      endpoints.push({
        name: '21st Dev Magic',
        url: env.MCP_21ST_DEV_ENDPOINT,
        type: 'sse',
        config
      });
    }

    // Brave Search MCP endpoint - Uses SSE
    if (env.MCP_BRAVE_SEARCH_ENDPOINT) {
      const config = getServerConfig({
        id: 'brave-search',
        name: 'Brave Search',
        endpoint: env.MCP_BRAVE_SEARCH_ENDPOINT
      }, 'generic_sse');
      
      endpoints.push({
        name: 'Brave Search',
        url: env.MCP_BRAVE_SEARCH_ENDPOINT,
        type: 'sse',
        config
      });
    }
    
    logger.mcp(`Found ${endpoints.length} built-in endpoints`);
    return endpoints;
  }
  
  /**
   * Load custom servers from environment configuration
   */
  private async getCustomServerEndpoints(): Promise<McpEndpoint[]> {
    const endpoints: McpEndpoint[] = [];
    
    try {
      // Load custom servers directly from environment variable
      const customServersJson = process.env.MCP_CUSTOM_SERVERS;
      if (!customServersJson) {
        return [];
      }
      
      const customServers = JSON.parse(customServersJson);
      const servers = Array.isArray(customServers) ? customServers : [];
      const enabledServers = servers.filter((server: McpServer) => server.enabled);
      
      for (const server of enabledServers) {
        endpoints.push({
          name: server.name || server.id,
          url: server.endpoint,
          type: server.type || 'sse'
        });
      }
      
      logger.debug('MCP-Discovery', `Found ${endpoints.length} enabled custom servers`);
      
    } catch (error) {
      logger.warn('MCP-Discovery', 'Error loading custom servers', error);
    }
    
    return endpoints;
  }
  
  /**
   * Find which server provides a specific tool
   */
  async findServerForTool(toolName: string): Promise<McpEndpoint | null> {
    try {
      const endpoints = await this.discoverAllMcpServers();
      
      // Try to match tool name patterns to servers
      for (const endpoint of endpoints) {
        const serverName = endpoint.name.toLowerCase();
        
        // Check if tool name contains server identifier
        if (toolName.toLowerCase().includes(serverName)) {
          return endpoint;
        }
        
        
        if (toolName.includes('zapier') || toolName.includes('gmail') || toolName.includes('email')) {
          if (serverName.includes('zapier')) {
            return endpoint;
          }
        }
      }
      
      // If no specific match, return the first available endpoint
      return endpoints.length > 0 ? endpoints[0] : null;
      
    } catch (error) {
      logger.error('MCP-Discovery', 'Error finding server for tool', error);
      return null;
    }
  }

  /**
   * Clear discovery cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.discoveryCache = null;
    logger.mcp('Discovery cache cleared');
  }
}

// Export singleton functions for backwards compatibility
export async function discoverAllMcpServers(): Promise<McpEndpoint[]> {
  const discovery = UniversalMcpDiscovery.getInstance();
  return discovery.discoverAllMcpServers();
}

export async function findServerForTool(toolName: string): Promise<McpEndpoint | null> {
  const discovery = UniversalMcpDiscovery.getInstance();
  return discovery.findServerForTool(toolName);
} 