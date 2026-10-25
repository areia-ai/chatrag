'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const source = searchParams.get('source');
    const plan = searchParams.get('plan');
    const checkoutId = searchParams.get('checkout_id');
    const sessionId = searchParams.get('session_id'); // For Stripe

    if (source === 'polar') {
      // After successful Polar payment, redirect to sign up
      router.push(`/auth/signup?plan=${plan}&checkout_id=${checkoutId}&provider=polar`);
    } else if (source === 'stripe') {
      // After successful Stripe payment, redirect to sign up
      router.push(`/auth/signup?session_id=${sessionId}&provider=stripe`);
    } else {
      // Handle other auth callbacks (e.g., GitHub)
      router.push('/');
    }
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Setting up your account...</h1>
        <p className="text-muted-foreground">Please wait while we redirect you.</p>
      </div>
    </div>
  );
} 