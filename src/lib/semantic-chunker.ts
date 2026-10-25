/**
 * Smart Contextual Chunking with Semantic Boundaries
 * 
 * This module provides intelligent document chunking that:
 * - Preserves semantic boundaries (sentences, paragraphs, sections)
 * - Maintains document structure and hierarchy
 * - Adapts chunk sizes based on content density
 * - Preserves context across chunk boundaries
 */

export interface ChunkingConfig {
  targetTokens?: number; // Target tokens per chunk (default: 500)
  maxOutputTokens?: number; // Maximum tokens per chunk (default: 800)
  minTokens?: number; // Minimum tokens per chunk (default: 200)
  overlapTokens?: number; // Overlap between chunks (default: 100)
  preserveStructure?: boolean; // Maintain document hierarchy (default: true)
  adaptiveSize?: boolean; // Adjust size based on content density (default: true)
  sentenceBoundaries?: boolean; // Respect sentence boundaries (default: true)
  paragraphBoundaries?: boolean; // Prefer paragraph boundaries (default: true)
  sectionBoundaries?: boolean; // Preserve section boundaries (default: true)
}

export interface DocumentSection {
  level: number; // Heading level (1-6)
  title: string;
  content: string;
  subsections: DocumentSection[];
}

export interface SemanticChunk {
  content: string;
  metadata: {
    section?: string;
    subsection?: string;
    position: number;
    tokens: number;
    type: 'header' | 'paragraph' | 'list' | 'table' | 'code' | 'mixed';
    density: number; // Information density score (0-1)
    boundaries: {
      start: 'sentence' | 'paragraph' | 'section';
      end: 'sentence' | 'paragraph' | 'section';
    };
  };
}

/**
 * Estimate token count for text (approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Calculate information density based on various factors
 */
function calculateDensity(text: string): number {
  // Factors that increase density:
  // - Numbers and data
  // - Technical terms
  // - Proper nouns (capitalized words)
  // - Complex punctuation
  
  const wordCount = text.split(/\s+/).length;
  if (wordCount === 0) return 0;
  
  const numbers = (text.match(/\d+/g) || []).length;
  const capitals = (text.match(/[A-Z][a-z]+/g) || []).length;
  const technicalPunct = (text.match(/[(){}[\]<>:;,.-]/g) || []).length;
  const sentences = text.split(/[.!?]+/).length - 1;
  
  // Calculate density score
  const numberDensity = Math.min(numbers / wordCount, 0.3) / 0.3;
  const capitalDensity = Math.min(capitals / wordCount, 0.2) / 0.2;
  const punctDensity = Math.min(technicalPunct / wordCount, 0.5) / 0.5;
  const avgWordsPerSentence = sentences > 0 ? wordCount / sentences : wordCount;
  const complexityScore = Math.min(avgWordsPerSentence / 25, 1); // 25+ words per sentence = complex
  
  // Weighted average
  return (numberDensity * 0.3 + capitalDensity * 0.2 + punctDensity * 0.2 + complexityScore * 0.3);
}

/**
 * Detect content type
 */
function detectContentType(text: string): SemanticChunk['metadata']['type'] {
  // Check for code blocks
  if (text.includes('```') || text.includes('    ') || /^\s{4,}/m.test(text)) {
    return 'code';
  }
  
  // Check for tables (simple heuristic)
  if (text.includes('|') && text.split('\n').some(line => (line.match(/\|/g) || []).length > 2)) {
    return 'table';
  }
  
  // Check for lists
  if (/^[\s]*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)) {
    return 'list';
  }
  
  // Check for headers
  if (/^#{1,6}\s/.test(text.trim())) {
    return 'header';
  }
  
  // Default to paragraph
  return 'paragraph';
}

/**
 * Parse document structure with hierarchy
 */
