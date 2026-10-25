'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle, CheckCircle2, Smartphone, Wifi, X, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useLanguage } from '@/components/providers/language-provider';

interface WhatsAppStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    sessionId: string;
    phoneNumber?: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
  };
  onDisconnect: () => Promise<void>;
}

export function WhatsAppStatusModal({
  isOpen,
  onClose,
  session,
  onDisconnect
}: WhatsAppStatusModalProps) {
  const { t } = useLanguage();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [actualStatus, setActualStatus] = useState<{
    status: string;
    isConnected: boolean;
    phoneNumber?: string;
    lastVerified?: Date;
  } | null>(null);

  const handleDisconnect = async () => {
    if (!showConfirmation) {
      setShowConfirmation(true);
      return;
    }

    setIsDisconnecting(true);
    try {
      await onDisconnect();
      onClose();
    } catch (error) {
      toast.error(t('whatsAppDisconnect'));
    } finally {
      setIsDisconnecting(false);
      setShowConfirmation(false);
    }
  };

  const formatPhoneNumber = (phone?: string) => {
    if (!phone) return t('whatsAppConnected');
    // Format phone number for better display
    if (phone.startsWith('pending_')) return t('whatsAppConnecting');
    return phone.replace(/(\d{1,3})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4');
  };

  // Verify actual connection status
  const verifyConnectionStatus = useCallback(async () => {
    setIsVerifying(true);
    try {
      const response = await fetch(`/api/whatsapp/status?sessionId=${session.sessionId}`);
      const data = await response.json();

      if (response.ok) {
        setActualStatus({
          status: data.status,
          isConnected: data.isConnected,
          phoneNumber: data.phoneNumber,
          lastVerified: new Date()
        });

        // If status changed to disconnected, show a warning
        if (!data.isConnected && session.status === 'connected') {
          toast.error(t('whatsAppConnectionLost') || 'WhatsApp connection lost. Please reconnect.');
        }
      } else {
        // If we can't verify, assume disconnected
        setActualStatus({
          status: 'disconnected',
          isConnected: false,
          lastVerified: new Date()
        });
      }
    } catch (error) {
      console.error('Failed to verify connection status:', error);
      // If verification fails, assume disconnected
      setActualStatus({
        status: 'disconnected',
        isConnected: false,
        lastVerified: new Date()
      });
    } finally {
      setIsVerifying(false);
    }
  }, [session.sessionId, session.status, t]);

  // Verify status when modal opens and set up auto-refresh
  useEffect(() => {
    if (isOpen) {
      verifyConnectionStatus();

      // Auto-refresh every 30 seconds while modal is open
      const interval = setInterval(verifyConnectionStatus, 30000);

      return () => clearInterval(interval);
    }
  }, [isOpen, session.sessionId, verifyConnectionStatus]);

  const getConnectionDuration = () => {
    // Use updatedAt for more accurate duration
    const timeRef = session.updatedAt || session.createdAt;
    if (!timeRef) return null;

    // If we've verified and it's disconnected, show last seen
    if (actualStatus && !actualStatus.isConnected) {
      return t('whatsAppLastSeen') || 'Last seen';
    }

    const connectedAt = new Date(timeRef);
    const now = new Date();
    const diffMs = now.getTime() - connectedAt.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} ${diffDays > 1 ? t('whatsAppDays') : t('whatsAppDay')}`;
    if (diffHours > 0) return `${diffHours} ${diffHours > 1 ? t('whatsAppHours') : t('whatsAppHour')}`;
    if (diffMins > 0) return `${diffMins} ${diffMins > 1 ? t('whatsAppMinutes') : t('whatsAppMinute')}`;
    return t('whatsAppJustNow');
  };

  // Determine the actual connection status to display
  const displayStatus = actualStatus || {
    status: session.status,
    isConnected: session.status === 'connected',
    phoneNumber: session.phoneNumber
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        {/* Custom close button matching document dashboard style */}
        <DialogPrimitive.Close 
          className="absolute right-4 top-4 rounded-full p-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer z-[100] w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7"
          onClick={onClose}
        >
          <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-500" />
            {t('whatsAppStatusTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('whatsAppStatusDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Icon - Changes based on actual connection */}
          <div className="flex items-center justify-center">
            {isVerifying ? (
              <RefreshCw className="h-16 w-16 text-gray-400 animate-spin" />
            ) : displayStatus.isConnected ? (
              <div className="relative">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <div className="absolute -bottom-1 -right-1 h-5 w-5 bg-green-500 rounded-full animate-pulse" />
              </div>
            ) : (
              <div className="relative">
                <AlertCircle className="h-16 w-16 text-yellow-500" />
                <div className="absolute -bottom-1 -right-1 h-5 w-5 bg-yellow-500 rounded-full" />
              </div>
            )}
          </div>

          {/* Refresh Button */}
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={verifyConnectionStatus}
              disabled={isVerifying}
              className="text-xs"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isVerifying ? 'animate-spin' : ''}`} />
              {isVerifying ? t('whatsAppVerifying') || 'Verifying...' : t('whatsAppRefreshStatus') || 'Refresh Status'}
            </Button>
          </div>

          {/* Connection Details */}
          <div className="space-y-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Smartphone className="h-4 w-4" />
                <span>{t('whatsAppPhoneNumber')}</span>
              </div>
              <span className="text-sm font-medium">
                {formatPhoneNumber(displayStatus.phoneNumber || session.phoneNumber)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Wifi className="h-4 w-4" />
                <span>{t('whatsAppStatus')}</span>
              </div>
              <span className={`text-sm font-medium ${
                displayStatus.isConnected ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                {displayStatus.isConnected ? t('whatsAppActive') || 'Active' : t('whatsAppDisconnected') || 'Disconnected'}
              </span>
            </div>

            {getConnectionDuration() && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('whatsAppConnectedFor')}
                </span>
                <span className="text-sm font-medium">
                  {getConnectionDuration()}
                </span>
              </div>
            )}
          </div>

          {/* Info Message - Changes based on status */}
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {displayStatus.isConnected
                ? t('whatsAppWorkingMessage') || 'Everything is working correctly. Messages sent to your WhatsApp will be processed by ChatRAG automatically.'
                : t('whatsAppReconnectMessage') || 'Connection lost. Please disconnect and reconnect WhatsApp to resume messaging.'}
            </p>
          </div>

          {/* Confirmation Message */}
          {showConfirmation && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                {t('whatsAppDisconnectWarning')}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant={showConfirmation ? "destructive" : "outline"}
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="w-full"
          >
            {isDisconnecting ? (
              <>{t('whatsAppDisconnecting')}</>
            ) : showConfirmation ? (
              <>{t('whatsAppConfirmDisconnect')}</>
            ) : (
              <>
                <X className="h-4 w-4 mr-2" />
                {t('whatsAppDisconnect')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
