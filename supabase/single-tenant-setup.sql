-- ChatRAG Application Complete Database Setup
-- This file consolidates all SQL setup required for the application
--
-- Vector Database Optimization:
-- - Uses HNSW indexes for 15-28x faster vector similarity search compared to IVFFlat
-- - Optimized parameters: m=64, ef_construction=200 for production workloads
-- - Supports 1536-dimensional embeddings (text-embedding-ada-002, text-embedding-3-small)

------------------------------------------
-- Extensions
------------------------------------------

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

------------------------------------------
-- Documents and Chunks Tables
------------------------------------------

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  organization_id UUID DEFAULT NULL,  -- Always NULL in single-tenant mode (multi-tenant compatibility)
  
  -- Source tracking (for Nango integration)
  source TEXT DEFAULT 'upload' CHECK (source IN ('upload', 'google-drive', 'notion', 'dropbox')),
  source_provider TEXT,
  source_file_id TEXT,
  source_connection_id TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create document_chunks table with vector support
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  organization_id UUID DEFAULT NULL,  -- Always NULL in single-tenant mode (multi-tenant compatibility)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes for documents and chunks
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_organization_id ON document_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_source_provider ON documents(source_provider);

-- Create optimized HNSW index for vector similarity search (15-28x faster than IVFFlat)
-- Note: m=64 provides better recall but uses more memory than m=16
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 64, ef_construction = 200);

-- Add comment to clarify embedding dimensions and index optimization
COMMENT ON COLUMN document_chunks.embedding IS 'Vector embedding (1536 dimensions) - supports text-embedding-ada-002 and text-embedding-3-small';


------------------------------------------
-- Folders Table
------------------------------------------

-- Create folders table
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1', -- Default indigo color
  pinned BOOLEAN DEFAULT FALSE,
  organization_id UUID DEFAULT NULL,  -- Always NULL in single-tenant mode (multi-tenant compatibility)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Add indexes for folders
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_pinned ON folders(pinned);
CREATE INDEX IF NOT EXISTS idx_folders_created_at ON folders(created_at);
CREATE INDEX IF NOT EXISTS idx_folders_organization_id ON folders(organization_id);

-- Add comments to explain columns
COMMENT ON TABLE folders IS 'Folders for organizing chats';
COMMENT ON COLUMN folders.name IS 'User-defined name for the folder';
COMMENT ON COLUMN folders.color IS 'Hex color code for folder visual identification';
COMMENT ON COLUMN folders.pinned IS 'Indicates whether a folder is pinned for quick access';

------------------------------------------
-- Chats Table
------------------------------------------

-- Create chats table
CREATE TABLE IF NOT EXISTS chats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  title text not null,
  messages jsonb not null,
  pinned BOOLEAN DEFAULT FALSE,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  organization_id UUID DEFAULT NULL,  -- Always NULL in single-tenant mode (multi-tenant compatibility)
  shared boolean DEFAULT false,
  share_id uuid UNIQUE DEFAULT NULL,
  is_shared boolean DEFAULT false,
  share_settings jsonb,
  mcp_tool_states jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes for chats
CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_folder_id ON chats(folder_id);
CREATE INDEX IF NOT EXISTS idx_chats_organization_id ON chats(organization_id);
CREATE INDEX IF NOT EXISTS chats_pinned_idx ON chats(pinned);
CREATE INDEX IF NOT EXISTS idx_chats_share_id ON chats(share_id) WHERE shared = true;
CREATE INDEX IF NOT EXISTS idx_chats_mcp_tool_states ON chats USING gin (mcp_tool_states);

-- Performance optimization indexes for frequent queries
CREATE INDEX IF NOT EXISTS idx_chats_user_id_updated_at_desc 
  ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at_desc
  ON chats(updated_at DESC);

-- Add comments to explain index purposes
COMMENT ON INDEX idx_chats_user_id_updated_at_desc IS 'Optimizes user chat list queries ordered by most recent activity';
COMMENT ON INDEX idx_chats_updated_at_desc IS 'Optimizes queries that sort all chats by recent activity';

-- Add comments to explain column purposes
COMMENT ON COLUMN chats.pinned IS 'Indicates whether a chat is pinned by the user for quick access';
COMMENT ON COLUMN chats.folder_id IS 'Optional reference to the folder containing this chat';
COMMENT ON COLUMN chats.shared IS 'Indicates if the chat is publicly shared';

------------------------------------------
-- Subscriptions Tables
------------------------------------------

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null unique,
  polar_subscription_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  payment_provider text CHECK (payment_provider IN ('stripe', 'polar')) NOT NULL,
  plan_type text not null,
  status text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create pending_subscriptions table to track checkouts before signup
