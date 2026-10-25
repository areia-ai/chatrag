'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Home,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SupportedProvider } from '@/lib/nango/types';
import { useLanguage } from '@/components/providers/language-provider';

const formatTemplate = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value),
    template
  );

interface FolderItem {
  id: string;
  name: string;
  hasChildren: boolean;
}

interface FolderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: SupportedProvider;
  providerName: string;
  currentFolderId?: string | null;
  currentFolderName?: string | null;
  multiSelect?: boolean;
  onSelect: (folderIds: string | string[], folderNames: string | string[], folderPaths: string | string[]) => void;
}

interface FolderNodeProps {
  folder: FolderItem;
  level: number;
  provider: SupportedProvider;
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  multiSelect?: boolean;
  onToggle: (id: string) => void;
  onSelect: (folder: FolderItem) => void;
  loadChildren: (parentId: string) => Promise<FolderItem[]>;
  childrenCache: Map<string, FolderItem[]>;
}

function FolderNode({
  folder,
  level,
  provider,
  selectedIds,
  expandedIds,
  multiSelect,
  onToggle,
  onSelect,
  loadChildren,
  childrenCache,
}: FolderNodeProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [children, setChildren] = useState<FolderItem[]>([]);
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedIds.has(folder.id);

  useEffect(() => {
    if (isExpanded && folder.hasChildren) {
      const cached = childrenCache.get(folder.id);
      if (cached) {
        setChildren(cached);
        return;
      }

      setIsLoading(true);
      loadChildren(folder.id)
        .then((items) => {
          setChildren(items);
          childrenCache.set(folder.id, items);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [isExpanded, folder.id, folder.hasChildren, loadChildren, childrenCache]);

  const handleRowClick = () => {
    onSelect(folder);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (folder.hasChildren) {
      onToggle(folder.id);
    }
  };

  return (
    <div>
      {/* Folder row */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick();
          }
        }}
        className={cn(
          "w-full flex items-center gap-1 py-2 px-2 rounded-md cursor-pointer transition-colors",
          "hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]",
          isSelected && "bg-[#FF6417]/20 dark:bg-[#FF6417]/20 ring-1 ring-[#FF6417]"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand/collapse button */}
        <div
          role="button"
          tabIndex={-1}
          onClick={handleExpandClick}
          className={cn(
            "w-5 h-5 flex items-center justify-center rounded hover:bg-white/50 dark:hover:bg-white/10 flex-shrink-0",
            !folder.hasChildren && "invisible"
          )}
        >
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
          ) : isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </div>

        {/* Folder icon */}
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-[#FF6417] flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-gray-500 flex-shrink-0" />
        )}

        {/* Folder name */}
        <span className="text-sm truncate flex-1 select-none">{folder.name}</span>

        {/* Selected indicator */}
        {isSelected && (
          <Check className="w-4 h-4 text-[#FF6417] flex-shrink-0" />
        )}
      </div>

      {/* Children */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              level={level + 1}
              provider={provider}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              multiSelect={multiSelect}
              onToggle={onToggle}
              onSelect={onSelect}
              loadChildren={loadChildren}
              childrenCache={childrenCache}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderPicker({
  open,
  onOpenChange,
  provider,
  providerName,
  currentFolderId,
  currentFolderName,
  multiSelect = false,
  onSelect,
}: FolderPickerProps) {
  const [rootFolders, setRootFolders] = useState<FolderItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For multi-select: use a Map to store id -> {name, path}
  const [selectedFolders, setSelectedFolders] = useState<Map<string, { name: string; path: string }>>(new Map());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { t } = useLanguage();
  const [childrenCache] = useState<Map<string, FolderItem[]>>(new Map());

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      // Initialize selection from current values
      const initialSelection = new Map<string, { name: string; path: string }>();
      if (currentFolderId && currentFolderId !== 'multi-folder-mode') {
        initialSelection.set(currentFolderId, {
          name: currentFolderName || '',
          path: t('folderPickerRootName') + ' > ' + (currentFolderName || '')
        });
      }
      setSelectedFolders(initialSelection);
      setError(null);
      loadRootFolders();
    }
  }, [open, currentFolderId, currentFolderName, t]);

  const loadRootFolders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/nango/folders?provider=${provider}&parentId=root`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('folderPickerLoadError'));
      }
      const data = await response.json();
      setRootFolders(data.folders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('folderPickerLoadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadChildren = useCallback(
    async (parentId: string): Promise<FolderItem[]> => {
      const response = await fetch(
        `/api/nango/folders?provider=${provider}&parentId=${parentId}`
      );
      if (!response.ok) {
        throw new Error(t('folderPickerLoadError'));
      }
      const data = await response.json();
      return data.folders || [];
    },
    [provider, t]
  );

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectFolder = (folder: FolderItem) => {
    setSelectedFolders((prev) => {
      const next = new Map(prev);
      const folderPath = t('folderPickerRootName') + ' > ' + folder.name;

      if (multiSelect) {
        // Toggle selection in multi-select mode
        if (next.has(folder.id)) {
          next.delete(folder.id);
        } else {
          next.set(folder.id, { name: folder.name, path: folderPath });
        }
      } else {
        // Single select: replace selection
        next.clear();
        next.set(folder.id, { name: folder.name, path: folderPath });
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (selectedFolders.size === 0) return;

    const folderIds = Array.from(selectedFolders.keys());
    const folderNames = Array.from(selectedFolders.values()).map(v => v.name);
    const folderPaths = Array.from(selectedFolders.values()).map(v => v.path);

    if (multiSelect) {
      onSelect(folderIds, folderNames, folderPaths);
    } else {
      // Single select: return single values
      onSelect(folderIds[0], folderNames[0], folderPaths[0]);
    }
    onOpenChange(false);
  };

  // Helper to get selected IDs as a Set for the FolderNode component
  const selectedIds = new Set(selectedFolders.keys());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#FFF1E5] dark:bg-[#212121] border-[#FFE0D0] dark:border-[#2A2A2A]">
        <DialogHeader>
          <DialogTitle>{t('folderPickerTitle')}</DialogTitle>
          <DialogDescription>
            {formatTemplate(t('folderPickerDescription'), { providerName })}
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb / Current selection */}
        <div className="flex items-center gap-2 p-2 bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-md">
          <Home className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
            {selectedFolders.size > 0
              ? (multiSelect && selectedFolders.size > 1
                ? `${selectedFolders.size} folders selected`
                : Array.from(selectedFolders.values())[0]?.path || t('folderPickerBreadcrumbPlaceholder'))
              : t('folderPickerBreadcrumbPlaceholder')}
          </span>
        </div>

        {/* Folder tree */}
        <div className="border border-[#FFE0D0] dark:border-[#2A2A2A] rounded-lg bg-white dark:bg-[#1A1A1A]">
          <div className="h-[400px] overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[#FF6417]" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <p className="text-red-500 text-sm mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={loadRootFolders}>
                  {t('retry')}
                </Button>
              </div>
            ) : rootFolders.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                {t('folderPickerEmptyState')}
              </div>
            ) : (
              <div className="p-2">
                {rootFolders.map((folder) => (
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    level={0}
                    provider={provider}
                    selectedIds={selectedIds}
                    expandedIds={expandedIds}
                    multiSelect={multiSelect}
                    onToggle={handleToggle}
                    onSelect={handleSelectFolder}
                    loadChildren={loadChildren}
                    childrenCache={childrenCache}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#FFE0D0] dark:border-[#2A2A2A]"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedFolders.size === 0}
            className="bg-[#FF6417] hover:bg-[#E05A15] text-white disabled:opacity-50"
          >
            {multiSelect && selectedFolders.size > 1
              ? `Select ${selectedFolders.size} Folders`
              : t('selectFolderAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
