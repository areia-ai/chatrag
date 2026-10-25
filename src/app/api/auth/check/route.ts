import { NextResponse } from 'next/server';
// Remove manual cookie import, we'll use the server client
// import { cookies } from 'next/headers'; 
import { createClient } from '@/lib/supabase/server'; // Import the server client utility

export async function GET(req: Request) {
  // Create the server client (handles cookie reading internally)
  const supabase = await createClient();

  try {
    console.log('AuthCheck API: Attempting to get user via server client...');
    
    // Use the server client to get the user
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      console.log('AuthCheck API: No authenticated user found or error occurred:', error?.message);
      return NextResponse.json({
        success: false,
        authenticated: false,
        error: error?.message || 'Authentication required'
      }, { status: 401 }); // Use 401 for unauthorized
    }

    // If user exists, consider authenticated
    console.log('AuthCheck API: Authenticated user found:', user.id);
    return NextResponse.json({ 
      success: true, 
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        // Add other relevant, non-sensitive user fields if needed
        // e.g., last_sign_in_at: user.last_sign_in_at
      }
    });

  } catch (err: any) { // Catch any unexpected errors
    console.error('AuthCheck API: Unexpected error:', err);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error',
      authenticated: false,
      details: err.message // Include error message for debugging
    }, { status: 500 }); // Use 500 for server errors
  }
} 