import { useMemo } from 'react';
import type { Chat } from '@/lib/supabase';

// Cache for time group calculations
const timeGroupCache = new Map<string, string>();
const relativeTimeCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

// Helper to clear cache if it gets too large
function clearCacheIfNeeded<T>(cache: Map<string, T>) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// Get time group for a date
export function getTimeGroupCached(dateString: string, t: (key: any) => string): string {
  const cacheKey = `${dateString}-${t('today')}`;
  
  if (timeGroupCache.has(cacheKey)) {
    return timeGroupCache.get(cacheKey)!;
  }
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInMilliseconds = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMilliseconds / (1000 * 60 * 60 * 24));
  
  let group: string;
  if (diffInDays === 0) {
    group = t('today');
  } else if (diffInDays === 1) {
    group = t('yesterday');
  } else if (diffInDays < 7) {
    group = t('thisWeek');
  } else {
    group = t('older');
  }
  
  clearCacheIfNeeded(timeGroupCache);
  timeGroupCache.set(cacheKey, group);
  return group;
}

// Get relative time for a date
export function getRelativeTimeCached(dateString: string, t: (key: any) => string): string {
  const cacheKey = `${dateString}-${t('today')}`;
  
  if (relativeTimeCache.has(cacheKey)) {
    return relativeTimeCache.get(cacheKey)!;
  }
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInMilliseconds = now.getTime() - date.getTime();
  const diffInMinutes = Math.floor(diffInMilliseconds / 60000);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  
  let relativeTime: string;
  if (diffInMinutes < 1) {
    relativeTime = t('justNow');
  } else if (diffInMinutes < 60) {
    relativeTime = diffInMinutes === 1 ? t('oneMinuteAgo') : `${diffInMinutes} ${t('minutesAgo')}`;
  } else if (diffInHours < 24) {
    relativeTime = diffInHours === 1 ? t('oneHourAgo') : `${diffInHours} ${t('hoursAgo')}`;
  } else if (diffInDays < 7) {
    relativeTime = diffInDays === 1 ? t('oneDayAgo') : `${diffInDays} ${t('daysAgo')}`;
  } else {
    const diffInWeeks = Math.floor(diffInDays / 7);
    relativeTime = diffInWeeks === 1 ? t('oneWeekAgo') : `${diffInWeeks} ${t('weeksAgo')}`;
  }
  
  clearCacheIfNeeded(relativeTimeCache);
  relativeTimeCache.set(cacheKey, relativeTime);
  return relativeTime;
}

// Group chats by time
export function groupChatsByTimeCached(chats: Chat[], t: (key: any) => string): Record<string, Chat[]> {
  const groups: Record<string, Chat[]> = {};
  
  chats.forEach(chat => {
    const group = getTimeGroupCached(chat.updated_at || chat.created_at, t);
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(chat);
  });
  
  // Sort groups by priority using translated group names
  const groupOrder = [t('today'), t('yesterday'), t('thisWeek'), t('older')];
  const sortedGroups: Record<string, Chat[]> = {};
  
  groupOrder.forEach(group => {
    if (groups[group]) {
      sortedGroups[group] = groups[group];
    }
  });
  
  return sortedGroups;
}

// React hook for memoized grouping
export function useGroupedChats(chats: Chat[], t: (key: any) => string) {
  return useMemo(() => groupChatsByTimeCached(chats, t), [chats, t]);
}

// React hook for memoized relative time
export function useRelativeTime(dateString: string, t: (key: any) => string) {
  return useMemo(() => getRelativeTimeCached(dateString, t), [dateString, t]);
}