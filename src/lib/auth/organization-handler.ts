/**
 * Organization Handler for Auto-Personal Organizations
 * Ensures every user has a personal organization workspace
 */

import { createClient } from '@supabase/supabase-js';
import { isMultiTenant } from '@/lib/deployment-mode';
import { logger } from '@/lib/logger';

type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  is_personal: boolean;
  subscription_tier: string;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  max_documents: number;
  max_monthly_messages: number;
  max_team_members: number;
  created_at: string;
  updated_at: string;
  user_role?: OrganizationRole;
}

export interface OrganizationAccess {
  hasAccess: boolean;
  organization: Organization | null;
  role: OrganizationRole | null;
}

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

async function ensureOwnerMembershipRow(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        role: 'owner'
      },
      { onConflict: 'organization_id,user_id' }
    );

  if (error) {
    logger.warn('AUTH', `Unable to repair owner membership for organization ${organizationId}: ${error.message}`);
  }
}

export async function verifyUserOrganizationAccess(
  userId: string,
  organizationId: string
): Promise<OrganizationAccess> {
  if (!isMultiTenant()) {
    return { hasAccess: true, organization: null, role: null };
  }

  try {
    const supabase = createServiceRoleClient();

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single();

    if (orgError || !organization) {
      if (orgError?.code !== 'PGRST116') {
        logger.error('AUTH', `Error fetching organization ${organizationId}: ${orgError?.message || 'not found'}`);
      }
      return { hasAccess: false, organization: null, role: null };
    }

    if (organization.owner_id === userId) {
      await ensureOwnerMembershipRow(supabase, organizationId, userId);
      return {
        hasAccess: true,
        organization: { ...(organization as Organization), user_role: 'owner' },
        role: 'owner'
      };
    }

    const { data: membership, error: membershipError } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .single();

    if (membership) {
      const role = membership.role as OrganizationRole;
      return {
        hasAccess: true,
        organization: { ...(organization as Organization), user_role: role },
        role
      };
    }

    if (membershipError?.code !== 'PGRST116') {
      logger.error('AUTH', `Error checking membership for organization ${organizationId}: ${membershipError?.message || 'unknown error'}`);
    }

    return { hasAccess: false, organization: organization as Organization, role: null };
  } catch (error) {
    logger.error('AUTH', `Error in verifyUserOrganizationAccess: ${error}`);
    return { hasAccess: false, organization: null, role: null };
  }
}

/**
 * Ensures user has a personal organization
 * Called on login/signup - idempotent (safe to call multiple times)
 *
 * @param userId - The user's UUID
 * @param userName - Optional user name for workspace naming
 * @returns The personal organization or null if not in multi-tenant mode
 */
export async function ensurePersonalOrganization(
  userId: string,
  userName?: string | null
): Promise<Organization | null> {
  // Only run in multi-tenant mode
  if (!isMultiTenant()) {
    return null;
  }

  try {
    const supabase = createServiceRoleClient();

    // Check if user already has a personal organization
    const { data: existingOrg, error: fetchError } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_personal', true)
      .single();

    // If already exists, return it
    if (existingOrg && !fetchError) {
      logger.info('AUTH', `Personal organization already exists for user ${userId}`);
      await ensureOwnerMembershipRow(supabase, existingOrg.id, userId);
      return { ...(existingOrg as Organization), user_role: 'owner' };
    }

    // Personal org doesn't exist - this should not happen if trigger works
    // But we create it here as a fallback for existing users or trigger failures
    logger.warn('AUTH', `Creating missing personal organization for user ${userId}`);

    const workspaceName = userName
      ? `${userName}'s Workspace`
      : 'My Workspace';

    const { data: newOrg, error: createError } = await supabase
      .from('organizations')
      .insert({
        name: workspaceName,
        slug: `user-${userId}`,
        owner_id: userId,
        is_personal: true,
        subscription_tier: 'free',
        storage_limit_bytes: 1073741824, // 1GB
        max_documents: 50,
        max_monthly_messages: 100,
        max_team_members: 1
      })
      .select()
      .single();

    if (createError) {
      // Check if it's a duplicate key error (race condition)
      if (createError.code === '23505') {
        logger.info('AUTH', `Personal org created by concurrent request for user ${userId}`);
        // Fetch the org that was created
        const { data: racedOrg } = await supabase
          .from('organizations')
          .select('*')
          .eq('owner_id', userId)
          .eq('is_personal', true)
          .single();
        if (racedOrg) {
          await ensureOwnerMembershipRow(supabase, racedOrg.id, userId);
          return { ...(racedOrg as Organization), user_role: 'owner' };
        }
        return null;
      }

      logger.error('AUTH', `Failed to create personal organization: ${createError.message}`);
      throw new Error('Failed to create personal workspace');
    }

    // Add user as owner member
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: newOrg.id,
        user_id: userId,
        role: 'owner'
      });

    if (memberError) {
      // If member already exists (shouldn't happen), that's OK
      if (memberError.code !== '23505') {
        logger.error('AUTH', `Failed to add user as member: ${memberError.message}`);
        // Don't rollback org creation - user can still access it
      }
    }

    logger.startup('AUTH', `Created personal organization ${newOrg.id} for user ${userId}`);
    return newOrg as Organization;

  } catch (error) {
    logger.error('AUTH', `Error in ensurePersonalOrganization: ${error}`);
    // Don't throw - we don't want to block user login
    return null;
  }
}

