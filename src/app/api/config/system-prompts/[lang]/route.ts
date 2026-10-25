import { NextRequest, NextResponse } from 'next/server';
import { SystemPromptManager } from '@/lib/system-prompt-manager';
import { Language } from '@/translations';

export async function GET(
  request: NextRequest,
  { params }: { params: { lang: string } }
) {
  try {
    const lang = params.lang as Language;
    
    // Validate language code
    const validLanguages: Language[] = ['en', 'es', 'pt', 'fr', 'de', 'ru', 'lt', 'zh', 'ja', 'ko', 'hi', 'ar'];
    if (!validLanguages.includes(lang)) {
      return NextResponse.json(
        { error: 'Invalid language code' },
        { status: 400 }
      );
    }
    
    // Get all templates for the specified language
    const templates = SystemPromptManager.getAllTemplates(lang);
    
    // Add metadata
    const response = {
      language: lang,
      templates: templates,
      availableTemplates: SystemPromptManager.getAvailableTemplates(),
      metadata: {
        totalTemplates: Object.keys(templates).length,
        hasContextPlaceholder: true,
        contextPlaceholder: '{{context}}'
      }
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('[System Prompts API] Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system prompt templates' },
      { status: 500 }
    );
  }
}