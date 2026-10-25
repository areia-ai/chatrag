import { create } from 'zustand';

export interface ReasoningConfig {
  enabled: boolean;
  effort: 'high' | 'medium' | 'low';
  maxOutputTokens: number;
  exclude?: boolean;
}

interface ReasoningStore {
  enabled: boolean;
  effort: 'high' | 'medium' | 'low';
  maxOutputTokens: number;
  exclude?: boolean;
  setConfig: (config: Partial<ReasoningConfig>) => void;
  setEnabled: (enabled: boolean) => void;
  setEffort: (effort: 'high' | 'medium' | 'low') => void;
  setMaxTokens: (maxTokens: number) => void;
  setExclude: (exclude: boolean) => void;
  getConfig: () => ReasoningConfig | null;
  reset: () => void;
}

const DEFAULT_CONFIG: ReasoningConfig = {
  enabled: false,
  effort: 'medium',
  maxOutputTokens: 8000,
};

export const useReasoningStore = create<ReasoningStore>((set, get) => ({
  ...DEFAULT_CONFIG,
  
  setConfig: (config) => {
    console.log('[ReasoningStore] Setting config:', config);
    set((state) => ({ ...state, ...config }));
  },
  
  setEnabled: (enabled) => {
    console.log('[ReasoningStore] Setting enabled:', enabled);
    set({ enabled });
  },
  
  setEffort: (effort) => {
    console.log('[ReasoningStore] Setting effort:', effort);
    set({ effort });
  },
  
  setMaxTokens: (maxTokens) => {
    console.log('[ReasoningStore] Setting maxTokens:', maxTokens);
    set({ maxOutputTokens: maxTokens });
  },

  setExclude: (exclude) => {
    console.log('[ReasoningStore] Setting exclude:', exclude);
    set({ exclude });
  },
  
  getConfig: () => {
    const state = get();
    console.log('[ReasoningStore] getConfig called, current state:', {
      enabled: state.enabled,
      effort: state.effort,
      maxOutputTokens: state.maxOutputTokens
    });
    
    // Only return config if reasoning is enabled
    if (!state.enabled) {
      console.log('[ReasoningStore] Reasoning is disabled, returning null');
      return null;
    }
    
    const config = {
      enabled: state.enabled,
      effort: state.effort,
      maxOutputTokens: state.maxOutputTokens,
      ...(typeof state.exclude === 'boolean' ? { exclude: state.exclude } : {})
    };
    console.log('[ReasoningStore] Returning config:', config);
    return config;
  },
  
  reset: () => {
    console.log('[ReasoningStore] Resetting to defaults');
    set(DEFAULT_CONFIG);
  },
}));
