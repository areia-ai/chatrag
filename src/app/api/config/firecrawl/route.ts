import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@/lib/supabase/server';
import { isSingleTenant } from '@/lib/deployment-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    // Public config endpoint - no sensitive data returned


    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        const config = {
            isEnabled: false,
            showOnDashboard: true
        };

        if (fs.existsSync(envPath)) {
            const fileContent = fs.readFileSync(envPath, 'utf8');
            const parsed = dotenv.parse(fileContent);

            config.isEnabled = parsed.NEXT_PUBLIC_FIRECRAWL_ENABLED === 'true';
            // Default to true if missing, unless explicitly false
            config.showOnDashboard = parsed.NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD !== 'false';
        }

        return NextResponse.json(config);
    } catch (error) {
        console.error('Error reading Firecrawl config:', error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
