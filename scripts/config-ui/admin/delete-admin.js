// scripts/delete-admin.js
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.local'
});

// Create Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, supabaseServiceKey);

async function deleteAllAdmins() {
  try {
    console.log('Checking admin_users table...');
    const { data: adminUsers, error: adminError } = await adminClient
      .from('admin_users')
      .select('*');
    
    if (adminError) {
      console.error('Error fetching admin users:', adminError);
      return;
    }
    
    if (!adminUsers || adminUsers.length === 0) {
      console.log('No admin users found to delete.');
    } else {
      console.log(`Found ${adminUsers.length} admin users to delete from admin_users table:`);
      adminUsers.forEach(admin => {
        console.log(`- Admin ID: ${admin.id}, Created at: ${admin.created_at}`);
      });
      
      // Delete all records from admin_users table
      console.log('\nDeleting all admin users from admin_users table...');
      const { error: deleteError } = await adminClient
        .from('admin_users')
        .delete()
        .gt('id', '00000000-0000-0000-0000-000000000000'); // Delete everything
      
      if (deleteError) {
        console.error('Error deleting admin users from table:', deleteError);
        return;
      }
      
      console.log('✅ Successfully deleted all admin users from admin_users table!');
    }
    
    // Reset admin settings to default
    console.log('\nResetting admin settings...');
    const { data: settings } = await adminClient
      .from('admin_settings')
      .select('id')
      .single();
      
    if (settings) {
      const { error: updateError } = await adminClient
        .from('admin_settings')
        .update({ read_only_doc_dashboard: false })
        .eq('id', settings.id);
        
      if (updateError) {
        console.error('Error resetting admin settings:', updateError);
      } else {
        console.log('✅ Admin settings reset to default values');
      }
    }
    
    // Now check for admin users in Auth system
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.log('No ADMIN_EMAIL found in environment variables. Skipping Auth user deletion.');
      return;
    }
    
    console.log(`\nLooking for user with email ${adminEmail} in Auth system...`);
    const { data: userData, error: userError } = await adminClient.auth.admin.listUsers();
    
    if (userError) {
      console.error('Error listing users:', userError);
      return;
    }
    
    const adminUser = userData.users.find(u => u.email === adminEmail);
    
    if (!adminUser) {
      console.log(`No user found with email ${adminEmail} in Auth system.`);
    } else {
      console.log(`Found user in Auth with email ${adminEmail}, ID: ${adminUser.id}`);
      
      // Delete the user from Auth
      console.log('Deleting user from Auth system...');
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(
        adminUser.id
      );
      
      if (authDeleteError) {
        console.error('Error deleting user from Auth:', authDeleteError);
      } else {
        console.log(`✅ Successfully deleted user ${adminEmail} from Auth system!`);
      }
    }
    
    console.log('\nAdmin cleanup completed. You can now run setup-admin.js again to create a new admin.');
    
  } catch (error) {
    console.error('Unexpected error during admin deletion:', error);
  }
}

// Run the function
deleteAllAdmins()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 