-- ============================================
-- ChatRAG Multi-Tenant Complete Setup
-- ============================================
--
-- Three-Tier Workspace Architecture:
-- 1. Personal Workspace (Flat) - No organization, user_id isolation
-- 2. Personal Projects - is_personal: true, owner only, can be made collaborative
-- 3. Collaborative Projects - is_personal: false, multi-member (via shareOrganization)
--
-- Features:
-- - Hybrid isolation model (user_id + organization_id)
-- - Organization-based multi-tenancy with RLS
-- - Collaborative projects with role-based access
-- - Storage quotas and usage tracking
-- - Subscription tier enforcement
-- - Vector database optimization (HNSW indexes)
-- - Personal project to collaborative conversion (shareOrganization)
--
-- Date: 2025-11-29
-- Version: 3.2 (Fixed organization creation + multiple workspaces)
-- ============================================

BEGIN;

------------------------------------------
-- EXTENSIONS
------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

------------------------------------------
-- ORGANIZATIONS TABLE (3-Tier Support)
------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Personal vs Collaborative Project Flag (MEANINGFUL)
  -- true: Personal project (owner only, can be made collaborative via shareOrganization)
  -- false: Collaborative project (multi-member, via conversion from personal)
  is_personal BOOLEAN DEFAULT true,

  -- Subscription & Billing
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'enterprise', 'custom')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  polar_subscription_id TEXT,

  -- Storage Quotas
  storage_used_bytes BIGINT DEFAULT 0,
  storage_limit_bytes BIGINT DEFAULT 1073741824, -- 1GB for free tier

  -- Document Limits (per tier)
  max_documents INT DEFAULT 50,
  max_monthly_messages INT DEFAULT 100,
  max_team_members INT DEFAULT 1, -- 1 for personal, 5+ for teams

  -- Organization Settings
  settings JSONB DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  -- Constraint: Personal organizations must have an owner
  CONSTRAINT personal_org_must_have_owner CHECK (
    (is_personal = true AND owner_id IS NOT NULL)
    OR
    (is_personal = false)
  )
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_tier ON organizations(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_organizations_personal ON organizations(owner_id, is_personal) WHERE is_personal = true;

-- NOTE: We intentionally do NOT create a unique constraint on (owner_id, is_personal)
-- Users can create MULTIPLE personal projects (workspaces)
-- The 3-tier architecture allows:
-- 1. Flat personal workspace (no organization)
-- 2. Multiple personal projects (is_personal=true)
-- 3. Collaborative projects (is_personal=false, via shareOrganization)

COMMENT ON TABLE organizations IS 'Organizations for both personal projects (is_personal=true) and collaborative projects (is_personal=false via shareOrganization)';
COMMENT ON COLUMN organizations.is_personal IS 'True for personal projects (owner only, can be converted), false for collaborative projects (multi-member, via conversion)';
COMMENT ON COLUMN organizations.max_team_members IS 'Team member limit: 1 for personal projects, 5+ for collaborative projects';

------------------------------------------
-- ORGANIZATION MEMBERS TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(role);

COMMENT ON TABLE organization_members IS 'Team members with role-based access control';
COMMENT ON COLUMN organization_members.role IS 'owner: full control, admin: manage team, member: read/write, viewer: read-only';

------------------------------------------
-- TEAM INVITATIONS TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  UNIQUE(organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_org_id ON team_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON team_invitations(status);

COMMENT ON TABLE team_invitations IS 'Pending team invitations with expiration (blocked for personal projects, only for collaborative projects)';

------------------------------------------
-- DOCUMENTS TABLE (HYBRID ISOLATION)
------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',

  -- HYBRID ISOLATION MODEL
  -- user_id: Always required (document owner)
  -- organization_id: NULL for flat personal, set for organizations
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id),

  -- Content classification fields
  content_type TEXT CHECK (content_type IN ('pricing', 'faq', 'policy', 'guide', 'announcement')),
  slug TEXT,
  is_public BOOLEAN DEFAULT true,

  -- Source tracking (for Nango integration)
  source TEXT DEFAULT 'upload' CHECK (source IN ('upload', 'google-drive', 'notion', 'dropbox')),
  source_provider TEXT,
  source_file_id TEXT,
  source_connection_id TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  -- Isolation constraint: must be EITHER personal (user_id + NULL org) OR organizational
  CONSTRAINT documents_isolation_check CHECK (
    (user_id IS NOT NULL AND organization_id IS NULL) -- Personal workspace (flat)
    OR
    (organization_id IS NOT NULL) -- Personal project or team workspace
  )
);

CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

-- Hybrid indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_documents_personal ON documents(user_id) WHERE organization_id IS NULL;

