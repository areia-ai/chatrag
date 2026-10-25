import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Read the .env.local file directly to get current values
    const envPath = path.join(process.cwd(), '.env.local');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }
    
    // Parse the env file
    const envVars: Record<string, string> = {};
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key) {
          envVars[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    
    // Get the current audio settings
    const settings = {
      ttsDisabled: envVars.NEXT_PUBLIC_TTS_DISABLED === 'true',
      sttDisabled: envVars.NEXT_PUBLIC_STT_DISABLED === 'true', 
      voiceProvider: envVars.NEXT_PUBLIC_VOICE_PROVIDER || 'openai',
      audioAutoplay: envVars.NEXT_PUBLIC_AUDIO_AUTOPLAY === 'true'
    };

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Error fetching audio settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audio settings' },
      { status: 500 }
    );
  }
}