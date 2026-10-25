/**
 * Universal Tool Result Formatter
 * 
 * This module provides universal formatting for any MCP tool result,
 * using intelligent content pattern detection rather than tool-specific logic.
 * Works with any tool: calendar, email, search, database, API calls, etc.
 */

interface ContentAnalysis {
  hasJson: boolean;
  hasLists: boolean;
  hasDates: boolean;
  hasUrls: boolean;
  hasKeyValuePairs: boolean;
  hasEmails: boolean;
  hasStructuredData: boolean;
  contentType: 'json' | 'text' | 'mixed';
  structure: 'simple' | 'complex' | 'nested';
}

interface UniversalFormattingResult {
  markdown: string;
  hasRichContent: boolean;
  contentType: string;
}

/**
 * Analyzes content to detect patterns universally
 */
function analyzeContent(result: any): ContentAnalysis {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  
  return {
    hasJson: isJsonLike(result),
    hasLists: hasListPatterns(resultStr),
    hasDates: hasDatePatterns(resultStr),
    hasUrls: hasUrlPatterns(resultStr),
    hasKeyValuePairs: hasKeyValuePatterns(resultStr),
    hasEmails: hasEmailPatterns(resultStr),
    hasStructuredData: typeof result === 'object' && result !== null,
    contentType: typeof result === 'object' ? 'json' : 'text',
    structure: getStructureComplexity(result)
  };
}

/**
 * Detects if content is JSON-like
 */
function isJsonLike(result: any): boolean {
  return typeof result === 'object' && result !== null;
}

/**
 * Detects list patterns in text
 */
function hasListPatterns(text: string): boolean {
  // Look for arrays, numbered lists, bullet points, etc.
  return /\[.*\]/.test(text) || 
         /^\d+\.\s/m.test(text) || 
         /^[-*•]\s/m.test(text) ||
         text.includes('\n- ') ||
         text.includes('\n* ');
}

/**
 * Detects date/time patterns
 */
function hasDatePatterns(text: string): boolean {
  const datePatterns = [
    /\d{4}-\d{2}-\d{2}/, // ISO date
    /\d{1,2}\/\d{1,2}\/\d{4}/, // US date
    /\d{1,2}-\d{1,2}-\d{4}/, // EU date
    /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
    /(January|February|March|April|May|June|July|August|September|October|November|December)/i,
    /\d{1,2}:\d{2}(\s?(AM|PM))?/i, // Time
    /at\s+\d{1,2}:\d{2}/i // "at 3:00"
  ];
  
  return datePatterns.some(pattern => pattern.test(text));
}

/**
 * Detects URL patterns
 */
function hasUrlPatterns(text: string): boolean {
  const urlPattern = /https?:\/\/[^\s]+/;
  return urlPattern.test(text);
}

/**
 * Detects key-value pair patterns
 */
function hasKeyValuePatterns(text: string): boolean {
  return /\w+:\s*\w+/.test(text) || 
         /"\w+":\s*"[^"]*"/.test(text) ||
         /\w+\s*=\s*\w+/.test(text);
}

/**
 * Detects email patterns
 */
function hasEmailPatterns(text: string): boolean {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  return emailPattern.test(text);
}

/**
 * Determines structure complexity
 */
function getStructureComplexity(result: any): 'simple' | 'complex' | 'nested' {
  if (typeof result === 'string') return 'simple';
  if (typeof result === 'object' && result !== null) {
    const keys = Object.keys(result);
    if (keys.length <= 3) return 'simple';
    if (keys.some(key => typeof result[key] === 'object')) return 'nested';
    return 'complex';
  }
  return 'simple';
}

/**
 * Applies universal enhancement patterns based on content analysis
 */
function applyUniversalPatterns(analysis: ContentAnalysis, result: any): string {
  let enhanced = '';
  
  if (analysis.hasStructuredData) {
    enhanced = formatStructuredData(result, analysis);
  } else {
    enhanced = formatTextData(result, analysis);
  }
  
  return enhanced;
}

/**
 * Formats structured data (JSON objects, arrays, etc.)
 */
