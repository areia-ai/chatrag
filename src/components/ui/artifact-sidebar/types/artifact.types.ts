import { ReactNode } from 'react';

export type SupportedLanguage = 
  | 'html' 
  | 'css' 
  | 'js' 
  | 'javascript' 
  | 'jsx' 
  | 'tsx' 
  | 'svg' 
  | 'json' 
  | 'markdown' 
  | 'yaml' 
  | 'xml'
  | 'python'
  | 'bash'
  | 'shell';

export type FileType = 'html' | 'css' | 'js' | 'json' | 'svg' | 'txt';

export interface FileToDownload {
  name: string;
  content: string;
  type: FileType;
  icon: ReactNode;
  size?: number;
}

export interface ArtifactData {
  code: string;
  language: SupportedLanguage;
  title: string;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PreviewConfig {
  showLineNumbers?: boolean;
  theme?: 'light' | 'dark';
  autoRefresh?: boolean;
  sanitizeContent?: boolean;
}

export interface ResizeConfig {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  step?: number;
  persistPreferences?: boolean;
}

export interface ArtifactSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  language: SupportedLanguage;
  title?: string;

  config?: {
    preview?: PreviewConfig;
    resize?: Partial<ResizeConfig>;
  };
}

export interface ArtifactContextType {
  // Core state
  isOpen: boolean;
  artifactData: ArtifactData | null;
  
  // Actions
  openArtifact: (code: string, language: SupportedLanguage, title?: string, config?: ArtifactSidebarProps['config']) => void;
  closeArtifact: () => void;
  updateArtifact: (updates: Partial<ArtifactData>) => void;
  
  // Configuration
  config: {
    preview: PreviewConfig;
    resize: ResizeConfig;
  };
  updateConfig: (updates: Partial<ArtifactSidebarProps['config']>) => void;
  

}

export interface SidebarState {
  status: 'closed' | 'opening' | 'open' | 'closing' | 'error';
  width: number;
  isResizing: boolean;
  error: string | null;
}

export type SidebarAction = 
  | { type: 'OPEN_START' }
  | { type: 'OPEN_COMPLETE' }
  | { type: 'CLOSE_START' }
  | { type: 'CLOSE_COMPLETE' }
  | { type: 'RESIZE_START'; width: number }
  | { type: 'RESIZE_UPDATE'; width: number }
  | { type: 'RESIZE_END' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

export interface PreviewError {
  type: 'generation' | 'render' | 'security' | 'timeout';
  message: string;
  code?: string;
  recoverable: boolean;
}

export interface PreviewResult {
  content: string;
  type: 'html' | 'text' | 'error';
  language: SupportedLanguage;
  generatedAt: Date;
  error?: PreviewError;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type EventHandler<T = void> = () => T;
export type EventHandlerWithPayload<P, T = void> = (payload: P) => T; 