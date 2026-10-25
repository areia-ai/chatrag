# RAG (Retrieval-Augmented Generation) Scripts

This folder contains utility scripts for RAG system testing, debugging, and document processing.

## Available Scripts

### `check-rag-flow.js`
Tests the complete RAG pipeline from query to response.

**Usage:**
```bash
node scripts/rag/check-rag-flow.js
```

### `decode-rag-prompt.js`
Decodes and validates the RAG_SYSTEM_PROMPT from `.env.local`, checking for proper formatting and the required `{{context}}` placeholder.

**Usage:**
```bash
node scripts/rag/decode-rag-prompt.js
```

### `test-rag-system.js`
Comprehensive testing of the RAG system including embedding generation, similarity search, and response generation.

**Usage:**
```bash
node scripts/rag/test-rag-system.js
```

### `reprocess-documents.js`
Re-processes documents in the database, regenerating embeddings and chunks.

**Usage:**
```bash
node scripts/rag/reprocess-documents.js
```

## Requirements
- OpenAI API key for embeddings
- Supabase credentials
- RAG_SYSTEM_PROMPT configured in `.env.local`