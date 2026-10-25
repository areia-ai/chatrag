'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';

interface Source {
  title: string;
  url?: string;
  snippet?: string;
  provider: string;
  date?: string;
  favicon?: string;
  content?: string;
  // Document-specific fields
  documentId?: string;
  uploadedAt?: string;
  type: 'document' | 'web' | 'tool_link';
  // Tool-specific fields
  toolName?: string;
  toolResultId?: string;
  explicitly_referenced?: boolean;
}

interface SourcesContextType {
  sources: Source[];
  setSources: (sources: Source[]) => void;
  isSourcesOpen: boolean;
  trackedSetIsSourcesOpen: (isOpen: boolean, caller: string) => void;
  hasAvailableSources: boolean;
}

const SourcesContext = createContext<SourcesContextType | undefined>(undefined);

export function SourcesProvider({ children }: { children: React.ReactNode }) {
  // Store the latest session ID for a more reliable persistence key
  const chatId = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';
  const sourcesStorageKey = `sources_${chatId}`;
  const sidebarStateKey = `sourcesOpen_${chatId}`;
  
  // Track sources with a default empty array
  const [sources, setSources] = useState<Source[]>([]);
  
  // Track if the sources sidebar is open
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  
  // Track if we have sources available that can be shown
  const [hasAvailableSources, setHasAvailableSources] = useState(false);
  
  // Debugging counter for useEffect dependencies
  const stateUpdateCountRef = useRef(0);
  
  // Enhanced setSources with better logging
  const enhancedSetSources = useCallback((newSources: Source[]) => {
    // Debug: Setting sources with count
    console.log('[SourcesProvider] Received sources:', newSources.map(s => ({
      title: s.title,
      type: s.type,
      hasType: 'type' in s,
      typeValue: s.type,
      allKeys: Object.keys(s)
    })));
    
    // Enhanced debugging to track document sources specifically
    const documentSources = newSources.filter(s => s.type === 'document');
    const webSources = newSources.filter(s => s.type === 'web');
    const toolSources = newSources.filter(s => s.type === 'tool_link');
    
    // Debug: Source breakdown by type
    
    if (documentSources.length > 0) {
      // Debug: Document sources found
      setHasAvailableSources(true);
    }
    
    // Log web sources as well
    if (webSources.length > 0) {
      // Debug: Web sources found
      setHasAvailableSources(true);
    }
    
    // Update state and also persist to localStorage for the current chat
    try {
      localStorage.setItem(sourcesStorageKey, JSON.stringify(newSources));
      // Debug: Saved sources to localStorage
    } catch (error) {
      console.error('[SOURCES_PROVIDER] Error saving sources to localStorage:', error);
    }

    // Increment the update counter for reliable effect triggering
    stateUpdateCountRef.current += 1;
    
    // Set sources and notify other components
    setSources(newSources);
    
    // Dispatch a custom event that can be listened to by other components
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('sourcesUpdated', { 
        detail: { 
          count: newSources.length,
          hasDocumentSources: documentSources.length > 0,
          forceShow: documentSources.length > 0 || webSources.length > 0,
          updateCount: stateUpdateCountRef.current
        }
      });
      window.dispatchEvent(event);
    }
  }, [sourcesStorageKey]);
  
  // Enhanced isSourcesOpen setter with tracking
  const trackedSetIsSourcesOpen = useCallback((newIsSourcesOpen: boolean, caller: string) => {
    // Debug: Setting isSourcesOpen state
    
    // Only persist state when explicitly triggered by user actions
    const isUserAction = caller.includes('USER_CLICK') || 
                         caller.includes('SourcesButton_OPEN') || 
                         caller.includes('SourcesButton_CLOSE');
    
    if (isUserAction) {
      // Update the localStorage value for persistence only for user actions
      try {
        localStorage.setItem(sidebarStateKey, String(newIsSourcesOpen));
        // Debug: Saved sidebar state to localStorage due to user action
      } catch (error) {
        console.error('[SOURCES_PROVIDER] Error saving sidebar state to localStorage:', error);
      }
    }
    
    // Update the state
    setIsSourcesOpen(newIsSourcesOpen);
    
    // Dispatch a custom event for synchronization
    if (typeof window !== 'undefined') {
      const eventName = newIsSourcesOpen ? 'sidebarOpened' : 'sidebarClosed';
      window.dispatchEvent(new CustomEvent(eventName, { detail: { caller } }));
    }
  }, [sidebarStateKey]);
  
  // Load initial sources from localStorage
  useEffect(() => {
    // Debug: Initializing sources from localStorage
    
    if (typeof window === 'undefined') return;
    
    try {
      // One-time migration: clear any previously stored sidebar open states
      // This prevents old "true" values from causing auto-open after the fix
      if (typeof localStorage !== 'undefined') {
        const migrationKey = 'sources_sidebar_migration_v1';
        if (!localStorage.getItem(migrationKey)) {
          // Debug: Running one-time migration to clear sidebar states
          // Find all sourcesOpen_* keys and remove them
          Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sourcesOpen_')) {
              // Debug: Clearing legacy sidebar state
              localStorage.removeItem(key);
            }
          });
          // Mark migration as complete
          localStorage.setItem(migrationKey, 'true');
        }
      }

      // Try to restore sources from localStorage if they exist
      const savedSources = localStorage.getItem(sourcesStorageKey);
      if (savedSources) {
        const parsedSources = JSON.parse(savedSources) as Source[];
        // Debug: Found sources in localStorage
        console.log('[SourcesProvider] Loading sources from localStorage:', parsedSources.map(s => ({
          title: s.title,
          type: s.type,
          hasType: 'type' in s,
          allKeys: Object.keys(s)
        })));
        
        // Ensure all sources have valid types (migration fix)
        const validatedSources = parsedSources.map(source => {
          if (!source.type || (source.type !== 'document' && source.type !== 'web' && source.type !== 'tool_link')) {
            console.warn('[SourcesProvider] Source missing valid type, defaulting to document:', source);
            // Default to document type if missing
            return { ...source, type: 'document' as const };
          }
          return source;
        });
        
        // Check if we have document sources specifically
        const documentSources = validatedSources.filter(s => s.type === 'document');
        if (documentSources.length > 0) {
          // Debug: Found document sources
          setHasAvailableSources(true);
        }
        
        // Set the sources state without triggering the enhancedSetSources
        setSources(validatedSources);
      } else {
        // Debug: No sources found in localStorage
      }
      
      // REMOVED: No longer restore open state from localStorage
      // This prevents the sidebar from auto-opening when navigating to a chat
    } catch (error) {
      console.error('[SOURCES_PROVIDER] Error loading from localStorage:', error);
    }
  }, [sourcesStorageKey, sidebarStateKey]);
  
  // Add a listener for forced open/close events
  useEffect(() => {
    const handleForceOpen = () => {
      // Debug: Received force open event
      trackedSetIsSourcesOpen(true, 'FORCE_OPEN_EVENT');
    };
    
    const handleForceClose = () => {
      // Debug: Received force close event
      trackedSetIsSourcesOpen(false, 'FORCE_CLOSE_EVENT');
    };
    
    // Add listener for direct source updates from findDocumentSources
    const handleForceSourceUpdate = (e: CustomEvent) => {
      // Debug: Received forceSourceUpdate event
      if (e.detail && e.detail.sources && Array.isArray(e.detail.sources)) {
        // Debug: Direct source update received
        
        // Directly update sources state with the provided sources
        setSources(e.detail.sources);
        
        // REMOVED: No longer force sidebar open on source updates
        // Instead only update the hasAvailableSources flag
        setHasAvailableSources(true);
        
        // Debug: Sources types received
        const sourceTypes = e.detail.sources.reduce((acc: Record<string, number>, s: any) => {
          acc[s.type] = (acc[s.type] || 0) + 1;
          return acc;
        }, {});
        
        // Store in localStorage for persistence
        try {
          localStorage.setItem(sourcesStorageKey, JSON.stringify(e.detail.sources));
          // Debug: Updated sources in localStorage
        } catch (err) {
          console.error('[SOURCES_PROVIDER] Failed to save sources to localStorage:', err);
        }
      }
    };
    
    window.addEventListener('forceSidebarOpen', handleForceOpen);
    window.addEventListener('forceSidebarClose', handleForceClose);
    window.addEventListener('forceSourceUpdate', handleForceSourceUpdate as EventListener);
    
    return () => {
      window.removeEventListener('forceSidebarOpen', handleForceOpen);
      window.removeEventListener('forceSidebarClose', handleForceClose);
      window.removeEventListener('forceSourceUpdate', handleForceSourceUpdate as EventListener);
    };
  }, [trackedSetIsSourcesOpen, setSources, sourcesStorageKey]);
  
  return (
    <SourcesContext.Provider value={{ 
      sources, 
      setSources: enhancedSetSources, 
      isSourcesOpen, 
      trackedSetIsSourcesOpen,
      hasAvailableSources
    }}>
      {children}
    </SourcesContext.Provider>
  );
}

