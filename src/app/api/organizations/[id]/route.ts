import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { isPersonalOrganization } from '@/lib/auth/organization-handler';
import { logger } from '@/lib/logger';

/**
 * GET /api/organizations/[id]
 * Get organization details
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params before accessing properties (Next.js 15+ requirement)
    const { id } = await params;

    // Verify user has access to this organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: 'Organization not found or access denied' },
        { status: 404 }
      );
    }

    // Get organization details
    const { data: org, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !org) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Include user's role in response
    return NextResponse.json({
      ...org,
      user_role: membership.role,
    });
  } catch (error: any) {
    logger.error('API', `Error in GET /api/organizations/[id]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch organization' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/organizations/[id]
 * Update organization details (team orgs only)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params before accessing properties (Next.js 15+ requirement)
    const { id } = await params;

    // Verify user is owner or admin
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, settings } = body;

    // Build update object (only allow certain fields)
    const updates: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Invalid organization name' },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }

    if (settings !== undefined) {
      if (typeof settings !== 'object') {
        return NextResponse.json(
          { error: 'Settings must be an object' },
          { status: 400 }
        );
      }
      updates.settings = settings;
    }

    // Don't allow changing critical fields
    delete body.owner_id;
    delete body.is_personal;
    delete body.subscription_tier;
    delete body.slug;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Update organization
    const { data: org, error: updateError } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      logger.error('API', `Error updating organization: ${updateError.message}`);
      return NextResponse.json(
        { error: 'Failed to update organization' },
        { status: 500 }
      );
    }

    logger.info('API', `Updated organization ${id} by user ${user.id}`);

    return NextResponse.json(org);
  } catch (error: any) {
    logger.error('API', `Error in PATCH /api/organizations/[id]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/organizations/[id]
 * Delete organization (both personal and team)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params before accessing properties (Next.js 15+ requirement)
    const { id } = await params;

    // Verify user is the owner
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    if (org.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the owner can delete this organization' },
        { status: 403 }
      );
    }

    // Use admin client to delete organization (bypasses RLS)
    // Regular client might fail due to RLS policies
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      logger.error('API', 'Admin client not available for organization deletion');
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 }
      );
    }

    // Delete organization (cascade will handle members, documents, etc.)
    const { error: deleteError } = await supabaseAdmin
      .from('organizations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('API', `Error deleting organization: ${deleteError.message}`);
      return NextResponse.json(
        { error: 'Failed to delete organization' },
        { status: 500 }
      );
    }

    logger.info('API', `Deleted organization ${id} by user ${user.id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('API', `Error in DELETE /api/organizations/[id]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete organization' },
      { status: 500 }
    );
  }
}
