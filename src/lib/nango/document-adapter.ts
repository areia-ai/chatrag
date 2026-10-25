import { processDocument } from '@/lib/document-processor';
import { logger } from '@/lib/logger';

/**
 * Options for processing documents with source tracking
 */
export interface ProcessDocumentOptions {
  userId: string;
  source?: 'upload' | 'nango';
  sourceProvider?: string;
  sourceFileId?: string;
  sourceConnectionId?: string;
}

/**
 * Process a document and store it with source metadata
 * This wraps the existing document processor to add Nango-specific metadata
 */
export async function processDocumentWithMetadata(
  filename: string,
  buffer: Buffer,
  options: ProcessDocumentOptions
): Promise<string> {
  logger.debug('Nango', `Processing document with metadata: ${filename}`);

  // Use the existing document processor with all metadata including user_id
  const documentId = await processDocument(filename, buffer, {
    user_id: options.userId,
    source: options.source || 'nango',
    source_provider: options.sourceProvider,
    source_file_id: options.sourceFileId,
    source_connection_id: options.sourceConnectionId,
  });

  logger.debug('Nango', `Processed document ${documentId} with source metadata`);
  return documentId;
}
