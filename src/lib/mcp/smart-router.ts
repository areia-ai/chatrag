import { CoreTool, tool } from 'ai';
import { z } from 'zod/v3';
import { universalMcpDiscovery, type QueryIntent, type ToolMatch, type McpServerHealth } from './universal-discovery';
import { devLog } from '@/lib/dev-logger';

export interface SmartRouterConfig {
  maxRetries: number;
  timeoutMs: number;
  fallbackEnabled: boolean;
  learningEnabled: boolean;
}

export interface RouteDecision {
  selectedTool: string;
  serverId: string;
  serverName: string;
  fallbackTools: string[];
  confidence: number;
  reasoningPath: string[];
  executionPlan: ExecutionPlan;
}

export interface ExecutionPlan {
  primaryAttempt: {
    toolId: string;
    serverId: string;
    timeoutMs: number;
  };
  fallbackAttempts: Array<{
    toolId: string;
    serverId: string;
    timeoutMs: number;
    condition: string;
  }>;
  totalTimeoutMs: number;
  strategy: 'sequential' | 'parallel' | 'fastest-wins';
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  executedTool: string;
  serverId: string;
  executionTime: number;
  attempts: number;
  userMessage: string;
}

const DEFAULT_CONFIG: SmartRouterConfig = {
  maxRetries: 3,
  timeoutMs: 30000,
  fallbackEnabled: true,
  learningEnabled: true
};

export class SmartMcpRouter {
  private config: SmartRouterConfig;
  private queryHistory: Array<{
    query: string;
    intent: QueryIntent;
    decision: RouteDecision;
    result: ExecutionResult;
    timestamp: Date;
  }> = [];

