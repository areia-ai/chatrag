'use client';

import React, { useState, useEffect } from 'react';
import { MessageCircle, Loader2, Check, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { WhatsAppQRModal } from './whatsapp-qr-modal';
import { WhatsAppStatusModal } from './whatsapp-status-modal';
import { useLanguage } from '@/components/providers/language-provider';

interface WhatsAppSession {
  id: string;
  sessionId: string;
  status: string;
  phoneNumber?: string;
  isConnected: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function WhatsAppConnectionButton() {
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [isWhatsAppEnabled, setIsWhatsAppEnabled] = useState<boolean | null>(null);

  // Function to fetch WhatsApp config
  const fetchWhatsAppConfig = async () => {
    try {
      const response = await fetch('/api/config/get-env?var=NEXT_PUBLIC_WHATSAPP_ENABLED');
      if (response.ok) {
        const data = await response.json();
        // Handle empty or undefined values by defaulting to false
        const enabled = data.value === 'true' ? true : false;
        setIsWhatsAppEnabled(enabled);
        localStorage.setItem('WHATSAPP_ENABLED', enabled ? 'true' : 'false');
      } else {
        // If we can't fetch, default to false
        setIsWhatsAppEnabled(false);
      }
    } catch (error) {
      console.error('Error fetching WhatsApp config:', error);
      // Fall back to false if we can't fetch the config
      setIsWhatsAppEnabled(false);
    }
  };

  // Dynamically fetch WhatsApp enabled status on mount
  useEffect(() => {
    // Load from localStorage first for quick initial render
    const savedEnabled = localStorage.getItem('WHATSAPP_ENABLED');
    if (savedEnabled !== null) {
      setIsWhatsAppEnabled(savedEnabled === 'true');
    }

    // Then fetch latest from server
    fetchWhatsAppConfig();
  }, []);

  // Poll for config changes every 5 seconds to catch updates from config UI
  useEffect(() => {
    const interval = setInterval(() => {
      fetchWhatsAppConfig();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Listen for custom event when config is saved
  useEffect(() => {
    const handleConfigChange = () => {
      fetchWhatsAppConfig();
    };

    window.addEventListener('whatsapp-config-changed', handleConfigChange);
    window.addEventListener('config-saved', handleConfigChange); // Also listen for general config saves

    return () => {
      window.removeEventListener('whatsapp-config-changed', handleConfigChange);
      window.removeEventListener('config-saved', handleConfigChange);
    };
  }, []);

  // Check session status on mount and clean up stale sessions
  useEffect(() => {
    // Only check sessions if WhatsApp is enabled
    if (isWhatsAppEnabled) {
      cleanupStaleSessions();
      checkSessionStatus();
    }
  }, [isWhatsAppEnabled]);

  // Poll for actual connection status every 10 seconds to match the aggressive monitoring
  // Only poll when session is connected or pending, not when disconnected
  useEffect(() => {
    if (!isWhatsAppEnabled || !session) return;

    // Stop polling if session is disconnected
    if (session.status === 'disconnected') return;

    const checkRealStatus = async () => {
      try {
        const response = await fetch(`/api/whatsapp/status?sessionId=${session.sessionId}`);
        if (response.ok) {
          const data = await response.json();
          // Update local session state with real status
          setSession(prev => prev ? {
            ...prev,
            status: data.isConnected ? 'connected' : 'disconnected',
            isConnected: data.isConnected,
            phoneNumber: data.phoneNumber || prev.phoneNumber
          } : null);
        }
      } catch (error) {
        console.error('Failed to check real WhatsApp status:', error);
        // If we can't verify, assume disconnected
        setSession(prev => prev ? {
          ...prev,
          status: 'disconnected',
          isConnected: false
        } : null);
      }
    };

    // Initial check
    checkRealStatus();

    // Check every 10 seconds (matching the connection monitor interval)
    const interval = setInterval(checkRealStatus, 10000);

    return () => clearInterval(interval);
  }, [isWhatsAppEnabled, session]);

  const cleanupStaleSessions = async () => {
    try {
      // Get all sessions
      const response = await fetch('/api/whatsapp/status');
      if (response.ok) {
        const data = await response.json();
        if (data.sessions && data.sessions.length > 0) {
          // Check for stale sessions
          const now = new Date();
          for (const session of data.sessions) {
            if (session.status === 'qr_pending') {
              const updatedAt = new Date(session.updatedAt);
              const diffMinutes = (now.getTime() - updatedAt.getTime()) / (1000 * 60);
              
              // If QR pending for more than 5 minutes, it's stale
              if (diffMinutes > 5) {
                // Disconnect stale session
                await fetch('/api/whatsapp/disconnect', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: session.sessionId })
                });
              }
            }
          }
        }
      }
    } catch (error) {
      // Silent cleanup, don't show errors to user
      console.error('Session cleanup failed:', error);
    }
  };

  const checkSessionStatus = async () => {
    try {
      const response = await fetch('/api/whatsapp/status');
      if (response.ok) {
        const data = await response.json();
        if (data.sessions && data.sessions.length > 0) {
          // Get the first active session
          const activeSession = data.sessions.find((s: WhatsAppSession) => 
            s.status === 'connected' || s.status === 'qr_pending'
          );
          if (activeSession) {
            setSession(activeSession);
            // Don't auto-open the modal - let the user click the button
            // if (activeSession.status === 'qr_pending') {
            //   setShowQRModal(true);
            // }
          }
        }
      }
    } catch (error) {
      console.error('Failed to check WhatsApp status:', error);
    }
  };

  const handleConnect = async () => {
    // If there's already a session with QR pending, just show the modal
    if (session && session.status === 'qr_pending') {
      setShowQRModal(true);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        // If session exists, that's OK - use it
        if (response.status === 409 && data.session) {
          setSession(data.session);
          if (data.session.status === 'qr_pending') {
            setShowQRModal(true);
            toast.info('Using existing WhatsApp session. Please scan the QR code.');
          } else if (data.session.status === 'connected') {
            toast.success(`WhatsApp already connected to ${data.session.phoneNumber}`);
          }
          return;
        }
        throw new Error(data.error || 'Failed to initiate WhatsApp connection');
      }

      setSession(data.session);
      setShowQRModal(true);
      toast.success('WhatsApp connection initiated. Please scan the QR code.');
    } catch (error: any) {
      toast.error(error.message || 'Failed to connect WhatsApp');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!session) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId: session.sessionId })
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect WhatsApp');
      }

      setSession(null);
      setShowStatusModal(false);
      toast.success('WhatsApp disconnected successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to disconnect WhatsApp');
      throw error; // Re-throw so the modal can handle it
    } finally {
      setIsLoading(false);
    }
  };

  const handleQRModalClose = () => {
    setShowQRModal(false);
    // Refresh session status
    checkSessionStatus();
  };

  const handleConnectionSuccess = (phoneNumber: string) => {
    setShowQRModal(false);
    setSession(prev => prev ? {
      ...prev,
      status: 'connected',
      phoneNumber,
      isConnected: true
    } : null);
    toast.success(`WhatsApp connected successfully to ${phoneNumber}`);
  };

  const isConnected = session?.status === 'connected';
  const isPending = session?.status === 'qr_pending';
  const isDisconnected = session?.status === 'disconnected';

  const getButtonText = () => {
    if (isLoading) return 'Checking...';
    if (isDisconnected) return 'Disconnected';
    if (isConnected) return 'WhatsApp';
    if (isPending) return 'Scan QR';
    return 'Connect WhatsApp';
  };

  const getButtonIcon = () => {
    if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
    if (isDisconnected) return <X className="h-4 w-4 text-red-500" />;
    if (isConnected) return <Check className="h-4 w-4 text-green-500" />;
    if (isPending) return <MessageCircle className="h-4 w-4 text-yellow-500 animate-pulse" />;
    return <MessageCircle className="h-4 w-4" />;
  };

  const getButtonStyle = () => {
    const baseStyle = "inline-flex items-center gap-2 h-10 px-3 rounded-lg border transition-colors backdrop-blur-md disabled:pointer-events-none disabled:opacity-50";

    if (isDisconnected) {
      return `${baseStyle} border-red-500/50 dark:border-red-500/50 bg-red-50/50 dark:bg-red-950/30 hover:bg-red-100/70 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400`;
    }
    if (isConnected) {
      return `${baseStyle} border-green-500/50 dark:border-green-500/50 bg-green-50/50 dark:bg-green-950/30 hover:bg-green-100/70 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400`;
    }
    if (isPending) {
      return `${baseStyle} border-yellow-500/50 dark:border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/30 hover:bg-yellow-100/70 dark:hover:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400`;
    }
    // Default (not connected)
    return `${baseStyle} border-[#FFE0D0] dark:border-[#2F2F2F] bg-transparent dark:bg-transparent hover:bg-[#FFE0D0] dark:hover:bg-[#424242] text-gray-700 dark:text-gray-200`;
  };

  // Don't render if WhatsApp is not enabled or we're still loading the config
  if (isWhatsAppEnabled === null || !isWhatsAppEnabled) {
    return null;
  }

  return (
    <>
      <button
        onClick={isConnected || isDisconnected ? () => setShowStatusModal(true) : handleConnect}
        disabled={isLoading}
        className={getButtonStyle()}
      >
        {getButtonIcon()}
        <span className="text-sm font-medium">{getButtonText()}</span>
      </button>

      {showQRModal && session && (
        <WhatsAppQRModal
          isOpen={showQRModal}
          onClose={handleQRModalClose}
          sessionId={session.sessionId}
          onSuccess={handleConnectionSuccess}
        />
      )}

      {showStatusModal && session && (isConnected || isDisconnected) && (
        <WhatsAppStatusModal
          isOpen={showStatusModal}
          onClose={() => setShowStatusModal(false)}
          session={session}
          onDisconnect={handleDisconnect}
        />
      )}
    </>
  );
}
