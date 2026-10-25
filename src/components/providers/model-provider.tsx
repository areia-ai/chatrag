'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

export type Model = {
  id: string;
  displayName: string;
  isFree?: boolean;
  isOpenSource?: boolean;
  isUncensored?: boolean;
  supportsReasoning?: boolean;
  reasoningMethod?: 'effort' | 'max_tokens' | 'both' | 'none';
  isDefault?: boolean;
};

// Known reasoning models map for detection
const REASONING_MODEL_PATTERNS: Record<string, { method: 'effort' | 'max_tokens' | 'both' }> = {
  'o1': { method: 'effort' },
  'o1-mini': { method: 'effort' },
  'o1-preview': { method: 'effort' },
  'o3': { method: 'effort' },
  'o3-mini': { method: 'effort' },
  'o4': { method: 'effort' },
  'o4-mini': { method: 'effort' },
  'claude-3.7': { method: 'max_tokens' },
  'claude-3.8': { method: 'max_tokens' },
  'claude-sonnet-4': { method: 'max_tokens' },
  'claude-sonnet-4.5': { method: 'max_tokens' },
  'claude-opus-4.1': { method: 'max_tokens' },
  'deepseek-r1': { method: 'both' },
  'deepseek/deepseek-r1': { method: 'both' },
  'deepseek-r1-0528': { method: 'both' },
  'deepseek/deepseek-r1-0528': { method: 'both' },
  'deepseek-r1-distill': { method: 'both' },
  'deepseek/deepseek-r1-distill': { method: 'both' },
  'gemini-2.0-flash-thinking': { method: 'max_tokens' },
  'gemini-2.5-pro-thinking': { method: 'max_tokens' },
  'gemini-thinking': { method: 'max_tokens' },
  // OpenAI GPT-5 family (effort-based)
  'gpt-5': { method: 'effort' },
  'gpt-5-mini': { method: 'effort' },
};

// Function to detect if a model supports reasoning - now uses stored model data
function detectReasoningSupport(model: Model): { supportsReasoning: boolean; reasoningMethod?: 'effort' | 'max_tokens' | 'both' } {
  // First check if the model has reasoning metadata stored (from config UI)
  if (typeof model.supportsReasoning === 'boolean') {
    return {
      supportsReasoning: model.supportsReasoning,
      reasoningMethod: model.reasoningMethod || 'max_tokens'
    };
  }

  // Fallback to pattern matching for legacy models
  const lowerModelId = model.id.toLowerCase();

  for (const [pattern, config] of Object.entries(REASONING_MODEL_PATTERNS)) {
    if (lowerModelId.includes(pattern)) {
      return { supportsReasoning: true, reasoningMethod: config.method };
    }
  }

  return { supportsReasoning: false };
}

// Get the current AI provider from environment (initial value)
let AI_PROVIDER = env.NEXT_PUBLIC_AI_PROVIDER as 'openai' | 'openrouter' | 'groq';

// Load models dynamically from API
const fetchModelsFromAPI = async (): Promise<{ models: Model[], provider: 'openai' | 'openrouter' | 'groq' }> => {
  try {
    const response = await fetch('/api/config/models');
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    AI_PROVIDER = data.provider; // Update the provider

    let models: Model[] = [];
    if (data.provider === 'openai') {
      models = data.openaiModels;
    } else if (data.provider === 'openrouter') {
      models = data.openrouterModels;
    } else if (data.provider === 'groq') {
      models = data.groqModels;
    }

    // Enhance models with reasoning detection
    const enhancedModels = models.map((model: Model) => {
      const reasoningInfo = detectReasoningSupport(model);
      return {
        ...model,
        ...reasoningInfo
      };
    });

    return { models: enhancedModels, provider: data.provider };
  } catch (error) {
    console.error('Error fetching models from API:', error);
    // Fallback to environment variables
    return { models: getAvailableModelsFromEnv(), provider: AI_PROVIDER };
  }
};