/**
 * Get user's personal organization
 *
 * @param userId - The user's UUID
 * @returns The personal organization or null if not found
 */
export async function getPersonalOrganization(userId: string): Promise<Organization | null> {
  if (!isMultiTenant()) {
    return null;
  }

  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_personal', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - this is expected for new users before trigger runs
        return null;
      }
      logger.error('AUTH', `Error fetching personal organization: ${error.message}`);
      return null;
    }

    await ensureOwnerMembershipRow(supabase, data.id, userId);
    return { ...(data as Organization), user_role: 'owner' };
  } catch (error) {
    logger.error('AUTH', `Error in getPersonalOrganization: ${error}`);
    return null;
  }
}

/**
 * Check if an organization is a personal workspace
 *
 * @param orgId - The organization UUID
 * @returns true if it's a personal organization
 */
export async function isPersonalOrganization(orgId: string): Promise<boolean> {
  if (!isMultiTenant()) {
    return false;
  }

  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('is_personal')
      .eq('id', orgId)
      .single();

    if (error || !data) {
      return false;
    }

    return data.is_personal || false;
  } catch (error) {
    logger.error('AUTH', `Error in isPersonalOrganization: ${error}`);
    return false;
  }
}

/**
 * Get all organizations for a user (personal + teams)
 *
 * @param userId - The user's UUID
 * @returns Object with personal and team organizations
 */
export async function getUserOrganizations(userId: string): Promise<{
  personal: Organization | null;
  teams: Organization[];
  all: Organization[];
}> {
  if (!isMultiTenant()) {
    return { personal: null, teams: [], all: [] };
  }

  try {
    const supabase = createServiceRoleClient();

    // Get all organizations user is a member of
    const { data: memberships, error } = await supabase
      .from('organization_members')
      .select(`
        organization_id,
        role,
        organizations (*)
      `)
      .eq('user_id', userId);

    if (error) {
      logger.error('AUTH', `Error fetching user organizations: ${error.message}`);
      return { personal: null, teams: [], all: [] };
    }

    const { data: ownedOrganizations, error: ownedError } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', userId);

    if (ownedError) {
      logger.error('AUTH', `Error fetching owned organizations: ${ownedError.message}`);
    }

    const orgsById = new Map<string, Organization>();

    // Type assertion for the joined data and attach user role.
    (memberships || [])
      .forEach(m => {
        const org = m.organizations as unknown as Organization;
        if (org) {
          org.user_role = m.role as OrganizationRole;
          orgsById.set(org.id, org);
        }
      });

    // A restored/imported database can have organizations.owner_id without the
    // matching organization_members owner row. Owners should still see and use
    // those workspaces, and we repair the member row for future consistency.
    for (const org of ownedOrganizations || []) {
      await ensureOwnerMembershipRow(supabase, org.id, userId);
      orgsById.set(org.id, { ...(org as Organization), user_role: 'owner' });
    }

    const orgs = Array.from(orgsById.values());

    // Separate personal and team organizations
    const personal = orgs.find(org => org.is_personal) || null;
    const teams = orgs.filter(org => !org.is_personal);

    return {
      personal,
      teams,
      all: orgs
    };
  } catch (error) {
    logger.error('AUTH', `Error in getUserOrganizations: ${error}`);
    return { personal: null, teams: [], all: [] };
  }
}

/**
 * Get user's current organization ID from preferences/session
 * Falls back to personal organization if no preference set
 *
 * @param userId - The user's UUID
 * @returns The current organization ID or null
 */
export async function getCurrentOrganizationId(userId: string): Promise<string | null> {
  if (!isMultiTenant()) {
    return null;
  }

  try {
    const supabase = createServiceRoleClient();

    // Try to get from user preferences
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('current_organization_id')
      .eq('user_id', userId)
      .single();

    if (prefs?.current_organization_id) {
      const access = await verifyUserOrganizationAccess(userId, prefs.current_organization_id);

      if (access.hasAccess) {
        return prefs.current_organization_id;
      }
    }

    // Fallback to personal organization
    const personal = await getPersonalOrganization(userId);
    return personal?.id || null;
  } catch (error) {
    logger.error('AUTH', `Error in getCurrentOrganizationId: ${error}`);
    return null;
  }
}

/**
 * Set user's current organization preference
 *
 * @param userId - The user's UUID
 * @param organizationId - The organization ID to set as current
 */
export async function setCurrentOrganization(
  userId: string,
  organizationId: string
): Promise<void> {
  if (!isMultiTenant()) {
    return;
  }

  try {
    const supabase = createServiceRoleClient();

    // Upsert user preference
    await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        current_organization_id: organizationId
      });

    logger.info('AUTH', `Set current organization ${organizationId} for user ${userId}`);
  } catch (error) {
    logger.error('AUTH', `Error in setCurrentOrganization: ${error}`);
  }
}
