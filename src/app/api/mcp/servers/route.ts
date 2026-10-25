import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import { z } from 'zod/v3';

// Schema for MCP server configuration
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

// Built-in servers that mirror current implementation
const BUILTIN_SERVERS: McpServer[] = [
  {
    id: 'zapier',
    name: 'Zapier MCP',
    description: 'Built-in Zapier integration for Gmail, Calendar, and productivity tools',
    endpoint: env.MCP_ZAPIER_ENDPOINT || 'https://zapier-mcp.example.com',
    type: 'http' as const,
    enabled: !!env.MCP_ZAPIER_ENDPOINT,
    settings: {
      timeout: 30000,
      retryAttempts: 3,
      enabledInChat: true,
      enabledInEmbed: false,
      yoloMode: env.NEXT_PUBLIC_MCP_YOLO_MODE_ENABLED === 'true',
    }
  }
].filter(server => server.enabled);

// Helper functions for managing custom servers
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

// GET /api/mcp/servers - List all servers
export async function GET() {
  try {
    console.log('MCP Servers API: Fetching all MCP servers');
    
    const customServers = await loadCustomServers();
    const allServers = [...BUILTIN_SERVERS, ...customServers];
    
    console.log(`MCP Servers API: Found ${BUILTIN_SERVERS.length} built-in and ${customServers.length} custom servers`);
    
    return NextResponse.json({
      servers: allServers,
      builtinCount: BUILTIN_SERVERS.length,
      customCount: customServers.length,
      totalCount: allServers.length,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('MCP Servers API: Error fetching servers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch MCP servers' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      }
    );
  }
}

// POST /api/mcp/servers - Add new custom server
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('MCP Servers API: Adding new server:', body.name);
    
    // Validate the server configuration
    const serverConfig = McpServerSchema.parse(body);
    
    // Load existing custom servers
    const customServers = await loadCustomServers();
    
    // Check for duplicate IDs
    const existingServer = customServers.find(s => s.id === serverConfig.id);
    if (existingServer) {
      return NextResponse.json(
        { error: `Server with ID '${serverConfig.id}' already exists` },
        { 
          status: 409,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        }
      );
    }
    
    // Check for duplicate built-in server IDs
    const builtinServer = BUILTIN_SERVERS.find(s => s.id === serverConfig.id);
    if (builtinServer) {
      return NextResponse.json(
        { error: `Cannot use built-in server ID '${serverConfig.id}'` },
        { 
          status: 409,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        }
      );
    }
    
    // Add timestamps
    const newServer: McpServer = {
      ...serverConfig,
      // Add any server-side defaults
    };
    
    // Save to custom servers
    const updatedServers = [...customServers, newServer];
    await saveCustomServers(updatedServers);
    
    console.log(`MCP Servers API: Successfully added server '${newServer.name}'`);
    
    return NextResponse.json({
      server: newServer,
      message: `Server '${newServer.name}' added successfully`,
    }, { 
      status: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error: any) {
    console.error('MCP Servers API: Error adding server:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid server configuration', details: error.errors },
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
    
    return NextResponse.json(
      { error: 'Failed to add MCP server' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      }
    );
  }
}

// OPTIONS /api/mcp/servers - Handle CORS preflight requests
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

// PUT /api/mcp/servers/[id] - Update server (handled by dynamic route)
// DELETE /api/mcp/servers/[id] - Delete server (handled by dynamic route)
// POST /api/mcp/servers/[id]/test - Test server connection (handled by dynamic route) 