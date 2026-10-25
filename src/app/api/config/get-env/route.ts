import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * API endpoint to get environment variable values from the .env.local file
 * This allows us to get the latest values even after the app has been built
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const varName = searchParams.get('var');
  
  if (!varName) {
    return NextResponse.json(
      { success: false, error: 'Missing variable name' },
      { status: 400 }
    );
  }
  
  // Security check: we only expose environment variables that start with
  // NEXT_PUBLIC_ (public values) *or* a very small explicit allow-list for
  // non-public keys we purposely want to expose (e.g. RAG_SYSTEM_PROMPT).
  const isPublicVar = varName.startsWith('NEXT_PUBLIC_');
  const explicitlyAllowed = ['RAG_SYSTEM_PROMPT'];

  if (!isPublicVar && !explicitlyAllowed.includes(varName)) {
    return NextResponse.json(
      { success: false, error: 'Variable name not allowed' },
      { status: 403 }
    );
  }
  
  try {
    // First try to get from process.env (production)
    let value = process.env[varName] || '';
    
    // If not found in process.env and we're in development, try reading from .env.local
    if (!value && process.env.NODE_ENV === 'development') {
      try {
        const envFilePath = path.join(process.cwd(), '.env.local');
        const envContent = await fs.readFile(envFilePath, 'utf-8');
        
        // Parse the file to get the value
        const lines = envContent.split('\n');
        
        for (const line of lines) {
          if (line.startsWith(`${varName}=`)) {
            value = line.substring(varName.length + 1).trim();
            
            // Strip surrounding quotes if present
            if (value.length >= 2) {
              const firstChar = value[0];
              const lastChar = value[value.length - 1];
              if ((firstChar === '"' && lastChar === '"') || 
                  (firstChar === "'" && lastChar === "'")) {
                value = value.substring(1, value.length - 1);
              }
            }
            
            break;
          }
        }
      } catch (fileError) {
        // File doesn't exist, that's okay in production
        console.log('Could not read .env.local file, using process.env');
      }
    }
    
    // Return the value
    return NextResponse.json({
      success: true,
      value: value
    });
  } catch (error) {
    console.error(`Error reading ${varName} from .env.local:`, error);
    return NextResponse.json(
      { success: false, error: 'Error reading environment variable' },
      { status: 500 }
    );
  }
} 