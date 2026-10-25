import { NextResponse } from 'next/server';
import { getPolarCheckoutUrl } from '@/lib/polar';

export async function POST(request: Request) {
  try {
    const { priceId } = await request.json();
    
    if (!priceId) {
      return NextResponse.json(
        { error: 'Price ID is required' },
        { status: 400 }
      );
    }

    // Get the base URL for success/cancel redirects
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    
    if (!baseUrl) {
      throw new Error('Site URL is not configured');
    }

    console.log('Creating checkout link with base URL:', baseUrl);

    const checkoutUrl = await getPolarCheckoutUrl(
      priceId,
      `${baseUrl}/auth/callback?source=polar`, // After successful payment
      `${baseUrl}/pricing` // On cancel
    );

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error('Error in create-checkout route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create checkout link' },
      { status: 500 }
    );
  }
} 