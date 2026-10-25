import { DBMessage } from '@/types/chat';
import { ImageAnalysis } from './title-generator-multimodal';

/**
 * Creative content analysis for better title generation
 */
export interface CreativePromptAnalysis {
  style?: string;
  subject?: string;
  mood?: string;
  technique?: string;
  setting?: string;
  action?: string;
  quality?: string[];
  dimensions?: string;
  duration?: number;
  effects?: string[];
}

/**
 * Video generation settings
 */
export interface VideoSettings {
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  style?: string;
}

/**
 * Analyzes a creative prompt to extract key elements
 */
export function analyzeCreativePrompt(prompt: string): CreativePromptAnalysis {
  const analysis: CreativePromptAnalysis = {};

  // Style patterns
  const stylePatterns = {
    photorealistic: /\b(photorealistic|realistic|hyper-?realistic|photo|photograph)\b/i,
    anime: /\b(anime|manga|japanese animation|kawaii)\b/i,
    cartoon: /\b(cartoon|animated|pixar|disney|3d animation)\b/i,
    abstract: /\b(abstract|surreal|psychedelic|experimental)\b/i,
    painterly: /\b(oil painting|watercolor|acrylic|impressionist|painterly)\b/i,
    digital: /\b(digital art|cgi|3d render|octane render|unreal engine)\b/i,
    vintage: /\b(vintage|retro|80s|90s|nostalgic|old school)\b/i,
    minimalist: /\b(minimal|minimalist|simple|clean|modern)\b/i,
    cyberpunk: /\b(cyberpunk|neon|futuristic|sci-fi|dystopian)\b/i,
    fantasy: /\b(fantasy|magical|ethereal|mystical|fairy tale)\b/i,
  };

  for (const [style, pattern] of Object.entries(stylePatterns)) {
    if (pattern.test(prompt)) {
      analysis.style = style;
      break;
    }
  }

  // Subject extraction
  const subjectPatterns = [
    /\b(portrait of|picture of|photo of|image of)\s+([^,.\n]+)/i,
    /\b(a|an|the)\s+(person|man|woman|child|character|creature|animal|landscape|city|building)(\s+\w+)?/i,
  ];

  for (const pattern of subjectPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      analysis.subject = match[2] || match[1];
      break;
    }
  }

  // Mood patterns
  const moodPatterns = {
    dark: /\b(dark|gloomy|ominous|sinister|gothic)\b/i,
    bright: /\b(bright|vibrant|colorful|vivid|cheerful)\b/i,
    moody: /\b(moody|atmospheric|dramatic|intense)\b/i,
    peaceful: /\b(peaceful|calm|serene|tranquil|relaxing)\b/i,
    energetic: /\b(energetic|dynamic|action|explosive|powerful)\b/i,
  };

  for (const [mood, pattern] of Object.entries(moodPatterns)) {
    if (pattern.test(prompt)) {
      analysis.mood = mood;
      break;
    }
  }

  // Quality indicators
  const qualityTerms: string[] = [];
  const qualityPatterns = [
    /\b(4k|8k|uhd|ultra hd|high resolution|hd)\b/i,
    /\b(masterpiece|best quality|high quality|professional)\b/i,
    /\b(detailed|intricate|fine details)\b/i,
    /\b(cinematic|epic|award winning)\b/i,
  ];

  qualityPatterns.forEach(pattern => {
    const match = prompt.match(pattern);
    if (match) {
      qualityTerms.push(match[0].toLowerCase());
    }
  });

  if (qualityTerms.length > 0) {
    analysis.quality = qualityTerms;
  }

  // Video-specific patterns
  const durationMatch = prompt.match(/(\d+)\s*(second|sec|s)\b/i);
  if (durationMatch) {
    analysis.duration = parseInt(durationMatch[1]);
  }

  // Aspect ratio
  const aspectMatch = prompt.match(/\b(16:9|9:16|4:3|1:1|square|vertical|horizontal|portrait|landscape)\b/i);
  if (aspectMatch) {
    analysis.dimensions = aspectMatch[0];
  }

  // Motion/effects for video
  const effectPatterns = [
    /\b(zoom|pan|tilt|rotate|spin)\b/i,
    /\b(fade|dissolve|transition|morph)\b/i,
    /\b(slow motion|timelapse|speed ramping)\b/i,
  ];

  const effects: string[] = [];
  effectPatterns.forEach(pattern => {
    const match = prompt.match(pattern);
    if (match) {
      effects.push(match[0].toLowerCase());
    }
  });

  if (effects.length > 0) {
    analysis.effects = effects;
  }

  return analysis;
}

