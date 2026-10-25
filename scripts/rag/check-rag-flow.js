require('dotenv').config({ path: '.env.local' });

console.log('Checking RAG System Prompt Configuration...\n');

// Check if RAG_SYSTEM_PROMPT is set
const ragSystemPrompt = process.env.RAG_SYSTEM_PROMPT;

if (!ragSystemPrompt) {
  console.log('❌ RAG_SYSTEM_PROMPT is NOT set in environment variables');
} else {
  console.log('✅ RAG_SYSTEM_PROMPT is set');
  
  // Try to decode it
  let decodedPrompt = ragSystemPrompt;
  let previousPrompt = '';
  let iterations = 0;
  const maxIterations = 10;
  
  // Keep decoding until no changes occur
  while (previousPrompt !== decodedPrompt && decodedPrompt.includes('%') && iterations < maxIterations) {
    previousPrompt = decodedPrompt;
    try {
      decodedPrompt = decodeURIComponent(decodedPrompt);
      iterations++;
    } catch (e) {
      console.log('Decoding error at iteration', iterations, ':', e.message);
      break;
    }
  }
  
  console.log(`\nDecoded after ${iterations} iterations:`);
  console.log('First 500 chars:', decodedPrompt.substring(0, 500));
  
  // Check if it contains the context placeholder
  if (decodedPrompt.includes('{{context}}')) {
    console.log('\n✅ Contains {{context}} placeholder - RAG will work');
  } else {
    console.log('\n❌ MISSING {{context}} placeholder - RAG will NOT work!');
  }
  
  // Check for medical content
  if (decodedPrompt.toLowerCase().includes('marcial') || 
      decodedPrompt.toLowerCase().includes('vega') ||
      decodedPrompt.toLowerCase().includes('integrative medicine')) {
    console.log('\n⚠️  WARNING: System prompt contains medical content!');
  } else {
    console.log('\n✅ No medical content found in system prompt');
  }
}

// Check other relevant environment variables
console.log('\n\nOther relevant settings:');
console.log('NEXT_PUBLIC_SITE_URL:', process.env.NEXT_PUBLIC_SITE_URL || 'NOT SET');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
console.log('OPENAI_EMBEDDING_MODEL:', process.env.OPENAI_EMBEDDING_MODEL || 'NOT SET');

// Check if the issue might be with the default system prompt
console.log('\n\nDefault system prompt (when RAG is disabled):');
console.log('The chat API uses this when RAG is not enabled:');
console.log('"You are a helpful AI assistant with access to a knowledge base..."');
console.log('\nThis does NOT contain medical content.');