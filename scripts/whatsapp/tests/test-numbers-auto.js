#!/usr/bin/env node

/**
 * Automated test for WhatsApp numbers issue
 */

async function runTests() {
  const sessionId = 'flyio_27c3421a-bd5d-4479-887c-872c897b87b9_1758047806515';
  const phoneNumber = '5218141232367'; // Your WhatsApp number from previous tests

  console.log('=== Running WhatsApp Numbers Test ===\n');
  console.log(`Session ID: ${sessionId}`);
  console.log(`Phone Number: ${phoneNumber}\n`);

  const tests = [
    {
      type: 'simple',
      description: 'Simple message with numbers and percentages'
    },
    {
      type: 'formatted',
      description: 'Formatted message with bold and lists'
    },
    {
      type: 'plain',
      description: 'Plain numbers without formatting'
    },
    {
      type: 'unicode',
      description: 'Different number formats'
    }
  ];

  for (const test of tests) {
    console.log(`\n📤 Testing: ${test.type} - ${test.description}`);
    console.log('-------------------------------------------');

    try {
      const response = await fetch('http://localhost:3000/api/whatsapp/test-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId,
          phoneNumber,
          testType: test.type
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Message sent successfully');
        console.log('Message content:');
        console.log(result.messageSent);
        console.log(`\nMessage ID: ${result.messageId}`);
        console.log('Debug info:', result.debug);
      } else {
        console.log('❌ Failed:', result.error);
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }

    // Wait 2 seconds between tests to avoid rate limiting
    if (tests.indexOf(test) < tests.length - 1) {
      console.log('\nWaiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n\n=== Test Complete ===');
  console.log('📱 Check your WhatsApp to see which messages have numbers preserved.');
  console.log('\nExpected results in WhatsApp:');
  console.log('1. Simple: Should show "$39,669 million and 28.0% increase"');
  console.log('2. Formatted: Should show revenue figures with bullets');
  console.log('3. Plain: Should show plain numbers without formatting');
  console.log('4. Unicode: Should show different number formats');
  console.log('\nIf any numbers are missing, note which test types failed.');
}

// Run the tests
runTests().catch(console.error);