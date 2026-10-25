import { Language, translations } from '@/translations';

export type SystemPromptTemplate = keyof typeof translations.en.systemPrompts;

export interface SystemPrompt {
  name: string;
  description: string;
  preContext: string;
  postContext: string;
}

export class SystemPromptManager {
  private static CONTEXT_PLACEHOLDER = '{{context}}';
  private static CONTEXT_SECTION = `

Context:
{{context}}

`;

  /**
   * Get a system prompt template by key and language
   */
  static getPromptTemplate(
    templateKey: SystemPromptTemplate,
    language: Language = 'en'
  ): SystemPrompt | null {
    const translation = translations[language];
    
    // Check if the language has system prompts
    if (!translation.systemPrompts) {
      console.warn(`[SystemPromptManager] No system prompts found for language: ${language}, falling back to English`);
      return translations.en.systemPrompts[templateKey] || null;
    }
    
    // Get the prompt template
    const prompt = translation.systemPrompts[templateKey];
    
    if (!prompt) {
      console.warn(`[SystemPromptManager] Template "${templateKey}" not found for language: ${language}, falling back to English`);
      return translations.en.systemPrompts[templateKey] || null;
    }
    
    return prompt;
  }

  /**
   * Assemble a complete system prompt with the context placeholder
   */
  static assemblePrompt(
    preContext: string,
    postContext: string = ''
  ): string {
    // Ensure the prompt has the context placeholder
    const hasContextPlaceholder = 
      preContext.includes(this.CONTEXT_PLACEHOLDER) || 
      postContext.includes(this.CONTEXT_PLACEHOLDER);
    
    if (!hasContextPlaceholder) {
      console.warn('[SystemPromptManager] No {{context}} placeholder found, adding it between pre and post context');
      return preContext + this.CONTEXT_SECTION + postContext;
    }
    
    // If context is already in one of them, just combine
    return preContext + '\n\n' + postContext;
  }

  /**
   * Get assembled prompt from template
   */
  static getAssembledPrompt(
    templateKey: SystemPromptTemplate,
    language: Language = 'en'
  ): string {
    const template = this.getPromptTemplate(templateKey, language);
    
    if (!template) {
      console.error(`[SystemPromptManager] Failed to get template: ${templateKey}`);
      return this.getDefaultPrompt();
    }
    
    return this.assemblePrompt(template.preContext, template.postContext);
  }

  /**
   * Validate that a prompt contains the context placeholder
   */
  static validatePrompt(prompt: string): boolean {
    return prompt.includes(this.CONTEXT_PLACEHOLDER);
  }

  /**
   * Add context placeholder to a prompt if missing
   */
  static ensureContextPlaceholder(prompt: string): string {
    if (this.validatePrompt(prompt)) {
      return prompt;
    }
    
    console.warn('[SystemPromptManager] Adding missing {{context}} placeholder to prompt');
    return prompt + this.CONTEXT_SECTION;
  }

  /**
   * Replace the context placeholder with actual context
   */
  static injectContext(prompt: string, context: string): string {
    if (!this.validatePrompt(prompt)) {
      console.error('[SystemPromptManager] Prompt missing {{context}} placeholder, adding it');
      prompt = this.ensureContextPlaceholder(prompt);
    }
    
    return prompt.replace(this.CONTEXT_PLACEHOLDER, context);
  }

  /**
   * Get the default system prompt
   */
  static getDefaultPrompt(): string {
    return `You are a helpful AI assistant with access to a knowledge base. When answering questions:

1. If the context contains relevant information, use it to provide accurate and specific answers
2. If information is not available in the context, say so clearly and suggest alternative approaches
3. Always cite your sources when referencing specific documents
4. Provide balanced, objective information rather than opinions
5. For technical topics, include practical steps or examples when appropriate
6. IMPORTANT - When relevant links are provided in the "RELEVANT LINKS" section:
   - Include clickable links naturally in your response using markdown format: [text](URL)
   - Only include links that directly relate to the user's question
   - Integrate links seamlessly into your answer where they add value
   - Example: "You can purchase the Pro plan [here](URL)" or "Check out the [documentation](URL)"

Context:
{{context}}`;
  }

  /**
   * Get available template keys
   */
  static getAvailableTemplates(): SystemPromptTemplate[] {
    return Object.keys(translations.en.systemPrompts) as SystemPromptTemplate[];
  }

  /**
   * Get all templates for a specific language
   */
  static getAllTemplates(language: Language = 'en'): Record<string, SystemPrompt> {
    const translation = translations[language];
    
    if (!translation.systemPrompts) {
      console.warn(`[SystemPromptManager] No system prompts for language: ${language}, using English`);
      return translations.en.systemPrompts;
    }
    
    // Merge with English templates to ensure all keys are present
    const englishTemplates = translations.en.systemPrompts;
    const localizedTemplates = translation.systemPrompts || {};
    
    const merged: Record<string, SystemPrompt> = {};
    
    for (const key in englishTemplates) {
      merged[key] = localizedTemplates[key] || englishTemplates[key];
    }
    
    return merged;
  }

  /**
   * Parse a prompt to extract pre and post context sections
   */
  static parsePrompt(prompt: string): { preContext: string; postContext: string } {
    const contextIndex = prompt.indexOf(this.CONTEXT_PLACEHOLDER);
    
    if (contextIndex === -1) {
      // No context placeholder, treat entire prompt as pre-context
      return {
        preContext: prompt,
        postContext: ''
      };
    }
    
    // Find the context section boundaries
    const contextSectionStart = prompt.lastIndexOf('\n', contextIndex);
    const contextSectionEnd = prompt.indexOf('\n', contextIndex + this.CONTEXT_PLACEHOLDER.length);
    
    const preContext = prompt.substring(0, contextSectionStart).trim();
    const postContext = contextSectionEnd !== -1 
      ? prompt.substring(contextSectionEnd).trim() 
      : '';
    
    return { preContext, postContext };
  }

  /**
   * Get localized prompt with custom overrides
   */
  static getLocalizedPrompt(
    options: {
      templateKey?: SystemPromptTemplate;
      language?: Language;
      customPreContext?: string;
      customPostContext?: string;
    }
  ): string {
    const { 
      templateKey = 'helpful', 
      language = 'en',
      customPreContext,
      customPostContext
    } = options;
    
    // If custom contexts provided, use them
    if (customPreContext !== undefined || customPostContext !== undefined) {
      return this.assemblePrompt(
        customPreContext || '',
        customPostContext || ''
      );
    }
    
    // Otherwise use template
    return this.getAssembledPrompt(templateKey, language);
  }
}

// Export convenience functions
export function getSystemPrompt(
  templateKey: SystemPromptTemplate,
  language: Language = 'en'
): string {
  return SystemPromptManager.getAssembledPrompt(templateKey, language);
}

export function validateSystemPrompt(prompt: string): boolean {
  return SystemPromptManager.validatePrompt(prompt);
}

export function injectContextIntoPrompt(prompt: string, context: string): string {
  return SystemPromptManager.injectContext(prompt, context);
}