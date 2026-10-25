# ChatRAG Supabase Setup

This directory contains two comprehensive database setup files for ChatRAG deployments.

## Files

### single-tenant-setup.sql
**Use this for single-tenant deployments** where one user/organization owns all data.

Features:
- Simplified isolation model (no organization tables)
- User-based document ownership
- Nango integration for external document connectors
- RAG vector search with HNSW indexes
- Flat personal workspace model

Set `NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant` in `.env.local`

### multi-tenant-setup.sql
**Use this for multi-tenant deployments** with organizations and team collaboration.

Features:
- Three-tier workspace architecture:
  1. Personal Workspace (flat, no organization)
  2. Personal Projects (is_personal=true, owner only, can be made collaborative)
  3. Collaborative Projects (is_personal=false, multi-member via shareOrganization)
- Organization-based multi-tenancy with RLS
- Role-based access control (owner, admin, member, viewer)
- Team invitations and member management
- Nango integration for external document connectors
- Storage quotas and subscription tier enforcement
- RAG vector search with HNSW indexes

Set `NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant` in `.env.local`

## Common Features (Both Setups)

Both setup files include:

### Nango Integration
- `nango_connections` table - tracks external document provider connections
- `nango_sync_records` table - tracks individual file sync status
- Supports Google Drive, Notion, Dropbox
- Folder-based and file-based sync options
- Source tracking columns on documents table

### Connector Configuration
- `connector_config` table - configuration for supported connectors
- `connector_feature_settings` table - global connector feature toggles
- Admin-only write access, public read access

### Document Management
- Documents table with source tracking (upload, google-drive, notion, dropbox)
- Document chunks with 1536-dim vector embeddings
- HNSW indexes for 15-28x faster vector similarity search
- Folder organization for chats
- Chat sharing with share tokens

### Authentication & Security
- Row Level Security (RLS) on all tables
- User-scoped data isolation
- Service role grants for webhooks and backend operations
- Secure storage policies

## Deployment Steps

1. **Choose your deployment mode:**
   ```bash
   # For single-tenant
   export NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant
   
   # For multi-tenant
   export NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant
   ```

2. **Run the appropriate setup in Supabase SQL Editor:**
   - Copy the contents of `single-tenant-setup.sql` OR `multi-tenant-setup.sql`
   - Paste into Supabase's SQL Editor
   - Execute

3. **Verify the setup:**
   - Check that tables were created
   - Verify RLS policies are in place
   - Test vector search functionality

4. **Configure environment variables:**
   - Set deployment mode in `.env.local`
   - Restart development server: `npm run dev`

## Important Notes

- **Do NOT run both setup files** - choose one based on your deployment model
- All tables use UUID primary keys with `gen_random_uuid()`
- Vector embeddings support 1536 dimensions (text-embedding-ada-002, text-embedding-3-small)
- HNSW parameters: m=64, ef_construction=200 (optimized for production)
- All timestamps use UTC timezone
- Service role has full access for webhook/backend operations
- User RLS policies restrict data to authenticated users' own records

## Nango Integration Details

### Connection Fields
- `user_id` - the authenticated user
- `provider` - external service (google-drive, notion, dropbox)
- `status` - pending, connected, error, disconnected
- `sync_enabled` - whether sync is currently active
- `sync_folder_id/name/path` - for folder-based syncing
- `sync_file_ids/names` - for file-specific syncing

### Sync Records
- Tracks each file's sync status
- Links to created documents
- Records errors and last sync timestamps
- Status: pending, processing, completed, failed, disconnected

## Troubleshooting

**Tables don't exist:**
- Verify the entire SQL file executed successfully
- Check for syntax errors in the SQL Editor
- Ensure you're connected to the correct Supabase project

**Vector search not working:**
- Confirm `pgvector` extension is enabled
- Verify embeddings are 1536 dimensions
- Check HNSW index exists: `idx_document_chunks_embedding`

**RLS blocking access:**
- Ensure `auth.uid()` returns a valid user ID
- Check policies are correctly configured
- Test with authenticated user (not anon role)

**Nango tables missing:**
- Both setup files include Nango integration
- Tables will be created when you run the full setup
- No separate migration needed
