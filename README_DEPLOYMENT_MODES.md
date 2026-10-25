# ChatRAG Deployment Modes - Complete Guide

**Last Updated**: November 17, 2025
**Status**: Production Ready
**Version**: 2.1

> Complete guide to ChatRAG's dual-mode architecture supporting both single-tenant and multi-tenant deployments from a unified codebase.

---

## 📋 Table of Contents

### Quick Start
- [Overview](#overview)
- [Which Mode Should I Choose?](#which-mode-should-i-choose)
- [Quick Setup Guide](#quick-setup-guide)

### Understanding Deployment Modes
- [Single-Tenant Mode](#single-tenant-mode)
- [Multi-Tenant Mode](#multi-tenant-mode)
- [Feature Comparison](#feature-comparison)
- [Architecture Differences](#architecture-differences)

### Implementation Guides
- [Setup Instructions](#setup-instructions)
- [Migration Guide](#migration-guide)
- [API Reference](#api-reference)
- [UI Components](#ui-components)

### Advanced Topics
- [Database Schema Differences](#database-schema-differences)
- [Technical Implementation](#technical-implementation)
- [Security & Best Practices](#security--best-practices)
- [Troubleshooting](#troubleshooting)

### Resources
- [Documentation Index](#documentation-index)
- [FAQ](#faq)
- [Support & Community](#support--community)

---

## Overview

ChatRAG is a **dual-mode RAG boilerplate** that supports two distinct deployment architectures from a single codebase:

### Deployment Modes at a Glance

| Mode              | Best For                          | Setup Time | Complexity | Data Isolation        |
|-------------------|-----------------------------------|------------|------------|-----------------------|
| **Single-Tenant** | Product docs, chatbots, wikis    | ~10 min    | Low        | User-level only       |
| **Multi-Tenant**  | SaaS platforms, enterprises       | ~20 min    | Medium     | Organization + User   |

**Key Benefit**: Switch between modes using a single environment variable - same codebase, different database schemas.

---

## Which Mode Should I Choose?

### Choose Single-Tenant If You're Building:

✅ **Personal AI assistants** - One user, one knowledge base
✅ **Product documentation bots** - All customers see same docs
✅ **Customer support bots** - Shared FAQ database
✅ **Internal company wikis** - Everyone accesses same knowledge
✅ **Domain-specific assistants** - Legal/medical/research tools
✅ **Educational tools** - Individual learner focus

**Characteristics**:
- Shared document library accessible to all users
- User-isolated chat history (private conversations)
- Simpler database schema (14 tables)
- Lower resource requirements
- Minimal administrative overhead

---

### Choose Multi-Tenant If You're Building:

✅ **SaaS RAG platforms** - Multiple isolated customers
✅ **Enterprise deployments** - Department-based isolation
✅ **Agency solutions** - Client data separation
✅ **B2B knowledge platforms** - Team collaboration features
✅ **White-label products** - Per-customer customization
✅ **Multi-client services** - Workspace-level AI customization

**Characteristics**:
- Auto-personal workspaces on signup (zero config for users)
- Organization-based data isolation (full privacy)
- Team collaboration with role-based access (Owner/Admin/Member/Viewer)
- Per-organization storage quotas and limits
- Workspace-level AI prompt customization ⭐
- Advanced usage analytics

---

## Quick Setup Guide

### Single-Tenant Quick Start

```bash
# 1. Configure deployment mode
npm run configure-deployment
# Select: "1" for Single-Tenant

# 2. Setup database
npm run db:setup

# 3. Start application
npm run dev
```

**Environment Variables**:
```bash
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
```

---

### Multi-Tenant Quick Start

```bash
# 1. Configure deployment mode
npm run configure-deployment
# Select: "2" for Multi-Tenant

# 2. Setup database
npm run db:setup

# 3. Start application
npm run dev
```

**Environment Variables**:
```bash
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant
ENABLE_ORGANIZATIONS=true
ENABLE_TEAM_INVITES=true
ENABLE_STORAGE_QUOTAS=true
ENABLE_USAGE_ANALYTICS=true

NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
```

---

## Single-Tenant Mode

### Architecture

```
┌─────────────────────────────────────┐
│         Application Instance        │
├─────────────────────────────────────┤
│     Shared Knowledge Base (RAG)     │
├─────────────────────────────────────┤
│  User 1   │  User 2   │  User 3    │
│  Chats    │  Chats    │  Chats     │
└─────────────────────────────────────┘
```

### How It Works

- **All users access the same set of documents** (shared knowledge base)
- **Each user has private chat history** (isolated via Row Level Security)
- **Perfect for scenarios where everyone needs the same information**
- **Simpler database schema and setup**

### Real-World Examples

**AI Twin Chatbot**:
- All website visitors query the same knowledge (your personality, bio, work)
- Each visitor has private conversation history
- Simple deployment, zero configuration needed

**Product Documentation Bot**:
- All customers access same product documentation
- Customers can't see each other's support conversations
- Easy to update knowledge base (affects all users instantly)

**Company Internal Wiki**:
- All employees access company knowledge base
- Private conversation history per employee
- Central knowledge management

### Database Tables (14 Total)

**Core Tables**:
- `documents` - Shared document library
- `document_chunks` - Vector embeddings for RAG
- `chats` - User-isolated conversations
- `folders` - User-isolated organization

**Additional Tables**:
- `subscriptions` - Per-user subscriptions
- `admin_users` - Admin management
- `whatsapp_sessions` - WhatsApp integration
- `tool_execution_states` - MCP tool tracking

**What's NOT Included**:
- ❌ `organizations` table
- ❌ `organization_members` table
- ❌ `team_invitations` table
- ❌ Organization-scoped RLS policies

---

## Multi-Tenant Mode

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Application Instance                     │
├─────────────────────────────────────────────────────────┤
│  User A      │  User B       │  Team Workspace         │
│  Personal KB │  Personal KB  │  Shared KB              │
│  (Auto)      │  (Auto)       │  (Created by user)      │
├──────────────┼───────────────┼─────────────────────────┤
│  Solo User   │  Solo User    │  User C, D, E           │
│  Private     │  Private      │  Collaborative          │
└─────────────────────────────────────────────────────────┘
```

### How It Works

**Auto-Personal Workspaces** ⭐:
- Every user **automatically gets** an isolated workspace on signup
- Zero configuration required for users
- Perfect for SaaS with individual customers
- Can grow to team collaboration later

**Three-Tier Workspace Architecture**:
1. **Personal Workspace (Flat)**: No organization, user_id isolation only
2. **Personal Projects**: `is_personal: true`, owner only, organized workspace
3. **Collaborative Projects**: `is_personal: false`, multi-member via conversion

**Team Collaboration**:
- Users can create team workspaces to collaborate
- Role-based access control (Owner/Admin/Member/Viewer)
- Email-based invitations with 7-day expiration
- Permission-based workspace management

**Resource Management**:
- Storage quotas per workspace
- Document limits by subscription tier
- Usage tracking and analytics
- Subscription management at workspace level

### Real-World Examples

**SaaS RAG Platform** (like NotebookLM):
- Customer A signs up → Gets isolated workspace instantly
- Customer B signs up → Gets separate isolated workspace
- Each customer uploads private documents
- No manual workspace creation needed

**Enterprise Multi-Department**:
- Marketing: Brand guidelines, campaign docs
- Legal: Contracts, compliance documents
- Engineering: API docs, architecture diagrams
- HR: Employee handbooks, policies
- Complete isolation between departments

**Agency Managing Clients**:
- Agency creates workspace per client
- Client A documents ≠ Client B documents
- Invite client contacts as viewers
- Switch between client workspaces easily
- Track usage and bill per client

### Key Features

🏢 **Organizations & Workspaces**:
- Auto-created on signup (zero config)
- Personal → Collaborative conversion
- Unlimited organizations per user

👥 **Team Collaboration**:
- 4 role types with granular permissions
- Email invitations with token-based security
- Member management UI
- Role-based access control

🔒 **Complete Data Isolation**:
- Database-level security (RLS policies)
- Organization-scoped documents and chats
- Compliance-ready (HIPAA, GDPR, SOC 2)

💳 **Subscription Tiers**:
- Free: 1 GB, 50 docs, solo
- Pro: 10 GB, 500 docs, 10 members
- Enterprise: 100 GB, 5K docs, 100 members
- Custom: Fully customizable limits

🎨 **Workspace AI Customization** ⭐ NEW:
- Per-workspace system prompt overrides
- Two modes: Split (pre/post context) or Full override
- Real-time validation with {{context}} placeholder
- Permission-based editing (owners/admins only)
- Complete i18n support (18 languages)

### Database Tables (18 Total)

**Everything from Single-Tenant PLUS**:
- ✅ `organizations` - Workspaces/tenants with quotas
- ✅ `organization_members` - Team with roles
- ✅ `team_invitations` - Invitation system
- ✅ `tenant_usage` - Usage analytics
- ✅ Organization columns in: `documents`, `document_chunks`, `chats`, `folders`

**Additional Features**:
- Organization-scoped RLS policies
- Helper functions: `is_org_member()`, `get_admin_organization_id()`
- Auto-organization creation trigger
- Storage quota tracking
- Workspace settings (AI customization)

---

## Feature Comparison

### Complete Feature Matrix

| Feature                      | Single-Tenant       | Multi-Tenant            | Notes                   |
|------------------------------|---------------------|-------------------------|-------------------------|
| **Knowledge Base**           | Shared globally     | Isolated per org        | Core difference         |
| **Document Upload**          | All users see       | Org-isolated            | Privacy control         |
| **Chat History**             | User-isolated       | User + Org isolated     | RLS policies            |
| **User Management**          | Basic (Auth)        | Advanced (Roles)        | RBAC system             |
| **Team Invitations**         | ❌                  | ✅                      | Email-based             |
| **Organizations**            | ❌                  | ✅                      | Multi-workspace         |
| **Auto Workspace**           | ❌                  | ✅                      | Zero config signup      |
| **Personal Projects**        | ❌                  | ✅                      | Individual workspaces   |
| **Collaborative Projects**   | ❌                  | ✅                      | Team collaboration      |
| **Storage Quotas**           | ❌                  | ✅                      | Per-org limits          |
| **Usage Analytics**          | Basic               | Advanced                | Per-org tracking        |
| **Subscriptions**            | User-level          | Org-level               | Billing model           |
| **AI Customization** ⭐      | ❌                  | ✅                      | Per-workspace prompts   |
| **Workspace Switching**      | ❌                  | ✅                      | UI switcher             |
| **Role-Based Access**        | ❌                  | ✅                      | 4 role types            |
| **Tier Enforcement**         | ❌                  | ✅                      | Quota checks            |
| **RLS Complexity**           | Simple              | Complex                 | Security layers         |
| **Setup Time**               | ~10 min             | ~20 min                 | Initial setup           |
| **Database Tables**          | 14                  | 18                      | Schema size             |

### Shared Features (Both Modes)

✅ RAG Chat with streaming responses
✅ Vector search with HNSW indexes (15-28x faster)
✅ Folder organization for chats
✅ MCP Tools integration
✅ Multi-modal support (Images/Video/3D)
✅ WhatsApp integration
✅ Multiple AI model support
✅ Document processing (PDF, DOCX, TXT)
✅ Embedding generation and storage
✅ Real-time chat updates
✅ Chat sharing capabilities

---

## Setup Instructions

### Single-Tenant Setup (Detailed)

#### Step 1: Environment Configuration

Create `.env.local`:

```bash
# ============================================
# SINGLE-TENANT MODE CONFIGURATION
# ============================================

# Deployment Mode
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant

# Database (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# AI Models (Required)
OPENAI_API_KEY=sk-your_openai_key_here
OPENROUTER_API_KEY=sk-or-v1-your_key_here

# Document Processing (Recommended)
LLAMA_CLOUD_API_KEY=llx-your_key_here
LLAMACLOUD_PARSING_MODE=balanced  # fast, balanced, or premium

# Optional Features
NEXT_PUBLIC_WEB_SEARCH_ENABLED=true
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=false
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=false
NEXT_PUBLIC_3D_GENERATION_ENABLED=false
```

#### Step 2: Database Setup

**Option A: Via Supabase Dashboard** (Recommended)
1. Open: `https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new`
2. Copy contents of: `supabase/single-tenant-setup.sql`
3. Paste and click "Run"
4. Verify: No errors, ~14 tables created

**Option B: Via CLI**
```bash
npm run db:setup
# Or manually:
# psql $DATABASE_URL -f supabase/single-tenant-setup.sql
```

#### Step 3: Verify Installation

```sql
-- Check tables exist (should show ~14 tables)
SELECT table_name
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

#### Step 4: Start Application

```bash
npm install
npm run dev
# Access at http://localhost:3000
```

#### Step 5: Verify Deployment Mode

Check console logs:
```
[ChatRAG] Deployment Mode: SINGLE-TENANT
[ChatRAG] Single-tenant mode: Shared knowledge base, user-isolated chats
```

---

### Multi-Tenant Setup (Detailed)

#### Step 1: Environment Configuration

Create `.env.local`:

```bash
# ============================================
# MULTI-TENANT MODE CONFIGURATION
# ============================================

# Deployment Mode
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant

# Multi-Tenant Feature Flags
ENABLE_ORGANIZATIONS=true
ENABLE_TEAM_INVITES=true
ENABLE_STORAGE_QUOTAS=true
ENABLE_USAGE_ANALYTICS=true

# Database (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# AI Models (Required)
OPENAI_API_KEY=sk-your_openai_key_here
OPENROUTER_API_KEY=sk-or-v1-your_key_here

# Document Processing (Recommended)
LLAMA_CLOUD_API_KEY=llx-your_key_here
LLAMACLOUD_PARSING_MODE=balanced

# Payment Integration (Optional)
STRIPE_SECRET_KEY=sk_test_your_key_here
POLAR_ACCESS_TOKEN=polar_your_token_here

# Optional Features
NEXT_PUBLIC_WEB_SEARCH_ENABLED=true
NEXT_PUBLIC_IMAGE_GENERATION_ENABLED=false
NEXT_PUBLIC_VIDEO_GENERATION_ENABLED=false
NEXT_PUBLIC_3D_GENERATION_ENABLED=false
```

#### Step 2: Database Setup

**Via Supabase Dashboard** (Recommended)
1. Open: `https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new`
2. Copy contents of: `supabase/multi-tenant-setup.sql`
3. Paste and click "Run"
4. Verify: No errors, ~18 tables created

**Via CLI**
```bash
npm run db:setup
# Or manually:
# psql $DATABASE_URL -f supabase/multi-tenant-setup.sql
```

#### Step 3: Verify Installation

```sql
-- Check all tables exist (should show ~18 tables)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify organization tables
SELECT * FROM organizations LIMIT 1;
SELECT * FROM organization_members LIMIT 1;
SELECT * FROM team_invitations LIMIT 1;

-- Check RLS policies
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Verify helper functions
SELECT proname FROM pg_proc
WHERE proname IN ('is_org_member', 'get_admin_organization_id', 'handle_new_user_organization');
```

#### Step 4: Start Application

```bash
npm install
npm run dev
# Access at http://localhost:3000
```

#### Step 5: Verify Deployment Mode

Check console logs:
```
[ChatRAG] Deployment Mode: MULTI-TENANT
[ChatRAG] Multi-tenant features:
  - Organizations: Enabled
  - Team Invites: Enabled
  - Storage Quotas: Enabled
  - Usage Analytics: Enabled
```

#### Step 6: Test Auto-Organization Creation

1. Sign up a new user
2. Verify personal organization created:
```sql
SELECT id, name, slug, is_personal
FROM organizations
WHERE owner_id = 'USER_ID';
```

3. Verify user is owner member:
```sql
SELECT * FROM organization_members
WHERE user_id = 'USER_ID' AND role = 'owner';
```

---

## Migration Guide

### From Single-Tenant to Multi-Tenant

⚠️ **Warning**: This migration requires careful planning as it fundamentally changes data architecture.

#### Pre-Migration Checklist

- [ ] Backup current database (use Supabase dashboard or pg_dump)
- [ ] Export existing documents and embeddings
- [ ] Document current user list
- [ ] Plan organization structure
- [ ] Test migration on staging environment first
- [ ] Schedule downtime window

#### Migration Steps

**1. Backup Database**
```bash
# Via Supabase Dashboard: Database > Backups > Create Backup
# Or via pg_dump
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

**2. Add Compatibility Columns**

Run this migration on your single-tenant database:

```sql
-- Add organization_id columns (they'll be NULL in single-tenant)
ALTER TABLE documents ADD COLUMN organization_id UUID DEFAULT NULL;
ALTER TABLE document_chunks ADD COLUMN organization_id UUID DEFAULT NULL;
ALTER TABLE chats ADD COLUMN organization_id UUID DEFAULT NULL;
ALTER TABLE folders ADD COLUMN organization_id UUID DEFAULT NULL;

-- Add indexes
CREATE INDEX idx_documents_organization_id ON documents(organization_id);
CREATE INDEX idx_document_chunks_organization_id ON document_chunks(organization_id);
CREATE INDEX idx_chats_organization_id ON chats(organization_id);
CREATE INDEX idx_folders_organization_id ON folders(organization_id);
```

**3. Update Environment Variables**
```bash
# In .env.local
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=multi-tenant
ENABLE_ORGANIZATIONS=true
ENABLE_TEAM_INVITES=true
ENABLE_STORAGE_QUOTAS=true
ENABLE_USAGE_ANALYTICS=true
```

**4. Apply Multi-Tenant Schema**
```bash
# Run multi-tenant setup (creates organization tables)
psql $DATABASE_URL -f supabase/multi-tenant-setup.sql
```

**5. Create Default Organization**
```sql
-- Create a default organization for migrated data
INSERT INTO organizations (
  name, slug, owner_id, is_personal, subscription_tier,
  storage_limit_bytes, max_documents, max_monthly_messages, max_team_members
)
SELECT
  'Default Organization',
  'default-org',
  id,  -- First user becomes owner
  false,
  'enterprise',
  107374182400,  -- 100GB
  10000,
  1000000,
  1000
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
RETURNING id;

-- Save this organization_id for next steps
```

**6. Migrate Existing Data**
```sql
-- Get the default org ID
WITH default_org AS (
  SELECT id FROM organizations WHERE slug = 'default-org'
)

-- Assign all documents to default organization
UPDATE documents
SET organization_id = (SELECT id FROM default_org)
WHERE organization_id IS NULL;

-- Assign all chunks
UPDATE document_chunks
SET organization_id = (SELECT id FROM default_org)
WHERE organization_id IS NULL;

-- Assign all chats
UPDATE chats
SET organization_id = (SELECT id FROM default_org)
WHERE organization_id IS NULL;

-- Assign all folders
UPDATE folders
SET organization_id = (SELECT id FROM default_org)
WHERE organization_id IS NULL;
```

**7. Add Users as Organization Members**
```sql
-- Add all existing users as members of default org
WITH default_org AS (
  SELECT id FROM organizations WHERE slug = 'default-org'
)
INSERT INTO organization_members (organization_id, user_id, role)
SELECT
  (SELECT id FROM default_org),
  id,
  CASE
    WHEN id = (SELECT owner_id FROM default_org) THEN 'owner'
    ELSE 'member'
  END
FROM auth.users
ON CONFLICT DO NOTHING;
```

**8. Test Thoroughly**
- [ ] Verify all documents are accessible
- [ ] Test document upload
- [ ] Test chat functionality
- [ ] Verify RLS policies work
- [ ] Test team invitations
- [ ] Check organization switcher UI

**9. Deploy**
```bash
npm run dev
# Or deploy to production
```

---

### From Multi-Tenant to Single-Tenant

⚠️ **Warning**: This will merge all organization data into a single shared knowledge base.

#### Migration Steps

**1. Backup Database**
```bash
pg_dump $DATABASE_URL > backup_before_downgrade_$(date +%Y%m%d).sql
```

**2. Choose Data to Keep**

Decision point: Which organization's data becomes the shared knowledge base?
- Option A: Keep all data (merge everything)
- Option B: Keep specific organization (discard others)

**3. Export Data (if keeping specific org)**
```sql
-- Export from chosen organization
COPY (
  SELECT id, filename, content, metadata, created_at
  FROM documents
  WHERE organization_id = 'CHOSEN_ORG_ID'
) TO '/tmp/documents_export.csv' CSV HEADER;
```

**4. Update Environment**
```bash
# In .env.local
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant
```

**5. Remove Organization References**
```sql
-- Make all data globally accessible
UPDATE documents SET organization_id = NULL;
UPDATE document_chunks SET organization_id = NULL;
UPDATE chats SET organization_id = NULL;
UPDATE folders SET organization_id = NULL;
```

**6. Apply Single-Tenant Schema**
```bash
# This will keep existing data but remove org tables
psql $DATABASE_URL -f supabase/single-tenant-setup.sql
```

**7. Clean Up**
```sql
-- Drop organization tables (optional)
DROP TABLE IF EXISTS team_invitations CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS tenant_usage CASCADE;
```

**8. Test and Deploy**
```bash
npm run dev
```

---

## API Reference

### Multi-Tenant API Endpoints

#### Organizations (6 endpoints)

**Create Organization**
```http
POST /api/organizations
Content-Type: application/json

{
  "name": "Acme Corp",
  "slug": "acme-corp"
}
```

**List Organizations**
```http
GET /api/organizations

Response:
{
  "personal": { /* personal workspace */ },
  "teams": [ /* team workspaces */ ],
  "all": [ /* combined array */ ]
}
```

**Get Organization Details**
```http
GET /api/organizations/[id]

Response:
{
  "id": "uuid",
  "name": "Acme Corp",
  "user_role": "admin",
  "subscription_tier": "pro",
  ...
}
```

**Update Organization**
```http
PATCH /api/organizations/[id]
Content-Type: application/json

{
  "name": "Acme Corporation"
}
```

**Share Organization (Convert Personal → Collaborative)**
```http
POST /api/organizations/[id]/share

Response:
{
  "success": true,
  "organization": { /* updated org */ }
}
```

**Delete Organization**
```http
DELETE /api/organizations/[id]
```

#### Members (4 endpoints)

**List Members**
```http
GET /api/organizations/[id]/members

Response:
{
  "members": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "email": "user@example.com",
      "role": "admin",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**Add Member**
```http
POST /api/organizations/[id]/members
Content-Type: application/json

{
  "user_id": "uuid",
  "role": "member"
}
```

**Update Member Role**
```http
PATCH /api/organizations/[id]/members/[userId]
Content-Type: application/json

{
  "role": "admin"
}
```

**Remove Member**
```http
DELETE /api/organizations/[id]/members/[userId]
```

#### Invitations (4 endpoints)

**Create Invitation**
```http
POST /api/organizations/[id]/invites
Content-Type: application/json

{
  "email": "user@example.com",
  "role": "member"
}
```

**List Invitations**
```http
GET /api/organizations/[id]/invites
```

**Revoke Invitation**
```http
DELETE /api/organizations/[id]/invites/[token]
```

**Accept Invitation**
```http
POST /api/invites/[token]
```

#### Workspace Settings (2 endpoints) ⭐ NEW

**Get Workspace Settings**
```http
GET /api/organizations/[id]/settings

Response:
{
  "settings": {
    "system_prompt_override": "...",
    "system_prompt_pre_context": "...",
    "system_prompt_post_context": "...",
    "prompt_mode": "split"
  }
}
```

**Update Workspace Settings**
```http
PATCH /api/organizations/[id]/settings
Content-Type: application/json

{
  "settings": {
    "prompt_mode": "split",
    "system_prompt_pre_context": "You are a legal AI assistant...",
    "system_prompt_post_context": "Always cite sources..."
  }
}
```

This section is the current API reference for the multi-tenant endpoints in this checkout.

---

## UI Components

### Organization Switcher

**Location**: Sidebar
**File**: `src/components/organization-switcher.tsx`
**Visibility**: Multi-tenant mode only

**Features**:
- Dropdown with all user's workspaces
- Separates personal workspace from collaborative projects
- Icons: User (personal), Building2 (collaborative)
- "Create personal project" inline form
- Settings gear icon for workspace customization ⭐
- Persists selection to localStorage

**Usage**:
```tsx
import { OrganizationSwitcher } from '@/components/organization-switcher';
import { isMultiTenant } from '@/lib/deployment-mode';

{isMultiTenant() && <OrganizationSwitcher />}
```

---

### Workspace Settings Tab

**Location**: Settings Modal → Workspace Tab
**File**: `src/components/ui/settings/tabs/WorkspaceTab.tsx`
**Visibility**: Multi-tenant mode only

**Sections**:
1. Organization info card (name, type, subscription, role)
2. Collaborators list with role badges
3. Invite collaborators form (admin/owner only)
4. Pending invitations management

**Permission Levels**:
- Viewer: Read-only view
- Member: Read-only view
- Admin: Can invite, remove, change roles
- Owner: Full control + delete organization

---

### Workspace Settings Modal ⭐ NEW

**File**: `src/components/ui/workspace-settings-modal.tsx`
**Purpose**: Workspace-level AI behavior customization

**Features**:
- AI Behavior tab for prompt customization
- Two prompt modes:
  - Split Mode: Pre-context + {{context}} + Post-context
  - Full Mode: Complete system prompt override
- Real-time validation ({{context}} placeholder checking)
- Permission-based editing (owners/admins only)
- Complete i18n support (18 languages)
- Close button and responsive design

**Use Cases**:
- Legal teams: Formal, citation-heavy responses
- Creative teams: Exploratory, creative AI behavior
- Customer support: Brand voice consistency
- Technical teams: Code-focused responses

This section is the current UI reference for the multi-tenant components in this checkout.

---

## Database Schema Differences

### Single-Tenant Schema

**Core Tables** (No organization_id):
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  organization_id UUID DEFAULT NULL,  -- Always NULL, for compatibility
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT NOT NULL,
  messages JSONB NOT NULL,
  organization_id UUID DEFAULT NULL,  -- Always NULL, for compatibility
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**RLS Policies** (Simple):
```sql
-- Anyone can view documents
CREATE POLICY "Allow read access to anonymous users" ON documents
  FOR SELECT USING (true);

-- Users only see their own chats
CREATE POLICY "Users can view their own chats" ON chats
  FOR SELECT USING (auth.uid() = user_id);
```

**Total Tables**: 14

---

### Multi-Tenant Schema

**Core Tables** (With organization_id):
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Hybrid isolation constraint
  CONSTRAINT documents_isolation_check CHECK (
    (user_id IS NOT NULL AND organization_id IS NULL)  -- Personal workspace
    OR (organization_id IS NOT NULL)  -- Organization workspace
  )
);

CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  organization_id UUID REFERENCES organizations(id),
  title TEXT NOT NULL,
  messages JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Organization Tables**:
```sql
-- Workspaces/tenants
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  is_personal BOOLEAN DEFAULT true,
  subscription_tier TEXT DEFAULT 'free',
  storage_limit_bytes BIGINT DEFAULT 1073741824,
  max_documents INT DEFAULT 50,
  max_team_members INT DEFAULT 1,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team members with roles
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  UNIQUE(organization_id, user_id)
);

-- Email invitations
CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

**RLS Policies** (Complex):
```sql
-- Helper function to prevent recursion
CREATE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only org members can view documents
CREATE POLICY "Users can view org documents" ON documents
  FOR SELECT USING (is_org_member(organization_id));

-- Only org members + user can see chats
CREATE POLICY "Users can view own chats" ON chats
  FOR SELECT USING (
    auth.uid() = user_id
    AND is_org_member(organization_id)
  );
```

**Total Tables**: 18

This section and `supabase/multi-tenant-setup.sql` are the current schema references in this checkout.

---

## Technical Implementation

### Deployment Mode Detection

**Environment Variable**:
```bash
NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE=single-tenant  # or multi-tenant
```

**Code Implementation**:
```typescript
// src/lib/deployment-mode.ts

export function getDeploymentMode(): DeploymentMode {
  return (env.NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE || 'single-tenant') as DeploymentMode;
}

export function isMultiTenant(): boolean {
  return getDeploymentMode() === 'multi-tenant';
}

export function isSingleTenant(): boolean {
  return getDeploymentMode() === 'single-tenant';
}
```

**Usage in Components**:
```typescript
import { isMultiTenant } from '@/lib/deployment-mode';

export function Sidebar() {
  return (
    <div>
      {/* Show organization switcher only in multi-tenant */}
      {isMultiTenant() && <OrganizationSwitcher />}

      {/* Regular sidebar content */}
    </div>
  );
}
```

**Guarding API Routes**:
```typescript
import { requireMultiTenant } from '@/lib/deployment-mode';

export async function GET(request: Request) {
  // Throw error if not in multi-tenant mode
  requireMultiTenant();

  // Proceed with organization logic
  const orgs = await fetchOrganizations();
  return Response.json(orgs);
}
```

---

### Auto-Organization Creation (Multi-Tenant)

**Database Trigger**:
```sql
CREATE OR REPLACE FUNCTION handle_new_user_organization()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create personal organization for new user
  INSERT INTO organizations (
    name, slug, owner_id, is_personal,
    subscription_tier, storage_limit_bytes,
    max_documents, max_monthly_messages, max_team_members
  ) VALUES (
    NEW.raw_user_meta_data->>'name' || '''s Workspace',
    'user-' || NEW.id,
    NEW.id,
    true,  -- Personal workspace
    'free',
    1073741824,  -- 1GB
    50, 100, 1
  )
  RETURNING id INTO new_org_id;

  -- Add user as owner
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_organization
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_organization();
```

---

### Feature Flags

```typescript
export function getFeatureFlags() {
  const mode = getDeploymentMode();
  const isMulti = mode === 'multi-tenant';

  return {
    // Organizations features (multi-tenant only)
    enableOrganizations: isMulti && (env.ENABLE_ORGANIZATIONS ?? true),
    enableTeamInvites: isMulti && (env.ENABLE_TEAM_INVITES ?? true),
    enableStorageQuotas: isMulti && (env.ENABLE_STORAGE_QUOTAS ?? true),
    enableUsageAnalytics: isMulti && (env.ENABLE_USAGE_ANALYTICS ?? true),

    // Shared features
    enableDocumentSharing: true,
    enableChatHistory: true,
    enableRAG: true,

    // Deployment mode info
    deploymentMode: mode,
    isSingleTenant: !isMulti,
    isMultiTenant: isMulti,
  };
}
```

The security and implementation notes below are the current technical reference in this checkout.

---

## Security & Best Practices

### Single-Tenant Security

1. **RLS Policies**:
   - Enable RLS on all tables
   - Use user-based policies for chats/folders
   - Consider read-only access for documents in production

2. **Performance**:
   - Optimize vector indexes for shared knowledge base
   - Use connection pooling
   - Cache frequently accessed documents

3. **Maintenance**:
   - Regular vector index maintenance
   - Monitor storage usage
   - Implement document retention policies

---

### Multi-Tenant Security

1. **Always Use Organization Context**:
```typescript
// ❌ BAD: No organization filter
const docs = await supabase.from('documents').select('*');

// ✅ GOOD: Organization-scoped query
const docs = await supabase
  .from('documents')
  .select('*')
  .eq('organization_id', currentOrgId);
```

2. **Validate Organization Membership**:
```typescript
// In API routes
const member = await supabase
  .from('organization_members')
  .select('role')
  .eq('organization_id', orgId)
  .eq('user_id', userId)
  .single();

if (!member) {
  return new Response('Unauthorized', { status: 403 });
}
```

3. **Personal Organization Protection**:
```typescript
// Prevent modifying personal organizations
if (org.is_personal) {
  return new Response('Cannot modify personal organizations', { status: 400 });
}
```

4. **Quota Enforcement**:
```sql
-- Check before upload
CREATE FUNCTION check_storage_quota(org_id UUID, file_size BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  current_usage BIGINT;
  quota_limit BIGINT;
BEGIN
  SELECT storage_used_bytes, storage_limit_bytes
  INTO current_usage, quota_limit
  FROM organizations
  WHERE id = org_id;

  RETURN (current_usage + file_size) <= quota_limit;
END;
$$ LANGUAGE plpgsql;
```

5. **Rate Limiting**:
   - Implement per-organization rate limits
   - Monitor API calls per organization
   - Track usage for billing

---

## Troubleshooting

### Common Issues

#### "Column organization_id does not exist"

**Cause**: Running multi-tenant code with single-tenant database.

**Solution**:
```bash
# 1. Check deployment mode
echo $NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE

# 2. Verify database schema matches mode
psql $DATABASE_URL -c "\d documents"

# 3. Confirm you selected the matching schema file in supabase/
# Use supabase/multi-tenant-setup.sql for multi-tenant deployments
```

---

#### "Function is_org_member does not exist"

**Cause**: Multi-tenant RLS policies require helper functions.

**Solution**:
```bash
# Re-run multi-tenant setup
psql $DATABASE_URL -f supabase/multi-tenant-setup.sql

# Verify function exists
psql $DATABASE_URL -c "SELECT proname FROM pg_proc WHERE proname = 'is_org_member';"
```

---

#### Documents not visible after upload

**Single-Tenant**:
- Check RLS policies allow reads
- Verify documents table has data

**Multi-Tenant**:
- Verify user is organization member
- Check organization_id matches:
```sql
SELECT d.id, d.filename, d.organization_id, om.role
FROM documents d
LEFT JOIN organization_members om
  ON d.organization_id = om.organization_id
WHERE om.user_id = 'YOUR_USER_ID';
```

---

#### Personal organization not created on signup

**Solution**:
```sql
-- Check trigger exists
SELECT tgname FROM pg_trigger
WHERE tgname = 'on_auth_user_created_organization';

-- Manually trigger for existing user
SELECT handle_new_user_organization();
```

Use the checks in this troubleshooting section together with the selected `supabase/*.sql` setup file.

---

## Documentation Index

### Core Documentation

**This Document**: Complete deployment modes guide

**Multi-Tenant Documentation**:
- `README_DEPLOYMENT_MODES.md` - Technical implementation guide, status, compatibility notes, and high-level overview
- `supabase/multi-tenant-setup.sql` - Multi-tenant schema and RLS policies
- `supabase/README.md` - Database setup notes for both deployment modes

**Database Schemas**:
- `supabase/single-tenant-setup.sql` - Single-tenant schema (1,383 lines)
- `supabase/multi-tenant-setup.sql` - Multi-tenant schema (1,143 lines)

**Configuration**:
- `src/lib/deployment-mode.ts` - Mode detection utilities
- `src/lib/env.ts` - Environment configuration
- `.env.example` - Environment template
- `scripts/configure-deployment.js` - Interactive setup CLI

---

## FAQ

**Q: Can I switch modes after deployment?**
A: Yes, but requires database migration. Always test on staging first and backup data.

**Q: Do both modes use the same codebase?**
A: Yes! Everything is shared. Mode is controlled by environment variables.

**Q: What's the performance difference?**
A: Single-tenant is slightly faster (<10ms/query) due to simpler RLS checks. Negligible for most use cases.

**Q: Can I disable specific multi-tenant features?**
A: Yes! Use feature flags: `ENABLE_ORGANIZATIONS`, `ENABLE_TEAM_INVITES`, etc.

**Q: How do subscriptions work in each mode?**
A: Single-tenant = per-user subscriptions. Multi-tenant = per-organization subscriptions.

**Q: Which mode should I choose?**
A: Start with single-tenant for simplicity. Migrate to multi-tenant when you need organization isolation.

**Q: Will my data be lost when switching modes?**
A: No, if you follow the migration guide. Always backup first!

**Q: Do I need to modify code to switch modes?**
A: No! The codebase is deployment-mode aware and handles both automatically.

---

## Support & Community

### Getting Help

1. **Check Documentation First**: Review this guide and linked documents
2. **Troubleshooting Section**: See above for common issues
3. **GitHub Issues**: https://github.com/areia-ai/chatrag/issues
4. **Discord Community**: https://discord.gg/8ZCwZjqcAY

### Contributing

- Follow existing code patterns
- Test in both deployment modes
- Update documentation when adding features
- Submit PRs with comprehensive descriptions

### Reporting Issues

When reporting deployment mode issues, include:
- Current deployment mode (`NEXT_PUBLIC_CHATRAG_DEPLOYMENT_MODE`)
- Database schema version
- Error messages and stack traces
- Steps to reproduce

---

## Summary

### Decision Matrix

**Choose Single-Tenant if:**
- ✅ Simple shared knowledge base needed
- ✅ All users should see all documents
- ✅ No team features required
- ✅ Minimal complexity desired

**Choose Multi-Tenant if:**
- ✅ Data isolation between organizations needed
- ✅ Team collaboration features required
- ✅ Per-organization quotas needed
- ✅ Building a SaaS product
- ✅ Role-based access control required
- ✅ Per-workspace AI customization needed ⭐

### Quick Comparison

| Aspect | Single-Tenant | Multi-Tenant |
|--------|---------------|--------------|
| **Complexity** | Low | Medium |
| **Setup Time** | ~10 minutes | ~20 minutes |
| **Tables** | 14 | 18 |
| **RLS** | Simple (user) | Complex (org + user) |
| **Best For** | 1-100 users | 100+ users, SaaS |
| **AI Customization** | ❌ | ✅ ⭐ |

---

## Current Status

**Overall Status**: Production ready for core single-tenant and multi-tenant flows; optional testing, optimization, and documentation polish remain.

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Complete | Foundation & Configuration |
| Phase 2 | ✅ Complete | Organization Management |
| Phase 3 | ✅ Complete | Document Isolation (RLS) |
| Phase 4 | ✅ Complete | Subscriptions & Billing |
| Phase 5 | ✅ Complete | UI Components + AI Customization ⭐ |
| Phase 6 | ⏳ Optional | Testing & Optimization |
| Phase 7 | ⏳ Optional | Documentation & Polish |

**Production Ready**: Yes (core features complete)

---

**Last Updated**: November 17, 2025
**Version**: 2.1
**Repository**: https://github.com/areia-ai/chatrag.git
**License**: MIT
