'use client';

import { useState, useEffect } from 'react';
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
  ChevronRight,
  ChevronDown,
  FileText,
  Check,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/providers/language-provider';

const formatTemplate = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );

interface NotionPage {
  id: string;
  name: string;
  hasChildren: boolean;
  children?: NotionPage[];
}

interface NotionPagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'top-level' | 'subpages';
  currentPageIds?: string[];
  currentPageNames?: string[];
  onSelect: (pageIds: string[], pageNames: string[]) => void;
}

interface PageNodeProps {
  page: NotionPage;
  level: number;
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (page: NotionPage) => void;
  loadChildren: (parentId: string) => Promise<NotionPage[]>;
  childrenCache: Map<string, NotionPage[]>;
  mode: 'top-level' | 'subpages';
}

function PageNode({
  page,
  level,
  selectedIds,
  expandedIds,
  onToggle,
  onSelect,
  loadChildren,
  childrenCache,
  mode,
}: PageNodeProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [children, setChildren] = useState<NotionPage[]>(page.children || []);
  const isExpanded = expandedIds.has(page.id);
  const isSelected = selectedIds.has(page.id);

  // Debug logging
  useEffect(() => {
    console.log(`[PageNode] ${page.name}:`, {
      level,
      hasChildren: page.hasChildren,
      childrenCount: page.children?.length || 0,
      isExpanded,
      mode
    });
  }, [page.name, page.hasChildren, page.children, isExpanded, level, mode]);

  useEffect(() => {
    if (isExpanded && page.hasChildren) {
      // First check if children are already loaded on the page object (from subpages mode preload)
      if (page.children && page.children.length > 0) {
        console.log(`[PageNode] Using pre-loaded children for ${page.name}:`, page.children.length);
        setChildren(page.children);
        return;
      }

      // Otherwise, check cache
      const cached = childrenCache.get(page.id);
      if (cached) {
        console.log(`[PageNode] Using cached children for ${page.name}:`, cached.length);
        setChildren(cached);
        return;
      }

      // If not cached and not pre-loaded, fetch on demand (top-level mode expand clicks)
      console.log(`[PageNode] Fetching children for ${page.name}`);
      setIsLoading(true);
      loadChildren(page.id)
        .then((items) => {
          console.log(`[PageNode] Loaded ${items.length} children for ${page.name}`);
          setChildren(items);
          childrenCache.set(page.id, items);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [isExpanded, page.id, page.hasChildren, page.children, loadChildren, childrenCache]);


  // Determine if this page is selectable based on mode and level
  // Top-level mode: only root pages (level 0) are selectable
  // Subpages mode: only child pages (level > 0) are selectable
  const isSelectable = mode === 'top-level' ? level === 0 : level > 0;

  const handleRowClick = () => {
    // Only allow selection if page is selectable
    if (isSelectable) {
      onSelect(page);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (page.hasChildren) {
      onToggle(page.id);
    }
  };

  return (
    <div>
      {/* Page row */}
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
          'w-full flex items-center gap-2 py-2 px-2 rounded-md transition-colors',
          isSelectable && 'cursor-pointer hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]',
          !isSelectable && 'cursor-default opacity-50',
          isSelected && 'bg-[#FF6417]/20 dark:bg-[#FF6417]/20 ring-1 ring-[#FF6417]'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand/collapse button */}
        <div
          role="button"
          tabIndex={-1}
          onClick={handleExpandClick}
          className={cn(
            'w-5 h-5 flex items-center justify-center rounded hover:bg-white/50 dark:hover:bg-white/10 flex-shrink-0',
            !page.hasChildren && 'invisible'
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

        {/* Page icon */}
        <FileText className={cn(
          'w-4 h-4 flex-shrink-0',
          isSelectable ? 'text-gray-500' : 'text-gray-400'
        )} />

        {/* Page name */}
        <span className={cn(
          'text-sm truncate flex-1 select-none',
          isSelectable ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'
        )}>{page.name}</span>

        {/* Selected indicator */}
        {isSelected && <Check className="w-4 h-4 text-[#FF6417] flex-shrink-0" />}
      </div>

      {/* Children */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <PageNode
              key={child.id}
              page={child}
              level={level + 1}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              loadChildren={loadChildren}
              childrenCache={childrenCache}
              mode={mode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NotionPagePicker({
  open,
  onOpenChange,
  mode,
  currentPageIds,
  currentPageNames,
  onSelect,
}: NotionPagePickerProps) {
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [childrenCache] = useState<Map<string, NotionPage[]>>(new Map());
  const { t } = useLanguage();

  // Reset state when dialog opens and expand all nodes
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(currentPageIds || []));
      setError(null);
      setExpandedIds(new Set()); // Will be populated after loading
      loadPages();
    }
  }, [open, currentPageIds]);

  const loadPages = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (mode === 'top-level') {
        // Top-level: Just load root pages, lazy-load children on expand
        const response = await fetch('/api/nango/notion/pages?mode=root');
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || t('notionPagePickerLoadError'));
        }
        const data = await response.json();
        console.log('[loadPages] Top-level mode - loaded pages:', data.pages);
        setPages(data.pages || []);
        // Don't auto-expand, let user click arrows
      } else {
        // Subpages: Load full tree upfront using new tree endpoint
        const response = await fetch('/api/nango/notion/pages?mode=tree');
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || t('notionPagePickerLoadError'));
        }
        const data = await response.json();
        const treePages = data.pages || [];
        console.log('[loadPages] Subpages mode - loaded tree:', treePages);

        // Auto-expand all pages with children
        const allIds = new Set<string>();
        const collectPageIds = (pages: NotionPage[]) => {
          pages.forEach(page => {
            if (page.hasChildren) {
              allIds.add(page.id);
            }
            if (page.children) {
              collectPageIds(page.children);
            }
          });
        };
        collectPageIds(treePages);

        console.log('[loadPages] Auto-expanding IDs:', Array.from(allIds));
        setPages(treePages);
        setExpandedIds(allIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notionPagePickerLoadError'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadChildren = async (parentId: string): Promise<NotionPage[]> => {
    try {
      const response = await fetch(
        `/api/nango/notion/pages?mode=children&parentId=${parentId}`
      );
      if (!response.ok) {
        throw new Error(t('notionPagePickerLoadError'));
      }
      const data = await response.json();
      return data.pages || [];
    } catch (err) {
      console.error('Failed to load child pages:', err);
      return [];
    }
  };

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

  const handleSelectPage = (page: NotionPage) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(page.id)) {
        next.delete(page.id);
      } else {
        next.add(page.id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    // Recursively find all selected pages in the tree
    const findSelectedPages = (pages: NotionPage[]): NotionPage[] => {
      const selected: NotionPage[] = [];
      for (const page of pages) {
        if (selectedIds.has(page.id)) {
          selected.push(page);
        }
        if (page.children) {
          selected.push(...findSelectedPages(page.children));
        }
      }
      return selected;
    };

    const selectedPages = findSelectedPages(pages);
    const pageIds = Array.from(selectedIds);
    const pageNames = selectedPages.map(p => p.name);
    onSelect(pageIds, pageNames);
    onOpenChange(false);
  };

  const modeLabel = mode === 'top-level'
    ? t('notionPagePickerTopLevelTitle')
    : t('notionPagePickerSubpagesTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#FFF1E5] dark:bg-[#212121] border-[#FFE0D0] dark:border-[#2A2A2A]">
        <DialogHeader>
          <DialogTitle>{modeLabel}</DialogTitle>
          <DialogDescription>
            {mode === 'top-level'
              ? t('notionPagePickerTopLevelDescription')
              : t('notionPagePickerSubpagesDescription')}
          </DialogDescription>
        </DialogHeader>

        {/* Selection info */}
        <div className="flex items-center justify-between p-2 bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-md">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {selectedIds.size === 0
              ? t('notionPagePickerNoSelection')
              : selectedIds.size === 1
                ? t('notionPagePickerOneSelected')
                : formatTemplate(t('notionPagePickerMultipleSelected'), { count: selectedIds.size })}
          </span>
          {selectedIds.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs"
            >
              {t('clearSelection')}
            </Button>
          )}
        </div>

        {/* Page tree */}
        <div className="border border-[#FFE0D0] dark:border-[#2A2A2A] rounded-lg bg-white dark:bg-[#1A1A1A]">
          <div className="h-[400px] overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[#FF6417]" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
                <p className="text-red-500 text-sm mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={loadPages}>
                  {t('retry')}
                </Button>
              </div>
            ) : pages.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                {t('notionPagePickerEmptyState')}
              </div>
            ) : (
              <div className="p-2">
                {pages.map((page) => (
                  <PageNode
                    key={page.id}
                    page={page}
                    level={0}
                    selectedIds={selectedIds}
                    expandedIds={expandedIds}
                    onToggle={handleToggle}
                    onSelect={handleSelectPage}
                    loadChildren={loadChildren}
                    childrenCache={childrenCache}
                    mode={mode}
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
            disabled={selectedIds.size === 0}
            className="bg-[#FF6417] hover:bg-[#E05A15] text-white disabled:opacity-50"
          >
            {selectedIds.size === 1
              ? t('notionPagePickerSelectSingle')
              : formatTemplate(t('notionPagePickerSelectMultiple'), { count: selectedIds.size })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
