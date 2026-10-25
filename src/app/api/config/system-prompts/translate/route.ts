import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { templateKey, targetLanguage, provider = 'openai', preContext, postContext } = await request.json();
    
    if (!templateKey || !targetLanguage || !preContext) {
      return NextResponse.json(
        { error: 'Missing required fields: templateKey, targetLanguage, and preContext are required' },
        { status: 400 }
      );
    }

    // Validate provider
    if (!['openai', 'openrouter'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Use "openai" or "openrouter"' },
        { status: 400 }
      );
    }

    // Get API key based on provider
    const apiKey = provider === 'openai' 
      ? process.env.OPENAI_API_KEY 
      : process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: `API key not configured for ${provider}` },
        { status: 500 }
      );
    }

    // Prepare the translation prompt
    const systemPrompt = `You are a professional translator. Translate the following system prompt template to ${targetLanguage}. 
IMPORTANT RULES:
1. Preserve the exact placeholder {{context}} as-is (do not translate it)
2. Maintain the same tone and style
3. Keep the same formatting and structure
4. Ensure the translation is natural and fluent in ${targetLanguage}
5. Return ONLY the translated text, no explanations or meta-text`;

    const userPrompt = `Translate this system prompt to ${targetLanguage}:

PRE-CONTEXT:
${preContext}

${postContext ? `POST-CONTEXT:\n${postContext}` : ''}`;

    let translatedPreContext = '';
    let translatedPostContext = '';

    if (provider === 'openai') {
      // Use OpenAI API directly
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OpenAI API error:', error);
        return NextResponse.json(
          { error: 'Failed to translate with OpenAI' },
          { status: 500 }
        );
      }

      const data = await response.json();
      const translatedText = data.choices[0]?.message?.content || '';
      
      // Split the translated text back into pre and post context
      if (postContext) {
        const parts = translatedText.split(/POST-CONTEXT:|POST CONTEXT:/i);
        translatedPreContext = parts[0].replace(/PRE-CONTEXT:|PRE CONTEXT:/i, '').trim();
        translatedPostContext = parts[1]?.trim() || '';
      } else {
        translatedPreContext = translatedText.replace(/PRE-CONTEXT:|PRE CONTEXT:/i, '').trim();
      }
      
    } else {
      // Use OpenRouter API
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'ChatRAG System Prompt Translation'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OpenRouter API error:', error);
        return NextResponse.json(
          { error: 'Failed to translate with OpenRouter' },
          { status: 500 }
        );
      }

      const data = await response.json();
      const translatedText = data.choices[0]?.message?.content || '';
      
      // Split the translated text back into pre and post context
      if (postContext) {
        const parts = translatedText.split(/POST-CONTEXT:|POST CONTEXT:/i);
        translatedPreContext = parts[0].replace(/PRE-CONTEXT:|PRE CONTEXT:/i, '').trim();
        translatedPostContext = parts[1]?.trim() || '';
      } else {
        translatedPreContext = translatedText.replace(/PRE-CONTEXT:|PRE CONTEXT:/i, '').trim();
      }
    }

    // Ensure {{context}} placeholder is preserved
    const hasContextInOriginal = preContext.includes('{{context}}') || postContext?.includes('{{context}}');
    const hasContextInTranslation = translatedPreContext.includes('{{context}}') || translatedPostContext.includes('{{context}}');
    
    if (hasContextInOriginal && !hasContextInTranslation) {
      // If context was lost in translation, add it back
      if (preContext.includes('{{context}}') && !translatedPreContext.includes('{{context}}')) {
        translatedPreContext += '\n\nContext:\n{{context}}';
      }
    }

    // Return the translated template
    return NextResponse.json({
      success: true,
      templateKey,
      targetLanguage,
      provider,
      translated: {
        preContext: translatedPreContext,
        postContext: translatedPostContext
      },
      metadata: {
        hasContext: translatedPreContext.includes('{{context}}') || translatedPostContext.includes('{{context}}'),
        translatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[System Prompt Translation API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to translate system prompt', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}