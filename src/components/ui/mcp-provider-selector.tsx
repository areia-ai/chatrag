'use client';

import { Check } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { useState, useEffect } from 'react';

// MCP Provider options
const MCP_PROVIDERS = [
  { id: 'auto', displayName: 'Auto (Default)', description: 'Use any available MCP provider' },
  { id: 'zapier', displayName: 'Zapier', description: 'Use Zapier for integrations like Google Calendar, Gmail, etc.' }
];

// Define a localStorage key for persisting the selection
const LOCAL_STORAGE_KEY = 'selectedMcpProvider';

export function McpProviderSelector() {
  const { theme, resolvedTheme } = useTheme();
  const { t } = useLanguage();
  const isDarkMode = theme === 'dark' || resolvedTheme === 'dark';
  
  // Initialize selected provider from localStorage or default to 'auto'
  const [selectedProvider, setSelectedProviderState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'auto';
    return localStorage.getItem(LOCAL_STORAGE_KEY) || 'auto';
  });

  // Update localStorage when selection changes
  const setSelectedProvider = (providerId: string) => {
    setSelectedProviderState(providerId);
    localStorage.setItem(LOCAL_STORAGE_KEY, providerId);
  };

  return (
    <div className="p-2 bg-[#EFE1D5] dark:bg-[#2F2F2F] rounded-lg">
      {MCP_PROVIDERS.map((option) => (
        <div 
          key={option.id}
          className="flex items-center justify-between gap-2 text-sm w-full cursor-pointer px-4 py-3 my-1 rounded-lg group relative text-gray-700 dark:text-gray-200 transition-colors"
          onClick={() => setSelectedProvider(option.id)}
        >
          <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 bg-[#E5D6C9] dark:bg-[#424242] transition-opacity duration-200"></div>
          <div className="relative z-10 flex items-center justify-between w-full">
            <div className="flex flex-col">
              <span className="font-medium">{option.displayName}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
            </div>
            {selectedProvider === option.id && (
              <Check className="h-4 w-4 text-[#FF6417] dark:text-[#E6E6E6]" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Hook for accessing the selected MCP provider
export function useMcpProvider() {
  const [selectedProvider, setSelectedProviderState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'auto';
    return localStorage.getItem(LOCAL_STORAGE_KEY) || 'auto';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<{
    zapier: string[];
  }>({ zapier: [] });

  // Fetch available tools on mount
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const response = await fetch('/api/mcp/tools');
        if (response.ok) {
          const data = await response.json();
          const tools = data.tools || [];
          
          // Organize tools by provider
          const zapierTools = tools
            .filter((tool: any) => tool.server === 'zapier')
            .map((tool: any) => tool.name);
            
          setAvailableTools({
            zapier: zapierTools
          });
        }
      } catch (error) {
        console.error('Error fetching MCP tools:', error);
      }
    };
    
    fetchTools();
  }, []);

  const setSelectedProvider = (providerId: string) => {
    setSelectedProviderState(providerId);
    localStorage.setItem(LOCAL_STORAGE_KEY, providerId);
  };
  
  // Check if a tool is compatible with the current provider selection
  const isToolCompatible = (toolName: string): boolean => {
    if (!toolName) return false;
    
    // Extract provider from the tool name (mcp_[Provider]_MCP_[tool])
    const parts = toolName.split('_');
    if (parts.length < 4) return false;
    
    const toolProvider = parts[1].toLowerCase(); // zapier
    
    // If auto is selected, any provider is compatible
    if (selectedProvider === 'auto') return true;
    
    // Otherwise, the tool must match the selected provider
    return selectedProvider.toLowerCase() === toolProvider;
  };
  
  // Check if provider has specific tool capability
  const hasToolCapability = (capability: string): boolean => {
    if (selectedProvider === 'auto' || selectedProvider === 'zapier') {
      // In auto mode or zapier mode, check if zapier has this capability
      return availableTools.zapier.some(tool => tool.includes(capability));
    }
    
    return false;
  };
  
  // Get the appropriate tool name for a capability across providers
  const getToolForCapability = (capability: string): string | null => {
    // For all capabilities, use Zapier if available
    if (selectedProvider === 'auto' || selectedProvider === 'zapier') {
      const zapierTool = availableTools.zapier.find(t => 
        t.toLowerCase().includes(capability.toLowerCase())
      );
      if (zapierTool) {
        return zapierTool;
      }
    }
    
    return null;
  };

  return {
    selectedProvider,
    setSelectedProvider,
    isLoading,
    isToolCompatible,
    hasToolCapability,
    getToolForCapability,
    availableTools
  };
} 
