import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { verifyStripeWebhookSignature } from '@/lib/stripe';
import { env } from '@/lib/env';

// Initialize Supabase client with service role key for admin access
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature') || '';

    // Verify webhook signature and get the event
    const event = verifyStripeWebhookSignature(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET!
    );

    console.log('Received Stripe webhook event:', event.type);
    
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(event.data.object);
        break;
      
      case 'checkout.session.completed':
        await handleCheckoutEvent(event.data.object);
        break;
      
      default:
        console.log('Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleSubscriptionEvent(subscription: any) {
  const {
    id: stripe_subscription_id,
    status,
    customer: customerId,
    items
  } = subscription;

  // Get customer email from Stripe
  const customer = await supabase
    .from('auth.users')
    .select('id')
    .eq('email', subscription.customer_email)
    .single();

  if (customer.error) {
    console.error('Error finding user:', customer.error);
    return;
  }

  const user_id = customer.data.id;
  
  // Determine plan type based on the subscription price ID
  const priceId = items.data[0]?.price.id;
  let plan_type = 'pro'; // default

  if (priceId === env.NEXT_PUBLIC_STRIPE_PRICE_ID_ENTERPRISE) {
    plan_type = 'enterprise';
  }

  // Upsert subscription record
  const { error: subscriptionError } = await supabase
    .from('subscriptions')
    .upsert({
      user_id,
      stripe_subscription_id,
      plan_type,
      status,
      updated_at: new Date().toISOString()
    });

  if (subscriptionError) {
    console.error('Error updating subscription:', subscriptionError);
  }
}

async function handleCheckoutEvent(session: any) {
  // For Stripe, we handle most logic in the subscription events
  // This is mainly for logging and any additional checkout-specific logic
  console.log('Stripe checkout completed:', {
    customerId: session.customer,
    subscriptionId: session.subscription,
    status: session.status
  });
} 