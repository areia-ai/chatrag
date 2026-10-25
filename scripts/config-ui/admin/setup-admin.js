const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.local'
});

// Validate required environment variables
const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} environment variable is required`);
    process.exit(1);
  }
}

// Create Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, supabaseServiceKey);

// Admin credentials
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

async function setupAdmin() {
  try {
    console.log('Starting admin setup process...');
    
    // Check if any admin users already exist
    console.log('Checking for existing admin users...');
    const { count, error: countError } = await adminClient
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
      
    if (countError) {
      console.error('Error checking for existing admins:', countError);
      return;
    }
    
    if (count && count > 0) {
      console.log(`Found ${count} existing admin users.`);
    }
    
    // Check if the user already exists
    console.log(`Looking up user with email: ${adminEmail}`);
    const { data: userData, error: userError } = await adminClient.auth.admin.listUsers();
    
    if (userError) {
      console.error('Error listing users:', userError);
      return;
    }
    
    let userId;
    const existingUser = userData.users.find(u => u.email === adminEmail);
    
    if (existingUser) {
      console.log(`User with email ${adminEmail} already exists with ID: ${existingUser.id}`);
      userId = existingUser.id;
      
      // Check if this user is already an admin
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
        console.log(`User ${adminEmail} is already an admin. No action needed.`);
        return;
      }
    } else {
      console.log(`Creating new user with email: ${adminEmail}`);
      // Create user with Supabase auth
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true
      });
      
      if (createError) {
        console.error('Error creating user:', createError);
        return;
      }
      
      console.log(`Created new user with ID: ${newUser.user.id}`);
      userId = newUser.user.id;
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
    
    // Initialize admin settings if not already present
    console.log('Checking for existing admin settings...');
    const { data: existingSettings } = await adminClient
      .from('admin_settings')
      .select('id')
      .single();
      
    if (!existingSettings) {
      console.log('Creating initial admin settings...');
      const settingsId = uuidv4();
      const { error: settingsError } = await adminClient
        .from('admin_settings')
        .insert({
          id: settingsId,
          read_only_doc_dashboard: false,
          updated_by: userId
        });
        
      if (settingsError) {
        console.error('Error creating admin settings:', settingsError);
        return;
      }
    } else {
      console.log('Admin settings already exist. ID:', existingSettings.id);
    }
    
    console.log('✅ Admin setup completed successfully!');
    console.log(`Admin user ${adminEmail} can now log in through the Admin tab in Settings`);
    
  } catch (error) {
    console.error('Unexpected error during admin setup:', error);
  }
}

// Run the setup
setupAdmin()
  .catch(error => {
    console.error('Fatal error during setup:', error);
    process.exit(1);
  }); 