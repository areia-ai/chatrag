import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { logger } from '@/lib/logger';

/**
 * POST /api/organizations/[id]/share
 * Convert a personal organization to a team workspace
 *
 * THREE-TIER WORKSPACE ARCHITECTURE:
 * This endpoint enables the transition from:
 * - Personal Organization (is_personal: true, owner only)
 * - To: Team Workspace (is_personal: false, can invite members)
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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

    const orgId = params.id;

    // Validate organization ID
    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid organization ID' },
        { status: 400 }
      );
    }

    // Verify the organization exists and is personal
    const { data: org, error: fetchError } = await supabase
      .from('organizations')
      .select('id, name, is_personal, owner_id')
      .eq('id', orgId)
      .eq('owner_id', session.user.id)
      .single();

    if (fetchError || !org) {
      logger.error('API', `Organization not found or access denied: ${fetchError?.message}`);
      return NextResponse.json(
        { error: 'Organization not found or you do not have permission to share it' },
        { status: 404 }
      );
    }

    // Check if organization is already a team workspace
    if (!org.is_personal) {
      return NextResponse.json(
        { error: 'Organization is already a team workspace' },
        { status: 400 }
      );
    }

    // Call the database function to share the organization
    // This function:
    // 1. Sets is_personal = false
    // 2. Sets max_team_members = 5
    // 3. Updates updated_at timestamp
    const { data: result, error: shareError } = await supabase.rpc(
      'share_personal_organization',
      { org_id: orgId }
    );

    if (shareError) {
      logger.error('API', `Error sharing organization: ${shareError.message}`);
      return NextResponse.json(
        { error: 'Failed to share organization' },
        { status: 500 }
      );
    }

    // Fetch updated organization
    const { data: updatedOrg, error: refetchError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (refetchError || !updatedOrg) {
      logger.warn('API', `Could not refetch updated organization: ${refetchError?.message}`);
      // Don't fail the request - sharing succeeded
    }

    logger.info('API', `Shared personal organization ${orgId} - now team workspace`);

    return NextResponse.json({
      success: true,
      organization: updatedOrg || org,
      message: 'Organization is now a team workspace. You can invite members.',
    });
  } catch (error: any) {
    logger.error('API', `Error in POST /api/organizations/[id]/share: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to share organization' },
      { status: 500 }
    );
  }
}
