import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { scrapeAndProcess } from '@/lib/scrapers/scraper-adapter';
import { isFirecrawlEnabled } from '@/lib/scrapers/firecrawl-client';
import { isHttpUrl, normalizeScrapedUrl } from '@/lib/scrapers/url-utils';
import { isSingleTenant } from '@/lib/deployment-mode';
import { verifyUserOrganizationAccess } from '@/lib/auth/organization-handler';

export const runtime = 'nodejs';
export const maxDuration = 60; // Scraping can take time

/**
 * POST /api/scrapers/scrape
 * Scrape a single URL and process it through the document pipeline
 * 
 * Request body:
 * - url: string (required) - The URL to scrape
 * - outputFormat: 'html' | 'pdf' (optional, default: 'html')
 * - organizationId: string (optional) - For team documents in multi-tenant mode
 */
export async function POST(request: NextRequest) {
    console.log('[Scrape API] POST request received');

    // Check if Firecrawl is enabled
    if (!isFirecrawlEnabled()) {
        return NextResponse.json(
            { error: 'URL scraping is not enabled. Please configure FIRECRAWL_API_KEY and set NEXT_PUBLIC_FIRECRAWL_ENABLED=true' },
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
        const { url, outputFormat, organizationId: orgIdFromBody } = body;

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
                console.log('[Scrape API] Team document for organization:', organizationId);
            } else {
                return NextResponse.json(
                    { error: 'You are not a member of this organization' },
                    { status: 403 }
                );
            }
        }

        console.log('[Scrape API] Scraping URL:', {
            url: normalizedUrl,
            outputFormat: outputFormat || 'html',
            userId: userId || 'single-tenant',
            organizationId: organizationId || 'personal'
        });

        // Scrape and process the URL
        const result = await scrapeAndProcess({
            url: normalizedUrl,
            userId: userId || 'single-tenant-user',
            organizationId,
            outputFormat: outputFormat || 'html',
        });

        console.log('[Scrape API] Successfully scraped and processed:', result);

        return NextResponse.json({
            success: true,
            documentId: result.documentId,
            url: result.url,
            title: result.title,
            message: 'URL scraped and processed successfully',
        });

    } catch (error) {
        console.error('[Scrape API] Error:', error);

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
                    { error: 'Scraping timed out. Please try again or try a simpler page.' },
                    { status: 504 }
                );
            }

            // Generic error with message
            return NextResponse.json(
                {
                    error: 'Failed to scrape URL',
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