-- Content type and slug indexes (for document dashboard)
CREATE INDEX IF NOT EXISTS documents_org_type_slug_idx ON documents(organization_id, content_type, slug, is_public);
CREATE UNIQUE INDEX IF NOT EXISTS documents_org_type_slug_ux ON documents(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), content_type, slug);

-- Source tracking indexes
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_source_provider ON documents(source_provider);

COMMENT ON TABLE documents IS 'Documents with 3-tier isolation: flat personal (user_id, org_id=NULL), personal project (org_id + is_personal=true), or collaborative (org_id + is_personal=false)';
COMMENT ON COLUMN documents.user_id IS 'Document owner (required). For personal docs, this is the only identifier. For organizational docs, combined with organization_id';
COMMENT ON COLUMN documents.organization_id IS 'Organization context (NULL for flat personal workspace, UUID for personal/collaborative projects)';

------------------------------------------
-- DOCUMENT CHUNKS TABLE (HYBRID ISOLATION)
------------------------------------------

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  chunk_index INT,
  metadata JSONB DEFAULT '{}',

  -- Multi-tenant field (nullable for flat personal workspace)
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_organization_id ON document_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- Optimized HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 64, ef_construction = 200);

-- Composite index for org-scoped vector search
CREATE INDEX IF NOT EXISTS idx_chunks_org_embedding ON document_chunks(organization_id, id);

COMMENT ON COLUMN document_chunks.embedding IS 'Vector embedding (1536 dimensions) - supports text-embedding-ada-002 and text-embedding-3-small';
COMMENT ON COLUMN document_chunks.organization_id IS 'Denormalized org_id for fast filtering (NULL for flat personal workspace)';
COMMENT ON COLUMN document_chunks.chunk_index IS 'Sequential index for chunk ordering within each document (0-based)';

------------------------------------------
-- FOLDERS TABLE (HYBRID ISOLATION)
------------------------------------------

CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  pinned BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_organization_id ON folders(organization_id);
CREATE INDEX IF NOT EXISTS idx_folders_pinned ON folders(pinned);
CREATE INDEX IF NOT EXISTS idx_folders_personal ON folders(user_id) WHERE organization_id IS NULL;

COMMENT ON TABLE folders IS 'User folders within organizations for chat organization (supports flat personal workspace)';

------------------------------------------
-- CHATS TABLE (HYBRID ISOLATION)
------------------------------------------

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  messages JSONB NOT NULL,
  pinned BOOLEAN DEFAULT FALSE,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  shared BOOLEAN DEFAULT false,
  share_id UUID UNIQUE DEFAULT NULL,
  is_shared BOOLEAN DEFAULT false,
  share_settings JSONB,
  mcp_tool_states JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_organization_id ON chats(organization_id);
