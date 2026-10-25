'use client';

import { useState } from 'react';
import { useOrganizations, useCurrentOrganization } from '@/lib/hooks/use-organization';
import { useOrganizationStore } from '@/lib/stores/organization-store';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { ChevronDown, Plus, Building2, User, Check, Briefcase, Settings } from 'lucide-react';
import { WorkspaceSettingsModal } from '@/components/ui/workspace-settings-modal';
import { useTheme } from '@/components/theme-provider';
import { DROPDOWN_STYLES } from '@/components/ui/sidebar-styles';

/**
 * Smart organization switcher component for 3-tier workspace architecture:
 * 1. Personal Workspace (Flat) - No organization, user_id isolation
 * 2. Personal Projects - is_personal: true, owner only, can be made collaborative
 * 3. Collaborative Projects - is_personal: false, multi-member (via shareOrganization)
 *
 * Features:
 * - Auto-loads organizations on mount
 * - Shows all 3 workspace types with clear sections
 * - Allows creating personal projects (can be converted to collaborative later)
 * - Persists current workspace selection
 */
export function OrganizationSwitcher() {
  const { t } = useLanguage();
  const { theme, resolvedTheme } = useTheme();
  const isDarkMode = theme === 'dark' || resolvedTheme === 'dark';
  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingPersonal, setIsCreatingPersonal] = useState(false);
  const [newPersonalName, setNewPersonalName] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsOrgId, setSettingsOrgId] = useState<string | null>(null);
  const [settingsOrgName, setSettingsOrgName] = useState<string>('');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const { organization: current, setCurrentOrganization } = useCurrentOrganization();
  const {
    personal,
    teams,
    isLoading,
    error,
    createPersonalOrganization,
    clearError,
  } = useOrganizations();

  // Get personal mode state from store
  const isPersonalMode = useOrganizationStore(state => state.isPersonalMode);

  // Get theme-specific colors from DROPDOWN_STYLES
  const themeKey = isDarkMode ? 'dark' : 'light';
  const dropdownBgColor = DROPDOWN_STYLES[themeKey].backgroundColor;
  const hoverColor = DROPDOWN_STYLES[themeKey].hoverColor;
  const textColor = DROPDOWN_STYLES[themeKey].color;
  const iconColor = isDarkMode ? '#9E9E9E' : '#666';
  const checkColor = isDarkMode ? '#E6E6E6' : '#FF6417';

  const handleSwitch = async (orgId: string | null) => {
    await setCurrentOrganization(orgId);
    setIsOpen(false);
  };

  const handleCreatePersonal = async () => {
    if (!newPersonalName.trim()) return;

    const result = await createPersonalOrganization(newPersonalName.trim());

    if (result) {
      setNewPersonalName('');
      setIsCreatingPersonal(false);
      setIsOpen(false);
    }
  };

  const handleToggle = () => {
    if (error) clearError();
    setIsOpen(!isOpen);
  };

  const handleOpenSettings = (e: React.MouseEvent, orgId: string, orgName: string, userRole: string) => {
    e.stopPropagation();
    setSettingsOrgId(orgId);
    setSettingsOrgName(orgName);
    setIsSettingsOpen(true);
    setIsOpen(false);
  };

  if (isLoading && !current) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Current workspace button */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-3 lg:py-2 rounded-lg transition-colors hover:bg-[#FFE8DC] dark:hover:bg-[#2F2F2F]"
      >
        <div className="flex items-center gap-2 truncate">
          {isPersonalMode ? (
            <User className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
          ) : (
            <Building2 className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
          )}
          <span className="truncate text-sm font-medium" style={{ color: textColor }}>
            {isPersonalMode ? t('personalWorkspace') : (current?.name || t('selectWorkspace'))}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          style={{ color: iconColor }}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl overflow-hidden"
          style={{
            backgroundColor: 'transparent',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div style={{ padding: '8px', backgroundColor: dropdownBgColor }}>
          {/* Error message */}
          {error && (
            <div className="mx-1 mb-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Personal Workspace (Flat) - Always shown first */}
          <button
            onClick={() => handleSwitch(null)}
            onMouseEnter={() => setHoveredItem('personal-workspace')}
            onMouseLeave={() => setHoveredItem(null)}
            className="flex w-full items-center gap-2 cursor-pointer text-sm w-full transition-colors duration-150"
            style={{
              backgroundColor: hoveredItem === 'personal-workspace' ? hoverColor : 'transparent',
              padding: '12px 16px',
              margin: '2px 0',
              borderRadius: '8px',
              color: textColor,
              border: 'none',
            }}
          >
            <User className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
            <span className="flex-1 truncate text-left">{t('personalWorkspace')}</span>
            {isPersonalMode && (
              <Check className="h-4 w-4 flex-shrink-0" style={{ color: checkColor }} />
            )}
          </button>

          {/* Personal Projects Section */}
          {personal.length > 0 && (
            <>
              <div className="my-1 h-px" style={{ backgroundColor: isDarkMode ? '#424242' : '#e5d6c9' }} />
              <div className="px-4 py-2 text-xs font-semibold" style={{ color: isDarkMode ? '#9E9E9E' : '#666' }}>
                {t('personalProjects')}
              </div>
              {personal.map((org) => (
                <div key={org.id} className="flex items-center gap-1 group">
                  <button
                    onClick={() => handleSwitch(org.id)}
                    onMouseEnter={() => setHoveredItem(`personal-${org.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className="flex flex-1 items-center gap-2 text-sm transition-colors duration-150"
                    style={{
                      backgroundColor: hoveredItem === `personal-${org.id}` ? hoverColor : 'transparent',
                      padding: '12px 16px',
                      margin: '2px 0',
                      borderRadius: '8px',
                      color: textColor,
                      border: 'none',
                    }}
                  >
                    <Briefcase className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                    <span className="flex-1 truncate text-left">{org.name}</span>
                    {current?.id === org.id && (
                      <Check className="h-4 w-4 flex-shrink-0" style={{ color: checkColor }} />
                    )}
                  </button>
                  <button
                    onClick={(e) => handleOpenSettings(e, org.id, org.name, org.user_role || 'owner')}
                    onMouseEnter={() => setHoveredItem(`settings-${org.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className="p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-150"
                    style={{
                      backgroundColor: hoveredItem === `settings-${org.id}` ? hoverColor : 'transparent',
                    }}
                    title="Workspace Settings"
                  >
                    <Settings className="h-4 w-4" style={{ color: iconColor }} />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Collaborative Projects Section */}
          {teams.length > 0 && (
            <>
              <div className="my-1 h-px" style={{ backgroundColor: isDarkMode ? '#424242' : '#e5d6c9' }} />
              <div className="px-4 py-2 text-xs font-semibold" style={{ color: isDarkMode ? '#9E9E9E' : '#666' }}>
                {t('collaborativeProjects') || 'Collaborative Projects'}
              </div>
              {teams.map((org) => (
                <div key={org.id} className="flex items-center gap-1 group">
                  <button
                    onClick={() => handleSwitch(org.id)}
                    onMouseEnter={() => setHoveredItem(`team-${org.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className="flex flex-1 items-center gap-2 text-sm transition-colors duration-150"
                    style={{
                      backgroundColor: hoveredItem === `team-${org.id}` ? hoverColor : 'transparent',
                      padding: '12px 16px',
                      margin: '2px 0',
                      borderRadius: '8px',
                      color: textColor,
                      border: 'none',
                    }}
                  >
                    <Building2 className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
                    <span className="flex-1 truncate text-left">{org.name}</span>
                    {current?.id === org.id && (
                      <Check className="h-4 w-4 flex-shrink-0" style={{ color: checkColor }} />
                    )}
                  </button>
                  <button
                    onClick={(e) => handleOpenSettings(e, org.id, org.name, org.user_role || 'member')}
                    onMouseEnter={() => setHoveredItem(`team-settings-${org.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className="p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-150"
                    style={{
                      backgroundColor: hoveredItem === `team-settings-${org.id}` ? hoverColor : 'transparent',
                    }}
                    title="Workspace Settings"
                  >
                    <Settings className="h-4 w-4" style={{ color: iconColor }} />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Divider before create */}
          <div className="my-1 h-px" style={{ backgroundColor: isDarkMode ? '#424242' : '#e5d6c9' }} />

          {/* Create new personal project */}
          {!isCreatingPersonal ? (
            <button
              onClick={() => setIsCreatingPersonal(true)}
              onMouseEnter={() => setHoveredItem('create-button')}
              onMouseLeave={() => setHoveredItem(null)}
              className="flex w-full items-center gap-2 text-sm transition-colors duration-150"
              style={{
                backgroundColor: hoveredItem === 'create-button' ? hoverColor : 'transparent',
                padding: '12px 16px',
                margin: '2px 0',
                borderRadius: '8px',
                color: textColor,
                border: 'none',
              }}
            >
              <Plus className="h-4 w-4 flex-shrink-0" style={{ color: iconColor }} />
              <span>{t('createPersonalProjectButton')}</span>
            </button>
          ) : (
            <div className="space-y-2 p-2">
              <input
                type="text"
                value={newPersonalName}
                onChange={(e) => setNewPersonalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreatePersonal();
                  } else if (e.key === 'Escape') {
                    setIsCreatingPersonal(false);
                    setNewPersonalName('');
                  }
                }}
                placeholder={t('projectName')}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreatePersonal}
                  disabled={!newPersonalName.trim()}
                  className="flex-1"
                >
                  {t('create')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsCreatingPersonal(false);
                    setNewPersonalName('');
                  }}
                  className="flex-1"
                >
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Backdrop to close dropdown */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setIsOpen(false);
            setIsCreatingPersonal(false);
            setNewPersonalName('');
          }}
        />
      )}

      {/* Workspace Settings Modal */}
      {settingsOrgId && (
        <WorkspaceSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => {
            setIsSettingsOpen(false);
            setSettingsOrgId(null);
            setSettingsOrgName('');
          }}
          organizationId={settingsOrgId}
          organizationName={settingsOrgName}
          userRole={(current?.user_role || 'member') as 'owner' | 'admin' | 'member' | 'viewer'}
        />
      )}
    </div>
  );
}
