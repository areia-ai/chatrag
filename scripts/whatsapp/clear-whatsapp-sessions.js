const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearStaleSessions() {
  console.log('Clearing stale WhatsApp sessions...\n');
  
  // Get all WhatsApp sessions
  const { data: sessions, error: fetchError } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .order('created_at', { ascending: false });

  if (fetchError) {
    console.error('Error fetching sessions:', fetchError);
    return;
  }

  console.log(`Found ${sessions?.length || 0} total sessions\n`);

  if (sessions && sessions.length > 0) {
    // Show session details
    sessions.forEach((session, index) => {
      console.log(`Session ${index + 1}:`);
      console.log(`  ID: ${session.id}`);
      console.log(`  Session ID: ${session.session_id}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Phone: ${session.phone_number || 'N/A'}`);
      console.log(`  Created: ${new Date(session.created_at).toLocaleString()}`);
      console.log(`  Updated: ${new Date(session.updated_at).toLocaleString()}`);
      
      // Check if session is stale (older than 5 minutes with qr_pending status)
      const updatedAt = new Date(session.updated_at);
      const now = new Date();
      const diffMinutes = (now - updatedAt) / (1000 * 60);
      
      if (session.status === 'qr_pending' && diffMinutes > 5) {
        console.log(`  ⚠️  STALE SESSION (${Math.floor(diffMinutes)} minutes old)`);
      }
      
      console.log('');
    });

    // Ask for confirmation
    console.log('\nDo you want to clear ALL WhatsApp sessions? (yes/no)');
    
    // Simple way to get user input in Node.js
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('> ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        console.log('\nClearing all sessions...');
        
        const { error: deleteError } = await supabase
          .from('whatsapp_sessions')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
          
        if (deleteError) {
          console.error('Error deleting sessions:', deleteError);
        } else {
          console.log('✅ All WhatsApp sessions cleared successfully!');
          console.log('\nYou can now start a fresh WhatsApp connection.');
        }
      } else {
        console.log('\nOperation cancelled.');
      }
      
      rl.close();
    });
  } else {
    console.log('No sessions found.');
  }
}

clearStaleSessions().catch(console.error);