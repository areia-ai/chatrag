// scripts/check-admin.js
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

async function checkAdminSetup() {
  try {
    console.log('Checking admin_users table...');
    const { data: adminUsers, error: adminError } = await adminClient
      .from('admin_users')
      .select('*');
    
    if (adminError) {
      console.error('Error fetching admin users:', adminError);
    } else {
      console.log(`Found ${adminUsers.length} admins:`);
      adminUsers.forEach(admin => {
        console.log(`- Admin ID: ${admin.id}, Created at: ${admin.created_at}`);
      });
    }
    
    console.log('\nChecking admin_settings table...');
    const { data: settings, error: settingsError } = await adminClient
      .from('admin_settings')
      .select('*');
    
    if (settingsError) {
      console.error('Error fetching admin settings:', settingsError);
    } else {
      console.log('Admin settings:');
      console.log(settings);
    }
    
    // Check for the new function
    console.log('\nChecking if check_admin_status function exists...');
    const { data: funcData, error: funcError } = await adminClient.rpc(
      'check_admin_status'
    );
    
    if (funcError) {
      console.error('Error testing check_admin_status function:', funcError);
      console.log('The function might not exist or cannot be called directly');
    } else {
      console.log('check_admin_status function exists and returned:', funcData);
    }
    
    // Check is_admin function
    console.log('\nChecking if is_admin function works properly...');
    // Get an admin ID to test with
    if (adminUsers && adminUsers.length > 0) {
      const adminId = adminUsers[0].id;
      const { data: isAdminData, error: isAdminError } = await adminClient.rpc(
        'is_admin',
        { user_uuid: adminId }
      );
      
      if (isAdminError) {
        console.error('Error testing is_admin function:', isAdminError);
      } else {
        console.log(`is_admin function correctly identified admin user: ${isAdminData}`);
      }
    } else {
      console.log('No admin users to test with');
    }
    
  } catch (error) {
    console.error('Unexpected error during check:', error);
  }
}

// Run the check
checkAdminSetup()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 