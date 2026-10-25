import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server'; // Import server client utility

export async function GET(request: Request) {
  // const cookieStore = cookies(); // No need to get it here
  // createClient gets the cookie store internally
  const supabase = await createClient(); 
  
  try {
    console.log("Getting user profile from server");

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      console.log("No authenticated user found:", error?.message);
      return NextResponse.json(
        {
          authenticated: false,
          success: false,
          error: "Authentication required"
        },
        { status: 401 }
      );
    }

    // User is authenticated, return profile data
    console.log("Authenticated user found:", user.id);
    return NextResponse.json({
      authenticated: true,
      success: true,
      user: {
        id: user.id,
        email: user.email,
        // Optional: Fetch additional profile details from your own tables if needed
        // name: user.user_metadata?.name, 
        // avatar_url: user.user_metadata?.avatar_url
      }
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    return NextResponse.json(
      {
        authenticated: false,
        success: false,
        error: "Internal server error fetching user profile"
      },
      { status: 500 }
    );
  }
} 