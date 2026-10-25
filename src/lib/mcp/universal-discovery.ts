// MCP client now handled through our transport system
import fs from 'fs';
import path from 'path';
import { devLog } from '@/lib/dev-logger';
import { UniversalMcpClient } from './universal-client';

export interface McpServerHealth {
  serverId: string;
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'rate-limited';
  lastCheck: Date;
  responseTime: number;
  availableTools: string[];
  healthScore: number; // 0-100
  errorRate: number;
  consecutiveFailures: number;
  rateLimit?: {
    remaining: number;
    resetTime: Date;
    isLimited: boolean;
  };
  endpoint: string;
}

export interface UniversalToolCapability {
  toolId: string;
  serverId: string;
  serverName: string;
  category: string;
  subcategories: string[];
  intentKeywords: string[];
  dataTypes: string[];
  description: string;
  confidence: number;
  lastUpdated: Date;
  parameters: any;
  usageStats: {
    successRate: number;
    avgResponseTime: number;
    totalExecutions: number;
  };
}

export interface QueryIntent {
  primaryCategory: string;
  secondaryCategories: string[];
  entities: {
    cryptocurrencies: string[];
    nftCollections: string[];
    contractAddresses: string[];
    timeRanges: string[];
    amounts: string[];
  };
  actionType: 'fetch' | 'create' | 'analyze' | 'search' | 'monitor';
  urgency: 'immediate' | 'batch' | 'background';
  dataRequirements: string[];
  confidence: number;
  rawQuery: string;
}

export interface ToolMatch {
  toolId: string;
  serverId: string;
  serverName: string;
  matchScore: number;
  categoryMatch: number;
  intentMatch: number;
  availabilityScore: number;
  reasoningPath: string[];
}

const TOOL_CATEGORIES = {
  FINANCE: 'finance',
  CRYPTOCURRENCY: 'cryptocurrency', 
  NFT: 'nft',
  DEFI: 'defi',
  CREATIVE: 'creative',
  COMMUNICATION: 'communication',
  PRODUCTIVITY: 'productivity',
  DATA: 'data',
  UNKNOWN: 'unknown'
} as const;

const INTENT_PATTERNS = {
  [TOOL_CATEGORIES.CRYPTOCURRENCY]: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'coin', 'token',
    'price', 'market cap', 'trading', 'exchange', 'solana', 'sol', 'cardano', 'ada',
    'dogecoin', 'doge', 'binance', 'bnb', 'polygon', 'matic', 'avalanche', 'avax'
  ],
  [TOOL_CATEGORIES.NFT]: [
    'nft', 'floor price', 'collection', 'opensea', 'mint', 'metadata',
    'contract address', '0x', 'erc-721', 'erc-1155', 'cryptopunks', 'bayc',
    'floor', 'rarity', 'trait', 'attribute'
  ],
  [TOOL_CATEGORIES.DEFI]: [
    'defi', 'liquidity', 'yield', 'staking', 'farming', 'pool', 'apy', 'apr',
    'lending', 'borrowing', 'uniswap', 'compound', 'aave'
  ],
  [TOOL_CATEGORIES.CREATIVE]: [
    'create image', 'generate image', 'make picture', 'draw', 'design', 'visual',
    'art', 'illustration', 'photo', 'graphic', 'render', 'visualize'
  ],
  [TOOL_CATEGORIES.COMMUNICATION]: [
    'email', 'gmail', 'send', 'inbox', 'message', 'mail', 'compose', 'reply'
  ]
};

export class UniversalMcpDiscovery {
  private serverHealth: Map<string, McpServerHealth> = new Map();
  private toolCapabilities: Map<string, UniversalToolCapability> = new Map();
  private mcpClient: UniversalMcpClient;
  private lastDiscovery: Date | null = null;
  private isDiscovering = false;

