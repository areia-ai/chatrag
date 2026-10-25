# MCP Server Query Patterns

This directory contains query pattern definitions for each MCP (Model Context Protocol) server integration in ChatRAG.

## 📁 Structure

Each MCP server has its own TypeScript file that defines the query patterns for its tools and functions.

```
servers/
├── zapier.ts      # Zapier MCP patterns (Gmail, Calendar, Drive)
├── slack.ts       # Future: Slack integration patterns
├── notion.ts      # Future: Notion integration patterns
└── README.md      # This file
```

## 🚀 Adding a New MCP Server

### 1. Create a new file

Create a new TypeScript file in this directory named after your MCP server:

```typescript
// servers/yourserver.ts
```

### 2. Implement the pattern class

Extend the `McpServerPatternsBase` class:

```typescript
import { McpServerPatternsBase, PatternCategory } from '../base';

export class YourServerPatterns extends McpServerPatternsBase {
  serverName = 'yourserver';
  displayName = 'Your Server MCP';

  patterns: { [category: string]: PatternCategory } = {
    // Define your pattern categories here
    your_tool_name: {
      patterns: [
        /your.*pattern/i,
        /another.*pattern/i,
      ],
      confidence: 0.9,
      examples: [
        'your example query',
        'another example'
      ],
      description: 'What this tool does'
    }
  };
}

export const yourServerPatterns = new YourServerPatterns();
```

### 3. Register in index.ts

Add your server patterns to the registry in `/src/lib/mcp/query-patterns/index.ts`:

```typescript
import { yourServerPatterns } from './servers/yourserver';

const serverPatterns: McpServerPatterns[] = [
  zapierPatterns,
  yourServerPatterns, // Add your server here
];
```

## 📝 Pattern Guidelines

### Pattern Writing Best Practices

1. **Be Specific**: Write patterns that clearly identify the tool intent
   ```typescript
   // Good
   /send.*email|email.*to|compose.*email/i

   // Too broad
   /email/i
   ```

2. **Include Variations**: Cover different ways users might phrase requests
   ```typescript
   patterns: [
     /check.*calendar/i,    // "check my calendar"
     /view.*schedule/i,     // "view my schedule"
     /what.*appointments/i, // "what appointments do I have"
   ]
   ```

3. **Use Confidence Scores**: Higher confidence for more specific patterns
   ```typescript
   explicit_mention: { confidence: 1.0 },    // "use zapier to..."
   specific_action: { confidence: 0.95 },    // "fetch my emails"
   general_query: { confidence: 0.8 },       // "check messages"
   ```

4. **Provide Examples**: Help developers understand what queries match
   ```typescript
   examples: [
     'fetch my last 5 emails',
     'get emails from john',
     'check unread messages'
   ]
   ```

## 🧪 Testing Your Patterns

Use the test utility to verify your patterns work correctly:

```typescript
import { testPatternMatch } from '../index';

// Test your patterns
const result = testPatternMatch('fetch my emails');
console.log(result.matches);
```

## 📊 Current Integrations

### ✅ Zapier MCP (`zapier.ts`)
- **Gmail**: Find Email, Create Draft, Create Draft Reply, Reply to Email
- **Google Calendar**: Find Event
- **Google Drive**: Upload File

### 🔜 Planned Integrations
- Slack
- Notion
- GitHub
- Jira
- Trello

## 🔧 Environment Variables

Each server can check for its own environment variables:

```typescript
enabled(): boolean {
  // Check server-specific configuration
  const serverKey = process.env.MCP_YOURSERVER_ENDPOINT;
  return !!serverKey;
}
```

## 💡 Tips for AI Agents

When adding new MCP servers using Claude Code or other AI assistants:

1. **Copy the Zapier pattern**: Use `zapier.ts` as a template
2. **Follow naming conventions**: `serverName` should be lowercase, `displayName` for UI
3. **Group related tools**: Organize patterns by service (e.g., all Gmail tools together)
4. **Test with examples**: Ensure each pattern category has realistic example queries
5. **Document thoroughly**: Add descriptions for each tool category

## 🤝 Contributing

When contributing new server patterns:

1. Follow the existing pattern structure
2. Include comprehensive examples
3. Test patterns don't conflict with existing ones
4. Update this README with your integration
5. Add any required environment variables to init-env.js

---

For more information about the MCP query pattern system, see the main documentation in CLAUDE.md.