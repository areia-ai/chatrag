import { supabase, supabaseAdmin } from './supabase';

/**
 * Check if the current user has admin privileges by checking with the server
 * This is more secure than client-side verification alone
 * @returns Promise resolving to a boolean indicating admin status
 */
export async function isUserAdmin(): Promise<boolean> {
  try {
    console.log("Checking admin status...");
    
    // Call the server API for admin status verification
    const response = await fetch('/api/admin/status', {
      credentials: 'include', // Important! Include cookies with the request
    });
    
    console.log("Admin status response status:", response.status);
    
    if (!response.ok) {
      console.error("Admin status check failed:", response.status, response.statusText);
      throw new Error('Failed to verify admin status');
    }
    
    const data = await response.json();
    console.log("Admin status check result:", data);
    
    return !!data.isAdmin;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Get admin settings from the server
 * @returns Admin settings object
 */
export async function getAdminSettings() {
  try {
    // Call the server API for admin settings
    const response = await fetch('/api/admin/status', {
      credentials: 'include', // Important! Include cookies with the request
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch admin settings');
    }
    
    const { settings } = await response.json();
    return settings || { read_only_doc_dashboard: false };
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    return { read_only_doc_dashboard: false };
  }
}

/**
 * Update admin settings in the database
 * @param settings Settings object with updated values
 * @returns Updated settings data
 */
export async function updateAdminSettings(settings: { 
  id?: string,
  read_only_doc_dashboard: boolean 
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    
    const { data: existingSettings } = await supabase
      .from('admin_settings')
      .select('id')
      .single();
    
    const id = settings.id || existingSettings?.id;
    
    if (!id) {
      // If no settings record exists yet, create one
      const { data, error } = await supabase
        .from('admin_settings')
        .insert({
          read_only_doc_dashboard: settings.read_only_doc_dashboard,
          updated_by: session.user.id
        })
        .select()
        .single();
        
      if (error) throw error;
      return data;
    }
    
    // Update existing settings
    const { data, error } = await supabase
      .from('admin_settings')
      .update({
        read_only_doc_dashboard: settings.read_only_doc_dashboard,
        updated_at: new Date().toISOString(),
        updated_by: session.user.id
      })
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating admin settings:', error);
    throw error;
  }
}

/**
 * Initialize the first admin user (for use during app setup)
 * This function is intended to be used server-side only
 * @param email Admin user email
 * @param password Admin user password
 * @returns Created user object
 */
export async function initializeFirstAdmin(email: string, password: string) {
  // This should only be called server-side during setup
  if (typeof window !== 'undefined' || !supabaseAdmin) {
    throw new Error('Admin initialization can only be called server-side');
  }
  
  try {
    // Check if any admin users already exist
    const { count, error: countError } = await supabaseAdmin
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
      
    if (countError) throw countError;
    
    if (count && count > 0) {
      throw new Error('Admin users already exist - cannot initialize first admin');
    }
    
    // Create user with Supabase auth
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    
    if (userError) throw userError;
    
    // Add user to admin_users table
    const { error: adminError } = await supabaseAdmin
      .from('admin_users')
      .insert({ 
        id: userData.user.id,
        created_by: userData.user.id
      });
      
    if (adminError) throw adminError;
    
    // Initialize admin settings if not already present
    const { data: existingSettings } = await supabaseAdmin
      .from('admin_settings')
      .select('id')
      .single();
      
    if (!existingSettings) {
      const { error: settingsError } = await supabaseAdmin
        .from('admin_settings')
        .insert({
          read_only_doc_dashboard: false,
          updated_by: userData.user.id
        });
        
      if (settingsError) throw settingsError;
    }
    
    return userData.user;
  } catch (error) {
    console.error('Error initializing admin:', error);
    throw error;
  }
}

/**
 * Add a new admin user (can only be done by existing admins)
 * @param userId User ID to promote to admin
 * @returns Success status
 */
export async function addAdminUser(userId: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    
    // Check if current user is admin
    const isAdmin = await isUserAdmin();
    if (!isAdmin) {
      throw new Error('Only existing admins can add new admins');
    }
    
    // Add user to admin_users table
    const { error } = await supabase
      .from('admin_users')
      .insert({ 
        id: userId,
        created_by: session.user.id
      });
      
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error adding admin user:', error);
    return false;
  }
}

/**
 * Remove admin privileges from a user
 * @param userId User ID to remove admin status from
 * @returns Success status
 */
export async function removeAdminUser(userId: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    
    // Check if current user is admin
    const isAdmin = await isUserAdmin();
    if (!isAdmin) {
      throw new Error('Only existing admins can remove admin privileges');
    }
    
    // Don't allow removing yourself
    if (userId === session.user.id) {
      throw new Error('Cannot remove your own admin privileges');
    }
    
    // Remove user from admin_users table
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', userId);
      
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error removing admin user:', error);
    return false;
  }
} 