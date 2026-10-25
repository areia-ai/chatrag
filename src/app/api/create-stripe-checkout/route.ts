import { NextResponse } from 'next/server';
import { getStripeCheckoutUrl } from '@/lib/stripe';

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

    console.log('Creating Stripe checkout session with base URL:', baseUrl);

    const checkoutUrl = await getStripeCheckoutUrl(
      priceId,
      `${baseUrl}/auth/callback?source=stripe`, // After successful payment
      `${baseUrl}/pricing-stripe` // On cancel
    );

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error('Error in create-stripe-checkout route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create checkout session' },
      { status: 500 }
    );
  }
} 