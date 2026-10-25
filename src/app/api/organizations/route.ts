import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { getUserOrganizations } from '@/lib/auth/organization-handler';
import { logger } from '@/lib/logger';

/**
 * GET /api/organizations
 * List all organizations user is a member of (personal + teams)
 */
export async function GET(request: Request) {
  try {
    // Only available in multi-tenant mode
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all organizations for user
    const orgs = await getUserOrganizations(user.id);

    return NextResponse.json({
      personal: orgs.personal,
      teams: orgs.teams,
      all: orgs.all,
    });
  } catch (error: any) {
    logger.error('API', `Error in GET /api/organizations: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/organizations
 * Create a new personal project (is_personal: true only)
 *
 * Note: Direct team workspace creation is disabled. Users create personal projects
 * and can later enable collaboration via /api/organizations/[id]/share
 *
 * THREE-TIER WORKSPACE ARCHITECTURE:
 * 1. Personal Workspace (Flat) - No organization, user_id isolation
 * 2. Personal Projects - is_personal: true, owner only, can be made collaborative
 * 3. Collaborative Projects - is_personal: false (via shareOrganization endpoint)
 */
export async function POST(request: Request) {
  try {
    requireMultiTenant();

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.error('API', `Auth error in POST /api/organizations: ${authError?.message || 'No user'}`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('API', `Creating organization for user ${user.id}`);

    const body = await request.json();
    const { name, slug, is_personal = false } = body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }

    if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
      return NextResponse.json(
        { error: 'Organization slug is required' },
        { status: 400 }
      );
    }

    // Validate slug format (alphanumeric and hyphens only)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must contain only lowercase letters, numbers, and hyphens' },
        { status: 400 }
      );
    }

    // Validate is_personal is a boolean
    if (typeof is_personal !== 'boolean') {
      return NextResponse.json(
        { error: 'is_personal must be a boolean' },
        { status: 400 }
      );
    }

    // IMPORTANT: Team workspace creation is disabled
    // Users can only create personal projects (is_personal: true)
    // Personal projects can be converted to collaborative via /api/organizations/[id]/share
    if (is_personal === false) {
      return NextResponse.json(
        { error: 'Direct team workspace creation is disabled. Create a personal project and enable collaboration via settings.' },
        { status: 400 }
      );
    }

    // Create organization using SECURITY DEFINER function to bypass RLS
    // Personal organizations: max_team_members = 1 (owner only)
    // Team organizations: max_team_members = 5 (can invite members)
    const { data: org, error: createError } = await supabase
      .rpc('create_organization_safe', {
        p_name: name.trim(),
        p_slug: slug.trim(),
        p_owner_id: user.id,
        p_is_personal: is_personal,
      });

    if (createError) {
      logger.error('API', `Error creating organization: ${createError.message}`);
      logger.error('API', `Error code: ${createError.code}`);
      logger.error('API', `Error details: ${JSON.stringify(createError)}`);
      logger.error('API', `User ID: ${user.id}, Slug attempted: ${slug.trim()}, Name: ${name.trim()}`);
      
      // Check for duplicate slug
      if (createError.code === '23505' || createError.message?.includes('duplicate') || createError.message?.includes('unique')) {
        return NextResponse.json(
          { error: 'An organization with this slug already exists' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to create organization' },
        { status: 500 }
      );
    }

    // Add creator as owner
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      logger.error('API', `Error adding owner as member: ${memberError.message}`);
      // Don't fail the request - org is created
    }

    const orgType = is_personal ? 'personal project' : 'team workspace';
    logger.info('API', `Created ${orgType} ${org.id} by user ${user.id}`);

    return NextResponse.json(org, { status: 201 });
  } catch (error: any) {
    logger.error('API', `Error in POST /api/organizations: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create organization' },
      { status: 500 }
    );
  }
}
