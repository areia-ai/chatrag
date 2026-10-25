import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get pagination params and organization context
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;
    const orgIdParam = searchParams.get('organization_id');

    // Build query based on workspace type
    let query = supabase
      .from('chats')
      .select('id, title, updated_at, pinned, folder_id, organization_id', { count: 'exact' })
      .eq('user_id', user.id);

    if (orgIdParam === 'null' || orgIdParam === null || orgIdParam === undefined) {
      // Personal Workspace (flat): no organization, just user_id
      query = query.is('organization_id', null);
    } else {
      // Personal Project or Team Workspace: filter by organization_id
      query = query.eq('organization_id', orgIdParam);
    }

    // Apply ordering and pagination
    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Database error in /api/chats:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Clean up existing titles (keep this UI-only cleanup)
    if (data) {
      data.forEach(chat => {
        if (chat.title && chat.title.startsWith('About ')) {
          chat.title = chat.title.replace(/^About\s+/i, '');
        }
      });
    }

    return NextResponse.json({
      chats: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error in /api/chats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 