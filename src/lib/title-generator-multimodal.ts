import { DBMessage } from '@/types/chat';
import { getOpenRouterClient } from '@/lib/openrouter';
import { env } from '@/lib/env';

/**
 * Image analysis result for title generation
 */
export interface ImageAnalysis {
  description: string;
  style?: string;
  subjects?: string[];
  colors?: string[];
  mood?: string;
  technical?: string[];
  artisticStyle?: string;
  composition?: string;
}

/**
 * Analyzes an image using vision models to extract meaningful information for title generation
 * @param imageUrl The URL of the image to analyze
 * @returns Analysis results or null if vision is disabled
 */
export async function analyzeImageForTitle(imageUrl: string): Promise<ImageAnalysis | null> {
  // Check if vision analysis is enabled
  if (env.CHAT_TITLE_ENABLE_VISION !== 'true') {
    return null;
  }

  try {
    const client = getOpenRouterClient();
    if (!client) return null;

    const model = env.CHAT_TITLE_MULTIMODAL_MODEL;
    const maxTokens = parseInt(env.CHAT_TITLE_MULTIMODAL_TOKENS);

    const systemPrompt = `You are an expert at analyzing images to create descriptive titles.
Analyze this image and provide a structured description focusing on:
1. Main subject(s) and objects
2. Visual style (photorealistic, anime, abstract, etc.)
3. Mood and atmosphere
4. Colors and composition
5. Technical aspects (resolution, rendering style)

Return a JSON object with these fields:
{
  "description": "concise overall description",
  "style": "visual style",
  "subjects": ["main", "subjects"],
  "colors": ["dominant", "colors"],
  "mood": "mood/atmosphere",
  "technical": ["technical", "aspects"],
  "artisticStyle": "art movement or style if applicable",
  "composition": "composition type"
}`;

    const completion = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image for title generation:' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ] as any
        }
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0]?.message.content;
    if (response) {
      try {
        return JSON.parse(response) as ImageAnalysis;
      } catch (parseError) {
        console.error('Failed to parse image analysis JSON:', parseError);
        // Fallback to text description
        return {
          description: response,
          subjects: [],
          colors: [],
          technical: []
        };
      }
    }
  } catch (error) {
    console.error('Error analyzing image for title:', error);
  }

  return null;
}

/**
 * Generates a multimodal title combining text and image analysis
 * @param messages The conversation messages
 * @param imageAnalysis Optional pre-analyzed image data
 * @returns A descriptive title
 */
export async function generateMultimodalTitle(
  messages: DBMessage[],
  imageAnalysis?: ImageAnalysis
): Promise<string> {
  try {
    const client = getOpenRouterClient();
    if (!client) return '';

    const model = env.CHAT_TITLE_MULTIMODAL_MODEL;
    const maxTokens = parseInt(env.CHAT_TITLE_MULTIMODAL_TOKENS);

    // Extract text content and images from messages
    const userMessages = messages.filter(m => m.role === 'user');
    const textContent = extractTextContent(userMessages[0]?.content || '');
    const images = extractImages(userMessages[0]?.content || '');

    // If we have images but no analysis yet, analyze the first one
    if (!imageAnalysis && images.length > 0 && env.CHAT_TITLE_ENABLE_VISION === 'true') {
      imageAnalysis = await analyzeImageForTitle(images[0]);
    }

    // Build context for title generation
    let contextDescription = '';
    if (imageAnalysis) {
      contextDescription = `
Image Context:
- Description: ${imageAnalysis.description}
- Style: ${imageAnalysis.style || 'unspecified'}
- Main subjects: ${imageAnalysis.subjects?.join(', ') || 'various'}
- Mood: ${imageAnalysis.mood || 'neutral'}
- Technical: ${imageAnalysis.technical?.join(', ') || 'standard'}
`;
    }

    const systemPrompt = `You are an expert at creating sophisticated titles for multimodal conversations.
${contextDescription}

User Query: ${textContent}

Create a title that:
1. Captures BOTH the visual and textual elements
2. Shows the transformation or relationship between elements
3. Is specific and descriptive
4. Uses format appropriate for the content type

For image-to-video: "[Source] → [Motion/Animation Type]"
For image-to-image: "[Transformation]: [From] to [To]"
For text+image: "[Action] with [Visual Context]"
For image-to-3D: "[Subject] 3D Model from [Source]"

Return ONLY the title, no quotes or explanation.`;

    const completion = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate a descriptive title for this multimodal interaction.' }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    });

    const title = completion.choices[0]?.message.content?.trim();
    if (title) {
      return title.replace(/^["']|["']$/g, '').trim();
    }
  } catch (error) {
    console.error('Error generating multimodal title:', error);
  }

  // Fallback to image analysis description if available
  if (imageAnalysis?.description) {
    return `Visual: ${imageAnalysis.description}`;
  }

  return '';
}

/**
 * Extracts text content from message content
 */
function extractTextContent(content: string | any[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text' && p.text)
      .map(p => p.text)
      .join(' ');
  }
  return '';
}

/**
 * Extracts image URLs from message content
 */
function extractImages(content: string | any[]): string[] {
  const images: string[] = [];

  if (Array.isArray(content)) {
    content.forEach(part => {
      if (part.type === 'image_url' && part.image_url?.url) {
        images.push(part.image_url.url);
      } else if (part.type === 'generated_image' && part.generated_images) {
        images.push(...part.generated_images);
      }
    });
  }

  return images;
}

/**
 * Determines if content has images that would benefit from multimodal analysis
 */
export function hasMultimodalContent(messages: DBMessage[]): boolean {
  return messages.some(msg => {
    if (Array.isArray(msg.content)) {
      return msg.content.some(part =>
        part.type === 'image_url' ||
        part.type === 'generated_image' ||
        part.type === 'generated_video' ||
        part.type === 'generated_3d_model'
      );
    }
    return false;
  });
}