#!/usr/bin/env node

/**
 * Diagnostic script to check URL metadata in document chunks
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkURLMetadata() {
  console.log('Checking URL metadata in document chunks...\n');

  // Get recent chunks
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('id, content, metadata')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching chunks:', error);
    return;
  }

  console.log(`Found ${chunks.length} recent chunks\n`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n=== Chunk ${i + 1} ===`);
    console.log(`ID: ${chunk.id}`);
    console.log(`Document: ${chunk.metadata?.document_title || 'Unknown'}`);
    console.log(`Has URLs: ${chunk.metadata?.has_urls || false}`);
    console.log(`URL Count: ${chunk.metadata?.url_count || 0}`);

    if (chunk.metadata?.urls && chunk.metadata.urls.length > 0) {
      console.log(`URLs found:`);
      chunk.metadata.urls.forEach((urlData, idx) => {
        console.log(`  ${idx + 1}. ${urlData.url}`);
        console.log(`     Description: ${urlData.description || 'N/A'}`);
        console.log(`     Category: ${urlData.category || 'N/A'}`);
      });
    } else {
      console.log(`No URLs in metadata`);
    }

    // Show content preview
    const preview = chunk.content.substring(0, 200);
    console.log(`\nContent preview:\n${preview}...`);
  }

  // Summary statistics
  const chunksWithURLs = chunks.filter(c => c.metadata?.has_urls).length;
  const totalURLs = chunks.reduce((sum, c) => sum + (c.metadata?.url_count || 0), 0);

  console.log(`\n\n=== Summary ===`);
  console.log(`Total chunks checked: ${chunks.length}`);
  console.log(`Chunks with URLs: ${chunksWithURLs}`);
  console.log(`Total URLs found: ${totalURLs}`);
}

checkURLMetadata().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
