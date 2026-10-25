import { useMemo } from 'react';

// Pure function to sanitize titles - can be used outside of React components
export function sanitizeTitlePure(title: string): string {
  if (!title) return "New Chat";
  
  // Remove markdown formatting and clean up content
  let cleanTitle = title
    // Remove markdown markers and formatting
    .replace(/^[#\-*>\s]+|[\-*>#\s]+$/g, '')    // Remove markdown markers at start/end
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // Remove bold markers
    .replace(/\*([^*]+)\*/g, '$1')              // Remove italic markers
    .replace(/`([^`]+)`/g, '$1')                // Remove code markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // Remove links, keep text
    .replace(/^include: -.*$/ig, '')            // Remove "include: -" text patterns
    .replace(/^[\s\-_*]+/, '')                  // Remove starting decorations
    .replace(/[\s\-_*]+$/, '')                  // Remove ending decorations
    .replace(/^```[a-z]*\n[\s\S]*?\n```$/gm, '') // Remove code blocks
    .replace(/```/g, '')                        // Remove any remaining code block markers
    .replace(/\b(No-Co|No-Context:?)\b/gi, '')  // Remove No-Co/No-Context markers
    .replace(/\.{3,}$/g, '')                    // Remove trailing ellipsis
    .trim();
    
  // Special handling for questions - preserve question words
  const isQuestion = cleanTitle.includes('?');
  
  // Remove redundant prefixes and generic words to make titles more concise
  if (!isQuestion) {
    cleanTitle = cleanTitle
      .replace(/^(?:about|overview|information on|guide to|summary of)\s+/i, '')
      .replace(/^(?:information|details|facts)\s+(?:about|on|regarding)\s+/i, '')
      .replace(/^(?:here's|here is|this is)\s+(?:information|a summary|an overview)\s+(?:about|on|of)\s+/i, '')
      .replace(/^(?:I'll|I will)\s+(?:explain|describe|tell you about|give you|provide)\s+/i, '')
      .replace(/^(?:Let me|Let's)\s+(?:explain|describe|talk about)\s+/i, '')
      .trim();
  }
    
  // Properly capitalize title
  if (cleanTitle) {
    // For questions, use a special capitalization approach
    if (isQuestion) {
      // Split into words
      const words = cleanTitle.split(' ');
      
      // Capitalize first word always
      if (words.length > 0) {
        words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
      }
      
      // Capitalize proper nouns and key terms
      for (let i = 1; i < words.length; i++) {
        const word = words[i].toLowerCase();
        
        // Check if the word is a proper noun or key term
        if (
          // Acronyms (all caps)
          words[i].toUpperCase() === words[i] && words[i].length > 1 ||
          // Known proper nouns
          ['javascript', 'typescript', 'python', 'react', 'node', 'api', 'html', 'css', 'sql', 'json', 'xml'].includes(word) ||
          // Words that should be capitalized in titles
          word.length > 3 && !['what', 'when', 'where', 'which', 'with', 'from', 'that', 'this', 'have', 'will', 'would', 'could', 'should'].includes(word)
        ) {
          words[i] = word.charAt(0).toUpperCase() + word.slice(1);
        } else {
          words[i] = word;
        }
      }
      
      cleanTitle = words.join(' ');
    } else {
      // For non-questions, use regular title case
      cleanTitle = cleanTitle
        .split(' ')
        .map((word, index) => {
          const lowerWord = word.toLowerCase();
          
          // Always capitalize first and last word
          if (index === 0 || index === cleanTitle.split(' ').length - 1) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          }
          
          // Don't capitalize small words unless they're at the beginning
          if (['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with'].includes(lowerWord)) {
            return lowerWord;
          }
          
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    }
  }
  
  // If the title is still empty after all processing, set a default
  if (!cleanTitle) {
    cleanTitle = 'New Chat';
  }
  
  // Ensure title isn't too long for display - allow up to 70 chars for better titles
  if (cleanTitle.length > 70) {
    // Truncate at word boundary to avoid cutting mid-word
    const truncated = cleanTitle.substring(0, 67);
    const lastSpace = truncated.lastIndexOf(' ');
    cleanTitle = (lastSpace > 50 ? truncated.substring(0, lastSpace) : truncated) + '...';
  }
  
  return cleanTitle;
}

// React hook for memoized sanitize title
export function useSanitizeTitle(title: string): string {
  return useMemo(() => sanitizeTitlePure(title), [title]);
}

// Memoization cache for use outside of React components
const titleCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

export function sanitizeTitleCached(title: string): string {
  // Check cache first
  if (titleCache.has(title)) {
    return titleCache.get(title)!;
  }
  
  // Compute and cache the result
  const sanitized = sanitizeTitlePure(title);
  
  // Implement simple LRU-like behavior by clearing cache if it gets too large
  if (titleCache.size >= MAX_CACHE_SIZE) {
    const firstKey = titleCache.keys().next().value;
    titleCache.delete(firstKey);
  }
  
  titleCache.set(title, sanitized);
  return sanitized;
}