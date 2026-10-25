'use client';

import { useState, useEffect } from 'react';
import {
  Settings,
  Brain,
  AlertCircle,
  CheckCircle2,
  Building2,
  Sparkles,
  User,
  FileText,
  Loader2,
  Eye,
  Database,
  Trash2,
  Edit2,
  X,
  Check
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SystemPromptSettings, useOrganizationStore } from '@/lib/stores/organization-store';
import styles from '@/components/ui/settings/styles/settings.module.css';
import { useLanguage } from '@/components/providers/language-provider';

interface WorkspaceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  organizationName: string;
  userRole: 'owner' | 'admin' | 'member' | 'viewer';
}

const PRE_CONTEXT_PLACEHOLDER = `You are a helpful AI assistant for [YOUR TEAM/COMPANY].

Be professional, accurate, and friendly. Always check the knowledge base below before answering questions.

If you find relevant information, cite it. If not, let the user know honestly.`;

const POST_CONTEXT_PLACEHOLDER = `Now, using the knowledge base above:
- Answer the user's question with specific details from the documents
- Quote sources when you reference them
- If the answer isn't in the knowledge base, say so and offer to help in other ways
- Keep your answers clear and actionable`;

export function WorkspaceSettingsModal({
  isOpen,
  onClose,
  organizationId,
  organizationName,
  userRole,
}: WorkspaceSettingsModalProps) {
  const { t } = useLanguage();
  const { switchToPersonalWorkspace, fetchOrganizations } = useOrganizationStore();
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // System prompt settings
  const [enabled, setEnabled] = useState(false);
  const [preContext, setPreContext] = useState('');
  const [postContext, setPostContext] = useState('');

  // Workspace name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Workspace deletion
  const [isDeleting, setIsDeleting] = useState(false);

  const canEdit = userRole === 'owner' || userRole === 'admin';
  const isOwner = userRole === 'owner';

  // Load current settings when modal opens
  useEffect(() => {
    if (isOpen && organizationId) {
      loadSettings();
    }
  }, [isOpen, organizationId]);

  // Reset success message after 3 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/organizations/${organizationId}/settings`, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
          console.warn(`Workspace settings not found (${response.status}), likely deleted or access lost. Switching to personal workspace.`);

          // Switch to safe state
          switchToPersonalWorkspace();

          // Refresh list to remove the zombie entry
          fetchOrganizations();

          // Close modal
          onClose();

          // Notify user
          alert('This workspace no longer exists. Switching you to your personal workspace.');
          return;
        }
        throw new Error('Failed to load settings');
      }

      const data = await response.json();
      const systemPrompt = data.systemPrompt as SystemPromptSettings | null;

      if (systemPrompt) {
        setEnabled(systemPrompt.enabled || false);
        setPreContext(systemPrompt.preContext || '');
        setPostContext(systemPrompt.postContext || '');
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setError('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const validatePrompts = (): string | null => {
    if (!enabled) return null;

    if (!preContext.trim() && !postContext.trim()) {
      return 'Please add some instructions in at least one of the fields';
    }

    return null;
  };

  const handleSave = async () => {
    if (!canEdit) {
      setError('You do not have permission to edit settings');
      return;
    }

    const validationError = validatePrompts();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/organizations/${organizationId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          systemPrompt: {
            enabled,
            useFullPrompt: false, // Always use split mode
            preContext: preContext || undefined,
            postContext: postContext || undefined,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartEdit = () => {
    setEditedName(organizationName);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!canEdit || !editedName.trim()) return;

    setIsUpdatingName(true);
    setError(null);

    try {
      const response = await fetch(`/api/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: editedName.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update workspace name');
      }

      setIsEditingName(false);
      setSuccess(true);
      // Note: Parent component should refresh to show new name
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating workspace name:', err);
      setError(err.message || 'Failed to update workspace name');
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const handleDelete = async () => {
    if (!isOwner) {
      setError(t('onlyOwnerCanDelete'));
      return;
    }

    const confirmMsg = t('confirmDeleteMessage').replace('{workspace}', organizationName);

    if (!confirm(confirmMsg)) return;

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/organizations/${organizationId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        // If 404, it's already deleted. Treat as success.
        if (response.status === 404) {
          console.warn('Workspace already deleted (404)');
          // Fall through to success logic
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to delete workspace');
        }
      }

      // Close modal and let parent handle navigation
      onClose();
      // Optionally: window.location.reload() or redirect to home
    } catch (err: any) {
      console.error('Error deleting workspace:', err);
      setError(err.message || 'Failed to delete workspace');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn(
        'p-0 gap-0 max-w-3xl w-[95vw] lg:w-[90vw]',
        'bg-[#FFF1E5] dark:bg-[#212121] overflow-hidden',
        'h-[95vh] lg:h-[650px] max-h-[95vh] lg:max-h-[80vh]',
        'border shadow-lg rounded-lg',
        styles.settingsDialog,
        styles.accelerated
      )}>
        {/* Custom close button with inline styles and important classes to ensure correct positioning */}
        <DialogPrimitive.Close
          style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 100 }}
          className="!absolute !right-4 !top-4 rounded-full p-2 bg-[#FFE0D0] dark:bg-[#2A2A2A] text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7"
          onClick={() => onClose()}
        >
          <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
          <span className="sr-only">{t('close')}</span>
        </DialogPrimitive.Close>

        <DialogTitle className="sr-only">{t('workspaceSettings')} - {organizationName}</DialogTitle>

        <div className="flex flex-col h-full">
          <DialogHeader className="p-6 pb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                {t('workspaceSettings')}
              </h2>
            </div>
            <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
              {t('configureSettingsFor')} {organizationName}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
              <div className="px-6 pt-6 pb-0">
                <TabsList className="grid w-full grid-cols-2 bg-transparent gap-2 p-0 mb-6">
                  <TabsTrigger
                    value="general"
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 rounded-xl",
                      "data-[state=active]:bg-[#FFE0D0] data-[state=active]:dark:bg-[#2A2A2A]",
                      "data-[state=active]:text-gray-900 data-[state=active]:dark:text-white",
                      "data-[state=inactive]:text-gray-700 data-[state=inactive]:dark:text-gray-300",
                      "data-[state=inactive]:hover:bg-[#FFE0D0] data-[state=inactive]:dark:hover:bg-[#2A2A2A]"
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    {t('general')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="ai-behavior"
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 rounded-xl",
                      "data-[state=active]:bg-[#FFE0D0] data-[state=active]:dark:bg-[#2A2A2A]",
                      "data-[state=active]:text-gray-900 data-[state=active]:dark:text-white",
                      "data-[state=inactive]:text-gray-700 data-[state=inactive]:dark:text-gray-300",
                      "data-[state=inactive]:hover:bg-[#FFE0D0] data-[state=inactive]:dark:hover:bg-[#2A2A2A]"
                    )}
                  >
                    <Brain className="h-4 w-4" />
                    {t('aiBehavior')}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="general" className={cn(
                "space-y-6 mt-0 px-6 pb-6 overflow-y-scroll",
                "max-h-[calc(95vh-280px)] lg:max-h-[calc(650px-280px)]",
                "workspace-modal-scroll",
                styles.tabContent
              )}>
                {/* Workspace Information */}
                <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
                  <div className="flex items-center gap-3 mb-4">
                    <Building2 className="h-6 w-6 text-[#FF6417] dark:text-[#FF8A4D]" />
                    <div className="flex-1 min-w-0">
                      {isEditingName ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="h-8 text-lg font-medium flex-1"
                            autoFocus
                            disabled={isUpdatingName}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveName();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <button
                            onClick={handleSaveName}
                            disabled={isUpdatingName}
                            className="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={isUpdatingName}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h4 className="text-lg font-medium text-gray-900 dark:text-white truncate">
                            {organizationName}
                          </h4>
                          {canEdit && (
                            <button
                              onClick={handleStartEdit}
                              className="p-1 rounded hover:bg-[#FF6417]/10 text-gray-500 hover:text-[#FF6417]"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-sm text-gray-600 dark:text-gray-400">{t('workspace')}</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">{t('yourRole')}</span>
                      <span className="font-medium text-gray-900 dark:text-white capitalize">
                        {userRole}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Danger Zone - Delete Workspace (Owner only) */}
                {isOwner && (
                  <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-5 border border-red-200 dark:border-red-800">
                    <div className="flex items-center gap-2 mb-3">
                      <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                      <h4 className="text-lg font-medium text-red-900 dark:text-red-100">{t('dangerZone')}</h4>
                    </div>
                    <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                      {t('deleteWorkspaceWarning')}
                    </p>
                    <Button
                      onClick={handleDelete}
                      disabled={isDeleting}
                      variant="outline"
                      className="border-red-600 dark:border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {isDeleting ? t('deleting') : t('deleteWorkspace')}
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="ai-behavior" className={cn(
                "space-y-6 mt-0 px-6 pb-6 overflow-y-scroll",
                "max-h-[calc(95vh-280px)] lg:max-h-[calc(650px-280px)]",
                "workspace-modal-scroll",
                styles.tabContent
              )}>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-[#FF6417] dark:text-[#FF8A4D]" />
                  </div>
                ) : (
                  <>
                    {/* Introduction */}
                    <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
                      <div className="flex items-center gap-3 mb-3">
                        <Sparkles className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          {t('customizeAiAssistant')}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        {t('makeAiSoundLikeTeam')} <strong>{organizationName}</strong>.
                      </p>
                      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                        <p className="font-medium text-gray-900 dark:text-white mb-2">{t('howItWorks')}</p>

                        <div className="flex items-start gap-3">
                          <div className="h-6 w-6 rounded-full bg-[#FF6417]/10 dark:bg-[#FF8A4D]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-[#FF6417] dark:text-[#FF8A4D]">1</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white">{t('before')}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{t('setAiPersonality')}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="h-6 w-6 rounded-full bg-[#FF6417]/10 dark:bg-[#FF8A4D]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-[#FF6417] dark:text-[#FF8A4D]">2</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white">{t('during')}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{t('autoInjectKnowledgeBase')}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="h-6 w-6 rounded-full bg-[#FF6417]/10 dark:bg-[#FF8A4D]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-[#FF6417] dark:text-[#FF8A4D]">3</span>
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 dark:text-white">{t('after')}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{t('tellAiHowToUse')}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Master Toggle */}
                    <div className={cn(
                      "relative rounded-lg p-6 border-2 transition-all duration-200",
                      enabled
                        ? "bg-[#FF6417]/5 dark:bg-[#FF8A4D]/5 border-[#FF6417] dark:border-[#FF8A4D] shadow-sm"
                        : "bg-[#FFF0E8] dark:bg-[#1A1A1A] border-[#FFE0D0] dark:border-[#2A2A2A] hover:border-[#FF6417]/40 dark:hover:border-[#FF8A4D]/40"
                    )}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className={cn(
                              "h-5 w-5",
                              enabled ? "text-[#FF6417] dark:text-[#FF8A4D]" : "text-gray-400 dark:text-gray-500"
                            )} />
                            <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                              {t('useCustomInstructions')}
                            </h4>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                            {enabled
                              ? t('customInstructionsActive')
                              : t('turnOnToCustomize')
                            }
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Switch
                            checked={enabled}
                            onCheckedChange={setEnabled}
                            disabled={!canEdit}
                            className="data-[state=checked]:bg-[#FF6417] dark:data-[state=checked]:bg-[#FF8A4D]"
                          />
                          <span className={cn(
                            "text-xs font-medium transition-colors",
                            enabled
                              ? "text-[#FF6417] dark:text-[#FF8A4D]"
                              : "text-gray-400 dark:text-gray-500"
                          )}>
                            {enabled ? t('enabled') : t('disabled')}
                          </span>
                        </div>
                      </div>
                      {enabled && (
                        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FF6417]/5 to-transparent dark:from-[#FF8A4D]/5 pointer-events-none" />
                      )}
                    </div>

                    {enabled && (
                      <>
                        {/* Pre-Context Editor */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 mb-3">
                            <User className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                            <label className="text-base font-semibold text-gray-900 dark:text-white">
                              {t('step1SetPersonality')}
                            </label>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            {t('tellAiWhoItIs')}
                          </p>
                          <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-3 border border-[#FFE0D0] dark:border-[#2A2A2A] mb-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              <span className="font-semibold text-gray-900 dark:text-white">{t('examples')}</span> {t('personalityExamples')}
                            </p>
                          </div>
                          <textarea
                            value={preContext}
                            onChange={(e) => {
                              setPreContext(e.target.value);
                              setError(null);
                            }}
                            placeholder={PRE_CONTEXT_PLACEHOLDER}
                            disabled={!canEdit}
                            className={cn(
                              "w-full min-h-[150px] p-3 rounded-md border bg-background text-sm",
                              "focus:outline-none focus:ring-2 focus:ring-ring",
                              !canEdit && "opacity-50 cursor-not-allowed"
                            )}
                          />
                        </div>

                        {/* Context Indicator */}
                        <div className="flex items-center justify-center py-3">
                          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                            <Database className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <span className="text-sm font-medium text-green-700 dark:text-green-300">
                              {t('knowledgeBaseInserted')}
                            </span>
                          </div>
                        </div>

                        {/* Post-Context Editor */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 mb-3">
                            <FileText className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                            <label className="text-base font-semibold text-gray-900 dark:text-white">
                              {t('step2GiveInstructions')}
                            </label>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            {t('tellAiHowToUseKnowledgeBase')}
                          </p>
                          <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-3 border border-[#FFE0D0] dark:border-[#2A2A2A] mb-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              <span className="font-semibold text-gray-900 dark:text-white">{t('examples')}</span> {t('instructionsExamples')}
                            </p>
                          </div>
                          <textarea
                            value={postContext}
                            onChange={(e) => {
                              setPostContext(e.target.value);
                              setError(null);
                            }}
                            placeholder={POST_CONTEXT_PLACEHOLDER}
                            disabled={!canEdit}
                            className={cn(
                              "w-full min-h-[150px] p-3 rounded-md border bg-background text-sm",
                              "focus:outline-none focus:ring-2 focus:ring-ring",
                              !canEdit && "opacity-50 cursor-not-allowed"
                            )}
                          />
                        </div>
                      </>
                    )}

                    {/* Error Display */}
                    {error && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-red-900 dark:text-red-100">{t('error')}</p>
                          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                        </div>
                      </div>
                    )}

                    {/* Success Display */}
                    {success && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-green-900 dark:text-green-100">{t('settingsSaved')}</p>
                          <p className="text-sm text-green-800 dark:text-green-200">
                            {t('aiAssistantUpdated')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Permission Warning */}
                    {!canEdit && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <Eye className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-yellow-900 dark:text-yellow-100">{t('viewOnly')}</p>
                          <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            {t('viewOnlyMessage')}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-[#FFE0D0] dark:border-[#2A2A2A] flex-shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving || isUpdatingName || isDeleting}
            >
              {canEdit ? t('cancel') : t('close')}
            </Button>
            {canEdit && activeTab === 'ai-behavior' && (
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isLoading || !enabled}
                className="bg-[#FF6417] hover:bg-[#E55A15] text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('saving')}
                  </>
                ) : (
                  t('saveSettings')
                )}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
