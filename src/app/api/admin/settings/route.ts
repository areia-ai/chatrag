import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient as createAdminClient } from '@supabase/supabase-js'; // Alias for clarity
import { env } from '@/lib/env';
// No need for server client utils here, as we only use admin client

// Lazy initialization of admin client
let adminClient: any = null;

function getAdminClient() {
  if (!adminClient) {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration is missing');
    }
    
    adminClient = createAdminClient(supabaseUrl, supabaseServiceKey);
  }
  return adminClient;
}

// Helper function to verify admin session
async function verifyAdminSession(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<string | null> {
  const adminSessionCookie = cookieStore.get('admin_session');
  if (!adminSessionCookie || !adminSessionCookie.value) {
    console.log("[Admin Settings API] No admin_session cookie.");
    return null;
  }
  
  const userId = adminSessionCookie.value;
  
  // Verify the user ID is actually an admin
  try {
    const { data: isAdminData, error } = await getAdminClient().rpc('is_admin', { user_uuid: userId });
    if (error) {
      console.error('[Admin Settings API] Error verifying admin via RPC:', error);
      return null;
    }
    if (!isAdminData) {
      console.log("[Admin Settings API] User ID from cookie is not admin.");
      return null;
    }
    console.log("[Admin Settings API] Admin session verified for user ID:", userId);
    return userId; // Return verified admin user ID
  } catch (error) {
    console.error('[Admin Settings API] Catch block error verifying admin:', error);
    return null;
  }
}

// GET admin settings
export async function GET(request: Request) {
  const cookieStore = await cookies();
  console.log("[Admin Settings API - GET] Called");

  const adminUserId = await verifyAdminSession(cookieStore);
  if (!adminUserId) {
    return NextResponse.json(
      { error: { message: 'Admin authentication required' } },
      { status: 401 } // Use 401 for missing/invalid admin session
    );
  }

  try {
    // Get admin settings using the admin client (already verified admin access)
    const { data, error } = await adminClient
      .from('admin_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(); // Use maybeSingle to handle no settings found gracefully

    if (error) {
      console.error("[Admin Settings API - GET] Error fetching settings:", error);
      throw error; // Let the generic error handler catch it
    }
    
    console.log("[Admin Settings API - GET] Settings fetched:", data);
    return NextResponse.json(data || { read_only_doc_dashboard: false }); // Return default if no settings found

  } catch (error) {
    console.error("[Admin Settings API - GET] Generic error:", error);
    return NextResponse.json(
      { error: { message: 'Internal server error fetching settings' } },
      { status: 500 }
    );
  }
}

// POST (Update) admin settings
export async function POST(request: Request) {
  const cookieStore = await cookies();
  console.log("[Admin Settings API - POST] Called");

  const adminUserId = await verifyAdminSession(cookieStore);
  if (!adminUserId) {
    return NextResponse.json(
      { error: { message: 'Admin authentication required' } },
      { status: 401 }
    );
  }

  try {
    const settings = await request.json();
    console.log("[Admin Settings API - POST] Received settings:", settings);

    // Validate received settings data (add more checks if needed)
    if (typeof settings.read_only_doc_dashboard !== 'boolean') {
       return NextResponse.json(
         { error: { message: 'Invalid setting value for read_only_doc_dashboard' } },
         { status: 400 }
       );
    }

    // Check if settings already exist
    const { data: existingSettings, error: fetchError } = await adminClient
      .from('admin_settings')
      .select('id')
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') { // Ignore 'not found' error
      console.error("[Admin Settings API - POST] Error fetching existing settings:", fetchError);
      throw fetchError;
    }

    let result;
    const settingsPayload = {
        read_only_doc_dashboard: settings.read_only_doc_dashboard,
        updated_by: adminUserId, // Use the verified admin user ID
        updated_at: new Date().toISOString(),
    };

    if (existingSettings?.id) {
      // Update existing settings
      console.log("[Admin Settings API - POST] Updating existing settings ID:", existingSettings.id);
      const { data, error } = await adminClient
        .from('admin_settings')
        .update(settingsPayload)
        .eq('id', existingSettings.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      // Insert new settings record
      console.log("[Admin Settings API - POST] Inserting new settings");
      const { data, error } = await adminClient
        .from('admin_settings')
        .insert({
            ...settingsPayload,
            created_by: adminUserId // Set creator on insert
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    console.log("[Admin Settings API - POST] Settings update successful:", result);
    return NextResponse.json({ success: true, settings: result });

  } catch (error) {
    console.error("[Admin Settings API - POST] Generic error:", error);
    return NextResponse.json(
      { error: { message: 'Internal server error updating settings' } },
      { status: 500 }
    );
  }
} 