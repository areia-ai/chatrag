"use client"

import * as React from "react"
import { format } from "date-fns"
import { FileUp, Loader2, MoreHorizontal, Search, Trash2, Upload, HardDriveUpload, Download, FileText, FileX, Loader, X, Cloud, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { PortalTooltip } from "./portal-tooltip"
import { useOrganizationStore } from "@/lib/stores/organization-store"
import { isMultiTenant } from "@/lib/deployment-mode"
import { ConnectorGrid } from "@/components/ui/nango"
import { useConnectorConfig } from "@/lib/hooks/use-connector-config"
import { useFirecrawlConfig } from "@/lib/hooks/use-firecrawl-config"
import { UrlScraper } from "@/components/ui/scrapers/url-scraper"

export interface ProcessedDocument {
  id: string
  name: string
  text: string
  type: 'pdf' | 'doc' | 'docx' | 'txt' | 'pptx' | 'xlsx' | 'html' | 'rtf' | 'epub'
  size?: number
  pages?: number
  uploadedAt?: Date
  status?: "processing" | "ready" | "failed"
  chunks?: Array<{
    content: string
    embedding: number[]
  }>
  error?: string
  partialSuccess?: boolean
  external_url?: string
  source?: string
  source_provider?: string
  source_file_id?: string
}

export interface DocumentDashboardProps {
  disabled?: boolean
  isActive?: boolean
  className?: string
  readOnly?: boolean
  tooltip?: string
  onProcessingStart?: (fileName: string) => void
  onProcessingComplete?: (processedDoc: ProcessedDocument) => void
  onProcessingError?: (error: Error) => void
  onDelete?: (id: string) => void
}

const SUPPORTED_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
const SUPPORTED_DOC_EXTENSIONS: ProcessedDocument['type'][] = ['pdf', 'doc', 'docx', 'txt', 'pptx', 'xlsx', 'html', 'rtf', 'epub']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

type ApiDocumentRecord = {
  id: string
  filename: string
  created_at: string
  pages?: number
  text?: string
  metadata?: {
    external_url?: string
    title?: string
  }
  source?: string
  source_provider?: string
  source_file_id?: string
  source_connection_id?: string
}

interface DocumentsApiResponse {
  documents: ApiDocumentRecord[]
}

const inferDocumentType = (filename: string): ProcessedDocument['type'] => {
  const extension = filename.split('.').pop()?.toLowerCase() as ProcessedDocument['type'] | undefined
  return extension && SUPPORTED_DOC_EXTENSIONS.includes(extension) ? extension : 'txt'
}

const mapApiDocumentToProcessed = (doc: ApiDocumentRecord): ProcessedDocument => ({
  id: doc.id,
  name: doc.filename,
  type: inferDocumentType(doc.filename),
  text: doc.text ?? '',
  uploadedAt: new Date(doc.created_at),
  status: 'ready',
  pages: doc.pages,
  external_url: doc.metadata?.external_url,
  source: doc.source,
  source_provider: doc.source_provider,
  source_file_id: doc.source_file_id
})

const getUploadTimestamp = (doc: ProcessedDocument) => doc.uploadedAt?.getTime() ?? 0

// Smart column width calculation utility with responsive breakpoints
const calculateOptimalColumnWidths = (containerWidth: number, readOnly: boolean = false) => {
  // Responsive breakpoints
  const isMobile = containerWidth < 768;
  const isTablet = containerWidth >= 768 && containerWidth < 1024;
  const isDesktop = containerWidth >= 1024;

  // Mobile layout - optimized for small screens
  if (isMobile) {
    const UPLOAD_DATE_WIDTH = 75;  // Shorter date format
    const STATUS_WIDTH = 65;       // Compact status
    const ACTIONS_WIDTH = 35;      // Smaller icons
    const PADDING_BUFFER = 15;     // Minimal padding

    const fixedWidths = UPLOAD_DATE_WIDTH + STATUS_WIDTH +
      (readOnly ? 0 : ACTIONS_WIDTH) + PADDING_BUFFER;
    const availableForName = containerWidth - fixedWidths;
    const nameWidth = Math.max(120, Math.min(250, availableForName > 0 ? availableForName : 120));

    return {
      name: nameWidth,
      uploadDate: UPLOAD_DATE_WIDTH,
      status: STATUS_WIDTH,
      actions: ACTIONS_WIDTH
    };
  }

  // Tablet layout - balanced approach
  if (isTablet) {
    const UPLOAD_DATE_WIDTH = 105; // Better date width
    const STATUS_WIDTH = 85;       // Better status width
    const ACTIONS_WIDTH = 48;      // Standard icons
    const PADDING_BUFFER = 25;     // Balanced padding

    const fixedWidths = UPLOAD_DATE_WIDTH + STATUS_WIDTH +
      (readOnly ? 0 : ACTIONS_WIDTH) + PADDING_BUFFER;
    const availableForName = containerWidth - fixedWidths;
    const nameWidth = Math.max(180, Math.min(350, availableForName > 0 ? availableForName * 0.65 : 180));

    return {
      name: nameWidth,
      uploadDate: UPLOAD_DATE_WIDTH,
      status: STATUS_WIDTH,
      actions: ACTIONS_WIDTH
    };
  }

  // Desktop layout - maximum readability
  const UPLOAD_DATE_WIDTH = 120; // Give date more breathing room
  const STATUS_WIDTH = 90;       // Slightly wider for status
  const ACTIONS_WIDTH = 50;      // Standard action button
  const PADDING_BUFFER = 40;     // Add some padding back
  const MIN_NAME_WIDTH = 200;    // Reasonable minimum
  const MAX_NAME_WIDTH = 400;    // Prevent excessive width

  // Calculate fixed space requirements
  const fixedWidths = UPLOAD_DATE_WIDTH + STATUS_WIDTH +
    (readOnly ? 0 : ACTIONS_WIDTH) + PADDING_BUFFER;

  // Calculate available space for name column (can be negative on very small widths)
  const availableForName = containerWidth - fixedWidths;

  // Allocate up to 60% of the free space to the name column to prevent excessive gaps
  const targetNameWidth = availableForName > 0 ? Math.min(availableForName * 0.6, MAX_NAME_WIDTH) : MIN_NAME_WIDTH;

  // Clamp within bounds
  const nameWidth = Math.max(MIN_NAME_WIDTH, targetNameWidth);

  return {
    name: nameWidth,
    uploadDate: UPLOAD_DATE_WIDTH,
    status: STATUS_WIDTH,
    actions: ACTIONS_WIDTH
  };
};

// Debounce utility for resize events
const useDebounce = (callback: Function, delay: number) => {
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  return React.useCallback((...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
};

// Smart name formatting for better display
const formatDocumentName = (filename: string, maxWidth: number): { displayName: string; shouldShowTooltip: boolean } => {
  const maxChars = Math.floor(maxWidth / 8); // Approximate chars per pixel

  if (filename.length <= maxChars) {
    return { displayName: filename, shouldShowTooltip: false };
  }

  // For very long names, try to preserve the extension
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex > 0 && filename.length - lastDotIndex <= 5) {
    const extension = filename.substring(lastDotIndex);
    const nameWithoutExt = filename.substring(0, lastDotIndex);

    if (nameWithoutExt.length > maxChars - extension.length - 3) {
      const truncatedName = nameWithoutExt.substring(0, maxChars - extension.length - 3);
      return {
        displayName: `${truncatedName}...${extension}`,
        shouldShowTooltip: true
      };
    }
  }

  // Standard truncation with ellipsis
  return {
    displayName: `${filename.substring(0, maxChars - 3)}...`,
    shouldShowTooltip: true
  };
};

export function DocumentDashboard({
  disabled,
  isActive,
  className,
  readOnly = false,
  tooltip,
  onProcessingStart,
  onProcessingComplete,
  onProcessingError,
  onDelete
}: DocumentDashboardProps) {
  const { t } = useLanguage()
  const [isDragging, setIsDragging] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [storedDocuments, setStoredDocuments] = React.useState<ProcessedDocument[]>([])
  const [activeTab, setActiveTab] = React.useState(readOnly ? "stored" : "upload")
  const [isTabSwitching, setIsTabSwitching] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [showSkeleton, setShowSkeleton] = React.useState(false)
  const [deletingDocIds, setDeletingDocIds] = React.useState<string[]>([])
  const [updatingUrlDocId, setUpdatingUrlDocId] = React.useState<string | null>(null)

  // Hybrid approach: smart automatic sizing + manual resize override
  // Start with a reasonable default that works well for most screens
  const [containerWidth, setContainerWidth] = React.useState(800)
  const [manualNameColumnWidth, setManualNameColumnWidth] = React.useState<number | null>(null) // null = use auto calculation
  const [isResizing, setIsResizing] = React.useState(false)
  const [initialX, setInitialX] = React.useState(0)
  const [initialWidth, setInitialWidth] = React.useState(0)

  const tableRef = React.useRef<HTMLDivElement>(null)
  const tableContainerRef = React.useRef<HTMLDivElement>(null)
  const dividerRef = React.useRef<HTMLDivElement>(null)
  const processingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const refreshIntervalRef = React.useRef<NodeJS.Timeout | null>(null)
  const skeletonTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  const [isDeleteInProgress, setIsDeleteInProgress] = React.useState(false);
  const [showUpload, setShowUpload] = React.useState(false);
  const [open, setOpen] = React.useState(false)
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Check if Nango connectors are enabled
  const isNangoEnabled = process.env.NEXT_PUBLIC_NANGO_ENABLED === 'true';

  // Check if Firecrawl scraper is enabled
  // Dynamic Firecrawl Config
  const { config: firecrawlConfig } = useFirecrawlConfig();

  // Use hook config or fallback to environment variables for initial render
  const isFirecrawlEnabled = firecrawlConfig
    ? (firecrawlConfig.isEnabled && firecrawlConfig.showOnDashboard)
    : (process.env.NEXT_PUBLIC_FIRECRAWL_ENABLED === 'true' && process.env.NEXT_PUBLIC_WEB_SCRAPER_SHOW_ON_DASHBOARD !== 'false');

  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';


  // Get connector configuration
  const { config: connectorConfig } = useConnectorConfig();

  // Get current workspace context for multi-tenant document uploads
  const { currentOrganization, isPersonalMode } = useOrganizationStore();

  // Track visibility of the dashboard so we can ignore bogus ResizeObserver events
  const [isVisible, setIsVisible] = React.useState(true)
  // Cache the last non-zero width so it can be restored when the tab becomes visible again
  const lastValidWidthRef = React.useRef<number>(800)
  // Track if we've done initial width calculation
  const hasInitializedWidth = React.useRef(false)

  // Calculate optimal column widths based on container size
  const autoColumnWidths = React.useMemo(() => {
    // Use a stable default width if not initialized
    const effectiveWidth = hasInitializedWidth.current ? containerWidth : 800;
    return calculateOptimalColumnWidths(effectiveWidth, readOnly);
  }, [containerWidth, readOnly]);

  // Dynamically estimate width needed for the longest filename using
  // real pixel measurement instead of crude character counts to avoid
  // huge gaps for narrow glyphs. We measure once per storedDocuments
  // change or when the user resizes (containerWidth).
  const dynamicNameWidth = React.useMemo(() => {
    if (storedDocuments.length === 0) return 350; // Default that prevents layout shift

    // Create a canvas context once to measure text widths.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // Fallback to previous heuristic if canvas unavailable
      const longestNameLength = Math.max(...storedDocuments.map(d => d.name.length));
      return Math.min(420, Math.max(120, longestNameLength * 7 + 32));
    }

    // Match the CSS used in the table: font-medium text-sm => 14px/Inter (default)
    ctx.font = '500 14px Inter, system-ui, sans-serif';

    let maxWidth = 0;
    storedDocuments.forEach(doc => {
      const metrics = ctx.measureText(doc.name);
      maxWidth = Math.max(maxWidth, metrics.width);
    });

    // Add padding + icon spacing (approx. 40px) and clamp
    return Math.min(400, Math.max(250, Math.ceil(maxWidth) + 40));
  }, [storedDocuments]);

  // Use manual width if set; otherwise use dynamic content width capped by auto calculation
  const activeNameColumnWidth = manualNameColumnWidth ?? Math.min(Math.max(dynamicNameWidth, 200), autoColumnWidths.name);

  const columnWidths = React.useMemo(() => ({
    ...autoColumnWidths,
    name: activeNameColumnWidth
  }), [autoColumnWidths, activeNameColumnWidth]);

  // Debounced resize handler to prevent excessive re-calculations
  const debouncedSetContainerWidth = useDebounce((width: number) => {
    setContainerWidth(width);
  }, 150);

  // Container width detection with ResizeObserver
  React.useEffect(() => {
    if (!tableContainerRef.current) return;

    // -------------------------------------------------------------
    // 1) Observe visibility – many browsers fire a 0-width resize
    //    when the parent Tab is display:none which broke our layout.
    //    We use IntersectionObserver to know when the dashboard is
    //    actually visible on screen and only accept resize events
    //    once it is. A small 50 ms debounce is applied after the
    //    element becomes visible so the browser has time to paint.
    // -------------------------------------------------------------

    let visibilityTimeout: NodeJS.Timeout | null = null;
    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      if (entry.isIntersecting) {
        // Became visible – allow width updates after a tiny delay
        if (visibilityTimeout) clearTimeout(visibilityTimeout)
        visibilityTimeout = setTimeout(() => {
          setIsVisible(true)
          // Restore the last good width immediately to avoid flicker
          if (lastValidWidthRef.current > 20 && hasInitializedWidth.current) {
            setContainerWidth(lastValidWidthRef.current)
          }
        }, 50)
      } else {
        // Hidden – stop reacting to ResizeObserver widths
        if (visibilityTimeout) clearTimeout(visibilityTimeout)
        setIsVisible(false)
      }
    }, { root: null, threshold: 0 })

    intersectionObserver.observe(tableContainerRef.current)

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;

      const width = entry.contentRect.width;

      // Ignore resize events while hidden, zero-ish widths, or during tab switching.
      if (!isVisible || width <= 20 || isTabSwitching) return;

      // Persist good width so we can restore it when the tab hides/shows.
      lastValidWidthRef.current = width;
      hasInitializedWidth.current = true;

      debouncedSetContainerWidth(width);
    });

    observer.observe(tableContainerRef.current);

    // Set initial width with a delay to ensure proper rendering
    setTimeout(() => {
      if (tableContainerRef.current) {
        const initialWidth = tableContainerRef.current.getBoundingClientRect().width;
        if (initialWidth > 20) {
          lastValidWidthRef.current = initialWidth;
          setContainerWidth(initialWidth);
        }
      }
    }, 100);

    return () => {
      if (visibilityTimeout) clearTimeout(visibilityTimeout)
      observer.disconnect();
      intersectionObserver.disconnect();
    };
  }, [debouncedSetContainerWidth, isVisible, isTabSwitching]);

  // Force stored tab when in read-only mode
  React.useEffect(() => {
    if (readOnly && activeTab !== "stored") {
      setActiveTab("stored");
    }
  }, [readOnly, activeTab]);

  // Effect to manage skeleton loader delay
  React.useEffect(() => {
    if (isLoading) {
      // Only show skeleton after 300ms to avoid flash for fast loads
      skeletonTimeoutRef.current = setTimeout(() => {
        setShowSkeleton(true);
      }, 300);
    } else {
      // Clear skeleton immediately when loading is done
      setShowSkeleton(false);
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
    }

    return () => {
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
    };
  }, [isLoading]);

  // Effect to manage processing state timeout
  React.useEffect(() => {
    // If we start processing, set a safety timeout to reset the state after 3 minutes
    // This prevents the UI from being stuck in processing state if something goes wrong
    if (isProcessing) {
      processingTimeoutRef.current = setTimeout(() => {
        setIsProcessing(false);
        // Update any documents still in processing state to failed
        setStoredDocuments(prev =>
          prev.map(doc =>
            doc.status === 'processing'
              ? { ...doc, status: 'failed' }
              : doc
          )
        );
      }, 45 * 60 * 1000); // 45 minutes timeout
    } else if (processingTimeoutRef.current) {
      // Clear timeout if we're no longer processing
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, [isProcessing]);

  // Fetch stored documents on mount and when workspace changes
  React.useEffect(() => {
    let isMounted = true; // Add mounted check

    async function fetchDocuments() {
      if (!isMounted) return; // Skip if not mounted

      try {
        setIsLoading(true)
        // Build URL with organization context
        const orgId = isPersonalMode ? 'null' : (currentOrganization?.id || 'null');
        const response = await fetch(`/api/documents?organization_id=${orgId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch documents')
        }

        if (!isMounted) return; // Check again before updating state

        const data: DocumentsApiResponse = await response.json()

        // Only replace documents that aren't currently processing
        // This prevents removing "processing" documents when data is refreshed
        setStoredDocuments(prev => {
          const processingDocs = prev.filter(doc => doc.status === 'processing');
          const newDocs = data.documents.map(mapApiDocumentToProcessed);

          // Keep all processing docs - they'll either complete or timeout
          // Only update processing docs that now appear in the database
          const updatedProcessingDocs = processingDocs.map(pDoc => {
            const matchingNewDoc = newDocs.find((nDoc: { name: string }) => nDoc.name === pDoc.name);
            if (matchingNewDoc) {
              // Document has been processed successfully
              return matchingNewDoc;
            }
            // Keep as processing - let timeout handle failure
            return pDoc;
          });

          // Filter out newDocs that were already in processing
          const genuinelyNewDocs = newDocs.filter(
            nDoc => !processingDocs.some(pDoc => pDoc.name === nDoc.name)
          );

          // Combine and sort by date
          return [...updatedProcessingDocs, ...genuinelyNewDocs].sort(
            (a, b) => getUploadTimestamp(b) - getUploadTimestamp(a)
          );
        });
      } catch (error) {
        console.error('Error fetching documents:', error)
        if (isMounted) { // Only call callback if mounted
          onProcessingError?.(error as Error)
        }
      } finally {
        if (isMounted) { // Only update state if mounted
          setIsLoading(false)
        }
      }
    }

    fetchDocuments();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [currentOrganization?.id, isPersonalMode]) // Re-fetch when workspace changes

  // Function to refresh documents manually
  const refreshDocuments = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const orgId = isPersonalMode ? 'null' : (currentOrganization?.id || 'null');
      const response = await fetch(`/api/documents?organization_id=${orgId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data: DocumentsApiResponse = await response.json();

      // Same logic as in useEffect but as a callback
      setStoredDocuments(prev => {
        const processingDocs = prev.filter(doc => doc.status === 'processing');
        const newDocs = data.documents.map(mapApiDocumentToProcessed);

        // Keep all processing docs - they'll either complete or timeout
        // Only update processing docs that now appear in the database
        const updatedProcessingDocs = processingDocs.map(pDoc => {
          const matchingNewDoc = newDocs.find((nDoc: { name: string }) => nDoc.name === pDoc.name);
          if (matchingNewDoc) {
            // Document has been processed successfully
            return matchingNewDoc;
          }
          // Keep as processing - let timeout handle failure
          return pDoc;
        });

        // Filter out newDocs that were already in processing
        const genuinelyNewDocs = newDocs.filter(
          nDoc => !processingDocs.some(pDoc => pDoc.name === nDoc.name)
        );

        // Combine and sort by date
        return [...updatedProcessingDocs, ...genuinelyNewDocs].sort(
          (a, b) => getUploadTimestamp(b) - getUploadTimestamp(a)
        );
      });
    } catch (error) {
      console.error('Error refreshing documents:', error);
      onProcessingError?.(error as Error);
    } finally {
      setIsLoading(false);
    }
  }, [onProcessingError, currentOrganization?.id, isPersonalMode]);

  // Add automatic refresh for processing documents
  React.useEffect(() => {
    // Check if there are any documents in processing status
    const hasProcessingDocuments = storedDocuments.some(doc => doc.status === 'processing');

    // If there are processing documents, set up an interval to refresh
    if (hasProcessingDocuments && !refreshIntervalRef.current) {
      // Refresh every 5 seconds while documents are processing
      refreshIntervalRef.current = setInterval(() => {
        refreshDocuments();
      }, 5000);
    }
    // If there are no more processing documents, clear the interval
    else if (!hasProcessingDocuments && refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [storedDocuments, refreshDocuments]);

  const filteredDocuments = storedDocuments.filter((doc) => doc.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    const documentFiles = droppedFiles.filter(
      (file) => SUPPORTED_DOC_TYPES.includes(file.type)
    )

    setFiles((prev) => [...prev, ...documentFiles])
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files)
      const validFiles = selectedFiles.filter(file => {
        if (!SUPPORTED_DOC_TYPES.includes(file.type)) {
          onProcessingError?.(new Error('Unsupported file type'))
          return false
        }
        if (file.size > MAX_FILE_SIZE) {
          onProcessingError?.(new Error('File size exceeds 10MB limit'))
          return false
        }
        return true
      })
      setFiles((prev) => [...prev, ...validFiles])
    }
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpload = React.useCallback(async () => {
    console.log('[DocumentDashboard] handleUpload called, files:', files.length);
    console.log('[DocumentDashboard] isMultiTenant:', isMultiTenant());
    console.log('[DocumentDashboard] isPersonalMode:', isPersonalMode);
    console.log('[DocumentDashboard] currentOrganization:', currentOrganization?.id);

    if (files.length === 0) {
      console.log('[DocumentDashboard] No files selected, returning');
      return;
    }

    // First, create the processing documents
    const newDocs = files.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      text: '',
      type: file.name.split('.').pop() as 'pdf' | 'doc' | 'docx' | 'txt' | 'pptx' | 'xlsx' | 'html' | 'rtf' | 'epub',
      uploadedAt: new Date(),
      status: 'processing' as const
    }));

    // Immediately update UI state BEFORE starting any uploads
    // Add new documents to the beginning of the list for better visibility
    setStoredDocuments(prev => [...newDocs, ...prev]);

    // Switch to stored documents tab immediately for better UX feedback
    setActiveTab("stored");

    // Set processing state
    setIsProcessing(true);

    // Process documents sequentially (one by one)
    for (const doc of newDocs) {
      const file = files.find(f => f.name === doc.name);
      if (!file) {
        continue;
      }

      try {
        onProcessingStart?.(file.name);

        const formData = new FormData();
        formData.append('file', file);

        // Add organization context for multi-tenant mode
        // If no organization selected (personal workspace mode), omit organization_id
        // This will save to flat personal workspace (user_id, org_id=NULL)
        if (isMultiTenant() && !isPersonalMode && currentOrganization) {
          formData.append('organization_id', currentOrganization.id);
          console.log('[DocumentDashboard] Added organization_id to formData:', currentOrganization.id);
        } else {
          console.log('[DocumentDashboard] Personal workspace mode, no organization_id added');
        }
        console.log('[DocumentDashboard] Sending POST to /api/process-document for file:', file.name);
        const response = await fetch('/api/process-document', {
          method: 'POST',
          body: formData,
        });
        console.log('[DocumentDashboard] Response status:', response.status);
        const result = await response.json();

        if (!response.ok) {
          let errorMessage = result.error || 'Unknown error occurred';

          // Special handling for timeout errors
          if (response.status === 504 || errorMessage.includes('timed out') || errorMessage.includes('taking longer')) {
            errorMessage = 'Document processing is taking longer than expected. Please try with a smaller document or try again later.';
          }

          throw new Error(errorMessage);
        }

        if (result.error) {
          throw new Error(result.error);
        }

        // Update document status to ready using original temporary ID
        setStoredDocuments(prev => {
          return prev.map(d =>
            d.id === doc.id
              ? {
                ...d,
                id: result.id, // Replace with server-generated ID
                status: 'ready',
                // Update additional fields that may have changed
                pages: result.pages,
                text: result.text || d.text,
                // Add a flag for partial success if chunks were partially processed
                partialSuccess: result.successfulChunks !== undefined &&
                  result.totalChunks !== undefined &&
                  result.successfulChunks < result.totalChunks
              }
              : d
          );
        });

        onProcessingComplete?.({
          ...doc,
          id: result.id,
          status: 'ready',
          pages: result.pages,
          text: result.text || doc.text,
          partialSuccess: result.successfulChunks !== undefined &&
            result.totalChunks !== undefined &&
            result.successfulChunks < result.totalChunks
        });
      } catch (error) {
        console.error('[DocumentDashboard] Error processing document:', error);
        console.error('[DocumentDashboard] Error details:', error instanceof Error ? error.message : String(error));
        // Update document status to failed
        setStoredDocuments(prev => prev.map(d =>
          d.id === doc.id
            ? {
              ...d,
              status: 'failed',
              // Store the error message for potential display
              error: error instanceof Error ? error.message : 'Unknown error'
            }
            : d
        ));
        onProcessingError?.(error as Error);
      }
    }

    // All documents processed, clean up
    setIsProcessing(false);
    setFiles([]);

    // Check if any documents failed
    const failedCount = storedDocuments.filter(doc =>
      newDocs.some(newDoc => newDoc.id === doc.id && doc.status === 'failed')
    ).length;

    if (failedCount > 0) {
      console.warn(`${failedCount} document(s) failed to process.`);
    }
  }, [files, onProcessingStart, onProcessingComplete, onProcessingError, setActiveTab, storedDocuments, currentOrganization?.id, isPersonalMode]);

  // Create a function to handle tab switching with better visual feedback
  const handleTabChange = (tab: string) => {
    // Don't allow switching to upload tab in read-only mode
    if (readOnly && tab === "upload") return;

    // Set tab switching flag to prevent resize calculations
    setIsTabSwitching(true);

    // Update tab state
    setActiveTab(tab);

    // Reset tab switching flag after a delay
    setTimeout(() => {
      setIsTabSwitching(false);
    }, 100);
  };

  // Update the Upload button to show processing state
  const uploadButtonContent = isProcessing ? (
    <>
      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      Processing
    </>
  ) : (
    "Upload"
  );

  const handleDelete = async (id: string) => {
    try {
      // Add document ID to the deleting list to show spinner
      setDeletingDocIds(prev => [...prev, id]);

      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      setStoredDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch (error) {
      console.error('Error deleting document:', error);
      onProcessingError?.(error as Error);
    } finally {
      // Remove document ID from deleting list when done
      setDeletingDocIds(prev => prev.filter(docId => docId !== id));
    }
  }



  const deleteDocument = async (id: string) => {
    try {
      setIsDeleteInProgress(true);
      await handleDelete(id);
      // No need to update state here as handleDelete already does this
    } catch (error) {
      console.error('Error deleting document:', error);
      onProcessingError?.(error as Error);
    } finally {
      setIsDeleteInProgress(false);
    }
  };

  // URL management functions
  const updateDocumentUrl = async (docId: string, url: string) => {
    try {
      setUpdatingUrlDocId(docId);

      const response = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ external_url: url }),
      });

      if (!response.ok) {
        throw new Error('Failed to update document URL');
      }

      // Update local state
      setStoredDocuments(prev =>
        prev.map(doc =>
          doc.id === docId ? { ...doc, external_url: url } : doc
        )
      );
    } catch (error) {
      console.error('Error updating document URL:', error);
      onProcessingError?.(error as Error);
    } finally {
      setUpdatingUrlDocId(null);
    }
  };

  const handleAddUrl = async (doc: ProcessedDocument) => {
    const currentUrl = doc.external_url || '';
    const url = prompt(
      currentUrl ? 'Edit document URL:' : 'Add document URL:',
      currentUrl
    );

    if (url === null) {
      // User cancelled
      return;
    }

    // Validate URL if not empty
    if (url.trim() !== '') {
      try {
        new URL(url.trim());
      } catch (e) {
        alert('Please enter a valid URL (must start with http:// or https://)');
        return;
      }
    }

    await updateDocumentUrl(doc.id, url.trim());
  };

  // Add handler for clicks outside the dialog
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't close if clicking inside a nested dialog (e.g., FolderPicker)
      if (target.closest('[role="dialog"]') && !dialogRef.current?.contains(target)) {
        return;
      }

      // Don't close if clicking inside a Radix popper (dropdowns, selects)
      if (target.closest('[data-radix-popper-content-wrapper]')) {
        return;
      }

      if (open &&
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      // Add slight delay to avoid immediate closing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);

    // Reset width calculation state when dialog opens
    if (newOpen) {
      // Small delay to let the dialog render before calculating widths
      setTimeout(() => {
        hasInitializedWidth.current = false;
        if (tableContainerRef.current) {
          const width = tableContainerRef.current.getBoundingClientRect().width;
          if (width > 20) {
            lastValidWidthRef.current = width;
            setContainerWidth(width);
            hasInitializedWidth.current = true;
          }
        }
      }, 50);
    }
  };

  // Manual resize handlers for the name column
  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setInitialX(e.clientX);
    setInitialWidth(activeNameColumnWidth);

    // Add resizing class to body for better cursor control
    document.body.classList.add('resizing');
  };

  // Reset to auto-calculated width (double-click functionality)
  const handleResetToAuto = () => {
    setManualNameColumnWidth(null);
  };

  // Use rAF throttling for smoother drag
  let resizeRafId: number | null = null;
  const handleResize = (e: MouseEvent) => {
    if (!isResizing) return;

    if (resizeRafId) cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      // Calculate width change based on movement from initial point
      const diff = e.clientX - initialX;
      const newWidth = Math.max(120, Math.min(600, initialWidth + diff)); // Reasonable bounds
      setManualNameColumnWidth(newWidth);
    });
  };

  React.useEffect(() => {
    const handleResizeStop = () => {
      setIsResizing(false);
      document.body.classList.remove('resizing');
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', handleResizeStop);
    }

    return () => {
      document.removeEventListener('mousemove', handleResize);
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      document.body.classList.remove('resizing');
    };
  }, [isResizing, initialX, initialWidth]);

  // Effect to sync divider height with scroll content
  React.useEffect(() => {
    const updateDividerHeight = () => {
      if (tableRef.current && dividerRef.current) {
        // Get the scroll height of the table container
        const scrollHeight = tableRef.current.scrollHeight;
        dividerRef.current.style.height = `${scrollHeight}px`;
      }
    };

    // Initial update
    updateDividerHeight();

    // Create observer to watch for table content changes
    const resizeObserver = new ResizeObserver(() => {
      updateDividerHeight();
    });

    // Observe the table container
    if (tableRef.current) {
      resizeObserver.observe(tableRef.current);
    }

    // Clean up
    return () => {
      if (tableRef.current) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  // Handle scroll sync for divider
  const handleTableScroll = React.useCallback(() => {
    if (dividerRef.current && tableRef.current) {
      dividerRef.current.style.top = `${-tableRef.current.scrollTop}px`;
    }
  }, []);

  // Add scroll event listener
  React.useEffect(() => {
    const tableEl = tableRef.current;
    if (tableEl) {
      tableEl.addEventListener('scroll', handleTableScroll);
    }
    return () => {
      if (tableEl) {
        tableEl.removeEventListener('scroll', handleTableScroll);
      }
    };
  }, [handleTableScroll]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {tooltip ? (
        <PortalTooltip content={tooltip}>
          <DialogTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => { }}
              disabled={disabled || isProcessing}
              className={cn(
                "dropdown-trigger",
                className,
                !className && "inline-flex h-9 w-9 items-center justify-center rounded-xl p-2 transition-colors",
                !className && (isActive
                  ? "bg-white dark:bg-[#1A1A1A] hover:bg-[#FFE0D0] dark:hover:bg-[#212121] text-gray-900 dark:text-white border border-[#333333] dark:border-0"
                  : "bg-[#FFF0E8] dark:bg-[#212121] hover:bg-white dark:hover:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 border border-[#333333] dark:border-0"),
                (disabled || isProcessing) && "opacity-50 cursor-not-allowed"
              )}
              style={{
                backgroundColor: open && !className ? (isDarkMode ? '#2E2E2E' : '#FFE8DC') : undefined
              }}
            >
              <HardDriveUpload className="h-5 w-5" />
            </button>
          </DialogTrigger>
        </PortalTooltip>
      ) : (
        <DialogTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => { }}
            disabled={disabled || isProcessing}
            className={cn(
              "dropdown-trigger",
              className,
              !className && "inline-flex h-9 w-9 items-center justify-center rounded-xl p-2 transition-colors",
              !className && (isActive
                ? "bg-white dark:bg-[#1A1A1A] hover:bg-[#FFE0D0] dark:hover:bg-[#212121] text-gray-900 dark:text-white border border-[#333333] dark:border-0"
                : "bg-[#FFF0E8] dark:bg-[#212121] hover:bg-white dark:hover:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 border border-[#333333] dark:border-0"),
              (disabled || isProcessing) && "opacity-50 cursor-not-allowed"
            )}
            style={{
              backgroundColor: open && !className ? (isDarkMode ? '#2E2E2E' : '#FFE8DC') : undefined
            }}
          >
            <HardDriveUpload className="h-5 w-5" />
          </button>
        </DialogTrigger>
      )}

      <DialogContent
        ref={dialogRef}
        className="max-w-[calc(100vw-1rem)] sm:max-w-[800px] max-h-[85vh] w-full flex flex-col bg-[#FFF1E5] dark:bg-[#212121] rounded-xl document-dialog mx-auto"
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="relative w-full h-full flex flex-col">
          {/* Custom close button with inline styles and important classes to ensure correct positioning */}
          <DialogPrimitive.Close
            style={{ position: 'absolute', right: '0.125rem', top: '0.125rem', zIndex: 100 }}
            className="!absolute !right-0.5 !top-0.5 rounded-full p-2 bg-[#FFE0D0] dark:bg-[#2A2A2A] text-gray-700 dark:text-gray-100 hover:bg-[#FF6417] dark:hover:bg-[#FF8A4D] hover:text-white dark:hover:text-white shadow-md transition-all duration-200 focus:outline-none cursor-pointer w-8 h-8 flex items-center justify-center lg:w-7 lg:h-7"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
            <span className="sr-only">{t('closeSidebar')}</span>
          </DialogPrimitive.Close>

          <DialogHeader className="px-3 md:px-6 pt-6 pb-2">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {readOnly ? t('documentViewer') : t('documentManagement')}
            </DialogTitle>
            {readOnly && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t('readOnlyMode')}
              </p>
            )}
          </DialogHeader>

          <Tabs
            defaultValue={readOnly ? "stored" : "upload"}
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col px-3 md:px-6 pb-6"
          >
            <TabsList
              className={cn(
                "grid w-full bg-[#FFE0D0] dark:bg-[#2A2A2A] p-1 text-gray-600 dark:text-gray-400",
                readOnly
                  ? "grid-cols-1"
                  : (isNangoEnabled && connectorConfig?.feature_enabled && connectorConfig?.show_on_dashboard && isFirecrawlEnabled)
                    ? "grid-cols-2 gap-1" // 4 tabs: 2x2 grid layout
                    : (isNangoEnabled && connectorConfig?.feature_enabled && connectorConfig?.show_on_dashboard)
                      ? "grid-cols-3"
                      : isFirecrawlEnabled
                        ? "grid-cols-3"
                        : "grid-cols-2"
              )}
              style={
                (isNangoEnabled && connectorConfig?.feature_enabled && connectorConfig?.show_on_dashboard && isFirecrawlEnabled)
                  ? {
                    display: 'grid',
                    height: 'auto',
                    gridTemplateRows: 'auto auto',
                    alignContent: 'start',
                    alignItems: 'stretch',
                    padding: '4px 4px 0px 4px'
                  }
                  : {
                    height: 'auto',
                    padding: '4px'
                  }
              }>
              {!readOnly ? (
                <>
                  <TabsTrigger
                    value="upload"
                    className="data-[state=active]:bg-[#FF6417] dark:data-[state=active]:bg-[#FF6417] data-[state=active]:text-white dark:data-[state=active]:text-white text-sm px-3 h-9"
                  >
                    {t('uploadNew')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="stored"
                    className="data-[state=active]:bg-[#FF6417] dark:data-[state=active]:bg-[#FF6417] data-[state=active]:text-white dark:data-[state=active]:text-white text-sm px-3 h-9"
                  >
                    {t('storedDocuments')}
                  </TabsTrigger>
                  {(demoMode || (isNangoEnabled && connectorConfig?.feature_enabled && connectorConfig?.show_on_dashboard)) && (
                    <TabsTrigger
                      value="connectors"
                      className="data-[state=active]:bg-[#FF6417] dark:data-[state=active]:bg-[#FF6417] data-[state=active]:text-white dark:data-[state=active]:text-white text-sm px-3 h-9"
                    >
                      {t('connectors') || 'Connectors'}
                    </TabsTrigger>
                  )}
                  {(demoMode || isFirecrawlEnabled) && (
                    <TabsTrigger
                      value="scraper"
                      className="data-[state=active]:bg-[#FF6417] dark:data-[state=active]:bg-[#FF6417] data-[state=active]:text-white dark:data-[state=active]:text-white text-sm px-3 h-9"
                    >
                      Web Scraper
                    </TabsTrigger>
                  )}
                </>
              ) : (
                <TabsTrigger
                  value="stored"
                  className="data-[state=active]:bg-[#FF6417] dark:data-[state=active]:bg-[#FF6417] data-[state=active]:text-white dark:data-[state=active]:text-white col-span-2"
                >
                  {t('documents')}
                </TabsTrigger>
              )}
            </TabsList>

            <div className="mt-1">
              {!readOnly && (
                <TabsContent value="upload" className="h-[320px]">
                  <div className="flex flex-col h-full space-y-3">
                    <Card
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={cn(
                        "transition-all duration-200 bg-[#FFF0E8] dark:bg-[#1A1A1A] group border-2 border-dashed flex-shrink-0",
                        !files.length && "h-[280px]",
                        files.length && "h-[120px]",
                        isDragging
                          ? "border-[#FF6417] dark:border-[#2A2A2A] bg-[#FFF0E8]/80 dark:bg-[#212121]"
                          : "border-[#FF6417]/50 dark:border-[#2A2A2A] hover:bg-[#FFF0E8]/80 dark:hover:bg-[#212121]/50",
                      )}
                    >
                      <CardContent className={cn(
                        "flex flex-col items-center justify-center h-full transition-all duration-200",
                        !files.length ? "gap-6 p-3" : "gap-2 py-4 px-3",
                      )}>
                        <div
                          className={cn(
                            "rounded-full bg-[#FFE0D0] dark:bg-[#212121] ring-2 ring-offset-2 transition-all duration-200",
                            !files.length ? "p-3" : "p-1.5",
                            isDragging
                              ? "ring-[#FF6417] dark:ring-[#2A2A2A] ring-offset-white/20 dark:ring-offset-[#1A1A1A]"
                              : "ring-[#FF6417] dark:ring-[#2A2A2A] ring-offset-[#FFF0E8] dark:ring-offset-[#1A1A1A] group-hover:ring-[#FF6417] dark:group-hover:ring-[#2A2A2A]",
                          )}
                        >
                          <FileUp className={cn(
                            "text-gray-700 dark:text-gray-400 transition-all duration-200",
                            !files.length ? "h-5 w-5" : "h-3.5 w-3.5"
                          )} />
                        </div>
                        <div className="text-center space-y-1">
                          <p className={cn(
                            "font-medium leading-none text-gray-900 dark:text-white transition-all duration-200",
                            !files.length ? "text-lg" : "text-sm"
                          )}>{t('dragDropDocuments')}</p>
                          <p className={cn(
                            "text-gray-600 dark:text-gray-400 transition-all duration-200",
                            !files.length ? "text-base" : "text-xs"
                          )}>{t('supportedFileTypes')}</p>
                        </div>
                        <label
                          htmlFor="file-upload"
                          className={cn(
                            "inline-flex cursor-pointer rounded-full font-medium text-white dark:text-white ring-1 ring-[#FF6417] dark:ring-[#3A3A3A] bg-[#FF6417] dark:bg-[#212121] hover:bg-[#E05A15] dark:hover:bg-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 transition-all duration-200",
                            !files.length ? "px-4 py-2 text-base" : "px-2.5 py-0.5 text-xs"
                          )}
                        >
                          {t('selectFiles')}
                          <input
                            id="file-upload"
                            name="file-upload"
                            type="file"
                            className="sr-only"
                            multiple
                            accept=".pdf,.doc,.docx,.pptx,.xlsx,.html,.txt,.rtf,.epub"
                            onChange={handleFileInput}
                            disabled={disabled || isProcessing}
                          />
                        </label>
                      </CardContent>
                    </Card>

                    {files.length > 0 && (
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex-1 border rounded-lg border-[#FFE0D0] dark:border-[#2A2A2A] bg-[#FFF0E8] dark:bg-[#212121] max-h-[140px]">
                          <ScrollArea
                            className="h-full [&_[data-radix-scroll-area-thumb]]:bg-[#FF6417]/50 dark:[&_[data-radix-scroll-area-thumb]]:bg-gray-400/50 [&_[data-radix-scroll-area-thumb]]:rounded-full"
                            type="always"
                          >
                            <div>
                              {files.map((file, index) => (
                                <div
                                  key={index}
                                  className="group flex items-center justify-between px-4 py-2 hover:bg-white/50 dark:hover:bg-[#212121]"
                                >
                                  <div className="grid gap-0.5 min-w-0 flex-1 mr-2">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{file.name}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 flex-shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white dark:hover:bg-[#212121]"
                                    onClick={() => removeFile(index)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-gray-600 dark:text-gray-400" />
                                    <span className="sr-only">Remove file</span>
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>

                        <div className="flex justify-end pt-3 h-[40px] items-center">
                          <Button
                            className="rounded-full bg-[#FF6417] font-medium text-white hover:bg-[#E05A15] dark:bg-[#212121] dark:text-white dark:hover:bg-[#1A1A1A] px-6 dark:border dark:border-[#3A3A3A]"
                            size="sm"
                            disabled={isProcessing}
                            onClick={handleUpload}
                          >
                            {uploadButtonContent}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}

              {/* URL Scraper Tab */}
              {!readOnly && isFirecrawlEnabled && (
                <TabsContent value="scraper" className="h-[320px]">
                  <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#FFE0D0] [&::-webkit-scrollbar-track]:dark:bg-[#2A2A2A] [&::-webkit-scrollbar-thumb]:bg-[#FF6417]/50 [&::-webkit-scrollbar-thumb]:dark:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                      <UrlScraper
                        organizationId={isMultiTenant() && !isPersonalMode && currentOrganization ? currentOrganization.id : null}
                        onComplete={refreshDocuments}
                      />
                    </div>
                  </div>
                </TabsContent>
              )}

              <TabsContent value="stored" className="h-[320px]">
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-4 mb-2 h-[48px]">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={t('searchDocuments')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-[#FFF0E8] dark:bg-[#1A1A1A] border-[#FFE0D0] dark:border-[#2A2A2A] text-gray-900 dark:text-white placeholder-gray-600 dark:placeholder-gray-500"
                      />
                    </div>
                  </div>

                  <div
                    ref={tableContainerRef}
                    className="flex-1 border border-[#FFE0D0] dark:border-[#2A2A2A] bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg overflow-hidden"
                  >
                    <div className="relative h-full">
                      {/* Resizable column divider - hidden for now */}
                      <div ref={tableRef} className="h-full overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#FFE0D0] [&::-webkit-scrollbar-track]:dark:bg-[#2A2A2A] [&::-webkit-scrollbar-thumb]:bg-[#FF6417]/50 [&::-webkit-scrollbar-thumb]:dark:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                        <Table className="w-full">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-4 pr-3" style={{ maxWidth: '450px' }}>
                                {t('docName')}
                              </TableHead>
                              <TableHead className="pl-2 pr-2 whitespace-nowrap" style={{ width: '110px' }}>
                                {t('uploadDate')}
                              </TableHead>
                              <TableHead className="pl-2 pr-2 whitespace-nowrap" style={{ width: '80px' }}>
                                {t('docStatus')}
                              </TableHead>
                              {!readOnly && (
                                <TableHead className="text-center px-1" style={{ width: '90px' }}>
                                  <span className="sr-only">Actions</span>
                                </TableHead>
                              )}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {showSkeleton ? (
                              // Show skeleton loaders while loading (after delay to avoid flash)
                              <>
                                {[...Array(5)].map((_, index) => (
                                  <TableRow key={`skeleton-${index}`} className="h-14 animate-pulse-subtle">
                                    <TableCell className="pl-4 pr-3">
                                      <div className="h-4 bg-[#FFE0D0] dark:bg-[#2A2A2A] rounded w-3/4 opacity-60"></div>
                                    </TableCell>
                                    <TableCell className="pl-2 pr-2">
                                      <div className="h-4 bg-[#FFE0D0] dark:bg-[#2A2A2A] rounded w-16 opacity-60"></div>
                                    </TableCell>
                                    <TableCell className="pl-2 pr-2">
                                      <div className="h-4 bg-[#FFE0D0] dark:bg-[#2A2A2A] rounded w-12 opacity-60"></div>
                                    </TableCell>
                                    {!readOnly && (
                                      <TableCell className="text-center px-1">
                                        <div className="h-7 w-7 bg-[#FFE0D0] dark:bg-[#2A2A2A] rounded mx-auto opacity-60"></div>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                ))}
                              </>
                            ) : filteredDocuments.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={readOnly ? 3 : 4} className="h-[200px] text-center text-gray-700 dark:text-gray-300">
                                  {t('noDocumentsFound')}
                                </TableCell>
                              </TableRow>
                            ) : (
                              filteredDocuments.map((doc) => (
                                <TableRow key={doc.id} className="table-row-hover h-14 hover:bg-[#FFF0E8]/50 dark:hover:bg-[#212121]/50 transition-colors">
                                  <TableCell className="pl-4 pr-3" style={{ maxWidth: '450px' }}>
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 min-w-0">
                                        {(() => {
                                          const { displayName, shouldShowTooltip } = formatDocumentName(doc.name, columnWidths.name);
                                          const nameElement = (
                                            <div
                                              className={cn(
                                                "font-medium text-sm text-gray-900 dark:text-white",
                                                shouldShowTooltip ? "cursor-help" : "cursor-default"
                                              )}
                                              style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                              }}
                                            >
                                              {displayName}
                                            </div>
                                          );

                                          return shouldShowTooltip ? (
                                            <PortalTooltip content={doc.name} align="left">
                                              {nameElement}
                                            </PortalTooltip>
                                          ) : (
                                            nameElement
                                          );
                                        })()}
                                        {doc.status === "failed" && doc.error && (
                                          <div
                                            className="text-xs mt-1 text-red-500 truncate cursor-help"
                                            title={`${t('errorPrefix')} ${doc.error}`}
                                            style={{}}
                                          >
                                            {t('errorPrefix')} {doc.error}
                                          </div>
                                        )}
                                        {doc.source_provider === 'firecrawl' && (
                                          <div
                                            className="mt-1 inline-flex max-w-full items-center rounded border border-[#FF6417]/30 bg-[#FFF0E8] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-[#B54708] dark:border-[#3A3A3A] dark:bg-[#212121] dark:text-[#FFB38A]"
                                            title={doc.source_file_id || doc.external_url || 'Firecrawl'}
                                          >
                                            Firecrawl
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="pl-2 pr-2 whitespace-nowrap" style={{ width: '110px' }}>
                                    <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                      {doc.uploadedAt ? format(new Date(doc.uploadedAt), 'MMM dd') : ''}
                                    </div>
                                  </TableCell>
                                  <TableCell className="pl-2 pr-2 whitespace-nowrap" style={{ width: '80px' }}>
                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                      <div className="flex -space-x-1 overflow-hidden flex-shrink-0">
                                        {doc.status === "processing" && (
                                          <div className="h-2.5 w-2.5 rounded-full bg-[#38BDF8] dark:bg-blue-500 animate-pulse" />
                                        )}
                                        {doc.status === "failed" && (
                                          <div className="h-2.5 w-2.5 rounded-full bg-[#F87171] dark:bg-red-500" />
                                        )}
                                        {doc.status === "ready" && (
                                          <>
                                            <div className="h-2.5 w-2.5 rounded-full bg-[#4ADE80] dark:bg-green-500" />
                                            {doc.partialSuccess && (
                                              <div className="h-2.5 w-2.5 rounded-full bg-[#FACC15] dark:bg-yellow-500 ml-0.5" title={t('documentProcessedWithPartialChunkSuccess')} />
                                            )}
                                          </>
                                        )}
                                      </div>
                                      <span className="text-xs font-medium capitalize text-gray-600 dark:text-gray-400 truncate">
                                        {doc.status === "ready"
                                          ? t('readyStatus')
                                          : doc.status === "processing"
                                            ? t('processingStatus')
                                            : doc.status === "failed"
                                              ? t('failedStatus')
                                              : t('partialStatus')}
                                        {doc.partialSuccess && doc.status === "ready" && " (" + t('partialStatus') + ")"}
                                      </span>
                                    </div>
                                  </TableCell>
                                  {!readOnly && (
                                    <TableCell className="text-center px-1" style={{ width: '90px' }}>
                                      <div className="flex items-center justify-center gap-1">
                                        {/* Globe icon for URL management */}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 flex-shrink-0"
                                          onClick={() => handleAddUrl(doc)}
                                          title={doc.external_url ? "Edit URL" : "Add URL"}
                                          disabled={updatingUrlDocId === doc.id}
                                        >
                                          {updatingUrlDocId === doc.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-700 dark:text-gray-300" />
                                          ) : (
                                            <Globe
                                              className={cn(
                                                "h-3.5 w-3.5 transition-colors",
                                                doc.external_url
                                                  ? "text-[#FF6417] hover:text-[#FF6417]/80"
                                                  : "text-gray-600 dark:text-gray-400 hover:text-[#FF6417]"
                                              )}
                                            />
                                          )}
                                          <span className="sr-only">{doc.external_url ? 'Edit URL' : 'Add URL'}</span>
                                        </Button>
                                        {/* Delete button */}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 flex-shrink-0"
                                          onClick={() => {
                                            if (window.confirm(t('confirmDeleteDocument'))) {
                                              deleteDocument(doc.id);
                                            }
                                          }}
                                          disabled={isDeleteInProgress}
                                        >
                                          {isDeleteInProgress ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-700 dark:text-gray-300" />
                                          ) : (
                                            <Trash2 className="h-3.5 w-3.5 text-gray-600 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" />
                                          )}
                                          <span className="sr-only">{t('deleteDocument')}</span>
                                        </Button>
                                      </div>
                                    </TableCell>
                                  )}
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {isNangoEnabled && connectorConfig?.feature_enabled && connectorConfig?.show_on_dashboard && (
                <TabsContent value="connectors" className="h-[320px]">
                  <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#FFE0D0] [&::-webkit-scrollbar-track]:dark:bg-[#2A2A2A] [&::-webkit-scrollbar-thumb]:bg-[#FF6417]/50 [&::-webkit-scrollbar-thumb]:dark:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                      <ConnectorGrid
                        onConnectionChange={() => {
                          // Refresh documents when a new connection is made
                          refreshDocuments();
                        }}
                      />
                    </div>
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
        </div>
      </DialogContent>

      <style jsx global>{`
        .h-14 {
          height: 3.5rem !important;
          max-height: 3.5rem !important;
          min-height: 3.5rem !important;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
        }
        
        /* Control table row height */
        table tr {
          height: 3.5rem;
        }
        
        /* Reduce cell padding */
        table td {
          padding-top: 0.5rem;
          padding-bottom: 0.5rem;
          padding-left: 0.5rem;
          padding-right: 0.5rem;
        }
        
        /* Optimize table header padding */
        table th {
          padding-top: 0.75rem;
          padding-bottom: 0.75rem;
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          text-align: left;
        }
        
        /* Compact table layout */
        table {
          table-layout: auto;
          width: 100%;
        }
        
        /* Name column - constrain to content */
        table td:first-child,
        table th:first-child {
          width: 1px;
          white-space: nowrap;
          max-width: 450px;
        }
        
        /* Force other columns to stay minimal */
        table td:not(:first-child),
        table th:not(:first-child) {
          width: 1px;
          white-space: nowrap;
        }
        
        .table-row-hover {
          height: 3.5rem;
        }
        
        .document-dialog {
          background-color: #FFF1E5 !important; 
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          margin: 1rem auto !important;
          max-height: calc(100vh - 2rem) !important;
        }
        
        .dark .document-dialog {
          background-color: #212121 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          margin: 1rem auto !important;
          max-height: calc(100vh - 2rem) !important;
        }
        
        /* Responsive margin adjustments */
        @media (min-width: 640px) {
          .document-dialog,
          .dark .document-dialog {
            margin: 2rem auto !important;
            max-height: calc(100vh - 4rem) !important;
          }
        }
        
        /* Ensure centering on all screen sizes */
        @media (max-width: 639px) {
          .document-dialog,
          .dark .document-dialog {
            margin-left: auto !important;
            margin-right: auto !important;
            width: calc(100vw - 2rem) !important;
            max-width: calc(100vw - 2rem) !important;
          }
        }
        
        /* Prevent table from expanding unnecessarily */
        .table-auto {
          table-layout: auto;
        }
        
        /* Responsive column adjustments */
        @media (max-width: 640px) {
          .table-auto {
            font-size: 0.875rem;
          }
          
          .optimized-name-container {
            min-width: 150px;
          }
        }
        
        @media (min-width: 1200px) {
          .optimized-name-container {
            min-width: 300px;
          }
        }
        
        /* Resizable column divider */
        .resize-column-divider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 4px;
          background-color: rgba(230, 230, 230, 0.6);
          cursor: col-resize;
          z-index: 10;
          transition: background-color 0.2s;
          height: 100%;
        }
        
        .resize-column-divider:hover,
        .resize-column-divider.active {
          background-color: #FF6417;
          width: 6px;
        }
        
        .dark .resize-column-divider {
          background-color: rgba(60, 60, 60, 0.6);
        }
        
        .dark .resize-column-divider:hover,
        .dark .resize-column-divider.active {
          background-color: #3A3A3A;
        }
        
        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }
        
        body.resizing * {
          user-select: none !important;
        }
        
        /* Smooth transitions for column width changes */
        .table-fixed th,
        .table-fixed td {
          transition: width 0.2s ease-in-out;
        }
        
        /* Better text truncation with ellipsis */
        .truncate {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        /* Subtle row hover effect - matching dashboard colors */
        .table-row-hover:hover {
          background-color: rgba(255, 240, 232, 0.5); /* FFF0E8 at 50% opacity */
        }
        
        .dark .table-row-hover:hover {
          background-color: rgba(33, 33, 33, 0.5); /* 212121 at 50% opacity */
        }
        
        /* Prevent text from breaking in fixed-width columns */
        .whitespace-nowrap {
          white-space: nowrap;
        }
        
        /* Enhanced cursor help for interactive elements */
        .cursor-help:hover {
          cursor: help;
        }
      `}</style>
    </Dialog>
  );
}
