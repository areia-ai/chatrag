import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const room = searchParams.get('room') || 'default-room';
        const username = searchParams.get('username') || `user-${Math.random().toString(36).substring(7)}`;

        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
            return NextResponse.json(
                { error: 'LiveKit API key or secret is missing on server' },
                { status: 500 }
            );
        }

        const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
            identity: username,
        });

        at.addGrant({ roomJoin: true, room: room });

        const token = await at.toJwt();

        return NextResponse.json({ token, serverUrl: env.LIVEKIT_URL });
    } catch (error: any) {
        console.error('Error generating LiveKit token:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
