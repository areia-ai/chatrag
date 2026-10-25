import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { UniversalMcpClient } from '@/lib/mcp/universal-client';

/**
 * Enhanced MCP Health Check API with detailed diagnostics
 */
export async function GET() {
  console.log('🔍 [MCP HEALTH API] Starting comprehensive health check');
  
  const healthResults = {
    overall: 'unknown' as 'healthy' | 'degraded' | 'unhealthy',
    timestamp: new Date().toISOString(),
    zapier: {
      configured: false,
      reachable: false,
      endpoint: '',
      diagnostics: {
        canConnect: false,
        canListTools: false,
        toolCount: 0,
        responseTime: 0,
        lastError: null as string | null
      }
    },
    universalClient: {
      initialized: false,
      connectionCount: 0,
      toolCache: {
        size: 0,
        lastUpdate: null as string | null
      },
      healthDetails: [] as any[]
    },
    recommendations: [] as string[]
  };
  
  // Check Zapier configuration
  if (env.MCP_ZAPIER_ENDPOINT) {
    healthResults.zapier.configured = true;
    healthResults.zapier.endpoint = env.MCP_ZAPIER_ENDPOINT;
    
    try {
      const startTime = Date.now();
      console.log('🔍 [MCP HEALTH API] Testing Zapier endpoint:', env.MCP_ZAPIER_ENDPOINT);
      
      // Test basic connectivity
      const response = await fetch(env.MCP_ZAPIER_ENDPOINT, {
        method: 'HEAD',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      healthResults.zapier.reachable = response.ok;
      healthResults.zapier.diagnostics.responseTime = Date.now() - startTime;
      healthResults.zapier.diagnostics.canConnect = response.ok;
      
      console.log('🔍 [MCP HEALTH API] Zapier connectivity test:', {
        reachable: response.ok,
        status: response.status,
        responseTime: healthResults.zapier.diagnostics.responseTime
      });
      
      if (response.ok) {
        // Test MCP client connection
        try {
          const client = UniversalMcpClient.getInstance();
          await client.connect();
          
          // Get enhanced health details if available
          if (typeof client.getConnectionHealth === 'function') {
            const healthDetails = await client.getConnectionHealth();
            healthResults.universalClient.healthDetails = healthDetails;
            
            // Find Zapier in health details
            const zapierHealth = healthDetails.find(h => h.server.toLowerCase().includes('zapier'));
            if (zapierHealth) {
              healthResults.zapier.diagnostics.canListTools = zapierHealth.diagnostics.canListTools;
              healthResults.zapier.diagnostics.toolCount = zapierHealth.diagnostics.toolCount;
              if (zapierHealth.lastError) {
                healthResults.zapier.diagnostics.lastError = zapierHealth.lastError;
              }
            }
          }
          
          // Test tool discovery
          const tools = await client.discoverAllTools();
          healthResults.zapier.diagnostics.canListTools = true;
          healthResults.zapier.diagnostics.toolCount = tools.length;
          
          console.log('🔍 [MCP HEALTH API] Tool discovery successful:', {
            toolCount: tools.length,
            tools: tools.map(t => t.name)
          });
          
        } catch (clientError) {
          console.error('🔍 [MCP HEALTH API] Client connection failed:', clientError);
          healthResults.zapier.diagnostics.lastError = clientError instanceof Error ? clientError.message : 'Client connection failed';
        }
      }
      
    } catch (error) {
      console.error('🔍 [MCP HEALTH API] Zapier connectivity test failed:', error);
      healthResults.zapier.diagnostics.lastError = error instanceof Error ? error.message : 'Connection test failed';
    }
  } else {
    console.log('🔍 [MCP HEALTH API] Zapier endpoint not configured');
  }
  
  // Check Universal MCP Client status
  try {
    const client = UniversalMcpClient.getInstance();
    healthResults.universalClient.initialized = true;
    
    const connectionStatus = client.getConnectionStatus();
    healthResults.universalClient.connectionCount = connectionStatus.filter(c => c.connected).length;
    
    console.log('🔍 [MCP HEALTH API] Universal client status:', {
      initialized: true,
      connectionCount: healthResults.universalClient.connectionCount,
      connections: connectionStatus
    });
    
  } catch (error) {
    console.error('🔍 [MCP HEALTH API] Error checking universal client:', error);
  }
  
  // Generate overall health status
  if (healthResults.zapier.configured && healthResults.zapier.reachable && healthResults.zapier.diagnostics.canListTools) {
    healthResults.overall = 'healthy';
  } else if (healthResults.zapier.configured && healthResults.zapier.reachable) {
    healthResults.overall = 'degraded';
    healthResults.recommendations.push('Zapier endpoint is reachable but tool discovery failed');
  } else if (healthResults.zapier.configured) {
    healthResults.overall = 'unhealthy';
    healthResults.recommendations.push('Zapier endpoint is configured but unreachable');
  } else {
    healthResults.overall = 'unhealthy';
    healthResults.recommendations.push('No MCP providers configured');
  }
  
  // Add specific recommendations
  if (healthResults.zapier.diagnostics.responseTime > 5000) {
    healthResults.recommendations.push('Zapier response time is slow (>5s), consider checking network connectivity');
  }
  
  if (healthResults.zapier.diagnostics.toolCount === 0 && healthResults.zapier.reachable) {
    healthResults.recommendations.push('Zapier is reachable but no tools found - check Zapier MCP configuration');
  }
  
  if (healthResults.zapier.diagnostics.lastError) {
    healthResults.recommendations.push(`Zapier error: ${healthResults.zapier.diagnostics.lastError}`);
  }
  
  console.log('🔍 [MCP HEALTH API] Health check complete:', {
    overall: healthResults.overall,
    zapierConfigured: healthResults.zapier.configured,
    zapierReachable: healthResults.zapier.reachable,
    toolCount: healthResults.zapier.diagnostics.toolCount,
    recommendationCount: healthResults.recommendations.length
  });
  
  return NextResponse.json(healthResults, { 
    status: healthResults.overall === 'healthy' ? 200 : 
           healthResults.overall === 'degraded' ? 206 : 500 
  });
}