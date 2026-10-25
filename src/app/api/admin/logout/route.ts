import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    console.log("Admin logout API called");
    
    // Await the cookies() promise
    const cookieStore = await cookies();
    
    // Check if the cookie exists before attempting deletion
    if (cookieStore.has('admin_session')) {
      console.log("Clearing admin_session cookie...");
      
      // Delete the admin_session cookie (this uses simple deletion)
      cookieStore.delete('admin_session');
      
      // Also set with expired date for more thorough clearing
      cookieStore.set({
        name: 'admin_session',
        value: '',
        path: '/',
        expires: new Date(0), // Set to epoch time (expired)
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
      });
      
      console.log("Admin session cookie has been cleared");
    } else {
      console.log("No admin_session cookie found to clear.");
    }
    
    // Return a specific response that also clears the cookie from the browser
    const response = NextResponse.json({ 
      success: true, 
      message: 'Admin logged out successfully' 
    });
    
    // Also try to clear the cookie in the response as a backup
    response.cookies.delete('admin_session');
    response.cookies.set({
      name: 'admin_session',
      value: '',
      path: '/',
      expires: new Date(0),
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax'
    });
    
    return response;

  } catch (error) {
    console.error('Admin logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error during admin logout' },
      { status: 500 }
    );
  }
} 