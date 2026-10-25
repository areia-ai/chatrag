import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Organization types matching the database schema
 */
/**
 * System prompt override settings for workspace
 */
export interface SystemPromptSettings {
  enabled: boolean;
  useFullPrompt: boolean;
  fullPrompt?: string;
  preContext?: string;
  postContext?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Organization settings structure
 */
export interface OrganizationSettings {
  systemPrompt?: SystemPromptSettings;
  [key: string]: any;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  is_personal: boolean;
  subscription_tier: 'free' | 'pro' | 'enterprise';
  storage_limit_bytes: number;
  max_documents: number;
  max_monthly_messages: number;
  max_team_members: number;
  settings?: OrganizationSettings;
  created_at: string;
  updated_at: string;
  user_role?: 'owner' | 'admin' | 'member' | 'viewer';
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  email?: string;
  name?: string;
  created_at: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  token: string;
  expires_at: string;
  created_at: string;
  invite_url?: string;
}

interface OrganizationState {
  // THREE-TIER WORKSPACE ARCHITECTURE
  // 1. Personal Workspace (Flat) - No organization, user_id isolation
  // 2. Personal Projects - is_personal: true, owner only, can be converted to collaborative
  // 3. Collaborative Projects - is_personal: false (via shareOrganization), multi-member

  // Personal workspace mode: no organizations, user_id isolation
  isPersonalMode: boolean;

  // Current active organization (null in personal mode)
  currentOrganization: Organization | null;

  // Personal organizations (is_personal: true, owner only)
  personalOrganizations: Organization[];

  // Collaborative organizations (is_personal: false, multi-member - converted from personal)
  teamOrganizations: Organization[];

  // All organizations combined
  allOrganizations: Organization[];

  // Loading states
  isLoading: boolean;
  isLoadingMembers: boolean;
  isLoadingInvites: boolean;

  // Members and invitations for current org
  members: OrganizationMember[];
  invitations: TeamInvitation[];

  // Error state
  error: string | null;

  // Actions
  fetchOrganizations: () => Promise<void>;
  setCurrentOrganization: (orgId: string | null) => Promise<void>; // null = personal mode
  switchToPersonalWorkspace: () => void;
  createPersonalOrganization: (name: string) => Promise<Organization | null>;
  shareOrganization: (orgId: string) => Promise<boolean>; // Convert personal → collaborative
  updateOrganization: (orgId: string, updates: Partial<Organization>) => Promise<boolean>;
  deleteOrganization: (orgId: string) => Promise<boolean>;

  // Member management
  fetchMembers: (orgId: string) => Promise<void>;
  addMember: (orgId: string, userId: string, role: string) => Promise<boolean>;
  updateMemberRole: (orgId: string, userId: string, role: string) => Promise<boolean>;
  removeMember: (orgId: string, userId: string) => Promise<boolean>;

  // Invitation management
  fetchInvitations: (orgId: string) => Promise<void>;
  createInvitation: (orgId: string, email: string, role: string) => Promise<TeamInvitation | null>;
  revokeInvitation: (orgId: string, email: string) => Promise<boolean>;

