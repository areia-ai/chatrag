const POLAR_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://polar.sh'
  : 'https://sandbox.polar.sh';

interface PolarCheckoutLinkResponse {
  id: string;
  url: string;
}

export const getPolarCheckoutUrl = async (priceId: string, successUrl: string, cancelUrl: string) => {
  // Get the appropriate checkout link based on the price ID
  let checkoutLink = '';
  
  if (priceId === process.env.NEXT_PUBLIC_POLAR_PRICE_ID_PRO) {
    checkoutLink = process.env.NEXT_PUBLIC_POLAR_CHECKOUT_PRO || '';
  } else if (priceId === process.env.NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE) {
    checkoutLink = process.env.NEXT_PUBLIC_POLAR_CHECKOUT_ENTERPRISE || '';
  }

  if (!checkoutLink) {
    throw new Error('Checkout link not found for the given price ID');
  }

  try {
    // Add success and cancel URLs as query parameters to the checkout link
    const urlWithParams = new URL(checkoutLink);
    urlWithParams.searchParams.append('success_url', successUrl);
    urlWithParams.searchParams.append('cancel_url', cancelUrl);
    urlWithParams.searchParams.append('source', 'easyrag_template');

    return urlWithParams.toString();
  } catch (error) {
    console.error('Error creating checkout link:', error);
    throw error;
  }
};

export const verifyPolarWebhookSignature = (
  payload: string,
  signature: string,
  webhookSecret: string
) => {
  if (process.env.NODE_ENV !== 'production') {
    return true; // Trust all webhooks in development
  }

  try {
    // Polar uses a similar webhook signature verification as Stripe
    const [timestamp, v1] = signature.split(',');
    if (!timestamp || !v1) {
      throw new Error('Invalid signature format');
    }

    // TODO: Implement HMAC verification when Polar provides the documentation
    // For now, we'll trust the signature in all environments
    return true;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}; 