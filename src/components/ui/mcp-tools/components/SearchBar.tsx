'use client';

import React, { useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from '../styles/mcp-tools.module.css';

// Simple debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDarkMode: boolean;
}

export function SearchBar({ value, onChange, placeholder = 'Search tools...', isDarkMode }: SearchBarProps) {
  // Debounce search input (300ms delay)
  const debouncedOnChange = useMemo(
    () => debounce((term: string) => {
      onChange(term);
    }, 300),
    [onChange]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Update input immediately for responsive UI
    e.target.value = newValue;
    // Debounce the actual search
    debouncedOnChange(newValue);
  }, [debouncedOnChange]);

  return (
    <div className={styles.searchContainer}>
      <Search className={cn(styles.searchIcon, isDarkMode && styles.dark)} />
      <input
        type="text"
        defaultValue={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        className={cn(styles.searchInput, isDarkMode && styles.dark)}
      />
    </div>
  );
}