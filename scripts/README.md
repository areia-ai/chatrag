# ChatRAG Scripts

This directory contains utility scripts for managing, testing, and debugging various aspects of the ChatRAG application.

## Directory Structure

### 📁 `/config-ui/`
Configuration UI and admin management tools. Access via `npm run config` to start the configuration server.

### 📁 `/database/`
Database inspection and management utilities:
- Chat inspection
- Database prompt checking

### 📁 `/rag/`
RAG (Retrieval-Augmented Generation) system utilities:
- RAG flow testing
- Prompt decoding and validation
- Document reprocessing
- System testing

### 📁 `/whatsapp/`
WhatsApp integration management:
- Session management
- Conversation handling
- Debug and testing tools

## Quick Start

1. **Start Configuration UI:**
   ```bash
   npm run config
   ```
   Then visit http://localhost:3333

2. **Run a specific script:**
   ```bash
   node scripts/[category]/[script-name].js
   ```

## Requirements

Most scripts require:
- `.env.local` file with proper credentials
- Node.js dependencies installed (`npm install`)
- Supabase connection configured
- OpenAI API key (for RAG scripts)

## Note

The `config-server.js` at the root of this directory must remain here as it's referenced by `package.json` and manages the configuration UI.