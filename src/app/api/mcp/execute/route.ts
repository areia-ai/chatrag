import { NextRequest, NextResponse } from 'next/server';
import { UniversalMcpClient, executeAnyTool } from '@/lib/mcp/universal-client';
import { logger } from '@/lib/logger';

// Define interfaces for the request and response
interface ToolExecutionRequest {
  toolName: string;
  parameters: Record<string, any>;
  sessionId?: string;
  approved?: boolean;
}

interface ToolExecutionResponse {
  success: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
  requiresApproval?: boolean;
  metadata?: {
    server: string;
    executionTime: number;
    toolName: string;
  };
}

/**
 * Universal MCP Tool Execution Endpoint
 * 
 * This endpoint can execute ANY workflow exposed as an MCP tool
 * without requiring code changes. It uses the Universal MCP Client
 * to dynamically discover and execute tools.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    const requestData = await req.json() as ToolExecutionRequest;
    const { toolName, parameters, sessionId, approved } = requestData;
    
    logger.mcp(`Received execution request for tool: ${toolName} (approved: ${approved})`);

    // Validate required fields
    if (!toolName) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'MISSING_TOOL_NAME',
          message: 'Tool name is required'
        }
      } as ToolExecutionResponse, { status: 400 });
    }

    // Check if YOLO mode is enabled
    const yoloModeEnabled = process.env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true';
    
    // Check if the tool requires approval and if it's been approved
    if (!approved && !yoloModeEnabled) {
      logger.mcp(`Tool ${toolName} requires explicit approval (YOLO mode: ${yoloModeEnabled})`);
      return NextResponse.json({
        success: false,
        requiresApproval: true,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: 'This tool requires explicit user approval before execution.'
        }
      } as ToolExecutionResponse, { status: 202 }); // 202 Accepted but not processed
    }
    
    // Log if YOLO mode auto-approved
    if (!approved && yoloModeEnabled) {
      logger.mcp(`Tool ${toolName} auto-approved via YOLO mode`);
    }

    // Execute the tool using the Universal MCP Client
    logger.mcp(`Executing approved tool: ${toolName}`);
    const result = await executeAnyTool(toolName, parameters || {});
    
    const totalExecutionTime = Date.now() - startTime;
    
    if (result.success) {
      logger.mcp(`Tool ${toolName} executed successfully in ${totalExecutionTime}ms`);
      
      return NextResponse.json({
        success: true,
        result: result.data,
        metadata: {
          ...result.metadata,
          totalExecutionTime
        }
      } as ToolExecutionResponse);
    } else {
      logger.error('MCP-Execute', `Tool ${toolName} execution failed`, {
        error: result.error,
        executionTime: totalExecutionTime,
        server: result.metadata?.server
      });
      
      return NextResponse.json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: result.error || 'Tool execution failed'
        },
        metadata: {
          ...result.metadata,
          totalExecutionTime
        }
      } as ToolExecutionResponse, { status: 500 });
    }

  } catch (error: any) {
    const totalExecutionTime = Date.now() - startTime;
    
    logger.error('MCP-Execute', 'Error in tool execution endpoint', {
      error: error.message,
      stack: error.stack,
      executionTime: totalExecutionTime
    });
    
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: `Failed to execute MCP tool: ${error.message}`
      },
      metadata: {
        server: 'unknown',
        executionTime: totalExecutionTime,
        toolName: 'unknown'
      }
    } as ToolExecutionResponse, { status: 500 });
  }
}

/**
 * Health check endpoint for the universal MCP execution service
 */
export async function GET(req: NextRequest) {
  try {
    const client = UniversalMcpClient.getInstance();
    const connectionStatus = client.getConnectionStatus();
    const tools = await client.discoverAllTools();
    
    return NextResponse.json({
      status: 'healthy',
      connections: connectionStatus,
      toolCount: tools.length,
      availableTools: tools.map(tool => ({
        name: tool.name,
        server: tool.server,
        description: tool.description
      }))
    });
    
  } catch (error: any) {
    logger.error('MCP-Execute', 'Health check failed', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      error: error.message
    }, { status: 500 });
  }
} 