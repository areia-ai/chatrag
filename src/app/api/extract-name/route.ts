import { NextRequest, NextResponse } from 'next/server';

// Cache for extracted names (in-memory for this session)
const nameCache = new Map<string, { displayName: string; type: 'person' | 'company'; timestamp: number }>();
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Smart local extraction fallback
function smartLocalExtraction(emailPrefix: string): { displayName: string; type: 'person' | 'company' } {
  // Remove trailing numbers
  const cleaned = emailPrefix.replace(/[0-9]+$/, '');
  
  // Check for company indicators
  const companyIndicators = ['corp', 'company', 'inc', 'llc', 'ltd', 'group', 'tech', 'solutions', 'services'];
  const lowerPrefix = cleaned.toLowerCase();
  
  const isCompany = companyIndicators.some(indicator => lowerPrefix.includes(indicator));
  
  if (isCompany) {
    // Format as company name - capitalize each word
    const formatted = cleaned
      .replace(/[._-]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return { displayName: formatted, type: 'company' };
  }
  
  // Handle as person name
  const segments = cleaned.split(/[._-]/);
  const firstName = segments[0] || cleaned;
  
  // Simple heuristic: if it's very long (>10 chars) and no separators, try to extract first 5-6 chars
  if (firstName.length > 10 && segments.length === 1) {
    // Look for common name lengths (4-7 characters)
    const possibleName = firstName.substring(0, 6);
    return { 
      displayName: possibleName.charAt(0).toUpperCase() + possibleName.slice(1).toLowerCase(),
      type: 'person'
    };
  }
  
  return { 
    displayName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
    type: 'person'
  };
}

export async function POST(request: NextRequest) {
  try {
    const { emailPrefix } = await request.json();
    
    if (!emailPrefix) {
      return NextResponse.json(
        { error: 'Email prefix is required' },
        { status: 400 }
      );
    }
    
    // Check in-memory cache first
    const cached = nameCache.get(emailPrefix);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`[Name Extraction] Using cached result for: ${emailPrefix}`);
      return NextResponse.json(cached);
    }
    
    // Check if AI extraction is enabled
    const aiEnabled = process.env.NEXT_PUBLIC_NAME_EXTRACTION_ENABLED !== 'false';
    const model = process.env.NEXT_PUBLIC_NAME_EXTRACTION_MODEL || 'gpt-4o-mini';
    
    if (!aiEnabled) {
      console.log(`[Name Extraction] AI disabled, using local extraction for: ${emailPrefix}`);
      const result = smartLocalExtraction(emailPrefix);
      return NextResponse.json(result);
    }
    
    // Try AI extraction with OpenAI
    const openAIKey = process.env.OPENAI_API_KEY;
    
    if (openAIKey) {
      try {
        const prompt = `Analyze this email username and determine if it's a person or company, then extract the appropriate display name.

Username: ${emailPrefix}

Rules:
- If it's a person's name, extract ONLY the first name
- If it's a company/organization, return the properly formatted company name
- Make intelligent guesses based on patterns

Examples:
- "mariagarcia88" → "Maria" (person)
- "johndoe123" → "John" (person)
- "acmecorp" → "Acme Corp" (company)
- "techstartupinc" → "Tech Startup Inc" (company)
- "amazonwebservices" → "Amazon Web Services" (company)

Respond with ONLY the display name, nothing else.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAIKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: 'system',
                content: 'You are a name extraction expert. Extract names from email usernames intelligently.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 20
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const extractedName = data.choices[0]?.message?.content?.trim();
          
          if (extractedName) {
            // Determine type based on the extraction
            const type = extractedName.includes(' ') || 
                         extractedName.toLowerCase().includes('corp') ||
                         extractedName.toLowerCase().includes('inc') ||
                         extractedName.toLowerCase().includes('company') 
                         ? 'company' : 'person';
            
            const result = { displayName: extractedName, type, timestamp: Date.now() };
            
            // Cache the result
            nameCache.set(emailPrefix, result);
            
            console.log(`[Name Extraction] AI extracted "${extractedName}" (${type}) from: ${emailPrefix}`);
            return NextResponse.json(result);
          }
        }
      } catch (error) {
        console.error('[Name Extraction] AI extraction failed:', error);
      }
    }
    
    // Fallback to local extraction
    console.log(`[Name Extraction] Using local extraction for: ${emailPrefix}`);
    const result = smartLocalExtraction(emailPrefix);
    
    // Cache even the local result
    nameCache.set(emailPrefix, { ...result, timestamp: Date.now() });
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('[Name Extraction] Error:', error);
    return NextResponse.json(
      { error: 'Failed to extract name' },
      { status: 500 }
    );
  }
}