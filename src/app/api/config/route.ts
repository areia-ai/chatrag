import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@/lib/supabase/server';
import { isSingleTenant } from '@/lib/deployment-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper to validate env var name
function isValidEnvVarName(key: string) {
    return /^[A-Z][A-Z0-9_]*$/i.test(key);
}

export async function GET() {
    // Authentication check for multi-tenant mode
    if (!isSingleTenant()) {
        try {
            const supabase = await createClient();
            const { data: { user }, error } = await supabase.auth.getUser();

            if (!user || error) {
                return new NextResponse("Unauthorized", { status: 401 });
            }
        } catch (error) {
            console.error('Auth error:', error);
            // Continue execution to avoid breaking local dev if auth fails
            // In production, you might want to be stricter
        }
    }

    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        let config: Record<string, string> = {};

        if (fs.existsSync(envPath)) {
            const fileContent = fs.readFileSync(envPath, 'utf8');
            config = dotenv.parse(fileContent);
        }

        return NextResponse.json({ config });
    } catch (error) {
        console.error('Error reading config:', error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

export async function POST(request: Request) {
    // Authentication check for multi-tenant mode
    if (!isSingleTenant()) {
        try {
            const supabase = await createClient();
            const { data: { user }, error } = await supabase.auth.getUser();

            if (!user || error) {
                return new NextResponse("Unauthorized", { status: 401 });
            }
        } catch (error) {
            console.error('Auth error:', error);
            return new NextResponse("Unauthorized", { status: 401 });
        }
    }

    try {
        const body = await request.json();
        const updates = body.config || {};
        const envPath = path.resolve(process.cwd(), '.env.local');

        // Read existing file
        let lines: string[] = [];
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            lines = content.split('\n');
        }

        const validUpdates = Object.entries(updates).filter(([key]) => isValidEnvVarName(key));

        if (validUpdates.length === 0) {
            return NextResponse.json({ success: true, message: 'No valid updates provided' });
        }

        // Apply updates
        validUpdates.forEach(([key, value]) => {
            const strValue = String(value);
            let found = false;

            // Map existing lines to update values
            lines = lines.map(line => {
                const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
                // Check if line starts with key= (ignoring comments)
                if (match && match[1] === key) {
                    found = true;
                    return `${key}=${strValue}`;
                }
                return line;
            });

            // If not found, append
            if (!found) {
                lines.push(`${key}=${strValue}`);
            }
        });

        // Write back to file
        fs.writeFileSync(envPath, lines.join('\n'));

        return NextResponse.json({ success: true, message: 'Configuration saved' });
    } catch (error) {
        console.error('Error updating config:', error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
