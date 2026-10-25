'use client';

import { useState, useRef, useEffect } from 'react';
import { Folder, X } from 'lucide-react';
import { useChatStore } from '@/lib/chat-store';
import { useShallow } from 'zustand/react/shallow';
import { useLanguage } from '@/components/providers/language-provider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const DEFAULT_COLORS = [
  '#6366f1', // Indigo (default)
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#6b7280', // Gray
];

export function CreateFolderModal({ isOpen, onClose, onSuccess }: CreateFolderModalProps) {
  const { createFolder } = useChatStore(useShallow((s) => ({ createFolder: s.createFolder })));
  const { t } = useLanguage();
  const [folderName, setFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFolderName('');
      setSelectedColor(DEFAULT_COLORS[0]);
      setError(null);
      setIsCreating(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!folderName.trim()) {
      setError(t('folderNameRequired') || 'Folder name is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const folderId = await createFolder({
        name: folderName.trim(),
        color: selectedColor,
        pinned: false,
      });

      if (folderId) {
        onSuccess?.();
        onClose();
      } else {
        setError(t('failedToCreateFolder') || 'Failed to create folder');
      }
    } catch (err) {
      console.error('Error creating folder:', err);
      setError(t('failedToCreateFolder') || 'Failed to create folder');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            {t('createNewFolder') || 'Create New Folder'}
          </DialogTitle>
          <DialogDescription>
            {t('organizeChatsFolders') || 'Organize your chats into folders for better management'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="folder-name" className="text-sm font-medium">
              {t('folderName') || 'Folder Name'}
            </label>
            <Input
              ref={inputRef}
              id="folder-name"
              type="text"
              value={folderName}
              onChange={(e) => {
                setFolderName(e.target.value);
                setError(null);
              }}
              placeholder={t('enterFolderName') || 'Enter folder name...'}
              className={cn(
                "w-full",
                error && "border-red-500 focus:ring-red-500"
              )}
              disabled={isCreating}
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('folderColor') || 'Folder Color'}
            </label>
            <div className="flex gap-2 flex-wrap">
              {DEFAULT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "w-8 h-8 rounded-md transition-all",
                    selectedColor === color && "ring-2 ring-offset-2 ring-gray-900 dark:ring-gray-100"
                  )}
                  style={{ backgroundColor: color }}
                  disabled={isCreating}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <div 
              className="flex items-center gap-2 flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800"
            >
              <Folder 
                className="h-5 w-5 flex-shrink-0" 
                style={{ color: selectedColor }}
              />
              <span className="text-sm font-medium truncate">
                {folderName || t('newFolder') || 'New Folder'}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isCreating}
            >
              {t('cancel') || 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={isCreating || !folderName.trim()}
            >
              {isCreating ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  {t('creating') || 'Creating...'}
                </>
              ) : (
                t('create') || 'Create'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}