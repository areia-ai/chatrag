import { useState, useEffect, useMemo, useCallback } from 'react';
import { SupportedLanguage, PreviewResult, PreviewConfig } from '../types/artifact.types';
import { generatePreview } from '../utils/preview-generators';

interface UsePreviewOptions {
  code: string;
  language: SupportedLanguage;
  config?: PreviewConfig;
  debounceMs?: number;
}

interface UsePreviewReturn {
  preview: PreviewResult | null;
  isLoading: boolean;
  error: string | null;
  regenerate: () => void;
  clearError: () => void;
}

export function usePreview({
  code,
  language,
  config = {},
  debounceMs = 300,
}: UsePreviewOptions): UsePreviewReturn {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Memoize preview options to avoid unnecessary regeneration
  const previewOptions = useMemo(() => ({
    sanitize: config.sanitizeContent ?? true,
  }), [config.sanitizeContent]);

  const generatePreviewContent = useCallback(async (
    currentCode: string,
    currentLanguage: SupportedLanguage
  ) => {
    if (!currentCode.trim()) {
      setPreview(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate async operation for consistency
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = generatePreview(currentCode, currentLanguage, previewOptions);
      
      if (result.error) {
        setError(result.error.message);
        setPreview(result); // Still set preview to show error state
      } else {
        setPreview(result);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to generate preview: ${errorMessage}`);
      setPreview(null);
    } finally {
      setIsLoading(false);
    }
  }, [previewOptions]);

  // Debounced preview generation
  useEffect(() => {
    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      generatePreviewContent(code, language);
    }, debounceMs);

    setDebounceTimer(timer);

    // Cleanup
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [code, language, generatePreviewContent, debounceMs]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  const regenerate = useCallback(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      setDebounceTimer(null);
    }
    generatePreviewContent(code, language);
  }, [code, language, generatePreviewContent, debounceTimer]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    preview,
    isLoading,
    error,
    regenerate,
    clearError,
  };
} 