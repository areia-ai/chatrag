import { useReducer, useCallback, useEffect, useRef, useMemo } from 'react';

interface SettingsModalState {
  activeTab: string;
  isSelectingOption: boolean;
  isInteractingWithSelect: boolean;
  isClosing: boolean;
}

type SettingsModalAction = 
  | { type: 'SET_TAB'; payload: string }
  | { type: 'SET_SELECTING'; payload: boolean }
  | { type: 'SET_INTERACTING'; payload: boolean }
  | { type: 'SET_CLOSING'; payload: boolean }
  | { type: 'RESET_STATE' };

// Optimized reducer with shallow equality checks
const settingsModalReducer = (state: SettingsModalState, action: SettingsModalAction): SettingsModalState => {
  switch (action.type) {
    case 'SET_TAB':
      if (state.activeTab === action.payload) return state;
      return { ...state, activeTab: action.payload };
    case 'SET_SELECTING':
      if (state.isSelectingOption === action.payload) return state;
      return { ...state, isSelectingOption: action.payload };
    case 'SET_INTERACTING':
      if (state.isInteractingWithSelect === action.payload) return state;
      return { ...state, isInteractingWithSelect: action.payload };
    case 'SET_CLOSING':
      if (state.isClosing === action.payload) return state;
      return { ...state, isClosing: action.payload };
    case 'RESET_STATE':
      if (!state.isSelectingOption && !state.isInteractingWithSelect && !state.isClosing) {
        return state;
      }
      return {
        ...state,
        isSelectingOption: false,
        isInteractingWithSelect: false,
        isClosing: false,
      };
    default:
      return state;
  }
};

const initialState: SettingsModalState = {
  activeTab: 'general',
  isSelectingOption: false,
  isInteractingWithSelect: false,
  isClosing: false,
};

export function useSettingsModal(isOpen: boolean, onOpenChange: (open: boolean) => void) {
  const [state, dispatch] = useReducer(settingsModalReducer, initialState);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const closeTimeoutRef = useRef<NodeJS.Timeout>();

  // Optimized reset with cleanup
  useEffect(() => {
    if (!isOpen) {
      // Use requestAnimationFrame for state reset
      const frame = requestAnimationFrame(() => {
        dispatch({ type: 'RESET_STATE' });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isOpen]);
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // Define event handlers at the top level (not inside useEffect)
  const handleSelectOpened = useCallback(() => {
    requestAnimationFrame(() => {
      dispatch({ type: 'SET_SELECTING', payload: true });
      dispatch({ type: 'SET_INTERACTING', payload: true });
    });
  }, []);

  const handleSelectClosed = useCallback(() => {
    requestAnimationFrame(() => {
      dispatch({ type: 'SET_SELECTING', payload: false });
      // Clear any existing timeout
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        dispatch({ type: 'SET_INTERACTING', payload: false });
      }, 100);
    });
  }, []);

  // Handle document-level events for select dropdowns
  useEffect(() => {
    if (!isOpen) return;

    // Listen for custom events with passive listeners for better performance
    document.addEventListener('select-portal-opened', handleSelectOpened, { passive: true });
    document.addEventListener('select-portal-closed', handleSelectClosed, { passive: true });

    return () => {
      document.removeEventListener('select-portal-opened', handleSelectOpened);
      document.removeEventListener('select-portal-closed', handleSelectClosed);
    };
  }, [isOpen, handleSelectOpened, handleSelectClosed]);

  const setActiveTab = useCallback((tab: string) => {
    requestAnimationFrame(() => {
      dispatch({ type: 'SET_TAB', payload: tab });
    });
  }, []);

  const setIsSelectingOption = useCallback((selecting: boolean) => {
    dispatch({ type: 'SET_SELECTING', payload: selecting });
  }, []);

  const setIsInteractingWithSelect = useCallback((interacting: boolean) => {
    dispatch({ type: 'SET_INTERACTING', payload: interacting });
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    // Don't close the dialog if we're in the middle of selecting an option
    if (!open && (state.isSelectingOption || state.isInteractingWithSelect)) {
      return;
    }
    
    // Track that we're deliberately closing
    if (!open) {
      dispatch({ type: 'SET_CLOSING', payload: true });
    }
    
    // Optimized parent callback with cleanup
    if (!open) {
      // Clear any existing timeout
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = setTimeout(() => {
        onOpenChange(open);
      }, 50);
    } else {
      onOpenChange(open);
    }
  }, [state.isSelectingOption, state.isInteractingWithSelect, onOpenChange]);

  const handlePointerDownOutside = useCallback((e: any) => {
    // Prevent closing when clicking on select dropdown or during interactions
    if (state.isSelectingOption || state.isInteractingWithSelect) {
      e.preventDefault();
      return;
    }
    
    // Check if interaction is with a select-related element
    const target = e.target as HTMLElement;
    const isSelectDropdown = 
      target.closest('[data-radix-select-content]') ||
      target.closest('[data-radix-select-item]') ||
      target.closest('[data-radix-select-trigger]') ||
      target.closest('[data-radix-popper-content-wrapper]');
                             
    if (isSelectDropdown) {
      e.preventDefault();
      return;
    }
  }, [state.isSelectingOption, state.isInteractingWithSelect]);

  const handleInteractOutside = useCallback((e: any) => {
    // Prevent interaction outside when using dropdowns
    if (state.isSelectingOption || state.isInteractingWithSelect) {
      e.preventDefault();
      return;
    }
  }, [state.isSelectingOption, state.isInteractingWithSelect]);

  const handleEscapeKeyDown = useCallback(() => {
    // Only allow escape to close if not in the middle of selection
    if (state.isSelectingOption || state.isInteractingWithSelect) {
      return;
    }
    dispatch({ type: 'SET_CLOSING', payload: true });
    onOpenChange(false);
  }, [state.isSelectingOption, state.isInteractingWithSelect, onOpenChange]);

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(() => ({
    ...state,
    setActiveTab,
    setIsSelectingOption,
    setIsInteractingWithSelect,
    handleDialogOpenChange,
    handlePointerDownOutside,
    handleInteractOutside,
    handleEscapeKeyDown,
  }), [
    state,
    setActiveTab,
    setIsSelectingOption,
    setIsInteractingWithSelect,
    handleDialogOpenChange,
    handlePointerDownOutside,
    handleInteractOutside,
    handleEscapeKeyDown,
  ]);
}