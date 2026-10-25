#!/usr/bin/env npx tsx
/**
 * Quick script to delete/close the chatrag-voice room
 * Run with: npx tsx scripts/close-room.ts
 */

import { RoomServiceClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from voice-agent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../voice-agent/.env') });

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error('Missing LiveKit credentials in voice-agent/.env');
    process.exit(1);
}

const svc = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

async function main() {
    console.log('Listing rooms...');
    const rooms = await svc.listRooms();
    console.log(`Found ${rooms.length} room(s):`, rooms.map(r => r.name));

    // Delete the chatrag-voice room
    const roomName = 'chatrag-voice';
    try {
        console.log(`\nDeleting room: ${roomName}...`);
        await svc.deleteRoom(roomName);
        console.log('✅ Room deleted successfully!');
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            console.log('Room not found (already closed)');
        } else {
            console.error('Error deleting room:', error);
        }
    }

    // List rooms again to confirm
    const remainingRooms = await svc.listRooms();
    console.log(`\nRemaining rooms: ${remainingRooms.length}`);
}

main().catch(console.error);