CREATE INDEX IF NOT EXISTS idx_chats_folder_id ON chats(folder_id);
CREATE INDEX IF NOT EXISTS idx_chats_pinned ON chats(pinned);
CREATE INDEX IF NOT EXISTS idx_chats_share_id ON chats(share_id) WHERE shared = true;
CREATE INDEX IF NOT EXISTS idx_chats_user_id_updated_at_desc ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_org_updated_at ON chats(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_personal ON chats(user_id) WHERE organization_id IS NULL;

COMMENT ON TABLE chats IS 'User chats with hybrid isolation: personal or organizational context';
COMMENT ON COLUMN chats.organization_id IS 'Organization context (NULL for flat personal workspace)';

------------------------------------------
-- USAGE TRACKING TABLES
------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  date DATE NOT NULL,

  -- Usage metrics
  chat_messages INT DEFAULT 0,
  documents_processed INT DEFAULT 0,
  vector_searches INT DEFAULT 0,
  tokens_used BIGINT DEFAULT 0,
  api_calls INT DEFAULT 0,
  storage_bytes_added BIGINT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  UNIQUE(organization_id, user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_org_date ON tenant_usage(organization_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_user_date ON tenant_usage(user_id, date DESC);

COMMENT ON TABLE tenant_usage IS 'Daily usage metrics per organization and user for quota enforcement';

------------------------------------------
-- API USAGE LOGS TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INT,
  response_time_ms INT,
  tokens_used INT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_org_id ON api_usage_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);

COMMENT ON TABLE api_usage_logs IS 'API request logs for monitoring and analytics';

------------------------------------------
-- ORGANIZATION DOMAINS TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS organization_domains (
  domain TEXT PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organization_domains_org_id ON organization_domains(organization_id);

COMMENT ON TABLE organization_domains IS 'Domain-based organization routing (e.g., acme.chatrag.app → acme organization)';

------------------------------------------
-- SUBSCRIPTIONS TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Payment provider info
  polar_subscription_id TEXT,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  payment_provider TEXT CHECK (payment_provider IN ('stripe', 'polar')) NOT NULL,

  -- Subscription details
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON subscriptions(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS pending_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_pending_subscriptions_checkout_id ON pending_subscriptions(checkout_id);

------------------------------------------
-- USER PREFERENCES TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_model TEXT,
  current_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

COMMENT ON COLUMN user_preferences.current_organization_id IS 'Currently selected organization for the user (NULL for flat personal workspace)';

------------------------------------------
-- ADMIN TABLES
------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_created_by ON admin_users(created_by);

CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  read_only_doc_dashboard BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_by UUID REFERENCES auth.users(id)
);

-- Seed initial admin settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_settings LIMIT 1) THEN
    INSERT INTO admin_settings (read_only_doc_dashboard) VALUES (false);
  END IF;
END $$;

------------------------------------------
-- TOOL EXECUTION STATES TABLE
------------------------------------------

CREATE TABLE IF NOT EXISTS tool_execution_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  message_id BIGINT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'running', 'completed', 'error', 'cancelled')),
  tool_params JSONB,
  tool_result JSONB,
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),

  UNIQUE(chat_id, message_id, tool_call_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_execution_states_chat_id ON tool_execution_states(chat_id);
CREATE INDEX IF NOT EXISTS idx_tool_execution_states_status ON tool_execution_states(status);

------------------------------------------
-- WHATSAPP INTEGRATION TABLES
------------------------------------------

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user_id ON whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_org_id ON whatsapp_sessions(organization_id);

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

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_user_id ON whatsapp_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_chat_id ON whatsapp_conversations(chat_id);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT NOT NULL UNIQUE,
  direction TEXT CHECK (direction IN ('incoming', 'outgoing')) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id ON whatsapp_messages(conversation_id);

------------------------------------------
-- STORAGE BUCKETS
------------------------------------------

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('chat-images', 'chat-images', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

DO $$
BEGIN
  UPDATE storage.buckets
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'model/gltf-binary']
  WHERE id = 'chat-images';
END $$;

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('backgrounds', 'backgrounds', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('3d-models', '3d-models', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('chat-videos', 'chat-videos', true, 52428800)
  ON CONFLICT (id) DO NOTHING;
END $$;

------------------------------------------
-- RPC FUNCTIONS
------------------------------------------

-- Helper function to check organization membership (prevents RLS recursion)
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID, check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id AND user_id = check_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION is_org_member IS 'Helper function to check organization membership without causing RLS recursion';

GRANT EXECUTE ON FUNCTION is_org_member(UUID, UUID) TO authenticated, anon;

-- Safe organization creation (creates org AND adds owner as member atomically)
CREATE OR REPLACE FUNCTION create_organization_safe(
  p_name TEXT,
  p_slug TEXT,
  p_owner_id UUID,
  p_is_personal BOOLEAN DEFAULT true
)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations;
  v_max_team_members INT;
BEGIN
  -- Set team member limit based on organization type
  -- Personal projects: 1 member (owner only)
  -- Collaborative projects: 5 members (can invite)
  IF p_is_personal THEN
    v_max_team_members := 1;
  ELSE
    v_max_team_members := 5;
  END IF;

  -- Insert the organization
  INSERT INTO organizations (
    name,
    slug,
    owner_id,
    is_personal,
    max_team_members,
    subscription_tier,
    storage_limit_bytes,
    max_documents,
    max_monthly_messages
  ) VALUES (
    p_name,
    p_slug,
    p_owner_id,
    p_is_personal,
    v_max_team_members,
    'free',
    1073741824,  -- 1GB default
    50,          -- 50 documents default
    100          -- 100 messages default
  )
  RETURNING * INTO v_org;

  -- IMPORTANT: Also add the creator as owner member
  -- This ensures the user can immediately access the organization
  INSERT INTO organization_members (
    organization_id,
    user_id,
    role
  ) VALUES (
    v_org.id,
    p_owner_id,
    'owner'
  );

  RETURN v_org;
END;
$$;

COMMENT ON FUNCTION create_organization_safe IS 'Safely creates an organization and adds the creator as owner member. Uses SECURITY DEFINER to bypass RLS.';

GRANT EXECUTE ON FUNCTION create_organization_safe TO authenticated;

-- Vector search with organization filter
CREATE OR REPLACE FUNCTION match_documents_by_organization(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  org_id uuid
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE dc.organization_id = org_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_documents_by_organization IS 'Organization-scoped vector similarity search';

-- ============================================
-- WORKSPACE-SCOPED VECTOR SEARCH (3-TIER SUPPORT)
-- ============================================
-- This function performs vector similarity search with workspace isolation
-- supporting all three tiers:
-- 1. Personal Workspace (Flat): p_org_id = NULL, filters by user_id only
-- 2. Personal Projects: p_org_id set, is_personal = true
-- 3. Team Workspaces: p_org_id set, is_personal = false

CREATE OR REPLACE FUNCTION public.match_documents_by_workspace(
  p_query_embedding vector(1536),
  p_match_count integer,
  p_min_similarity double precision,
  p_org_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity double precision,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> p_query_embedding) as similarity,
    dc.metadata
  FROM document_chunks dc
  INNER JOIN documents d ON d.id = dc.document_id
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> p_query_embedding) > p_min_similarity
    AND (
      -- Personal workspace: user owns document and no organization
      (p_org_id IS NULL AND d.user_id = p_user_id AND d.organization_id IS NULL)
      OR
      -- Team workspace: document belongs to organization
      (p_org_id IS NOT NULL AND d.organization_id = p_org_id)
    )
  ORDER BY dc.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.match_documents_by_workspace TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_documents_by_workspace TO anon;

COMMENT ON FUNCTION public.match_documents_by_workspace IS 
  'Performs workspace-scoped vector similarity search. Filters by personal workspace (user_id + org_id=NULL) or team workspace (organization_id).';

-- Legacy RAG function (for backward compatibility)
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_count integer,
  similarity_threshold double precision
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content text,
  similarity double precision,
  metadata jsonb
)
LANGUAGE plpgsql
SET search_path = 'pg_catalog', 'public'
AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Get user's current organization if in multi-tenant mode
  SELECT current_organization_id INTO current_org_id
  FROM user_preferences
  WHERE user_id = current_user_id;
  
  -- Return chunks based on organization context
  RETURN QUERY
  SELECT
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.metadata
  FROM document_chunks dc
  INNER JOIN documents d ON dc.document_id = d.id
  WHERE dc.embedding IS NOT NULL 
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
    AND (
      -- Personal workspace: match null org_id docs
      (current_org_id IS NULL AND dc.organization_id IS NULL)
      OR
      -- Organization workspace: match org docs OR personal docs owned by user
      (current_org_id IS NOT NULL AND (
        dc.organization_id = current_org_id
        OR (dc.organization_id IS NULL AND d.user_id = current_user_id)
      ))
    )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_document_chunks IS 'Legacy RAG vector search with automatic organization detection from user preferences';

-- Simplified org-scoped chunk search
CREATE OR REPLACE FUNCTION match_document_chunks_by_org(
  p_org_id uuid,
  p_query_embedding vector(1536),
  p_match_count integer DEFAULT 8,
  p_min_similarity double precision DEFAULT 0.2
)
RETURNS TABLE (
  document_id uuid,
  chunk_id uuid,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.document_id,
    dc.id as chunk_id,
    dc.content,
    1 - (dc.embedding <=> p_query_embedding) as similarity
  FROM document_chunks dc
  WHERE (dc.organization_id = p_org_id OR dc.organization_id IS NULL)
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY dc.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION match_document_chunks_by_org IS 'Organization-scoped chunk search with fallback to global documents';

-- Document retrieval by type and slug (for document dashboard)
CREATE OR REPLACE FUNCTION get_documents_by_type_slug(
  p_org_id uuid,
  p_content_type text,
  p_slug text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  content text,
  slug text,
  is_tenant boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  WITH tenant_docs AS (
    SELECT d.id, d.organization_id, d.content, d.slug, true as is_tenant
    FROM documents d
    WHERE d.organization_id = p_org_id
      AND d.content_type = p_content_type
      AND (p_slug IS NULL OR d.slug = p_slug)
    ORDER BY d.created_at DESC
  ),
  global_docs AS (
    SELECT d.id, d.organization_id, d.content, d.slug, false as is_tenant
    FROM documents d
    WHERE d.organization_id IS NULL
      AND d.content_type = p_content_type
      AND (p_slug IS NULL OR d.slug = p_slug)
      AND NOT EXISTS (SELECT 1 FROM tenant_docs)
    ORDER BY d.created_at DESC
  )
  SELECT * FROM tenant_docs
  UNION ALL
  SELECT * FROM global_docs
  LIMIT 10;
$$;

COMMENT ON FUNCTION get_documents_by_type_slug IS 'Retrieve documents by type and slug with tenant/global fallback';

-- Workspace-aware document retrieval
CREATE OR REPLACE FUNCTION get_documents_by_type_slug_workspace(
  p_org_id uuid,
  p_user_id uuid,
  p_content_type text,
  p_slug text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  user_id uuid,
  content text,
  slug text,
  is_tenant boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  (
    SELECT d.id, d.organization_id, d.user_id, d.content, d.slug, true as is_tenant
    FROM documents d
    WHERE p_org_id IS NOT NULL
      AND d.organization_id = p_org_id
      AND d.content_type = p_content_type
      AND (p_slug IS NULL OR d.slug = p_slug)
  )
  UNION ALL
  (
    SELECT d.id, d.organization_id, d.user_id, d.content, d.slug, false as is_tenant
    FROM documents d
    WHERE p_org_id IS NULL
      AND d.organization_id IS NULL
      AND d.user_id = p_user_id
      AND d.content_type = p_content_type
      AND (p_slug IS NULL OR d.slug = p_slug)
  )
  LIMIT 10;
$$;

COMMENT ON FUNCTION get_documents_by_type_slug_workspace IS '3-tier workspace-aware document retrieval by type and slug';

-- Get workspace context from domain or user preferences
CREATE OR REPLACE FUNCTION get_workspace_context(
  p_domain text,
  p_user uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  org_id uuid;
BEGIN
  -- First check domain routing
  SELECT od.organization_id INTO org_id
  FROM organization_domains od
  WHERE od.domain = p_domain;

  -- Fallback to user preferences
  IF org_id IS NULL THEN
    SELECT up.current_organization_id INTO org_id
    FROM user_preferences up
    WHERE up.user_id = p_user;
  END IF;

  RETURN org_id;
END;
$$;

COMMENT ON FUNCTION get_workspace_context(text, uuid) IS 'Resolve organization context from domain or user preferences';

-- Get user organization IDs
CREATE OR REPLACE FUNCTION get_user_org_ids(check_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = check_user_id;
$$;

COMMENT ON FUNCTION get_user_org_ids IS 'Get all organization IDs for a user';

-- Get user role in organization
CREATE OR REPLACE FUNCTION get_user_role_in_org(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM organization_members
  WHERE organization_id = org_id
    AND user_id = auth.uid();

  RETURN user_role;
END;
$$;

COMMENT ON FUNCTION get_user_role_in_org IS 'Get authenticated user role in specific organization';

-- Get user current organization
CREATE OR REPLACE FUNCTION get_user_current_org()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_id UUID;
BEGIN
  SELECT current_organization_id INTO org_id
  FROM user_preferences
  WHERE user_id = auth.uid();

  IF org_id IS NULL THEN
    SELECT organization_id INTO org_id
    FROM organization_members
    WHERE user_id = auth.uid()
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  RETURN org_id;
END;
$$;

COMMENT ON FUNCTION get_user_current_org IS 'Get current organization for authenticated user with fallback to first joined org';

-- Check if user can view org member
CREATE OR REPLACE FUNCTION can_view_org_member(member_user_id uuid, member_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  -- User can view if it's their own membership
  SELECT member_user_id = auth.uid()
  -- Or if they're in the same organization
  OR EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = member_org_id
      AND om.user_id = auth.uid()
  )
  -- Or if they own the organization
  OR EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = member_org_id
      AND o.owner_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION can_view_org_member IS 'Check if user has permission to view organization member';

-- Folder management functions
CREATE OR REPLACE FUNCTION delete_folder(
  folder_uuid uuid,
  delete_chats boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = folder_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this folder';
  END IF;

  IF delete_chats THEN
    DELETE FROM chats
    WHERE folder_id = folder_uuid AND user_id = auth.uid();
  ELSE
    UPDATE chats
    SET folder_id = NULL
    WHERE folder_id = folder_uuid AND user_id = auth.uid();
  END IF;

  DELETE FROM folders
  WHERE id = folder_uuid AND user_id = auth.uid();

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION delete_folder IS 'Delete folder and optionally all chats within it';

CREATE OR REPLACE FUNCTION get_folder_stats(folder_uuid uuid)
RETURNS TABLE (
  chat_count bigint,
  last_updated timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
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

COMMENT ON FUNCTION get_folder_stats IS 'Get statistics for a folder (chat count and last update)';

CREATE OR REPLACE FUNCTION move_chats_to_folder(
  chat_ids uuid[],
  target_folder_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF target_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = target_folder_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to use this folder';
  END IF;

  UPDATE chats
  SET folder_id = target_folder_id,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = ANY(chat_ids)
    AND user_id = auth.uid();

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION move_chats_to_folder IS 'Move multiple chats to a folder';

-- Chat sharing functions
CREATE OR REPLACE FUNCTION share_chat(
  chat_uuid uuid,
  settings jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_share_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chats
    WHERE id = chat_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to share this chat';
  END IF;

  SELECT gen_random_uuid() INTO new_share_id;

  UPDATE chats
  SET is_shared = TRUE,
      share_id = new_share_id,
      share_settings = settings
  WHERE id = chat_uuid;

  RETURN new_share_id;
END;
$$;

COMMENT ON FUNCTION share_chat IS 'Share a chat and generate share ID';

CREATE OR REPLACE FUNCTION unshare_chat(chat_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chats
    WHERE id = chat_uuid AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to unshare this chat';
  END IF;

  UPDATE chats
  SET is_shared = FALSE
  WHERE id = chat_uuid;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION unshare_chat IS 'Unshare a chat';

-- Admin organization helper (for config UI uploads)
CREATE OR REPLACE FUNCTION get_admin_organization_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_org_id UUID;
BEGIN
  SELECT id INTO admin_org_id
  FROM organizations
  WHERE slug = 'admin-uploads'
  LIMIT 1;

  IF admin_org_id IS NULL THEN
    INSERT INTO organizations (
      name,
      slug,
      owner_id,
      is_personal,
      subscription_tier,
      storage_limit_bytes,
      max_documents,
      max_monthly_messages,
      max_team_members
    )
    SELECT
      'Admin Uploads (Config UI)',
      'admin-uploads',
      id,
      false,
      'enterprise',
      107374182400,
      10000,
      1000000,
      1000
    FROM auth.users
    LIMIT 1
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO admin_org_id;
  END IF;

  RETURN admin_org_id;
END;
$$;

COMMENT ON FUNCTION get_admin_organization_id IS 'Get or create admin organization for config UI uploads';

-- Storage quota check
CREATE OR REPLACE FUNCTION check_storage_quota(org_id uuid, file_size_bytes bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  current_usage bigint;
  quota_limit bigint;
BEGIN
  SELECT storage_used_bytes, storage_limit_bytes
  INTO current_usage, quota_limit
  FROM organizations
  WHERE id = org_id;

  RETURN (current_usage + file_size_bytes) <= quota_limit;
END;
$$;

-- Update storage usage
CREATE OR REPLACE FUNCTION update_org_storage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE organizations
    SET storage_used_bytes = storage_used_bytes + COALESCE((NEW.metadata->>'file_size')::BIGINT, 0)
    WHERE id = NEW.organization_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organizations
    SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE((OLD.metadata->>'file_size')::BIGINT, 0))
    WHERE id = OLD.organization_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_document_storage
AFTER INSERT OR DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION update_org_storage();

-- Get workspace type (3-tier model)
CREATE OR REPLACE FUNCTION get_workspace_type(org_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN org_id IS NULL THEN 'personal_flat'
      WHEN o.is_personal = true THEN 'personal_project'
      WHEN o.is_personal = false THEN 'team'
      ELSE 'unknown'
    END
  FROM organizations o
  WHERE o.id = org_id;
$$;

COMMENT ON FUNCTION get_workspace_type IS 'Returns workspace type: personal_flat, personal_project, or collaborative';

-- Get user workspace summary
CREATE OR REPLACE FUNCTION get_user_workspace_summary()
RETURNS TABLE (
  has_flat_workspace BOOLEAN,
  personal_projects_count INT,
  team_workspaces_count INT,
  total_organizations INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    true as has_flat_workspace,  -- Always available
    COALESCE((SELECT COUNT(*) FROM organizations WHERE owner_id = auth.uid() AND is_personal = true), 0)::INT as personal_projects_count,
    COALESCE((SELECT COUNT(*) FROM organization_members om INNER JOIN organizations o ON o.id = om.organization_id WHERE om.user_id = auth.uid() AND o.is_personal = false), 0)::INT as team_workspaces_count,
    COALESCE((SELECT COUNT(*) FROM organization_members WHERE user_id = auth.uid()), 0)::INT as total_organizations;
$$;

COMMENT ON FUNCTION get_user_workspace_summary IS 'Returns summary of user workspace types';

-- Share personal organization (convert to collaborative)
CREATE OR REPLACE FUNCTION share_personal_organization(
  org_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_record RECORD;
BEGIN
  -- Verify the organization exists and is personal
  SELECT * INTO org_record
  FROM organizations
  WHERE id = org_id
    AND is_personal = true
    AND owner_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found or not a personal organization';
  END IF;

  -- Convert to collaborative project
  UPDATE organizations
  SET
    is_personal = false,
    max_team_members = 5,  -- Default collaboration limit
    updated_at = NOW()
  WHERE id = org_id;

  RAISE NOTICE 'Converted personal organization % to collaborative project', org_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION share_personal_organization IS 'Converts a personal project to a collaborative project (enables invitations)';

-- Admin check
CREATE OR REPLACE FUNCTION check_admin_status()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_admin(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users WHERE id = user_uuid
  );
END;
$$;

-- Subscription check
CREATE OR REPLACE FUNCTION is_subscribed(user_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Trigger functions
CREATE OR REPLACE FUNCTION set_last_updated_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$;

------------------------------------------
-- ROW LEVEL SECURITY POLICIES
------------------------------------------

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_execution_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_domains ENABLE ROW LEVEL SECURITY;

------------------------------------------
-- ORGANIZATIONS POLICIES (3-TIER AWARE)
------------------------------------------

CREATE POLICY "Users can view their organizations" ON organizations
  FOR SELECT USING (
    -- Personal projects: only owner can see
    (is_personal = true AND owner_id = auth.uid())
    OR
    -- Collaborative projects: all members can see
    (is_personal = false AND id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can create organizations" ON organizations
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id
    -- Only personal organizations can be created directly (is_personal: true)
    -- Team workspaces blocked at API level, only via shareOrganization conversion
  );

CREATE POLICY "Users can update organizations" ON organizations
  FOR UPDATE USING (
    -- Personal orgs: only owner
    (is_personal = true AND owner_id = auth.uid())
    OR
    -- Team orgs: owner or admin
    (is_personal = false AND id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    ))
  );

CREATE POLICY "Users can delete organizations" ON organizations
  FOR DELETE USING (
    owner_id = auth.uid()
  );

------------------------------------------
-- ORGANIZATION MEMBERS POLICIES
------------------------------------------

CREATE POLICY "Users can view org members" ON organization_members
  FOR SELECT USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

CREATE POLICY "Admins can add members" ON organization_members
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );


CREATE POLICY "Admins can remove members" ON organization_members
  FOR DELETE USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

------------------------------------------
-- ORGANIZATION DOMAINS POLICIES
------------------------------------------

CREATE POLICY "Users can view org domains" ON organization_domains
  FOR SELECT USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
        OR id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Owners can add org domains" ON organization_domains
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update org domains" ON organization_domains
  FOR UPDATE USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete org domains" ON organization_domains
  FOR DELETE USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

------------------------------------------
-- TEAM INVITATIONS POLICIES (3-TIER)
------------------------------------------

CREATE POLICY "Users can view org invitations" ON team_invitations
  FOR SELECT USING (
    organization_id IN (
      SELECT o.id FROM organizations o
      INNER JOIN organization_members om ON om.organization_id = o.id
      WHERE o.is_personal = false  -- Only collaborative projects
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can create invitations" ON team_invitations
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT o.id FROM organizations o
      INNER JOIN organization_members om ON om.organization_id = o.id
      WHERE o.is_personal = false  -- Only collaborative projects can invite
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete invitations" ON team_invitations
  FOR DELETE USING (
    organization_id IN (
      SELECT o.id FROM organizations o
      INNER JOIN organization_members om ON om.organization_id = o.id
      WHERE o.is_personal = false  -- Only collaborative projects
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

------------------------------------------
-- DOCUMENTS POLICIES (HYBRID ISOLATION)
------------------------------------------

CREATE POLICY "Users can view documents" ON documents
  FOR SELECT USING (
    -- Personal documents (flat workspace)
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational documents (personal projects + teams)
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can create documents" ON documents
  FOR INSERT WITH CHECK (
    -- Personal upload
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational upload (must be member)
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can delete documents" ON documents
  FOR DELETE USING (
    -- Own personal documents
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational documents (must be member)
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can update documents" ON documents
  FOR UPDATE USING (
    -- Own personal documents
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational documents (must be member)
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

------------------------------------------
-- DOCUMENT CHUNKS POLICIES (HYBRID)
------------------------------------------

CREATE POLICY "Users can view chunks" ON document_chunks
  FOR SELECT USING (
    -- Personal chunks (via document ownership)
    document_id IN (
      SELECT id FROM documents
      WHERE user_id = auth.uid() AND organization_id IS NULL
    )
    OR
    -- Organizational chunks
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can create chunks" ON document_chunks
  FOR INSERT WITH CHECK (
    -- Personal chunks
    document_id IN (
      SELECT id FROM documents
      WHERE user_id = auth.uid() AND organization_id IS NULL
    )
    OR
    -- Organizational chunks
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can delete chunks" ON document_chunks
  FOR DELETE USING (
    -- Personal chunks
    document_id IN (
      SELECT id FROM documents
      WHERE user_id = auth.uid() AND organization_id IS NULL
    )
    OR
    -- Organizational chunks
    (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

------------------------------------------
-- FOLDERS POLICIES (HYBRID)
------------------------------------------

CREATE POLICY "Users can view folders" ON folders
  FOR SELECT USING (
    -- Own personal folders
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational folders
    (user_id = auth.uid() AND organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
  );

CREATE POLICY "Users can create folders" ON folders
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

CREATE POLICY "Users can update folders" ON folders
  FOR UPDATE USING (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

CREATE POLICY "Users can delete folders" ON folders
  FOR DELETE USING (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

------------------------------------------
-- CHATS POLICIES (HYBRID)
------------------------------------------

CREATE POLICY "Users can view chats" ON chats
  FOR SELECT USING (
    -- Own personal chats
    (user_id = auth.uid() AND organization_id IS NULL)
    OR
    -- Organizational chats
    (user_id = auth.uid() AND organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    OR
    -- Shared chats
    (shared = true)
  );

CREATE POLICY "Users can create chats" ON chats
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      -- Personal chat
      organization_id IS NULL
      OR
      -- Organizational chat
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

CREATE POLICY "Users can update chats" ON chats
  FOR UPDATE USING (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

CREATE POLICY "Users can delete chats" ON chats
  FOR DELETE USING (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR
      (organization_id IS NOT NULL AND is_org_member(organization_id, auth.uid()))
    )
  );

------------------------------------------
-- OTHER POLICIES
------------------------------------------

-- Tool execution states
CREATE POLICY "Users can view own tool states" ON tool_execution_states
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = tool_execution_states.chat_id
        AND chats.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert tool states" ON tool_execution_states
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = tool_execution_states.chat_id
        AND chats.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tool states" ON tool_execution_states
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = tool_execution_states.chat_id
        AND chats.user_id = auth.uid()
    )
  );

-- User preferences
CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- Admin
CREATE POLICY "Admins can view admin users" ON admin_users
  FOR SELECT USING (check_admin_status() OR auth.role() = 'service_role');

CREATE POLICY "Admins can view admin settings" ON admin_settings
  FOR SELECT USING (check_admin_status() OR auth.role() = 'service_role');

CREATE POLICY "Admins can update settings" ON admin_settings
  FOR UPDATE USING (check_admin_status() OR auth.role() = 'service_role');

-- Subscriptions
CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage subscriptions" ON subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage pending subscriptions" ON pending_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- WhatsApp
CREATE POLICY "Users can view own WhatsApp sessions" ON whatsapp_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own WhatsApp sessions" ON whatsapp_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own WhatsApp conversations" ON whatsapp_conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own WhatsApp conversations" ON whatsapp_conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view messages in their conversations" ON whatsapp_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM whatsapp_conversations wc
      WHERE wc.id = whatsapp_messages.conversation_id
        AND wc.user_id = auth.uid()
    )
  );

-- Tenant usage
CREATE POLICY "Users can view org usage" ON tenant_usage
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage usage" ON tenant_usage
  FOR ALL USING (auth.role() = 'service_role');

-- API usage logs
CREATE POLICY "Users can view org API logs" ON api_usage_logs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

CREATE POLICY "Service role can manage API logs" ON api_usage_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Storage policies
DO $$
BEGIN
  CREATE POLICY "Chat images are publicly accessible" ON storage.objects
    FOR SELECT USING (bucket_id = 'chat-images');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can upload chat images" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'chat-images' AND auth.role() = 'authenticated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can delete own chat images" ON storage.objects
    FOR DELETE USING (bucket_id = 'chat-images' AND auth.uid() = owner);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Backgrounds are publicly accessible" ON storage.objects
    FOR SELECT USING (bucket_id = 'backgrounds');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can upload backgrounds" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'backgrounds' AND auth.role() = 'authenticated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can update own backgrounds" ON storage.objects
    FOR UPDATE USING (bucket_id = 'backgrounds' AND owner = auth.uid());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can delete own backgrounds" ON storage.objects
    FOR DELETE USING (bucket_id = 'backgrounds' AND owner = auth.uid());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

------------------------------------------
-- TRIGGERS
------------------------------------------

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_last_updated_timestamp();

CREATE TRIGGER update_chats_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION set_last_updated_timestamp();

CREATE TRIGGER update_folders_updated_at
  BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION set_last_updated_timestamp();

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

COMMIT;

------------------------------------------
-- COMPLETION MESSAGE
------------------------------------------

SELECT
  '✅ ChatRAG Multi-Tenant Setup Complete!' as status,
  NOW() as completed_at;

SELECT
  'Workspace Types:' as info,
  '1. Personal Workspace (Flat) - No organization, user_id isolation' as type1,
  '2. Personal Projects - is_personal=true, owner only, can be made collaborative' as type2,
  '3. Collaborative Projects - is_personal=false, multi-member (via shareOrganization)' as type3;

SELECT
  'Features Enabled:' as features,
  '✓ Three-tier workspace architecture' as feature1,
  '✓ Hybrid isolation (user_id + organization_id)' as feature2,
  '✓ Organization-based multi-tenancy with RLS' as feature3,
  '✓ Collaboration with role-based access' as feature4,
  '✓ Storage quotas and usage tracking' as feature5,
  '✓ Personal → Collaborative conversion (shareOrganization)' as feature6,
  '✓ Vector search optimization (HNSW)' as feature7;

SELECT
  'Next Steps:' as info,
  '1. Set NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant in .env.local' as step1,
  '2. Restart development server: npm run dev' as step2,
  '3. Test flat personal workspace (no orgs)' as step3,
  '4. Create personal projects via UI' as step4,
  '5. Enable collaboration on personal projects (via shareOrganization)' as step5,
  '6. Test inviting collaborators to collaborative projects' as step6;

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