function formatStructuredData(result: any, analysis: ContentAnalysis): string {
  // Special handling for Gmail results that might contain email objects
  if (Array.isArray(result) && result.length > 0 && result[0]?.subject) {
    // This looks like Gmail email data
    return result.map((email: any, index: number) => {
      const subject = email.subject || 'No Subject';
      const from = email.from || email.sender || 'Unknown Sender';
      const date = email.date || email.received_at || '';
      const snippet = email.snippet || email.preview || '';
      
      return `${index + 1}. **${subject}**\n   From: ${from}\n   ${date ? `Date: ${date}\n   ` : ''}${snippet ? `Preview: ${snippet}` : ''}`;
    }).join('\n\n');
  }
  
  if (Array.isArray(result)) {
    return formatArray(result);
  }
  
  if (typeof result === 'object' && result !== null) {
    return formatObject(result, analysis);
  }
  
  return String(result);
}

/**
 * Formats arrays into markdown lists
 */
function formatArray(arr: any[]): string {
  if (arr.length === 0) return 'No items found.';
  
  return arr.map((item, index) => {
    if (typeof item === 'object') {
      // Check if this is a calendar event
      if (isCalendarEvent(item)) {
        return formatCalendarEvent(item, index + 1);
      }
      return `${index + 1}. ${formatObjectInline(item)}`;
    }
    return `${index + 1}. ${String(item)}`;
  }).join('\n');
}

/**
 * Checks if an object is a calendar event
 */
function isCalendarEvent(obj: any): boolean {
  return obj && (
    (obj.kind === 'calendar#event') || 
    (obj.summary && obj.start && obj.end) ||
    (obj.title && obj.start) ||
    (obj.event && obj.date)
  );
}

/**
 * Formats a calendar event into human-readable text
 */
function formatCalendarEvent(event: any, index?: number): string {
  const parts: string[] = [];
  
  // Event title/summary
  const title = event.summary || event.title || event.event || 'Untitled Event';
  const prefix = index ? `${index}. ` : '';
  parts.push(`${prefix}**${title}**`);
  
  // Date and time formatting
  if (event.start) {
    const startDate = event.start.date || event.start.dateTime || event.start.date_pretty || event.start;
    const endDate = event.end?.date || event.end?.dateTime || event.end?.date_pretty || event.end;
    
    let dateStr = '';
    if (typeof startDate === 'string') {
      // Try to format the date nicely
      if (event.start.date_pretty) {
        dateStr = event.start.date_pretty;
      } else if (event.start.dateTime_pretty) {
        dateStr = event.start.dateTime_pretty;
      } else {
        dateStr = startDate;
      }
      
      // Add time if available and not already included
      if (event.start.time && !dateStr.includes(event.start.time)) {
        dateStr += ` at ${event.start.time}`;
      }
    }
    
    if (dateStr) {
      // Format based on whether it's all day or has specific time
      if (event.start.time === '' || !event.start.time) {
        parts.push(`📅 **${dateStr}** (All day)`);
      } else {
        parts.push(`📅 **${dateStr}**`);
      }
    }
  }
  
  // Duration if available
  if (event.duration_hours && event.duration_hours !== 24) {
    parts.push(`⏱️ **Duration:** ${event.duration_hours} hours`);
  } else if (event.duration_minutes && event.duration_minutes !== 1440) {
    parts.push(`⏱️ **Duration:** ${event.duration_minutes} minutes`);
  }
  
  // Location if available
  if (event.location) {
    parts.push(`📍 **Location:** ${event.location}`);
  }
  
  // Description if available and not too long
  if (event.description && event.description.length < 200) {
    parts.push(`📝 **Description:** ${event.description}`);
  }
  
  // Reminders if available
  if (event.reminders && event.reminders.overrides && Array.isArray(event.reminders.overrides)) {
    const reminderStrs = event.reminders.overrides.map((reminder: any) => {
      const method = reminder.method || 'notification';
      const minutes = reminder.minutes || 0;
      
      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return `${method} (${hours}h before)`;
      } else {
        return `${method} (${minutes}m before)`;
      }
    });
    
    if (reminderStrs.length > 0) {
      parts.push(`🔔 **Reminders:** ${reminderStrs.join(', ')}`);
    }
  }
  
  // Status if available and not default
  if (event.status && event.status !== 'confirmed') {
    parts.push(`📊 **Status:** ${event.status}`);
  }
  
  return parts.join('\n');
}

/**
 * Formats objects into readable key-value structure
 */
