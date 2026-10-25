// scripts/list-admin-emails.js
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

async function listAdminEmails() {
  try {
    console.log('Fetching admin users with emails...');
    
    // Get all admin users from admin_users table
    const { data: adminUsers, error: adminError } = await adminClient
      .from('admin_users')
      .select('id');
    
    if (adminError) {
      console.error('Error fetching admin users:', adminError);
      return [];
    }
    
    // No admin users found
    if (!adminUsers || adminUsers.length === 0) {
      console.log('No admin users found in admin_users table.');
      return [];
    }
    
    console.log(`Found ${adminUsers.length} admin users in admin_users table.`);
    
    // Get user details from auth.users table
    const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers();
    
    if (authError) {
      console.error('Error fetching auth users:', authError);
      return [];
    }
    
    // Map admin users to their email addresses
    const adminIdsSet = new Set(adminUsers.map(admin => admin.id));
    const adminDetailsArray = authUsers.users
      .filter(user => adminIdsSet.has(user.id))
      .map(user => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at
      }));
    
    // Display the results
    console.log('\nAdmin Users with Emails:');
    if (adminDetailsArray.length === 0) {
      console.log('No matching users found in auth system.');
    } else {
      adminDetailsArray.forEach(admin => {
        console.log(`- Email: ${admin.email}, ID: ${admin.id}, Created: ${admin.created_at}`);
      });
    }
    
    // Return the admin details
    return adminDetailsArray;
    
  } catch (error) {
    console.error('Unexpected error listing admin emails:', error);
    return [];
  }
}

// If this script is run directly (not imported)
if (require.main === module) {
  listAdminEmails()
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export for use in other modules
module.exports = listAdminEmails; 