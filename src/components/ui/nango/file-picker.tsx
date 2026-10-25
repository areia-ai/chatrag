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
import { Checkbox } from '@/components/ui/checkbox';
import {
    Loader2,
    File,
    FileText,
    Image as ImageIcon,
    FileSpreadsheet,
    Presentation,
    Check,
    Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SupportedProvider } from '@/lib/nango/types';
import { useLanguage } from '@/components/providers/language-provider';

const formatTemplate = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );

interface FileItem {
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    modifiedTime?: string;
}

interface FilePickerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider: SupportedProvider;
    providerName: string;
    onSelect: (fileIds: string[], fileNames: string[]) => void;
}

function getFileIcon(mimeType: string) {
    if (mimeType.includes('pdf')) return FileText;
    if (mimeType.includes('image')) return ImageIcon;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet;
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return Presentation;
    return File;
}

function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePicker({
    open,
    onOpenChange,
    provider,
    providerName,
    onSelect,
}: FilePickerProps) {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const { t } = useLanguage();

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setSelectedIds(new Set());
            setSearchQuery('');
            setError(null);
            loadFiles();
        }
    }, [open]);

    const loadFiles = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/nango/files?provider=${provider}`);
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || t('filePickerLoadError'));
            }
            const data = await response.json();
            setFiles(data.files || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('filePickerLoadError'));
        } finally {
            setIsLoading(false);
        }
    };

    const toggleFile = (fileId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(fileId)) {
                next.delete(fileId);
            } else {
                next.add(fileId);
            }
            return next;
        });
    };

    // Filter files based on search query
    const filteredFiles = files.filter(file =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleSelectAll = () => {
        if (selectedIds.size === filteredFiles.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredFiles.map(f => f.id)));
        }
    };

    const handleConfirm = () => {
        const selectedFiles = files.filter(f => selectedIds.has(f.id));
        const fileIds = selectedFiles.map(f => f.id);
        const fileNames = selectedFiles.map(f => f.name);
        onSelect(fileIds, fileNames);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-[#FFF1E5] dark:bg-[#212121] border-[#FFE0D0] dark:border-[#2A2A2A]">
                <DialogHeader>
                    <DialogTitle>{t('filePickerTitle')}</DialogTitle>
                    <DialogDescription>
                        {formatTemplate(t('filePickerDescription'), { providerName })}
                    </DialogDescription>
                </DialogHeader>

                {/* Search bar */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder={t('filePickerSearchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-md border border-[#FFE0D0] dark:border-[#2A2A2A] bg-white dark:bg-[#1A1A1A] text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6417]"
                    />
                </div>

                {/* Selection info */}
                <div className="flex items-center justify-between p-2 bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-md">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={selectedIds.size === filteredFiles.length && filteredFiles.length > 0}
                            onCheckedChange={handleSelectAll}
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                            {formatTemplate(t('filePickerSelectionInfo'), {
                                selected: selectedIds.size,
                                total: filteredFiles.length,
                            })}
                        </span>
                    </div>
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

                {/* File list */}
                <div className="border border-[#FFE0D0] dark:border-[#2A2A2A] rounded-lg bg-white dark:bg-[#1A1A1A]">
                    <div className="h-[400px] overflow-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-[#FF6417]" />
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                                <p className="text-red-500 text-sm mb-3">{error}</p>
                                <Button variant="outline" size="sm" onClick={loadFiles}>
                                    {t('retry')}
                                </Button>
                            </div>
                        ) : filteredFiles.length === 0 ? (
                            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                                {searchQuery ? t('filePickerNoSearchResults') : t('filePickerEmptyState')}
                            </div>
                        ) : (
                            <div className="p-2 space-y-1">
                                {filteredFiles.map((file) => {
                                    const isSelected = selectedIds.has(file.id);
                                    const FileIcon = getFileIcon(file.mimeType);

                                    return (
                                        <div
                                            key={file.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => toggleFile(file.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    toggleFile(file.id);
                                                }
                                            }}
                                            className={cn(
                                                "flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors",
                                                "hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]",
                                                isSelected && "bg-[#FF6417]/20 dark:bg-[#FF6417]/20 ring-1 ring-[#FF6417]"
                                            )}
                                        >
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleFile(file.id)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <FileIcon className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                    {file.size && <span>{formatFileSize(file.size)}</span>}
                                                    {file.modifiedTime && (
                                                        <span>
                                                            {t('filePickerModifiedPrefix')} {new Date(file.modifiedTime).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <Check className="w-4 h-4 text-[#FF6417] flex-shrink-0" />
                                            )}
                                        </div>
                                    );
                                })}
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
                        {selectedIds.size <= 1
                            ? t('filePickerSelectSingle')
                            : formatTemplate(t('filePickerSelectMultiple'), { count: selectedIds.size })}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
