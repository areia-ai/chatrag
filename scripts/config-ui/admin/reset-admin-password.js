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

// Admin credentials from .env
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local');
  process.exit(1);
}

async function resetAdminPassword() {
  try {
    console.log(`Resetting password for ${adminEmail}...`);

    // Find the user ID
    const { data: userData, error: userError } = await adminClient.auth.admin.listUsers();
    
    if (userError) {
      console.error('Error listing users:', userError);
      return;
    }
    
    const user = userData.users.find(u => u.email === adminEmail);
    
    if (!user) {
      console.error(`User with email ${adminEmail} not found in Auth system!`);
      return;
    }
    
    console.log(`Found user with ID: ${user.id}`);
    
    // Update the user's password
    console.log(`Updating password for user ${adminEmail}...`);
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      user.id,
      { password: adminPassword }
    );
    
    if (updateError) {
      console.error('Error updating password:', updateError);
      return;
    }
    
    console.log(`✅ Password for ${adminEmail} has been updated successfully!`);
    console.log('You should now be able to log in as admin with this password.');
    
  } catch (error) {
    console.error('Unexpected error during password reset:', error);
  }
}

// Run the function
resetAdminPassword()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 