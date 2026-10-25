import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { isPersonalOrganization } from '@/lib/auth/organization-handler';
import { logger } from '@/lib/logger';
import { nanoid } from 'nanoid';

/**
 * GET /api/organizations/[id]/invites
 * List all pending invitations for an organization
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

    // Verify user is admin or owner
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', session.user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get all pending invitations
    const { data: invites, error } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('organization_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('API', `Error fetching invitations: ${error.message}`);
      return NextResponse.json(
        { error: 'Failed to fetch invitations' },
        { status: 500 }
      );
    }

    return NextResponse.json(invites);
  } catch (error: any) {
    logger.error('API', `Error in GET /api/organizations/[id]/invites: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations/[id]/invites
 * Create a new team invitation
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
    const { email, role = 'member' } = body;

    // Validate input
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be one of: admin, member, viewer' },
        { status: 400 }
      );
    }

    // Check if personal organization
    const isPersonal = await isPersonalOrganization(id);
    if (isPersonal) {
      return NextResponse.json(
        { error: 'Cannot invite members to personal organizations' },
        { status: 403 }
      );
    }

    // Verify requester is admin or owner
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', session.user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Check if user is already a member
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const user = existingUser.users.find((u) => u.email === email);

    if (user) {
      const { data: existingMember } = await supabase
        .from('organization_members')
        .select('id')
        .eq('organization_id', id)
        .eq('user_id', user.id)
        .single();

      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this organization' },
          { status: 409 }
        );
      }
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabase
      .from('team_invitations')
      .select('id, status')
      .eq('organization_id', id)
      .eq('email', email.toLowerCase())
      .single();

    if (existingInvite) {
      if (existingInvite.status === 'pending') {
        return NextResponse.json(
          { error: 'An invitation has already been sent to this email' },
          { status: 409 }
        );
      }

      // Delete old expired/revoked invitations
      await supabase
        .from('team_invitations')
        .delete()
        .eq('id', existingInvite.id);
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

    // Generate invitation token
    const token = nanoid(32);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    // Create invitation
    const { data: invite, error: inviteError } = await supabase
      .from('team_invitations')
      .insert({
        organization_id: id,
        email: email.toLowerCase(),
        role,
        invited_by: session.user.id,
        token,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (inviteError) {
      logger.error('API', `Error creating invitation: ${inviteError.message}`);
      return NextResponse.json(
        { error: 'Failed to create invitation' },
        { status: 500 }
      );
    }

    logger.info('API', `Created invitation for ${email} to organization ${id}`);

    // TODO: Send invitation email
    // This would integrate with your email service (Resend, SendGrid, etc.)
    // const inviteUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/invites/${token}`;
    // await sendInvitationEmail(email, inviteUrl, orgName);

    return NextResponse.json(
      {
        ...invite,
        invite_url: `${process.env.NEXT_PUBLIC_SITE_URL}/invites/${token}`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    logger.error('API', `Error in POST /api/organizations/[id]/invites: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create invitation' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/organizations/[id]/invites?email=xxx
 * Revoke a pending invitation
 */
export async function DELETE(
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

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter is required' },
        { status: 400 }
      );
    }

    // Verify requester is admin or owner
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', id)
      .eq('user_id', session.user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Revoke invitation
    const { error: updateError } = await supabase
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('organization_id', id)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending');

    if (updateError) {
      logger.error('API', `Error revoking invitation: ${updateError.message}`);
      return NextResponse.json(
        { error: 'Failed to revoke invitation' },
        { status: 500 }
      );
    }

    logger.info('API', `Revoked invitation for ${email} to organization ${id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('API', `Error in DELETE /api/organizations/[id]/invites: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to revoke invitation' },
      { status: 500 }
    );
  }
}
