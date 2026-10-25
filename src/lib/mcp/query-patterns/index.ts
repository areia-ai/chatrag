/**
 * MCP Query Pattern Aggregator
 * Automatically discovers and combines patterns from all MCP servers
 */

import { McpServerPatterns, PatternMatch } from './base';
import { zapierPatterns } from './servers/zapier';

// Import additional server patterns here as they are added
// Example: import { slackPatterns } from './servers/slack';

/**
 * Registry of all available MCP server patterns
 * Add new servers to this array as they are implemented
 */
const serverPatterns: McpServerPatterns[] = [
  zapierPatterns,
  // Add more server patterns here
  // slackPatterns,
  // notionPatterns,
  // etc.
];

/**
 * Get all enabled server patterns
 */
export function getEnabledServerPatterns(): McpServerPatterns[] {
  return serverPatterns.filter(server => {
    try {
      return server.enabled();
    } catch (error) {
      console.warn(`Error checking if ${server.serverName} is enabled:`, error);
      return false;
    }
  });
}

/**
 * Check if a query matches any MCP tool patterns
 * Returns the best match across all enabled servers
 */
export function matchMcpQuery(query: string): PatternMatch {
  const enabledServers = getEnabledServerPatterns();

  if (enabledServers.length === 0) {
    return {
      matched: false,
      confidence: 0,
      reasoningText: 'No MCP servers are enabled'
    };
  }

  let bestMatch: PatternMatch = {
    matched: false,
    confidence: 0,
    reasoningText: 'No patterns matched'
  };

  // Check each enabled server's patterns
  for (const server of enabledServers) {
    try {
      const match = server.match(query);

      // Keep the match with highest confidence
      if (match.matched && match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
    } catch (error) {
      console.warn(`Error matching patterns for ${server.serverName}:`, error);
    }
  }

  return bestMatch;
}

/**
 * Get all tool patterns as RegExp array (for backward compatibility)
 * This flattens all patterns from all enabled servers
 */
export function getAllToolPatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  const enabledServers = getEnabledServerPatterns();

  for (const server of enabledServers) {
    for (const category of Object.values(server.patterns)) {
      patterns.push(...category.patterns);
    }
  }

  return patterns;
}

/**
 * Check if any MCP patterns would match this query
 * Quick check without detailed match information
 */
export function requiresMcpTools(query: string): boolean {
  const match = matchMcpQuery(query);
  return match.matched;
}

/**
 * Get pattern statistics for debugging/monitoring
 */
export function getPatternStats(): {
  totalServers: number;
  enabledServers: number;
  totalPatterns: number;
  serverDetails: Array<{
    name: string;
    enabled: boolean;
    patternCount: number;
    categories: string[];
  }>;
} {
  const enabledServers = getEnabledServerPatterns();
  let totalPatterns = 0;

  const serverDetails = serverPatterns.map(server => {
    const categories = Object.keys(server.patterns);
    const patternCount = categories.reduce((sum, cat) => {
      return sum + server.patterns[cat].patterns.length;
    }, 0);

    if (server.enabled()) {
      totalPatterns += patternCount;
    }

    return {
      name: server.displayName,
      enabled: server.enabled(),
      patternCount,
      categories
    };
  });

  return {
    totalServers: serverPatterns.length,
    enabledServers: enabledServers.length,
    totalPatterns,
    serverDetails
  };
}

/**
 * Test utility: Check which patterns match a query
 * Useful for debugging and pattern development
 */
export function testPatternMatch(query: string): {
  query: string;
  matches: Array<{
    server: string;
    category: string;
    pattern: string;
    confidence: number;
  }>;
} {
  const matches: Array<{
    server: string;
    category: string;
    pattern: string;
    confidence: number;
  }> = [];

  const enabledServers = getEnabledServerPatterns();
  const cleanQuery = query.trim().toLowerCase();

  for (const server of enabledServers) {
    for (const [categoryName, category] of Object.entries(server.patterns)) {
      for (const pattern of category.patterns) {
        if (pattern.test(cleanQuery)) {
          matches.push({
            server: server.displayName,
            category: categoryName,
            pattern: pattern.toString(),
            confidence: category.confidence
          });
        }
      }
    }
  }

  return { query, matches };
}

// Export types for external use
export type { McpServerPatterns, PatternMatch, PatternCategory } from './base';
export { McpServerPatternsBase } from './base';