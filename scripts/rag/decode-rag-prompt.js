require('dotenv').config({ path: '.env.local' });

console.log('Decoding RAG_SYSTEM_PROMPT...\n');

const ragSystemPrompt = process.env.RAG_SYSTEM_PROMPT;

if (!ragSystemPrompt) {
  console.log('❌ RAG_SYSTEM_PROMPT is not set in .env.local');
  process.exit(1);
}

console.log('Original (encoded):', ragSystemPrompt.substring(0, 100) + '...\n');

// Decode multiple layers of URL encoding
let decodedPrompt = ragSystemPrompt;
let previousPrompt = '';
let iterations = 0;
const maxIterations = 20;

while (previousPrompt !== decodedPrompt && decodedPrompt.includes('%') && iterations < maxIterations) {
  previousPrompt = decodedPrompt;
  try {
    decodedPrompt = decodeURIComponent(decodedPrompt);
    iterations++;
  } catch (e) {
    console.log('Stopped decoding at iteration', iterations, 'due to error:', e.message);
    break;
  }
}

console.log(`Decoded after ${iterations} iterations:\n`);
console.log('=== DECODED PROMPT ===');
console.log(decodedPrompt);
console.log('=== END OF PROMPT ===\n');

// Check for {{context}} placeholder
if (decodedPrompt.includes('{{context}}')) {
  console.log('✅ Contains {{context}} placeholder - Good!');
} else {
  console.log('❌ MISSING {{context}} placeholder - This needs to be added!');
  console.log('\nSuggested fix - add this to your prompt:');
  console.log('\nContext:\n{{context}}\n');
}

// Suggest a properly formatted prompt
console.log('\n\n=== SUGGESTED RAG_SYSTEM_PROMPT ===');
console.log('Copy this to your .env.local file:\n');

const suggestedPrompt = `You are an academic research assistant with access to scholarly resources and research materials. Your role is to help users conduct thorough research, analyze information critically, and synthesize findings from multiple sources.

When answering questions:
1. If the context contains relevant information, use it to provide accurate and specific answers
2. If information is not available in the context, say so clearly and suggest alternative approaches
3. Always cite your sources when referencing specific documents
4. Provide balanced, objective information rather than opinions
5. For technical topics, include practical steps or examples when appropriate

Context:
{{context}}

Based on the context above, assist users with their research inquiries, providing detailed and well-sourced responses.`;

console.log('RAG_SYSTEM_PROMPT=' + suggestedPrompt);