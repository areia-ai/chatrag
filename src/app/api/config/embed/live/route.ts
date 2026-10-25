import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Get base configuration from environment
    const baseConfig = {
      embedEnabled: env.NEXT_PUBLIC_EMBED_ENABLED === 'true',
      appName: env.NEXT_PUBLIC_APP_NAME,
      chatTitle: env.NEXT_PUBLIC_EMBED_TITLE,
      welcomeMessage: env.NEXT_PUBLIC_EMBED_GREETING,
      primaryColor: env.NEXT_PUBLIC_EMBED_PRIMARY_COLOR,
      chatPosition: env.NEXT_PUBLIC_EMBED_POSITION,
      autoOpen: env.NEXT_PUBLIC_EMBED_AUTO_OPEN === 'true',
      allowedDomains: env.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS ? 
        env.NEXT_PUBLIC_EMBED_ALLOWED_DOMAINS.split(',').map((d: string) => d.trim()) : [],
      requireAuth: env.EMBED_REQUIRE_AUTH === 'true',
      showSuggestions: env.NEXT_PUBLIC_SHOW_SUGGESTIONS !== 'false',
    };

    // Override with URL parameters for live preview
    const liveConfig = { ...baseConfig };
    
    // Apply URL parameter overrides
    if (searchParams.get('title')) {
      liveConfig.chatTitle = searchParams.get('title')!;
    }
    if (searchParams.get('welcomeMessage')) {
      liveConfig.welcomeMessage = searchParams.get('welcomeMessage')!;
    }
    if (searchParams.get('primaryColor')) {
      liveConfig.primaryColor = searchParams.get('primaryColor')!;
    }
    if (searchParams.get('position')) {
      liveConfig.chatPosition = searchParams.get('position')!;
    }
    if (searchParams.get('autoOpen')) {
      liveConfig.autoOpen = searchParams.get('autoOpen') === 'true';
    }
    if (searchParams.get('showSuggestions')) {
      liveConfig.showSuggestions = searchParams.get('showSuggestions') === 'true';
    }

    // Force enable embed for live preview
    liveConfig.embedEnabled = true;

    return NextResponse.json({
      success: true,
      config: liveConfig,
      debug: {
        baseEmbedEnabled: env.NEXT_PUBLIC_EMBED_ENABLED,
        requestUrl: request.url,
        appliedOverrides: Object.fromEntries(searchParams.entries())
      }
    });
  } catch (error) {
    console.error('Error in live config endpoint:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to load live configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 