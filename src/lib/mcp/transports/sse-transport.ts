/**
 * SSE (Server-Sent Events) Transport for MCP
 * For servers that use traditional SSE with GET requests
 * Now using the official MCP SDK
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '@/lib/logger';
import { McpServerConfig } from '../server-config';
import { McpTransport } from '../transport-factory';

export class SseTransport implements McpTransport {
  private config: McpServerConfig;
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private connected: boolean = false;
  private messageHandlers: ((message: any) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
    logger.mcp(`SseTransport created for ${config.name}`);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      logger.mcp('Already connected');
      return;
    }

    try {
      // Create SSE transport with proper headers
      this.transport = new SSEClientTransport(new URL(this.config.endpoint), {
        headers: this.config.transport.headers
      });

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
      logger.mcp(`Connected to ${this.config.name} via SSE`);
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
      logger.warn('SseTransport', 'Error during disconnect', error);
    }

    this.connected = false;
    this.client = null;
    this.transport = null;

    // Notify close handlers
    this.closeHandlers.forEach(handler => handler());

    logger.mcp(`Disconnected from ${this.config.name}`);
  }

  async sendMessage(message: any): Promise<void> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected');
    }

    // SSE transport typically doesn't support sending messages
    // It's a one-way communication from server to client
    logger.warn('SseTransport', 'SSE transport does not support sending messages');
  }

  async listTools(): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected');
    }

    try {
      const result = await this.client.listTools();
      return result.tools;
    } catch (error) {
      logger.error('SseTransport', 'Failed to list tools', error);
      throw error;
    }
  }

  async executeTool(name: string, params: any): Promise<any> {
    if (!this.connected || !this.client) {
      throw new Error('Not connected');
    }

    try {
      const result = await this.client.callTool({
        name,
        arguments: params
      });
      return result;
    } catch (error) {
      logger.error('SseTransport', `Failed to execute tool ${name}`, error);
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
    logger.error('SseTransport', 'Transport error', error);
    this.errorHandlers.forEach(handler => handler(error));
  }

  getSdkTransport(): any | null {
    return this.transport;
  }
}