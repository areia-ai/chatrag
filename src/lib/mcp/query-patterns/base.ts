/**
 * Base types and interfaces for MCP query pattern system
 * This modular system allows each MCP server to define its own query patterns
 */

export interface PatternCategory {
  /**
   * Regular expression patterns that match user queries
   */
  patterns: RegExp[];

  /**
   * Confidence score when these patterns match (0-1)
   */
  confidence: number;

  /**
   * Example queries that should match these patterns
   * Used for testing and documentation
   */
  examples: string[];

  /**
   * Human-readable description of what this category handles
   */
  description: string;
}

export interface McpServerPatterns {
  /**
   * Name of the MCP server (e.g., "zapier", "slack", etc.)
   */
  serverName: string;

  /**
   * Human-readable display name
   */
  displayName: string;

  /**
   * Whether this server's patterns should be active
   * Can be tied to environment variables or config
   */
  enabled: () => boolean;

  /**
   * Pattern categories organized by tool/function
   * Key is the category name (e.g., "gmail_find", "calendar_events")
   */
  patterns: {
    [category: string]: PatternCategory;
  };

  /**
   * Optional metadata about the server
   */
  metadata?: {
    version: string;
    author?: string;
    description?: string;
    documentationUrl?: string;
  };
}

export interface PatternMatch {
  /**
   * Whether any pattern matched
   */
  matched: boolean;

  /**
   * Which server's patterns matched
   */
  serverName?: string;

  /**
   * Which category within the server matched
   */
  category?: string;

  /**
   * Confidence score of the match
   */
  confidence: number;

  /**
   * The specific pattern that matched
   */
  matchedPattern?: RegExp;

  /**
   * Reasoning for the match
   */
  reasoningText: string;
}

/**
 * Base class for MCP server pattern definitions
 * Provides common functionality for all server patterns
 */
export abstract class McpServerPatternsBase implements McpServerPatterns {
  abstract serverName: string;
  abstract displayName: string;
  abstract patterns: { [category: string]: PatternCategory };

  /**
   * Default enabled check - can be overridden
   */
  enabled(): boolean {
    // Check if MCP system is enabled globally
    if (process.env.NEXT_PUBLIC_MCP_SYSTEM_ENABLED !== 'true') {
      return false;
    }

    // Check server-specific enable flag if exists
    const serverEnvKey = `NEXT_PUBLIC_MCP_${this.serverName.toUpperCase()}_ENABLED`;
    const serverEnabled = process.env[serverEnvKey];

    // If no server-specific flag, default to enabled
    return serverEnabled !== undefined ? serverEnabled === 'true' : true;
  }

  /**
   * Test if a query matches any patterns in this server
   */
  match(query: string): PatternMatch {
    const cleanQuery = query.trim().toLowerCase();

    for (const [categoryName, category] of Object.entries(this.patterns)) {
      for (const pattern of category.patterns) {
        if (pattern.test(cleanQuery)) {
          return {
            matched: true,
            serverName: this.serverName,
            category: categoryName,
            confidence: category.confidence,
            matchedPattern: pattern,
            reasoningText: `Matched ${this.displayName} pattern for ${category.description}`
          };
        }
      }
    }

    return {
      matched: false,
      confidence: 0,
      reasoningText: `No ${this.displayName} patterns matched`
    };
  }
}