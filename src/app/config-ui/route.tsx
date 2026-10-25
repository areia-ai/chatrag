import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

/**
 * Route to serve the config-ui index.html file.
 */
export async function GET() {
  try {
    const htmlPath = path.join(process.cwd(), 'scripts', 'config-ui', 'index.html');
    const htmlContent = await fs.readFile(htmlPath, 'utf-8');
    
    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        // Add cache control to ensure fresh loading
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error("Error serving config-ui:", error);
    return new NextResponse('Error loading configuration UI.', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
} 