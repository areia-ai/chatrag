// scripts/add-admin.js
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.local'
});

// Process command-line arguments
const args = process.argv.slice(2);
let email, password;

// Check for command line arguments
if (args.length >= 2) {
  email = args[0];
  password = args[1];
} else {
  // Try to use env vars if not provided as args
  email = process.env.NEW_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  password = process.env.NEW_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
}

// Validate required params
if (!email || !password) {
  console.error('Error: Email and password are required');
  console.log('\nUsage: node scripts/add-admin.js [email] [password]');
  console.log('  or set NEW_ADMIN_EMAIL and NEW_ADMIN_PASSWORD in environment');
  process.exit(1);
}

// Create Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, supabaseServiceKey);

async function addAdminUser() {
  try {
    console.log(`Adding new admin user: ${email}`);
    
    // Check if the user already exists in Auth
    const { data: authUsers, error: listError } = await adminClient.auth.admin.listUsers();
    
    if (listError) {
      console.error('Error listing users:', listError);
      return;
    }
    
    let userId;
    const existingUser = authUsers.users.find(u => u.email === email);
    
    if (existingUser) {
      console.log(`User with email ${email} already exists with ID: ${existingUser.id}`);
      userId = existingUser.id;
      
      // Update the user's password
      console.log(`Updating password for user ${email}...`);
      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        userId,
        { password }
      );
      
      if (updateError) {
        console.error('Error updating password:', updateError);
        return;
      }
      
      console.log(`✅ Password for ${email} has been updated successfully`);
    } else {
      // Create a new user
      console.log(`Creating new user with email: ${email}`);
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
      
      if (createError) {
        console.error('Error creating user:', createError);
        return;
      }
      
      console.log(`✅ Created new user with ID: ${newUser.user.id}`);
      userId = newUser.user.id;
    }
    
    // Check if user is already an admin
    const { data: existingAdmin, error: adminCheckError } = await adminClient
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .single();
      
    if (adminCheckError && adminCheckError.code !== 'PGRST116') {
      console.error('Error checking admin status:', adminCheckError);
      return;
    }
    
    if (existingAdmin) {
      console.log(`✅ User ${email} is already registered as an admin. No action needed.`);
      return;
    }
    
    // Add user to admin_users table
    console.log('Adding user to admin_users table...');
    const { error: adminError } = await adminClient
      .from('admin_users')
      .insert({ 
        id: userId,
        created_by: userId
      });
      
    if (adminError) {
      console.error('Error adding user to admin_users table:', adminError);
      return;
    }
    
    console.log(`✅ Added ${email} as admin successfully!`);
    console.log(`Admin user ${email} can now log in through the Admin tab in Settings`);
    
  } catch (error) {
    console.error('Unexpected error adding admin user:', error);
  }
}

// Run the function
addAdminUser()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 