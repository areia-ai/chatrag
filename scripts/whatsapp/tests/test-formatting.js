#!/usr/bin/env node

/**
 * Test WhatsApp message formatting with numbers
 */

// Test the formatting function directly
function formatResponseForWhatsApp(response) {
  // Remove markdown formatting that WhatsApp doesn't support well
  const formatted = response
    // Handle code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/g, '').trim();
      return '\n```\n' + code + '\n```\n';
    })
    // Remove markdown links but keep the text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Convert headers to bold with proper spacing
    .replace(/#{1,6}\s(.+)/gm, '\n*$1*\n')
    // Convert bold markdown to WhatsApp bold
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    // Convert strikethrough
    .replace(/~~(.+?)~~/g, '~$1~')
    // Convert underline to italic (WhatsApp doesn't support underline)
    .replace(/__(.+?)__/g, '_$1_')
    // Convert markdown lists to simple dashes (avoiding Unicode issues)
    .replace(/^- /gm, '- ')
    // Normalize multiple newlines to double newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return formatted;
}

// Test cases with numbers
const testCases = [
  {
    name: "Simple numbers",
    input: "The revenue was $39,669 million in Q1 2024.",
    expected: "The revenue was $39,669 million in Q1 2024."
  },
  {
    name: "Numbers with bold",
    input: "The revenue was **$39,669 million** in Q1 2024.",
    expected: "The revenue was *$39,669 million* in Q1 2024."
  },
  {
    name: "List with numbers",
    input: "- Revenue: $39,669 million\n- Profit: $12,345 million",
    expected: "- Revenue: $39,669 million\n- Profit: $12,345 million"
  },
  {
    name: "Header with numbers",
    input: "## Financial Report Q1 2024\nRevenue: $39,669 million",
    expected: "\n*Financial Report Q1 2024*\n\nRevenue: $39,669 million"
  },
  {
    name: "Complex formatting with numbers",
    input: "**Apple's iPhone Revenue Fluctuations Across Quarters:**\n\n- **Q4 2020:** $39,669 million\n- **Q1 2021:** $49,856 million\n- **Q2 2021:** $37,542 million",
    expected: "*Apple's iPhone Revenue Fluctuations Across Quarters:*\n\n- *Q4 2020:* $39,669 million\n- *Q1 2021:* $49,856 million\n- *Q2 2021:* $37,542 million"
  },
  {
    name: "Numbers in code blocks",
    input: "Here are the numbers:\n```\n$39,669 million\n$12,345 million\n```",
    expected: "Here are the numbers:\n\n```\n$39,669 million\n$12,345 million\n```\n"
  }
];

console.log("Testing WhatsApp message formatting with numbers...\n");

let allPassed = true;

testCases.forEach((testCase, index) => {
  const result = formatResponseForWhatsApp(testCase.input);
  const passed = result === testCase.expected;

  console.log(`Test ${index + 1}: ${testCase.name}`);
  console.log(`Input:    "${testCase.input}"`);
  console.log(`Expected: "${testCase.expected}"`);
  console.log(`Result:   "${result}"`);
  console.log(`Status:   ${passed ? '✅ PASSED' : '❌ FAILED'}`);

  if (!passed) {
    allPassed = false;
    console.log('Differences:');
    console.log(`  Expected length: ${testCase.expected.length}`);
    console.log(`  Result length: ${result.length}`);

    // Show character-by-character comparison for failed tests
    const maxLen = Math.max(testCase.expected.length, result.length);
    for (let i = 0; i < maxLen; i++) {
      const expectedChar = testCase.expected[i] || '(end)';
      const resultChar = result[i] || '(end)';
      if (expectedChar !== resultChar) {
        console.log(`  Position ${i}: expected '${expectedChar}' (${expectedChar.charCodeAt(0)}) vs '${resultChar}' (${resultChar.charCodeAt(0)})`);
      }
    }
  }

  console.log('---\n');
});

console.log(allPassed ? '✅ All tests passed!' : '❌ Some tests failed!');

// Test with the exact message from the user
console.log("\n=== Testing user's exact message ===");
const userMessage = `**Apple's iPhone Revenue Fluctuations Across Quarters:**

Based on the financial data provided, here are the iPhone revenue figures for the quarters you asked about:

- **Q4 2020:** $39,669 million
- **Q1 2021:** $49,856 million (28.0% increase from Q4 2020)
- **Q2 2021:** $37,542 million (24.1% decrease from Q1 2021)
- **Q3 2021:** $36,693 million (2.3% decrease from Q2 2021)
- **Q4 2021:** $70,000 million (90.8% increase from Q3 2021)

The revenue shows significant fluctuations, with a notable surge in Q4 2021 to $70 billion, nearly double the Q3 2021 figure.`;

const formattedUserMessage = formatResponseForWhatsApp(userMessage);
console.log("Formatted message:");
console.log(formattedUserMessage);

// Check if numbers are present
const numbersToCheck = ['$39,669', '$49,856', '$37,542', '$36,693', '$70,000', '28.0%', '24.1%', '2.3%', '90.8%'];
console.log("\n=== Checking if numbers are preserved ===");
numbersToCheck.forEach(num => {
  const present = formattedUserMessage.includes(num);
  console.log(`${num}: ${present ? '✅ Present' : '❌ Missing'}`);
});