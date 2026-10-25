import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { isPersonalOrganization } from '@/lib/auth/organization-handler';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/organizations/[id]/members/[userId]
 * Update a member's role
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; userId: string } }
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

    const body = await request.json();
    const { role } = body;

    // Validate role
    const validRoles = ['owner', 'admin', 'member', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be one of: owner, admin, member, viewer' },
        { status: 400 }
      );
    }

    // Check if personal organization
    const isPersonal = await isPersonalOrganization(params.id);
    if (isPersonal) {
      return NextResponse.json(
        { error: 'Cannot modify personal organization membership' },
        { status: 403 }
      );
    }

    // Verify requester is admin or owner
    const { data: requesterMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (!requesterMembership || !['owner', 'admin'].includes(requesterMembership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Prevent removing the last owner
    if (role !== 'owner') {
      const { data: targetMember } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', params.id)
        .eq('user_id', params.userId)
        .single();

      if (targetMember?.role === 'owner') {
        const { count } = await supabase
          .from('organization_members')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', params.id)
          .eq('role', 'owner');

        if (count === 1) {
          return NextResponse.json(
            { error: 'Cannot change role of the last owner' },
            { status: 403 }
          );
        }
      }
    }

    // Update member role
    const { data: member, error: updateError } = await supabase
      .from('organization_members')
      .update({ role })
      .eq('organization_id', params.id)
      .eq('user_id', params.userId)
      .select()
      .single();

    if (updateError) {
      logger.error('API', `Error updating member role: ${updateError.message}`);
      return NextResponse.json(
        { error: 'Failed to update member role' },
        { status: 500 }
      );
    }

    logger.info('API', `Updated role for user ${params.userId} in org ${params.id} to ${role}`);

    return NextResponse.json(member);
  } catch (error: any) {
    logger.error('API', `Error in PATCH /api/organizations/[id]/members/[userId]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/organizations/[id]/members/[userId]
 * Remove a member from an organization
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; userId: string } }
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

    // Check if personal organization
    const isPersonal = await isPersonalOrganization(params.id);
    if (isPersonal) {
      return NextResponse.json(
        { error: 'Cannot remove members from personal organizations' },
        { status: 403 }
      );
    }

    // Get member being removed
    const { data: targetMember } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', params.id)
      .eq('user_id', params.userId)
      .single();

    if (!targetMember) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Verify requester has permission
    const { data: requesterMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', params.id)
      .eq('user_id', session.user.id)
      .single();

    // Users can remove themselves, or admins/owners can remove others
    const isSelf = params.userId === session.user.id;
    const hasPermission = requesterMembership && ['owner', 'admin'].includes(requesterMembership.role);

    if (!isSelf && !hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Prevent removing the last owner
    if (targetMember.role === 'owner') {
      const { count } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', params.id)
        .eq('role', 'owner');

      if (count === 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner. Transfer ownership first or delete the organization.' },
          { status: 403 }
        );
      }
    }

    // Remove member
    const { error: deleteError } = await supabase
      .from('organization_members')
      .delete()
      .eq('organization_id', params.id)
      .eq('user_id', params.userId);

    if (deleteError) {
      logger.error('API', `Error removing member: ${deleteError.message}`);
      return NextResponse.json(
        { error: 'Failed to remove member' },
        { status: 500 }
      );
    }

    logger.info('API', `Removed user ${params.userId} from organization ${params.id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('API', `Error in DELETE /api/organizations/[id]/members/[userId]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    );
  }
}
