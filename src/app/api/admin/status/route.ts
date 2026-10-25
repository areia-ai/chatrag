import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// Lazy initialization of admin client
let adminClient: any = null;

function getAdminClient() {
  if (!adminClient) {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration is missing');
    }
    
    adminClient = createClient(supabaseUrl, supabaseServiceKey);
  }
  return adminClient;
}

export async function GET(request: Request) {
  try {
    console.log("Admin status API called");
    
    // Get admin session cookie directly from the cookie store
    const cookieHeader = request.headers.get('cookie') || '';
    console.log("Cookie header from request:", cookieHeader);
    
    // Await cookies() as required in Next.js 14
    const cookieStore = await cookies();
    const adminSessionId = cookieStore.get('admin_session')?.value;
    console.log("Admin session cookie:", adminSessionId ? "Found" : "Not found");
    
    // If there's no admin session cookie, user is not an admin
    if (!adminSessionId) {
      console.log("No admin session cookie found");
      return NextResponse.json({ 
        isAdmin: false,
        message: "No admin session cookie found"
      });
    }
    
    try {
      // Check if user ID from cookie is admin using the is_admin RPC function
      const { data: isAdminData, error: adminCheckError } = await getAdminClient().rpc(
        'is_admin',
        { user_uuid: adminSessionId }
      );
        
      if (adminCheckError) {
        console.error('Error checking admin status:', adminCheckError);
        return NextResponse.json({ 
          isAdmin: false,
          message: "Error verifying admin status",
          error: adminCheckError.message
        });
      }
      
      // If is_admin returned false, the user is not an admin
      if (!isAdminData) {
        console.log("User is not an admin according to is_admin check");
        return NextResponse.json({
          isAdmin: false,
          message: "User ID not found in admin_users table"
        });
      }
      
      // Get admin settings
      const { data: settings, error: settingsError } = await adminClient
        .from('admin_settings')
        .select('*')
        .single();
        
      if (settingsError) {
        console.error('Error fetching admin settings:', settingsError);
        return NextResponse.json({ 
          isAdmin: true,
          settings: { read_only_doc_dashboard: false },
          message: "Admin settings not found, using defaults"
        });
      }
      
      console.log("User is admin via admin_session cookie");
      return NextResponse.json({
        isAdmin: true,
        settings: settings || { read_only_doc_dashboard: false }
      });
    } catch (error) {
      console.error('Error in admin verification:', error);
      return NextResponse.json({
        isAdmin: false,
        message: "Error during admin validation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  } catch (error) {
    console.error('Error checking admin status:', error);
    return NextResponse.json(
      { 
        isAdmin: false,
        error: { 
          message: 'Error checking admin status',
          details: error instanceof Error ? error.message : "Unknown error"
        }
      },
      { status: 500 }
    );
  }
} 