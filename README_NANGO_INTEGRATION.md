# Nango Integration Developer Guide

This is a comprehensive guide for developers working with the Nango integration in ChatRAG. It covers architecture, setup, implementation details, and troubleshooting.

## Quick Navigation

- **Getting Started?** → [Quick Start](#quick-start)
- **Managing providers as admin?** → [Admin Configuration Guide](#admin-configuration-guide)
- **Setting up a provider?** → [OAuth Setup by Provider](#oauth-setup-by-provider)
- **Adding a new feature?** → [Architecture & Code Structure](#architecture--code-structure)
- **Debugging issues?** → [Troubleshooting & Common Issues](#troubleshooting--common-issues)
- **Want all details?** → [Complete Reference](#complete-reference)

---

## Document Status

**Last Updated:** December 4, 2025  
**Integration Status:** Google Drive ✅ | Dropbox ✅ | Notion ✅ (All Fully Complete)  
**Admin Controls:** Connectors Management Dashboard ✅ | Feature Toggles ✅ | Provider Configuration ✅
**Config UI:** Full connector management system ✅ | All pickers working ✅ | Event delegation pattern ✅

### Key Updates
- December 4, 2025: Config UI connector management system fully implemented with all pickers working
  - Event delegation pattern for picker selections
  - Dropbox root files fix (files shown from root, not sync_folder_id)
  - All pickers tested and verified (Google Drive, Dropbox, Notion)
- December 3, 2025: Admin connectors management system with feature toggles and provider controls
- December 3, 2024: Notion page picker hierarchy with dual-mode system (top-level + subpages)
- December 2, 2024: Multi-provider support (Google Drive, Dropbox, Notion)
- November: Initial Nango integration foundation

### Supported Providers

**Currently Supported (3):**
- ✅ **Google Drive** - Full support for folder/file selection and sync
- ✅ **Notion** - Dual-mode page picker (top-level + subpages)
- ✅ **Dropbox** - Full folder/file selection and sync

---

## Quick Start

### Prerequisites
- Node.js 20+
- Nango account (sign up at [nango.dev](https://nango.dev), docs at [nango.dev/docs](https://nango.dev/docs))
- ChatRAG development environment running

### 1. Get Nango API Keys (5 minutes)
```bash
# Sign up at https://app.nango.dev
# In Environment Settings → API Keys:
# - Copy Secret Key → NANGO_SECRET_KEY (this is the only key needed!)
```

### 2. Configure Environment Variables
```bash
cp .env.local .env.local.backup
cat >> .env.local << 'EOF'
NEXT_PUBLIC_NANGO_ENABLED=true
NANGO_SECRET_KEY=your_secret_key_here
NANGO_WEBHOOK_SECRET=your_webhook_secret
NANGO_HOST=https://api.nango.dev
EOF
```

### 3. Start Development Server
```bash
npm install @nangohq/node @nangohq/frontend  # Install packages if not already done
npm run dev
# Navigate to http://localhost:3000
```

### 4. Test OAuth Connection
1. Go to Documents dashboard
2. Click "Connect" on any provider (Google Drive, Notion, Dropbox)
3. Complete OAuth flow in popup
4. You should see a success message

That's it! You can now sync documents.

---

## Admin Configuration Guide

### For Administrators

Admins can manage which connectors are available to users without any code changes using the visual Configuration Dashboard.

#### Accessing the Configuration Dashboard

```bash
# Terminal
npm run config

# Browser
http://localhost:3333
```

#### Features

**1. Enable/Disable the Entire Connectors Feature**
- Navigate to the **"🔗 Connectors"** tab
- Under "Feature Status", toggle: **"Enable Connectors Feature"**
- When disabled: Users won't see the Connectors section at all
- When enabled: Users can see available providers based on individual settings

**2. Control Dashboard Visibility**
- Under "Feature Status", toggle: **"Show Connectors on Document Dashboard"**
- Controls whether the Connectors section appears on the Document Dashboard
- Works in conjunction with the feature enabled toggle

**3. Manage Individual Providers**
- See all available providers with their current status
- For each provider, click "Settings" to expand:
  - **Enable/Disable** - Toggle whether users can see this provider
  - **Show on Dashboard** - Toggle visibility independently
  - **View Statistics** - See connected users, last sync time, success rates

**4. Monitor Active Connections**
- See a table of all provider connections with:
  - Provider name
  - Number of connected users
  - Last sync timestamp
  - Success rate percentage

#### Common Admin Tasks

**Task: Disable All Connectors**
1. Open Config Dashboard at http://localhost:3333
2. Click "🔗 Connectors" tab
3. Toggle "Enable Connectors Feature" OFF
4. Save changes
5. Users will no longer see Connectors section

**Task: Enable Only Google Drive**
1. Open Config Dashboard
2. Click "🔗 Connectors" tab
3. For each provider except Google Drive:
   - Click "Settings"
   - Toggle "Enable Provider" OFF
4. Save changes

**Task: View Connection Statistics**
1. Open Config Dashboard
2. Click "🔗 Connectors" tab
3. Scroll to "Active Connections" table
4. See real-time stats for all providers

**Task: Reset to Defaults**
1. Open Config Dashboard
2. Click "🔗 Connectors" tab
3. Click "Reset to Defaults" button
4. All settings return to defaults (3 enabled, 3 disabled)

---

## Config UI Connector Management System

### Overview

The Config UI (`http://localhost:3333`) provides a complete admin interface for managing Nango connectors without code changes. Built with vanilla JavaScript, it mirrors the main UI's React components and adds additional admin-only features.

### Getting Started with Config UI

```bash
# Start the config server
npm run config

# Access at http://localhost:3333
# Navigate to "🔗 Connectors" tab
```

### Config UI Architecture

**Tech Stack:**
- Vanilla JavaScript (ES6) - No React/frameworks
- Nango SDK loaded via CDN
- Custom modal system with focus trap
- Event delegation for robust event handling
- Class-based state management

**Key Files:**
```
scripts/config-ui/
├── connectors-config.js          # Main manager class
├── nango-client.js               # Nango SDK wrapper
├── pickers/
│   ├── folder-picker.js          # Google Drive/Dropbox folder selection
│   ├── file-picker.js            # File selection (multi-select)
│   └── notion-page-picker.js     # Notion page selection (dual-mode)
└── utils/
    └── modal.js                  # Base modal class
```

### Picker Implementation Details

All pickers (folder, file, Notion page) use an **Event Delegation Pattern** for robust event handling:

#### Pattern Overview
Instead of inline onclick handlers, each picker attaches a single event listener to the container and uses `dataset` attributes for data storage:

```javascript
// Setup (done after rendering):
container.addEventListener('click', (e) => {
  const folderEl = e.target.closest('[data-folder-id]');
  if (folderEl && window.folderPicker) {
    const folderId = folderEl.dataset.folderId;
    window.folderPicker.selectFolder(folderId, ...);
  }
});

// HTML (generated by picker):
<div data-folder-id="abc123" data-folder-name="My Folder">
  My Folder
</div>
```

**Why this approach:**
- No inline onclick strings (avoids syntax issues)
- No special character escaping needed
- Single listener per picker (efficient)
- Clean event bubbling
- Easy to debug

#### Folder Picker (`folder-picker.js`)
- **Usage:** Google Drive, Dropbox folder selection
- **Features:**
  - Hierarchical tree with expand/collapse
  - Search/filter with auto-expand
  - Single folder selection
  - Infinite depth support

#### File Picker (`file-picker.js`)
- **Usage:** Google Drive, Dropbox file selection
- **Features:**
  - Multi-select with checkboxes
  - Select All / Deselect All buttons
  - Search/filter by filename
  - File metadata display (size, modified date)
  - File type icons

**Important - Dropbox Specific:**
The file picker loads files from the ROOT directory by default, not from `sync_folder_id`. The `sync_folder_id` is used during sync operations to determine which folder's documents to ingest, but file selection always happens from root to give users full visibility.

```javascript
// In connectors-config.js openFilePicker()
const folderId = provider === 'dropbox' ? null : (providerData.user_connection.sync_folder_id || null);
```

#### Notion Page Picker (`notion-page-picker.js`)
- **Usage:** Notion page/database selection
- **Features:**
  - Two modes: `top-level` (single-select) and `subpages` (multi-select)
  - Hierarchical tree with lazy-loading
  - Expand/collapse nested pages
  - Search/filter by page name

### Modal System (`utils/modal.js`)

Base class for all pickers with:
- Focus trap (prevents tabbing outside modal)
- Keyboard navigation (ESC to close)
- Click-outside to close
- Animation support
- Loading/error state management

```javascript
class FilePickerModal extends Modal {
  constructor(provider, connectionId, folderId) {
    super({
      id: `file-picker-${provider}`,
      title: `Select Files - ${provider}`,
      size: 'lg'
    });
    // ... initialization
  }

  async openPicker(onSelect) {
    // Returns a Promise that resolves when user confirms/cancels
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      // ... setup and fetch
    });
  }
}
```

### How to Extend or Modify Pickers

#### Adding a New Picker
1. Create `scripts/config-ui/pickers/my-picker.js`
2. Extend the `Modal` base class
3. Implement `fetchData()` to call your API
4. Implement `renderContent()` with event delegation
5. Implement `attachEventListeners()` for click handling
6. Call from `connectors-config.js`

#### Modifying Picker Behavior
Example: Change Dropbox file picker to show files from `sync_folder_id` instead of root:

```javascript
// In connectors-config.js openFilePicker()
// OLD (current - loads from root):
const folderId = provider === 'dropbox' ? null : (providerData.user_connection.sync_folder_id || null);

// NEW (to use sync folder):
const folderId = providerData.user_connection.sync_folder_id || null;
```

### Nango Client Wrapper (`nango-client.js`)

Simplified SDK wrapper that handles OAuth flows and connection management using Connect Sessions (no public key needed - session tokens are created per-provider via the backend):

```javascript
// Initialize (happens automatically on page load)
await nangoClient.init(); // Uses Connect Sessions - no public key needed

// Connect to a provider
await nangoClient.connect('google-drive');

// Update connection settings
await nangoClient.updateConnection('google-drive', {
  syncFolderId: 'folder123',
  syncFolderName: 'My Folder'
});

// Sync documents
await nangoClient.sync('google-drive', connectionId);

// Disconnect
await nangoClient.disconnect('google-drive');
```

---

## Architecture & Code Structure

### System Overview

```
USER → Browser OAuth → Nango Cloud → Provider OAuth → Provider API
                ↓
           ChatRAG Backend
              ↓
         Sync Pipeline
              ↓
      LlamaCloud + OpenAI + Supabase Vector DB
```

### Key Files & Directories

#### Backend Services (`src/lib/nango/`)
| File                    | Purpose                             | Key Functions                                      |
|-------------------------|-------------------------------------|----------------------------------------------------|  
| `client.ts`             | Nango SDK wrapper & singleton       | `getNango()`, `isNangoEnabled()`                   |
| `types.ts`              | TypeScript interfaces               | `SupportedProvider`, `NangoConnectionRecord`       |
| `sync-manager.ts`       | Document sync orchestration         | `syncDocuments()`, `deleteOrphanedDocuments()`     |
| `file-fetcher.ts`       | File download via Nango proxy       | `fetchFileContent()`, buffer handling              |
| `document-adapter.ts`   | Adapter to document processor       | Converts synced files to documents                 |

#### API Routes (`src/app/api/nango/`)
| Route              | Method          | Purpose                                     |
|--------------------|-----------------|---------------------------------------------|
| `/session`         | POST            | Creates OAuth connect session               |
| `/connections`     | GET/POST/PATCH  | Lists, registers, updates connections       |
| `/sync`            | POST            | Triggers manual document sync               |
| `/folders`         | GET             | Lists folders for folder picker             |
| `/files`           | GET             | Lists files for file picker                 |
| `/notion/pages`    | GET             | Lists Notion pages (root/tree/children)     |

#### Frontend Components (`src/components/ui/nango/`)
| Component                  | Purpose                                    | Modes                   |
|----------------------------|--------------------------------------------|-------------------------|
| `connector-grid.tsx`       | Provider connection cards                  | All providers           |
| `notion-page-picker.tsx`   | Notion page selection UI                   | Top-level / Subpages    |
| `folder-picker.tsx`        | Folder selection (Google Drive, Dropbox)   | Folder tree             |
| `file-picker.tsx`          | File selection multi-select                | File list with search   |

### Data Flow: Document Sync

```
1. User clicks "Sync" on a provider
2. Backend fetches list of files/pages from provider via Nango proxy
3. For each file/page:
   a. Download content via Nango
   b. Parse with LlamaCloud
   c. Generate embeddings with OpenAI
   d. Store in Supabase with vector indexes
4. Track in nango_sync_records table
5. Return sync statistics (added, updated, deleted, failed)
```

### Database Schema

#### `nango_connections` table
Tracks provider OAuth connections per user.

```sql
- id (uuid, pk)
- user_id (uuid, fk to auth.users)
- provider (text) - 'google-drive', 'notion', 'dropbox', etc.
- connection_id (text) - Unique connection ID from Nango
- status (text) - 'pending', 'connected', 'error', 'disconnected'
- connected_at (timestamp)
- last_sync_at (timestamp)
- sync_enabled (boolean)
- sync_folder_id (text) - Selected folder ID
- sync_file_ids (text[]) - Selected file IDs
- metadata (jsonb) - Provider-specific data
```

#### `nango_sync_records` table
Tracks individual files/pages synced from each provider.

```sql
- id (uuid, pk)
- user_id (uuid, fk)
- connection_id (text)
- provider (text)
- file_id (text) - Remote file/page ID
- file_name (text)
- document_id (uuid, fk to documents, nullable)
- status (text) - 'pending', 'processing', 'completed', 'failed'
- last_synced_at (timestamp)
- error_message (text, nullable)
- metadata (jsonb) - file size, type, modified_at, etc.
```

#### Key Points
- User-scoped data via RLS policies on Supabase
- Cascade deletes: delete document → auto-delete chunks
- Sync records track what's been synced before (for incremental sync)

---

## OAuth Setup by Provider

### Google Drive

#### Quick Setup (Development)
Nango provides pre-configured Google Drive credentials. Just connect in the app.

#### Production Setup (Your Own Credentials)

**Step 1: Create Google Cloud Project**
```
1. Go to https://console.cloud.google.com
2. Create new project named "ChatRAG"
3. Enable Google Drive API
4. Go to OAuth consent screen:
   - External application type
   - App name: ChatRAG
   - Add yourself as test user
5. Create OAuth 2.0 credentials:
   - Type: Web application
   - Authorized redirect URIs: https://api.nango.dev/oauth/callback
```

**Step 2: Configure in Nango**
```
1. Go to https://app.nango.dev/integrations
2. Find or create "google-drive" integration
3. Paste Client ID and Client Secret
4. Scopes: https://www.googleapis.com/auth/drive.readonly
5. Save
```

**Step 3: Test**
```bash
node scripts/diagnose-nango-oauth.js
# Should show google-drive integration ✓
```

---

### Notion

#### Setup Steps

**Step 1: Create Notion Integration**
```
1. Go to https://www.notion.so/my-integrations
2. Click "Create new integration"
3. Name: ChatRAG Integration
4. Associated workspace: Select your workspace
5. Capabilities: Enable "Read content"
```

**Step 2: Enable OAuth**
```
1. Go to Distribution tab
2. Enable OAuth 2.0
3. Redirect URIs: https://api.nango.dev/oauth/callback
```

**Step 3: Get Credentials**
```
1. Go to Secrets tab
2. Copy Client ID and Client Secret
```

**Step 4: Configure in Nango**
```
1. Go to https://app.nango.dev/integrations
2. Find "notion" integration
3. Paste credentials
4. Save
```

**Step 5: Grant Access**
```
1. In Notion integration settings
2. Publish to workspace
3. Accept the connection request
```

#### Special Notes for Notion
- Page hierarchy uses `parent.type === 'workspace'` to identify root pages
- Child pages detected via `has_children` flag
- Dual-mode picker allows selecting top-level pages or specific subpages
- Max 5 levels of nesting supported

---

### Dropbox

#### Setup Steps

**Step 1: Create Dropbox App**
```
1. Go to https://www.dropbox.com/developers/apps
2. Create App → Scoped access → Full Dropbox
3. Name: ChatRAG Integration
```

**Step 2: Configure Permissions**
```
In Permissions tab:
✓ files.metadata.read
✓ files.content.read
Submit
```

**Step 3: Set Redirect URI**
```
In Settings tab:
OAuth 2 → Redirect URIs:
https://api.nango.dev/oauth/callback
```

**Step 4: Get Credentials**
```
App key = OAuth Client ID
App secret = OAuth Client Secret
```

**Step 5: Configure in Nango**
```
1. https://app.nango.dev/integrations
2. Create "dropbox" integration
3. Paste App key and App secret
4. Scopes: files.metadata.read files.content.read
5. Save
```

---

## Common Workflows

### Add a New Provider

To add support for a new provider:

**1. Create Nango Integration**
- Get OAuth credentials from provider
- Configure in Nango dashboard with redirect URI

**2. Update Type Definitions**
```typescript
// src/lib/nango/types.ts
export type SupportedProvider = 
  | 'google-drive' 
  | 'notion' 
  | 'dropbox'
  | 'new-provider'  // ← Add here

export const PROVIDER_CONFIG = {
  // ...existing providers
  'new-provider': {
    displayName: 'New Provider',
    icon: '/icons/connectors/new-provider.svg',
    description: 'Import files from New Provider',
    fileModel: 'files',
  },
}
```

**3. Add Sync Logic**
```typescript
// src/lib/nango/sync-manager.ts
export async function syncDocuments(provider: SupportedProvider, ...) {
  switch(provider) {
    case 'google-drive':
      return syncGoogleDriveDocuments(...);
    case 'new-provider':
      return syncNewProviderDocuments(...);  // ← Add here
  }
}

async function syncNewProviderDocuments(...) {
  // Implement file listing and download
  const files = await listNewProviderFiles(nango, connectionId);
  return processFiles(files);
}
```

**4. Add API Routes (if needed)**
```typescript
// src/app/api/nango/new-provider/files/route.ts
export async function GET(request: NextRequest) {
  // List files from New Provider via Nango proxy
}
```

**5. Add Frontend Component (if unique UI needed)**
```typescript
// src/components/ui/nango/new-provider-picker.tsx
// Optional: special picker UI for New Provider
```

**6. Update Connector Grid**
```typescript
// src/components/ui/nango/connector-grid.tsx
// Add New Provider to provider list and render appropriate buttons
```

---

### Implement Page Selection (Like Notion)

If adding a provider with hierarchical pages:

**1. Implement API Endpoint**
```typescript
// src/app/api/nango/{provider}/pages/route.ts
export async function GET(request: NextRequest) {
  const mode = searchParams.get('mode'); // 'root' | 'tree' | 'children'
  
  if (mode === 'root') {
    // Return top-level pages only
  } else if (mode === 'tree') {
    // Return complete hierarchy
  } else if (mode === 'children') {
    // Return children of a parent
  }
}
```

**2. Create Page Picker Component**
```typescript
// src/components/ui/nango/{provider}-page-picker.tsx
export function ProviderPagePicker({ mode, ...props }) {
  // Render page selection UI
  // Use recursive PageNode for tree structure
}
```

**3. Add to Connector Grid**
```typescript
// src/components/ui/nango/connector-grid.tsx
{isConnected && provider === '{provider}' && (
  <>
    <button onClick={() => setPickerMode('top-level')}>
      Select Top-Level Pages
    </button>
    <button onClick={() => setPickerMode('subpages')}>
      Select Subpages
    </button>
  </>
)}
```

---

## Config UI Troubleshooting

### Picker Issues

#### Pickers Don't Open or Show "Failed to load files"
**Cause:** API endpoints not accessible or authentication issue

**Solution:**
1. Ensure main app is running: `npm run dev` on port 3000
2. Ensure config server is running: `npm run config` on port 3333
3. Check browser console for actual error message
4. Verify connection exists in Config UI "Supported Connectors" section

#### Dropbox File Picker Shows 0 Files
**Cause:** A `sync_folder_id` was previously set to a folder that's empty

**Fix:** 
1. In file picker, files are shown from root directory (not from `sync_folder_id`)
2. If you previously selected `/RAG_Test` folder and it has no files, that's why it shows 0
3. Solution: Select a folder with files, or just select files from root

#### Selection Not Working (Click on File/Folder Does Nothing)
**Cause:** Event delegation listener not attached

**Fix:**
1. Open browser console (F12)
2. Look for errors in the picker's `attachEventListeners()` method
3. Verify `data-folder-id` or `data-file-id` attributes exist in HTML
4. Try refreshing the page and reopening the picker

#### Modal Won't Close After Selection
**Cause:** Promise resolver not called properly

**Fix:**
1. Check console for errors in `confirmSelection()` or `cancel()` methods
2. Verify the picker's `resolvePromise` property exists
3. Try closing with ESC key (keyboard navigation)
4. As last resort, refresh page

### Config UI Not Loading

#### "Failed to proxy Nango API request"
**Cause:** Main app (port 3000) not running

**Solution:**
```bash
# Terminal 1: Start main app
npm run dev

# Terminal 2: Start config server (after main app starts)
npm run config
```

#### Config Server Crashes on Start
**Cause:** Port 3333 already in use

**Solution:**
```bash
# Find what's using port 3333
lsof -i :3333

# Kill the process
kill -9 <PID>

# Restart
npm run config
```

#### "Nango SDK not loaded"
**Cause:** Nango CDN script failed to load

**Solution:**
1. Check internet connection
2. Check browser Network tab for script errors
3. Ensure main app is running (Connect Sessions are created via backend)
4. Check browser console for CORS errors

---

## Troubleshooting & Common Issues

### OAuth Connection Fails

**Symptom:** "Failed to create connect session" error

**Causes & Solutions:**
1. **Nango not enabled** - Check `NEXT_PUBLIC_NANGO_ENABLED=true` in `.env.local`
2. **Wrong API keys** - Verify keys in `.env.local` match Nango dashboard
3. **User not authenticated** - Must be logged in to app
4. **Provider not configured** - Check Nango dashboard integrations

**Debug:**
```bash
node scripts/diagnose-nango-oauth.js
# Shows API connectivity and configured integrations
```

---

### Documents Not Syncing

**Symptom:** "Sync succeeded but no documents appeared"

**Causes & Solutions:**
1. **No files in folder** - Select a non-empty folder/page
2. **Unsupported file types** - Check `NANGO_SUPPORTED_FILE_TYPES` env var
3. **Permission issues** - User may not have read access to files
4. **LlamaCloud/OpenAI errors** - Check logs in `/api/process-document`

**Debug:**
```bash
node scripts/diagnose-nango-sync.js
# Shows synced documents and vector search results
```

---

### Notion Page Picker Shows Flat List

**Symptom:** All pages appear at same level, no hierarchy

**Root Cause:** API filtering not working

**Solution:** Ensure backend code filters by `parent.type === 'workspace'`:
```typescript
const rootPages = results.filter(page => 
  page.parent?.type === 'workspace'
);
```

**Debug:**
- Check browser Network tab: `/api/nango/notion/pages?mode=root`
- Verify response includes correct parent types
- Check component renders PageNode recursively

---

### File Download Returns "NO_CONTENT_HERE"

**Symptom:** Synced documents have empty content

**Root Cause:** Nango proxy returns binary data in various formats

**Solution:** File-fetcher.ts already handles multiple formats. If issue persists:
```typescript
// In file-fetcher.ts, ensure all response types are handled:
if (Buffer.isBuffer(data)) { /* ... */ }
if (data instanceof ArrayBuffer) { /* ... */ }
if (typeof data === 'string') { /* ... */ }
```

---

### Document Source Shows "Unknown Document"

**Symptom:** RAG chat shows document source as "Unknown Document"

**Root Cause:** Chunks don't have filename in content

**Solution:** Fetch from database using document_id (already implemented):
```typescript
// src/app/api/chat/route.ts
const documentName = await getDocumentNameFromId(chunk.document_id);
// Don't try to parse from chunk content
```

---

### Token Refresh Fails (Nango-Provided Credentials)

**Symptom:** Connection disconnects after ~1 hour

**Explanation:** Nango-provided credentials use shared token pool with rate limits

**Solutions:**
1. **For Development:** Reconnect manually (expected behavior)
2. **For Production:** Set up your own OAuth credentials (see OAuth Setup section)

---

## Testing

### Unit Testing

```bash
# Run tests
npm test

# Test individual provider sync
npm test -- sync-manager.test.ts
```

### Integration Testing

**Test OAuth Connection:**
```bash
npm run dev
# 1. Navigate to Documents
# 2. Click "Connect" on provider
# 3. Verify OAuth flow completes
# 4. Check Nango dashboard logs
```

**Test Document Sync:**
```bash
npm run dev
# 1. Connect to provider
# 2. Select folder/pages
# 3. Click "Sync"
# 4. Monitor /api/nango/sync logs
# 5. Verify documents in dashboard
```

**Test Vector Search:**
```bash
npm run dev
# 1. Sync some documents
# 2. Go to chat
# 3. Ask question about synced content
# 4. Verify RAG retrieves correct document
# 5. Check console for "[Document Search]" logs
```

### E2E Testing

```bash
npm run build  # Full production build
npm start      # Production server
# Run manual tests above
```

---

## Performance Optimization

### Sync Performance

**Current Metrics:**
- Google Drive: ~2 seconds per document (download + parse + embed)
- Notion: ~1 second per page (extract blocks + parse + embed)
- Dropbox: ~2 seconds per file

**Optimization Tips:**
1. **Batch processing:** Process 10-20 documents in parallel
2. **Incremental sync:** Only re-process modified files
3. **Caching:** Cache folder trees in localStorage

**Example: Parallel Processing**
```typescript
const results = await Promise.allSettled(
  files.map(file => processFile(file))
);
```

### API Response Times

**Notion Page Tree:** ~1-2 seconds for 100 pages (depends on nesting depth)
**Google Drive Folder:** ~500ms for 50 files

**Optimization:** Pre-calculate and cache page trees in background

---

## Security Considerations

### Token Security
- ✅ Secret keys stored in server env vars (never exposed to frontend)
- ✅ Public keys used only in frontend SDK
- ✅ Tokens stored securely by Nango
- ⚠️ Never log tokens or credentials

### Data Privacy
- ✅ User-scoped data via RLS on Supabase
- ✅ Deletions from source cascade to embeddings
- ⚠️ Ensure file content is treated as sensitive
- ⚠️ Validate user permissions before syncing

### OAuth Best Practices
- ✅ Use HTTPS in production
- ✅ Validate OAuth callback state
- ✅ Implement token refresh logic
- ⚠️ Rotate secrets regularly in production

---

## Environment Variables Reference

```bash
# Core Feature Flags
NEXT_PUBLIC_NANGO_ENABLED=true                # Enable/disable entire Nango feature
NEXT_PUBLIC_CONNECTORS_ENABLED=true           # Enable/disable connectors system
CONNECTORS_SHOW_ON_DASHBOARD=true             # Show connectors on Document Dashboard

# Nango API Credentials
NANGO_SECRET_KEY=sk_...                       # Backend (secret!) - only key needed
NANGO_WEBHOOK_SECRET=secret                    # Webhook signature verification

# Nango Configuration
NANGO_HOST=https://api.nango.dev               # Cloud endpoint
# NANGO_HOST=http://localhost:3003            # Self-hosted endpoint

# Sync Configuration
NANGO_SYNC_INTERVAL_HOURS=1                    # Auto-sync interval (0 = manual only)
NANGO_MAX_FILES_PER_SYNC=100                   # Batch size limit
NANGO_SUPPORTED_FILE_TYPES=pdf,doc,docx        # Comma-separated extensions

# Feature Level vs Provider Level
# Feature Level: NEXT_PUBLIC_CONNECTORS_ENABLED and CONNECTORS_SHOW_ON_DASHBOARD
#   - Controls whether connectors feature exists at all
#   - Managed via Admin Configuration Dashboard (no env var needed)
#
# Provider Level: Controlled per-provider in admin dashboard
#   - Each provider has enabled/disabled status
#   - Each provider has dashboard visibility toggle
#   - No env vars required (managed via database/config API)
```

---

## Complete Reference

### API Endpoints

#### Configuration Management (Admin Only)
- `GET /api/config/connectors` - Get all provider configs with stats and connection data
- `PUT /api/config/connectors` - Update connector configurations (admin-only via RLS)

**Response Schema:**
```json
{
  "feature_enabled": boolean,
  "show_on_dashboard": boolean,
  "providers": [
    {
      "provider": "google-drive",
      "enabled": boolean,
      "show_on_dashboard": boolean,
      "button_label": string,
      "description": string,
      "supported_file_types": string[],
      "max_files_per_sync": number,
      "stats": {
        "connected_users": number,
        "last_sync": ISO8601 | null,
        "total_syncs": number,
        "failed_syncs": number
      }
    }
  ]
}
```

#### Authentication
- `POST /api/nango/session` - Create OAuth session
- `GET /api/nango/connections` - List user's connections
- `POST /api/nango/connections` - Register new connection
- `PATCH /api/nango/connections` - Update connection settings

#### File/Folder Selection
- `GET /api/nango/folders?provider=X` - List folders
- `GET /api/nango/files?provider=X&folderId=Y` - List files
- `GET /api/nango/notion/pages?mode=root|tree|children` - Notion pages

#### Sync
- `POST /api/nango/sync` - Trigger manual sync
- `POST /api/nango/webhook` - Nango webhook (auto-called)

### Key Functions

#### Sync Manager
```typescript
syncDocuments(provider, connectionId, userId)
  → Promise<{ added, updated, deleted, failed }>

deleteOrphanedDocuments(provider, connectionId, userId)
  → Promise<{ deleted }>

fetchFilesForProvider(provider, folderId, ...)
  → Promise<File[]>
```

#### File Fetcher
```typescript
fetchFileContent(nango, provider, fileId)
  → Promise<Buffer>

processNotionBlocks(nango, pageId, connectionId)
  → Promise<string> // Plain text content
```

#### Nango Client
```typescript
getNango()
  → Nango // Singleton instance

isNangoEnabled()
  → boolean
```

### TypeScript Types

```typescript
type SupportedProvider = 
  | 'google-drive' 
  | 'notion' 
  | 'dropbox'

interface NangoConnectionRecord {
  id: string
  user_id: string
  connection_id: string
  provider: SupportedProvider
  status: 'pending' | 'connected' | 'error' | 'disconnected'
  connected_at?: string
  last_sync_at?: string
  sync_enabled: boolean
  metadata: Record<string, any>
}

interface SyncStats {
  processed: number
  failed: number
  skipped: number
  deleted: number
}
```

---

## Resources

### Official Documentation
- [Nango Docs](https://docs.nango.dev/)
- [Nango Node SDK](https://docs.nango.dev/reference/sdks/node)
- [Nango Frontend SDK](https://docs.nango.dev/reference/sdks/frontend)

### Provider APIs
- [Google Drive API](https://developers.google.com/drive/api/v3/about-sdk)
- [Notion API](https://developers.notion.com/)
- [Dropbox API](https://www.dropbox.com/developers)

### Related Files

#### Nango Integration
- Client: `src/lib/nango/client.ts`
- Sync Manager: `src/lib/nango/sync-manager.ts`
- File Fetcher: `src/lib/nango/file-fetcher.ts`
- API Routes: `src/app/api/nango/*`
- Components: `src/components/ui/nango/*`

#### Connectors Management (Admin)
- Configuration API: `src/app/api/config/connectors/route.ts`
- Config Hook: `src/lib/hooks/use-connector-config.ts`
- Config Components: `src/components/config-ui/connectors/*`
- Database Migration: `supabase/migrations/add_connector_config_table.sql`

#### Environment & Setup
- Configuration: `src/lib/env.ts`, `scripts/init-env.js`
- Config Server: `scripts/config-server.js`
- Document processing: `src/lib/document-processor.ts`
- RAG pipeline: `src/app/api/chat/route.ts`

---

## Quick Reference Table

### Provider Status & Statistics

| Provider | Status | Users | Last Sync | Total Syncs |
|----------|--------|-------|-----------|-------------|
| Google Drive | ✅ Enabled | *Live* | *Live* | *Live* |
| Notion | ✅ Enabled | *Live* | *Live* | *Live* |
| Dropbox | ✅ Enabled | *Live* | *Live* | *Live* |

*Live statistics shown in Admin Configuration Dashboard*

### Admin Control Locations

| Task                                | Location            | How                                          |
|-------------------------------------|---------------------|----------------------------------------------|
| Enable/disable all connectors       | Config Dashboard    | Toggle "Enable Connectors Feature"           |
| Show/hide on dashboard              | Config Dashboard    | Toggle "Show on Document Dashboard"          |
| Enable individual provider          | Config Dashboard    | Click provider → Toggle "Enable"             |
| View user connections               | Config Dashboard    | View "Active Connections" table              |
| Monitor sync statistics             | Config Dashboard    | Expand provider card                         |
| Reset to defaults                   | Config Dashboard    | Click "Reset to Defaults"                    |

### Common Commands

```bash
# View current configuration
curl http://localhost:3000/api/config/connectors | jq .

# Check if connectors are enabled
curl http://localhost:3000/api/config/connectors | jq '.feature_enabled'

# List only enabled providers
curl http://localhost:3000/api/config/connectors | \
  jq '.providers[] | select(.enabled == true) | .provider'

# View provider statistics
curl http://localhost:3000/api/config/connectors | \
  jq '.providers[] | {provider: .provider, connected_users: .stats.connected_users}'

# Open admin dashboard
npm run config
```

---

## Support & Issues

### Getting Help
1. Check troubleshooting section above
2. Review recent commits in git history
3. Check Nango dashboard logs
4. Enable debug logging: `console.log('[Nango]', ...)` 

### Reporting Issues
Include:
- Provider name and OAuth credentials type (Nango-provided vs. own)
- Steps to reproduce
- Error message and logs
- Environment (development vs. production)

---

## Version History

| Date | Changes | Status |
|------|---------|--------|
| Dec 4, 2025 | Config UI picker selection fixes - event delegation pattern, Dropbox root files | ✅ Complete |
| Dec 3, 2025 | Admin connectors management system with full Config UI implementation | ✅ Complete |
| Dec 3, 2024 | Notion page picker hierarchy + dual-mode system | ✅ Complete |
| Dec 2, 2024 | Multi-provider support (Google Drive, Dropbox, Notion) | ✅ Complete |
| Nov 2024 | Initial Nango foundation | ✅ Complete |

