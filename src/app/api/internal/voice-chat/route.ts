import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateTitle, generateSmartTitle } from '@/lib/title-generator';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'nodejs';

/**
 * Internal API Endpoint for Voice Agent to Save Chats
 * 
 * Called by the voice agent when a voice session ends.
 * Creates a new chat entry with the voice conversation.
 */
export async function POST(req: NextRequest) {
    try {
        // Security Check
        const apiKey = req.headers.get('x-api-key');
        
        if (!env.CHATRAG_INTERNAL_API_KEY) {
            console.error('[Voice Chat API] CHATRAG_INTERNAL_API_KEY not configured');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
        
        if (apiKey !== env.CHATRAG_INTERNAL_API_KEY) {
            console.warn('[Voice Chat API] Unauthorized access attempt');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        // Parse Body
        const body = await req.json();
        const { userId, messages, organizationId } = body;
        
        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }
        
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'Missing or invalid messages' }, { status: 400 });
        }
        
        // Require at least one exchange (user + assistant message)
        const hasUserMessage = messages.some((m: any) => m.role === 'user');
        const hasAssistantMessage = messages.some((m: any) => m.role === 'assistant');
        
        if (!hasUserMessage || !hasAssistantMessage) {
            return NextResponse.json({ 
                error: 'Conversation must have at least one user and one assistant message' 
            }, { status: 400 });
        }
        
        const adminClient = getSupabaseAdmin();
        if (!adminClient) {
            throw new Error('Supabase Admin client unavailable');
        }
        
        // Generate title from messages
        const title = generateTitle(messages);
        console.log(`[Voice Chat API] Generated title: "${title}"`);
        
        // Create chat entry
        const chatId = uuidv4();
        const now = new Date().toISOString();
        
        const { data, error } = await adminClient
            .from('chats')
            .insert({
                id: chatId,
                user_id: userId,
                title,
                messages,
                organization_id: organizationId || null,
                created_at: now,
                updated_at: now
            })
            .select()
            .single();
        
        if (error) {
            console.error('[Voice Chat API] Error creating chat:', error);
            throw error;
        }
        
        console.log(`[Voice Chat API] Created voice chat: ${data.id} with title "${data.title}"`);
        
        // Async smart title generation (fire and forget)
        generateSmartTitle(messages).then(async (smartTitle) => {
            if (smartTitle && smartTitle !== title && smartTitle !== 'New Chat') {
                console.log(`[Voice Chat API] Updating to smart title: "${smartTitle}"`);
                await adminClient
                    .from('chats')
                    .update({ title: smartTitle })
                    .eq('id', chatId);
            }
        }).catch((err) => {
            console.error('[Voice Chat API] Error generating smart title:', err);
        });
        
        return NextResponse.json({ 
            chatId: data.id,
            title: data.title,
            success: true 
        });
        
    } catch (error: any) {
        console.error('[Voice Chat API] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
