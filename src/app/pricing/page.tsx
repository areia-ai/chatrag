'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Loader2 } from "lucide-react";
import { useRouter } from 'next/navigation';

interface Plan {
  name: string;
  price: string;
  description: string;
  features: string[];
  polarPriceId: string | null;
}

const plans: Plan[] = [
  {
    name: "Starter",
    price: "9",
    description: "Perfect for trying out the RAG chatbot",
    features: [
      "Basic RAG chatbot functionality",
      "Limited to 10 messages per day",
      "Public documents only",
      "Community support"
    ],
    polarPriceId: null
  },
  {
    name: "Pro",
    price: "19",
    description: "For individuals who need more power",
    features: [
      "Everything in Starter",
      "Unlimited messages",
      "Private document uploads",
      "Priority support",
      "Custom embedding models"
    ],
    polarPriceId: process.env.NEXT_PUBLIC_POLAR_PRICE_ID_PRO || null
  },
  {
    name: "Enterprise",
    price: "49",
    description: "For teams and businesses",
    features: [
      "Everything in Pro",
      "Team collaboration",
      "Advanced analytics",
      "Custom models",
      "24/7 Support",
      "SLA guarantees"
    ],
    polarPriceId: process.env.NEXT_PUBLIC_POLAR_PRICE_ID_ENTERPRISE || null
  }
];

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubscribe = async (priceId: string | null, planName: string) => {
    if (!priceId) {
      router.push('/auth/signup');
      return;
    }

    try {
      setLoading(planName);
      setError(null);

      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ priceId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      if (!data.checkoutUrl) {
        throw new Error('No checkout URL received');
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error('Error creating checkout:', err);
      setError(err instanceof Error ? err.message : 'Failed to create checkout');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-[130rem]">
      {/* Header */}
      <div className="text-center mb-16">
        <span className="inline-block px-4 py-1.5 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 mb-4">
          Pricing
        </span>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Choose the plan that&apos;s right for you
        </p>
        {error && (
          <div className="mt-6 mx-auto max-w-md p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
        {plans.map((plan) => {
          const isPopular = plan.name === "Pro";
          return (
            <Card
              key={plan.name}
              className={`relative p-8 rounded-2xl ${
                isPopular
                  ? "border-2 border-orange-500 dark:border-orange-600 shadow-xl"
                  : "border border-gray-200 dark:border-gray-800"
              }`}
            >
              {isPopular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-orange-500 text-white text-xs font-semibold px-4 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  {plan.name}
                </h3>
                <div className="flex items-baseline mb-2">
                  <span className="text-5xl font-bold text-gray-900 dark:text-gray-100">
                    ${plan.price}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">/month</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <Check className="w-5 h-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSubscribe(plan.polarPriceId, plan.name)}
                disabled={loading !== null}
                className={`w-full h-12 text-base font-semibold ${
                  isPopular
                    ? "bg-orange-500 hover:bg-orange-600 text-white"
                    : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                }`}
                variant={isPopular ? "default" : "outline"}
              >
                {loading === plan.name ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Please wait...
                  </>
                ) : (
                  "Subscribe"
                )}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
