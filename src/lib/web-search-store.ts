import { create } from 'zustand';
import { env } from '@/lib/env';

interface WebSearchStore {
  isEnabled: boolean;
  isAvailable: boolean;
  toggleWebSearch: () => void;
}

export const useWebSearchStore = create<WebSearchStore>((set, get) => ({
  isEnabled: false,
  isAvailable: env.NEXT_PUBLIC_WEB_SEARCH_ENABLED === 'true',
  toggleWebSearch: () => {
    const currentState = get();
    const newState = !currentState.isEnabled;
    
    console.log('[WebSearchStore] Toggling web search:', { 
      from: currentState.isEnabled, 
      to: newState,
      isAvailable: currentState.isAvailable 
    });
    
    set((state) => ({ 
      isEnabled: !state.isEnabled 
    }));
    
    // Verify the state change
    const updatedState = get();
    console.log('[WebSearchStore] State after toggle:', { 
      isEnabled: updatedState.isEnabled,
      expectedState: newState,
      stateMatches: updatedState.isEnabled === newState
    });
  },
}));