import { NextRequest, NextResponse } from 'next/server';
import { WhatsAppClientFactory } from '@/lib/whatsapp/client-factory';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const providerInfo = WhatsAppClientFactory.getProviderInfo();
  
  return NextResponse.json({
    enabled: WhatsAppClientFactory.isEnabled(),
    currentProvider: WhatsAppClientFactory.getProviderName(),
    providerDetails: providerInfo,
    environment: {
      WHATSAPP_PROVIDER: env.WHATSAPP_PROVIDER,
      NEXT_PUBLIC_WHATSAPP_ENABLED: env.NEXT_PUBLIC_WHATSAPP_ENABLED,
      hasKoyebUrl: !!env.KOYEB_BAILEYS_URL,
      hasFlyioUrl: !!env.FLYIO_BAILEYS_URL,
      hasKoyebKey: !!env.KOYEB_API_KEY,
      hasFlyioKey: !!env.FLYIO_API_KEY,
      hasWebhookSecret: !!env.WHATSAPP_WEBHOOK_SECRET
    }
  });
}