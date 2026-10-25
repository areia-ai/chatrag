import { getNango } from './client';
import { type NangoFileRecord, type SupportedProvider, PROVIDER_CONFIG } from './types';
import { logger } from '@/lib/logger';

interface DownloadConfig {
  method: 'GET' | 'POST';
  endpoint: string;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
}

/**
 * Get provider-specific download configuration
 */
function getProviderDownloadConfig(
  provider: SupportedProvider,
  file: NangoFileRecord
): DownloadConfig {
  switch (provider) {
    case 'google-drive':
      return {
        method: 'GET',
        endpoint: `/drive/v3/files/${file.id}?alt=media`,
      };

    case 'dropbox':
      // Dropbox requires paths to start with '/'
      const dropboxPath = file.path || file.id;
      const formattedPath = dropboxPath.startsWith('/') ? dropboxPath : `/${dropboxPath}`;

      return {
        method: 'POST',
        endpoint: '/2/files/download',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({ path: formattedPath }),
        },
      };

    case 'box':
      return {
        method: 'GET',
        endpoint: `/2.0/files/${file.id}/content`,
      };

    case 'notion':
      // Notion pages need to be exported as markdown/HTML
      return {
        method: 'GET',
        endpoint: `/v1/blocks/${file.id}/children?page_size=100`,
      };

    case 'confluence':
      return {
        method: 'GET',
        endpoint: `/wiki/rest/api/content/${file.id}?expand=body.storage`,
      };

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Process Notion blocks into readable content
 */
function processNotionBlocks(blocks: unknown[]): string {
  const content: string[] = [];

  for (const block of blocks as Record<string, unknown>[]) {
    const blockType = block.type as string;
    const blockData = block[blockType] as Record<string, unknown> | undefined;

    if (!blockData) continue;

    // Handle rich text content
    if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
      const text = (blockData.rich_text as Array<{ plain_text?: string }>)
        .map((rt) => rt.plain_text || '')
        .join('');
      if (text) {
        content.push(text);
      }
    }

    // Handle specific block types
    switch (blockType) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        // Already handled by rich_text above
        break;
      case 'bulleted_list_item':
      case 'numbered_list_item':
        // Already handled by rich_text above
        break;
      case 'code':
        if (blockData.rich_text && Array.isArray(blockData.rich_text)) {
          const codeText = (blockData.rich_text as Array<{ plain_text?: string }>)
            .map((rt) => rt.plain_text || '')
            .join('');
          if (codeText) {
            content.push(`\`\`\`\n${codeText}\n\`\`\``);
          }
        }
        break;
    }
  }

  return content.join('\n\n');
}

/**
 * Process Confluence content
 */
