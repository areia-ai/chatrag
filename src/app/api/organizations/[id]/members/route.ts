import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { isPersonalOrganization } from '@/lib/auth/organization-handler';
import { logger } from '@/lib/logger';

/**
 * GET /api/organizations/[id]/members
 * List all members of an organization
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params before accessing properties (Next.js 15+ requirement)
    const { id } = await params;

    // Verify user has access to this organization
    const { data: userMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', session.user.id)
      .single();

    if (!userMembership) {
      return NextResponse.json(
        { error: 'Organization not found or access denied' },
        { status: 404 }
      );
    }

    // Get all members
    const { data: members, error } = await supabase
      .from('organization_members')
      .select(`
        id,
        role,
        created_at,
        user_id,
        users:user_id (
          id,
          email,
          raw_user_meta_data
        )
      `)
      .eq('organization_id', id);

    if (error) {
      logger.error('API', `Error fetching members: ${error.message}`);
      return NextResponse.json(
        { error: 'Failed to fetch members' },
        { status: 500 }
      );
    }

    // Format response
    const formattedMembers = members.map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      email: m.users?.email,
      name: m.users?.raw_user_meta_data?.full_name || m.users?.raw_user_meta_data?.name,
      created_at: m.created_at,
    }));

    return NextResponse.json(formattedMembers);
  } catch (error: any) {
    logger.error('API', `Error in GET /api/organizations/[id]/members: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch members' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations/[id]/members
 * Add a member to an organization (accepts invitation)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params before accessing properties (Next.js 15+ requirement)
    const { id } = await params;

    const body = await request.json();
    const { user_id, role = 'member' } = body;

    // Validate role
    const validRoles = ['owner', 'admin', 'member', 'viewer'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be one of: owner, admin, member, viewer' },
        { status: 400 }
      );
    }

    // Check if personal organization (optional restriction)
    const isPersonal = await isPersonalOrganization(id);
    if (isPersonal) {
      return NextResponse.json(
        { error: 'Cannot add members to personal organizations' },
        { status: 403 }
      );
    }

    // Verify requester is admin or owner
    const { data: requesterMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', session.user.id)
      .single();

    if (!requesterMembership || !['owner', 'admin'].includes(requesterMembership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Check organization member limits
    const { data: org } = await supabase
      .from('organizations')
      .select('max_team_members')
      .eq('id', id)
      .single();

    if (org) {
      const { count } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', id);

      if (count !== null && count >= org.max_team_members) {
        return NextResponse.json(
          { error: 'Organization member limit reached. Please upgrade your plan.' },
          { status: 403 }
        );
      }
    }

    // Add member
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: id,
        user_id,
        role,
      })
      .select()
      .single();

    if (memberError) {
      if (memberError.code === '23505') {
        return NextResponse.json(
          { error: 'User is already a member of this organization' },
          { status: 409 }
        );
      }

      logger.error('API', `Error adding member: ${memberError.message}`);
      return NextResponse.json(
        { error: 'Failed to add member' },
        { status: 500 }
      );
    }

    logger.info('API', `Added user ${user_id} to organization ${id}`);

    return NextResponse.json(member, { status: 201 });
  } catch (error: any) {
    logger.error('API', `Error in POST /api/organizations/[id]/members: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to add member' },
      { status: 500 }
    );
  }
}