/**
 * Generates a title for text-to-image generation
 */
export function generateTextToImageTitle(prompt: string): string {
  const analysis = analyzeCreativePrompt(prompt);

  // Build title components
  const components: string[] = [];

  // Add style if present
  if (analysis.style) {
    const styleMap: Record<string, string> = {
      photorealistic: 'Photorealistic',
      anime: 'Anime',
      cartoon: 'Cartoon',
      abstract: 'Abstract',
      painterly: 'Painterly',
      digital: 'Digital Art',
      vintage: 'Vintage',
      minimalist: 'Minimal',
      cyberpunk: 'Cyberpunk',
      fantasy: 'Fantasy'
    };
    components.push(styleMap[analysis.style] || analysis.style);
  }

  // Add subject
  if (analysis.subject) {
    // Capitalize first letter of each word
    const subject = analysis.subject
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    components.push(subject);
  } else {
    // Try to extract key nouns from prompt
    const words = prompt.split(' ')
      .filter(w => w.length > 3 && !/\b(with|from|into|over|under|about|after|before|during)\b/i.test(w))
      .slice(0, 3);
    if (words.length > 0) {
      components.push(words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
    }
  }

  // Add mood or quality as suffix
  if (analysis.mood && components.length < 3) {
    const moodMap: Record<string, string> = {
      dark: 'Dark Theme',
      bright: 'Vibrant',
      moody: 'Atmospheric',
      peaceful: 'Serene',
      energetic: 'Dynamic'
    };
    components.push(`(${moodMap[analysis.mood] || analysis.mood})`);
  } else if (analysis.quality && analysis.quality.length > 0 && components.length < 3) {
    if (analysis.quality.includes('4k') || analysis.quality.includes('8k')) {
      components.push('(High-Res)');
    }
  }

  // Combine and format
  if (components.length === 0) {
    return 'Creative Image Generation';
  }

  return components.join(' ').substring(0, 60);
}

/**
 * Generates a title for image-to-image transformation
 */
export function generateImageToImageTitle(sourceAnalysis: ImageAnalysis | null, prompt: string): string {
  const targetAnalysis = analyzeCreativePrompt(prompt);

  // Determine transformation type
  let transformationType = 'Transform';

  if (prompt.match(/\b(style transfer|stylize|convert to)\b/i)) {
    transformationType = 'Style Transfer';
  } else if (prompt.match(/\b(enhance|upscale|improve|refine)\b/i)) {
    transformationType = 'Enhancement';
  } else if (prompt.match(/\b(edit|modify|change|alter)\b/i)) {
    transformationType = 'Edit';
  } else if (prompt.match(/\b(reimagine|reinterpret|transform)\b/i)) {
    transformationType = 'Reimagine';
  }

  // Build title
  const components: string[] = [transformationType + ':'];

  // Add source description
  if (sourceAnalysis?.description) {
    const shortDesc = sourceAnalysis.description.split(' ').slice(0, 3).join(' ');
    components.push(shortDesc);
  } else {
    components.push('Image');
  }

  // Add transformation target
  if (targetAnalysis.style) {
    components.push('→', capitalizeFirst(targetAnalysis.style));
  } else if (targetAnalysis.subject) {
    components.push('→', capitalizeFirst(targetAnalysis.subject));
  } else {
    // Extract key transformation from prompt
    const keyWords = prompt.match(/\b(into|to|as)\s+(\w+\s*\w*)/i);
    if (keyWords) {
      components.push('→', capitalizeFirst(keyWords[2]));
    }
  }

  return components.join(' ').substring(0, 60);
}

/**
 * Generates a title for text-to-video generation
 */
export function generateTextToVideoTitle(prompt: string, settings?: VideoSettings): string {
  const analysis = analyzeCreativePrompt(prompt);
  const components: string[] = [];

  // Add main subject or action
  if (analysis.subject) {
    components.push(capitalizeFirst(analysis.subject));
  } else {
    // Extract action verbs
    const actionMatch = prompt.match(/\b(flying|walking|running|dancing|moving|transforming|morphing)\b/i);
    if (actionMatch) {
      components.push(capitalizeFirst(actionMatch[0]));
    } else {
      components.push('Video');
    }
  }

  // Add style if present
  if (analysis.style) {
    components.push('in', capitalizeFirst(analysis.style), 'Style');
  } else if (analysis.mood) {
    components.push(`(${capitalizeFirst(analysis.mood)})`);
  }

  // Add duration if specified
  if (analysis.duration || settings?.duration) {
    const duration = analysis.duration || settings?.duration;
    components.push(`(${duration}s)`);
  }

  return components.join(' ').substring(0, 60);
}

/**
 * Generates a title for image-to-video generation
 */
export function generateImageToVideoTitle(sourceAnalysis: ImageAnalysis | null, motionPrompt: string): string {
  const components: string[] = [];

  // Add source description
  if (sourceAnalysis) {
    if (sourceAnalysis.subjects && sourceAnalysis.subjects.length > 0) {
      components.push(capitalizeFirst(sourceAnalysis.subjects[0]));
    } else if (sourceAnalysis.description) {
      const shortDesc = sourceAnalysis.description.split(' ').slice(0, 2).join(' ');
      components.push(capitalizeFirst(shortDesc));
    }
  } else {
    components.push('Image');
  }

  // Add motion type
  components.push('→');

  // Extract motion description
  const motionPatterns = [
    /\b(zoom\s*(?:in|out)?|pan\s*(?:left|right)?|rotate|spin|orbit)\b/i,
    /\b(cinematic|dramatic|smooth|dynamic)\s*(?:motion|movement|animation)?\b/i,
    /\b(animate|bring to life|add motion)\b/i,
  ];

  let motionType = 'Animated';
  for (const pattern of motionPatterns) {
    const match = motionPrompt.match(pattern);
    if (match) {
      motionType = capitalizeFirst(match[0]);
      break;
    }
  }

  components.push(motionType);

  // Add duration if specified
  const durationMatch = motionPrompt.match(/(\d+)\s*(?:second|sec|s)\b/i);
  if (durationMatch) {
    components.push(`(${durationMatch[1]}s)`);
  }

  return components.join(' ').substring(0, 60);
}

/**
 * Generates a title for image-to-3D generation
 */
export function generateImageTo3DTitle(sourceAnalysis: ImageAnalysis | null): string {
  const components: string[] = [];

  // Add subject from image analysis
  if (sourceAnalysis) {
    if (sourceAnalysis.subjects && sourceAnalysis.subjects.length > 0) {
      components.push(capitalizeFirst(sourceAnalysis.subjects[0]));
    } else if (sourceAnalysis.description) {
      const shortDesc = sourceAnalysis.description.split(' ').slice(0, 2).join(' ');
      components.push(capitalizeFirst(shortDesc));
    } else {
      components.push('Object');
    }
  } else {
    components.push('Object');
  }

  // Add "3D Model"
  components.push('3D Model');

  // Add source type if we can determine it
  if (sourceAnalysis?.style) {
    if (sourceAnalysis.style.includes('photo')) {
      components.push('from Photo');
    } else if (sourceAnalysis.style.includes('art') || sourceAnalysis.style.includes('illustration')) {
      components.push('from Artwork');
    } else {
      components.push('from', capitalizeFirst(sourceAnalysis.style));
    }
  }

  return components.join(' ').substring(0, 60);
}

/**
 * Helper function to capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Determines the generation type from message content
 */
export function detectGenerationType(messages: DBMessage[]): string | null {
  if (!messages || messages.length === 0) return null;

  // Check for generation-related content parts in messages
  for (const message of messages) {
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        // Check for different generation types
        if (part.type === 'generated_image' || part.type === 'loading_image') {
          return 'image';
        }
        if (part.type === 'generated_video' || part.type === 'loading_video') {
          return 'video';
        }
        if (part.type === 'generated_3d_model' || part.type === 'loading_3d_model') {
          return '3d';
        }

        // Check if there's an input image (for transformations)
        if (part.type === 'image_url') {
          // Look for subsequent generation parts
          const hasGeneration = message.content.some(p =>
            p.type?.includes('generated_') || p.type?.includes('loading_')
          );
          if (hasGeneration) {
            return 'transformation';
          }
        }
      }
    }
  }

  // Check for generation intent in text
  const userMessage = messages.find(m => m.role === 'user');
  if (userMessage) {
    const text = extractTextContent(userMessage.content).toLowerCase();

    if (text.includes('generate') || text.includes('create') || text.includes('make')) {
      if (text.includes('image') || text.includes('picture') || text.includes('photo')) {
        return 'image';
      }
      if (text.includes('video') || text.includes('animation') || text.includes('motion')) {
        return 'video';
      }
      if (text.includes('3d') || text.includes('model') || text.includes('mesh')) {
        return '3d';
      }
    }
  }

  return null;
}

/**
 * Helper to extract text content from message
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