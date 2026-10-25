import Firecrawl from '@mendable/firecrawl-js';
import { env } from '@/lib/env';

let firecrawlInstance: Firecrawl | null = null;

/**
 * Get the Firecrawl client instance (singleton)
 */
export function getFirecrawl(): Firecrawl {
    if (!firecrawlInstance) {
        if (!env.FIRECRAWL_API_KEY) {
            throw new Error('FIRECRAWL_API_KEY is not configured');
        }

        firecrawlInstance = new Firecrawl({
            apiKey: env.FIRECRAWL_API_KEY,
        });
    }
    return firecrawlInstance;
}

/**
 * Check if Firecrawl is enabled
 */
export function isFirecrawlEnabled(): boolean {
    return env.NEXT_PUBLIC_FIRECRAWL_ENABLED === 'true' && Boolean(env.FIRECRAWL_API_KEY);
}

/**
 * Scrape a single URL using Firecrawl
 */
export async function scrapeUrl(
    url: string,
    options?: {
        onlyMainContent?: boolean;
        waitFor?: number;
        screenshot?: boolean;
    }
): Promise<{
    html?: string;
    markdown?: string;
    metadata?: {
        title?: string;
        description?: string;
        language?: string;
        sourceURL?: string;
    };
}> {
    const firecrawl = getFirecrawl();

    console.log('[Firecrawl] Debug - Instance type:', typeof firecrawl);
    console.log('[Firecrawl] Debug - Keys:', Object.keys(firecrawl));
    console.log('[Firecrawl] Debug - Prototype keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(firecrawl)));
    console.log('[Firecrawl] Debug - scrapeUrl exists:', !!(firecrawl as any).scrapeUrl);

    const outputFormat = 'html';
    const onlyMainContent = options?.onlyMainContent ?? (env.FIRECRAWL_ONLY_MAIN_CONTENT === 'true');
    const waitFor = options?.waitFor ?? parseInt(env.FIRECRAWL_WAIT_FOR_JS || '2000');

    console.log(`[Firecrawl] Scraping ${url} as ${outputFormat}...`);

    const scrapeOptions: any = {
        formats: [outputFormat],
        onlyMainContent,
        waitFor,
    };

    if (options?.screenshot !== undefined) {
        scrapeOptions.screenshot = options.screenshot;
    }

    // Use 'scrape' instead of 'scrapeUrl' per latest SDK
    const result = await firecrawl.scrape(url, scrapeOptions as any);

    console.log(`[Firecrawl] Successfully scraped ${url}`, {
        hasHtml: Boolean(result.hasOwnProperty('html')),
        hasMetadata: Boolean(result.hasOwnProperty('metadata')),
    });

    return result as any;
}

/**
 * Crawl multiple pages from a website
 */
export async function crawlWebsite(
    url: string,
    options?: {
        maxPages?: number;
        onlyMainContent?: boolean;
    }
): Promise<Array<{
    url: string;
    html?: string;
    markdown?: string;
    metadata?: any;
}>> {
    const firecrawl = getFirecrawl();

    const outputFormat = 'html';
    const onlyMainContent = options?.onlyMainContent ?? (env.FIRECRAWL_ONLY_MAIN_CONTENT === 'true');
    const maxPages = options?.maxPages || 10;

    console.log(`[Firecrawl] Crawling ${url}, max ${maxPages} pages...`);

    // Use 'crawl' instead of 'crawlUrl'
    const crawlResult = await firecrawl.crawl(url, {
        limit: maxPages,
        scrapeOptions: {
            formats: [outputFormat] as any,
            onlyMainContent,
        },
    });

    console.log(`[Firecrawl] Successfully crawled ${crawlResult.data?.length || 0} pages from ${url}`);

    return (crawlResult.data || []) as any;
}
