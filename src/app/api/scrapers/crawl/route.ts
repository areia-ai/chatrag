import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { crawlAndProcess } from '@/lib/scrapers/scraper-adapter';
import { isFirecrawlEnabled } from '@/lib/scrapers/firecrawl-client';
import { isHttpUrl, normalizeScrapedUrl } from '@/lib/scrapers/url-utils';
import { isSingleTenant } from '@/lib/deployment-mode';
import { verifyUserOrganizationAccess } from '@/lib/auth/organization-handler';

export const runtime = 'nodejs';
export const maxDuration = 300; // Crawling can take a long time (5 minutes max)

/**
 * POST /api/scrapers/crawl
 * Crawl multiple pages from a website and process them through the document pipeline
 * 
 * Request body:
 * - url: string (required) - The starting URL to crawl
 * - maxPages: number (optional, default: 10, max: 50) - Maximum number of pages to crawl
 * - outputFormat: 'html' | 'pdf' (optional, default: 'html')
 * - organizationId: string (optional) - For team documents in multi-tenant mode
 */
export async function POST(request: NextRequest) {
    console.log('[Crawl API] POST request received');

    // Check if Firecrawl is enabled
    if (!isFirecrawlEnabled()) {
        return NextResponse.json(
            { error: 'URL crawling is not enabled. Please configure FIRECRAWL_API_KEY and set NEXT_PUBLIC_FIRECRAWL_ENABLED=true' },
            { status: 503 }
        );
    }

    try {
        // Get authenticated user (required in multi-tenant, optional in single-tenant)
        let userId: string | null = null;
        let organizationId: string | null = null;

        if (!isSingleTenant()) {
            // Multi-tenant mode: authentication required
            const supabase = await createClient();
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (!user || authError) {
                return NextResponse.json(
                    { error: 'Authentication required' },
                    { status: 401 }
                );
            }

            userId = user.id;
        }

        // Parse request body
        const body = await request.json();
        const { url, maxPages, outputFormat, organizationId: orgIdFromBody } = body;

        // Validate URL
        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'Valid URL required' },
                { status: 400 }
            );
        }

        if (!isHttpUrl(url)) {
            return NextResponse.json(
                { error: 'Invalid URL format' },
                { status: 400 }
            );
        }

        const normalizedUrl = normalizeScrapedUrl(url);

        // Validate and limit maxPages
        const validatedMaxPages = Math.min(
            Math.max(1, parseInt(maxPages) || 10),
            50 // Hard limit to prevent abuse
        );

        // Validate output format
        if (outputFormat && !['html', 'pdf'].includes(outputFormat)) {
            return NextResponse.json(
                { error: 'Invalid output format. Must be "html" or "pdf"' },
                { status: 400 }
            );
        }

        // Handle organization ID for multi-tenant mode
        if (!isSingleTenant() && orgIdFromBody) {
            const access = await verifyUserOrganizationAccess(userId!, orgIdFromBody);

            if (access.hasAccess) {
                organizationId = orgIdFromBody;
                console.log('[Crawl API] Team documents for organization:', organizationId);
            } else {
                return NextResponse.json(
                    { error: 'You are not a member of this organization' },
                    { status: 403 }
                );
            }
        }

        console.log('[Crawl API] Crawling URL:', {
            url: normalizedUrl,
            maxPages: validatedMaxPages,
            outputFormat: outputFormat || 'html',
            userId: userId || 'single-tenant',
            organizationId: organizationId || 'personal'
        });

        // Crawl and process the website
        const result = await crawlAndProcess({
            url: normalizedUrl,
            userId: userId || 'single-tenant-user',
            organizationId,
            maxPages: validatedMaxPages,
            outputFormat: outputFormat || 'html',
        });

        console.log('[Crawl API] Crawl complete:', {
            totalPages: result.totalPages,
            successfulPages: result.successfulPages,
            failedPages: result.failedPages,
        });

        return NextResponse.json({
            success: true,
            totalPages: result.totalPages,
            successfulPages: result.successfulPages,
            failedPages: result.failedPages,
            documents: result.documents,
            errors: result.errors.length > 0 ? result.errors : undefined,
            message: `Successfully crawled and processed ${result.successfulPages}/${result.totalPages} pages`,
        });

    } catch (error) {
        console.error('[Crawl API] Error:', error);

        // Handle specific error types
        if (error instanceof Error) {
            if (error.message.includes('FIRECRAWL_API_KEY')) {
                return NextResponse.json(
                    { error: 'Firecrawl is not properly configured' },
                    { status: 503 }
                );
            }

            if (error.message.includes('timeout') || error.message.includes('timed out')) {
                return NextResponse.json(
                    { error: 'Crawling timed out. Try reducing maxPages or try again later.' },
                    { status: 504 }
                );
            }

            // Generic error with message
            return NextResponse.json(
                {
                    error: 'Failed to crawl website',
                    details: error.message
                },
                { status: 500 }
            );
        }

        // Unknown error
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
