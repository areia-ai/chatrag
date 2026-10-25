/**
 * Streamable HTTP Transport for MCP
 * Implements the MCP Streamable HTTP transport specification
 * Uses POST for client->server and SSE for server->client communication
 * Now using the official MCP SDK
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '@/lib/logger';
import { McpServerConfig } from '../server-config';
import { McpTransport } from '../transport-factory';

export class StreamableHttpTransport implements McpTransport {
  private config: McpServerConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected: boolean = false;
  private messageHandlers: ((message: any) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
    logger.mcp(`StreamableHttpTransport created for ${config.name}`);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      logger.mcp('Already connected');
      return;
    }

    try {
      // Create StreamableHTTP transport
      this.transport = new StreamableHTTPClientTransport(new URL(this.config.endpoint));

      // Create MCP client
      this.client = new Client(
        {
          name: 'chatrag-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect to the server
      await this.client.connect(this.transport);

      this.connected = true;
      logger.mcp(`Connected to ${this.config.name} via Streamable HTTP`);
    } catch (error) {
      this.handleError(new Error(`Failed to connect: ${error}`));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      await this.transport?.close();
      await this.client.close();
    } catch (error) {
      logger.warn('StreamableHttpTransport', 'Error during disconnect', error);
    }

    this.connected = false;
    this.client = null;
    this.transport = null;

    // Notify close handlers
    this.closeHandlers.forEach(handler => handler());

    logger.mcp(`Disconnected from ${this.config.name}`);
  }

  async sendMessage(message: any): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    // StreamableHTTP transport handles messages internally through the client
    logger.warn('StreamableHttpTransport', 'Direct message sending not supported with SDK - use listTools/executeTool');
  }

  async listTools(): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected');
    }

    try {
      const result = await this.client.listTools();

      // Convert to expected format for compatibility
      const tools: Record<string, any> = {};
      if (result.tools && Array.isArray(result.tools)) {
        for (const tool of result.tools) {
          tools[tool.name] = {
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || {},
            execute: async (params: any) => {
              return await this.executeTool(tool.name, params);
            }
          };
        }
      }

      return tools;
    } catch (error) {
      logger.error('StreamableHttpTransport', 'Failed to list tools', error);
      throw error;
    }
  }

  async executeTool(name: string, params: any): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected');
    }

    try {
      // Log what we're sending to Zapier for Google Drive uploads
      if (name === 'google_drive_upload_file') {
        logger.mcp(`🔍 [ZAPIER DEBUG] Sending to google_drive_upload_file:`, JSON.stringify(params, null, 2));
      }

      const result = await this.client.callTool({
        name,
        arguments: params
      });

      // Log Zapier's response for Google Drive uploads
      if (name === 'google_drive_upload_file') {
        logger.mcp(`🔍 [ZAPIER DEBUG] Response from google_drive_upload_file:`, JSON.stringify(result, null, 2));
      }

      return result;
    } catch (error) {
      logger.error('StreamableHttpTransport', `Failed to execute tool ${name}`, error);
      throw error;
    }
  }

  onMessage(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleError(error: Error): void {
    logger.error('StreamableHttpTransport', 'Transport error', error);
    this.errorHandlers.forEach(handler => handler(error));
  }

  getSdkTransport(): any | null {
    return this.transport;
  }
}