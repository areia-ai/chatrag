import { useReducer, useCallback, useEffect, useRef } from 'react';

interface MCPTool {
  name: string;
  description: string;
  server: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

interface MCPToolsModalState {
  tools: MCPTool[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  searchTerm: string;
  isClosing: boolean;
}

type MCPToolsModalAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: { tools: MCPTool[]; timestamp: Date } }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_CLOSING'; payload: boolean }
  | { type: 'RESET_STATE' };

// Optimized reducer with shallow equality checks
const mcpToolsReducer = (state: MCPToolsModalState, action: MCPToolsModalAction): MCPToolsModalState => {
  switch (action.type) {
    case 'FETCH_START':
      if (state.loading) return state; // Prevent duplicate fetch
      return { ...state, loading: true, error: null };
    
    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        tools: action.payload.tools,
        lastUpdated: action.payload.timestamp,
        error: null
      };
    
    case 'FETCH_ERROR':
      return {
        ...state,
        loading: false,
        error: action.payload,
        tools: state.tools // Keep existing tools on error
      };
    
    case 'SET_SEARCH':
      if (state.searchTerm === action.payload) return state;
      return { ...state, searchTerm: action.payload };
    
    case 'SET_CLOSING':
      if (state.isClosing === action.payload) return state;
      return { ...state, isClosing: action.payload };
    
    case 'RESET_STATE':
      return {
        ...state,
        searchTerm: '',
        isClosing: false,
        error: null
      };
    
    default:
      return state;
  }
};

const initialState: MCPToolsModalState = {
  tools: [],
  loading: false,
  error: null,
  lastUpdated: null,
  searchTerm: '',
  isClosing: false
};

// Simple but effective caching
interface ToolsCache {
  data: MCPTool[] | null;
  timestamp: number;
  TTL: number;
}

export function useMCPToolsModal(isOpen: boolean, onClose: () => void) {
  const [state, dispatch] = useReducer(mcpToolsReducer, initialState);
  const closeTimeoutRef = useRef<NodeJS.Timeout>();
  
  // Cache with 5 minute TTL
  const toolsCache = useRef<ToolsCache>({
    data: null,
    timestamp: 0,
    TTL: 5 * 60 * 1000
  });

  // Request deduplication
  const fetchPromiseRef = useRef<Promise<void> | null>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      const frame = requestAnimationFrame(() => {
        dispatch({ type: 'RESET_STATE' });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isOpen]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // Fetch tools with caching and deduplication
  const fetchTools = useCallback(async (forceRefresh = false) => {
    // Check cache first (unless force refresh)
    if (!forceRefresh && toolsCache.current.data && 
        Date.now() - toolsCache.current.timestamp < toolsCache.current.TTL) {
      dispatch({ 
        type: 'FETCH_SUCCESS', 
        payload: { 
          tools: toolsCache.current.data, 
          timestamp: new Date(toolsCache.current.timestamp) 
        }
      });
      return;
    }

    // Prevent duplicate requests
    if (fetchPromiseRef.current) {
      return fetchPromiseRef.current;
    }

    const fetchPromise = (async () => {
      dispatch({ type: 'FETCH_START' });
      
      try {
        const response = await fetch('/api/mcp/tools');
        if (!response.ok) {
          throw new Error(`Failed to fetch tools: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Handle the grouped format from API
        if (data && data.success && data.toolsByServer) {
          const allTools: MCPTool[] = [];
          
          for (const [serverName, serverTools] of Object.entries(data.toolsByServer)) {
            if (Array.isArray(serverTools)) {
              serverTools.forEach((tool: any) => {
                allTools.push({
                  name: tool.name,
                  description: tool.description,
                  server: serverName,
                  requiresApproval: tool.requiresApproval ?? true,
                  enabled: tool.enabled ?? true
                });
              });
            }
          }
          
          // Update cache
          toolsCache.current = {
            data: allTools,
            timestamp: Date.now(),
            TTL: toolsCache.current.TTL
          };
          
          dispatch({ 
            type: 'FETCH_SUCCESS', 
            payload: { tools: allTools, timestamp: new Date() }
          });
          
          // Show server connection info if available
          if (data.metadata?.servers) {
            const connectedServers = data.metadata.servers.filter((s: any) => s.connected).length;
            const totalServers = data.metadata.servers.length;
            
            if (connectedServers < totalServers) {
              dispatch({ 
                type: 'FETCH_ERROR', 
                payload: `Connected to ${connectedServers}/${totalServers} MCP servers. Some servers may be temporarily unavailable.`
              });
            }
          }
        } else if (data && !data.success) {
          // Handle error response
          dispatch({ 
            type: 'FETCH_ERROR', 
            payload: data?.error?.message || 'No MCP tools are currently available. Please check your MCP server configuration.'
          });
        } else {
          // Unexpected response format
          console.error('Unexpected API response format:', data);
          dispatch({ 
            type: 'FETCH_ERROR', 
            payload: 'Unexpected response format from MCP tools API'
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch tools';
        console.error('Error fetching MCP tools:', err);
        dispatch({ type: 'FETCH_ERROR', payload: errorMessage });
      } finally {
        fetchPromiseRef.current = null;
      }
    })();

    fetchPromiseRef.current = fetchPromise;
    return fetchPromise;
  }, []);

  // Handle dialog close with proper cleanup
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open && !state.isClosing) {
      dispatch({ type: 'SET_CLOSING', payload: true });
      
      // Small delay for animation
      closeTimeoutRef.current = setTimeout(() => {
        onClose();
        dispatch({ type: 'SET_CLOSING', payload: false });
      }, 200);
    }
  }, [onClose, state.isClosing]);

  // Search handler
  const setSearchTerm = useCallback((term: string) => {
    dispatch({ type: 'SET_SEARCH', payload: term });
  }, []);

  // Filter tools based on search
  const filteredTools = state.searchTerm
    ? state.tools.filter(tool => 
        tool.name.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
        tool.description.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
        tool.server.toLowerCase().includes(state.searchTerm.toLowerCase())
      )
    : state.tools;

  // Group tools by server
  const toolsByServer = filteredTools.reduce((acc, tool) => {
    if (!acc[tool.server]) {
      acc[tool.server] = [];
    }
    acc[tool.server].push(tool);
    return acc;
  }, {} as Record<string, MCPTool[]>);

  return {
    ...state,
    filteredTools,
    toolsByServer,
    fetchTools,
    setSearchTerm,
    handleDialogOpenChange,
  };
}