import { CoreTool, tool } from 'ai';
import { z } from 'zod/v3';
import { universalMcpDiscovery } from './universal-discovery';
import { smartMcpRouter } from './smart-router';

/**
 * Production-Ready Universal MCP Router
 * Combines intelligent discovery, smart routing, and robust error handling
 * for immediate deployment in the chatbot
 */

export interface ProductionRouterConfig {
  enableHealthMonitoring: boolean;
  maxConcurrentRequests: number;
  defaultTimeout: number;
  fallbackEnabled: boolean;
  debugMode: boolean;
}

export interface EnhancedMcpTools {
  tools: Record<string, CoreTool>;
  serverHealth: Array<{
    serverId: string;
    name: string;
    status: string;
    toolCount: number;
  }>;
  routingDecisions: Array<{
    query: string;
    selectedTools: string[];
    confidence: number;
    reasoningText: string[];
  }>;
}

const DEFAULT_PRODUCTION_CONFIG: ProductionRouterConfig = {
  enableHealthMonitoring: true,
  maxConcurrentRequests: 10,
  defaultTimeout: 15000,
  fallbackEnabled: true,
  debugMode: process.env.NODE_ENV === 'development'
};

// Tool cache to avoid repeated discovery
const toolCache = new Map<string, { tools: any[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Session-based tool persistence using global cache for serverless environment
const global_cache = globalThis as any;
if (!global_cache.sessionTools) {
  global_cache.sessionTools = new Map<string, { tools: any[], timestamp: number }>();
}
const sessionTools = global_cache.sessionTools as Map<string, { tools: any[], timestamp: number }>;

export class ProductionMcpRouter {
  private config: ProductionRouterConfig;
  private activeRequests = new Map<string, Promise<any>>();
  private routingCache = new Map<string, any>();
  private lastHealthCheck: Date | null = null;

  constructor(config: Partial<ProductionRouterConfig> = {}) {
    this.config = { ...DEFAULT_PRODUCTION_CONFIG, ...config };
    this.initializeHealthMonitoring();
  }

  /**
   * Get cached tools with session support
   */
  async getCachedTools(servers: any[], sessionId?: string): Promise<any[]> {
    // Debug logging for cache operations
    this.log(`[Production Router] getCachedTools called with sessionId: ${sessionId || 'none'}`);
    this.log(`[Production Router] Global cache identity: ${global_cache === globalThis}`);
    this.log(`[Production Router] Global sessionTools Map identity: ${global_cache.sessionTools === sessionTools}`);
    this.log(`[Production Router] Current sessionTools size: ${sessionTools.size}`);
    this.log(`[Production Router] Current sessionTools keys: ${Array.from(sessionTools.keys()).join(', ')}`);
    this.log(`[Production Router] Current toolCache keys: ${Array.from(toolCache.keys()).length} entries`);
    
    // Check session-specific tools first
    if (sessionId && sessionTools.has(sessionId)) {
      const cached = sessionTools.get(sessionId)!;
      // Check if cache is still valid (15 minute TTL)
      if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
        this.log(`[Production Router] ✓ Found session tools for ${sessionId}: ${cached.tools.length} tools`);
        this.log(`[Production Router] Session tool names: ${cached.tools.map(t => t.name).join(', ')}`);
        return cached.tools;
      } else {
        this.log(`[Production Router] Session tools expired for ${sessionId}`);
        sessionTools.delete(sessionId);
      }
    } else if (sessionId) {
      this.log(`[Production Router] ✗ No session tools found for ${sessionId}`);
    }

    // Check global cache
    const cacheKey = JSON.stringify(servers.map(s => s.id || s.serverId || s.name).sort());
    const cached = toolCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      this.log(`[Production Router] Using global cached tools: ${cached.tools.length} tools`);
      return cached.tools;
    }
    
    // Discover new tools
    this.log('[Production Router] No cached tools found, discovering new tools...');
    const tools = await this.discoverAvailableTools();
    
    // Convert tools to array format if needed
    const toolsArray = Object.entries(tools).map(([name, tool]) => ({
      name,
      ...tool
    }));
    
    this.log(`[Production Router] Discovered ${toolsArray.length} new tools`);
    
    // Update caches
    toolCache.set(cacheKey, { tools: toolsArray, timestamp: Date.now() });
    if (sessionId) {
      sessionTools.set(sessionId, { tools: toolsArray, timestamp: Date.now() });
      this.log(`[Production Router] Cached ${toolsArray.length} tools for session ${sessionId}`);
      this.log(`[Production Router] Global cache now has ${sessionTools.size} sessions`);
    }
    
    return toolsArray;
  }

  /**
   * Clear session tools when needed
   */
  clearSessionTools(sessionId: string): void {
    if (sessionTools.has(sessionId)) {
      this.log(`[Production Router] Clearing tools for session ${sessionId}`);
      sessionTools.delete(sessionId);
    }
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.log('[Production Router] Clearing all tool caches');
    toolCache.clear();
    sessionTools.clear();
  }

  /**
   * Main entry point: Get enhanced MCP tools for chat API
   * Now accepts actual MCP tools from the chat API discovery
   * Includes conversation history for context-aware tool selection
   */
  async getEnhancedMcpTools(userQuery: string, actualMcpTools?: Record<string, CoreTool>, conversationHistory?: any[], sessionId?: string): Promise<EnhancedMcpTools> {
    const startTime = Date.now();
    
    try {
      this.log(`[Production Router] Processing query: "${userQuery}"`);
      this.log(`[Production Router] Session ID: ${sessionId || 'none'}`);
      this.log(`[Production Router] Received ${Object.keys(actualMcpTools || {}).length} actual MCP tools from chat API`);
      this.log(`[Production Router] Conversation context: ${conversationHistory?.length || 0} recent messages`);
      
      // Step 1: Use actual MCP tools if provided, otherwise fall back to discovery
      let availableTools = actualMcpTools;
      if (!availableTools || Object.keys(availableTools).length === 0) {
        this.log(`[Production Router] No actual tools provided, falling back to discovery...`);
        await this.ensureServerDiscovery();
        
        // Try to get cached tools for this session
        const servers = await this.getAvailableServers();
        const cachedTools = await this.getCachedTools(servers, sessionId);
        
        // Convert array back to object format
        availableTools = {};
        cachedTools.forEach((tool: any) => {
          availableTools![tool.name] = tool;
        });
      } else {
        this.log(`[Production Router] Using actual MCP tools:`, Object.keys(availableTools));
        
        // Cache the provided tools for this session
        if (sessionId) {
          const toolsArray = Object.entries(availableTools).map(([name, tool]) => ({
            name,
            ...tool
          }));
          
          // Debug: Show what's being cached
          this.log(`[Production Router] About to cache tools in getEnhancedMcpTools for session ${sessionId}`);
          this.log(`[Production Router] Tools to cache: ${toolsArray.map(t => t.name).join(', ')}`);
          this.log(`[Production Router] Global cache before set: ${global_cache.sessionTools.size} entries`);
          
          sessionTools.set(sessionId, { tools: toolsArray, timestamp: Date.now() });
          
          // Verify cache was set
          const cached = sessionTools.get(sessionId);
          this.log(`[Production Router] ✓ Cached ${toolsArray.length} tools for session ${sessionId}`);
          this.log(`[Production Router] Verification - cached tools: ${cached ? cached.tools.length : 0}`);
          this.log(`[Production Router] Current session cache keys: ${Array.from(sessionTools.keys()).join(', ')}`);
          this.log(`[Production Router] Global cache now has ${sessionTools.size} sessions`);
          this.log(`[Production Router] Global cache after set: ${global_cache.sessionTools.size} entries`);
        } else {
          this.log(`[Production Router] Not caching tools - sessionId: ${sessionId || 'none'}`);
        }
        
        // Debug: Check for available tool types
        const toolTypes = Object.keys(availableTools).map(name => {
          const lowerName = name.toLowerCase();
          if (lowerName.includes('gmail') || lowerName.includes('email')) return 'email';
          if (lowerName.includes('calendar') || lowerName.includes('event')) return 'calendar';
          if (lowerName.includes('image') || lowerName.includes('create')) return 'image';
          return 'other';
        });
        const typeCounts = toolTypes.reduce((acc, type) => ({ ...acc, [type]: (acc[type] || 0) + 1 }), {} as Record<string, number>);
        this.log(`[Production Router] Tool types found:`, typeCounts);
      }
      
      // Step 2: Analyze query intent and route to best tools with conversation context
      const routeDecision = await this.analyzeQueryAndRoute(userQuery, availableTools, conversationHistory);
      this.log(`[Production Router] Route decision:`, routeDecision);
      
      // Step 3: Create enhanced tools for chat API
      const enhancedTools = await this.createEnhancedToolsForChat(userQuery, routeDecision, availableTools);
      
      // Step 4: Get server health status
      const serverHealth = await this.getServerHealthSummary();
      
      const executionTime = Date.now() - startTime;
      this.log(`[Production Router] Complete in ${executionTime}ms with ${Object.keys(enhancedTools).length} tools`);
      
      return {
        tools: enhancedTools,
        serverHealth,
        routingDecisions: [{
          query: userQuery,
          selectedTools: Object.keys(enhancedTools),
          confidence: routeDecision.confidence,
          reasoningText: routeDecision.reasoningPath
        }]
      };
      
    } catch (error) {
      console.error(`[Production Router] Error processing query:`, error);
      
      // Return basic tools as fallback
      return {
        tools: await this.createFallbackTools(userQuery, actualMcpTools),
        serverHealth: [],
        routingDecisions: [{
          query: userQuery,
          selectedTools: [],
          confidence: 0,
          reasoningText: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
        }]
      };
    }
  }

  /**
   * Analyze query and route to best tools from actual available tools
   * Now includes conversation context for better tool selection
   */
  private async analyzeQueryAndRoute(userQuery: string, availableTools: Record<string, CoreTool>, conversationHistory?: any[]): Promise<any> {
    const lowerQuery = userQuery.toLowerCase();
    
    // Analyze conversation context for better tool selection
    const conversationContext = this.analyzeConversationContext(conversationHistory || []);
    this.log(`[Production Router] Conversation context:`, conversationContext);
    
    // Analyze query intent with context awareness
    const intent = this.analyzeQueryIntent(userQuery, conversationContext);
    this.log(`[Production Router] Query intent with context:`, intent);
    
    // Score and rank available tools with context awareness
    const toolScores = this.scoreToolsForQuery(availableTools, intent, userQuery, conversationContext);
    this.log(`[Production Router] Tool scores with context:`, toolScores.slice(0, 10));

    // CRITICAL: If this is a domain-specific query, return NO MCP tools
    if (intent.isDomainSpecific) {
      this.log(`[Production Router] Domain-specific query detected - NO MCP tools should be triggered`);
      return {
        selectedTools: [],
        confidence: 0,
        reasoningPath: [
          `Query category: ${intent.category} (domain-specific)`,
          'This query is about data in the RAG system, not external services',
          'Will use standard RAG/AI response without MCP tools'
        ],
        intent,
        toolScores: []
      };
    }

    // Filter out tools with very low scores (below threshold)
    const MIN_SCORE_THRESHOLD = 50; // RAISED: Minimum score to consider a tool relevant (was 10)
    const relevantTools = toolScores.filter(ts => ts.score >= MIN_SCORE_THRESHOLD);

    // If no tools meet the threshold, this query doesn't need MCP tools
    if (relevantTools.length === 0) {
      this.log(`[Production Router] No tools meet minimum score threshold (${MIN_SCORE_THRESHOLD}) - query doesn't need MCP tools`);
      return {
        selectedTools: [],
        confidence: 0,
        reasoningPath: [
          `Query category: ${intent.category}`,
          'No relevant MCP tools found for this query',
          'Will use standard RAG/AI response'
        ],
        intent,
        toolScores: []
      };
    }

    // Select best tools (top 5 with good scores)
    const selectedTools = relevantTools.slice(0, Math.min(5, relevantTools.length));

    return {
      selectedTools: selectedTools.map(ts => ts.toolName),
      confidence: selectedTools.length > 0 ? Math.min(selectedTools[0].score / 100, 1.0) : 0,
      reasoningPath: [
        `Query category: ${intent.category}`,
        `Top tool: ${selectedTools[0]?.toolName || 'none'} (score: ${selectedTools[0]?.score || 0})`,
        `Selected ${selectedTools.length} relevant tools (${relevantTools.length} met threshold)`
      ],
      intent,
      toolScores: selectedTools
    };
  }

  /**
   * Analyze conversation context to detect previous tool results and context
   */
  private analyzeConversationContext(conversationHistory: any[]): any {
    const context = {
      hasRecentEmailResults: false,
      recentEmailSenders: [] as string[],
      recentEmailSubjects: [] as string[],
      hasRecentCalendarResults: false,
      recentToolCalls: [] as string[],
      lastAssistantMessage: '',
      isFollowUpQuery: false
    };

    // Analyze last few messages for context
    const recentMessages = conversationHistory.slice(-6); // Last 3 exchanges
    
    for (const message of recentMessages) {
      if (message.role === 'assistant') {
        const content = typeof message.content === 'string' ? message.content : '';
        context.lastAssistantMessage = content;
        
        // Check for email results
        if (content.includes('found') && (content.includes('email') || content.includes('message'))) {
          context.hasRecentEmailResults = true;
          
          // Extract sender names (common patterns: "from John", "From: John", etc.)
          const senderMatches = content.match(/(?:from|From:?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g);
          if (senderMatches) {
            senderMatches.forEach(match => {
              const name = match.replace(/(?:from|From:?)\s+/i, '').trim();
              if (name && !context.recentEmailSenders.includes(name)) {
                context.recentEmailSenders.push(name);
              }
            });
          }
          
          // Extract subjects
          const subjectMatches = content.match(/(?:subject|Subject:?|Re:)\s+"([^"]+)"/g);
          if (subjectMatches) {
            subjectMatches.forEach(match => {
              const subject = match.match(/"([^"]+)"/)?.[1];
              if (subject && !context.recentEmailSubjects.includes(subject)) {
                context.recentEmailSubjects.push(subject);
              }
            });
          }
        }
        
        // Check for calendar results
        if (content.includes('event') && (content.includes('calendar') || content.includes('schedule'))) {
          context.hasRecentCalendarResults = true;
        }
      }
      
      // Track recent tool calls from content
      if (message.content && typeof message.content === 'object' && Array.isArray(message.content)) {
        message.content.forEach((part: any) => {
          if (part.type === 'tool-call' && part.toolName) {
            context.recentToolCalls.push(part.toolName);
          }
        });
      }
    }
    
    // Determine if this is a follow-up query
    if (context.hasRecentEmailResults || context.hasRecentCalendarResults) {
      context.isFollowUpQuery = true;
    }
    
    return context;
  }

  /**
   * Analyze query to determine intent and requirements
   */
  private analyzeQueryIntent(userQuery: string, conversationContext?: any): any {
    const lowerQuery = userQuery.toLowerCase();
    
    // Detect query category with context awareness
    let category = 'general';
    let confidence = 0.5;
    let isContextualReply = false;
    let isDomainSpecific = false;
    
    // Check if this is a contextual reply query
    if (conversationContext?.hasRecentEmailResults) {
      // Check if query mentions reply/respond AND mentions a name/subject from recent emails
      const mentionsReply = /reply|respond|answer|write back/i.test(userQuery);
      const mentionsSender = conversationContext.recentEmailSenders.some((sender: string) => 
        lowerQuery.includes(sender.toLowerCase())
      );
      
      if (mentionsReply || mentionsSender) {
        // This is likely a reply to a previously found email
        category = 'contextual_reply';
        confidence = 0.9;
        isContextualReply = true;
        this.log(`[Production Router] Detected contextual reply query`);
      }
    }
    
    // CRITICAL: Detect domain-specific queries that should NOT trigger MCP tools
    // These are queries about data/documents in the RAG system, not external services
    const domainPatterns = {
      // Financial terms and document types (with plural support)
      financial: /\b(revenues?|profits?|expenses?|expenditures?|financial|earnings|income|loss|losses|budget|costs?|r&d|research.*development|sales|investments?|quarterly|annual|fiscal|margins?|ebitda|eps|balance.*sheet|cash.*flow|statements?|10-?[kq]|sec.*filing|ipo|dividends?|valuations?|assets?|liabilities|equity)\b/i,
      // Technical/dev queries
      technical: /\b(algorithms?|code|implementation|architecture|frameworks?|librar(?:y|ies)|api|database|server|deployment|backend|frontend|stack|repositor(?:y|ies))\b/i,
      // Data analysis queries (with plural support)
      data_analysis: /\b(analy(?:sis|ses)|statistics|metrics?|data|trends?|growth|performance|comparisons?|compare|averages?|totals?|sums?|changes?|factors?|drivers?|impacts?|causes?|effects?)\b/i,
      // Company/org info queries
      company_info: /\b(compan(?:y|ies)|corporations?|organizations?|business(?:es)?|enterprises?|subsidiar(?:y|ies)|headquarters|founded|ceo|employees|intel|apple|google|microsoft|amazon|meta)\b/i
    };
    
    // Check if query matches domain-specific patterns
    for (const [domain, pattern] of Object.entries(domainPatterns)) {
      if (pattern.test(userQuery)) {
        this.log(`[Production Router] Detected ${domain} domain query - MCP tools should not be triggered`);
        category = 'domain_specific_data';
        confidence = 0.95;
        isDomainSpecific = true;
        break;
      }
    }
    
    // Standard category detection if not a contextual reply or domain-specific query
    if (!isContextualReply && !isDomainSpecific) {
      console.log('🔍 [PRODUCTION ROUTER] Testing query for category detection:', `"${userQuery}"`);
      const driveUploadPattern = /upload.*drive|save.*drive|google.*drive.*upload|put.*google.*drive|update.*drive|update.*google.*drive/i;
      const driveTest = driveUploadPattern.test(userQuery);
      console.log('🔍 [PRODUCTION ROUTER] Drive upload pattern test:', driveTest, 'Pattern:', driveUploadPattern);
      
      if (driveTest) {
        category = 'file_management';
        confidence = 0.9;
        console.log('🔍 [PRODUCTION ROUTER] ✅ Classified as file_management with confidence', confidence);
      } else if (/\b(image|picture|photo|visual|art|draw|sketch|render|design)\b/i.test(userQuery) && !/\b(create|generate)\s+(?:an?\s+)?(?:analysis|report|summary|document)/i.test(userQuery)) {
        // Only classify as creative if it's truly about visual content, not document generation
        category = 'creative';
        confidence = 0.8;
      } else if (/\b(email|gmail|mail|inbox|message|send|draft|reply)\b/i.test(userQuery)) {
        category = 'communication';
        confidence = 0.8;
      } else if (/\b(calendar|schedule|meeting|event|appointment)\b/i.test(userQuery)) {
        category = 'productivity';
        confidence = 0.7;
      }
    }
    
    // Extract entities
    const entities = {
      explicit_mentions: this.extractExplicitMentions(userQuery)
    };
    
    return {
      category,
      confidence,
      entities,
      keywords: lowerQuery.split(/\s+/).filter(word => word.length > 3),
      isSpecific: confidence > 0.7,
      isContextualReply,
      isDomainSpecific,
      conversationContext
    };
  }

  /**
   * Score tools based on query relevance with context awareness
   */
  private scoreToolsForQuery(availableTools: Record<string, CoreTool>, intent: any, userQuery: string, conversationContext?: any): Array<{toolName: string, score: number, reasoningText: string[]}> {
    const scores: Array<{toolName: string, score: number, reasoningText: string[]}> = [];
    const lowerQuery = userQuery.toLowerCase();

    // CRITICAL: Check if this is a document/RAG query that doesn't need MCP tools
    const documentPatterns = [
      /comprovativo/i,
      /invoice/i,
      /receipt/i,
      /document/i,
      /pdf/i,
      /file\s+#/i,
      /#[A-Z0-9]+/,  // Document IDs like #FA2025
      /what['']?s\s+(?:the\s+)?(?:total|amount|value|price|cost)/i,
      /show\s+me\s+(?:the\s+)?(?:document|file|pdf|invoice|receipt)/i
    ];

    const isDocumentQuery = documentPatterns.some(pattern => pattern.test(userQuery));
    const hasDocumentId = /#[A-Z0-9]+/.test(userQuery);

    // If this is clearly a document query, heavily penalize all MCP tools
    if (isDocumentQuery || hasDocumentId) {
      console.log('🔍 [PRODUCTION ROUTER] Document query detected - will penalize MCP tools');
      console.log('🔍 [PRODUCTION ROUTER] Query appears to be about local documents/files');

      // Return empty array or minimal scores for MCP tools
      for (const [toolName, tool] of Object.entries(availableTools)) {
        scores.push({
          toolName,
          score: 0,
          reasoningText: ['Document query - MCP tools not needed']
        });
      }

      return scores;
    }

    // Define stop words to exclude from keyword matching
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do',
      'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
      'what', 'whats', "what's", 'that', 'this', 'these', 'those', 'it',
      'its', "it's", 'amount', 'total', 'value', 'number'
    ]);

    for (const [toolName, tool] of Object.entries(availableTools)) {
      const reasoning: string[] = [];
      let score = 0;

      const lowerToolName = toolName.toLowerCase();
      const toolDescription = (tool.description || '').toLowerCase();

      // Context-aware scoring for email replies
      if (intent.isContextualReply && conversationContext?.hasRecentEmailResults) {
        // Boost reply tools significantly
        if (lowerToolName.includes('reply') || lowerToolName.includes('respond') ||
            lowerToolName.includes('create_draft_reply') || lowerToolName.includes('reply_to_email')) {
          score += 90; // Very high boost for reply tools
          reasoning.push('Contextual email reply tool - highest priority');

          // Additional boost if user mentions a sender name
          if (conversationContext.recentEmailSenders.length > 0) {
            const mentionsSender = conversationContext.recentEmailSenders.some((sender: string) =>
              lowerQuery.includes(sender.toLowerCase())
            );
            if (mentionsSender) {
              score += 20;
              reasoning.push('Query mentions recent email sender');
            }
          }
        }
        // Penalize search tools when we already have email results
        else if (lowerToolName.includes('search') || lowerToolName.includes('find') ||
                 lowerToolName.includes('get_gmail')) {
          score -= 30; // Reduce score for search tools
          reasoning.push('Search tool deprioritized - already have email results');
        }
      }
      
      // Google Drive upload/update detection
      const isDriveQuery = (lowerQuery.includes('upload') || lowerQuery.includes('update')) && (lowerQuery.includes('drive') || lowerQuery.includes('google'));
      console.log(`🔍 [TOOL SCORING] Testing tool "${toolName}" for Google Drive upload`);
      console.log(`🔍 [TOOL SCORING] Query contains drive keywords:`, isDriveQuery);
      console.log(`🔍 [TOOL SCORING] Tool name lower:`, lowerToolName);
      
      if (isDriveQuery) {
        // More flexible matching for Google Drive upload tools
        const isGoogleDriveTool = lowerToolName.includes('google') && lowerToolName.includes('drive') && 
            (lowerToolName.includes('upload') || lowerToolName.includes('file'));
        const isDriveUploadTool = lowerToolName.includes('drive') && lowerToolName.includes('upload');
        const isExactMatch = lowerToolName === 'google_drive_upload_file';
        
        console.log(`🔍 [TOOL SCORING] Google Drive tool check:`, isGoogleDriveTool);
        console.log(`🔍 [TOOL SCORING] Drive upload tool check:`, isDriveUploadTool);
        console.log(`🔍 [TOOL SCORING] Exact match check:`, isExactMatch);
        
        if (isGoogleDriveTool) {
          score += 100; // Maximum score for exact Google Drive upload tool match
          reasoning.push('Google Drive upload tool - perfect match for upload/update request');
          console.log(`🔍 [TOOL SCORING] ✅ Scored ${toolName} with +100 (Google Drive tool)`);
        } else if (isDriveUploadTool) {
          score += 95; // Very high score for other Drive upload tools
          reasoning.push('Drive upload tool - matches upload/update request');
          console.log(`🔍 [TOOL SCORING] ✅ Scored ${toolName} with +95 (Drive upload tool)`);
        } else if (isExactMatch) {
          // Exact match fallback
          score += 100;
          reasoning.push('Google Drive upload tool - exact tool name match');
          console.log(`🔍 [TOOL SCORING] ✅ Scored ${toolName} with +100 (exact match)`);
          
          // Additional boost if user mentions specific media types
          if (lowerQuery.includes('image') || lowerQuery.includes('video') || lowerQuery.includes('file')) {
            score += 10;
            reasoning.push('Specific media type mentioned for Drive upload');
            console.log(`🔍 [TOOL SCORING] ✅ Additional +10 for media type mention`);
          }
          
          // Boost if user mentions folder
          if (lowerQuery.includes('folder') || lowerQuery.includes('directory')) {
            score += 5;
            reasoning.push('Folder/directory mentioned for organization');
            console.log(`🔍 [TOOL SCORING] ✅ Additional +5 for folder mention`);
          }
        }
      }
      
      // Category matching with specific tool type detection
      if (intent.category === 'file_management') {
        if (lowerToolName.includes('drive') || lowerToolName.includes('upload') || lowerToolName.includes('file')) {
          score += 80;
          reasoning.push('File management tool for Drive operations');
        }
      } else if (intent.category === 'creative') {
        if (lowerToolName.includes('image') || lowerToolName.includes('create') || lowerToolName.includes('generate')) {
          score += 70;
          reasoning.push('Image generation tool match');
        }
      } else if (intent.category === 'communication') {
        // Be more specific about email tool types
        if (lowerQuery.includes('fetch') || lowerQuery.includes('find') || lowerQuery.includes('search') ||
            lowerQuery.includes('last') || lowerQuery.includes('recent') || lowerQuery.includes('check') ||
            lowerQuery.includes('get')) {
          // User wants to find/fetch emails - MAXIMUM PRIORITY
          if (lowerToolName.includes('find_email') || lowerToolName.includes('gmail_find') ||
              lowerToolName.includes('search_email')) {
            score += 100; // MAXIMUM score for exact email fetch tool match
            reasoning.push('Email fetch/find tool - PERFECT match for query');
            console.log(`🔍 [TOOL SCORING] ✅ Scored ${toolName} with +100 (email fetch tool)`);
          } else if (lowerToolName.includes('gmail') && !lowerToolName.includes('reply') && !lowerToolName.includes('send')) {
            score += 80; // Very high for general Gmail tools (non-reply)
            reasoning.push('Gmail tool for email fetch/search');
          } else if (lowerToolName.includes('reply') || lowerToolName.includes('send') || lowerToolName.includes('draft')) {
            score -= 20; // Penalize reply/send tools when user wants to fetch
            reasoning.push('Reply/send tool deprioritized - user wants to fetch');
          }

          // Additional boost if user explicitly mentions "Zapier MCP"
          if (lowerQuery.includes('zapier') && lowerQuery.includes('mcp')) {
            score += 20;
            reasoning.push('Explicit Zapier MCP request - priority boost');
            console.log(`🔍 [TOOL SCORING] ✅ Additional +20 for Zapier MCP mention`);
          }
        } else if (lowerQuery.includes('reply') || lowerQuery.includes('respond') || lowerQuery.includes('answer')) {
          // User wants to reply to emails
          if (lowerToolName.includes('reply') || lowerToolName.includes('draft_reply')) {
            score += 90;
            reasoning.push('Email reply tool - matches reply intent');
          } else if (lowerToolName.includes('find_email')) {
            score -= 20; // Penalize search tools when user wants to reply
            reasoning.push('Search tool deprioritized - user wants to reply');
          }
        } else {
          // General email tool matching
          if (lowerToolName.includes('gmail') || lowerToolName.includes('email') || lowerToolName.includes('mail')) {
            score += 50; // Moderate boost for general email tools
            reasoning.push('General email tool match');
          }
        }
      } else if (intent.category === 'contextual_reply') {
        // Already handled above, but add general email tool boost
        if (lowerToolName.includes('email') || lowerToolName.includes('gmail')) {
          score += 40;
          reasoning.push('Email tool for contextual reply');
        }
      } else if (intent.category === 'productivity') {
        // Handle calendar/scheduling tools
        if (lowerQuery.includes('upcoming') || lowerQuery.includes('next') || lowerQuery.includes('events') || 
            lowerQuery.includes('calendar') || lowerQuery.includes('schedule')) {
          if (lowerToolName.includes('find_event') || lowerToolName.includes('calendar') && lowerToolName.includes('find')) {
            score += 90;
            reasoning.push('Calendar search tool - matches calendar query');
          } else if (lowerToolName.includes('add_event') || lowerToolName.includes('create_event')) {
            score -= 20;
            reasoning.push('Calendar create tool deprioritized - user wants to find events');
          }
        }
      }
      
      // Explicit service mentions
      if (intent.entities.explicit_mentions.length > 0) {
        for (const mention of intent.entities.explicit_mentions) {
          if (lowerToolName.includes(mention.toLowerCase())) {
            score += 50;
            reasoning.push(`Explicit mention: ${mention}`);
          }
        }
      }
      
      // CRITICAL: Only apply keyword matching if there's already a category/intent match
      // This prevents false positives where tools get points from unrelated generic words
      const hasIntentMatch = score > 30; // Only boost with keywords if tool already has some relevance
      
      if (hasIntentMatch) {
        const queryWords = lowerQuery.split(/\s+/).filter(word => word.length > 2);
        const toolWords = (lowerToolName + ' ' + toolDescription).split(/\s+/).filter(word => word.length > 2);

        // Check for action verbs that should boost specific tool types
        const fetchVerbs = ['fetch', 'find', 'search', 'get', 'list', 'show', 'check'];
        const createVerbs = ['create', 'send', 'reply', 'make', 'add', 'compose'];

        for (const word of queryWords) {
          if (fetchVerbs.includes(word)) {
            if (lowerToolName.includes('find') || lowerToolName.includes('search') || lowerToolName.includes('get')) {
              score += 10; // Reduced from 15
              reasoning.push(`Action verb '${word}' matches search tool`);
            }
          } else if (createVerbs.includes(word)) {
            if (lowerToolName.includes('create') || lowerToolName.includes('send') ||
                lowerToolName.includes('reply') || lowerToolName.includes('add')) {
              score += 10; // Reduced from 15
              reasoning.push(`Action verb '${word}' matches creation tool`);
            }
          }
        }

        // Regular keyword matching - EXCLUDE stop words and generic terms
        const filteredQueryWords = queryWords.filter(word => !stopWords.has(word));
        const filteredToolWords = toolWords.filter(word => !stopWords.has(word));

        // STRICT matching: Require exact word match, NO partial matches
        const matchingWords = filteredQueryWords.filter(qw =>
          filteredToolWords.some(tw => tw === qw) // ONLY exact matches
        );

        if (matchingWords.length > 0) {
          // Minimal weight for keyword matches - primary scoring should come from category/intent
          const matchScore = Math.min(matchingWords.length * 2, 6);
          score += matchScore;
          reasoning.push(`Keyword matches (${matchingWords.length}): ${matchingWords.slice(0, 3).join(', ')}`);
        }
      } else {
        reasoning.push('No intent match - skipping keyword scoring to prevent false positives');
      }
      
      // Ensure minimum score for non-negative tools
      if (score < 0) {
        score = 0;
        reasoning.push('Tool deprioritized due to context');
      } else if (score === 0) {
        score = 1; // Give minimal score to keep as fallback
        reasoning.push('Fallback option');
      }
      
      console.log(`🔍 [TOOL SCORING] Final score for "${toolName}": ${score} (reasoning: ${reasoning.join(', ')})`);
      scores.push({ toolName, score, reasoningText: reasoning });
    }
    
    const sortedScores = scores.sort((a, b) => b.score - a.score);
    console.log(`🔍 [TOOL SCORING] ===== FINAL TOOL RANKING =====`);
    sortedScores.slice(0, 10).forEach((tool, index) => {
      console.log(`🔍 [TOOL SCORING] #${index + 1}: ${tool.toolName} (score: ${tool.score})`);
    });
    console.log(`🔍 [TOOL SCORING] =====================================`);
    
    return sortedScores;
  }

  // Removed extractCryptocurrencies method - no longer needed for ChatRAG

  // Removed extractNftCollections method - no longer needed for ChatRAG

  /**
   * Extract explicit service mentions from query
   */
  private extractExplicitMentions(query: string): string[] {
    const mentions: string[] = [];
    const lowerQuery = query.toLowerCase();
    
    const servicePatterns = [
      'gmail', 'google mail', 'calendar'
    ];
    
    for (const service of servicePatterns) {
      if (lowerQuery.includes(service)) {
        mentions.push(service);
      }
    }
    
    return mentions;
  }

  /**
   * Get available MCP servers
   */
  async getAvailableServers(): Promise<any[]> {
    try {
      const servers = await universalMcpDiscovery.discoverAllMcpServers();
      return servers || [];
    } catch (error) {
      this.log(`[Production Router] Error getting servers:`, error);
      return [];
    }
  }

  /**
   * Discover available tools when actual tools not provided
   */
  private async discoverAvailableTools(): Promise<Record<string, CoreTool>> {
    try {
      // Fall back to smart router discovery
      return await smartMcpRouter.getEnhancedTools('general query');
    } catch (error) {
      this.log(`[Production Router] Error discovering tools:`, error);
      return {};
    }
  }

  /**
   * Create enhanced tools specifically for chat API integration
   */
  private async createEnhancedToolsForChat(userQuery: string, routeDecision: any, availableTools: Record<string, CoreTool>): Promise<Record<string, CoreTool>> {
    const enhancedTools: Record<string, CoreTool> = {};
    
    try {
      // Use the selected tools from route decision
      const selectedToolNames = routeDecision.selectedTools || Object.keys(availableTools).slice(0, 10);
      
      this.log(`[Production Router] Creating enhanced tools for: ${selectedToolNames.length} tools`);
      
      // Transform selected tools for chat API approval pattern
      for (const toolName of selectedToolNames) {
        const originalTool = availableTools[toolName];
        if (!originalTool) {
          this.log(`[Production Router] Warning: Tool ${toolName} not found in available tools`);
          continue;
        }
        
        // Create enhanced description
        const enhancedDescription = this.enhanceToolDescriptionForChat(
          originalTool.description || '', 
          toolName, 
          userQuery
        );
        
        // Debug log the original tool structure
        if (toolName.includes('gmail')) {
          this.log(`[Production Router] Gmail tool structure for ${toolName}:`, {
            hasParameters: !!originalTool.parameters,
            hasInputSchema: !!originalTool.inputSchema,
            isAlreadyAiSdkTool: originalTool.parameters && originalTool.parameters._def,
            parameterKeys: originalTool.parameters ? Object.keys(originalTool.parameters) : [],
            inputSchemaType: originalTool.inputSchema?.type,
            inputSchemaProperties: originalTool.inputSchema?.properties ? Object.keys(originalTool.inputSchema.properties) : []
          });
        }
        
        // Convert MCP inputSchema to Zod schema if needed
        let zodSchema = null;
        
        // Check if we already have a Zod schema (AI SDK tool format)
        if (originalTool.parameters && originalTool.parameters._def) {
          zodSchema = originalTool.parameters;
        }
        // If we have an MCP inputSchema, convert it
        else if (originalTool.inputSchema) {
          zodSchema = this.convertMcpSchemaToZod(originalTool.inputSchema);
          
          // Log the conversion result for Gmail tools
          if (toolName.includes('gmail')) {
            this.log(`[Production Router] Converted schema for ${toolName}:`, {
              schemaType: zodSchema._def?.typeName,
              shape: zodSchema._def?.shape ? Object.keys(zodSchema._def.shape).length : 0
            });
          }
        }
        
        // Final fallback if still no schema
        if (!zodSchema) {
          zodSchema = z.object({
            input: z.string().describe('Input parameters for the tool')
          });
        }
        
        // Create enhanced tool with approval flow
        enhancedTools[toolName] = tool({
          description: enhancedDescription,
          inputSchema: zodSchema,
          execute: async (params: any, meta?: any) => {
            // This will throw the approval error expected by chat API
            return this.executeWithApprovalFlow(toolName, params, meta, routeDecision);
          }
        });
        
        this.log(`[Production Router] Enhanced tool: ${toolName}`);
      }
      
    } catch (error) {
      console.error(`[Production Router] Error creating enhanced tools:`, error);
      
      // Fallback: create basic tools from available tools
      const fallbackToolNames = Object.keys(availableTools).slice(0, 5);
      for (const toolName of fallbackToolNames) {
        const originalTool = availableTools[toolName];
        if (originalTool) {
          // Convert MCP inputSchema to Zod schema if needed
          let zodSchema = null;
          
          // Check if we already have a Zod schema (AI SDK tool format)
          if (originalTool.parameters && originalTool.parameters._def) {
            zodSchema = originalTool.parameters;
          }
          // If we have an MCP inputSchema, convert it
          else if (originalTool.inputSchema) {
            zodSchema = this.convertMcpSchemaToZod(originalTool.inputSchema);
          }
          
          // Final fallback if still no schema
          if (!zodSchema) {
            zodSchema = z.object({
              input: z.string().describe('Input for the tool')
            });
          }
          
          enhancedTools[toolName] = tool({
            description: `${originalTool.description || toolName} (fallback mode)`,
            inputSchema: zodSchema,
            execute: async (params: any, meta?: any) => {
              return this.executeWithApprovalFlow(toolName, params, meta, routeDecision);
            }
          });
        }
      }
    }
    
    return enhancedTools;
  }

  /**
   * Execute tool with chat API approval flow
   */
  private async executeWithApprovalFlow(toolName: string, params: any, meta?: any, routeDecision?: any): Promise<any> {
    const toolCallId = meta?.toolCallId || `pending-${Date.now()}`;
    
    this.log(`[Production Router] Tool ${toolName} requires approval, storing for later execution`);
    
    // Store in global approval state (chat API pattern)
    const globalThis = global as any;
    if (!globalThis.toolApprovalState) {
      globalThis.toolApprovalState = {};
    }
    
    globalThis.toolApprovalState[toolCallId] = {
      approved: false,
      executed: false,
      toolCall: {
        name: toolName,
        params: this.transformParametersForExecution(toolName, params, routeDecision),
        meta
      },
      result: null
    };
    
    // Throw approval error with enhanced error information
    const approvalError = new Error(
      `This tool requires explicit user approval before execution. The ${this.getToolTypeDescription(toolName)} service is ready to process your request.`
    );
    
    Object.assign(approvalError, {
      toolCallId,
      toolName,
      toolArgs: params,
      routingInfo: routeDecision ? {
        selectedServer: routeDecision.serverName,
        confidence: routeDecision.confidence,
        reasoningText: routeDecision.reasoningPath[0]
      } : undefined
    });
    
    throw approvalError;
  }

  /**
   * Transform parameters based on tool type and query context
   */
  private transformParametersForExecution(toolName: string, params: any, routeDecision?: any): any {
    const lowerToolName = toolName.toLowerCase();
    
    // Handle empty parameters by extracting from query context
    if (!params || Object.keys(params).length === 0) {
      if (lowerToolName.includes('image')) {
        return { prompt: 'Create an image based on the user request' };
      } else if (lowerToolName.includes('calendar')) {
        return { query: 'upcoming events' };
      }
    }
    
    return params;
  }

  /**
   * Enhance tool descriptions for better AI model understanding
   */
  private enhanceToolDescriptionForChat(originalDescription: string, toolName: string, userQuery: string): string {
    const toolType = this.getToolTypeDescription(toolName);
    const queryRelevance = this.calculateQueryRelevance(toolName, userQuery);
    
    let enhanced = `[${queryRelevance > 0.8 ? 'HIGHLY RELEVANT' : 'RELEVANT'}] ${originalDescription}`;
    
    // Add contextual guidance
    if (toolName.includes('create_image')) {
      enhanced += ` This tool generates high-quality images based on text descriptions. Use for creative and visual content requests.`;
    } else if (toolName.includes('google_drive') && toolName.includes('upload')) {
      enhanced += ` 🚨 CRITICAL: This tool uploads files to Google Drive. Use IMMEDIATELY when user says "upload this image to Google Drive" or similar. Works with both generated and attached media. The system will automatically provide the correct file URL - do not ask for it.`;
    } else if (toolName.includes('gmail')) {
      enhanced += ` This tool searches and manages Gmail emails. Use for email-related tasks and inbox searches.`;
    } else if (toolName.includes('calendar')) {
      enhanced += ` This tool manages Google Calendar events and schedules. Use for calendar-related tasks and event searches.`;
    }
    
    enhanced += ` Server: ${this.getServerNameFromTool(toolName)} | Relevance: ${(queryRelevance * 100).toFixed(0)}%`;
    
    return enhanced;
  }

  /**
   * Create fallback tools when main system fails
   */
  private async createFallbackTools(userQuery: string, actualMcpTools?: Record<string, CoreTool>): Promise<Record<string, CoreTool>> {
    const fallbackTools: Record<string, CoreTool> = {};
    
    // Create a basic response tool
    fallbackTools['fallback_response'] = tool({
      description: 'Provide a helpful response when MCP tools are unavailable',
      inputSchema: z.object({
        query: z.string().describe('The user query to respond to')
      }),
      execute: async (params) => {
        return {
          response: `I'm experiencing temporary issues with external tools. I can still help you with general questions and information. Your query was: "${params.query}"`
        };
      }
    });
    
    return fallbackTools;
  }

  /**
   * Ensure server discovery is up to date
   */
  private async ensureServerDiscovery() {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    if (!this.lastHealthCheck || this.lastHealthCheck < fiveMinutesAgo) {
      this.log(`[Production Router] Running server discovery...`);
      await universalMcpDiscovery.discoverAllMcpServers();
      this.lastHealthCheck = now;
    }
  }

  /**
   * Get server health summary for monitoring
   */
  private async getServerHealthSummary() {
    try {
      const servers = await universalMcpDiscovery.discoverAllMcpServers();
      return servers.map(server => ({
        serverId: server.serverId,
        name: server.name,
        status: server.status,
        toolCount: server.availableTools.length
      }));
    } catch (error) {
      console.error(`[Production Router] Error getting server health:`, error);
      return [];
    }
  }

  /**
   * Initialize health monitoring
   */
  private initializeHealthMonitoring() {
    if (!this.config.enableHealthMonitoring) return;
    
    // Run health checks every 5 minutes
    setInterval(async () => {
      try {
        await this.ensureServerDiscovery();
        this.log(`[Production Router] Health check completed`);
      } catch (error) {
        console.error(`[Production Router] Health check failed:`, error);
      }
    }, 5 * 60 * 1000);
  }

  // Helper methods
  private calculateQueryRelevance(toolName: string, userQuery: string): number {
    const lowerQuery = userQuery.toLowerCase();
    const lowerTool = toolName.toLowerCase();
    
    if (lowerTool.includes('image') && (lowerQuery.includes('create') || lowerQuery.includes('generate') || lowerQuery.includes('image'))) {
      return 0.9;
    } else if (lowerTool.includes('gmail') && (lowerQuery.includes('email') || lowerQuery.includes('gmail'))) {
      return 0.85;
    } else if (lowerTool.includes('calendar') && (lowerQuery.includes('calendar') || lowerQuery.includes('event') || lowerQuery.includes('schedule'))) {
      return 0.9;
    }
    
    return 0.5;
  }

  private getToolTypeDescription(toolName: string): string {
    const lowerTool = toolName.toLowerCase();
    
    if (lowerTool.includes('image')) return 'image generation';
    if (lowerTool.includes('gmail')) return 'Gmail';
    if (lowerTool.includes('zapier')) return 'Zapier automation';
    
    return 'external service';
  }

  private getServerNameFromTool(toolName: string): string {
    const lowerTool = toolName.toLowerCase();
    
    if (lowerTool.includes('zapier')) return 'Zapier MCP';
    
    return 'MCP Server';
  }

  private log(message: string, data?: any) {
    if (this.config.debugMode) {
      if (data) {
        console.log(message, data);
      } else {
        console.log(message);
      }
    }
  }

  /**
   * Convert MCP JSON Schema to Zod schema
   * This handles the common patterns in MCP tool schemas
   */
  private convertMcpSchemaToZod(mcpSchema: any): z.ZodSchema<any> {
    try {
      // Handle the case where mcpSchema is already a Zod schema
      if (mcpSchema && mcpSchema._def) {
        return mcpSchema;
      }

      // Handle JSON Schema format
      if (mcpSchema.type === 'object' && mcpSchema.properties) {
        const zodShape: Record<string, z.ZodSchema<any>> = {};
        
        // Convert each property
        for (const [key, prop] of Object.entries(mcpSchema.properties as Record<string, any>)) {
          zodShape[key] = this.convertPropertyToZod(prop, mcpSchema.required?.includes(key) || false);
        }
        
        return z.object(zodShape);
      }
      
      // Handle simple types
      if (mcpSchema.type === 'string') {
        return z.string().describe(mcpSchema.description || '');
      } else if (mcpSchema.type === 'number') {
        return z.number().describe(mcpSchema.description || '');
      } else if (mcpSchema.type === 'boolean') {
        return z.boolean().describe(mcpSchema.description || '');
      } else if (mcpSchema.type === 'array') {
        return z.array(z.any()).describe(mcpSchema.description || '');
      }
      
      // Default fallback
      return z.object({
        input: z.string().describe('Input parameters for the tool')
      });
      
    } catch (error) {
      this.log(`[Production Router] Error converting MCP schema to Zod:`, error);
      // Return fallback schema on error
      return z.object({
        input: z.string().describe('Input parameters for the tool')
      });
    }
  }

  /**
   * Convert a single property from JSON Schema to Zod
   */
  private convertPropertyToZod(prop: any, isRequired: boolean): z.ZodSchema<any> {
    let zodType: z.ZodSchema<any>;
    
    // Determine the base type
    if (prop.type === 'string') {
      zodType = z.string();
    } else if (prop.type === 'number' || prop.type === 'integer') {
      zodType = z.number();
    } else if (prop.type === 'boolean') {
      zodType = z.boolean();
    } else if (prop.type === 'array') {
      zodType = z.array(z.any());
    } else if (prop.type === 'object') {
      zodType = z.object({});
    } else {
      zodType = z.any();
    }
    
    // Add description if available
    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }
    
    // Make optional if not required
    if (!isRequired) {
      zodType = zodType.optional();
    }
    
    return zodType;
  }
}

// Export singleton instance for production use
export const productionMcpRouter = new ProductionMcpRouter(); 
