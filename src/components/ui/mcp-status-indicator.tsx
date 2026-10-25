'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ServerOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface McpStatusIndicatorProps {
  className?: string;
  showText?: boolean;
}

/**
 * A component that displays the current status of the MCP server connection
 */
export function McpStatusIndicator({ className, showText = true }: McpStatusIndicatorProps) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState<string>('Checking MCP connection...');
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    
    async function checkMcpStatus() {
      try {
        const response = await fetch('/api/mcp/health');
        
        if (!isMounted) return;
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.mcpAvailable) {
            setStatus('connected');
            setStatusMessage('MCP server connected');
          } else {
            setStatus('error');
            setStatusMessage(data.error || 'MCP server unavailable');
            // Show error only when there's an actual error
            setIsVisible(true);
          }
        } else {
          setStatus('error');
          setStatusMessage('Error checking MCP status');
          setIsVisible(true);
        }
      } catch (error) {
        if (!isMounted) return;
        
        setStatus('error');
        setStatusMessage('Error connecting to MCP server');
        setIsVisible(true);
      }
    }
    
    checkMcpStatus();
    
    // Check MCP status periodically
    const interval = setInterval(checkMcpStatus, 60000); // every minute
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);
  
  // Don't render anything if connected (to reduce UI clutter)
  if (status === 'connected' && !isVisible) {
    return null;
  }

  return (
    <div 
      className={cn(
        "flex items-center gap-2 text-sm px-3 py-1.5 rounded-md",
        status === 'loading' && "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
        status === 'connected' && "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300",
        status === 'error' && "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300",
        className
      )}
    >
      {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
      {status === 'connected' && <CheckCircle2 className="h-4 w-4" />}
      {status === 'error' && <AlertCircle className="h-4 w-4" />}
      
      {showText && (
        <span className="text-xs">{statusMessage}</span>
      )}
      
      {status === 'error' && (
        <button 
          onClick={() => setIsVisible(false)}
          className="ml-auto text-xs opacity-70 hover:opacity-100"
        >
          Dismiss
        </button>
      )}
    </div>
  );
} 