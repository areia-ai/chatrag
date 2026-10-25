import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

function envFallbackFromRequest(request: NextRequest): string | null {
  const headerOrigin = request.headers.get('origin');
  if (headerOrigin) return headerOrigin;

  if (request.nextUrl?.origin) {
    return request.nextUrl.origin;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return null;
}

/**
 * API endpoint to get the logo URL from the .env.local file
 * This allows us to get the latest logo URL even after the app has been built
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const logoType = searchParams.get('type');
  
  if (!logoType || (logoType !== 'header' && logoType !== 'ai')) {
    return NextResponse.json(
      { success: false, error: 'Invalid logo type' },
      { status: 400 }
    );
  }
  
  try {
    // Find the appropriate environment variable
    const envVarName = logoType === 'header'
      ? 'NEXT_PUBLIC_HEADER_LOGO_URL'
      : 'NEXT_PUBLIC_AI_RESPONSE_LOGO_URL';
    
    // First try to get from process.env (production)
    let logoUrl = process.env[envVarName] || '';
    let aiLogoType = process.env.NEXT_PUBLIC_AI_LOGO_TYPE || '';
    let showBorder = process.env.NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER?.toLowerCase() === 'true';
    let logoSize = parseInt(process.env.NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE || '3') || 3;
    let useDefaultLogo = process.env.NEXT_PUBLIC_USE_DEFAULT_AI_LOGO?.toLowerCase() === 'true';
    
    // If not found in process.env and we're in development, try reading from .env.local
    if (!logoUrl && process.env.NODE_ENV === 'development') {
      try {
        const envFilePath = path.join(process.cwd(), '.env.local');
        const envContent = await fs.readFile(envFilePath, 'utf-8');
        
        // Parse the file to get the value
        const lines = envContent.split('\n');
        
        for (const line of lines) {
          if (line.startsWith(`${envVarName}=`)) {
            logoUrl = line.substring(envVarName.length + 1).trim();
          }
          // Also check for border setting for AI logo
          if (logoType === 'ai' && line.startsWith('NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER=')) {
            const borderValue = line.substring('NEXT_PUBLIC_AI_RESPONSE_LOGO_BORDER='.length).trim();
            showBorder = borderValue.toLowerCase() === 'true';
          }
          // Check for logo size setting
          if (logoType === 'ai' && line.startsWith('NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE=')) {
            const sizeValue = line.substring('NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE='.length).trim();
            logoSize = parseInt(sizeValue) || 3;
            if (logoSize < 1 || logoSize > 5) logoSize = 3;
          }
          // Check for default logo toggle setting
          if (logoType === 'ai' && line.startsWith('NEXT_PUBLIC_USE_DEFAULT_AI_LOGO=')) {
            const defaultLogoValue = line.substring('NEXT_PUBLIC_USE_DEFAULT_AI_LOGO='.length).trim();
            useDefaultLogo = defaultLogoValue.toLowerCase() === 'true';
          }
          // Check for logo type setting
          if (logoType === 'ai' && line.startsWith('NEXT_PUBLIC_AI_LOGO_TYPE=')) {
            aiLogoType = line.substring('NEXT_PUBLIC_AI_LOGO_TYPE='.length).trim();
          }
        }
      } catch (fileError) {
        // File doesn't exist, that's okay in production
        console.log('Could not read .env.local file, using process.env');
      }
    }
    
    // Resolve relative URLs using configured site URL or request origin
    if (
      logoUrl &&
      !logoUrl.startsWith('http://') &&
      !logoUrl.startsWith('https://') &&
      !logoUrl.startsWith('data:')
    ) {
      const configSiteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        envFallbackFromRequest(request) ||
        '';

      if (configSiteUrl) {
        const normalizedBase = configSiteUrl.replace(/\/$/, '');
        const normalizedPath = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
        logoUrl = `${normalizedBase}${normalizedPath}`;
      }
    }

    // Return the logo URL and border setting for AI logo
    if (logoType === 'ai') {
      // Debug: Returning AI logo settings
      return NextResponse.json({
        success: true,
        logoUrl: logoUrl,
        logoType: aiLogoType,
        showBorder: showBorder,
        logoSize: logoSize,
        useDefaultLogo: useDefaultLogo
      });
    } else {
      // For header logo, just return the URL
      return NextResponse.json({
        success: true,
        logoUrl: logoUrl
      });
    }
  } catch (error) {
    console.error('Error reading logo settings from .env.local:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading logo settings' },
      { status: 500 }
    );
  }
} 
