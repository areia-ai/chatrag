'use client';

/**
 * This is a proxy module that allows us to override the Markdown component
 * without modifying the original files.
 * 
 * When components import from '@/components/ui/markdown', they'll get
 * our enhanced streaming version instead.
 */

// Re-export the enhanced Markdown component and types from the provider
export { Markdown } from '@/components/providers/markdown-provider';
export type { MarkdownProps } from '@/components/ui/markdown';

// Also re-export other components from the original markdown module
export { CodeBlock, CodeBlockCode } from '@/components/ui/code-block';