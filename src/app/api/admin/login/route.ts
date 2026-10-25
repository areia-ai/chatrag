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

export async function POST(request: Request) {
  try {
    console.log("Admin verification API called");
    
    // Get the email and userId from the request body (no password needed)
    const { email, userId } = await request.json();
    
    if (!email || !userId) {
      console.log("Email and userId are required");
      return NextResponse.json(
        { error: { message: 'Email and userId are required' } },
        { status: 400 }
      );
    }
    
    console.log("Admin verification attempt for user:", email, "with ID:", userId);
    
    // Simply check if the user is in the admin_users table
    const { data: isAdminData, error: isAdminError } = await getAdminClient().rpc(
      'is_admin',
      { user_uuid: userId }
    );
    
    if (isAdminError) {
      console.error('Admin verification error:', isAdminError);
      return NextResponse.json(
        { error: { message: 'Error checking admin status' } },
        { status: 500 }
      );
    }
    
    // If user is not in admin_users table, deny access
    if (!isAdminData) {
      console.log("User is not an admin:", userId);
      return NextResponse.json(
        { error: { message: 'Not authorized as admin' } },
        { status: 403 }
      );
    }
    
    // Set a session cookie to maintain admin session
    const response = NextResponse.json({ success: true, userId: userId });
    
    // Set the cookie directly on the response
    response.cookies.set({
      name: 'admin_session',
      value: userId,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24, // 1 day
      path: '/',
    });
    
    console.log("Admin login successful for user ID:", userId);
    return response;
  } catch (error) {
    console.error('Admin login error:', error);
    return NextResponse.json(
      { error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// Also handle logout
export async function DELETE() {
  // Await cookies() in Next.js 14
  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true });
  
  // Delete the cookie directly on the response
  response.cookies.delete('admin_session');
  
  return response;
} 