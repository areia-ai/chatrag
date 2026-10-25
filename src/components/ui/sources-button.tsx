'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useSources } from '../providers/sources-provider';

interface SourcesButtonProps {
  disabled?: boolean;
  alwaysShowText?: boolean;
  skipIfEmpty?: boolean;
}

export function SourcesButton({ disabled = false, alwaysShowText = false, skipIfEmpty = false }: SourcesButtonProps) {
  const { hasAvailableSources, isSourcesOpen, trackedSetIsSourcesOpen, sources } = useSources();
  const containerRef = useRef<HTMLDivElement>(null);
  const chatId = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';
  const userClickedRef = useRef(false);
  
  // Check if sources are web search sources or relevant tool sources
  const hasWebSearchSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;
    
    // Only count 'web' type sources for the button visibility
    const webSources = sources.filter(source => source.type === 'web');
    console.log(`[SourcesButton] Web sources: ${webSources.length}, Total sources: ${sources.length}`);
    
    return webSources.length > 0;
  }, [sources]);
  
  // Check if sources are document sources from RAG
  const hasDocumentSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;
    
    const documentSources = sources.filter(source => source.type === 'document');
    console.log(`[SourcesButton] Document sources: ${documentSources.length}`);
    
    return documentSources.length > 0;
  }, [sources]);
  
  // Check if sources are only tool-related that should show button
  const hasRelevantToolSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;
    
    // Only show for tool sources that are NOT image generation
    const relevantToolSources = sources.filter(source => 
      source.type === 'tool_link' && 
      !source.toolName?.toLowerCase().includes('image') &&
      !source.toolName?.includes('create_image') &&
      !source.title?.toLowerCase().includes('image generation')
    );
    
    console.log(`[SourcesButton] Relevant tool sources: ${relevantToolSources.length}`);
    return relevantToolSources.length > 0;
  }, [sources]);
  
  // Check if sources are only image-related
  const isImageGenerationSources = React.useMemo(() => {
    if (!sources || sources.length === 0) return false;
    
    // Check if source is related to image generation
    return sources.some(source => 
      source.toolName?.toLowerCase().includes('image') || 
      source.toolName?.includes('create_image') ||
      source.title?.toLowerCase().includes('image generation')
    );
  }, [sources]);
  
  // If sources are only related to image generation, ensure sidebar stays closed unless clicked
  useEffect(() => {
    if (isSourcesOpen && isImageGenerationSources && !userClickedRef.current) {
      console.log('[SourcesButton] Auto-closing image generation sources');
      setTimeout(() => {
        trackedSetIsSourcesOpen(false, 'SourcesButton_ImageAutoClose');
        
        // Also dispatch a force close event
        window.dispatchEvent(new CustomEvent('forceSidebarClose', { 
          detail: { caller: 'SourcesButton_IMAGE_PREVENTION' }
        }));
      }, 0);
    }
  }, [isSourcesOpen, isImageGenerationSources, trackedSetIsSourcesOpen]);
  
  // Reset userClicked when sources change
  useEffect(() => {
    userClickedRef.current = false;
  }, [sources.length]); // Use sources.length instead of sources array
  
  const shouldSkipRender = skipIfEmpty && !hasWebSearchSources && !hasRelevantToolSources && !hasDocumentSources;

  // Always log sources count for debugging
  console.log(`[SourcesButton] Rendering with ${sources.length} sources, hasWebSearchSources=${hasWebSearchSources}, hasRelevantToolSources=${hasRelevantToolSources}, hasDocumentSources=${hasDocumentSources}`);
  
  if (sources.length > 0) {
    // Enhanced breakdown of source types for better debugging
    const sourceTypes = sources.reduce<Record<string, number>>((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {});
    
    console.log('[SourcesButton] Source types:', sourceTypes);
    
    // Log document sources specifically
    const docSources = sources.filter(s => s.type === 'document');
    if (docSources.length > 0) {
      console.log('[SourcesButton] Document sources (WILL NOT SHOW BUTTON):', docSources.map(s => ({
        title: s.title,
        documentId: s.documentId
      })));
    }
    
    // Log web sources specifically
    const webSources = sources.filter(s => s.type === 'web');
    if (webSources.length > 0) {
      console.log('[SourcesButton] Web sources (WILL SHOW BUTTON):', webSources.map(s => ({
        title: s.title,
        url: s.url
      })));
    }
  }
  
  // Create separate open and close functions for better control
  const openSources = React.useCallback(() => {
    console.log('[SourcesButton] Opening sources');
    userClickedRef.current = true;
    
    // First update the provider state
    trackedSetIsSourcesOpen(true, 'SourcesButton_OPEN');
    
    // Dispatch a direct event to force the sidebar to open
    // This is kept for UI synchronization between components
    try {
      setTimeout(() => {
        console.log('[SourcesButton] Dispatching forceSidebarOpen event');
        window.dispatchEvent(new CustomEvent('forceSidebarOpen', { 
          detail: { caller: 'SourcesButton_USER_CLICK' } 
        }));
      }, 10);
    } catch (e) {
      console.error('[SourcesButton] Error dispatching open event:', e);
    }
  }, [trackedSetIsSourcesOpen]);
  
  const closeSources = React.useCallback(() => {
    console.log('[SourcesButton] Closing sources');
    userClickedRef.current = false;
    
    // First update the provider state
    trackedSetIsSourcesOpen(false, 'SourcesButton_CLOSE');
    
    // Dispatch a direct close event that bypasses state management issues
    setTimeout(() => {
      console.log('[SourcesButton] Dispatching forceSidebarClose event');
      window.dispatchEvent(new CustomEvent('forceSidebarClose', { 
        detail: { caller: 'SourcesButton_USER_CLICK' } 
      }));
    }, 10);
  }, [trackedSetIsSourcesOpen]);
  
  // Create a toggle function that uses the specific open/close functions
  const toggleSources = React.useCallback(() => {
    if (isSourcesOpen) {
      closeSources();
    } else {
      openSources();
    }
  }, [isSourcesOpen, openSources, closeSources]);

  // Debug effect to log state changes
  useEffect(() => {
    console.log(`[SourcesButton] State changed: isSourcesOpen=${isSourcesOpen}, sourcesCount=${sources.length}, hasWebSearchSources=${hasWebSearchSources}, hasRelevantToolSources=${hasRelevantToolSources}`);
  }, [isSourcesOpen, sources.length, hasWebSearchSources, hasRelevantToolSources]);

  // Make button pulse when any sources are available but not open
  const shouldShowNotification = (hasWebSearchSources || hasRelevantToolSources || hasDocumentSources) && !isSourcesOpen;

  // Determine the badge count display - count all relevant sources
  const webSourceCount = sources.filter(s => s.type === 'web').length;
  const documentSourceCount = sources.filter(s => s.type === 'document').length;
  const toolSourceCount = sources.filter(s => 
    s.type === 'tool_link' && 
    !s.toolName?.toLowerCase().includes('image') &&
    !s.toolName?.includes('create_image') &&
    !s.title?.toLowerCase().includes('image generation')
  ).length;
  const relevantSourceCount = webSourceCount + documentSourceCount + toolSourceCount;
  
  const displayCount = relevantSourceCount > 0 ? relevantSourceCount : "?";

  if (shouldSkipRender) {
    console.log('[SourcesButton] Skipping render because no sources available');
    return null;
  }

  return (
    <div 
      className="relative"
      ref={containerRef}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[SourcesButton] Button clicked, current state: ${isSourcesOpen}`, e);
          // Call toggle directly, not through reference
          if (isSourcesOpen) {
            closeSources();
          } else {
            openSources();
          }
        }}
        data-sources-toggle="true"
        disabled={disabled}
        className={`
          flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm
          ${isSourcesOpen 
            ? 'bg-orange-100 text-[#FF6417] dark:bg-gray-800 dark:text-gray-300' 
            : 'text-[#FF6417] hover:bg-orange-50 dark:text-gray-300 dark:hover:bg-gray-800/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        aria-label={isSourcesOpen ? 'Hide sources' : 'Show sources'}
      >
        <Search className="h-4 w-4" />
        <span className={alwaysShowText ? '' : 'hidden sm:inline'}>
          Sources
        </span>
        {/* Show badge if we have any sources */}
        {(hasWebSearchSources || hasRelevantToolSources || hasDocumentSources) && (
          <span className={`ml-0.5 text-xs rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
            isSourcesOpen 
              ? 'bg-orange-200 dark:bg-gray-700' 
              : 'bg-orange-200 dark:bg-gray-700'
          }`}>
            {displayCount}
          </span>
        )}
      </button>
    </div>
  );
} 
