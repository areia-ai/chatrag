// Delete specific WhatsApp conversation
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function deleteWhatsAppConversation() {
  const chatId = '8514e250-25d3-49de-bac6-91795eb246c8';
  const phoneNumber = '351910632359';

  console.log(`Deleting WhatsApp conversation for phone: ${phoneNumber}`);
  console.log(`Chat ID: ${chatId}`);

  try {
    // First, delete the chat
    const { error: chatError } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (chatError) {
      console.error('Error deleting chat:', chatError);
    } else {
      console.log('✅ Chat deleted successfully');
    }

    // Then, delete the WhatsApp conversation mapping
    const { error: convError } = await supabase
      .from('whatsapp_conversations')
      .delete()
      .eq('chat_id', chatId);

    if (convError) {
      console.error('Error deleting WhatsApp conversation:', convError);
    } else {
      console.log('✅ WhatsApp conversation deleted successfully');
    }

    // Also delete any WhatsApp messages
    const { error: msgError } = await supabase
      .from('whatsapp_messages')
      .delete()
      .eq('conversation_id', chatId);

    if (msgError) {
      console.error('Error deleting WhatsApp messages:', msgError);
    } else {
      console.log('✅ WhatsApp messages deleted (if any)');
    }

    console.log('\n🎉 Cleanup complete! You can now reconnect WhatsApp for a fresh start.');

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

deleteWhatsAppConversation();