import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { logger } from '@/lib/logger';

/**
 * GET /api/invites/[token]
 * Validate and get invitation details
 */
export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    requireMultiTenant();

    const supabase = createRouteHandlerClient({ cookies });

    // Get invitation details
    const { data: invite, error } = await supabase
      .from('team_invitations')
      .select(`
        id,
        email,
        role,
        status,
        expires_at,
        created_at,
        organizations (
          id,
          name,
          slug
        )
      `)
      .eq('token', params.token)
      .single();

    if (error || !invite) {
      return NextResponse.json(
        { error: 'Invalid invitation link' },
        { status: 404 }
      );
    }

    // Check if already accepted
    if (invite.status === 'accepted') {
      return NextResponse.json(
        { error: 'This invitation has already been accepted' },
        { status: 410 }
      );
    }

    // Check if revoked
    if (invite.status === 'revoked') {
      return NextResponse.json(
        { error: 'This invitation has been revoked' },
        { status: 410 }
      );
    }

    // Check if expired
    if (new Date(invite.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('team_invitations')
        .update({ status: 'expired' })
        .eq('token', params.token);

      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 410 }
      );
    }

    // Return invitation details (without sensitive info)
    return NextResponse.json({
      email: invite.email,
      role: invite.role,
      organization: invite.organizations,
      expires_at: invite.expires_at,
    });
  } catch (error: any) {
    logger.error('API', `Error in GET /api/invites/[token]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to validate invitation' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invites/[token]
 * Accept an invitation and join the organization
 */
export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    requireMultiTenant();

    const supabase = createRouteHandlerClient({ cookies });
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'You must be logged in to accept invitations' },
        { status: 401 }
      );
    }

    // Get invitation
    const { data: invite, error: inviteError } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('token', params.token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Invalid invitation link' },
        { status: 404 }
      );
    }

    // Verify user email matches invitation
    if (session.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: `This invitation was sent to ${invite.email}. Please log in with that email address.`,
        },
        { status: 403 }
      );
    }

    // Check status
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has been ${invite.status}` },
        { status: 410 }
      );
    }

    // Check expiration
    if (new Date(invite.expires_at) < new Date()) {
      await supabase
        .from('team_invitations')
        .update({ status: 'expired' })
        .eq('id', invite.id);

      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 410 }
      );
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', invite.organization_id)
      .eq('user_id', session.user.id)
      .single();

    if (existingMember) {
      // Mark invitation as accepted even though they're already a member
      await supabase
        .from('team_invitations')
        .update({ status: 'accepted' })
        .eq('id', invite.id);

      return NextResponse.json(
        { error: 'You are already a member of this organization' },
        { status: 409 }
      );
    }

    // Add user to organization
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: invite.organization_id,
        user_id: session.user.id,
        role: invite.role,
      })
      .select()
      .single();

    if (memberError) {
      logger.error('API', `Error adding member: ${memberError.message}`);
      return NextResponse.json(
        { error: 'Failed to join organization' },
        { status: 500 }
      );
    }

    // Mark invitation as accepted
    await supabase
      .from('team_invitations')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    // Get organization details
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('id', invite.organization_id)
      .single();

    logger.info('API', `User ${session.user.id} accepted invitation to organization ${invite.organization_id}`);

    return NextResponse.json({
      success: true,
      organization: org,
      membership: member,
    });
  } catch (error: any) {
    logger.error('API', `Error in POST /api/invites/[token]: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}