// Fallback function to load from environment variables
const getAvailableModelsFromEnv = (): Model[] => {
  try {
    let models: Model[] = [];
    if (AI_PROVIDER === 'openai') {
      models = JSON.parse(env.NEXT_PUBLIC_OPENAI_MODELS || '[]');
    } else if (AI_PROVIDER === 'openrouter') {
      models = JSON.parse(env.NEXT_PUBLIC_OPENROUTER_MODELS || '[]');
    } else if (AI_PROVIDER === 'groq') {
      models = JSON.parse(env.NEXT_PUBLIC_GROQ_MODELS || '[]');
    }

    // Enhance with reasoning detection
    return models.map((model: Model) => {
      const reasoningInfo = detectReasoningSupport(model);
      return {
        ...model,
        ...reasoningInfo
      };
    });
  } catch (error) {
    console.error('Error parsing model configuration:', error);
    // Fallback to default OpenRouter models
    return [
      { id: 'anthropic/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', supportsReasoning: true, reasoningMethod: 'max_tokens', isDefault: true },
      { id: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 Mini' },
      { id: 'openai/gpt-4.1', displayName: 'GPT-4.1' },
      { id: 'anthropic/claude-opus-4.1', displayName: 'Claude Opus 4.1', supportsReasoning: true, reasoningMethod: 'max_tokens' },
      { id: 'google/gemini-2.5-pro-preview', displayName: 'Gemini 2.5 Pro' },
      { id: 'deepseek/deepseek-r1', displayName: 'DeepSeek R1', supportsReasoning: true, reasoningMethod: 'both' },
    ];
  }
};

// Export initial models (will be updated dynamically)
export let AVAILABLE_MODELS: Model[] = getAvailableModelsFromEnv();

type ModelContextType = {
  selectedModel: Model | null;
  setSelectedModel: (model: Model) => void;
  isLoading: boolean;
  aiProvider: 'openai' | 'openrouter' | 'groq';
  availableModels: Model[];
  refreshModels: () => Promise<void>;
};

const ModelContext = createContext<ModelContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'selectedModel';

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModelState] = useState<Model | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<Model[]>(AVAILABLE_MODELS);
  const [currentProvider, setCurrentProvider] = useState<'openai' | 'openrouter' | 'groq'>(AI_PROVIDER);

  // Function to refresh models from API
  const refreshModels = async () => {
    try {
      const { models, provider } = await fetchModelsFromAPI();
      setAvailableModels(models);
      setCurrentProvider(provider);
      AVAILABLE_MODELS = models; // Update the exported variable

      // Check if selected model is still available
      const savedModelId = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedModelId) {
        const savedModel = models.find(model => model.id === savedModelId);
        if (savedModel) {
          setSelectedModelState(savedModel);
        } else if (models.length > 0) {
          // If saved model no longer exists, select default or first available
          const defaultModel = models.find(model => model.isDefault) || models[0];
          setSelectedModelState(defaultModel);
          localStorage.setItem(LOCAL_STORAGE_KEY, defaultModel.id);
        }
      }
    } catch (error) {
      console.error('Failed to refresh models:', error);
    }
  };

  // Load models on mount and set up refresh
  useEffect(() => {
    const loadInitialModels = async () => {
      // Try to fetch from API first
      await refreshModels();

      const savedModelId = localStorage.getItem(LOCAL_STORAGE_KEY);
      const models = availableModels.length > 0 ? availableModels : AVAILABLE_MODELS;

      if (savedModelId) {
        const savedModel = models.find(model => model.id === savedModelId);
        if (savedModel) {
          setSelectedModelState(savedModel);
        } else if (models.length > 0) {
          const defaultModel = models.find(model => model.isDefault) || models[0];
          setSelectedModelState(defaultModel);
          localStorage.setItem(LOCAL_STORAGE_KEY, defaultModel.id);
        }
      } else if (models.length > 0) {
        const defaultModel = models.find(model => model.isDefault) || models[0];
        setSelectedModelState(defaultModel);
        localStorage.setItem(LOCAL_STORAGE_KEY, defaultModel.id);
      }

      setIsLoading(false);
    };

    loadInitialModels();

    // Set up periodic refresh (every 30 seconds when tab is visible)
    const intervalId = setInterval(() => {
      if (!document.hidden) {
        refreshModels();
      }
    }, 30000);

    // Set up listener for config changes (faster refresh when config UI updates models)
    const checkForModelUpdates = async () => {
      try {
        const response = await fetch('/api/config/models');
        if (response.ok) {
          const data = await response.json();
          let currentModelsStr = '';
          if (data.provider === 'openai') {
            currentModelsStr = JSON.stringify(data.openaiModels);
          } else if (data.provider === 'openrouter') {
            currentModelsStr = JSON.stringify(data.openrouterModels);
          } else if (data.provider === 'groq') {
            currentModelsStr = JSON.stringify(data.groqModels);
          }
          const currentAvailableStr = JSON.stringify(availableModels);

          // Only refresh if models actually changed
          if (currentModelsStr !== currentAvailableStr) {
            console.log('🔄 Model configuration changed, refreshing models...');
            await refreshModels();
          }
        }
      } catch (error) {
        // Silent fail - don't spam logs
      }
    };

    // More frequent checks for model updates (every 5 seconds)
    const modelUpdateIntervalId = setInterval(checkForModelUpdates, 5000);

    // Refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshModels();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      clearInterval(modelUpdateIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Wrapper function to update both state and localStorage
  const setSelectedModel = async (model: Model) => {
    setSelectedModelState(model);
    localStorage.setItem(LOCAL_STORAGE_KEY, model.id);

    // Also save to database for WhatsApp integration
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      console.log('[MODEL PROVIDER] Current user:', user?.id);

      if (user) {
        console.log('[MODEL PROVIDER] Saving model preference to database:', model.id);

        const { error } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            selected_model: model.id,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          });

        if (error) {
          console.error('[MODEL PROVIDER] Failed to save model preference to database:', error);
        } else {
          console.log('[MODEL PROVIDER] Successfully saved model preference:', model.id);
        }
      } else {
        console.log('[MODEL PROVIDER] No authenticated user, cannot save preference');
      }
    } catch (error) {
      console.error('[MODEL PROVIDER] Error saving model preference:', error);
    }
  };

  return (
    <ModelContext.Provider value={{
      selectedModel,
      setSelectedModel,
      isLoading,
      aiProvider: currentProvider,
      availableModels,
      refreshModels
    }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
} 