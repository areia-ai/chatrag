'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { Sidebar } from '@/components/ui/sidebar';

interface SidebarWrapperProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
}

export function SidebarWrapper({ isSidebarOpen, setIsSidebarOpen }: SidebarWrapperProps) {
  const { user, signOut } = useAuth();

  return (
    <Sidebar 
      isOpen={isSidebarOpen}
      onClose={() => setIsSidebarOpen(false)}
      userEmail={user?.email}
      onSignOut={signOut}
    />
  );
} 