#!/usr/bin/env node

/**
 * Test sending messages with numbers to WhatsApp
 * This helps diagnose where numbers are being stripped
 */

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testWhatsAppNumbers() {
  console.log('=== WhatsApp Numbers Test Tool ===\n');

  // Get session ID and phone number
  const sessionId = await new Promise(resolve => {
    rl.question('Enter your WhatsApp session ID: ', resolve);
  });

  const phoneNumber = await new Promise(resolve => {
    rl.question('Enter the recipient phone number (with country code, e.g., 1234567890): ', resolve);
  });

  const testTypes = [
    { type: 'simple', description: 'Simple message with numbers and percentages' },
    { type: 'formatted', description: 'Formatted message with bold and lists' },
    { type: 'plain', description: 'Plain numbers without any formatting' },
    { type: 'unicode', description: 'Different number formats' },
    { type: 'escaped', description: 'Escaped special characters' },
    { type: 'json', description: 'JSON formatted message' }
  ];

  console.log('\nSelect test type:');
  testTypes.forEach((t, i) => {
    console.log(`${i + 1}. ${t.type}: ${t.description}`);
  });
  console.log('7. custom: Send a custom message');

  const choice = await new Promise(resolve => {
    rl.question('\nEnter choice (1-7): ', resolve);
  });

  let testType = 'simple';
  let customMessage = null;

  if (choice === '7') {
    testType = 'custom';
    customMessage = await new Promise(resolve => {
      rl.question('Enter your custom message with numbers: ', resolve);
    });
  } else {
    const index = parseInt(choice) - 1;
    if (index >= 0 && index < testTypes.length) {
      testType = testTypes[index].type;
    }
  }

  console.log(`\nSending ${testType} test message...`);

  try {
    const response = await fetch('http://localhost:3000/api/whatsapp/test-numbers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        phoneNumber,
        testType,
        customMessage
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log('\n✅ Message sent successfully!');
      console.log('\nMessage details:');
      console.log('- Type:', result.testType);
      console.log('- Message ID:', result.messageId);
      console.log('- Status:', result.status);
      console.log('\nMessage content:');
      console.log(result.messageSent);
      console.log('\nDebug info:');
      console.log(JSON.stringify(result.debug, null, 2));

      console.log('\n📱 Check your WhatsApp to see if the numbers appear correctly.');
      console.log('\nIf numbers are missing in WhatsApp but present above, the issue is in:');
      console.log('1. The Baileys service (Fly.io/Koyeb)');
      console.log('2. WhatsApp\'s message encoding/rendering');
      console.log('3. Network transmission encoding');
    } else {
      console.log('\n❌ Failed to send message:');
      console.log(result.error);
      if (result.details) {
        console.log('Details:', result.details);
      }
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  rl.close();
}

// Run the test
testWhatsAppNumbers().catch(console.error);