function processConfluenceContent(data: Record<string, unknown>): string {
  const body = data.body as Record<string, unknown> | undefined;
  const storage = body?.storage as Record<string, unknown> | undefined;
  const value = storage?.value as string | undefined;

  if (!value) {
    return JSON.stringify(data);
  }

  // Basic HTML to text conversion (could be enhanced)
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch file content from a provider via Nango's proxy
 * The proxy automatically injects OAuth credentials
 */
export async function fetchFileContent(
  provider: string,
  connectionId: string,
  file: NangoFileRecord
): Promise<Buffer> {
  const nango = getNango();
  const config = getProviderDownloadConfig(provider as SupportedProvider, file);

  logger.debug('Nango', `Fetching file: ${file.name} from ${provider}`);

  try {
    // For Google Drive, we need to handle binary files specially
    if (provider === 'google-drive') {
      // Check if this is a Google Docs native format that needs export
      const isGoogleDoc = file.mime_type?.startsWith('application/vnd.google-apps.');

      let endpoint = config.endpoint;
      if (isGoogleDoc) {
        // Export Google Docs to appropriate format
        const exportMimeType = getGoogleDocsExportMimeType(file.mime_type || '');
        endpoint = `/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
        logger.debug('Nango', `Exporting Google Doc as ${exportMimeType}`);
      }

      // Use responseType for binary data
      const response = await nango.proxy({
        providerConfigKey: PROVIDER_CONFIG[provider as SupportedProvider]?.integrationId || provider,
        connectionId: connectionId,
        method: 'GET',
        endpoint: endpoint,
        retries: 3,
        responseType: 'arraybuffer', // Request binary response
      });

      // Detailed debugging of response
      const dataType = typeof response.data;
      const isBuffer = Buffer.isBuffer(response.data);
      const isArrayBuffer = response.data instanceof ArrayBuffer;
      const constructorName = response.data?.constructor?.name || 'unknown';
      const dataKeys = response.data && typeof response.data === 'object' ? Object.keys(response.data).slice(0, 10) : [];

      logger.debug('Nango', `Response details: type=${dataType}, isBuffer=${isBuffer}, isArrayBuffer=${isArrayBuffer}, constructor=${constructorName}`);
      logger.debug('Nango', `Response keys: ${dataKeys.join(', ') || 'none'}`);
      logger.debug('Nango', `Response status: ${response.status}, headers content-type: ${response.headers?.['content-type']}`);

      // Handle the response data - check all possible formats
      if (Buffer.isBuffer(response.data)) {
        logger.debug('Nango', `Got Buffer of ${response.data.length} bytes`);
        return response.data;
      }

      if (response.data instanceof ArrayBuffer) {
        const buffer = Buffer.from(response.data);
        logger.debug('Nango', `Converted ArrayBuffer to Buffer of ${buffer.length} bytes`);
        return buffer;
      }

      // If response.data is a Uint8Array or similar typed array
      if (response.data && typeof response.data === 'object' && 'buffer' in response.data) {
        const buffer = Buffer.from((response.data as { buffer: ArrayBuffer }).buffer);
        logger.debug('Nango', `Converted typed array to Buffer of ${buffer.length} bytes`);
        return buffer;
      }

      // Handle object with data property (some axios wrappers do this)
      if (response.data && typeof response.data === 'object' && 'data' in response.data) {
        const innerData = (response.data as { data: unknown }).data;
        if (Buffer.isBuffer(innerData)) {
          logger.debug('Nango', `Got nested Buffer of ${innerData.length} bytes`);
          return innerData;
        }
        if (innerData instanceof ArrayBuffer) {
          const buffer = Buffer.from(innerData);
          logger.debug('Nango', `Converted nested ArrayBuffer to Buffer of ${buffer.length} bytes`);
          return buffer;
        }
      }

      // Handle Node.js Buffer-like object with type and data
      if (response.data && typeof response.data === 'object' && 'type' in response.data && (response.data as { type: string }).type === 'Buffer' && 'data' in response.data) {
        const bufferData = (response.data as { type: string; data: number[] }).data;
        const buffer = Buffer.from(bufferData);
        logger.debug('Nango', `Converted Buffer-like object to Buffer of ${buffer.length} bytes`);
        return buffer;
      }

      // If it's a string (might be base64 encoded or binary)
      if (typeof response.data === 'string') {
        logger.debug('Nango', `Response is string of length ${response.data.length}`);
        // Check if it looks like base64
        if (/^[A-Za-z0-9+/]+=*$/.test(response.data.substring(0, 100))) {
          const buffer = Buffer.from(response.data, 'base64');
          logger.debug('Nango', `Decoded base64 string to Buffer of ${buffer.length} bytes`);
          return buffer;
        }
        // Try binary encoding for non-base64 strings
        const buffer = Buffer.from(response.data, 'binary');
        logger.debug('Nango', `Converted binary string to Buffer of ${buffer.length} bytes`);
        return buffer;
      }

      // If response.data has length property (array-like), try to convert
      if (response.data && typeof response.data === 'object' && 'length' in response.data) {
        try {
          const buffer = Buffer.from(response.data as ArrayLike<number>);
          logger.debug('Nango', `Converted array-like to Buffer of ${buffer.length} bytes`);
          return buffer;
        } catch (e) {
          logger.debug('Nango', `Failed to convert array-like to Buffer: ${e}`);
        }
      }

      // Log what we actually got for debugging
      logger.error('Nango', `Unexpected response data type: ${dataType}`, {
        constructor: constructorName,
        keys: dataKeys,
        sampleValue: response.data ? JSON.stringify(response.data).substring(0, 200) : 'null',
      });

      throw new Error(`Unexpected response format from Google Drive for file ${file.name}`);
    }

    // For Dropbox, use direct API call with Nango-managed OAuth token
    if (provider === 'dropbox') {
      logger.debug('Nango', `Dropbox file download using direct API: ${file.path}`);

      try {
        // Get the connection to extract the OAuth token
        const connection = await nango.getConnection(provider, connectionId);

        // Check if we have OAuth2 credentials
        if (!connection.credentials || connection.credentials.type !== 'OAUTH2') {
          throw new Error('Dropbox connection does not have OAuth2 credentials');
        }

        const accessToken = connection.credentials.access_token;
        if (!accessToken) {
          throw new Error('No access token available for Dropbox');
        }

        // Direct call to Dropbox API using the OAuth token
        const dropboxResponse = await fetch('https://content.dropboxapi.com/2/files/download', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: file.path || file.id }),
          },
        });

        if (!dropboxResponse.ok) {
          const errorText = await dropboxResponse.text();
          throw new Error(`Dropbox API error: ${dropboxResponse.status} ${dropboxResponse.statusText} - ${errorText}`);
        }

        const arrayBuffer = await dropboxResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        logger.debug('Nango', `Direct Dropbox download successful: ${buffer.length} bytes`);
        return buffer;

      } catch (error) {
        logger.error('Nango', `Dropbox file download failed for ${file.name}`, error);
        throw error;
      }
    }

    // Non-Google Drive, non-Dropbox providers
    const response = await nango.proxy({
      providerConfigKey: PROVIDER_CONFIG[provider as SupportedProvider]?.integrationId || provider,
      connectionId: connectionId,
      method: config.method,
      endpoint: config.endpoint,
      headers: config.headers,
      data: config.data,
      retries: 3,
    });

    // Handle different response types based on provider
    if (provider === 'notion') {
      // Notion returns blocks that need to be processed
      const blocks = response.data?.results || [];
      const content = processNotionBlocks(blocks);
      return Buffer.from(content, 'utf-8');
    }

    if (provider === 'confluence') {
      // Confluence returns HTML content
      const content = processConfluenceContent(response.data as Record<string, unknown>);
      return Buffer.from(content, 'utf-8');
    }

    // Handle binary responses
    if (Buffer.isBuffer(response.data)) {
      return response.data;
    }

    if (response.data instanceof ArrayBuffer) {
      return Buffer.from(response.data);
    }

    // Handle string responses
    if (typeof response.data === 'string') {
      return Buffer.from(response.data, 'utf-8');
    }

    // Handle wrapped content
    const data = response.data as Record<string, unknown>;
    if (data?.content) {
      return Buffer.from(data.content as string, 'utf-8');
    }

    // Fallback: stringify the response
    return Buffer.from(JSON.stringify(response.data), 'utf-8');
  } catch (error) {
    logger.error('Nango', `Failed to fetch file ${file.name}`, error);
    throw error;
  }
}

/**
 * Get the appropriate export MIME type for Google Docs native formats
 */
function getGoogleDocsExportMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'application/pdf'; // Export Google Docs as PDF
    case 'application/vnd.google-apps.spreadsheet':
      return 'application/pdf'; // Export Google Sheets as PDF
    case 'application/vnd.google-apps.presentation':
      return 'application/pdf'; // Export Google Slides as PDF
    default:
      return 'application/pdf';
  }
}
