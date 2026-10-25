import { HardDriveUpload, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useFileUploadStore } from '@/lib/file-upload-store';
import { DocumentDashboard } from './document-dashboard';
import type { ProcessedDocument } from './document-dashboard';

export type { ProcessedDocument };
import { useLanguage } from '@/components/providers/language-provider';
import { useAdminStore } from '@/lib/admin-store';

export interface PermanentDocUploadButtonProps {
  disabled?: boolean;
  isActive?: boolean;
  className?: string;
  onProcessingStart?: (fileName: string) => void;
  onProcessingComplete?: (processedDoc: ProcessedDocument) => void;
  onProcessingError?: (error: Error) => void;
}

const SUPPORTED_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function PermanentDocUploadButton({ 
  disabled,
  isActive,
  className,
  onProcessingStart,
  onProcessingComplete,
  onProcessingError 
}: PermanentDocUploadButtonProps) {
  const { t } = useLanguage();
  const { isAdmin } = useAdminStore();
  
  // Check if document dashboard should be completely hidden
  const hideDocumentDashboard = process.env.NEXT_PUBLIC_HIDE_DOCUMENT_DASHBOARD === 'true';
  
  // If dashboard is hidden, don't show the button for anyone
  if (hideDocumentDashboard) {
    return null;
  }
  
  // Check environment variable for read-only document dashboard
  const readOnlyDocDashboardEnabled = process.env.NEXT_PUBLIC_READ_ONLY_DOCUMENTS_ENABLED === 'true';
  
  // Check if the dashboard should be shown in read-only mode
  // Always set to false for admins, regardless of environment setting
  const showReadOnly = !isAdmin && readOnlyDocDashboardEnabled;
  
  // If not admin and read-only mode is not enabled, don't show the button
  if (!isAdmin && !readOnlyDocDashboardEnabled) {
    return null;
  }
  
  return (
    <div className="relative">
      <DocumentDashboard
        disabled={disabled}
        isActive={isActive}
        className={cn(
          "flex items-center justify-center w-10 h-10 text-gray-700 dark:text-gray-200 bg-transparent hover:bg-[#FFE0D0] dark:bg-transparent dark:hover:bg-[#424242] transition-colors backdrop-blur-md rounded-lg"
        )}
        readOnly={showReadOnly}
        tooltip={isAdmin ? t('uploadDocument') : t('viewDocuments')}
        onProcessingStart={onProcessingStart}
        onProcessingComplete={onProcessingComplete}
        onProcessingError={onProcessingError}
      />
    </div>
  );
} 
