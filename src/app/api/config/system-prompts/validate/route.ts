import { NextRequest, NextResponse } from 'next/server';
import { SystemPromptManager } from '@/lib/system-prompt-manager';
import { translations, Language } from '@/translations';

export async function POST(request: NextRequest) {
  try {
    const { prompt, checkAllLanguages } = await request.json();
    
    if (!prompt && !checkAllLanguages) {
      return NextResponse.json(
        { error: 'Please provide a prompt to validate or set checkAllLanguages to true' },
        { status: 400 }
      );
    }
    
    // Validate a single prompt
    if (prompt) {
      const isValid = SystemPromptManager.validatePrompt(prompt);
      return NextResponse.json({
        valid: isValid,
        hasContextPlaceholder: isValid,
        prompt: prompt.substring(0, 200) + '...'
      });
    }
    
    // Check all language translations for {{context}} placeholder
    if (checkAllLanguages) {
      const validationResults: Record<string, any> = {};
      const languages = Object.keys(translations) as Language[];
      
      for (const lang of languages) {
        const langTranslation = translations[lang];
        const templates = langTranslation.systemPrompts || {};
        const templateResults: Record<string, boolean> = {};
        
        for (const [templateKey, template] of Object.entries(templates)) {
          if (template && typeof template === 'object' && 'preContext' in template && 'postContext' in template) {
            const assembledPrompt = SystemPromptManager.assemblePrompt(
              template.preContext,
              template.postContext
            );
            templateResults[templateKey] = SystemPromptManager.validatePrompt(assembledPrompt);
          }
        }
        
        validationResults[lang] = {
          hasSystemPrompts: !!langTranslation.systemPrompts,
          templateCount: Object.keys(templates).length,
          templates: templateResults,
          allValid: Object.values(templateResults).every(v => v === true)
        };
      }
      
      const allValid = Object.values(validationResults).every(
        result => result.allValid
      );
      
      return NextResponse.json({
        allValid,
        languages: validationResults,
        summary: {
          totalLanguages: languages.length,
          languagesWithPrompts: Object.values(validationResults).filter(r => r.hasSystemPrompts).length,
          totalTemplates: Object.values(validationResults).reduce((acc, r) => acc + r.templateCount, 0)
        }
      });
    }
    
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('[System Prompts Validation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate system prompts' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Quick validation check for all languages
  try {
    const languages = Object.keys(translations) as Language[];
    const issues: string[] = [];
    
    for (const lang of languages) {
      const langTranslation = translations[lang];
      if (!langTranslation.systemPrompts) {
        issues.push(`${lang}: Missing systemPrompts object`);
        continue;
      }
      
      const templates = langTranslation.systemPrompts;
      for (const [templateKey, template] of Object.entries(templates)) {
        if (template && typeof template === 'object' && 'preContext' in template) {
          const assembledPrompt = SystemPromptManager.assemblePrompt(
            template.preContext,
            template.postContext || ''
          );
          if (!SystemPromptManager.validatePrompt(assembledPrompt)) {
            issues.push(`${lang}/${templateKey}: Missing {{context}} placeholder`);
          }
        }
      }
    }
    
    return NextResponse.json({
      valid: issues.length === 0,
      issues,
      checkedLanguages: languages.length,
      contextPlaceholder: '{{context}}'
    });
  } catch (error) {
    console.error('[System Prompts Validation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate system prompts' },
      { status: 500 }
    );
  }
}