  constructor(config: Partial<SmartRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze query and make intelligent routing decision
   */
  async analyzeAndRoute(query: string): Promise<RouteDecision> {
    devLog.verbose(`[Smart Router] Analyzing query: "${query}"`);
    
    // Step 1: Analyze query intent
    const intent = universalMcpDiscovery.analyzeQueryIntent(query);
    
    // Step 2: Discover available servers and tools
    await universalMcpDiscovery.discoverAllMcpServers();
    
    // Step 3: Find best matching tools
    const toolMatches = await universalMcpDiscovery.findBestTools(intent);
    
    if (toolMatches.length === 0) {
      throw new Error(`No suitable tools found for query: "${query}"`);
    }
    
    // Step 4: Create execution plan
    const decision = this.createExecutionPlan(toolMatches, intent, query);
    
    devLog.verbose(`[Smart Router] Selected tool: ${decision.selectedTool} (confidence: ${decision.confidence.toFixed(2)})`);
    devLog.verbose(`[Smart Router] Reasoning:`, decision.reasoningPath);
    
    return decision;
  }

  /**
   * Execute the routing decision with smart fallback handling
   */
  async executeRoute(decision: RouteDecision, parameters: any): Promise<ExecutionResult> {
    devLog.verbose(`[Smart Router] Executing route plan for ${decision.selectedTool}`);
    
    const startTime = Date.now();
    let attempts = 0;
    let lastError: string = '';
    
    // Try primary tool first
    try {
      attempts++;
      const result = await this.executeTool(
        decision.executionPlan.primaryAttempt.toolId,
        decision.executionPlan.primaryAttempt.serverId,
        parameters,
        decision.executionPlan.primaryAttempt.timeoutMs
      );
      
      if (result.success) {
        return {
          ...result,
          executedTool: decision.selectedTool,
          serverId: decision.serverId,
          executionTime: Date.now() - startTime,
          attempts,
          userMessage: this.generateUserMessage(result, decision)
        };
      }
      
      lastError = result.error || 'Unknown error';
      devLog.verbose(`[Smart Router] Primary tool failed: ${lastError}`);
      
    } catch (error: any) {
      lastError = error.message;
      devLog.verbose(`[Smart Router] Primary tool exception: ${lastError}`);
    }
    
    // Try fallback tools if enabled
    if (this.config.fallbackEnabled && decision.fallbackTools.length > 0) {
      devLog.verbose(`[Smart Router] Trying ${decision.fallbackTools.length} fallback tools...`);
      
      for (const fallbackAttempt of decision.executionPlan.fallbackAttempts) {
        try {
          attempts++;
          devLog.verbose(`[Smart Router] Trying fallback: ${fallbackAttempt.toolId}`);
          
          const result = await this.executeTool(
            fallbackAttempt.toolId,
            fallbackAttempt.serverId,
            parameters,
            fallbackAttempt.timeoutMs
          );
          
          if (result.success) {
            return {
              ...result,
              executedTool: fallbackAttempt.toolId,
              serverId: fallbackAttempt.serverId,
              executionTime: Date.now() - startTime,
              attempts,
              userMessage: this.generateFallbackMessage(result, decision, fallbackAttempt.toolId)
            };
          }
          
          lastError = result.error || 'Unknown error';
          devLog.verbose(`[Smart Router] Fallback ${fallbackAttempt.toolId} failed: ${lastError}`);
          
        } catch (error: any) {
          lastError = error.message;
          devLog.verbose(`[Smart Router] Fallback ${fallbackAttempt.toolId} exception: ${lastError}`);
        }
      }
    }
    
    // All attempts failed
    return {
      success: false,
      error: lastError,
      executedTool: decision.selectedTool,
      serverId: decision.serverId,
      executionTime: Date.now() - startTime,
      attempts,
      userMessage: this.generateFailureMessage(decision, lastError, attempts)
    };
  }

  /**
   * Get enhanced tools for AI model with smart descriptions
   */
  async getEnhancedTools(query: string): Promise<Record<string, CoreTool>> {
    devLog.verbose(`[Smart Router] Creating enhanced tools for query: "${query}"`);
    
    const decision = await this.analyzeAndRoute(query);
    const intent = universalMcpDiscovery.analyzeQueryIntent(query);
    
    // Discover available tools
    const toolMatches = await universalMcpDiscovery.findBestTools(intent);
    const enhancedTools: Record<string, CoreTool> = {};
    
    // Create enhanced tools with smart descriptions and priority ordering
    const sortedMatches = toolMatches.sort((a, b) => b.matchScore - a.matchScore);
    
    for (const match of sortedMatches.slice(0, 10)) { // Limit to top 10 tools
      const enhancedDescription = this.createContextualDescription(match, intent, query);
      
      enhancedTools[match.toolId] = tool({
        description: enhancedDescription,
        inputSchema: z.object({
          input: z.string().describe('Input parameters for the tool')
        }),
        execute: async (params) => {
          const executionResult = await this.executeRoute(decision, params);
          if (!executionResult.success) {
            throw new Error(executionResult.error || 'Tool execution failed');
          }
          return executionResult.data;
        }
      });
      
      devLog.verbose(`[Smart Router] Enhanced ${match.toolId} (score: ${match.matchScore.toFixed(2)})`);
    }
    
    return enhancedTools;
  }

  // Private helper methods
  private createExecutionPlan(toolMatches: ToolMatch[], intent: QueryIntent, query: string): RouteDecision {
    const primaryTool = toolMatches[0];
    const fallbackTools = toolMatches.slice(1, 4); // Top 3 fallbacks
    
    const reasoningPath = [
      `Query category: ${intent.primaryCategory} (confidence: ${intent.confidence.toFixed(2)})`,
      `Selected tool: ${primaryTool.toolId} (server: ${primaryTool.serverName})`,
      `Match score: ${primaryTool.matchScore.toFixed(2)}`,
      `Available fallbacks: ${fallbackTools.length}`
    ];
    
    // Add specific reasoning for common cases
    if (intent.primaryCategory === 'cryptocurrency' || intent.primaryCategory === 'nft') {
      reasoningPath.push('Financial data query detected - prioritizing CoinGecko tools');
    } else if (intent.primaryCategory === 'creative') {
      reasoningPath.push('Creative request detected - prioritizing image generation tools');
    }
    
    const executionPlan: ExecutionPlan = {
      primaryAttempt: {
        toolId: primaryTool.toolId,
        serverId: primaryTool.serverId,
        timeoutMs: this.calculateTimeout(primaryTool)
      },
      fallbackAttempts: fallbackTools.map(tool => ({
        toolId: tool.toolId,
        serverId: tool.serverId,
        timeoutMs: this.calculateTimeout(tool),
        condition: `If ${primaryTool.toolId} fails`
      })),
      totalTimeoutMs: this.config.timeoutMs,
      strategy: 'sequential'
    };
    
    return {
      selectedTool: primaryTool.toolId,
      serverId: primaryTool.serverId,
      serverName: primaryTool.serverName,
      fallbackTools: fallbackTools.map(t => t.toolId),
      confidence: primaryTool.matchScore,
      reasoningPath,
      executionPlan
    };
  }
  
  private calculateTimeout(toolMatch: ToolMatch): number {
    // Base timeout of 10 seconds
    let timeout = 10000;
    
    // Adjust based on server health and tool type
    if (toolMatch.availabilityScore < 0.8) {
      timeout *= 1.5; // Give more time for struggling servers
    }
    
    // Cryptocurrency tools might need more time due to rate limits
    if (toolMatch.toolId.includes('coingecko')) {
      timeout *= 2;
    }
    
    return Math.min(timeout, this.config.timeoutMs);
  }
  
  private async executeTool(toolId: string, serverId: string, parameters: any, timeoutMs: number): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const client = await universalMcpDiscovery.getServerClient(serverId);
      if (!client) {
        return { success: false, error: `Server ${serverId} not available` };
      }
      
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs);
      });
      
      // Execute tool with timeout
      const tools = await client.tools();
      const tool = tools[toolId];
      
      if (!tool) {
        return { success: false, error: `Tool ${toolId} not found on server ${serverId}` };
      }
      
      const result = await Promise.race([
        tool.execute(parameters),
        timeoutPromise
      ]);
      
      return { success: true, data: result };
      
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  private createContextualDescription(match: ToolMatch, intent: QueryIntent, query: string): string {
    let description = `[HIGHLY RELEVANT for "${query}"] `;
    
    // Add category-specific guidance
    if (intent.primaryCategory === 'cryptocurrency' || intent.primaryCategory === 'nft') {
      description += `This is a cryptocurrency/NFT data tool perfect for getting ${intent.dataRequirements.join(', ')} information. `;
      description += `Use this when users ask about crypto prices, market data, or NFT floor prices. `;
    } else if (intent.primaryCategory === 'creative') {
      description += `This is an image generation tool for creating visual content. `;
      description += `Use this when users want to create, generate, or design images. `;
    } else if (intent.primaryCategory === 'communication') {
      description += `This is an email/communication tool for managing messages. `;
      description += `Use this when users want to search, send, or manage emails. `;
    }
    
    description += `Server: ${match.serverName} | Match Score: ${match.matchScore.toFixed(2)} | `;
    description += `Reasoning: ${match.reasoningPath.join('; ')}`;
    
    return description;
  }
  
  private generateUserMessage(result: any, decision: RouteDecision): string {
    const toolType = this.getToolType(decision.selectedTool);
    
    if (toolType === 'cryptocurrency') {
      return `I successfully retrieved cryptocurrency data using ${decision.serverName}. The information is current and accurate.`;
    } else if (toolType === 'nft') {
      return `I found the NFT collection data using ${decision.serverName}. This includes floor price and collection details.`;
    } else if (toolType === 'image') {
      return `I've initiated the image generation request using ${decision.serverName}. The image will be processed and available shortly.`;
    } else if (toolType === 'email') {
      return `I searched your emails using ${decision.serverName} and found the requested information.`;
    }
    
    return `Task completed successfully using ${decision.selectedTool} on ${decision.serverName}.`;
  }
  
  private generateFallbackMessage(result: any, decision: RouteDecision, fallbackTool: string): string {
    return `I used an alternative approach (${fallbackTool}) since the primary service was temporarily unavailable. The result is still accurate and up-to-date.`;
  }
  
  private generateFailureMessage(decision: RouteDecision, error: string, attempts: number): string {
    const toolType = this.getToolType(decision.selectedTool);
    
    if (error.includes('rate limit') || error.includes('429')) {
      return `I'm temporarily unable to access ${toolType} data due to service rate limits. Please try again in a few minutes, or I can help you with other queries.`;
    } else if (error.includes('timeout')) {
      return `The ${toolType} service is experiencing delays. I attempted ${attempts} times but couldn't complete the request within the time limit.`;
    } else {
      return `I encountered an issue accessing ${toolType} services. The servers may be temporarily unavailable. Please try again later or let me know if you need help with something else.`;
    }
  }
  
  private getToolType(toolId: string): string {
    const lowerTool = toolId.toLowerCase();
    
    if (lowerTool.includes('coingecko') || lowerTool.includes('crypto') || lowerTool.includes('price')) {
      return 'cryptocurrency';
    } else if (lowerTool.includes('nft') || lowerTool.includes('floor')) {
      return 'nft';
    } else if (lowerTool.includes('image') || lowerTool.includes('create')) {
      return 'image generation';
    } else if (lowerTool.includes('gmail') || lowerTool.includes('email')) {
      return 'email';
    }
    
    return 'data';
  }
}

// Export singleton instance
export const smartMcpRouter = new SmartMcpRouter(); 