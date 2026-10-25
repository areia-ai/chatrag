import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getNango, isNangoEnabled } from '@/lib/nango/client';
import { type SupportedProvider, PROVIDER_CONFIG } from '@/lib/nango/types';

export const runtime = 'nodejs';

/**
 * POST /api/nango/session
 * Creates a Nango Connect Session for frontend OAuth flow
 */
export async function POST(request: NextRequest) {
  if (!isNangoEnabled()) {
    return NextResponse.json(
      { error: 'Nango integration not enabled' },
      { status: 503 }
    );
  }

  try {
    // Check if request comes from config-ui (has admin auth header)
    const authHeader = request.headers.get('authorization');
    const isConfigUI = authHeader?.startsWith('Bearer ');

    let userId: string;
    let userEmail: string | undefined;
    let userDisplayName: string;

    if (isConfigUI) {
      // Config-UI admin access - get first valid user for representative view
      const supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      const user = users?.users?.[0];

      if (!user) {
        return NextResponse.json(
          { error: 'No users found - create a user first' },
          { status: 404 }
        );
      }

      userId = user.id;
      userEmail = user.email;
      userDisplayName = user.user_metadata?.full_name || user.email || 'Config Admin';
    } else {
      // Normal user authentication via Next.js session
      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      userId = user.id;
      userEmail = user.email;
      userDisplayName = user.user_metadata?.full_name || user.email || 'User';
    }

    const { provider } = await request.json() as { provider: SupportedProvider };

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    const nango = getNango();
    const integrationId = PROVIDER_CONFIG[provider]?.integrationId || provider;

    // Create a connect session for the frontend
    // This returns a token the frontend SDK uses to initiate OAuth
    const session = await nango.createConnectSession({
      end_user: {
        id: userId,
        email: userEmail,
        display_name: userDisplayName,
      },
      allowed_integrations: [integrationId],
    });

    return NextResponse.json({
      connectSessionToken: session.data.token,
      provider,
    });

  } catch (error) {
    console.error('[Nango] Error creating connect session:', error);

    // Provide more detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isConfigError = errorMessage.includes('not initialized') ||
      errorMessage.includes('NANGO_SECRET_KEY') ||
      errorMessage.includes('401') ||
      errorMessage.includes('Unauthorized');

    return NextResponse.json(
      {
        error: isConfigError
          ? 'Nango configuration error - check NANGO_SECRET_KEY'
          : 'Failed to create connect session',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