CREATE TABLE IF NOT EXISTS pending_subscriptions (
  id uuid default gen_random_uuid() primary key,
  checkout_id text not null unique,
  email text not null,
  plan_type text not null,
  status text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_polar_id ON subscriptions(polar_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_pending_subscriptions_checkout_id ON pending_subscriptions(checkout_id);

------------------------------------------
-- Storage Buckets
------------------------------------------

-- Create storage bucket for chat images if it doesn't exist
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('chat-images', 'chat-images', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Set up security configurations for the bucket
DO $$
BEGIN
  UPDATE storage.buckets
  SET public = true,
      file_size_limit = 10485760, -- 10MB (increased to accommodate 3D model files)
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'model/gltf-binary']
  WHERE id = 'chat-images';
END $$;

-- Create storage bucket for backgrounds if it doesn't exist
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('backgrounds', 'backgrounds', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Set up security configurations for the backgrounds bucket
DO $$
BEGIN
  UPDATE storage.buckets
  SET public = true,
      file_size_limit = 5242880 -- 5MB
  WHERE id = 'backgrounds';
END $$;

-- Allow public access to view backgrounds
DROP POLICY IF EXISTS "Backgrounds are publicly accessible" ON storage.objects;
CREATE POLICY "Backgrounds are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'backgrounds');

-- Allow authenticated users to upload backgrounds
DROP POLICY IF EXISTS "Users can upload backgrounds" ON storage.objects;
CREATE POLICY "Users can upload backgrounds" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'backgrounds' AND auth.role() = 'authenticated');

-- Allow authenticated users to update their own backgrounds
DROP POLICY IF EXISTS "Users can update own backgrounds" ON storage.objects;
CREATE POLICY "Users can update own backgrounds" ON storage.objects
  FOR UPDATE USING (bucket_id = 'backgrounds' AND owner = auth.uid());

-- Allow authenticated users to delete their own backgrounds
DROP POLICY IF EXISTS "Users can delete own backgrounds" ON storage.objects;
CREATE POLICY "Users can delete own backgrounds" ON storage.objects
  FOR DELETE USING (bucket_id = 'backgrounds' AND owner = auth.uid());

-- Create dedicated storage bucket for 3D models if it doesn't exist
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('3d-models', '3d-models', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Set up security configurations for the 3D models bucket
DO $$
BEGIN
  UPDATE storage.buckets
  SET public = true,
      file_size_limit = 20971520, -- 20MB to accommodate larger 3D models
      allowed_mime_types = array['model/gltf-binary', 'model/gltf+json', 'application/octet-stream']
  WHERE id = '3d-models';
END $$;

-- Allow public access to 3D models
DROP POLICY IF EXISTS "3D models are publicly accessible" ON storage.objects;
CREATE POLICY "3D models are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = '3d-models');

-- Allow authenticated users to upload 3D models
DROP POLICY IF EXISTS "Users can upload 3D models" ON storage.objects;
CREATE POLICY "Users can upload 3D models" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = '3d-models' AND auth.role() = 'authenticated');

-- Allow service role to upload 3D models (for AI-generated content)
DROP POLICY IF EXISTS "Service role can upload 3D models" ON storage.objects;
CREATE POLICY "Service role can upload 3D models" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = '3d-models');

-- Allow users to delete their own 3D models
DROP POLICY IF EXISTS "Users can delete their own 3D models" ON storage.objects;
CREATE POLICY "Users can delete their own 3D models" ON storage.objects
  FOR DELETE USING (bucket_id = '3d-models' AND (SELECT auth.uid()) = owner);

------------------------------------------
-- Functions
------------------------------------------

-- Function to match similar document chunks
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  similarity_threshold double precision,
  match_count integer
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE dc.embedding IS NOT NULL 
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Optimized function to match documents using HNSW index
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count integer
)
RETURNS TABLE(
  id uuid,
  content text,
  metadata jsonb,
  embedding vector,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
begin
  return query
  select
    dc.id,
    dc.content,
    dc.metadata,
    dc.embedding,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Function to get document chunks
CREATE OR REPLACE FUNCTION get_document_chunks(
  doc_id UUID
)
RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.content,
    dc.metadata,
    dc.created_at
  FROM document_chunks dc
  WHERE dc.document_id = doc_id
  ORDER BY dc.created_at ASC;
END;
$$;

-- Function to set HNSW search parameters for performance optimization
CREATE OR REPLACE FUNCTION set_hnsw_search_params(ef_value integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Set the ef_search parameter for the current session
  -- Higher values = better recall but slower queries
  -- ef=64: Low latency mode
  -- ef=128: Balanced mode (default)
  -- ef=256: High recall mode
  EXECUTE format('SET hnsw.ef_search = %s', ef_value);
END;
$$;

-- Function to get index statistics for monitoring
CREATE OR REPLACE FUNCTION get_index_statistics()
RETURNS TABLE(
  index_name text,
  table_name text,
  index_size text,
  number_of_scans bigint,
  tuples_read bigint,
  tuples_fetched bigint
)
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  SELECT 
    i.indexrelname::text as index_name,
    i.relname::text as table_name,
    pg_size_pretty(pg_relation_size(i.indexrelid)) as index_size,
    idx_scan as number_of_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
  FROM pg_stat_user_indexes i
  WHERE i.indexrelname LIKE 'idx_document_chunks%'
  ORDER BY i.indexrelname;
$$;

-- Optimized function for vector search with performance modes
CREATE OR REPLACE FUNCTION match_document_chunks_optimized(
  query_embedding vector(1536),
  similarity_threshold double precision,
  match_count integer,
  performance_mode text DEFAULT 'balanced'
)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Set ef_search based on performance mode
  CASE performance_mode
    WHEN 'fast' THEN
      PERFORM set_hnsw_search_params(64);
    WHEN 'accurate' THEN
      PERFORM set_hnsw_search_params(256);
    ELSE -- balanced
      PERFORM set_hnsw_search_params(128);
  END CASE;

  -- Execute the search with optimized parameters
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE dc.embedding IS NOT NULL 
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to check subscription status
CREATE OR REPLACE FUNCTION is_subscribed(user_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM subscriptions
    WHERE user_id = user_uuid
    AND status = 'active'
    AND plan_type IN ('pro', 'enterprise')
  );
END;
$$;

-- Function to clean up old chats
CREATE OR REPLACE FUNCTION cleanup_old_chats()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Delete chats older than 3 days
  DELETE FROM chats
  WHERE created_at < NOW() - INTERVAL '3 days';
  RETURN NEW;
END;
$$;

-- Create cleanup trigger
CREATE OR REPLACE TRIGGER cleanup_chats_trigger
  AFTER INSERT ON chats
  EXECUTE FUNCTION cleanup_old_chats();

-- Function to share a chat
CREATE OR REPLACE FUNCTION share_chat(chat_uuid uuid, settings jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_share_id uuid;
BEGIN
  -- Verify the user owns this chat
  IF NOT EXISTS (
    SELECT 1 FROM chats
    WHERE id = chat_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to share this chat';
  END IF;

  -- Generate a new share ID
  SELECT gen_random_uuid() INTO new_share_id;

  -- Update the chat record
  UPDATE chats
  SET is_shared = TRUE,
      share_id = new_share_id,
      share_settings = settings
  WHERE id = chat_uuid;

  RETURN new_share_id;
END;
$$;

-- Function to unshare a chat
CREATE OR REPLACE FUNCTION unshare_chat(chat_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Verify the user owns this chat
  IF NOT EXISTS (
    SELECT 1 FROM chats
    WHERE id = chat_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to unshare this chat';
  END IF;

  -- Update the chat record
  UPDATE chats
  SET is_shared = FALSE
  WHERE id = chat_uuid;

  RETURN TRUE;
END;
$$;

-- Function to notify about MCP tool state changes
CREATE OR REPLACE FUNCTION notify_mcp_tool_state_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.mcp_tool_states IS DISTINCT FROM NEW.mcp_tool_states THEN
    PERFORM pg_notify(
      'mcp_tool_state_change',
      json_build_object(
        'table', TG_TABLE_NAME,
        'id', NEW.id
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION set_last_updated_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Function to get folder statistics
CREATE OR REPLACE FUNCTION get_folder_stats(folder_uuid UUID)
RETURNS TABLE (
  chat_count BIGINT,
  last_updated TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as chat_count,
    MAX(c.updated_at) as last_updated
  FROM chats c
  WHERE c.folder_id = folder_uuid
    AND c.user_id = auth.uid();
END;
$$;

-- Function to move multiple chats to a folder
CREATE OR REPLACE FUNCTION move_chats_to_folder(
  chat_ids UUID[],
  target_folder_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Verify user owns the target folder (if not null)
  IF target_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = target_folder_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to use this folder';
  END IF;

  -- Update chats that belong to the user
  UPDATE chats
  SET folder_id = target_folder_id,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = ANY(chat_ids)
    AND user_id = auth.uid();
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN updated_count;
END;
$$;

-- Function to delete a folder and optionally its chats
CREATE OR REPLACE FUNCTION delete_folder(
  folder_uuid UUID,
  delete_chats BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Verify user owns the folder
  IF NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = folder_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this folder';
  END IF;

  -- If delete_chats is true, delete all chats in the folder
  IF delete_chats THEN
    DELETE FROM chats
    WHERE folder_id = folder_uuid AND user_id = auth.uid();
  ELSE
    -- Otherwise, just remove the folder reference from chats
    UPDATE chats
    SET folder_id = NULL
    WHERE folder_id = folder_uuid AND user_id = auth.uid();
  END IF;

  -- Delete the folder
  DELETE FROM folders
  WHERE id = folder_uuid AND user_id = auth.uid();

  RETURN TRUE;
END;
$$;

------------------------------------------
-- Tool Execution States Table
------------------------------------------

-- Create tool_execution_states table to persist tool execution status
CREATE TABLE IF NOT EXISTS tool_execution_states (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid not null,
  message_id bigint not null,
  tool_call_id text not null,
  tool_name text not null,
  status text not null check (status in ('pending', 'approved', 'running', 'completed', 'error', 'cancelled')),
  tool_params jsonb,
  tool_result jsonb,
  error_message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Ensure unique tool call per message
  unique(chat_id, message_id, tool_call_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_tool_execution_states_chat_id ON tool_execution_states(chat_id);
CREATE INDEX IF NOT EXISTS idx_tool_execution_states_message_id ON tool_execution_states(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_execution_states_tool_call_id ON tool_execution_states(tool_call_id);
CREATE INDEX IF NOT EXISTS idx_tool_execution_states_status ON tool_execution_states(status);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tool_execution_states_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Trigger to automatically update updated_at
DO $$
BEGIN
  DROP TRIGGER IF EXISTS update_tool_execution_states_updated_at ON tool_execution_states;
  CREATE TRIGGER update_tool_execution_states_updated_at
    BEFORE UPDATE ON tool_execution_states
    FOR EACH ROW
    EXECUTE FUNCTION update_tool_execution_states_updated_at();
END $$;

------------------------------------------
-- Row Level Security Policies
------------------------------------------

-- Enable RLS on all tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_execution_states ENABLE ROW LEVEL SECURITY;

-- Document policies
-- Drop existing policies to ensure clean setup
DROP POLICY IF EXISTS "Allow full access to authenticated users" ON documents;
DROP POLICY IF EXISTS "Allow read access to anonymous users" ON documents;

-- Re-create policies with proper settings
CREATE POLICY "Allow full access to authenticated users" ON documents
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read access to anonymous users" ON documents
  FOR SELECT USING (true);

-- Document chunks policies
-- Drop existing policies to ensure clean setup
DROP POLICY IF EXISTS "Allow full access to authenticated users" ON document_chunks;
DROP POLICY IF EXISTS "Allow read access to anonymous users" ON document_chunks;

CREATE POLICY "Allow full access to authenticated users" ON document_chunks
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read access to anonymous users" ON document_chunks
  FOR SELECT USING (true);

-- Folder policies
DROP POLICY IF EXISTS "Users can view their own folders" ON folders;
CREATE POLICY "Users can view their own folders"
  ON folders FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own folders" ON folders;
CREATE POLICY "Users can create their own folders"
  ON folders FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own folders" ON folders;
CREATE POLICY "Users can update their own folders"
  ON folders FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own folders" ON folders;
CREATE POLICY "Users can delete their own folders"
  ON folders FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- Chat policies
DROP POLICY IF EXISTS "Users can view their own chats" ON chats;
CREATE POLICY "Users can view their own chats"
  ON chats FOR SELECT
  USING (((SELECT auth.uid()) = user_id) OR (shared = true));

DROP POLICY IF EXISTS "Users can insert their own chats" ON chats;
CREATE POLICY "Users can insert their own chats"
  ON chats FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own chats" ON chats;
CREATE POLICY "Users can update their own chats"
  ON chats FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own chats" ON chats;
CREATE POLICY "Users can delete their own chats"
  ON chats FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Allow public access to shared chats" ON chats;
CREATE POLICY "Allow public access to shared chats"
  ON chats FOR SELECT
  USING (shared = true);

-- Subscription policies
DROP POLICY IF EXISTS "Users can view their own subscription" ON subscriptions;
CREATE POLICY "Users can view their own subscription"
  ON subscriptions FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own subscription" ON subscriptions;
CREATE POLICY "Users can update their own subscription"
  ON subscriptions FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Service role can manage all subscriptions" ON subscriptions;
CREATE POLICY "Service role can manage all subscriptions"
  ON subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- Pending subscription policies
DROP POLICY IF EXISTS "Service role can manage pending subscriptions" ON pending_subscriptions;
CREATE POLICY "Service role can manage pending subscriptions"
  ON pending_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- Tool execution states policies
DROP POLICY IF EXISTS "Users can view their own tool execution states" ON tool_execution_states;
CREATE POLICY "Users can view their own tool execution states"
  ON tool_execution_states FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats 
      WHERE chats.id = tool_execution_states.chat_id 
      AND chats.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert tool execution states for their own chats" ON tool_execution_states;
CREATE POLICY "Users can insert tool execution states for their own chats"
  ON tool_execution_states FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats 
      WHERE chats.id = tool_execution_states.chat_id 
      AND chats.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own tool execution states" ON tool_execution_states;
CREATE POLICY "Users can update their own tool execution states"
  ON tool_execution_states FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM chats 
      WHERE chats.id = tool_execution_states.chat_id 
      AND chats.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete their own tool execution states" ON tool_execution_states;
CREATE POLICY "Users can delete their own tool execution states"
  ON tool_execution_states FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM chats 
      WHERE chats.id = tool_execution_states.chat_id 
      AND chats.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service role can manage all tool execution states" ON tool_execution_states;
CREATE POLICY "Service role can manage all tool execution states"
  ON tool_execution_states FOR ALL
  USING (auth.role() = 'service_role');

-- Create storage bucket for chat videos if it doesn't exist
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('chat-videos', 'chat-videos', true, 52428800) -- 50MB limit
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Storage policies
DROP POLICY IF EXISTS "Chat images are publicly accessible" ON storage.objects;
CREATE POLICY "Chat images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-images');

DROP POLICY IF EXISTS "Users can upload chat images" ON storage.objects;
CREATE POLICY "Users can upload chat images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-images'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Service role can upload chat images" ON storage.objects;
CREATE POLICY "Service role can upload chat images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-images');

DROP POLICY IF EXISTS "Users can delete their own chat images" ON storage.objects;
CREATE POLICY "Users can delete their own chat images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-images'
    AND (SELECT auth.uid()) = owner
  );

-- Background images policies
DROP POLICY IF EXISTS "Backgrounds are publicly accessible" ON storage.objects;
CREATE POLICY "Backgrounds are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'backgrounds');

DROP POLICY IF EXISTS "Users can upload backgrounds" ON storage.objects;
CREATE POLICY "Users can upload backgrounds"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'backgrounds'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Service role can upload backgrounds" ON storage.objects;
CREATE POLICY "Service role can upload backgrounds"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'backgrounds');

DROP POLICY IF EXISTS "Users can delete their own backgrounds" ON storage.objects;
CREATE POLICY "Users can delete their own backgrounds"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'backgrounds'
    AND (SELECT auth.uid()) = owner
  );

-- Chat videos policies
DROP POLICY IF EXISTS "Chat videos are publicly accessible" ON storage.objects;
CREATE POLICY "Chat videos are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-videos');

DROP POLICY IF EXISTS "Users can upload chat videos" ON storage.objects;
CREATE POLICY "Users can upload chat videos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-videos'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Service role can upload chat videos" ON storage.objects;
CREATE POLICY "Service role can upload chat videos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-videos');

DROP POLICY IF EXISTS "Users can delete their own chat videos" ON storage.objects;
CREATE POLICY "Users can delete their own chat videos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-videos'
    AND (SELECT auth.uid()) = owner
  );

-- Create triggers for folders table
DO $$
BEGIN
  -- Trigger to automatically update updated_at timestamp
  DROP TRIGGER IF EXISTS update_folders_updated_at ON folders;
  CREATE TRIGGER update_folders_updated_at
    BEFORE UPDATE ON folders
    FOR EACH ROW
    EXECUTE FUNCTION set_last_updated_timestamp();
END $$;

-- Create triggers for chats table
DO $$
BEGIN
  -- Trigger to notify about MCP tool state changes
  DROP TRIGGER IF EXISTS notify_mcp_tool_state_change_chats ON chats;
  CREATE TRIGGER notify_mcp_tool_state_change_chats
    AFTER UPDATE ON chats
    FOR EACH ROW
    EXECUTE FUNCTION notify_mcp_tool_state_change();
    
  -- Trigger to automatically update updated_at timestamp
  DROP TRIGGER IF EXISTS set_last_updated ON chats;
  CREATE TRIGGER set_last_updated
    BEFORE UPDATE ON chats
    FOR EACH ROW
    EXECUTE FUNCTION set_last_updated_timestamp();
END $$;

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$;

-- Function to handle updated_at timestamp updates
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Function to update chat timestamp when messages are added
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE chats 
  SET updated_at = CURRENT_TIMESTAMP 
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;

------------------------------------------
-- Admin Management Tables
------------------------------------------

-- Create admin_users table to track which users have admin privileges
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_by UUID REFERENCES auth.users(id)
);

-- Add comments to explain table purpose
COMMENT ON TABLE admin_users IS 'Tracks users with administrative privileges';

-- Create admin_settings table for global app settings
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  read_only_doc_dashboard BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_by UUID REFERENCES auth.users(id)
);

-- Add comments to explain table purpose
COMMENT ON TABLE admin_settings IS 'Global application settings controlled by admins';
COMMENT ON COLUMN admin_settings.read_only_doc_dashboard IS 'Controls whether the document dashboard is visible in read-only mode';

-- Seed initial admin settings record if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_settings LIMIT 1) THEN
    INSERT INTO admin_settings (read_only_doc_dashboard) VALUES (false);
  END IF;
END $$;

-- Enable Row Level Security on admin tables
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Create a better function to check admin status via session or auth.uid
CREATE OR REPLACE FUNCTION check_admin_status()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  admin_session_id UUID;
  current_user_id UUID;
BEGIN
  -- Get current authenticated user ID
  current_user_id := auth.uid();
  
  -- First try using auth.uid to check if current user is an admin
  IF EXISTS (
    SELECT 1 FROM admin_users WHERE id = current_user_id
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- If not found by auth.uid, try using admin_session cookie
  BEGIN
    admin_session_id := current_setting('request.cookie.admin_session', true)::UUID;
    
    RETURN EXISTS (
      SELECT 1 FROM admin_users WHERE id = admin_session_id
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
END;
$$;

-- Create separate function to allow RPC calls for API
CREATE OR REPLACE FUNCTION is_admin(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE id = user_uuid
  );
END;
$$;

-- Service role policies (always needed)
DROP POLICY IF EXISTS "Service role can manage admin users" ON admin_users;
CREATE POLICY "Service role can manage admin users"
  ON admin_users FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage admin settings" ON admin_settings;
CREATE POLICY "Service role can manage admin settings"
  ON admin_settings FOR ALL
  USING (auth.role() = 'service_role');

-- Admin-only policies (secured)
DROP POLICY IF EXISTS "Admin users can view admin users" ON admin_users;
CREATE POLICY "Admin users can view admin users"
  ON admin_users FOR SELECT
  USING (check_admin_status() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin users can update admin users" ON admin_users;
CREATE POLICY "Admin users can update admin users"
  ON admin_users FOR INSERT
  WITH CHECK (check_admin_status() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin users can delete admin users" ON admin_users;
CREATE POLICY "Admin users can delete admin users"
  ON admin_users FOR DELETE
  USING (check_admin_status() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin users can view settings" ON admin_settings;
CREATE POLICY "Admin users can view settings"
  ON admin_settings FOR SELECT
  USING (check_admin_status() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin users can update settings" ON admin_settings;
CREATE POLICY "Admin users can update settings"
  ON admin_settings FOR UPDATE
  USING (check_admin_status() OR auth.role() = 'service_role');

------------------------------------------
-- WhatsApp Integration Tables
------------------------------------------
-- Note: This section adds WhatsApp messaging capabilities via Baileys integration

-- WhatsApp sessions table
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  phone_number TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  status TEXT CHECK (status IN ('connecting', 'connected', 'disconnected', 'qr_pending', 'failed')) DEFAULT 'connecting',
  qr_code TEXT,
  qr_expires_at TIMESTAMP WITH TIME ZONE,
  koyeb_session_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, phone_number)
);

-- WhatsApp conversations mapping
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  whatsapp_jid TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  contact_name TEXT,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, whatsapp_jid)
);

-- WhatsApp message tracking
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT NOT NULL UNIQUE,
  direction TEXT CHECK (direction IN ('incoming', 'outgoing')) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user_id ON whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status ON whatsapp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_user_id ON whatsapp_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_chat_id ON whatsapp_conversations(chat_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_jid ON whatsapp_conversations(whatsapp_jid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at);

-- Additional performance indexes for foreign keys
CREATE INDEX IF NOT EXISTS idx_admin_settings_updated_by ON admin_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_admin_users_created_by ON admin_users(created_by);

-- Enable Row Level Security
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for whatsapp_sessions
DROP POLICY IF EXISTS "Users can view own WhatsApp sessions" ON whatsapp_sessions;
CREATE POLICY "Users can view own WhatsApp sessions" ON whatsapp_sessions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own WhatsApp sessions" ON whatsapp_sessions;
CREATE POLICY "Users can insert own WhatsApp sessions" ON whatsapp_sessions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own WhatsApp sessions" ON whatsapp_sessions;
CREATE POLICY "Users can update own WhatsApp sessions" ON whatsapp_sessions
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own WhatsApp sessions" ON whatsapp_sessions;
CREATE POLICY "Users can delete own WhatsApp sessions" ON whatsapp_sessions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- RLS Policies for whatsapp_conversations
DROP POLICY IF EXISTS "Users can view own WhatsApp conversations" ON whatsapp_conversations;
CREATE POLICY "Users can view own WhatsApp conversations" ON whatsapp_conversations
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own WhatsApp conversations" ON whatsapp_conversations;
CREATE POLICY "Users can insert own WhatsApp conversations" ON whatsapp_conversations
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own WhatsApp conversations" ON whatsapp_conversations;
CREATE POLICY "Users can update own WhatsApp conversations" ON whatsapp_conversations
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own WhatsApp conversations" ON whatsapp_conversations;
CREATE POLICY "Users can delete own WhatsApp conversations" ON whatsapp_conversations
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- RLS Policies for whatsapp_messages
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON whatsapp_messages;
CREATE POLICY "Users can view messages in their conversations" ON whatsapp_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM whatsapp_conversations wc
      WHERE wc.id = whatsapp_messages.conversation_id
      AND wc.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON whatsapp_messages;
CREATE POLICY "Users can insert messages in their conversations" ON whatsapp_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM whatsapp_conversations wc
      WHERE wc.id = whatsapp_messages.conversation_id
      AND wc.user_id = (SELECT auth.uid())
    )
  );

-- Trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_whatsapp_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER update_whatsapp_sessions_timestamp
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_timestamp();

CREATE TRIGGER update_whatsapp_conversations_timestamp
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_timestamp();

-- Comments for documentation
COMMENT ON TABLE whatsapp_sessions IS 'Stores WhatsApp session data for each user connection';
COMMENT ON TABLE whatsapp_conversations IS 'Maps WhatsApp conversations to ChatRAG chats';
COMMENT ON TABLE whatsapp_messages IS 'Tracks WhatsApp message delivery status';

COMMENT ON COLUMN whatsapp_sessions.koyeb_session_data IS 'Session data from Koyeb Baileys instance';
COMMENT ON COLUMN whatsapp_conversations.whatsapp_jid IS 'WhatsApp JID (phone number with @s.whatsapp.net)';
COMMENT ON COLUMN whatsapp_messages.status IS 'Message delivery status tracking';

------------------------------------------
-- User Preferences Table
------------------------------------------
-- Note: This table stores user-specific preferences like selected AI model

-- Create user preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_model TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own preferences" ON user_preferences
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own preferences" ON user_preferences
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- Service role can manage all preferences
CREATE POLICY "Service role can manage user preferences" ON user_preferences
  FOR ALL USING (auth.role() = 'service_role');

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE user_preferences IS 'Stores user-specific preferences and settings';
COMMENT ON COLUMN user_preferences.selected_model IS 'The AI model selected by the user in the webapp';

------------------------------------------
-- RAG Optimization Functions and Indexes
------------------------------------------

-- Enable pg_trgm extension for improved text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create RPC function for keyword-based chunk search
-- This function performs full-text search on document chunks with similarity scoring
CREATE OR REPLACE FUNCTION search_chunks_by_keywords(
  search_query TEXT,
  match_limit INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH keyword_array AS (
    SELECT unnest(string_to_array(lower(search_query), ' ')) AS keyword
  ),
  ranked_chunks AS (
    SELECT 
      dc.id as chunk_id,
      dc.document_id,
      dc.content,
      -- Calculate similarity based on keyword matches
      (
        SELECT COUNT(DISTINCT k.keyword)::FLOAT / 
               GREATEST(array_length(string_to_array(lower(search_query), ' '), 1), 1)::FLOAT
        FROM keyword_array k
        WHERE lower(dc.content) LIKE '%' || k.keyword || '%'
      ) AS match_score
    FROM document_chunks dc
    WHERE EXISTS (
      SELECT 1 
      FROM keyword_array k 
      WHERE lower(dc.content) LIKE '%' || k.keyword || '%'
    )
  )
  SELECT 
    rc.chunk_id,
    rc.document_id,
    rc.content,
    rc.match_score AS similarity
  FROM ranked_chunks rc
  WHERE rc.match_score > 0
  ORDER BY rc.match_score DESC
  LIMIT match_limit;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION search_chunks_by_keywords(TEXT, INT) TO authenticated;

-- Create trigram GIN index to improve text search performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_trgm 
ON document_chunks 
USING gin (content gin_trgm_ops);

-- Add chunk_index column for proper chunk ordering within documents
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'document_chunks' 
    AND column_name = 'chunk_index'
  ) THEN
    ALTER TABLE document_chunks ADD COLUMN chunk_index INT;
    
    -- Update existing chunks with sequential indices per document
    WITH numbered_chunks AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY id) - 1 AS idx
      FROM document_chunks
    )
    UPDATE document_chunks dc
    SET chunk_index = nc.idx
    FROM numbered_chunks nc
    WHERE dc.id = nc.id;
  END IF;
END $$;

-- Add comment to explain the optimization
COMMENT ON FUNCTION search_chunks_by_keywords(TEXT, INT) IS 'Optimized keyword search with similarity scoring for RAG retrieval';
COMMENT ON COLUMN document_chunks.chunk_index IS 'Sequential index for chunk ordering within each document (0-based)';

------------------------------------------
-- NANGO INTEGRATION TABLES
------------------------------------------

-- Table: nango_connections
-- Stores user connections to external document providers
CREATE TABLE IF NOT EXISTS nango_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_enabled BOOLEAN DEFAULT true,
  
  -- Folder-specific sync fields
  sync_folder_id TEXT,
  sync_folder_name TEXT,
  sync_folder_path TEXT,
  
  -- File-specific sync fields
  sync_file_ids TEXT[],
  sync_file_names TEXT[],
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_provider UNIQUE (user_id, provider)
);

-- Table: nango_sync_records
-- Tracks individual file sync status
CREATE TABLE IF NOT EXISTS nango_sync_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'disconnected')),
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_file UNIQUE (user_id, file_id)
);

-- Indexes for nango_connections
CREATE INDEX IF NOT EXISTS idx_nango_connections_user_id
  ON nango_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_nango_connections_status
  ON nango_connections(status);

CREATE INDEX IF NOT EXISTS idx_nango_connections_provider
  ON nango_connections(provider);

CREATE INDEX IF NOT EXISTS idx_nango_connections_sync_folder
  ON nango_connections(sync_folder_id);

-- Indexes for nango_sync_records
CREATE INDEX IF NOT EXISTS idx_nango_sync_records_user_id
  ON nango_sync_records(user_id);

CREATE INDEX IF NOT EXISTS idx_nango_sync_records_status
  ON nango_sync_records(status);

CREATE INDEX IF NOT EXISTS idx_nango_sync_records_document_id
  ON nango_sync_records(document_id);

CREATE INDEX IF NOT EXISTS idx_nango_sync_records_connection
  ON nango_sync_records(connection_id, provider);

-- Enable RLS for nango tables
ALTER TABLE nango_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE nango_sync_records ENABLE ROW LEVEL SECURITY;

-- Users can only see their own connections
DROP POLICY IF EXISTS "Users can view own connections" ON nango_connections;
CREATE POLICY "Users can view own connections"
  ON nango_connections FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own connections" ON nango_connections;
CREATE POLICY "Users can insert own connections"
  ON nango_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own connections" ON nango_connections;
CREATE POLICY "Users can update own connections"
  ON nango_connections FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own connections" ON nango_connections;
CREATE POLICY "Users can delete own connections"
  ON nango_connections FOR DELETE
  USING (auth.uid() = user_id);

-- Users can only see their own sync records
DROP POLICY IF EXISTS "Users can view own sync records" ON nango_sync_records;
CREATE POLICY "Users can view own sync records"
  ON nango_sync_records FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own sync records" ON nango_sync_records;
CREATE POLICY "Users can insert own sync records"
  ON nango_sync_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own sync records" ON nango_sync_records;
CREATE POLICY "Users can update own sync records"
  ON nango_sync_records FOR UPDATE
  USING (auth.uid() = user_id);

-- Grant service role access (for webhook and sync operations)
GRANT ALL ON nango_connections TO service_role;
GRANT ALL ON nango_sync_records TO service_role;

------------------------------------------
-- CONNECTOR CONFIG TABLES
------------------------------------------

-- Table: connector_config
-- Configuration for supported connectors
CREATE TABLE IF NOT EXISTS connector_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  show_on_dashboard BOOLEAN DEFAULT true,
  button_label TEXT,
  description TEXT,
  icon_url TEXT,
  supported_file_types TEXT[] DEFAULT ARRAY['pdf', 'doc', 'docx', 'txt'],
  max_files_per_sync INTEGER DEFAULT 100,
  oauth_client_id TEXT,
  oauth_client_secret TEXT,
  oauth_scopes TEXT[],
  config_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table: connector_feature_settings
-- Global connector feature settings
CREATE TABLE IF NOT EXISTS connector_feature_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_enabled BOOLEAN DEFAULT true,
  show_on_dashboard BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_connector_config_provider ON connector_config(provider);
CREATE INDEX IF NOT EXISTS idx_connector_feature_settings_id ON connector_feature_settings(id);

-- Insert default configurations
INSERT INTO connector_config (provider, enabled, show_on_dashboard, button_label, description)
VALUES
  ('google-drive', true, true, 'Connect Google Drive', 'Import files from your Google Drive'),
  ('notion', true, true, 'Connect Notion', 'Sync pages from your Notion workspace'),
  ('dropbox', true, true, 'Connect Dropbox', 'Sync documents from Dropbox')
ON CONFLICT (provider) DO NOTHING;

-- Insert default feature settings
INSERT INTO connector_feature_settings (feature_enabled, show_on_dashboard)
VALUES (true, true)
ON CONFLICT DO NOTHING;

-- Enable RLS for connector tables
ALTER TABLE connector_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_feature_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only policy for connector_config write
CREATE POLICY connector_config_admin
  ON connector_config
  FOR ALL
  USING (auth.jwt()->>'role' = 'admin')
  WITH CHECK (auth.jwt()->>'role' = 'admin');

-- All users can read connector_config
CREATE POLICY connector_config_read
  ON connector_config
  FOR SELECT
  USING (true);

-- Admin-only policy for connector_feature_settings write
CREATE POLICY connector_feature_settings_admin
  ON connector_feature_settings
  FOR ALL
  USING (auth.jwt()->>'role' = 'admin')
  WITH CHECK (auth.jwt()->>'role' = 'admin');

-- All users can read connector_feature_settings
CREATE POLICY connector_feature_settings_read
  ON connector_feature_settings
  FOR SELECT
  USING (true);

-- Helper function to get connection statistics
CREATE OR REPLACE FUNCTION get_nango_stats(p_user_id UUID)
RETURNS TABLE (
  provider TEXT,
  status TEXT,
  last_sync_at TIMESTAMPTZ,
  synced_files_count BIGINT,
  failed_files_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.provider,
    nc.status,
    nc.last_sync_at,
    COUNT(CASE WHEN nsr.status = 'completed' THEN 1 END) AS synced_files_count,
    COUNT(CASE WHEN nsr.status = 'failed' THEN 1 END) AS failed_files_count
  FROM nango_connections nc
  LEFT JOIN nango_sync_records nsr ON nc.connection_id = nsr.connection_id
  WHERE nc.user_id = p_user_id
  GROUP BY nc.provider, nc.status, nc.last_sync_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_nango_stats(UUID) TO authenticated;
------------------------------------------
-- Document URL Management Helper Functions
------------------------------------------

-- Function to update metadata for a document by filename
-- This is useful for adding external URLs to existing documents
CREATE OR REPLACE FUNCTION update_document_url_by_filename(doc_filename TEXT, url TEXT)
RETURNS void AS $$
DECLARE
    doc_id UUID;
    current_metadata JSONB;
BEGIN
    SELECT id, metadata INTO doc_id, current_metadata FROM documents WHERE filename = doc_filename LIMIT 1;
    IF doc_id IS NOT NULL THEN
        UPDATE documents 
        SET metadata = jsonb_set(COALESCE(current_metadata, '{}'::jsonb), '{external_url}', to_jsonb(url))
        WHERE id = doc_id;
        RAISE NOTICE 'Updated URL for document: % (ID: %)', doc_filename, doc_id;
    ELSE
        RAISE NOTICE 'Document not found: %', doc_filename;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Example usage (commented out - uncomment and modify as needed):
-- SELECT update_document_url_by_filename('example-document.pdf', 'https://example.com/source-page');