  // Utility
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  isPersonalMode: true, // Default to personal mode until we fetch orgs
  currentOrganization: null,
  personalOrganizations: [],
  teamOrganizations: [],
  allOrganizations: [],
  isLoading: false,
  isLoadingMembers: false,
  isLoadingInvites: false,
  members: [],
  invitations: [],
  error: null,
};

export const useOrganizationStore = create<OrganizationState>()(
  persist(
    (set, get) => ({
      ...initialState,

      fetchOrganizations: async () => {
        set({ isLoading: true, error: null });

        try {
          // Check if user is authenticated first by getting session
          const { createClient } = await import('@/lib/supabase/client');
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          
          if (!session) {
            // User not authenticated, set to personal mode and skip API call
            set({
              isPersonalMode: true,
              currentOrganization: null,
              personalOrganizations: [],
              teamOrganizations: [],
              allOrganizations: [],
              isLoading: false,
            });
            console.log('User not authenticated, staying in personal mode');
            return;
          }

          const response = await fetch('/api/organizations', {
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch organizations');
          }

          const data = await response.json();

          // THREE-TIER WORKSPACE ARCHITECTURE
          // Separate personal projects from collaborative projects
          const allOrgs = data.all || [];
          const personalProjects = allOrgs.filter((o: Organization) => o.is_personal === true);
          const collaborativeProjects = allOrgs.filter((o: Organization) => o.is_personal === false);

          const hasOrganizations = allOrgs.length > 0;
          const currentOrg = get().currentOrganization;
          const wasInPersonalMode = get().isPersonalMode;

          if (!hasOrganizations) {
            // Personal mode: user has no organizations
            set({
              isPersonalMode: true,
              currentOrganization: null,
              personalOrganizations: [],
              teamOrganizations: [],
              allOrganizations: [],
              isLoading: false,
            });
            console.log('User in flat personal workspace mode (no organizations)');
          } else {
            // Has organizations: check current mode
            const isCurrentOrgValid = allOrgs.find((o: Organization) => o.id === currentOrg?.id);

            // If user was explicitly in personal mode (e.g., after deletion), keep them there
            if (wasInPersonalMode && !isCurrentOrgValid) {
              set({
                isPersonalMode: true,
                currentOrganization: null,
                personalOrganizations: personalProjects,
                teamOrganizations: collaborativeProjects,
                allOrganizations: allOrgs,
                isLoading: false,
              });
              console.log(`Staying in Default Workspace. Available: ${personalProjects.length} personal project(s) and ${collaborativeProjects.length} collaborative project(s)`);
            } else {
              set({
                isPersonalMode: false,
                personalOrganizations: personalProjects,
                teamOrganizations: collaborativeProjects,
                allOrganizations: allOrgs,
                // Keep current org if still valid, otherwise pick first
                currentOrganization: isCurrentOrgValid || allOrgs[0],
                isLoading: false,
              });
              console.log(`User has ${personalProjects.length} personal project(s) and ${collaborativeProjects.length} collaborative project(s)`);
            }
          }
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch organizations',
            isLoading: false,
          });
        }
      },

      setCurrentOrganization: async (orgId: string | null) => {
        if (orgId === null) {
          // Switch to personal workspace
          set({
            currentOrganization: null,
            isPersonalMode: true,
            error: null
          });
          console.log('Switched to personal workspace');
          return;
        }

        const org = get().allOrganizations.find(o => o.id === orgId);

        if (!org) {
          set({ error: 'Organization not found' });
          return;
        }

        set({
          currentOrganization: org,
          isPersonalMode: false,
          error: null
        });

        // Persist preference to server
        try {
          await fetch('/api/user/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ current_organization_id: orgId }),
          });
        } catch (error) {
          console.error('Failed to persist organization preference:', error);
        }
      },

      switchToPersonalWorkspace: () => {
        set({
          currentOrganization: null,
          isPersonalMode: true,
          error: null
        });
        console.log('Switched to Default Workspace');
      },

      createPersonalOrganization: async (name: string) => {
        set({ isLoading: true, error: null });

        try {
          // Generate slug from name: lowercase, replace spaces/special chars with hyphens
          const slug = name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

          const response = await fetch('/api/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name, slug, is_personal: true }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create personal project');
          }

          const newOrg = await response.json();

          // Refresh organizations list
          await get().fetchOrganizations();

          // Switch to new organization
          await get().setCurrentOrganization(newOrg.id);

          set({ isLoading: false });
          return newOrg;
        } catch (error: any) {
          set({
            error: error.message || 'Failed to create personal project',
            isLoading: false,
          });
          return null;
        }
      },

      shareOrganization: async (orgId: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/share`, {
            method: 'POST',
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to share organization');
          }

          // Refresh organizations to reflect the change
          await get().fetchOrganizations();
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to share organization' });
          return false;
        }
      },

      updateOrganization: async (orgId: string, updates: Partial<Organization>) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(updates),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update organization');
          }

          // Refresh organizations
          await get().fetchOrganizations();
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to update organization' });
          return false;
        }
      },

      deleteOrganization: async (orgId: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete organization');
          }

          // Switch to personal workspace if we deleted the current org
          if (get().currentOrganization?.id === orgId) {
            get().switchToPersonalWorkspace();
          }

          // Refresh organizations
          await get().fetchOrganizations();
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to delete organization' });
          return false;
        }
      },

      fetchMembers: async (orgId: string) => {
        set({ isLoadingMembers: true, error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/members`, {
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch members');
          }

          const members = await response.json();
          set({ members, isLoadingMembers: false });
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch members',
            isLoadingMembers: false,
          });
        }
      },

      addMember: async (orgId: string, userId: string, role: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ user_id: userId, role }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add member');
          }

          // Refresh members
          await get().fetchMembers(orgId);
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to add member' });
          return false;
        }
      },

      updateMemberRole: async (orgId: string, userId: string, role: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ role }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update member role');
          }

          // Refresh members
          await get().fetchMembers(orgId);
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to update member role' });
          return false;
        }
      },

      removeMember: async (orgId: string, userId: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to remove member');
          }

          // Refresh members
          await get().fetchMembers(orgId);
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to remove member' });
          return false;
        }
      },

      fetchInvitations: async (orgId: string) => {
        set({ isLoadingInvites: true, error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/invites`, {
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch invitations');
          }

          const invitations = await response.json();
          set({ invitations, isLoadingInvites: false });
        } catch (error: any) {
          set({
            error: error.message || 'Failed to fetch invitations',
            isLoadingInvites: false,
          });
        }
      },

      createInvitation: async (orgId: string, email: string, role: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/invites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email, role }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create invitation');
          }

          const invitation = await response.json();

          // Refresh invitations
          await get().fetchInvitations(orgId);
          return invitation;
        } catch (error: any) {
          set({ error: error.message || 'Failed to create invitation' });
          return null;
        }
      },

      revokeInvitation: async (orgId: string, email: string) => {
        set({ error: null });

        try {
          const response = await fetch(`/api/organizations/${orgId}/invites?email=${encodeURIComponent(email)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to revoke invitation');
          }

          // Refresh invitations
          await get().fetchInvitations(orgId);
          return true;
        } catch (error: any) {
          set({ error: error.message || 'Failed to revoke invitation' });
          return false;
        }
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: 'organization-storage',
      partialize: (state) => ({
        isPersonalMode: state.isPersonalMode,
        currentOrganization: state.currentOrganization,
        personalOrganizations: state.personalOrganizations,
        teamOrganizations: state.teamOrganizations,
        allOrganizations: state.allOrganizations,
      }),
    }
  )
);
