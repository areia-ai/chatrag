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
    yoloMode: z.boolean().default(false),
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

function stringifyEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
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
    console.error('Error loading custom MCP servers:', error);
    return [];
  }
}

async function saveCustomServers(servers: McpServer[]): Promise<void> {
  try {
    const envPath = getEnvFilePath();
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    
    const serversJson = JSON.stringify(servers);
    
    // Check if MCP_CUSTOM_SERVERS already exists in the file
    if (content.includes('MCP_CUSTOM_SERVERS=')) {
      // Update the existing value using regex replacement
      content = content.replace(
        /MCP_CUSTOM_SERVERS=(.*)(\r?\n|$)/,
        `MCP_CUSTOM_SERVERS=${serversJson}$2`
      );
    } else {
      // Add the MCP_CUSTOM_SERVERS to the file
      // Look for an existing MCP section or add at the end
      if (content.includes('# MCP')) {
        // Add it in the MCP section
        content = content.replace(
          /(# MCP.*?)(\r?\n)(\r?\n|$)/,
          `$1$2MCP_CUSTOM_SERVERS=${serversJson}$2$3`
        );
      } else {
        // Add a new MCP section at the end
        if (!content.endsWith('\n')) content += '\n';
        content += `# MCP Custom Servers Configuration\nMCP_CUSTOM_SERVERS=${serversJson}\n`;
      }
    }
    
    fs.writeFileSync(envPath, content);
    console.log('MCP Servers: Successfully updated .env.local file');
  } catch (error) {
    console.error('Error saving custom MCP servers:', error);
    throw new Error('Failed to save MCP server configuration');
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

// GET /api/mcp/servers/[id] - Get specific server
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    console.log(`MCP Server API: Fetching server with ID: ${id}`);
    
    const customServers = await loadCustomServers();
    const server = customServers.find(s => s.id === id);
    
    if (!server) {
      return NextResponse.json(
        { error: `Server with ID '${id}' not found` },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ server }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error(`MCP Server API: Error fetching server ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch MCP server' },
      { status: 500 }
    );
  }
}

// PUT /api/mcp/servers/[id] - Update server
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    console.log(`MCP Server API: Updating server with ID: ${id}`);
    
    // Validate the server configuration
    const serverConfig = McpServerSchema.parse(body);
    
    // Ensure the ID matches
    if (serverConfig.id !== id) {
      return NextResponse.json(
        { error: 'Server ID in URL does not match server ID in body' },
        { status: 400 }
      );
    }
    
    // Load existing custom servers
    const customServers = await loadCustomServers();
    const serverIndex = customServers.findIndex(s => s.id === id);
    
    if (serverIndex === -1) {
      return NextResponse.json(
        { error: `Server with ID '${id}' not found` },
        { status: 404 }
      );
    }
    
    // Update the server
    customServers[serverIndex] = serverConfig;
    await saveCustomServers(customServers);
    
    console.log(`MCP Server API: Successfully updated server '${serverConfig.name}'`);
    
    return NextResponse.json({
      server: serverConfig,
      message: `Server '${serverConfig.name}' updated successfully`,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error: any) {
    console.error(`MCP Server API: Error updating server ${params.id}:`, error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid server configuration', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to update MCP server' },
      { status: 500 }
    );
  }
}

// DELETE /api/mcp/servers/[id] - Delete server
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    console.log(`MCP Server API: Deleting server with ID: ${id}`);
    
    // Built-in servers cannot be deleted
    if (id === 'zapier') {
      return NextResponse.json(
        { error: 'Built-in servers cannot be deleted' },
        { status: 400 }
      );
    }
    
    // Load existing custom servers
    const customServers = await loadCustomServers();
    const serverIndex = customServers.findIndex(s => s.id === id);
    
    if (serverIndex === -1) {
      return NextResponse.json(
        { error: `Server with ID '${id}' not found` },
        { status: 404 }
      );
    }
    
    // Remove the server
    const deletedServer = customServers.splice(serverIndex, 1)[0];
    await saveCustomServers(customServers);
    
    console.log(`MCP Server API: Successfully deleted server '${deletedServer.name}'`);
    
    return NextResponse.json({
      message: `Server '${deletedServer.name}' deleted successfully`,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error(`MCP Server API: Error deleting server ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Failed to delete MCP server' },
      { status: 500 }
    );
  }
}

// POST /api/mcp/servers/[id]/test - Test server connection
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await req.json();
    const { action } = body;
    
    console.log(`MCP Server API: ${action} for server with ID: ${id}`);
    
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
      return NextResponse.json(result);
    } else if (action === 'discover') {
      // Discover tools
      const result = await discoverTools(server);
      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Supported actions: test, discover' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error(`MCP Server API: Error in action for server ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Failed to perform server action' },
      { status: 500 }
    );
  }
}

// OPTIONS /api/mcp/servers/[id] - Handle CORS preflight requests
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