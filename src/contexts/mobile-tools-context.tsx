'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

// Tool types that can be selected in the mobile interface
export type MobileToolType = 
  | 'web-search'
  | 'image-generation' 
  | 'video-generation'
  | '3d-generation'
  | 'mcp-tools'
  | null;

// Configuration for tools that need settings
export interface ToolConfiguration {
  imageGeneration?: {
    size: string;
    numOutputs: number;
    useContext?: boolean;
    sourceImage?: File;
  };
  videoGeneration?: {
    aspectRatio?: string;
    resolution?: string;
    frameCount?: number;
    useContext?: boolean;
  };
  threeDGeneration?: {
    textureSize?: number;
    meshSimplify?: number;
    ssSamplingSteps?: number;
    texturedMesh?: boolean;
    useContext?: boolean;
    imageFiles?: File[];
  };
}

interface MobileToolsContextType {
  // Modal state
  isPrimaryModalOpen: boolean;
  isSecondaryModalOpen: boolean;
  activeTool: MobileToolType;
  
  // Tool configurations
  toolConfiguration: ToolConfiguration;
  
  // Actions
  openPrimaryModal: () => void;
  closePrimaryModal: () => void;
  openSecondaryModal: (tool: MobileToolType) => void;
  closeSecondaryModal: () => void;
  closeAllModals: () => void;
  setActiveTool: (tool: MobileToolType) => void;
  clearActiveTool: () => void;
  updateToolConfiguration: (config: Partial<ToolConfiguration>) => void;
  clearToolConfiguration: (tool?: keyof ToolConfiguration) => void;
}

const MobileToolsContext = createContext<MobileToolsContextType | undefined>(undefined);

interface MobileToolsProviderProps {
  children: ReactNode;
}

export function MobileToolsProvider({ children }: MobileToolsProviderProps) {
  const [isPrimaryModalOpen, setIsPrimaryModalOpen] = useState(false);
  const [isSecondaryModalOpen, setIsSecondaryModalOpen] = useState(false);
  const [activeTool, setActiveToolState] = useState<MobileToolType>(null);
  const [toolConfiguration, setToolConfiguration] = useState<ToolConfiguration>({});

  const openPrimaryModal = () => {
    setIsPrimaryModalOpen(true);
  };

  const closePrimaryModal = () => {
    setIsPrimaryModalOpen(false);
    setActiveToolState(null);
  };

  const openSecondaryModal = (tool: MobileToolType) => {
    setActiveTool(tool);
    setIsSecondaryModalOpen(true);
  };

  const closeSecondaryModal = () => {
    setIsSecondaryModalOpen(false);
    // Don't clear active tool here - let the primary modal handle it
  };

  const closeAllModals = () => {
    setIsPrimaryModalOpen(false);
    setIsSecondaryModalOpen(false);
    setActiveToolState(null);
  };

  const setActiveTool = (tool: MobileToolType) => {
    setActiveToolState(tool);
  };

  const clearActiveTool = () => {
    setActiveToolState(null);
    // Also clear any active tool configurations
    setToolConfiguration({});
  };

  const updateToolConfiguration = (config: Partial<ToolConfiguration>) => {
    setToolConfiguration(prev => ({
      ...prev,
      ...config,
    }));
  };

  const clearToolConfiguration = (tool?: keyof ToolConfiguration) => {
    if (tool) {
      setToolConfiguration(prev => {
        const newConfig = { ...prev };
        delete newConfig[tool];
        return newConfig;
      });
    } else {
      setToolConfiguration({});
    }
  };

  const value: MobileToolsContextType = {
    isPrimaryModalOpen,
    isSecondaryModalOpen,
    activeTool,
    toolConfiguration,
    openPrimaryModal,
    closePrimaryModal,
    openSecondaryModal,
    closeSecondaryModal,
    closeAllModals,
    setActiveTool,
    clearActiveTool,
    updateToolConfiguration,
    clearToolConfiguration,
  };

  return (
    <MobileToolsContext.Provider value={value}>
      {children}
    </MobileToolsContext.Provider>
  );
}

export function useMobileTools() {
  const context = useContext(MobileToolsContext);
  if (!context) {
    throw new Error('useMobileTools must be used within a MobileToolsProvider');
  }
  return context;
} 