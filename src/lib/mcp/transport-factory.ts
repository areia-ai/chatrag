/**
 * Universal MCP Transport Factory
 * Creates appropriate transport implementations based on server configuration
 */

import { logger } from '@/lib/logger';
import { McpServerConfig } from './server-config';
import { StreamableHttpTransport } from './transports/streamable-http-transport';
import { SseTransport } from './transports/sse-transport';

export interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: any): Promise<void>;
  onMessage(handler: (message: any) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
  isConnected(): boolean;

  // Tool discovery and execution
  listTools(): Promise<any>;
  executeTool(name: string, params: any): Promise<any>;

  // Access to underlying SDK Client (for AI SDK optimization)
  getClient(): any | null; // Typed as 'any' to avoid strict dependency on @modelcontextprotocol/sdk here
}

export class TransportFactory {
  private static instance: TransportFactory;

  private constructor() { }

  static getInstance(): TransportFactory {
    if (!TransportFactory.instance) {
      TransportFactory.instance = new TransportFactory();
    }
    return TransportFactory.instance;
  }

  /**
   * Create appropriate transport based on server configuration
   */
  createTransport(config: McpServerConfig): McpTransport {
    logger.mcp(`Creating transport for ${config.name} with type: ${config.transport.type}`);

    switch (config.transport.type) {
      case 'streamable-http':
        return new StreamableHttpTransport(config);

      case 'sse':
        return new SseTransport(config);

      case 'websocket':
        throw new Error('WebSocket transport not yet implemented');

      default:
        throw new Error(`Unknown transport type: ${config.transport.type}`);
    }
  }

  /**
   * Auto-detect transport type from endpoint URL
   */
  async detectTransportType(endpoint: string): Promise<string> {
    logger.mcp(`Auto-detecting transport type for: ${endpoint}`);

    // Check if it's WebSocket
    if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
      return 'websocket';
    }

    // For HTTP endpoints, try to detect the best transport
    try {
      // First, try OPTIONS request to check server capabilities
      const response = await fetch(endpoint, {
        method: 'OPTIONS',
        headers: {
          'Accept': 'application/json, text/event-stream'
        }
      });

      const acceptHeader = response.headers.get('accept');
      const allowHeader = response.headers.get('allow');

      // Check if server supports POST (likely streamable-http)
      if (allowHeader?.includes('POST')) {
        logger.mcp('Detected POST support, using streamable-http transport');
        return 'streamable-http';
      }

      // Check if server prefers SSE
      if (acceptHeader?.includes('text/event-stream')) {
        logger.mcp('Detected SSE support, using sse transport');
        return 'sse';
      }

      // Default to streamable-http for HTTP endpoints
      return 'streamable-http';

    } catch (error) {
      logger.warn('TransportFactory', 'Auto-detection failed, defaulting to streamable-http', error);
      return 'streamable-http';
    }
  }

  /**
   * Test connection to verify transport works
   */
  async testConnection(config: McpServerConfig): Promise<boolean> {
    try {
      const transport = this.createTransport(config);
      await transport.connect();

      // Try to list tools as a basic test
      const tools = await transport.listTools();

      await transport.disconnect();

      logger.mcp(`Connection test successful for ${config.name}, found ${Object.keys(tools || {}).length} tools`);
      return true;

    } catch (error) {
      logger.error('TransportFactory', `Connection test failed for ${config.name}`, error);
      return false;
    }
  }
}