function formatObject(obj: any, analysis: ContentAnalysis): string {
  const entries = Object.entries(obj);
  
  if (entries.length === 0) return 'No data available.';
  
  // 🎯 UNIVERSAL FIX: KaTeX-safe formatting without bullet points
  return entries.map(([key, value]) => {
    const formattedKey = formatKey(key);
    
    // Handle nested objects (like cryptocurrency price data)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedEntries = Object.entries(value);
      
      // Special handling for single-value objects (like {usd: 104765})
      if (nestedEntries.length === 1) {
        const [nestedKey, nestedValue] = nestedEntries[0];
        
        // Format currencies and prices properly
        if (typeof nestedValue === 'number' && (nestedKey.toLowerCase() === 'usd' || nestedKey.toLowerCase().includes('price'))) {
          const formattedPrice = formatCurrency(nestedValue, nestedKey);
          return `**${formattedKey}**: ${formattedPrice}`;
        }
        
        return `**${formattedKey}**: ${formatValue(nestedValue)}`;
      }
      
      // Multiple nested values - handle timestamps and other data
      const nestedFormatted = nestedEntries.map(([nestedKey, nestedValue]) => {
        // Handle timestamps specially
        if (nestedKey.toLowerCase().includes('updated') || nestedKey.toLowerCase().includes('time') || nestedKey.toLowerCase().includes('date')) {
          if (typeof nestedValue === 'number') {
            return formatTimestamp(nestedValue);
          }
        }
        
        // Handle currency values
        if (typeof nestedValue === 'number' && (nestedKey.toLowerCase() === 'usd' || nestedKey.toLowerCase().includes('price'))) {
          return formatCurrency(nestedValue, nestedKey);
        }
        
        // Skip redundant or technical fields
        if (nestedKey.toLowerCase().includes('updated') || nestedKey.toLowerCase().includes('timestamp')) {
          return null;
        }
        
        const formattedNestedKey = formatKey(nestedKey);
        return `${formattedNestedKey}: ${formatValue(nestedValue)}`;
      }).filter(Boolean).join(', ');
      
      return `**${formattedKey}**: ${nestedFormatted}`;
    }
    
    // Handle primitive values
    const formattedValue = formatValue(value);
    return `**${formattedKey}**: ${formattedValue}`;
  }).join('\n\n');
}

/**
 * Formats object inline for lists
 */
function formatObjectInline(obj: any): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return 'Empty object';
  
  // For inline display, show key info concisely
  const keyEntries = entries.slice(0, 3); // Show first 3 entries
  const formatted = keyEntries.map(([key, value]) => {
    const formattedKey = formatKey(key);
    const formattedValue = String(value).substring(0, 50); // Truncate long values
    return `${formattedKey}: ${formattedValue}`;
  }).join(', ');
  
  if (entries.length > 3) {
    return `${formatted}...`;
  }
  
  return formatted;
}

/**
 * Formats text data with universal enhancements
 */
function formatTextData(result: any, analysis: ContentAnalysis): string {
  let text = String(result);
  
  // Clean any existing partial markdown first
  text = sanitizePartialMarkdown(text);
  
  // Apply universal text enhancements in careful order
  // 1. Structure first (lists, key-value pairs)
  text = enhanceLists(text);
  text = enhanceKeyValuePairs(text);
  
  // 2. Then inline formatting (dates, emails, URLs)
  text = enhanceDates(text);
  text = enhanceEmails(text);
  text = enhanceUrls(text);
  
  // 3. Finally, important text (most likely to conflict)
  text = enhanceImportantText(text);
  
  // 4. Validate and fix any broken markdown
  text = validateMarkdown(text);
  
  return text;
}

/**
 * Sanitizes partial or broken markdown
 */
function sanitizePartialMarkdown(text: string): string {
  // Remove any orphaned markdown characters that might interfere
  // But be conservative - only remove obvious problems
  return text;
}

/**
 * Validates and fixes broken markdown
 */
