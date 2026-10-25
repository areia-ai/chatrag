# WhatsApp Integration Scripts

This folder contains utility scripts for WhatsApp integration management and debugging.

## Available Scripts

### `check-whatsapp-chats.js`
Inspects WhatsApp chat conversations and their mappings to ChatRAG chats.

**Usage:**
```bash
node scripts/whatsapp/check-whatsapp-chats.js
```

### `check-whatsapp-prompts.js`
Examines WhatsApp-specific prompts and configurations.

**Usage:**
```bash
node scripts/whatsapp/check-whatsapp-prompts.js
```

### `clear-whatsapp-sessions.js`
Clears all WhatsApp sessions from the database. Useful for resetting connections.

**Usage:**
```bash
node scripts/whatsapp/clear-whatsapp-sessions.js
```

### `delete-whatsapp-conversation.js`
Deletes specific WhatsApp conversations from the database.

**Usage:**
```bash
node scripts/whatsapp/delete-whatsapp-conversation.js
```

### `test-whatsapp-debug.js`
Debug tool for testing WhatsApp connection and message flow.

**Usage:**
```bash
node scripts/whatsapp/test-whatsapp-debug.js
```

### `test-whatsapp-flow.js`
End-to-end testing of the WhatsApp integration flow.

**Usage:**
```bash
node scripts/whatsapp/test-whatsapp-flow.js
```

## Requirements
- WhatsApp integration configured
- Koyeb session data (if using Koyeb deployment)
- Supabase credentials in `.env.local`