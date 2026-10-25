import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getNango, isNangoEnabled } from '@/lib/nango/client';

export const runtime = 'nodejs';

interface NotionPage {
  id: string;
  name: string;
  hasChildren: boolean;
  children?: NotionPage[];  // Recursively nested children for tree mode
}

/**
 * GET /api/nango/notion/pages
 * List Notion pages (root, children, or complete tree)
 * Query params:
 *   - mode: 'root' | 'children' | 'tree'
 *   - parentId: (optional, required for 'children' mode) parent page ID
 * 
 * Modes:
 *   - root: Returns only root-level pages (flat list)
 *   - children: Returns children of a specific parent page (flat list)
 *   - tree: Returns complete page hierarchy with all children pre-loaded (nested structure)
 */
export async function GET(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    // Allow access without auth for Config UI, but if user is available use their connection
    const userId: string | undefined = user?.id;

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') as 'root' | 'children' | 'tree' || 'root';
    const parentId = searchParams.get('parentId');

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get the user's Notion connection
    let query = supabaseAdmin
      .from('nango_connections')
      .select('connection_id')
      .eq('provider', 'notion')
      .eq('status', 'connected');

    // If user is authenticated, get their specific connection
    // If not, get any available connection for the provider
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: connections } = await query;

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        { error: 'No connected Notion account found' },
        { status: 404 }
      );
    }

    // Use the first connection (admin view)
    const connection = connections[0];

    const nango = getNango();
    let pages: NotionPage[] = [];

    if (mode === 'root' || mode === 'tree') {
      // listRootPages now returns the full tree built from search results
      // This works for both modes:
      // - root mode: frontend renders roots, children are available if expanded
      // - tree mode: frontend renders full tree
      pages = await listRootPages(nango, connection.connection_id);
    } else if (mode === 'children' && parentId) {
      pages = await listChildPages(nango, connection.connection_id, parentId);
    } else {
      return NextResponse.json(
        { error: 'Invalid mode or missing parentId for children mode' },
        { status: 400 }
      );
    }

    return NextResponse.json({ pages });

  } catch (error) {
    console.error('[Notion Pages API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Notion pages' },
      { status: 500 }
    );
  }
}

/**
 * Fetch pages from Notion using /v1/search API and build a tree structure
 */
async function listRootPages(
  nango: ReturnType<typeof getNango>,
  connectionId: string
): Promise<NotionPage[]> {
  try {
    const response = await nango.proxy({
      providerConfigKey: 'notion',
      connectionId: connectionId,
      method: 'POST',
      endpoint: '/v1/search',
      data: {
        page_size: 100,
        sort: {
          direction: 'descending',
          timestamp: 'last_edited_time',
        },
        filter: {
          value: 'page',
          property: 'object',
        },
      },
    });

    const data = response.data as { results?: any[] };
    const results = data.results || [];

    if (!Array.isArray(results)) {
      console.warn('[Notion Pages API] Invalid results format from search');
      return [];
    }

    // 1. Convert all results to NotionPage objects and store in a map
    const pageMap = new Map<string, NotionPage>();
    const allPages: (NotionPage & { parentId?: string })[] = results.map(page => {
      const parentId = page.parent?.type === 'page_id' ? page.parent.page_id : undefined;

      const notionPage = {
        id: page.id,
        name: page.properties?.title?.title?.[0]?.plain_text ||
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Name?.rich_text?.[0]?.plain_text ||
          'Untitled',
        hasChildren: page.has_children || false,
        children: [] as NotionPage[],
        parentId
      };

      pageMap.set(page.id, notionPage);
      return notionPage;
    });

    // 2. Build the tree structure
    const rootPages: NotionPage[] = [];

    allPages.forEach(page => {
      if (page.parentId && pageMap.has(page.parentId)) {
        // This is a child page, add it to its parent
        const parent = pageMap.get(page.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(page);
        // Ensure parent has hasChildren=true since we found a child
        parent.hasChildren = true;
      } else {
        // This is a root page (or parent is not in the list)
        rootPages.push(page);
      }
    });

    console.log(`[Notion Pages API] Built tree: ${rootPages.length} root pages from ${results.length} total pages`);
    return rootPages;

  } catch (error) {
    console.error('[Notion Pages API] Failed to list root pages:', error);
    return [];
  }
}

/**
 * Fetch child pages from a parent page using /v1/blocks/{pageId}/children
 */
async function listChildPages(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  parentPageId: string
): Promise<NotionPage[]> {
  try {
    const response = await nango.proxy({
      providerConfigKey: 'notion',
      connectionId: connectionId,
      method: 'GET',
      endpoint: `/v1/blocks/${parentPageId}/children`,
      params: {
        page_size: '100',
      },
    });

    const data = response.data as { results?: any[] };
    const blocks = data.results || [];

    if (!Array.isArray(blocks)) {
      console.warn('[Notion Pages API] Invalid blocks format from children endpoint');
      return [];
    }

    // Filter for child_page blocks only
    const childPages = blocks
      .filter(block => block.type === 'child_page')
      .map(block => ({
        id: block.id,
        name: block.child_page?.title || 'Untitled',
        hasChildren: block.has_children || false,
      })) as NotionPage[];

    console.log(`[Notion Pages API] Found ${childPages.length} child pages for parent ${parentPageId}`);
    return childPages;

  } catch (error) {
    console.error(`[Notion Pages API] Failed to list child pages for ${parentPageId}:`, error);
    return [];
  }
}

/**
 * Recursively populate children for pages and all descendants
 * Only call for tree mode to avoid excessive API calls
 */
async function populatePageTree(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  pages: NotionPage[],
  maxDepth: number = 5,
  currentDepth: number = 0
): Promise<NotionPage[]> {
  if (currentDepth >= maxDepth) {
    console.log(`[Notion Pages API] Reached max depth ${maxDepth}, stopping recursion`);
    return pages;
  }

  for (const page of pages) {
    if (page.hasChildren) {
      try {
        const childPages = await listChildPages(nango, connectionId, page.id);
        page.children = childPages;

        // Recursively populate their children
        if (childPages.length > 0) {
          await populatePageTree(nango, connectionId, childPages, maxDepth, currentDepth + 1);
        }
      } catch (e) {
        console.warn(`[Notion Pages API] Failed to load children for ${page.id}:`, e);
        page.children = [];
      }
    }
  }

  return pages;
}