export function parseDocumentStructure(text: string): DocumentSection {
  const lines = text.split('\n');
  const root: DocumentSection = {
    level: 0,
    title: 'Document',
    content: '',
    subsections: []
  };
  
  const stack: DocumentSection[] = [root];
  let currentContent: string[] = [];
  
  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headerMatch) {
      // Save current content to the appropriate section
      if (currentContent.length > 0) {
        stack[stack.length - 1].content = currentContent.join('\n').trim();
        currentContent = [];
      }
      
      const level = headerMatch[1].length;
      const title = headerMatch[2];
      
      // Pop stack to appropriate level
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      
      // Create new section
      const section: DocumentSection = {
        level,
        title,
        content: '',
        subsections: []
      };
      
      stack[stack.length - 1].subsections.push(section);
      stack.push(section);
    } else {
      currentContent.push(line);
    }
  }
  
  // Save remaining content
  if (currentContent.length > 0) {
    stack[stack.length - 1].content = currentContent.join('\n').trim();
  }
  
  return root;
}

/**
 * Split text at sentence boundaries
 */
function splitBySentences(text: string): string[] {
  // Improved sentence splitting that handles abbreviations
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  // Clean up and merge incorrectly split abbreviations
  const cleaned: string[] = [];
  let current = '';
  
  for (const sentence of sentences) {
    current += sentence;
    
    // Check if this looks like a complete sentence
    const trimmed = current.trim();
    const lastWord = trimmed.split(/\s+/).pop() || '';
    
    // Common abbreviations that shouldn't end sentences
    const abbreviations = ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr', 'Inc', 'Ltd', 'Co', 'vs', 'etc', 'i.e', 'e.g'];
    
    if (!abbreviations.includes(lastWord.replace('.', '')) && 
        trimmed.length > 10 && 
        /[A-Z]/.test(sentence.trim()[0] || '')) {
      cleaned.push(current.trim());
      current = '';
    }
  }
  
  if (current) {
    cleaned.push(current.trim());
  }
  
  return cleaned;
}

/**
 * Split text at paragraph boundaries
 */
function splitByParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0);
}

/**
 * Create semantic chunks with adaptive sizing
 */
export function createSemanticChunks(
  text: string,
  config: ChunkingConfig = {}
): SemanticChunk[] {
  const {
    targetTokens = 500,
    maxOutputTokens = 800,
    minTokens = 200,
    overlapTokens = 100,
    preserveStructure = true,
    adaptiveSize = true,
    sentenceBoundaries = true,
    paragraphBoundaries = true,
    sectionBoundaries = true
  } = config;
  
  const chunks: SemanticChunk[] = [];
  let position = 0;
  
  if (preserveStructure) {
    // Parse document structure
    const structure = parseDocumentStructure(text);
    
    // Process sections hierarchically
    const processSectionHierarchically = (
      section: DocumentSection, 
      parentPath: string = ''
    ) => {
      const currentPath = parentPath 
        ? `${parentPath} > ${section.title}`
        : section.title;
      
      // Process section content
      if (section.content) {
        const sectionChunks = chunkContent(
          section.content,
          currentPath,
          position,
          config
        );
        chunks.push(...sectionChunks);
        position += sectionChunks.length;
      }
      
      // Process subsections
      for (const subsection of section.subsections) {
        processSectionHierarchically(subsection, currentPath);
      }
    };
    
    processSectionHierarchically(structure);
  } else {
    // Simple chunking without structure preservation
    const simpleChunks = chunkContent(text, undefined, 0, config);
    chunks.push(...simpleChunks);
  }
  
  // Add overlap between chunks
  if (overlapTokens > 0) {
    return addOverlapToChunks(chunks, overlapTokens);
  }
  
  return chunks;
}

/**
 * Chunk content with semantic boundaries
 */
