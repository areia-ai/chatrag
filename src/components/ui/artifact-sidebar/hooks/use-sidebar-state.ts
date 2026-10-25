import { useReducer, useCallback, useEffect } from 'react';
import { SidebarState, SidebarAction, ResizeConfig } from '../types/artifact.types';

const DEFAULT_RESIZE_CONFIG: ResizeConfig = {
  minWidth: 400,
  maxWidth: 1200,
  defaultWidth: 600,
  step: 10,
  persistPreferences: true,
};

const STORAGE_KEY = 'artifact-sidebar-preferences';

function getStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RESIZE_CONFIG.defaultWidth;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const preferences = JSON.parse(stored);
      return preferences.width || DEFAULT_RESIZE_CONFIG.defaultWidth;
    }
  } catch (error) {
    console.warn('Failed to load sidebar preferences:', error);
  }
  
  return DEFAULT_RESIZE_CONFIG.defaultWidth;
}

function storeWidth(width: number): void {
  if (typeof window === 'undefined') return;
  
  try {
    const preferences = { width };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Failed to store sidebar preferences:', error);
  }
}

function getConstrainedWidth(width: number, config: ResizeConfig): number {
  return Math.min(Math.max(width, config.minWidth), config.maxWidth);
}

function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case 'OPEN_START':
      return {
        ...state,
        status: 'opening',
        error: null,
      };
      
    case 'OPEN_COMPLETE':
      return {
        ...state,
        status: 'open',
        error: null,
      };
      
    case 'CLOSE_START':
      return {
        ...state,
        status: 'closing',
        error: null,
      };
      
    case 'CLOSE_COMPLETE':
      return {
        ...state,
        status: 'closed',
        error: null,
      };
      
    case 'RESIZE_START':
      return {
        ...state,
        isResizing: true,
        width: action.width,
        error: null,
      };
      
    case 'RESIZE_UPDATE':
      return {
        ...state,
        width: action.width,
      };
      
    case 'RESIZE_END':
      return {
        ...state,
        isResizing: false,
      };
      
    case 'ERROR':
      return {
        ...state,
        status: 'error',
        error: action.error,
        isResizing: false,
      };
      
    case 'RESET':
      return {
        status: 'closed',
        width: DEFAULT_RESIZE_CONFIG.defaultWidth,
        isResizing: false,
        error: null,
      };
      
    default:
      return state;
  }
}

export function useSidebarState(config: Partial<ResizeConfig> = {}) {
  const resizeConfig: ResizeConfig = { ...DEFAULT_RESIZE_CONFIG, ...config };
  
  const [state, dispatch] = useReducer(sidebarReducer, {
    status: 'closed',
    width: getStoredWidth(),
    isResizing: false,
    error: null,
  });

  // Update max width on window resize
  useEffect(() => {
    const updateMaxWidth = () => {
      const newMaxWidth = Math.min(resizeConfig.maxWidth, window.innerWidth - 100);
      if (state.width > newMaxWidth) {
        const constrainedWidth = getConstrainedWidth(newMaxWidth, resizeConfig);
        dispatch({ type: 'RESIZE_UPDATE', width: constrainedWidth });
      }
    };

    window.addEventListener('resize', updateMaxWidth);
    return () => window.removeEventListener('resize', updateMaxWidth);
  }, [state.width, resizeConfig]);

  // Store width changes
  useEffect(() => {
    if (resizeConfig.persistPreferences && state.status !== 'closed') {
      storeWidth(state.width);
    }
  }, [state.width, resizeConfig.persistPreferences, state.status]);

  const actions = {
    open: useCallback(() => {
      dispatch({ type: 'OPEN_START' });
      // Use a small delay to allow for smooth animation
      setTimeout(() => dispatch({ type: 'OPEN_COMPLETE' }), 100);
    }, []),

    close: useCallback(() => {
      dispatch({ type: 'CLOSE_START' });
      // Use a small delay to allow for smooth animation
      setTimeout(() => dispatch({ type: 'CLOSE_COMPLETE' }), 300);
    }, []),

    startResize: useCallback((width: number) => {
      const constrainedWidth = getConstrainedWidth(width, resizeConfig);
      dispatch({ type: 'RESIZE_START', width: constrainedWidth });
    }, [resizeConfig]),

    updateResize: useCallback((width: number) => {
      const constrainedWidth = getConstrainedWidth(width, resizeConfig);
      dispatch({ type: 'RESIZE_UPDATE', width: constrainedWidth });
    }, [resizeConfig]),

    endResize: useCallback(() => {
      dispatch({ type: 'RESIZE_END' });
    }, []),

    setError: useCallback((error: string) => {
      dispatch({ type: 'ERROR', error });
    }, []),

    reset: useCallback(() => {
      dispatch({ type: 'RESET' });
    }, []),
  };

  return {
    state,
    actions,
    config: resizeConfig,
    // Computed values
    isOpen: state.status === 'open' || state.status === 'opening',
    isAnimating: state.status === 'opening' || state.status === 'closing',
    hasError: state.status === 'error',
  };
} 