export function useSources() {
  const context = useContext(SourcesContext);
  if (context === undefined) {
    throw new Error('useSources must be used within a SourcesProvider');
  }
  return context;
}

// Add a new function to clear sources for tool-only messages
export function clearSourcesForToolMessage() {
  const context = useContext(SourcesContext);
  if (context) {
    // Debug: Clearing sources for tool-only message
    context.setSources([]);
    context.trackedSetIsSourcesOpen(false, 'TOOL_MESSAGE_CLEAR');

    // Ensure localStorage is cleared too
    try {
      // Get the current chat ID
      const chatId = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';
      localStorage.removeItem(`sources_${chatId}`);
      localStorage.removeItem(`sourcesOpen_${chatId}`);
      // Debug: Cleared sources from localStorage
    } catch (error) {
      console.error('[SOURCES_PROVIDER] Error clearing sources from localStorage:', error);
    }
  }
}

// Add a debug function to log current sources state
export function debugSources() {
  const context = useContext(SourcesContext);
  if (context) {
    // This function intentionally logs to console for debugging purposes
    console.log('[SOURCES_PROVIDER] Current sources state:', {
      count: context.sources.length,
      hasAvailableSources: context.hasAvailableSources,
      isOpen: context.isSourcesOpen,
      sources: context.sources.map(s => ({
        type: s.type,
        title: s.title,
        documentId: s.type === 'document' ? s.documentId : undefined
      }))
    });
  }
} 
