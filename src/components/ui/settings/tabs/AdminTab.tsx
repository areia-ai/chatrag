'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, LogOut } from 'lucide-react';
import { useAdminStore } from '@/lib/admin-store';
import { useLanguage } from '@/components/providers/language-provider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Custom comparison function for memo optimization
const areEqual = (prevProps: any, nextProps: any) => {
  // Since AdminTab has no props, always return true to prevent re-renders
  return true;
};

export const AdminTab = memo(function AdminTab() {
  const {
    isAdmin,
    isCheckingAdmin,
    checkAdminStatus,
    logoutAdmin
  } = useAdminStore();

  const [adminError, setAdminError] = useState('');
  const [isAdminVerifying, setIsAdminVerifying] = useState(false);
  const [adminVerificationSuccess, setAdminVerificationSuccess] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { t } = useLanguage();

  // Check admin status when component mounts
  useEffect(() => {
    checkAdminStatus();
  }, [checkAdminStatus]);

  // Reset form when admin status changes
  useEffect(() => {
    setAdminError('');
    setAdminVerificationSuccess(false);
  }, [isAdmin]);

  // Handle admin verification
  const handleAdminVerification = useCallback(async () => {
    setIsAdminVerifying(true);
    setAdminError('');

    try {
      // Use our server API endpoint to get user profile
      const response = await fetch('/api/user/profile', {
        method: 'GET',
        credentials: 'include',
      });

      const profileData = await response.json();

      if (!response.ok || !profileData.authenticated) {
        setAdminError(t('loginRequired'));
        setIsAdminVerifying(false);
        return;
      }

      const userEmail = profileData.user.email;
      const userId = profileData.user.id;

      if (!userEmail || !userId) {
        setAdminError(t('loginRequired'));
        setIsAdminVerifying(false);
        return;
      }

      // Call admin verification API with email and userId (no password needed)
      const loginResponse = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          userId: userId
        }),
        credentials: 'include',
      });

      const data = await loginResponse.json();

      if (!loginResponse.ok) {
        const error = data.error || {};

        if (error.message === 'Not authorized as admin') {
          setAdminError(t('notAuthorizedAsAdmin'));
        } else if (error.message === 'You must be logged in') {
          setAdminError(t('loginRequired'));
        } else {
          setAdminError(error.message || t('adminVerificationFailed'));
        }
        return;
      }

      if (data?.success) {
        setAdminVerificationSuccess(true);
        // Refresh admin status
        await checkAdminStatus();
      } else {
        setAdminError(t('adminVerificationFailed'));
      }
    } catch (error) {
      console.error("Admin verification error:", error);
      setAdminError(t('adminVerificationFailed'));
    } finally {
      requestAnimationFrame(() => setIsAdminVerifying(false));
    }
  }, [t, checkAdminStatus]);

  // Optimized admin logout handler
  const handleAdminLogout = useCallback(async () => {
    requestAnimationFrame(() => setIsLoggingOut(true));
    try {
      await logoutAdmin();
    } catch (error) {
      console.error("Error during admin logout:", error);
    } finally {
      requestAnimationFrame(() => setIsLoggingOut(false));
    }
  }, [logoutAdmin]);

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Hide heading on mobile since tab is already highlighted */}
      <h3 className="hidden sm:block text-xl font-semibold text-gray-900 dark:text-white">{t('admin')}</h3>

      <div className="space-y-3 sm:space-y-6">
        {!isAdmin ? (
          <div className="bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-5 border border-[#FFE0D0] dark:border-[#2A2A2A]">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
              <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('adminVerification')}</h4>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('adminVerificationDesc')}
              </p>

              {adminError && (
                <p className="text-sm text-red-600 dark:text-red-400">{adminError}</p>
              )}

              {adminVerificationSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">{t('adminVerificationSuccess')}</p>
              )}

              <Button
                onClick={handleAdminVerification}
                className="w-full bg-[#FF6417] hover:bg-[#E05A15] text-white dark:bg-[#FF8A4D] dark:hover:bg-[#E05A15] dark:text-white font-medium rounded-lg whitespace-normal text-center py-3"
                disabled={isAdminVerifying}
              >
                {isAdminVerifying ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-r-transparent rounded-full animate-spin mr-2 flex-shrink-0"></div>
                    <span>{t('verifying')}</span>
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="break-words">{t('activateAdminAccess')}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-6 mb-4 border-b border-[#FFE0D0] dark:border-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[#FF6417] dark:text-[#FF8A4D]" />
                <div>
                  <h4 className="text-base font-medium text-gray-900 dark:text-white">{t('adminAuthenticated')}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('adminAuthenticatedDesc')}</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleAdminLogout}
                disabled={isLoggingOut}
                className="text-red-600 dark:text-red-400 border-red-400 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 hover:border-red-600 dark:hover:border-red-500 flex items-center gap-2"
              >
                {isLoggingOut ? (
                  <div className="h-4 w-4 border-2 border-current border-r-transparent rounded-full animate-spin mr-2"></div>
                ) : (
                  <LogOut className="h-4 w-4 mr-2" />
                )}
                <span className="text-xs font-medium">
                  {isLoggingOut ? t('loggingOut') : t('logoutAdmin')}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, areEqual);

AdminTab.displayName = 'AdminTab';