  constructor() {
    this.mcpClient = UniversalMcpClient.getInstance();
    // Start background health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Comprehensive MCP server discovery with health monitoring
   */
  async discoverAllMcpServers(): Promise<McpServerHealth[]> {
    if (this.isDiscovering) {
      devLog.verbose('[Universal Discovery] Discovery already in progress, waiting...');
      await this.waitForDiscovery();
    }

    this.isDiscovering = true;
    devLog.verbose('[Universal Discovery] Starting comprehensive server discovery...');

    try {
      const endpoints = await this.getServerEndpoints();
      const healthStatuses: McpServerHealth[] = [];

      // Discover and test each server
      for (const endpoint of endpoints) {
        const health = await this.discoverServerHealth(endpoint);
        healthStatuses.push(health);
        this.serverHealth.set(health.serverId, health);
      }

      // Discover tool capabilities for healthy servers
      await this.discoverToolCapabilities(healthStatuses.filter(h => h.status !== 'down'));

      this.lastDiscovery = new Date();
      devLog.verbose(`[Universal Discovery] Discovery complete. Found ${healthStatuses.length} servers, ${this.toolCapabilities.size} tools`);
      
      return healthStatuses;
    } finally {
      this.isDiscovering = false;
    }
  }

  /**
   * Advanced query intent analysis
   */
  analyzeQueryIntent(query: string): QueryIntent {
    devLog.verbose(`[Universal Discovery] Analyzing query intent: "${query}"`);
    
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/);
    
    // Category scoring
    const categoryScores: Record<string, number> = {};
    Object.keys(TOOL_CATEGORIES).forEach(cat => categoryScores[cat] = 0);

    // Analyze query patterns
    Object.entries(INTENT_PATTERNS).forEach(([category, patterns]) => {
      patterns.forEach(pattern => {
        if (lowerQuery.includes(pattern.toLowerCase())) {
          categoryScores[category] += 1;
          // Boost for exact word matches
          if (words.includes(pattern.toLowerCase())) {
            categoryScores[category] += 0.5;
          }
        }
      });
    });

    // Extract entities
    const entities = this.extractEntities(query);
    
    // Special handling for NFT queries
    if (entities.contractAddresses.length > 0 || 
        lowerQuery.includes('floor price') || 
        lowerQuery.includes('nft collection')) {
      categoryScores[TOOL_CATEGORIES.NFT] += 2;
      categoryScores[TOOL_CATEGORIES.CRYPTOCURRENCY] += 1;
    }

    // Special handling for crypto queries
    if (entities.cryptocurrencies.length > 0) {
      categoryScores[TOOL_CATEGORIES.CRYPTOCURRENCY] += 2;
    }

    // Find primary category
    const sortedCategories = Object.entries(categoryScores)
      .sort(([,a], [,b]) => b - a)
      .filter(([,score]) => score > 0);

    const primaryCategory = sortedCategories[0]?.[0] || TOOL_CATEGORIES.UNKNOWN;
    const secondaryCategories = sortedCategories.slice(1, 3).map(([cat]) => cat);

    // Determine action type
    const actionType = this.determineActionType(query);
    
    // Calculate confidence
    const maxScore = Math.max(...Object.values(categoryScores));
    const confidence = Math.min(maxScore / 3, 1);

    const intent: QueryIntent = {
      primaryCategory,
      secondaryCategories,
      entities,
      actionType,
      urgency: 'immediate',
      dataRequirements: this.extractDataRequirements(query),
      confidence,
      rawQuery: query
    };

    devLog.verbose(`[Universal Discovery] Intent analysis result:`, {
      category: primaryCategory,
      confidence,
      entities: entities.cryptocurrencies.length + entities.contractAddresses.length,
      actionType
    });

    return intent;
  }

  /**
   * Find best tools for query intent with smart ranking
   */
  async findBestTools(intent: QueryIntent): Promise<ToolMatch[]> {
    devLog.verbose(`[Universal Discovery] Finding best tools for category: ${intent.primaryCategory}`);
    
    const matches: ToolMatch[] = [];
    const availableTools = Array.from(this.toolCapabilities.values());
    
    for (const tool of availableTools) {
      const serverHealth = this.serverHealth.get(tool.serverId);
      if (!serverHealth || serverHealth.status === 'down') {
        continue; // Skip tools from unhealthy servers
      }

      const match = this.calculateToolMatch(tool, intent, serverHealth);
      if (match.matchScore > 0.1) { // Only include reasonable matches
        matches.push(match);
      }
    }

    // Sort by match score (highest first)
    matches.sort((a, b) => b.matchScore - a.matchScore);
    
    devLog.verbose(`[Universal Discovery] Found ${matches.length} potential tools:`, 
      matches.slice(0, 3).map(m => `${m.toolId} (${m.matchScore.toFixed(2)})`));
    
    return matches;
  }

