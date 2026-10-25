/**
 * MCP Server Configuration Schema
 * Defines comprehensive configuration for different MCP server types
 */

export type TransportType = 'streamable-http' | 'sse' | 'websocket';
export type HttpMethod = 'GET' | 'POST';
export type RetryStrategy = 'linear' | 'exponential';

export interface McpTransportConfig {
  type: TransportType;
  method?: HttpMethod;
  headers?: Record<string, string>;
  initialization?: {
    required: boolean;
    method?: string;
    params?: Record<string, any>;
  };
  streaming?: {
    format: 'sse' | 'json-lines' | 'chunked';
  };
}

export interface McpProtocolConfig {
  version: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  };
}

export interface McpRetryConfig {
  attempts: number;
  backoff: RetryStrategy;
  initialDelay?: number;
  maxDelay?: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  transport: McpTransportConfig;
  protocol?: McpProtocolConfig;
  retry?: McpRetryConfig;
  authentication?: {
    type: 'none' | 'bearer' | 'api-key' | 'basic';
    credentials?: Record<string, any>;
  };
  metadata?: Record<string, any>;
}

/**
 * Default configurations for known MCP server types
 */
export const DEFAULT_SERVER_CONFIGS: Record<string, Partial<McpServerConfig>> = {
  zapier: {
    transport: {
      type: 'streamable-http',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Cache-Control': 'no-cache'
      },
      initialization: {
        required: true,
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          capabilities: {
            sampling: {}
          }
        }
      },
      streaming: {
        format: 'sse'
      }
    },
    protocol: {
      version: '1.0',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false,
        sampling: true
      }
    },
    retry: {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: 1000,
      maxDelay: 10000
    }
  },
  generic_sse: {
    transport: {
      type: 'sse',
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      initialization: {
        required: false
      }
    },
    protocol: {
      version: '1.0',
      capabilities: {
        tools: true
      }
    },
    retry: {
      attempts: 3,
      backoff: 'linear',
      initialDelay: 1000
    }
  },
};

/**
 * Get server configuration with defaults applied
 */
export function getServerConfig(
  baseConfig: Partial<McpServerConfig>,
  serverType?: keyof typeof DEFAULT_SERVER_CONFIGS
): McpServerConfig {
  const defaults = serverType ? DEFAULT_SERVER_CONFIGS[serverType] : {};
  
  return {
    id: baseConfig.id || `server-${Date.now()}`,
    name: baseConfig.name || 'Unknown Server',
    endpoint: baseConfig.endpoint || '',
    transport: {
      ...defaults.transport,
      ...baseConfig.transport
    } as McpTransportConfig,
    protocol: {
      ...defaults.protocol,
      ...baseConfig.protocol
    },
    retry: {
      ...defaults.retry,
      ...baseConfig.retry
    },
    ...baseConfig
  } as McpServerConfig;
}