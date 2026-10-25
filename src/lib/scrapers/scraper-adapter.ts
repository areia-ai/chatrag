import { scrapeUrl, crawlWebsite } from './firecrawl-client';
import { processDocument } from '@/lib/document-processor';
import type { ProcessDocumentMetadata } from '@/lib/document-processor';
import { normalizeScrapedUrl } from './url-utils';

interface ScrapeOptions {
    url: string;
    userId: string;
    organizationId?: string | null;
    outputFormat?: 'html' | 'pdf';
}

interface CrawlOptions {
    url: string;
    userId: string;
    organizationId?: string | null;
    maxPages?: number;
    outputFormat?: 'html' | 'pdf';
}

/**
 * Scrape a single URL and process it through the document pipeline
 */
export async function scrapeAndProcess({
    url,
    userId,
    organizationId
}: ScrapeOptions): Promise<{
    documentId: string;
    url: string;
    title?: string;
}> {
    const normalizedUrl = normalizeScrapedUrl(url);

    // Scrape the URL
    console.log(`[Scraper Adapter] Scraping ${normalizedUrl} as html...`);
    const result = await scrapeUrl(normalizedUrl);

    // Convert to buffer
    let buffer: Buffer;
    let filename: string;

    if (result.html) {
        buffer = Buffer.from(result.html, 'utf-8');
        // Use the website title if available, fallback to sanitized URL
        const pageTitle = result.metadata?.title?.trim();
        filename = pageTitle ? `${sanitizeFilename(pageTitle)}.html` : `${sanitizeUrl(url)}.html`;
    } else {
        throw new Error('No HTML content returned from Firecrawl');
    }

    console.log(`[Scraper Adapter] Processing buffer: ${filename} (${buffer.length} bytes)`);

    // Create metadata for document tracking
    const metadata: ProcessDocumentMetadata = {
        user_id: userId,
        organization_id: organizationId || null,
        source: 'scrape',
        source_provider: 'firecrawl',
        source_file_id: normalizedUrl,
        source_connection_id: `firecrawl-${userId}`, // Virtual connection ID
        external_url: normalizedUrl,
        scraped_url: normalizedUrl,
        title: result.metadata?.title,
    };

    // Process through existing pipeline (LlamaCloud → Embeddings → Supabase)
    const documentId = await processDocument(filename, buffer, metadata);

    console.log(`[Scraper Adapter] Successfully processed ${url} → ${documentId}`);

    return {
        documentId,
        url: normalizedUrl,
        title: result.metadata?.title,
    };
}

/**
 * Crawl multiple pages from a website and process them
 */
export async function crawlAndProcess({
    url,
    userId,
    organizationId,
    maxPages = 10
}: CrawlOptions): Promise<{
    totalPages: number;
    successfulPages: number;
    failedPages: number;
    documents: Array<{ documentId: string; url: string; title?: string }>;
    errors: Array<{ url: string; error: string }>;
}> {
    const normalizedUrl = normalizeScrapedUrl(url);

    console.log(`[Scraper Adapter] Crawling ${normalizedUrl}, max ${maxPages} pages...`);

    // Crawl the website
    const pages = await crawlWebsite(normalizedUrl, { maxPages });

    const documents: Array<{ documentId: string; url: string; title?: string }> = [];
    const errors: Array<{ url: string; error: string }> = [];

    // Process each page
    for (const page of pages) {
        try {
            let buffer: Buffer;
            let filename: string;

            if (page.html) {
                buffer = Buffer.from(page.html, 'utf-8');
                // Use the page title if available, fallback to sanitized URL
                const pageTitle = page.metadata?.title?.trim();
                filename = pageTitle ? `${sanitizeFilename(pageTitle)}.html` : `${sanitizeUrl(page.url)}.html`;
            } else {
                throw new Error('No HTML content in crawled page');
            }

            const metadata: ProcessDocumentMetadata = {
                user_id: userId,
                organization_id: organizationId || null,
                source: 'scrape',
                source_provider: 'firecrawl',
                source_file_id: normalizeScrapedUrl(page.url),
                source_connection_id: `firecrawl-${userId}`,
                external_url: normalizeScrapedUrl(page.url),
                scraped_url: normalizeScrapedUrl(page.url),
                title: page.metadata?.title,
            };

            const documentId = await processDocument(filename, buffer, metadata);

            documents.push({
                documentId,
                url: page.url,
                title: page.metadata?.title,
            });

            console.log(`[Scraper Adapter] ✓ Processed ${page.url}`);
        } catch (error) {
            console.error(`[Scraper Adapter] ✗ Failed to process ${page.url}:`, error);
            errors.push({
                url: page.url,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    console.log(`[Scraper Adapter] Crawl complete: ${documents.length}/${pages.length} pages processed successfully`);

    return {
        totalPages: pages.length,
        successfulPages: documents.length,
        failedPages: errors.length,
        documents,
        errors,
    };
}

/**
 * Convert a title string to a safe filename
 */
function sanitizeFilename(title: string): string {
    return title
        .replace(/[^a-zA-Z0-9\s\-_]/g, '')  // Remove special characters
        .replace(/\s+/g, '-')                // Replace spaces with hyphens
        .replace(/-+/g, '-')                 // Remove consecutive hyphens
        .replace(/^-|-$/g, '')               // Remove leading/trailing hyphens
        .substring(0, 100) || 'scraped-page';
}

/**
 * Convert URL to a safe filename
 */
function sanitizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '') || 'index';
        const sanitized = `${urlObj.hostname}_${path}`
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 100);
        return sanitized || 'scraped-page';
    } catch {
        return url
            .replace(/^https?:\/\//, '')
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .substring(0, 100) || 'scraped-page';
    }
}