  /**
   * Get healthy server client for tool execution
   */
  async getServerClient(serverId: string): Promise<any | null> {
    const health = this.serverHealth.get(serverId);
    if (!health || health.status === 'down' || health.status === 'rate-limited') {
      devLog.verbose(`[Universal Discovery] Server ${serverId} not available: ${health?.status}`);
      return null;
    }

    if (this.clients.has(serverId)) {
      return this.clients.get(serverId);
    }

    try {
      // Zapier requires both application/json and text/event-stream in Accept header
      const headers = health.name === 'Zapier' 
        ? { 
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
          }
        : { 
            'Content-Type': 'application/json' 
          };
      
      const client = await experimental_createMCPClient({
        transport: { 
          type: 'sse' as const, 
          url: health.endpoint, 
          headers
        }
      });
      
      this.clients.set(serverId, client);
      devLog.verbose(`[Universal Discovery] Created client for ${serverId}`);
      return client;
    } catch (error) {
      devLog.verbose(`[Universal Discovery] Failed to create client for ${serverId}:`, error);
      
      // Update health status
      if (health) {
        health.status = 'down';
        health.consecutiveFailures++;
        this.serverHealth.set(serverId, health);
      }
      
      return null;
    }
  }

  // Private helper methods
  private async getServerEndpoints() {
    const endpoints = [];
    const env = process.env;

    // Built-in endpoints
    if (env.MCP_ZAPIER_ENDPOINT) {
      endpoints.push({ 
        name: 'Zapier', 
        id: 'zapier',
        url: env.MCP_ZAPIER_ENDPOINT 
      });
    }

    // Custom servers from config
    try {
      const customServers = await this.loadCustomServers();
      for (const server of customServers.filter(s => s.enabled)) {
        endpoints.push({
          name: server.name,
          id: server.id,
          url: server.endpoint
        });
      }
    } catch (error) {
      devLog.verbose('[Universal Discovery] Error loading custom servers:', error);
    }

    return endpoints;
  }

  private async discoverServerHealth(endpoint: any): Promise<McpServerHealth> {
    const startTime = Date.now();
    const health: McpServerHealth = {
      serverId: endpoint.id,
      name: endpoint.name,
      status: 'down',
      lastCheck: new Date(),
      responseTime: 0,
      availableTools: [],
      healthScore: 0,
      errorRate: 0,
      consecutiveFailures: 0,
      endpoint: endpoint.url
    };

    try {
      devLog.verbose(`[Universal Discovery] Testing server: ${endpoint.name}`);
      
      // Zapier requires both application/json and text/event-stream in Accept header
      const headers = endpoint.name === 'Zapier' 
        ? { 
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
          }
        : { 
            'Content-Type': 'application/json' 
          };
      
      const client = await experimental_createMCPClient({
        transport: { 
          type: 'sse' as const, 
          url: endpoint.url, 
          headers
        }
      });

      const tools = await client.tools();
      const toolNames = Object.keys(tools);
      
      health.responseTime = Date.now() - startTime;
      health.availableTools = toolNames;
      health.status = 'healthy';
      health.healthScore = 100;
      health.consecutiveFailures = 0;
      
      // Store client for reuse
      this.clients.set(endpoint.id, client);
      
      devLog.verbose(`[Universal Discovery] Server ${endpoint.name} healthy: ${toolNames.length} tools`);
      
    } catch (error: any) {
      devLog.verbose(`[Universal Discovery] Server ${endpoint.name} failed:`, error.message);
      
      // Detect rate limiting
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        health.status = 'rate-limited';
        health.rateLimit = {
          remaining: 0,
          resetTime: new Date(Date.now() + 60000), // 1 minute default
          isLimited: true
        };
        health.healthScore = 25;
      } else {
        health.status = 'down';
        health.healthScore = 0;
        health.consecutiveFailures = 1;
      }
    }