function validateMarkdown(text: string): string {
  // Count opening and closing ** pairs
  const boldMatches = text.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    console.warn('[Universal Formatter] Detected unmatched ** in markdown, attempting to fix');
    
    // Fix unmatched ** by adding a closing ** at the end if needed
    const lastBoldIndex = text.lastIndexOf('**');
    const beforeLastBold = text.substring(0, lastBoldIndex);
    const afterLastBold = text.substring(lastBoldIndex + 2);
    
    // Count ** before the last occurrence
    const beforeMatches = beforeLastBold.match(/\*\*/g);
    const beforeCount = beforeMatches ? beforeMatches.length : 0;
    
    // If we have an odd number before, the last ** is an opening tag, so add closing
    if (beforeCount % 2 === 0) {
      // Find the end of the current word/phrase and add closing **
      const nextSpaceOrEnd = afterLastBold.search(/[\s\n]|$/);
      if (nextSpaceOrEnd !== -1) {
        const insertPos = lastBoldIndex + 2 + nextSpaceOrEnd;
        text = text.substring(0, insertPos) + '**' + text.substring(insertPos);
      } else {
        text = text + '**';
      }
    }
  }
  
  return text;
}

/**
 * Enhances date/time formatting
 */
function enhanceDates(text: string): string {
  // Enhance common date patterns
  text = text.replace(/(\d{4}-\d{2}-\d{2})/g, '**$1**');
  text = text.replace(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/gi, '**$1**');
  text = text.replace(/(\d{1,2}:\d{2}(\s?(AM|PM))?)/gi, '**$1**');
  
  return text;
}

/**
 * Enhances URLs to be clickable
 */
function enhanceUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s]+)/g, '[$1]($1)');
}

/**
 * Enhances email formatting
 */
function enhanceEmails(text: string): string {
  return text.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '**$1**');
}

/**
 * Enhances list formatting
 */
function enhanceLists(text: string): string {
  // Convert simple lists to markdown - but don't interfere with existing proper lists
  // Only fix spacing issues, don't change already correct formatting
  text = text.replace(/^(\d+)\.(\S)/gm, '$1. $2'); // Add space after number if missing
  text = text.replace(/^([-*])(\S)/gm, '$1 $2'); // Add space after bullet if missing
  
  return text;
}

/**
 * Enhances key-value pair formatting
 */
function enhanceKeyValuePairs(text: string): string {
  // Enhance key: value patterns
  text = text.replace(/^(\w+):\s*(.+)$/gm, '**$1:** $2');
  
  return text;
}

/**
 * Enhances important text patterns
 */
function enhanceImportantText(text: string): string {
  // Enhance common important patterns - fixed to handle complete sentences
  text = text.replace(/(found \d+ [^:\n]+)/gi, '**$1**');
  text = text.replace(/\b(error|warning|success|completed|failed)\b/gi, '**$1**');
  
  return text;
}

/**
 * Formats object keys to be human-readable
 */
function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1') // Add space before capitals
    .replace(/[_-]/g, ' ') // Replace underscores and hyphens with spaces
    .replace(/\b\w/g, l => l.toUpperCase()) // Capitalize first letter of each word
    .trim();
}

/**
 * Formats currency values with proper symbols and formatting
 * Universal function for all types of currency/price data
 */
