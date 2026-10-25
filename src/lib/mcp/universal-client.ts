/**
 * Universal MCP Client
 * 
 * This client provides a completely universal interface to any MCP server
 * without any hardcoded tool-specific logic. It dynamically discovers and 
 * executes any MCP tool using the appropriate transport.
 */

import { logger } from '@/lib/logger';
import { discoverAllMcpServers, type McpEndpoint } from './discovery';
import { TransportFactory, McpTransport } from './transport-factory';
import { createMCPClient } from '@ai-sdk/mcp';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface McpTool {
  name: string;
  description: string;
  server: string;
  inputSchema: any;
  parameters?: Record<string, any>;
  requiresApproval?: boolean;
  enabled?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    server: string;
    executionTime: number;
    toolName: string;
  };
}

/**
 * Universal MCP Client with automatic tool discovery and execution
 */
export class UniversalMcpClient {
  private static instance: UniversalMcpClient;
  private mcpTransports: Map<string, McpTransport> = new Map();
  private toolCache: Map<string, McpTool[]> = new Map();
  private schemaCache: Map<string, ToolSchema> = new Map();
  private transportFactory: TransportFactory;
  private readonly cacheTTL = 60000; // 1 minute cache for tools
  private lastCacheUpdate = 0;

  private constructor() {
    this.transportFactory = TransportFactory.getInstance();
    logger.startup('UniversalMCP', 'Universal MCP Client initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UniversalMcpClient {
    if (!UniversalMcpClient.instance) {
      UniversalMcpClient.instance = new UniversalMcpClient();
    }
    return UniversalMcpClient.instance;
  }

  /**
   * Get all tools compatible with AI SDK 6
   * Uses the official @ai-sdk/mcp adapter for automatic Zod schema conversion
   */
  async getAiSdkTools(): Promise<Record<string, any>> {
    logger.mcp('Getting AI SDK tools via native adapter...');

    // Ensure we have discovered servers
    if (!this.isCacheValid()) {
      await this.discoverAllTools();
    }

    const allSdkTools: Record<string, any> = {};

    // Iterate through all active transports
    for (const [serverName, transport] of this.mcpTransports.entries()) {
      try {
        // Safe cast to access underlying transport
        // We know our transports return the SDK transport object
        const sdkTransport = transport.getSdkTransport();

        if (sdkTransport) {
          // Create AI SDK wrapper around the existing connected client's transport
          // Note: createMCPClient creates a NEW client instance. 
          // Reusing the same transport object might be risky if the SDK closes it on cleanup.
          // However, for tool discovery, it should be fine.
          // Ideally, we should reuse the same Client, but @ai-sdk/mcp currently takes a Transport.

          const mcpClient = createMCPClient(sdkTransport);

          // Get tools with automatic Zod schemas
          const tools = await mcpClient.tools();

          // Add to collection
          Object.assign(allSdkTools, tools);

          logger.mcp(`Added ${Object.keys(tools).length} AI SDK tools from ${serverName}`);
        } else {
          logger.warn('UniversalMCP', `Transport for ${serverName} does not expose SDK transport`);
        }
      } catch (error) {
        logger.error('UniversalMCP', `Error converting tools for ${serverName}`, error);
      }
    }

    return allSdkTools;
  }

  /**
   * Discover all available tools from all connected MCP servers
   */
  async discoverAllTools(): Promise<McpTool[]> {
    // Check cache first
    if (this.isCacheValid()) {
      const cachedTools: McpTool[] = [];
      for (const tools of this.toolCache.values()) {
        cachedTools.push(...tools);
      }
      logger.mcp(`Returning ${cachedTools.length} cached tools`);
      return cachedTools;
    }

    logger.mcp('Discovering tools from all MCP servers...');
    const allTools: McpTool[] = [];

    try {
      const endpoints = await discoverAllMcpServers();

      for (const endpoint of endpoints) {
        try {
          const tools = await this.discoverToolsFromServer(endpoint);
          allTools.push(...tools);

          // Cache tools for this server
          this.toolCache.set(endpoint.name, tools);

          logger.mcp(`Discovered ${tools.length} tools from ${endpoint.name}`);
        } catch (error) {
          logger.warn('UniversalMCP', `Failed to discover tools from ${endpoint.name}`, error);
        }
      }

      this.lastCacheUpdate = Date.now();
      logger.mcp(`Total tools discovered: ${allTools.length}`);

      return allTools;

    } catch (error) {
      logger.error('UniversalMCP', 'Error discovering tools', error);
      return [];
    }
  }

  /**
   * Discover tools from a specific MCP server
   */
  private async discoverToolsFromServer(endpoint: McpEndpoint): Promise<McpTool[]> {
    try {
      const transport = await this.getOrCreateTransport(endpoint);

      if (!transport) {
        logger.warn('UniversalMCP', `Could not create transport for ${endpoint.name}`);
        return [];
      }

      // Get tools from the transport
      const toolsResponse = await transport.listTools();

      // Handle different response formats from MCP servers
      let tools: any[] = [];

      if (toolsResponse && typeof toolsResponse === 'object') {
        // The listTools() method returns an object with tool names as keys
        // Convert it to an array of tools
        tools = Object.entries(toolsResponse).map(([toolName, toolDef]: [string, any]) => ({
          name: toolName,
          description: toolDef.description || `Tool from ${endpoint.name}`,
          inputSchema: toolDef.inputSchema || toolDef.schema || {},
          inputSchema: toolDef.parameters || {}
        }));
      } else if (Array.isArray(toolsResponse)) {
        tools = toolsResponse;
      } else {
        logger.warn('UniversalMCP', `Unexpected tools response format from ${endpoint.name}:`, toolsResponse);
        return [];
      }

      // Validate that we have an array
      if (!Array.isArray(tools)) {
        logger.warn('UniversalMCP', `Tools response is not an array for ${endpoint.name}:`, tools);
        return [];
      }

      // Transform to our universal format
      const universalTools: McpTool[] = tools.map((tool: any) => ({
        name: tool.name || `unknown-tool-${Date.now()}`,
        description: tool.description || `Tool from ${endpoint.name}`,
        server: endpoint.name,
        inputSchema: tool.inputSchema || tool.schema || {},
        requiresApproval: true, // All MCP tools require approval by default
        enabled: true
      }));

      // Cache schemas for each tool
      universalTools.forEach(tool => {
        this.schemaCache.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      });

      return universalTools;

    } catch (error) {
      logger.error('UniversalMCP', `Error discovering tools from ${endpoint.name}`, error);

      // Remove the disconnected transport from the map
      if (this.mcpTransports.has(endpoint.name)) {
        logger.mcp(`Removing disconnected transport for ${endpoint.name}`);
        const transport = this.mcpTransports.get(endpoint.name);
        await transport?.disconnect();
        this.mcpTransports.delete(endpoint.name);
      }

      // Also remove from tool cache
      if (this.toolCache.has(endpoint.name)) {
        this.toolCache.delete(endpoint.name);
      }

      return [];
    }
  }

  /**
   * Execute any tool with universal parameter handling
   */
  async executeAnyTool(toolName: string, parameters: any): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      logger.mcp(`Executing tool: ${toolName}`);
      logger.mcp(`Parameters: ${JSON.stringify(parameters)}`);

      // Find which server provides this tool
      const server = await this.findServerForTool(toolName);
      if (!server) {
        throw new Error(`No server found for tool: ${toolName}`);
      }

      // Get the transport for this server
      const transport = await this.getOrCreateTransport(server);
      if (!transport) {
        throw new Error(`Could not create transport for server: ${server.name}`);
      }

      // Execute the tool using the transport
      const result = await transport.executeTool(toolName, parameters);

      const executionTime = Date.now() - startTime;

      logger.mcp(`Tool ${toolName} executed successfully in ${executionTime}ms`);

      return {
        success: true,
        data: result,
        metadata: {
          server: server.name,
          executionTime,
          toolName
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('UniversalMCP', `Error executing tool ${toolName}`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          server: 'unknown',
          executionTime,
          toolName
        }
      };
    }
  }