    return health;
  }

  private async discoverToolCapabilities(healthyServers: McpServerHealth[]) {
    devLog.verbose(`[Universal Discovery] Discovering capabilities for ${healthyServers.length} healthy servers`);
    
    for (const server of healthyServers) {
      try {
        const client = this.clients.get(server.serverId);
        if (!client) continue;

        const tools = await client.tools();
        
        for (const [toolName, toolDef] of Object.entries(tools)) {
          const capability = this.analyzeToolCapability(toolName, toolDef as any, server);
          this.toolCapabilities.set(toolName, capability);
        }
        
        devLog.verbose(`[Universal Discovery] Analyzed ${server.availableTools.length} tools from ${server.name}`);
        
      } catch (error) {
        devLog.verbose(`[Universal Discovery] Failed to analyze ${server.name} capabilities:`, error);
      }
    }
  }

  private analyzeToolCapability(toolName: string, toolDef: any, server: McpServerHealth): UniversalToolCapability {
    const description = toolDef.description || '';
    const lowerName = toolName.toLowerCase();
    const lowerDesc = description.toLowerCase();
    
    // Determine category
    let category = TOOL_CATEGORIES.UNKNOWN;
    let confidence = 0.5;
    let intentKeywords: string[] = [];
    let dataTypes: string[] = [];
    
    // Analyze tool name and description
    if (lowerDesc.includes('crypto') || lowerDesc.includes('price')) {
      category = TOOL_CATEGORIES.CRYPTOCURRENCY;
      confidence = 0.9;
      intentKeywords = ['crypto', 'price', 'market', 'coin', 'token'];
      dataTypes = ['cryptocurrency', 'price', 'market-data'];
    } else if (lowerName.includes('nft') || lowerDesc.includes('nft') || lowerDesc.includes('floor')) {
      category = TOOL_CATEGORIES.NFT;
      confidence = 0.9;
      intentKeywords = ['nft', 'floor', 'collection', 'contract'];
      dataTypes = ['nft', 'floor-price', 'metadata'];
    } else if (lowerName.includes('create_image') || lowerName.includes('generate') || lowerDesc.includes('image')) {
      category = TOOL_CATEGORIES.CREATIVE;
      confidence = 0.9;
      intentKeywords = ['create', 'generate', 'image', 'visual'];
      dataTypes = ['image', 'visual'];
    } else if (lowerName.includes('gmail') || lowerName.includes('email') || lowerDesc.includes('email')) {
      category = TOOL_CATEGORIES.COMMUNICATION;
      confidence = 0.9;
      intentKeywords = ['email', 'gmail', 'message', 'inbox'];
      dataTypes = ['email', 'message'];
    }

    return {
      toolId: toolName,
      serverId: server.serverId,
      serverName: server.name,
      category,
      subcategories: [],
      intentKeywords,
      dataTypes,
      description,
      confidence,
      lastUpdated: new Date(),
      inputSchema: toolDef.parameters || {},
      usageStats: {
        successRate: 0.95, // Default optimistic
        avgResponseTime: server.responseTime,
        totalExecutions: 0
      }
    };
  }

  private calculateToolMatch(tool: UniversalToolCapability, intent: QueryIntent, serverHealth: McpServerHealth): ToolMatch {
    let matchScore = 0;
    const reasoningPath: string[] = [];
    
    // Category match (most important)
    let categoryMatch = 0;
    if (tool.category === intent.primaryCategory) {
      categoryMatch = 1.0;
      matchScore += 0.5;
      reasoningPath.push(`Primary category match: ${tool.category}`);
    } else if (intent.secondaryCategories.includes(tool.category)) {
      categoryMatch = 0.7;
      matchScore += 0.3;
      reasoningPath.push(`Secondary category match: ${tool.category}`);
    }
    
    // Intent keyword match
    let intentMatch = 0;
    const queryWords = intent.rawQuery.toLowerCase().split(/\s+/);
    for (const keyword of tool.intentKeywords) {
      if (queryWords.some(word => word.includes(keyword) || keyword.includes(word))) {
        intentMatch += 0.2;
        reasoningPath.push(`Keyword match: ${keyword}`);
      }
    }
    intentMatch = Math.min(intentMatch, 1.0);
    matchScore += intentMatch * 0.3;
    
    // Server availability bonus
    let availabilityScore = 0;
    if (serverHealth.status === 'healthy') {
      availabilityScore = 1.0;
      matchScore += 0.2;
    } else if (serverHealth.status === 'degraded') {
      availabilityScore = 0.7;
      matchScore += 0.1;
    }
    
    // Apply server health score
    matchScore *= (serverHealth.healthScore / 100);
    
    return {
      toolId: tool.toolId,
      serverId: tool.serverId,
      serverName: tool.serverName,
      matchScore,
      categoryMatch,
      intentMatch,
      availabilityScore,
      reasoningPath
    };
  }

  private extractEntities(query: string): QueryIntent['entities'] {
    const lowerQuery = query.toLowerCase();
    
    // Extract contract addresses (0x followed by 40 hex chars)
    const contractAddresses = (query.match(/0x[a-fA-F0-9]{40}/g) || []);
    
    // Extract cryptocurrency mentions
    const cryptoPatterns = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'cardano', 'ada', 'dogecoin', 'doge'];
    const cryptocurrencies = cryptoPatterns.filter(crypto => lowerQuery.includes(crypto));
    
    // Extract NFT collection hints
    const nftCollections: string[] = [];
    if (lowerQuery.includes('cryptopunks')) nftCollections.push('cryptopunks');
    if (lowerQuery.includes('bayc') || lowerQuery.includes('bored ape')) nftCollections.push('bayc');
    
    return {
      cryptocurrencies,
      nftCollections,
      contractAddresses,
      timeRanges: [],
      amounts: []
    };
  }

  private determineActionType(query: string): QueryIntent['actionType'] {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('create') || lowerQuery.includes('generate') || lowerQuery.includes('make')) {
      return 'create';
    } else if (lowerQuery.includes('search') || lowerQuery.includes('find') || lowerQuery.includes('look')) {
      return 'search';
    } else if (lowerQuery.includes('analyze') || lowerQuery.includes('compare')) {
      return 'analyze';
    } else {
      return 'fetch'; // Default for data queries
    }
  }

  private extractDataRequirements(query: string): string[] {
    const requirements: string[] = [];
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('price')) requirements.push('price');
    if (lowerQuery.includes('floor')) requirements.push('floor-price');
    if (lowerQuery.includes('market cap')) requirements.push('market-cap');
    if (lowerQuery.includes('volume')) requirements.push('volume');
    
    return requirements;
  }

  private async loadCustomServers() {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (!fs.existsSync(envPath)) return [];
      
      const content = fs.readFileSync(envPath, 'utf-8');
      const env = this.parseEnvFile(content);
      
      if (!env.MCP_CUSTOM_SERVERS) return [];
      return JSON.parse(env.MCP_CUSTOM_SERVERS);
    } catch {
      return [];
    }
  }

  private parseEnvFile(content: string): Record<string, string> {
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

  private startHealthMonitoring() {
    // Check server health every 5 minutes
    setInterval(() => {
      this.refreshServerHealth();
    }, 5 * 60 * 1000);
  }

  private async refreshServerHealth() {
    devLog.verbose('[Universal Discovery] Refreshing server health...');
    
    for (const [serverId, health] of this.serverHealth.entries()) {
      if (health.status === 'rate-limited' && health.rateLimit?.resetTime && health.rateLimit.resetTime < new Date()) {
        // Reset rate limit
        health.status = 'healthy';
        health.rateLimit.isLimited = false;
        devLog.verbose(`[Universal Discovery] Rate limit reset for ${serverId}`);
      }
    }
  }

  private async waitForDiscovery() {
    while (this.isDiscovering) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Export singleton instance
export const universalMcpDiscovery = new UniversalMcpDiscovery(); 