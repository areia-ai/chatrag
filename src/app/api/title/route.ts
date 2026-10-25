import { NextRequest, NextResponse } from 'next/server';
import { generateSmartTitle } from '@/lib/title-generator';
import { DBMessage } from '@/types/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * API route for generating chat titles server-side
 * This runs on the server where API keys are available
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid request: messages array required' },
        { status: 400 }
      );
    }

    // Generate title using AI (server-side where API keys are available)
    const title = await generateSmartTitle(messages as DBMessage[]);

    return NextResponse.json({ title });
  } catch (error) {
    console.error('[Title API] Error generating title:', error);

    return NextResponse.json(
      {
        error: 'Failed to generate title',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
