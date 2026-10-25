import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod/v3';

// Re-use the same schema from the main route
const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  endpoint: z.string().url(),
  type: z.enum(['http', 'sse']).default('http'),
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'api-key', 'basic']).default('none'),
    credentials: z.object({
      token: z.string().optional(),
      apiKey: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional(),
  }).optional(),
  settings: z.object({
    timeout: z.number().default(30000),
    retryAttempts: z.number().default(3),
    enabledInChat: z.boolean().default(true),
    enabledInEmbed: z.boolean().default(false),
  }).optional(),
  enabled: z.boolean().default(true),
});

type McpServer = z.infer<typeof McpServerSchema>;

// Helper functions (duplicated for now, could be moved to shared module)
function getEnvFilePath(): string {
  return path.join(process.cwd(), '.env.local');
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();
        env[key] = value;
      }
    }
  }
  
  return env;
}

async function loadCustomServers(): Promise<McpServer[]> {
  try {
    const envPath = getEnvFilePath();
    if (!fs.existsSync(envPath)) {
      return [];
    }
    
    const content = fs.readFileSync(envPath, 'utf-8');
    const env = parseEnvFile(content);
    
    const customServersJson = env.MCP_CUSTOM_SERVERS;
    if (!customServersJson) {
      return [];
    }
    
    const customServers = JSON.parse(customServersJson);
    return Array.isArray(customServers) ? customServers : [];
  } catch (error) {
    console.error('Error loading custom MCP servers for testing:', error);
    return [];
  }
}

async function testServerConnection(server: McpServer): Promise<{ success: boolean; message: string; latency?: number }> {
  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), server.settings?.timeout || 30000);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Add authentication headers if configured
    if (server.authentication?.type === 'bearer' && server.authentication.credentials?.token) {
      headers['Authorization'] = `Bearer ${server.authentication.credentials.token}`;
    } else if (server.authentication?.type === 'api-key' && server.authentication.credentials?.apiKey) {
      headers['X-API-Key'] = server.authentication.credentials.apiKey;
    } else if (server.authentication?.type === 'basic' && server.authentication.credentials?.username && server.authentication.credentials?.password) {
      const credentials = btoa(`${server.authentication.credentials.username}:${server.authentication.credentials.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }
    
    const response = await fetch(server.endpoint, {
      method: 'HEAD',
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;
    
    if (response.ok || response.status < 500) {
      return {
        success: true,
        message: `Connection successful (${response.status})`,
        latency,
      };
    } else {
      return {
        success: false,
        message: `Server error: ${response.status} ${response.statusText}`,
        latency,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.name === 'AbortError' ? 'Connection timeout' : `Connection failed: ${error.message}`,
    };
  }
}

async function discoverTools(server: McpServer): Promise<{ success: boolean; tools?: any[]; message: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), server.settings?.timeout || 30000);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Add authentication headers if configured
    if (server.authentication?.type === 'bearer' && server.authentication.credentials?.token) {
      headers['Authorization'] = `Bearer ${server.authentication.credentials.token}`;
    } else if (server.authentication?.type === 'api-key' && server.authentication.credentials?.apiKey) {
      headers['X-API-Key'] = server.authentication.credentials.apiKey;
    } else if (server.authentication?.type === 'basic' && server.authentication.credentials?.username && server.authentication.credentials?.password) {
      const credentials = btoa(`${server.authentication.credentials.username}:${server.authentication.credentials.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }
    
    // Try common MCP tool discovery endpoints
    const discoveryEndpoints = [
      '/tools',
      '/discover',
      '/capabilities',
      '',
    ];
    
    for (const endpoint of discoveryEndpoints) {
      try {
        const url = server.endpoint + endpoint;
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        
        if (response.ok) {
          const data = await response.json();
          clearTimeout(timeoutId);
          
          // Try to extract tools from various response formats
          let tools = [];
          if (data.tools) {
            tools = Array.isArray(data.tools) ? data.tools : [data.tools];
          } else if (Array.isArray(data)) {
            tools = data;
          } else if (data.capabilities) {
            tools = Array.isArray(data.capabilities) ? data.capabilities : [data.capabilities];
          }
          
          return {
            success: true,
            tools,
            message: `Discovered ${tools.length} tools from ${url}`,
          };
        }
      } catch (endpointError) {
        // Continue to next endpoint
        continue;
      }
    }
    
    clearTimeout(timeoutId);
    return {
      success: false,
      message: 'No discoverable tools endpoint found. The server may need manual tool configuration.',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.name === 'AbortError' ? 'Tool discovery timeout' : `Tool discovery failed: ${error.message}`,
    };
  }
}

// POST /api/mcp/servers/[id]/test - Test server connection and discover tools
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { action } = body;
    
    console.log(`MCP Server Test API: ${action} for server with ID: ${id}`);
    
    // Load the server configuration
    const customServers = await loadCustomServers();
    const server = customServers.find(s => s.id === id);
    
    if (!server) {
      return NextResponse.json(
        { error: `Server with ID '${id}' not found` },
        { status: 404 }
      );
    }
    
    if (action === 'test') {
      // Test connection
      const result = await testServerConnection(server);
      return NextResponse.json(result, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    } else if (action === 'discover') {
      // Discover tools
      const result = await discoverTools(server);
      return NextResponse.json(result, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Supported actions: test, discover' },
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        }
      );
    }
  } catch (error) {
    console.error(`MCP Server Test API: Error in action for server ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Failed to perform server action' },
      { status: 500 }
    );
  }
}

// OPTIONS /api/mcp/servers/[id]/test - Handle CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
} 