function formatCurrency(value: number, currencyKey: string): string {
  // Handle different currency types
  const currency = currencyKey.toLowerCase();
  
  if (currency === 'usd' || currency.includes('dollar')) {
    // Format USD with proper commas and dollar sign
    return `$${value.toLocaleString('en-US', { 
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 6 : 2
    })}`;
  }
  
  if (currency === 'eur' || currency.includes('euro')) {
    return `€${value.toLocaleString('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  
  if (currency === 'gbp' || currency.includes('pound')) {
    return `£${value.toLocaleString('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  
  if (currency === 'btc' || currency === 'bitcoin') {
    return `₿${value.toLocaleString('en-US', { 
      minimumFractionDigits: 6,
      maximumFractionDigits: 8
    })}`;
  }
  
  if (currency === 'eth' || currency === 'ethereum') {
    return `Ξ${value.toLocaleString('en-US', { 
      minimumFractionDigits: 4,
      maximumFractionDigits: 6
    })}`;
  }
  
  // Default: format with appropriate decimal places and the currency name
  const formattedValue = value.toLocaleString('en-US', { 
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2
  });
  
  return `${formattedValue} ${currency.toUpperCase()}`;
}

/**
 * Formats timestamps to human-readable format
 * Handles Unix timestamps and other timestamp formats
 */
function formatTimestamp(timestamp: number): string {
  // Handle Unix timestamps (both seconds and milliseconds)
  let date: Date;
  
  // If timestamp is in seconds (typical Unix timestamp)
  if (timestamp < 10000000000) {
    date = new Date(timestamp * 1000);
  } else {
    // If timestamp is in milliseconds
    date = new Date(timestamp);
  }
  
  // Check if the date is valid
  if (isNaN(date.getTime())) {
    return `Updated recently`;
  }
  
  // Format as human-readable date
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) {
    return 'Just updated';
  } else if (diffMinutes < 60) {
    return `Updated ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `Updated ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `Updated ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return `Updated on ${date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })}`;
  }
}

/**
 * Formats values with appropriate enhancement - CLEANED UP VERSION
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'Not specified';
  }
  
  if (typeof value === 'boolean') {
    return value ? '✅ Yes' : '❌ No';
  }
  
  if (typeof value === 'number') {
    // Format numbers with proper localization
    return value.toLocaleString('en-US', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: value % 1 === 0 ? 0 : 6
    });
  }
  
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length === 0) return 'Empty list';
      return value.map(item => `- ${String(item)}`).join('\n');
    }
    return formatObject(value, { structure: 'simple' } as ContentAnalysis);
  }
  
  let str = String(value);
  
  // Apply universal enhancements to the value (but no asterisks)
  str = enhanceUrls(str);
  str = enhanceEmails(str);
  
  return str;
}

/**
 * Main universal formatting function
 * This is the primary entry point for formatting any tool result
 */
export function formatToolResultUniversally(result: any, toolName?: string): UniversalFormattingResult {
  try {
    // Special handling for [object Object] issues during chat reload
    if (typeof result === 'string' && result.includes('[object Object]')) {
      console.warn('[Universal Formatter] Detected [object Object] in result, using fallback formatting');
      return {
        markdown: 'Tool completed successfully, but result format was not preserved during reload. Please try running the tool again for full details.',
        hasRichContent: false,
        contentType: 'text'
      };
    }
    
    // Step 1: Analyze content patterns
    const analysis = analyzeContent(result);
    
    // Step 2: Apply universal enhancement patterns
    const enhanced = applyUniversalPatterns(analysis, result);
    
    // Step 3: Generate final markdown
    const markdown = generateFinalMarkdown(enhanced, analysis, toolName);
    
    // Check if the enhanced markdown contains any formatting
    const hasMarkdownFormatting = markdown.includes('**') || markdown.includes('[') || markdown.includes('###') || markdown.includes('✅') || markdown.includes('❌');
    
    return {
      markdown,
      hasRichContent: analysis.hasStructuredData || analysis.hasLists || analysis.hasDates || analysis.hasUrls || analysis.hasEmails || hasMarkdownFormatting,
      contentType: analysis.contentType
    };
  } catch (error) {
    console.error('[Universal Formatter] Error formatting tool result:', error);
    
    // Fallback to simple string conversion
    return {
      markdown: String(result),
      hasRichContent: false,
      contentType: 'text'
    };
  }
}

/**
 * Generates final markdown with proper structure
 */
function generateFinalMarkdown(enhanced: string, analysis: ContentAnalysis, toolName?: string): string {
  let markdown = enhanced;
  
  // Add calendar-specific header if this is calendar data (but only if it doesn't already exist)
  if (toolName && toolName.includes('calendar') && enhanced.includes('📅')) {
    const eventCount = (enhanced.match(/^\d+\.\s/gm) || []).length;
    if (eventCount > 0 && !enhanced.includes('found') && !enhanced.includes('calendar event')) {
      const eventWord = eventCount === 1 ? 'event' : 'events';
      markdown = `I found ${eventCount} calendar ${eventWord} matching your request:\n\n${enhanced}`;
    }
  }
  
  // Add proper spacing and structure
  if (analysis.hasStructuredData && analysis.structure !== 'simple') {
    // For complex data, ensure proper spacing
    markdown = markdown.replace(/\n\n\n+/g, '\n\n');
  }
  
  // Ensure the content is well-formatted
  if (!markdown.trim()) {
    return 'No data available.';
  }
  
  return markdown.trim();
}

/**
 * Quick utility to check if a result needs rich formatting
 */
export function needsRichFormatting(result: any): boolean {
  const analysis = analyzeContent(result);
  return analysis.hasStructuredData || analysis.hasLists || analysis.hasDates || analysis.hasUrls;
} 