  /**
   * Get tool schema for parameter validation
   */
  async getToolSchema(toolName: string): Promise<ToolSchema | null> {
    // Check cache first
    if (this.schemaCache.has(toolName)) {
      return this.schemaCache.get(toolName)!;
    }

    // If not cached, try to discover it
    await this.discoverAllTools();

    return this.schemaCache.get(toolName) || null;
  }

  /**
   * Find which server provides a specific tool
   */
  private async findServerForTool(toolName: string): Promise<McpEndpoint | null> {
    const endpoints = await discoverAllMcpServers();

    // First, try to find by checking cached tools
    for (const [serverName, tools] of this.toolCache.entries()) {
      if (tools.some(tool => tool.name === toolName)) {
        return endpoints.find(e => e.name === serverName) || null;
      }
    }

    // If not found in cache, discover tools and try again
    await this.discoverAllTools();

    for (const [serverName, tools] of this.toolCache.entries()) {
      if (tools.some(tool => tool.name === toolName)) {
        return endpoints.find(e => e.name === serverName) || null;
      }
    }

    logger.warn('UniversalMCP', `No server found for tool: ${toolName}`);
    return null;
  }

  /**
   * Get or create MCP transport for a server
   */
  private async getOrCreateTransport(endpoint: McpEndpoint): Promise<McpTransport | null> {
    // Check if we already have a transport for this server
    if (this.mcpTransports.has(endpoint.name)) {
      const existingTransport = this.mcpTransports.get(endpoint.name)!;

      // Check if transport is still connected
      if (existingTransport.isConnected()) {
        return existingTransport;
      } else {
        logger.warn('UniversalMCP', `Existing transport for ${endpoint.name} is disconnected, creating new one`);
        this.mcpTransports.delete(endpoint.name);
      }
    }

    try {
      logger.mcp(`Creating transport for ${endpoint.name}`);

      // Get server configuration or create default
      const config = endpoint.config || {
        id: endpoint.name.toLowerCase(),
        name: endpoint.name,
        endpoint: endpoint.url,
        transport: {
          type: (endpoint.type || 'streamable-http') as any
        }
      } as any;

      // Create transport using factory
      const transport = this.transportFactory.createTransport(config);

      // Connect to the server
      await transport.connect();

      // Test the connection by attempting to list tools
      try {
        logger.mcp(`Testing connection to ${endpoint.name}...`);
        const testResponse = await transport.listTools();
        logger.mcp(`Connection test successful for ${endpoint.name}. Found ${Object.keys(testResponse || {}).length} tools`);
      } catch (testError) {
        logger.warn('UniversalMCP', `Connection test failed for ${endpoint.name}`, testError);
        // Don't fail completely - some servers might have different implementations
      }

      // Cache the transport
      this.mcpTransports.set(endpoint.name, transport);

      logger.mcp(`Successfully created and cached transport for ${endpoint.name}`);
      return transport;

    } catch (error) {
      logger.error('UniversalMCP', `Failed to create transport for ${endpoint.name}`, error);

      // Clean up any existing disconnected transport
      if (this.mcpTransports.has(endpoint.name)) {
        logger.mcp(`Removing failed transport for ${endpoint.name}`);
        const transport = this.mcpTransports.get(endpoint.name);
        await transport?.disconnect();
        this.mcpTransports.delete(endpoint.name);
      }

      // Also remove from tool cache to force rediscovery
      if (this.toolCache.has(endpoint.name)) {
        this.toolCache.delete(endpoint.name);
      }

      return null;
    }
  }

