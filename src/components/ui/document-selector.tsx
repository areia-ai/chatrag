"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, Search } from 'lucide-react';
import { Document } from '@/lib/document-mention-store';

// Mock documents as fallback
const MOCK_DOCUMENTS: Document[] = [
  {
    id: '2527f791-8353-4bf9-95da-0ecb22467a83',
    name: 'EyeglassRX_CarlosMarcial_20250222.pdf',
    type: 'pdf',
  },
  {
    id: '1393698a-8a31-49d3-bf8c-70f177896be5',
    name: 'NodusAI.docx',
    type: 'docx',
  },
  {
    id: '654f24da-65c7-458a-8c3d-bde24572946c',
    name: 'Nifty Gateway Drop.pdf',
    type: 'pdf',
  },
  {
    id: '9fe868ca-791b-4bd3-ad61-994bb3e15eef',
    name: 'Bio Carlos Marcial (Criptoarte).pdf',
    type: 'pdf',
  },
];

interface DocumentSelectorProps {
  isOpen: boolean;
  onDocumentSelect: (document: Document) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const DocumentSelector: React.FC<DocumentSelectorProps> = ({
  isOpen,
  onDocumentSelect,
  onClose,
  position,
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const documentListRef = useRef<HTMLDivElement>(null);

  // Reset search and selection when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      fetchDocuments();
      // Focus search input when modal opens
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Filter documents based on search query
  useEffect(() => {
    if (!documents.length) {
      setFilteredDocuments([]);
      return;
    }

    const filtered = documents.filter(doc =>
      doc.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredDocuments(filtered);
    
    // Reset selection when filtered results change
    setSelectedIndex(0);
  }, [documents, searchQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (documentListRef.current && filteredDocuments.length > 0) {
      const selectedElement = documentListRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedIndex, filteredDocuments]);

  // Close the selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Enhanced keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
          
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < filteredDocuments.length - 1 ? prev + 1 : prev
          );
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
          break;
          
        case 'Enter':
          e.preventDefault();
          if (filteredDocuments.length > 0 && selectedIndex >= 0) {
            const selectedDoc = filteredDocuments[selectedIndex];
            if (selectedDoc) {
              onDocumentSelect(selectedDoc);
            }
          }
          break;
          
        case 'Tab':
          // If focus is on search input and we have documents, move focus to first document
          // If focus is on documents, move back to search
          if (e.target === searchInputRef.current) {
            if (filteredDocuments.length > 0) {
              e.preventDefault();
              // Focus will be handled by arrow keys
            }
          }
          break;
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, filteredDocuments, selectedIndex, onDocumentSelect]);

  const fetchDocuments = async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('Fetching documents...');
      const res = await fetch('/api/documents');
      
      if (!res.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await res.json();
      console.log('Documents API response:', data);
      
      if (data.documents && Array.isArray(data.documents) && data.documents.length > 0) {
        // Format the documents properly to ensure they have the expected properties
        const formattedDocs = data.documents.map((doc: any) => ({
          id: doc.id || crypto.randomUUID(),
          name: doc.filename || doc.name || `Doc-${doc.id?.substring(0, 8) || 'Unknown'}`,
          type: (doc.filename?.split('.').pop() || doc.type || 'doc') as 'pdf' | 'doc' | 'docx' | 'txt'
        }));
        
        console.log('Formatted documents:', formattedDocs);
        setDocuments(formattedDocs);
      } else {
        console.log('No documents found in API response, using mock data');
        setDocuments(MOCK_DOCUMENTS);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError('Failed to load documents');
      // Use mock documents as fallback
      console.log('Using mock documents as fallback due to error');
      setDocuments(MOCK_DOCUMENTS);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDocumentClick = useCallback((document: Document, index: number) => {
    console.log('Document selected:', document);
    onDocumentSelect(document);
  }, [onDocumentSelect]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="document-selector fixed z-[9999] w-72 rounded-md shadow-lg bg-white dark:bg-[#212121] flex flex-col border-2 border-[#FF6417] dark:border-[#FF6417]"
      style={{
        top: position.top,
        left: position.left,
        maxHeight: '400px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-selector-title"
    >
      {/* Header */}
      <div className="p-2 border-b dark:border-gray-700">
        <div 
          id="document-selector-title"
          className="text-center font-medium text-sm text-gray-900 dark:text-white mb-2"
        >
          Select a document
        </div>
        
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#FF6417] focus:border-[#FF6417]"
            aria-label="Search documents"
          />
        </div>
      </div>

      {/* Document List */}
      <div 
        ref={documentListRef}
        className="overflow-y-auto p-2 space-y-1 flex-1"
        role="listbox"
        aria-label="Documents"
      >
        {isLoading ? (
          <div className="p-2 text-center text-sm text-gray-500">Loading documents...</div>
        ) : error ? (
          <div className="p-2 text-center text-sm text-red-500">{error}</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-2 text-center text-sm text-gray-500">
            {searchQuery ? `No documents found matching "${searchQuery}"` : 'No documents found'}
          </div>
        ) : (
          filteredDocuments.map((doc, index) => (
            <button
              key={doc.id}
              onClick={() => handleDocumentClick(doc, index)}
              className={`flex items-center gap-2 w-full p-2 text-left rounded-md transition-colors ${
                index === selectedIndex
                  ? 'bg-[#FF6417] text-white'
                  : 'hover:bg-[#FFF0E8] dark:hover:bg-[#2A2A2A] text-gray-900 dark:text-white'
              }`}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={-1}
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${
                index === selectedIndex
                  ? 'bg-white bg-opacity-20'
                  : 'bg-[#FFF0E8] dark:bg-[#1A1A1A]'
              }`}>
                <FileText className={`h-4 w-4 ${
                  index === selectedIndex ? 'text-white' : 'text-[#FF6417]'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${
                  index === selectedIndex ? 'text-white' : 'text-gray-900 dark:text-white'
                }`}>
                  {doc.name || 'Unnamed Document'}
                </p>
                <p className={`text-xs uppercase ${
                  index === selectedIndex ? 'text-white text-opacity-80' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {doc.type || 'UNKNOWN'}
                </p>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer with keyboard hints */}
      {filteredDocuments.length > 0 && (
        <div className="p-2 border-t dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center">
          ↑↓ Navigate • Enter Select • Esc Close
        </div>
      )}
    </div>
  );
};

export default DocumentSelector;