import { create } from 'zustand';

export interface Document {
  id: string;
  name: string;
  type: string;
  // Make optional to be compatible with both interfaces
  text?: string;
  pages?: number;
  chunks?: Array<{
    content: string;
    embedding: number[];
  }>;
}

interface DocumentMentionState {
  selectedDocuments: Document[];
  addDocument: (document: Document) => void;
  removeDocument: (id: string) => void;
  clearDocuments: () => void;
  isDocumentSelected: (id: string) => boolean;
}

export const useDocumentMentionStore = create<DocumentMentionState>((set, get) => ({
  selectedDocuments: [],
  
  addDocument: (document) => {
    // Only add if not already selected
    if (!get().isDocumentSelected(document.id)) {
      set((state) => ({ 
        selectedDocuments: [...state.selectedDocuments, document] 
      }));
    }
  },
  
  removeDocument: (id) => {
    set((state) => ({
      selectedDocuments: state.selectedDocuments.filter(doc => doc.id !== id)
    }));
  },
  
  clearDocuments: () => {
    set({ selectedDocuments: [] });
  },
  
  isDocumentSelected: (id) => {
    return get().selectedDocuments.some(doc => doc.id === id);
  }
})); 