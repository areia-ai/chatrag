/**
 * URL Extraction and Management for RAG System
 * Extracts, categorizes, and formats URLs from document text for AI responses
 */

export interface ExtractedURL {
  url: string;
  context: string; // The text surrounding the URL
  category?: 'product' | 'documentation' | 'social' | 'payment' | 'external' | 'other';
  description?: string; // A human-readable description of what the link is for
}

export interface URLMetadata {
  urls: ExtractedURL[];
  hasLinks: boolean;
  linkCount: number;
}

/**
 * Comprehensive URL pattern matching
 * Matches various URL formats including markdown links
 */
const URL_PATTERNS = {
  // Standard URLs (http, https, ftp, etc.)
  standard: /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/gi,

  // Markdown links [text](url)
  markdown: /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi,

  // Naked domains (www.example.com)
  nakedDomain: /(?:^|[\s])(?:www\.)([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*))/gi,
};

/**
 * Categorize a URL based on its domain and path
 */
function categorizeURL(url: string): ExtractedURL['category'] {
  const lowerURL = url.toLowerCase();

  // Payment/checkout links
  if (lowerURL.includes('polar.sh') ||
      lowerURL.includes('stripe.com') ||
      lowerURL.includes('gumroad.com') ||
      lowerURL.includes('checkout') ||
      lowerURL.includes('payment') ||
      lowerURL.includes('buy')) {
    return 'payment';
  }

  // Product pages
  if (lowerURL.includes('product') ||
      lowerURL.includes('pricing') ||
      lowerURL.includes('shop')) {
    return 'product';
  }

  // Documentation
  if (lowerURL.includes('docs') ||
      lowerURL.includes('documentation') ||
      lowerURL.includes('guide') ||
      lowerURL.includes('wiki') ||
      lowerURL.includes('readme')) {
    return 'documentation';
  }

  // Social media
  if (lowerURL.includes('twitter.com') ||
      lowerURL.includes('x.com') ||
      lowerURL.includes('linkedin.com') ||
      lowerURL.includes('facebook.com') ||
      lowerURL.includes('instagram.com') ||
      lowerURL.includes('github.com')) {
    return 'social';
  }

  return 'other';
}

/**
 * Extract context around a URL (text before and after)
 */
function extractURLContext(text: string, urlMatch: string, contextLength: number = 100): string {
  const urlIndex = text.indexOf(urlMatch);
  if (urlIndex === -1) return '';

  const start = Math.max(0, urlIndex - contextLength);
  const end = Math.min(text.length, urlIndex + urlMatch.length + contextLength);

  let context = text.substring(start, end).trim();

  // Clean up the context
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context;
}

/**
 * Generate a human-readable description for a URL based on context
 */
function generateURLDescription(url: string, context: string, markdownText?: string): string {
  // If we have markdown text, use that as it's usually descriptive
  if (markdownText && markdownText.trim()) {
    return markdownText.trim();
  }

  // Otherwise, try to extract from context
  const category = categorizeURL(url);

  // Try to find a descriptive sentence in the context
  const sentences = context.split(/[.!?]+/).filter(s => s.trim().length > 10);
  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    // If the sentence mentions the URL or is near it, use it
    if (cleanSentence.length < 200) {
      return cleanSentence;
    }
  }

  // Fallback: Use the URL domain as description
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');

    switch (category) {
      case 'payment':
        return `Purchase or checkout page at ${domain}`;
      case 'product':
        return `Product information at ${domain}`;
      case 'documentation':
        return `Documentation at ${domain}`;
      case 'social':
        return `Social media profile at ${domain}`;
      default:
        return `Link to ${domain}`;
    }
  } catch (e) {
    return 'External link';
  }
}

/**
 * Extract all URLs from text with their context and metadata
 */
