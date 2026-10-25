import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOrganizationStore } from '@/lib/stores/organization-store';

/**
 * Hook to access current organization
 */
export function useCurrentOrganization() {
  return useOrganizationStore(
    useShallow((state) => ({
      organization: state.currentOrganization,
      isLoading: state.isLoading,
      error: state.error,
      setCurrentOrganization: state.setCurrentOrganization,
    }))
  );
}

/**
 * Hook to access all organizations with 3-tier architecture support
 * - personal: Personal projects (is_personal: true, can be made collaborative)
 * - teams: Collaborative projects (is_personal: false, via shareOrganization)
 * - all: Combined list
 */
export function useOrganizations() {
  const store = useOrganizationStore(
    useShallow((state) => ({
      personal: state.personalOrganizations,
      teams: state.teamOrganizations,
      all: state.allOrganizations,
      current: state.currentOrganization,
      isLoading: state.isLoading,
      error: state.error,
      fetchOrganizations: state.fetchOrganizations,
      createPersonalOrganization: state.createPersonalOrganization,
      shareOrganization: state.shareOrganization,
      updateOrganization: state.updateOrganization,
      deleteOrganization: state.deleteOrganization,
      clearError: state.clearError,
    }))
  );

  // Auto-fetch on mount
  useEffect(() => {
    if (store.all.length === 0 && !store.isLoading) {
      store.fetchOrganizations();
    }
  }, []);

  return store;
}

/**
 * Hook to manage organization members
 */
export function useOrganizationMembers(orgId?: string) {
  const store = useOrganizationStore(
    useShallow((state) => ({
      members: state.members,
      isLoading: state.isLoadingMembers,
      error: state.error,
      fetchMembers: state.fetchMembers,
      addMember: state.addMember,
      updateMemberRole: state.updateMemberRole,
      removeMember: state.removeMember,
      clearError: state.clearError,
    }))
  );

  // Auto-fetch members when orgId changes
  useEffect(() => {
    if (orgId) {
      store.fetchMembers(orgId);
    }
  }, [orgId]);

  return store;
}

/**
 * Hook to manage team invitations
 */
export function useTeamInvitations(orgId?: string) {
  const store = useOrganizationStore(
    useShallow((state) => ({
      invitations: state.invitations,
      isLoading: state.isLoadingInvites,
      error: state.error,
      fetchInvitations: state.fetchInvitations,
      createInvitation: state.createInvitation,
      revokeInvitation: state.revokeInvitation,
      clearError: state.clearError,
    }))
  );

  // Auto-fetch invitations when orgId changes
  useEffect(() => {
    if (orgId) {
      store.fetchInvitations(orgId);
    }
  }, [orgId]);

  return store;
}

/**
 * Hook to check if current organization is personal
 */
export function useIsPersonalOrganization() {
  return useOrganizationStore(
    useShallow((state) => ({
      isPersonal: state.currentOrganization?.is_personal || false,
      canInviteMembers: !(state.currentOrganization?.is_personal || false),
      canDelete: !(state.currentOrganization?.is_personal || false),
    }))
  );
}

/**
 * Hook to get current organization's subscription limits
 */
export function useOrganizationLimits() {
  return useOrganizationStore(
    useShallow((state) => ({
      tier: state.currentOrganization?.subscription_tier || 'free',
      storageLimit: state.currentOrganization?.storage_limit_bytes || 0,
      maxDocuments: state.currentOrganization?.max_documents || 0,
      maxMonthlyMessages: state.currentOrganization?.max_monthly_messages || 0,
      maxTeamMembers: state.currentOrganization?.max_team_members || 1,
    }))
  );
}

/**
 * Hook to get current user's role in the organization
 */
export function useOrganizationRole() {
  return useOrganizationStore(
    useShallow((state) => ({
      role: state.currentOrganization?.user_role || null,
      isOwner: state.currentOrganization?.user_role === 'owner',
      isAdmin: ['owner', 'admin'].includes(state.currentOrganization?.user_role || ''),
      canManageMembers: ['owner', 'admin'].includes(state.currentOrganization?.user_role || ''),
      canEditOrganization: ['owner', 'admin'].includes(state.currentOrganization?.user_role || ''),
    }))
  );
}
