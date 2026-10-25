import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect } from 'react';
// Remove unused imports as API calls are handled internally
// import { isUserAdmin, getAdminSettings, updateAdminSettings } from './admin-utils';

interface AdminState {
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  
  // Actions
  checkAdminStatus: () => Promise<void>;
  logoutAdmin: () => Promise<void>; // Add logout action
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      isAdmin: false,
      isCheckingAdmin: false,
      
      // Check admin status on mount or when needed
      checkAdminStatus: async () => {
        set({ isCheckingAdmin: true });
        try {
          // Use server-side API instead of direct Supabase call
          const response = await fetch('/api/admin/check', {
            credentials: 'include', // Include cookies with the request
          });
          
          if (!response.ok) {
            console.error('Error checking admin status:', response.status);
            set({ isAdmin: false }); // Reset state on error
            return;
          }
          
          const data = await response.json();
          const isAdmin = data.isAdmin || false;
          
          set({ isAdmin });
          
          // We no longer need to fetch read-only dashboard settings as we use environment variable now
        } catch (error) {
          console.error('Error checking admin status:', error);
          set({ isAdmin: false }); // Reset state on error
        } finally {
          set({ isCheckingAdmin: false });
        }
      },
      
      // We've removed the toggleReadOnlyDocDashboard function as we now use environment variable
      
      // Logout admin user
      logoutAdmin: async () => {
        try {
          // Debug: Attempting admin logout
          const response = await fetch('/api/admin/logout', {
            method: 'POST',
            credentials: 'include',
          });
          
          if (!response.ok) {
            console.error('Admin logout failed:', response.status);
            // Optionally handle specific errors if needed
          } else {
            // Debug: Admin logout successful
          }
          
        } catch (error) {
          console.error('Error during admin logout:', error);
        } finally {
          // Always reset admin state regardless of API call success
          set({ 
            isAdmin: false,
            isCheckingAdmin: false // Reset checking state too
          });
          // Debug: Admin state reset after logout attempt
        }
      },
    }),
    {
      name: 'admin-storage',
      // Only persist non-sensitive state
      partialize: (state) => ({
        // Do not persist isAdmin status, always check on load
      }),
    }
  )
);

// Export a hook to use the admin store with auto-initialization
export function useAdmin() {
  // Select only the fields/actions we need to avoid changing reference on each render
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const isCheckingAdmin = useAdminStore((s) => s.isCheckingAdmin);
  const checkAdminStatus = useAdminStore((s) => s.checkAdminStatus);
  const logoutAdmin = useAdminStore((s) => s.logoutAdmin);

  // Intentionally run once on mount to prevent infinite refetch loops in dev/strict modes
  useEffect(() => {
    checkAdminStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  return { isAdmin, isCheckingAdmin, checkAdminStatus, logoutAdmin };
}
