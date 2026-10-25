import { NextRequest, NextResponse } from 'next/server';
import { discoverAllTools } from '@/lib/mcp/universal-client';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Universal MCP Tools API Endpoint
 * 
 * This endpoint dynamically discovers all available tools from connected
 * MCP servers without requiring hardcoded tool definitions.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    logger.mcp('Fetching all available MCP tools...');
    
    // Use the Universal MCP Client to discover all tools
    const allTools = await discoverAllTools();
    
    // Group tools by server for better organization
    const toolsByServer: Record<string, any[]> = {};
    
    for (const tool of allTools) {
      if (!toolsByServer[tool.server]) {
        toolsByServer[tool.server] = [];
      }
      
      toolsByServer[tool.server].push({
        name: tool.name,
        description: tool.description,
        server: tool.server,
        requiresApproval: tool.requiresApproval ?? true,
        enabled: tool.enabled ?? true,
        category: 'workflow', // Workflow-based tools
        inputSchema: tool.inputSchema
      });
    }
    
    const executionTime = Date.now() - startTime;
    
    logger.mcp(`Discovered ${allTools.length} tools from ${Object.keys(toolsByServer).length} servers in ${executionTime}ms`);
    
    // Return the tools grouped by server
    return NextResponse.json({
      success: true,
      toolsByServer,
      metadata: {
        totalTools: allTools.length,
        totalServers: Object.keys(toolsByServer).length,
        discoveryTime: executionTime,
        servers: Object.keys(toolsByServer).map(serverName => ({
          name: serverName,
          toolCount: toolsByServer[serverName].length,
          connected: true // If we got tools, the server is connected
        }))
      }
    });
    
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    logger.error('MCP-Tools-API', 'Error discovering MCP tools', {
      error: error.message,
      stack: error.stack,
      executionTime
    });
    
    return NextResponse.json({
      success: false,
      error: {
        code: 'DISCOVERY_FAILED',
        message: `Failed to discover MCP tools: ${error.message}`
      },
      metadata: {
        totalTools: 0,
        totalServers: 0,
        discoveryTime: executionTime,
        servers: []
      }
    }, { status: 500 });
  }
}

/**
 * Refresh the tool cache (force rediscovery)
 */
export async function POST(request: NextRequest) {
  try {
    const { clearUniversalCache } = await import('@/lib/mcp/universal-client');
    
    logger.mcp('Clearing MCP tools cache and forcing rediscovery...');
    
    // Clear the cache to force fresh discovery
    clearUniversalCache();
    
    // Rediscover tools
    const allTools = await discoverAllTools();
    
    logger.mcp(`Cache cleared and rediscovered ${allTools.length} tools`);
    
    return NextResponse.json({
      success: true,
      message: 'Tool cache cleared and tools rediscovered',
      toolCount: allTools.length
    });
    
  } catch (error: any) {
    logger.error('MCP-Tools-API', 'Error refreshing MCP tools cache', error);
    
    return NextResponse.json({
      success: false,
      error: {
        code: 'REFRESH_FAILED',
        message: `Failed to refresh tools cache: ${error.message}`
      }
    }, { status: 500 });
  }
} 