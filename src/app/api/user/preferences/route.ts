import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireMultiTenant } from '@/lib/deployment-mode';
import { logger } from '@/lib/logger';

/**
 * GET /api/user/preferences
 * Get current user's preferences
 */
export async function GET(request: Request) {
  try {
    requireMultiTenant();

    const { createClient: createSSRClient } = await import('@/lib/supabase/server');
    const supabase = await createSSRClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user preferences from user_metadata
    const { data: user, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { error: 'Failed to fetch user preferences' },
        { status: 500 }
      );
    }

    const preferences = user.user.user_metadata?.preferences || {};

    return NextResponse.json(preferences);
  } catch (error: any) {
    logger.error('API', `Error in GET /api/user/preferences: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch preferences' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user/preferences
 * Update current user's preferences
 */
export async function PATCH(request: Request) {
  try {
    requireMultiTenant();

    const { createClient: createSSRClient } = await import('@/lib/supabase/server');
    const supabase = await createSSRClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Get current user metadata
    const { data: user } = await supabase.auth.getUser();
    const currentPreferences = user?.user.user_metadata?.preferences || {};

    // Merge new preferences
    const updatedPreferences = {
      ...currentPreferences,
      ...body,
    };

    // Update user metadata
    const { data: updatedUser, error: updateError } = await supabase.auth.updateUser({
      data: {
        ...user?.user.user_metadata,
        preferences: updatedPreferences,
      },
    });

    if (updateError) {
      logger.error('API', `Error updating preferences: ${updateError.message}`);
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      );
    }

    logger.info('API', `Updated preferences for user ${session.user.id}`);

    return NextResponse.json(updatedPreferences);
  } catch (error: any) {
    logger.error('API', `Error in PATCH /api/user/preferences: ${error.message}`);

    if (error.message.includes('multi-tenant mode')) {
      return NextResponse.json(
        { error: 'This feature requires multi-tenant mode' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    );
  }
}