  /**
   * Check if tool cache is still valid
   */
  private isCacheValid(): boolean {
    // Check if cache time is still valid
    if ((Date.now() - this.lastCacheUpdate) >= this.cacheTTL) {
      return false;
    }

    // Check if we have cached tools
    if (this.toolCache.size === 0) {
      return false;
    }

    // Check if all cached servers still have active transports
    for (const serverName of this.toolCache.keys()) {
      const transport = this.mcpTransports.get(serverName);
      if (!transport || !transport.isConnected()) {
        // Server transport is missing or disconnected, cache is invalid
        logger.mcp(`Cache invalid: Transport for ${serverName} is disconnected`);
        return false;
      }
    }

    return true;
  }

  /**
   * Clear all caches (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.toolCache.clear();
    this.schemaCache.clear();
    this.lastCacheUpdate = 0;
    logger.mcp('All caches cleared');
  }

  /**
   * Disconnect all MCP transports
   */
  async disconnect(): Promise<void> {
    for (const [name, transport] of this.mcpTransports.entries()) {
      try {
        await transport.disconnect();
        logger.mcp(`Disconnected transport: ${name}`);
      } catch (error) {
        logger.warn('UniversalMCP', `Error disconnecting transport ${name}`, error);
      }
    }

    this.mcpTransports.clear();
    this.clearCache();
    logger.mcp('All MCP transports disconnected');
  }

  /**
   * Get connection status for all servers
   */
  getConnectionStatus(): { server: string; connected: boolean }[] {
    const endpoints = Array.from(this.mcpTransports.keys());
    return endpoints.map(server => {
      const transport = this.mcpTransports.get(server);
      return {
        server,
        connected: transport ? transport.isConnected() : false
      };
    });
  }

