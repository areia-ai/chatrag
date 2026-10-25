#!/bin/bash

# ChatRAG Database Setup Script
# Automatically selects and applies the correct database schema based on deployment mode

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print header
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║          ChatRAG Database Setup                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
    echo -e "${GREEN}✓${NC} Loading environment from .env.local"
    export $(grep -v '^#' .env.local | xargs)
else
    echo -e "${RED}✗ Error: .env.local not found${NC}"
    echo "Please run: npm run configure-deployment"
    exit 1
fi

# Get deployment mode (default to single-tenant)
MODE=${CHATRAG_DEPLOYMENT_MODE:-single-tenant}

echo -e "${BLUE}Deployment Mode:${NC} ${MODE}"
echo ""

# Determine which SQL file to use
if [ "$MODE" = "multi-tenant" ]; then
    SQL_FILE="supabase/multi-tenant-setup.sql"
    echo -e "${BLUE}Using:${NC} Multi-tenant database schema"
elif [ "$MODE" = "single-tenant" ]; then
    SQL_FILE="supabase/single-tenant-setup.sql"
    echo -e "${BLUE}Using:${NC} Single-tenant database schema"
else
    echo -e "${RED}✗ Error: Invalid deployment mode '${MODE}'${NC}"
    echo "Valid options: single-tenant, multi-tenant"
    exit 1
fi

# Check if SQL file exists
if [ ! -f "$SQL_FILE" ]; then
    echo -e "${RED}✗ Error: ${SQL_FILE} not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found schema file: ${SQL_FILE}"
echo ""

# Get file info
FILE_SIZE=$(wc -l < "$SQL_FILE" | tr -d ' ')
echo -e "${BLUE}Schema:${NC} ${FILE_SIZE} lines"
echo ""

# Construct database URL from environment variables
if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ]; then
    echo -e "${RED}✗ Error: NEXT_PUBLIC_SUPABASE_URL not set${NC}"
    exit 1
fi

# Extract project ref from Supabase URL
PROJECT_REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co|\1|')

# Construct PostgreSQL connection URL
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${RED}✗ Error: SUPABASE_SERVICE_ROLE_KEY not set${NC}"
    exit 1
fi

# Supabase PostgreSQL connection format
DB_URL="postgresql://postgres:[PASSWORD]@db.${PROJECT_REF}.supabase.co:5432/postgres"

echo -e "${YELLOW}⚠️  Database Connection Setup${NC}"
echo ""
echo "To apply the schema, you have two options:"
echo ""
echo "1. ${BLUE}Via Supabase Dashboard (Recommended):${NC}"
echo "   a. Go to: https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new"
echo "   b. Copy and paste the contents of: ${SQL_FILE}"
echo "   c. Click 'Run' to execute the schema"
echo ""
echo "2. ${BLUE}Via psql command line:${NC}"
echo "   If you have database password set up:"
echo "   psql \"${DB_URL}\" -f \"${SQL_FILE}\""
echo ""
echo "3. ${BLUE}Via Supabase CLI:${NC}"
echo "   supabase db push --db-url \"${DB_URL}\""
echo ""

# Ask user which method they want to use
read -p "Would you like to open the Supabase dashboard now? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    DASHBOARD_URL="https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new"
    echo -e "${GREEN}✓${NC} Opening Supabase dashboard..."

    # Try to open in browser
    if command -v open &> /dev/null; then
        open "$DASHBOARD_URL"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$DASHBOARD_URL"
    else
        echo "Please open this URL in your browser:"
        echo "$DASHBOARD_URL"
    fi

    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Copy the contents of: ${SQL_FILE}"
    echo "2. Paste into the SQL editor"
    echo "3. Click 'Run'"
    echo ""
fi

# Display schema file path for easy copying
echo -e "${GREEN}✓${NC} Schema file ready: ${SQL_FILE}"
echo ""

# Print summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo ""
echo -e "${BLUE}Deployment Mode:${NC} ${MODE}"
echo -e "${BLUE}Schema File:${NC} ${SQL_FILE}"
echo -e "${BLUE}Lines:${NC} ${FILE_SIZE}"
echo ""

if [ "$MODE" = "multi-tenant" ]; then
    echo -e "${BLUE}Multi-tenant features enabled:${NC}"
    echo "  • Organizations and workspaces"
    echo "  • Team member management"
    echo "  • Per-organization knowledge bases"
    echo "  • Storage quotas and subscriptions"
else
    echo -e "${BLUE}Single-tenant features enabled:${NC}"
    echo "  • Shared knowledge base"
    echo "  • User-isolated chat history"
    echo "  • Document upload and processing"
fi

echo ""
echo -e "${BLUE}After applying the schema, start your app:${NC}"
echo "  npm run dev"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
