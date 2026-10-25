'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { ArtifactSidebar } from '@/components/ui/artifact-sidebar';
import { ArtifactErrorBoundary } from '@/components/ui/artifact-sidebar/error-boundary';
import { 
  ArtifactContextType, 
  ArtifactData, 
  SupportedLanguage,
  ArtifactSidebarProps 
} from '@/components/ui/artifact-sidebar/types/artifact.types';

const ArtifactContext = createContext<ArtifactContextType | undefined>(undefined);

const DEFAULT_CONFIG: ArtifactSidebarProps['config'] = {
  preview: {
    showLineNumbers: false,
    theme: 'light',
    autoRefresh: true,
    sanitizeContent: true,
  },
  resize: {
    minWidth: 400,
    maxWidth: 1200,
    defaultWidth: 600,
    persistPreferences: true,
  },
};

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [artifactData, setArtifactData] = useState<ArtifactData | null>(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const openArtifact = useCallback((
    code: string, 
    language: SupportedLanguage, 
    title?: string,
    customConfig?: ArtifactSidebarProps['config']
  ) => {
    const newArtifactData: ArtifactData = {
      code,
      language,
      title: title || `${language.charAt(0).toUpperCase() + language.slice(1)} Preview`,
      id: `artifact-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    setArtifactData(newArtifactData);
    
    if (customConfig) {
      setConfig(prevConfig => ({
        preview: { ...prevConfig?.preview, ...customConfig.preview },
        resize: { ...prevConfig?.resize, ...customConfig.resize },
      }));
    }
    
    setIsOpen(true);
  }, []);

  const closeArtifact = useCallback(() => {
    setIsOpen(false);
    // Keep artifact data for potential reopening
  }, []);

  const updateArtifact = useCallback((updates: Partial<ArtifactData>) => {
    setArtifactData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        ...updates,
        updatedAt: new Date(),
      };
    });
  }, []);

  const updateConfig = useCallback((updates: Partial<ArtifactSidebarProps['config']>) => {
    setConfig(prevConfig => ({
      preview: { ...prevConfig?.preview, ...updates?.preview },
      resize: { ...prevConfig?.resize, ...updates?.resize },
    }));
  }, []);

  const contextValue: ArtifactContextType = {
    isOpen,
    artifactData,
    openArtifact,
    closeArtifact,
    updateArtifact,
    config: config as { preview: any; resize: any }, // Type assertion for now
    updateConfig,
  };

  return (
    <ArtifactContext.Provider value={contextValue}>
      {children}
      {isOpen && artifactData && (
        <ArtifactErrorBoundary>
          <ArtifactSidebar
            isOpen={isOpen}
            onClose={closeArtifact}
            code={artifactData.code}
            language={artifactData.language}
            title={artifactData.title}

          />
        </ArtifactErrorBoundary>
      )}
    </ArtifactContext.Provider>
  );
}

export function useArtifact() {
  const context = useContext(ArtifactContext);
  if (context === undefined) {
    throw new Error('useArtifact must be used within an ArtifactProvider');
  }
  return context;
} 