  /**
   * Enhanced connection health check with comprehensive diagnostics
   */
  async getConnectionHealth(): Promise<{
    server: string;
    connected: boolean;
    endpoint?: string;
    lastConnected?: Date;
    lastError?: string;
    diagnostics: {
      canConnect: boolean;
      canListTools: boolean;
      canExecuteTools: boolean;
      responseTime: number;
      toolCount: number;
      errorDetails?: string;
    };
  }[]> {
    const healthResults = [];

    logger.mcp('🔍 [HEALTH CHECK] Starting enhanced connection health check...');

    for (const [serverName, transport] of this.mcpTransports.entries()) {
      const startTime = Date.now();
      const diagnostics = {
        canConnect: false,
        canListTools: false,
        canExecuteTools: false,
        responseTime: 0,
        toolCount: 0,
        errorDetails: undefined as string | undefined
      };

      try {
        // Test basic connection
        diagnostics.canConnect = transport.isConnected();

        if (diagnostics.canConnect) {
          // Test tool listing
          try {
            const tools = await transport.listTools();
            diagnostics.canListTools = true;
            diagnostics.toolCount = tools ? Object.keys(tools).length : 0;

            logger.mcp(`🔍 [HEALTH CHECK] ${serverName}: Found ${diagnostics.toolCount} tools`);

            // Test basic tool execution readiness (don't actually execute)
            if (diagnostics.toolCount > 0) {
              diagnostics.canExecuteTools = true;
            }

          } catch (toolError) {
            diagnostics.errorDetails = `Tool listing failed: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
            logger.error('UniversalMcpClient', `Tool listing failed for ${serverName}`, toolError);
          }
        } else {
          diagnostics.errorDetails = 'Transport not connected';
        }

        diagnostics.responseTime = Date.now() - startTime;

        healthResults.push({
          server: serverName,
          connected: diagnostics.canConnect,
          // Use safe casting to access endpoint if available
          endpoint: (transport as any).endpoint,
          lastConnected: diagnostics.canConnect ? new Date() : undefined,
          diagnostics
        });

        logger.mcp(`🔍 [HEALTH CHECK] ${serverName}: ${diagnostics.canConnect ? '✅ Connected' : '❌ Disconnected'}, ${diagnostics.toolCount} tools, ${diagnostics.responseTime}ms`);

      } catch (error) {
        diagnostics.responseTime = Date.now() - startTime;
        diagnostics.errorDetails = error instanceof Error ? error.message : 'Unknown error';

        healthResults.push({
          server: serverName,
          connected: false,
          endpoint: (transport as any).endpoint,
          lastError: diagnostics.errorDetails,
          diagnostics
        });

        logger.error('UniversalMcpClient', `Health check failed for ${serverName}`, error);
      }
    }

    logger.mcp('🔍 [HEALTH CHECK] Enhanced health check complete:', healthResults);
    return healthResults;
  }

  /**
   * Reset MCP state for a new chat session
   * This ensures MCP tools don't persist between different chats
   */
  async resetForNewChat(): Promise<void> {
    logger.mcp('Resetting MCP state for new chat session');

    // Disconnect all transports and clear caches
    await this.disconnect();

    // Reset the cache timestamp to force fresh discovery
    this.lastCacheUpdate = 0;

    // Clear the singleton instance to ensure complete reset
    UniversalMcpClient.instance = null as any;

    logger.mcp('MCP state reset complete - ready for new chat');
  }

  /**
   * Force reset the singleton instance
   * This creates a completely fresh instance for the next use
   */
  static resetInstance(): void {
    if (UniversalMcpClient.instance) {
      // Disconnect all transports before resetting
      UniversalMcpClient.instance.disconnect().catch(error => {
        logger.warn('UniversalMCP', 'Error during instance reset disconnect', error);
      });
    }
    UniversalMcpClient.instance = null as any;
    logger.mcp('UniversalMcpClient instance reset - will create fresh instance on next use');
  }
}

// Export singleton functions for easy access
export async function discoverAllTools(): Promise<McpTool[]> {
  const client = UniversalMcpClient.getInstance();
  return client.discoverAllTools();
}

export async function getAiSdkTools(): Promise<Record<string, any>> {
  const client = UniversalMcpClient.getInstance();
  return client.getAiSdkTools();
}

export async function executeAnyTool(toolName: string, parameters: any): Promise<ToolExecutionResult> {
  const client = UniversalMcpClient.getInstance();
  return client.executeAnyTool(toolName, parameters);
}

export async function getToolSchema(toolName: string): Promise<ToolSchema | null> {
  const client = UniversalMcpClient.getInstance();
  return client.getToolSchema(toolName);
}

export function clearUniversalCache(): void {
  const client = UniversalMcpClient.getInstance();
  client.clearCache();
}

export async function resetMcpForNewChat(): Promise<void> {
  // Use static reset to ensure complete cleanup
  UniversalMcpClient.resetInstance();
  logger.mcp('MCP client instance fully reset for new chat');
} 