export function extractURLs(text: string): URLMetadata {
  const urlsMap = new Map<string, ExtractedURL>();

  // Extract markdown links first (they have descriptive text)
  const markdownMatches = Array.from(text.matchAll(URL_PATTERNS.markdown));
  for (const match of markdownMatches) {
    const [fullMatch, linkText, url] = match;
    const context = extractURLContext(text, fullMatch);
    const category = categorizeURL(url);

    urlsMap.set(url, {
      url,
      context,
      category,
      description: linkText || generateURLDescription(url, context)
    });
  }

  // Extract standard URLs
  const standardMatches = Array.from(text.matchAll(URL_PATTERNS.standard));
  for (const match of standardMatches) {
    const url = match[0];

    // Skip if already extracted from markdown
    if (urlsMap.has(url)) continue;

    const context = extractURLContext(text, url);
    const category = categorizeURL(url);

    urlsMap.set(url, {
      url,
      context,
      category,
      description: generateURLDescription(url, context)
    });
  }

  // Extract naked domains (www.example.com)
  const nakedMatches = Array.from(text.matchAll(URL_PATTERNS.nakedDomain));
  for (const match of nakedMatches) {
    const domain = match[1];
    const url = 'https://' + domain;

    // Skip if already extracted
    if (urlsMap.has(url)) continue;

    const context = extractURLContext(text, domain);
    const category = categorizeURL(url);

    urlsMap.set(url, {
      url,
      context,
      category,
      description: generateURLDescription(url, context)
    });
  }

  const urls = Array.from(urlsMap.values());

  return {
    urls,
    hasLinks: urls.length > 0,
    linkCount: urls.length
  };
}

/**
 * Format URLs for inclusion in AI context
 * Creates a structured format that the AI can easily reference
 */
export function formatURLsForContext(urls: ExtractedURL[]): string {
  if (urls.length === 0) return '';

  const urlsByCategory = new Map<string, ExtractedURL[]>();

  // Group URLs by category
  for (const url of urls) {
    const category = url.category || 'other';
    if (!urlsByCategory.has(category)) {
      urlsByCategory.set(category, []);
    }
    urlsByCategory.get(category)!.push(url);
  }

  // Format the URLs
  const sections: string[] = [];

  // Priority order for categories
  const categoryOrder: Array<ExtractedURL['category']> = ['payment', 'product', 'documentation', 'social', 'other'];

  for (const category of categoryOrder) {
    const categoryURLs = urlsByCategory.get(category!);
    if (!categoryURLs || categoryURLs.length === 0) continue;

    const categoryName = category!.charAt(0).toUpperCase() + category!.slice(1);
    sections.push(`${categoryName} Links:`);

    for (const urlData of categoryURLs) {
      const description = urlData.description || 'Link';
      sections.push(`  - ${description}: ${urlData.url}`);
    }
    sections.push(''); // Empty line between categories
  }

  if (sections.length > 0) {
    return `\n=== RELEVANT LINKS ===\n${sections.join('\n')}\n=== END LINKS ===\n`;
  }

  return '';
}

/**
 * Create instructions for the AI on how to use links in responses
 */
export function createLinkUsageInstructions(): string {
  return `
IMPORTANT - Link Usage Instructions:
When responding to queries, if relevant links are provided in the "RELEVANT LINKS" section:
1. Include clickable links naturally in your response when mentioning related products, services, or resources
2. Format links as markdown: [descriptive text](URL)
3. Use the provided link descriptions to understand what each link is for
4. Only include links that are directly relevant to answering the user's question
5. Don't just list all links - integrate them naturally into your answer where they add value

Examples of good link usage:
- "You can purchase the Pro plan [here](https://example.com/pricing/pro)"
- "For more details, check out the [documentation](https://docs.chatrag.ai)"
- "Visit our [pricing page](https://chatrag.ai/pricing) to compare plans"
`;
}

/**
 * Extract URLs from a chunk and update its metadata
 */
export function enrichChunkWithURLs(chunkContent: string, existingMetadata: any = {}): any {
  const urlMetadata = extractURLs(chunkContent);

  return {
    ...existingMetadata,
    urls: urlMetadata.urls,
    has_urls: urlMetadata.hasLinks,
    url_count: urlMetadata.linkCount,
    url_categories: [...new Set(urlMetadata.urls.map(u => u.category))],
  };
}
