import Stripe from 'stripe';
import { env } from '@/lib/env';

// Lazy initialization of Stripe client
let stripe: Stripe | null = null;

const getStripe = (): Stripe => {
  if (!stripe) {
    // Only validate and initialize at runtime
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not defined');
    }
    stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-01-27.acacia'
    });
  }
  return stripe;
};

export const getStripeCheckoutUrl = async (priceId: string, successUrl: string, cancelUrl: string) => {
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        source: 'easyrag_template'
      }
    });

    return session.url;
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    throw error;
  }
};

export const verifyStripeWebhookSignature = (
  payload: string,
  signature: string,
  webhookSecret: string
): Stripe.Event => {
  try {
    const event = getStripe().webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
    return event;
  } catch (error) {
    console.error('Error verifying Stripe webhook signature:', error);
    throw error;
  }
};

// Helper function to get subscription details
export const getSubscriptionDetails = async (subscriptionId: string): Promise<Stripe.Subscription> => {
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    return subscription;
  } catch (error) {
    console.error('Error retrieving Stripe subscription:', error);
    throw error;
  }
};

// Helper function to get customer details
export const getCustomerDetails = async (customerId: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> => {
  try {
    const customer = await getStripe().customers.retrieve(customerId);
    return customer;
  } catch (error) {
    console.error('Error retrieving Stripe customer:', error);
    throw error;
  }
}; 