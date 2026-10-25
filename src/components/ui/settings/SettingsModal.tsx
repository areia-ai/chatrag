'use client';

import { lazy, Suspense, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Settings, Shield, X, Building2, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { useSettingsModal } from './hooks/useSettingsModal';
import { usePerformanceMonitor, usePerformanceObserver } from './hooks/usePerformanceMonitor';
import { useOrganizationStore } from '@/lib/stores/organization-store';
import { env } from '@/lib/env';
import styles from './styles/settings.module.css';
import './styles/select-overrides.css';

// Optimized lazy loading with preloading
const GeneralTab = lazy(() => import('./tabs/GeneralTab').then(m => ({ default: m.GeneralTab })));
const AdminTab = lazy(() => import('./tabs/AdminTab').then(m => ({ default: m.AdminTab })));
const WorkspaceTab = lazy(() => import('./tabs/WorkspaceTab').then(m => ({ default: m.WorkspaceTab })));

// Preload function for tabs
const preloadTabs = () => {
  // Use dynamic imports to preload tab components
  import('./tabs/GeneralTab');
  import('./tabs/AdminTab');
  import('./tabs/WorkspaceTab');
};

// Optimized Tab skeleton loader with memo
const TabSkeleton = memo(() => (
  <div className="space-y-6 animate-pulse">
    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
    <div className="space-y-4">
      <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
      <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
      <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
    </div>
  </div>
));
TabSkeleton.displayName = 'TabSkeleton';

interface SettingsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// Memoized tabs configuration
const getTabs = () => {
  const baseTabs = [
    { id: 'general', label: 'general', icon: Settings, Component: GeneralTab },
    { id: 'admin', label: 'admin', icon: Shield, Component: AdminTab },
  ];

  // Add workspace tab after admin if in multi-tenant mode
  // Use NEXT_PUBLIC_ version for client-side access
  const deploymentMode = env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE || env.CHATRAG_DEPLOYMENT_MODE || 'single-tenant';
  if (deploymentMode === 'multi-tenant') {
    baseTabs.push({ id: 'workspace', label: 'workspace', icon: Building2, Component: WorkspaceTab });
  }

  return baseTabs;
};

const tabs = getTabs();

export const SettingsModal = memo(function SettingsModal({ isOpen, onOpenChange }: SettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDarkMode = useMemo(() => theme === 'dark', [theme]);
  const { t } = useLanguage();
  const currentOrganization = useOrganizationStore(state => state.currentOrganization);

  // Enable performance monitoring in development
  const { trackInteraction } = usePerformanceMonitor(
    'SettingsModal',
    process.env.NODE_ENV === 'development'
  );
  usePerformanceObserver(process.env.NODE_ENV === 'development');

  // Preload tabs when modal opens
  useEffect(() => {
    if (isOpen) {
      preloadTabs();
    }
  }, [isOpen]);

  const {
    activeTab,
    isSelectingOption,
    isInteractingWithSelect,
    setActiveTab,
    handleDialogOpenChange,
    handlePointerDownOutside,
    handleInteractOutside,
    handleEscapeKeyDown,
  } = useSettingsModal(isOpen, onOpenChange);

  // Optimized tab component selection
  const TabComponent = useMemo(() => {
    const tab = tabs.find(t => t.id === activeTab);
    return tab?.Component || GeneralTab;
  }, [activeTab]);

  // Optimized tab change handler with requestAnimationFrame and performance tracking
  const handleTabChange = useCallback((tabId: string) => {
    const endTracking = trackInteraction(`tab-change-${tabId}`);
    requestAnimationFrame(() => {
      setActiveTab(tabId);
      endTracking?.();
    });
  }, [setActiveTab, trackInteraction]);

  // Memoize dialog classes with proper centering and safe-area support for mobile
  const dialogClasses = useMemo(() => cn(
    'fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] z-50',
    // Mobile: narrower width to prevent edge clipping, desktop: normal width
    'p-0 gap-0 max-w-3xl w-[92vw] lg:w-[90vw] bg-[#FFF1E5] dark:bg-[#212121]',
    'overflow-hidden',
    // Mobile: auto height that fits content, desktop: fixed height
    // Increased mobile max-height to 92vh to accommodate longer i18n translations
    'h-auto lg:h-[650px] max-h-[92vh] lg:max-h-[80vh]',
    'border shadow-lg rounded-lg',
    styles.settingsDialog,
    styles.accelerated
  ), []);

  // Memoize close button classes - absolute positioned on both mobile and desktop
  const closeButtonClasses = useMemo(() => cn(
    // Absolute positioned in top-right on both mobile and desktop
    'absolute right-3 top-3 lg:right-4 lg:top-4 rounded-full p-2',
    'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-100',
    'hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D]',
    'hover:text-white dark:hover:text-white',
    'shadow-md transition-all duration-200 focus:outline-none cursor-pointer',
    'z-[100] w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7',
    styles.closeButton
  ), []);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent
        ref={dialogRef}
        className={dialogClasses}
        onPointerDownOutside={handlePointerDownOutside}
        onInteractOutside={handleInteractOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
      >
        {/* Close button - absolute positioned on both mobile and desktop */}
        <DialogPrimitive.Close
          className={closeButtonClasses}
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
          <span className="sr-only">{t('closeSidebar')}</span>
        </DialogPrimitive.Close>

        <DialogTitle className="sr-only">{t('settings')}</DialogTitle>

        <div className="flex flex-col lg:flex-row h-full lg:h-[650px]">
          {/* Sidebar - reduced bottom padding on mobile for more content space */}
          <div className={cn('w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-[#FFE0D0] dark:border-[#2A2A2A] px-3 pt-10 pb-2 lg:p-4 flex-shrink-0', styles.sidebar)}>
            {/* Settings title - smaller margin on mobile */}
            <h2 className="text-lg lg:text-2xl font-bold mb-2 lg:mb-6 px-1 text-gray-800 dark:text-gray-100">{t('settings')}</h2>

            {/* Tab navigation - flex-wrap on mobile for i18n, column on desktop */}
            <nav className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0 lg:space-y-1">
              {tabs.map((tab) => {
                // Dynamic icon and label for workspace tab
                let Icon = tab.icon;
                let label = tab.label;

                if (tab.id === 'workspace') {
                  // Show workspace icon and label based on context
                  Icon = currentOrganization?.is_personal ? Briefcase : Building2;
                  label = currentOrganization?.is_personal ? 'personalProjects' : 'workspace';
                }

                return (
                  <button
                    key={tab.id}
                    className={cn(
                      // Mobile: flexible width with text wrapping
                      // Desktop: horizontal layout with full width
                      "flex items-center gap-2 lg:gap-3",
                      "px-3 py-2 lg:px-4 lg:py-3 rounded-xl",
                      "lg:text-left lg:w-full min-h-[40px] lg:min-h-[44px]",
                      // Allow flex item to grow/shrink on mobile
                      "flex-1 lg:flex-none min-w-0",
                      styles.tabButton,
                      activeTab === tab.id
                        ? "bg-[#FFE0D0] dark:bg-[#2A2A2A] text-gray-900 dark:text-white"
                        : "text-gray-700 dark:text-gray-300 hover:bg-[#FFE0D0] dark:hover:bg-[#2A2A2A]"
                    )}
                    onClick={() => handleTabChange(tab.id)}
                  >
                    <Icon className="h-4 w-4 lg:h-5 lg:w-5 flex-shrink-0" />
                    <span className="text-xs lg:text-sm font-medium lg:truncate break-words">{t(label)}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Optimized content area - reduced top padding on mobile */}
          <div className={cn('flex-1 pt-2 px-4 pb-4 lg:p-6 overflow-y-auto', styles.contentArea, styles.tabContent)}>
            <Suspense fallback={<TabSkeleton />}>
              <TabComponent />
            </Suspense>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';