function chunkContent(
  text: string,
  section: string | undefined,
  startPosition: number,
  config: ChunkingConfig
): SemanticChunk[] {
  const {
    targetTokens = 500,
    maxOutputTokens = 800,
    minTokens = 200,
    adaptiveSize = true,
    sentenceBoundaries = true,
    paragraphBoundaries = true
  } = config;
  
  const chunks: SemanticChunk[] = [];
  
  // First try paragraph boundaries if enabled
  if (paragraphBoundaries) {
    const paragraphs = splitByParagraphs(text);
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let position = startPosition;
    
    for (const paragraph of paragraphs) {
      const paragraphTokens = estimateTokens(paragraph);
      const density = calculateDensity(paragraph);
      
      // Adjust target size based on density if adaptive
      const adjustedTarget = adaptiveSize 
        ? Math.round(targetTokens * (1 - density * 0.3)) // Dense content gets smaller chunks
        : targetTokens;
      
      if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
        // Create chunk from accumulated paragraphs
        const content = currentChunk.join('\n\n');
        chunks.push({
          content,
          metadata: {
            section,
            position: position++,
            tokens: currentTokens,
            type: detectContentType(content),
            density: calculateDensity(content),
            boundaries: {
              start: 'paragraph',
              end: 'paragraph'
            }
          }
        });
        
        currentChunk = [paragraph];
        currentTokens = paragraphTokens;
      } else if (paragraphTokens > maxTokens) {
        // Paragraph too large, need to split by sentences
        if (currentChunk.length > 0) {
          // Save current chunk first
          const content = currentChunk.join('\n\n');
          chunks.push({
            content,
            metadata: {
              section,
              position: position++,
              tokens: currentTokens,
              type: detectContentType(content),
              density: calculateDensity(content),
              boundaries: {
                start: 'paragraph',
                end: 'paragraph'
              }
            }
          });
          currentChunk = [];
          currentTokens = 0;
        }
        
        // Split large paragraph by sentences
        const sentenceChunks = chunkBySentences(paragraph, adjustedTarget, maxTokens, minTokens);
        for (const sentChunk of sentenceChunks) {
          chunks.push({
            content: sentChunk,
            metadata: {
              section,
              position: position++,
              tokens: estimateTokens(sentChunk),
              type: detectContentType(sentChunk),
              density: calculateDensity(sentChunk),
              boundaries: {
                start: 'sentence',
                end: 'sentence'
              }
            }
          });
        }
      } else {
        currentChunk.push(paragraph);
        currentTokens += paragraphTokens;
        
        // Check if we've reached target size
        if (currentTokens >= adjustedTarget && currentTokens >= minTokens) {
          const content = currentChunk.join('\n\n');
          chunks.push({
            content,
            metadata: {
              section,
              position: position++,
              tokens: currentTokens,
              type: detectContentType(content),
              density: calculateDensity(content),
              boundaries: {
                start: 'paragraph',
                end: 'paragraph'
              }
            }
          });
          currentChunk = [];
          currentTokens = 0;
        }
      }
    }
    
    // Add remaining content
    if (currentChunk.length > 0) {
      const content = currentChunk.join('\n\n');
      chunks.push({
        content,
        metadata: {
          section,
          position: position++,
          tokens: currentTokens,
          type: detectContentType(content),
          density: calculateDensity(content),
          boundaries: {
            start: 'paragraph',
            end: currentChunk.length > 1 ? 'paragraph' : 'sentence'
          }
        }
      });
    }
  } else if (sentenceBoundaries) {
    // Fall back to sentence-based chunking
    const sentenceChunks = chunkBySentences(text, targetTokens, maxTokens, minTokens);
    let position = startPosition;
    
    for (const chunk of sentenceChunks) {
      chunks.push({
        content: chunk,
        metadata: {
          section,
          position: position++,
          tokens: estimateTokens(chunk),
          type: detectContentType(chunk),
          density: calculateDensity(chunk),
          boundaries: {
            start: 'sentence',
            end: 'sentence'
          }
        }
      });
    }
  } else {
    // Simple token-based chunking without boundaries
    const simpleChunks = simpleTokenChunking(text, targetTokens, maxTokens);
    let position = startPosition;
    
    for (const chunk of simpleChunks) {
      chunks.push({
        content: chunk,
        metadata: {
          section,
          position: position++,
          tokens: estimateTokens(chunk),
          type: 'mixed',
          density: calculateDensity(chunk),
          boundaries: {
            start: 'sentence',
            end: 'sentence'
          }
        }
      });
    }
  }
  
  return chunks;
}

