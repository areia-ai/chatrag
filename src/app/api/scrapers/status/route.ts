import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isHttpUrl, normalizeScrapedUrl } from '@/lib/scrapers/url-utils';
import { isSingleTenant } from '@/lib/deployment-mode';
import { verifyUserOrganizationAccess } from '@/lib/auth/organization-handler';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const organizationId = searchParams.get('organization_id');

    if (!url || !isHttpUrl(url)) {
      return NextResponse.json({ error: 'Valid URL required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not initialized');
    }

    const normalizedUrl = normalizeScrapedUrl(url);
    const candidateUrls = Array.from(new Set([normalizedUrl, url.trim()]));

    let query = supabaseAdmin
      .from('documents')
      .select('id, filename, created_at, metadata, source, source_provider, source_file_id, organization_id, user_id')
      .eq('source_provider', 'firecrawl')
      .in('source_file_id', candidateUrls)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!isSingleTenant()) {
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      if (organizationId && organizationId !== 'null') {
        const access = await verifyUserOrganizationAccess(user.id, organizationId);
        if (!access.hasAccess) {
          return NextResponse.json(
            { error: 'You are not a member of this organization' },
            { status: 403 }
          );
        }

        query = query.eq('organization_id', organizationId);
      } else {
        query = query.is('organization_id', null).eq('user_id', user.id);
      }
    }

    const { data: documents, error } = await query;

    if (error) {
      throw new Error(`Error checking scraper status: ${error.message}`);
    }

    const document = documents?.[0];

    if (!document) {
      return NextResponse.json({
        scraped: false,
        url: normalizedUrl,
      });
    }

    const { count, error: countError } = await supabaseAdmin
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', document.id);

    if (countError) {
      console.error('[Scraper Status API] Error counting chunks:', countError);
    }

    return NextResponse.json({
      scraped: true,
      url: normalizedUrl,
      document: {
        id: document.id,
        filename: document.filename,
        title: document.metadata?.title || document.filename,
        created_at: document.created_at,
        chunk_count: count || 0,
        source_file_id: document.source_file_id,
        source_provider: document.source_provider,
      },
    });
  } catch (error) {
    console.error('[Scraper Status API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check scraper status',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
