'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  emitSelectPortalEvent,
} from '@/components/ui/select';

interface DebouncedSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  debounceMs?: number;
}

export const DebouncedSelect = memo(function DebouncedSelect({
  value,
  onValueChange,
  onOpenChange,
  children,
  className,
  disabled,
  placeholder,
  debounceMs = 150
}: DebouncedSelectProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const rafRef = useRef<number>();

  // Sync local value with prop value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Debounced value change handler
  const handleValueChange = useCallback((newValue: string) => {
    // Update local state immediately for UI responsiveness
    setLocalValue(newValue);
    
    // Clear existing timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    // Debounce the actual state update
    debounceTimerRef.current = setTimeout(() => {
      rafRef.current = requestAnimationFrame(() => {
        onValueChange(newValue);
      });
    }, debounceMs);
  }, [onValueChange, debounceMs]);

  // Optimized open change handler
  const handleOpenChange = useCallback((open: boolean) => {
    // Use requestAnimationFrame for smooth transitions
    rafRef.current = requestAnimationFrame(() => {
      setIsOpen(open);
      emitSelectPortalEvent(open);
      onOpenChange?.(open);
    });
  }, [onOpenChange]);

  return (
    <Select
      value={localValue}
      onValueChange={handleValueChange}
      onOpenChange={handleOpenChange}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-60 overflow-y-auto">
        {children}
      </SelectContent>
    </Select>
  );
});

DebouncedSelect.displayName = 'DebouncedSelect';

// Export a memoized SelectItem for better performance
export const MemoizedSelectItem = memo(SelectItem);
MemoizedSelectItem.displayName = 'MemoizedSelectItem';