/**
 * Chunk by sentences with size constraints
 */
function chunkBySentences(
  text: string,
  targetTokens: number,
  maxTokens: number,
  minTokens: number
): string[] {
  const sentences = splitBySentences(text);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    
    if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [sentence];
      currentTokens = sentenceTokens;
    } else {
      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
      
      if (currentTokens >= targetTokens && currentTokens >= minTokens) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentTokens = 0;
      }
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

/**
 * Simple token-based chunking
 */
function simpleTokenChunking(text: string, targetTokens: number, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const word of words) {
    const wordTokens = estimateTokens(word);
    
    if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [word];
      currentTokens = wordTokens;
    } else {
      currentChunk.push(word);
      currentTokens += wordTokens;
      
      if (currentTokens >= targetTokens) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentTokens = 0;
      }
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

/**
 * Add overlap between chunks for context preservation
 */
function addOverlapToChunks(
  chunks: SemanticChunk[],
  overlapTokens: number
): SemanticChunk[] {
  if (chunks.length <= 1) return chunks;
  
  const overlappedChunks: SemanticChunk[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    let content = chunks[i].content;
    
    // Add overlap from previous chunk
    if (i > 0) {
      const prevSentences = splitBySentences(chunks[i - 1].content);
      let overlapContent = '';
      let tokens = 0;
      
      // Add sentences from the end of previous chunk until we reach overlap target
      for (let j = prevSentences.length - 1; j >= 0 && tokens < overlapTokens; j--) {
        const sentence = prevSentences[j];
        tokens += estimateTokens(sentence);
        overlapContent = sentence + ' ' + overlapContent;
      }
      
      if (overlapContent) {
        content = overlapContent.trim() + '\n\n' + content;
      }
    }
    
    // Add overlap from next chunk
    if (i < chunks.length - 1) {
      const nextSentences = splitBySentences(chunks[i + 1].content);
      let overlapContent = '';
      let tokens = 0;
      
      // Add sentences from the beginning of next chunk until we reach overlap target
      for (const sentence of nextSentences) {
        tokens += estimateTokens(sentence);
        if (tokens > overlapTokens) break;
        overlapContent += ' ' + sentence;
      }
      
      if (overlapContent) {
        content = content + '\n\n' + overlapContent.trim();
      }
    }
    
    overlappedChunks.push({
      content,
      metadata: {
        ...chunks[i].metadata,
        tokens: estimateTokens(content)
      }
    });
  }
  
  return overlappedChunks;
}

/**
 * Merge small chunks to meet minimum size requirements
 */
export function mergeSmallChunks(
  chunks: SemanticChunk[],
  minTokens: number
): SemanticChunk[] {
  const merged: SemanticChunk[] = [];
  let currentMerge: SemanticChunk | null = null;
  
  for (const chunk of chunks) {
    if (chunk.metadata.tokens < minTokens) {
      if (currentMerge) {
        // Merge with current accumulation
        currentMerge = {
          content: currentMerge.content + '\n\n' + chunk.content,
          metadata: {
            ...currentMerge.metadata,
            tokens: currentMerge.metadata.tokens + chunk.metadata.tokens,
            type: 'mixed',
            density: (currentMerge.metadata.density + chunk.metadata.density) / 2,
            boundaries: {
              start: currentMerge.metadata.boundaries.start,
              end: chunk.metadata.boundaries.end
            }
          }
        };
      } else {
        // Start new merge accumulation
        currentMerge = chunk;
      }
      
      // Check if merged chunk is now large enough
      if (currentMerge.metadata.tokens >= minTokens) {
        merged.push(currentMerge);
        currentMerge = null;
      }
    } else {
      // Chunk is large enough on its own
      if (currentMerge) {
        // Save any pending merge
        merged.push(currentMerge);
        currentMerge = null;
      }
      merged.push(chunk);
    }
  }
  
  // Add any remaining merge
  if (currentMerge) {
    merged.push(currentMerge);
  }
  
  return merged;
}