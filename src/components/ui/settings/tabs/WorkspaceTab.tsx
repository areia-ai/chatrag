'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import { Building2, Users, Mail, Trash2, UserPlus, Crown, Shield, User, Share2, Briefcase, Edit2, X, Check } from 'lucide-react';
import { useOrganizationStore } from '@/lib/stores/organization-store';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { isMultiTenant as checkMultiTenant } from '@/lib/deployment-mode';

// Custom comparison function for memo optimization
const areEqual = (prevProps: any, nextProps: any) => {
  return true;
};

export const WorkspaceTab = memo(function WorkspaceTab() {
  const { t } = useLanguage();
  const {
    currentOrganization,
    isPersonalMode,
    members,
    invitations,
    isLoadingMembers,
    isLoadingInvites,
    error,
    fetchMembers,
    fetchInvitations,
    createInvitation,
    revokeInvitation,
    removeMember,
    updateMemberRole,
    shareOrganization,
    updateOrganization,
    deleteOrganization,
    clearError,
  } = useOrganizationStore();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Only show if multi-tenant mode
  const isMultiTenant = checkMultiTenant();

  // Check if current user is admin or owner
  const isOwner = currentOrganization?.user_role === 'owner';
  const isAdminOrOwner = currentOrganization?.user_role === 'admin' || currentOrganization?.user_role === 'owner';

  // Fetch members and invitations when component mounts or org changes
  useEffect(() => {
    if (isMultiTenant && currentOrganization?.id) {
      fetchMembers(currentOrganization.id);
      fetchInvitations(currentOrganization.id);
    }
  }, [currentOrganization?.id, isMultiTenant, fetchMembers, fetchInvitations]);

  // Handle sending invitation
  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !currentOrganization?.id) return;

    setIsInviting(true);
    setInviteSuccess(false);
    clearError();

    const result = await createInvitation(currentOrganization.id, inviteEmail.trim(), inviteRole);

    if (result) {
      setInviteEmail('');
      setInviteRole('member');
      setInviteSuccess(true);
      setTimeout(() => setInviteSuccess(false), 3000);
    }

    setIsInviting(false);
  }, [inviteEmail, inviteRole, currentOrganization, createInvitation, clearError]);

  // Handle revoking invitation
  const handleRevokeInvitation = useCallback(async (email: string) => {
    if (!currentOrganization?.id) return;
    await revokeInvitation(currentOrganization.id, email);
  }, [currentOrganization, revokeInvitation]);

  // Handle removing member
  const handleRemoveMember = useCallback(async (userId: string) => {
    if (!currentOrganization?.id) return;
    if (!confirm(t('confirmRemoveMember') || 'Are you sure you want to remove this member?')) return;
    await removeMember(currentOrganization.id, userId);
  }, [currentOrganization, removeMember, t]);

  // Handle changing member role
  const handleChangeRole = useCallback(async (userId: string, newRole: string) => {
    if (!currentOrganization?.id) return;
    await updateMemberRole(currentOrganization.id, userId, newRole);
  }, [currentOrganization, updateMemberRole]);

  // Handle sharing personal organization (enable collaboration)
  const handleShareOrganization = useCallback(async () => {
    if (!currentOrganization?.id) return;
    if (!confirm(t('confirmEnableCollaboration') || 'Enable collaboration on this personal project? You will be able to invite collaborators after enabling.')) return;

    setIsSharing(true);
    clearError();

    const success = await shareOrganization(currentOrganization.id);

    if (success) {
      // Refresh members and invitations for the newly-shared org
      fetchMembers(currentOrganization.id);
      fetchInvitations(currentOrganization.id);
    }

    setIsSharing(false);
  }, [currentOrganization, shareOrganization, clearError, fetchMembers, fetchInvitations]);

  // Handle editing organization name
  const handleStartEdit = useCallback(() => {
    setEditedName(currentOrganization?.name || '');
    setIsEditingName(true);
  }, [currentOrganization]);

  const handleSaveName = useCallback(async () => {
    if (!currentOrganization?.id || !editedName.trim()) return;

    const success = await updateOrganization(currentOrganization.id, { name: editedName.trim() });

    if (success) {
      setIsEditingName(false);
    }
  }, [currentOrganization, editedName, updateOrganization]);

  const handleCancelEdit = useCallback(() => {
    setIsEditingName(false);
    setEditedName('');
  }, []);

  // Handle deleting organization
  const handleDelete = useCallback(async () => {
    if (!currentOrganization?.id) return;

    const orgType = currentOrganization.is_personal ? 'workspace' : 'collaborative workspace';
    const orgName = currentOrganization.name;
    const confirmMsg = `Are you sure you want to delete "${orgName}"? This action cannot be undone and all data will be permanently deleted.${!currentOrganization.is_personal ? ' All collaborators will lose access.' : ''}`;

    if (!confirm(confirmMsg)) return;

    setIsDeleting(true);
    console.log('[WorkspaceTab] Deleting organization:', currentOrganization.id);

    try {
      const success = await deleteOrganization(currentOrganization.id);

      if (success) {
        console.log('[WorkspaceTab] Organization deleted successfully');
        // deleteOrganization already switches to personal workspace
        // Give it a moment to complete before the component rerenders
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.error('[WorkspaceTab] Failed to delete organization');
        alert('Failed to delete workspace. Please try again.');
      }
    } catch (error) {
      console.error('[WorkspaceTab] Error deleting organization:', error);
      alert('An error occurred while deleting the workspace.');
    } finally {
      setIsDeleting(false);
    }
  }, [currentOrganization, deleteOrganization]);

  // Get role icon
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="h-4 w-4 text-blue-500" />;
      case 'member':
        return <User className="h-4 w-4 text-gray-500" />;
      case 'viewer':
        return <User className="h-4 w-4 text-gray-400" />;
      default:
        return <User className="h-4 w-4 text-gray-500" />;
    }
  };

  if (!isMultiTenant) {
    return (
      <div className="space-y-3 sm:space-y-6 pb-20">
        <h3 className="hidden sm:block text-xl font-semibold text-gray-900 dark:text-white">{t('workspace')}</h3>
        <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('workspaceManagementMultiTenantOnly')}
          </p>
        </div>
      </div>
    );
  }

  if (!currentOrganization || isPersonalMode) {
    return (
      <div className="space-y-3 sm:space-y-6 pb-20">
        <h3 className="hidden sm:block text-xl font-semibold text-gray-900 dark:text-white">{t('workspace')}</h3>
        <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-3 mb-3">
            <User className="h-6 w-6 text-[#FF6417] dark:text-[#FF8A4D]" />
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('personalWorkspace')}</h4>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('personalWorkspaceMode')}
          </p>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="mb-2">{t('toOrganizeOrCollaborate')}</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>{t('createPersonalProject')}</li>
              <li>{t('createTeamWorkspace')}</li>
            </ul>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
              {t('useWorkspaceSwitcher')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-6 pb-20">
      <h3 className="hidden sm:block text-xl font-semibold text-gray-900 dark:text-white">
        {currentOrganization.is_personal ? t('personalProject') || 'Personal Project' : t('collaborativeProject') || 'Collaborative Project'}
      </h3>

      {/* Organization Info */}
      <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A] overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
            {currentOrganization.is_personal ? (
              <Briefcase className="h-6 w-6 text-[#FF6417] dark:text-[#FF8A4D]" />
            ) : (
              <Building2 className="h-6 w-6 text-[#FF6417] dark:text-[#FF8A4D]" />
            )}
            <div className="flex-1">
              {/* Editable name */}
              {isEditingName ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="h-8 text-lg font-medium flex-1 min-w-0"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                  />
                  <button
                    onClick={handleSaveName}
                    className="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400 flex-shrink-0"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex-shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className="text-lg font-medium text-gray-900 dark:text-white truncate">{currentOrganization.name}</h4>
                  {isAdminOrOwner && (
                    <button
                      onClick={handleStartEdit}
                      className="p-1 rounded hover:bg-[#FF6417]/10 text-gray-500 hover:text-[#FF6417] flex-shrink-0"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                {currentOrganization.is_personal ? t('personalProject') : (t('collaborativeProject') || 'Collaborative Project')}
              </p>
            </div>
          </div>

          {/* Share button for personal organizations - Hidden for now */}
          {/* {currentOrganization.is_personal && isAdminOrOwner && (
            <Button
              onClick={handleShareOrganization}
              disabled={isSharing}
              variant="outline"
              size="sm"
              className="border-[#FF6417] text-[#FF6417] hover:bg-[#FF6417]/10 flex-shrink-0 w-full sm:w-auto"
            >
              <Share2 className="h-4 w-4 mr-2" />
              {isSharing ? (t('enabling') || 'Enabling...') : (t('enableCollaboration') || 'Enable Collaboration')}
            </Button>
          )} */}
        </div>

        {/* Your Role */}
        <div className="mb-4">
          <span className="text-sm text-gray-600 dark:text-gray-400">{t('yourRole')}</span>
          <span className="ml-2 text-sm font-medium text-gray-900 dark:text-white capitalize inline-flex items-center gap-1">
            {getRoleIcon(currentOrganization.user_role || 'member')}
            {currentOrganization.user_role || t('member')}
          </span>
        </div>

        {/* Info about personal projects */}
        {currentOrganization.is_personal && (
          <div className="pt-4 border-t border-[#FFE0D0] dark:border-[#3A3A3A]">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('personalProjectInfo') || 'This is a personal workspace - only you can access it.'}
            </p>
          </div>
        )}
      </div>

      {/* Collaborators - Only show for collaborative projects */}
      {!currentOrganization.is_personal && (
        <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('collaborators') || 'Collaborators'}</h4>
          </div>

          {isLoadingMembers ? (
            <div className="text-center py-4">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-[#FF6417]" />
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{t('loadingMembers')}</p>
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('noMembersFound')}</p>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#2A2A2A] border border-[#FFE0D0] dark:border-[#3A3A3A]"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-[#FF6417]/10 dark:bg-[#FF8A4D]/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-[#FF6417] dark:text-[#FF8A4D]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {member.name || member.email || 'Unknown'}
                      </p>
                      {member.email && member.name && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{member.email}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAdminOrOwner && member.role !== 'owner' ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => handleChangeRole(member.user_id, e.target.value)}
                          className={cn(
                            'text-xs px-2 py-1 rounded border',
                            'bg-white dark:bg-[#3A3A3A]',
                            'border-[#FFE0D0] dark:border-[#4A4A4A]',
                            'text-gray-900 dark:text-white',
                            'focus:ring-2 focus:ring-[#FF6417]'
                          )}
                        >
                          <option value="admin">{t('admin')}</option>
                          <option value="member">{t('member')}</option>
                          <option value="viewer">{t('viewer')}</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
                        {getRoleIcon(member.role)}
                        {member.role}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite Collaborators (Admin/Owner only) */}
      {isAdminOrOwner && !currentOrganization.is_personal && (
        <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('inviteCollaborator') || 'Invite Collaborator'}</h4>
          </div>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('emailAddress')}
                className="flex-1"
                disabled={isInviting}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
                className={cn(
                  'px-3 py-2 rounded border',
                  'bg-white dark:bg-[#2A2A2A]',
                  'border-[#FFE0D0] dark:border-[#3A3A3A]',
                  'text-gray-900 dark:text-white',
                  'focus:ring-2 focus:ring-[#FF6417]'
                )}
                disabled={isInviting}
              >
                <option value="admin">{t('admin')}</option>
                <option value="member">{t('member')}</option>
                <option value="viewer">{t('viewer')}</option>
              </select>
              <Button
                onClick={handleInvite}
                disabled={isInviting || !inviteEmail.trim()}
                className="bg-[#FF6417] hover:bg-[#E55A15] text-white"
              >
                {isInviting ? t('sending') : t('invite')}
              </Button>
            </div>

            {inviteSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">
                {t('invitationSentSuccess')}
              </p>
            )}
          </div>

          {/* Pending Invitations */}
          {invitations.length > 0 && (
            <div className="mt-6">
              <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{t('pendingInvitations')}</h5>
              <div className="space-y-2">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#2A2A2A] border border-[#FFE0D0] dark:border-[#3A3A3A]"
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{invitation.email}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                          {invitation.role} • {invitation.status}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeInvitation(invitation.email)}
                      className="text-xs px-3 py-1 rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      {t('revoke')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Danger Zone - Delete */}
      {isOwner && (
        <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-5 border border-red-200 dark:border-red-800 overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <h4 className="text-lg font-medium text-red-900 dark:text-red-100 break-words">{t('dangerZone') || 'Danger Zone'}</h4>
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4 break-words">
            {currentOrganization.is_personal
              ? (t('deleteProjectWarning') || 'Delete this project permanently. This action cannot be undone.')
              : (t('deleteCollaborativeProjectWarning') || 'Delete this collaborative project and all its data permanently. This action cannot be undone and will affect all collaborators.')}
          </p>
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            variant="outline"
            className="border-red-600 dark:border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 w-full sm:w-auto"
          >
            <Trash2 className="h-4 w-4 mr-2 flex-shrink-0" />
            <span className="truncate">{isDeleting ? (t('deleting') || 'Deleting...') : (t('deleteForever') || 'Delete Forever')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}, areEqual);
WorkspaceTab.displayName = 'WorkspaceTab';
