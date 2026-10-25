'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Smartphone, MessageCircle, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import QRCode from 'react-qr-code';
import { useLanguage } from '@/components/providers/language-provider';

interface WhatsAppQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onSuccess: (phoneNumber: string) => void;
}

export function WhatsAppQRModal({
  isOpen,
  onClose,
  sessionId,
  onSuccess
}: WhatsAppQRModalProps) {
  const { t } = useLanguage();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const fetchQRCode = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/whatsapp/qr?sessionId=${sessionId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('whatsAppFailedLoad'));
      }

      setQrCode(data.qrCode);
      if (data.expiresAt) {
        // Handle both string and Date formats
        const expiration = typeof data.expiresAt === 'string'
          ? new Date(data.expiresAt)
          : data.expiresAt;
        setExpiresAt(expiration);
      } else {
        // Default to 5 minutes from now if no expiration provided
        const defaultExpiration = new Date();
        defaultExpiration.setMinutes(defaultExpiration.getMinutes() + 5);
        setExpiresAt(defaultExpiration);
      }
    } catch (error: any) {
      toast.error(error.message || t('whatsAppFailedLoad'));
      onClose();
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, t, onClose]);

  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/whatsapp/status?sessionId=${sessionId}`);
      const data = await response.json();

      if (response.ok && data.status === 'connected') {
        onSuccess(data.phoneNumber || 'Connected');
      }
    } catch (error) {
      console.error('Failed to check status:', error);
    }
  }, [sessionId, onSuccess]);

  useEffect(() => {
    if (isOpen && sessionId) {
      fetchQRCode();
      const interval = setInterval(checkStatus, 3000); // Check every 3 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen, sessionId, fetchQRCode, checkStatus]);

  useEffect(() => {
    if (expiresAt) {
      const timer = setInterval(() => {
        const now = new Date();
        const diff = expiresAt.getTime() - now.getTime();
        setTimeLeft(Math.max(0, Math.floor(diff / 1000)));

        if (diff <= 0) {
          toast.error(t('whatsAppFailedLoad'));
          clearInterval(timer);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [expiresAt, t]);

  const handleRefresh = () => {
    fetchQRCode();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        {/* Custom close button matching document dashboard style */}
        <DialogPrimitive.Close
          className="absolute left-auto right-4 top-4 rounded-full p-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer z-10 w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7"
          onClick={onClose}
          style={{
            position: 'absolute',
            left: 'auto',
            right: '1rem',
            top: '1rem'
          }}
        >
          <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            {t('whatsAppModalTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('whatsAppModalDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 w-64">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : qrCode ? (
            <>
              <div className="bg-white p-4 rounded-lg">
                <QRCode value={qrCode} size={256} />
              </div>
              
              {timeLeft > 0 && (
                <p className="text-sm text-gray-500">
                  {t('whatsAppExpiresIn').replace('{time}', formatTime(timeLeft))}
                </p>
              )}

              <div className="flex flex-col gap-2 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  <span>{t('whatsAppInstructions1')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ml-6">{t('whatsAppInstructions2')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ml-6">{t('whatsAppInstructions3')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ml-6">{t('whatsAppInstructions4')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ml-6">{t('whatsAppInstructions5')}</span>
                </div>
              </div>

              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                {t('whatsAppRefreshQR')}
              </Button>
            </>
          ) : (
            <div className="text-center">
              <p className="text-red-500 mb-4">{t('whatsAppFailedLoad')}</p>
              <Button onClick={handleRefresh}>
                {t('whatsAppTryAgain')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
