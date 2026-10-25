import {
  UIMessage,
  type UIMessagePart,
  type FileUIPart,
  type ToolUIPart,
  type UITools,
  getToolName,
  isDataUIPart,
  isToolUIPart,
} from 'ai';

type AppDataTypes = {
  'content-part': ContentPart;
};

export interface Attachment {
  url: string;
  name?: string;
  contentType?: string;
}

export interface DocumentContent {
  type:
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'txt'
  | 'pptx'
  | 'xlsx'
  | 'html'
  | 'rtf'
  | 'epub';
  name: string;
  text: string;
  pages?: number;
  extractedImages?: {
    url: string;
    pageNumber?: number;
  }[];
  id?: string;
  chunks?: Array<{
    content: string;
    embedding: number[];
  }>;
  successfulChunks?: number;
  totalChunks?: number;
}

export interface SourceImageData {
  name: string;
  size: number;
  type: string;
  url: string;
}

export interface ContentPart {
  type:
  | 'text'
  | 'image_url'
  | 'document'
  | 'generated_image'
  | 'generated_video'
  | 'loading_video'
  | 'loading_image'
  | 'generated_3d_model'
  | 'loading_3d_model'
  | 'document_reference'
  | 'tool_result'
  | 'tool-result'  // Alternate hyphenated form
  | 'metadata'
  | 'tool_call'
  | 'tool-call'    // Alternate hyphenated form
  | 'tool_calls'
  | 'source_images'
  | 'html_content'
  | 'thinking';
  text?: string;
  content?: string; // Used in thinking/reasoning parts
  reasoningText?: string; // Used in thinking parts
  image_url?: {
    url: string;
  };
  document?: DocumentContent;
  generated_images?: string[];
  video_url?: string;
  generated_videos?: string[];
  model_url?: string;
  id?: string;
  progress?: number;
  aspectRatio?: string;
  resolution?: string;
  frameCount?: number;
  status?: string;
  textureSize?: number;
  meshSimplify?: number;
  ssSamplingSteps?: number;
  texturedMesh?: boolean;
  octreeResolution?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  prompt?: string;
  count?: number;
  total?: number;
  result?: DocumentQueryResult | unknown; // Can be any tool result
  tool?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  providerExecuted?: boolean;
  state?: string;
  isError?: boolean; // Error indicator for tool results
  url?: string; // URL for generated images, html content etc
  sourceImageUrl?: string; // Source image URL for image editing
  images?: SourceImageData[]; // Alternative images array
  documents?: Array<{
    id: string;
    name: string;
    filename?: string;
    text?: string;
    created_at?: string;
    uploadedAt?: string;
  }>;
  usedDocuments?: Array<{
    id: string;
    name: string;
    filename?: string;
    similarity?: number;
    content_preview?: string;
    created_at?: string;
    matched_chunk?: string;
    uploadedAt?: string;
    explicitly_referenced?: boolean;
  }>;
  source_images?: SourceImageData[];
  [key: string]: unknown;
}

export interface DocumentQueryResult {
  documents: Array<{
    id: string;
    name: string;
    filename?: string;
    text?: string;
    created_at?: string;
    uploadedAt?: string;
  }>;
}

export interface ExtendedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
  createdAt?: Date;
  name?: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
  multiStepMetadata?: any;
}

export interface APIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
  name?: string;
  attachments?: Attachment[];
}

export interface DBMessage {
  id: string;
  content: string | ContentPart[];
  role: 'user' | 'assistant' | 'system' | 'data';
  name?: string;
  createdAt?: Date;
  attachments?: Attachment[];
}

interface AppMessageMetadata {
  name?: string;
  createdAt?: string;
  attachments?: Attachment[];
  legacyContentFormat?: 'string' | 'array';
  [key: string]: unknown;
}

export function toAPIMessage(message: ExtendedMessage): APIMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.name && { name: message.name }),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments }
      : {}),
  };
}

export function toMessage(message: ExtendedMessage): UIMessage<AppMessageMetadata, AppDataTypes> {
  return {
    id: message.id,
    role: message.role,
    metadata: buildMetadata(message),
    parts: buildUIPartsFromExtended(message),
  };
}

export function toMessages(messages: ExtendedMessage[]): UIMessage<AppMessageMetadata, AppDataTypes>[] {
  return messages.map(toMessage);
}

export function toDBMessages(messages: ExtendedMessage[]): DBMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role === 'system' ? 'data' : (msg.role as 'user' | 'assistant' | 'data'),
    content: msg.content,
    createdAt: msg.createdAt,
    ...(msg.name && { name: msg.name }),
    ...(msg.attachments && msg.attachments.length > 0
      ? { attachments: msg.attachments }
      : {}),
  }));
}

export function toExtendedMessage(message: DBMessage): ExtendedMessage {
  const role = message.role === 'data' ? 'system' : (message.role as 'user' | 'assistant' | 'system');

  return {
    id: message.id,
    role,
    content: message.content,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    ...(message.name && { name: message.name }),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments }
      : {}),
  };
}

export function toExtendedMessages(messages: DBMessage[]): ExtendedMessage[] {
  return messages.map(toExtendedMessage);
}

export function fromDBMessages(messages: DBMessage[]): ExtendedMessage[] {
  return toExtendedMessages(messages);
}

export function fromUIMessage(message: UIMessage<AppMessageMetadata, AppDataTypes>): ExtendedMessage {
  const metadata = message.metadata ?? {};
  const attachments: Attachment[] = Array.isArray(metadata.attachments)
    ? [...metadata.attachments]
    : [];
  const contentParts: ContentPart[] = [];
  const textParts: ContentPart[] = [];

  for (const part of message.parts) {
    const converted = convertUIPartToContent(part, attachments);
    if (!converted) {
      continue;
    }

    // Check for array first to properly narrow the type
    if (Array.isArray(converted)) {
      for (const nested of converted) {
        if (nested.type === 'text') {
          textParts.push(nested);
        } else {
          contentParts.push(nested);
        }
      }
    } else if (converted.type === 'text') {
      textParts.push(converted);
    } else {
      contentParts.push(converted);
    }
  }

  const combinedParts: ContentPart[] = [];
  if (textParts.length > 0) {
    combinedParts.push(...mergeAdjacentTextParts(textParts));
  }
  combinedParts.push(...contentParts);

  const legacyFormat: 'string' | 'array' =
    (metadata.legacyContentFormat as 'string' | 'array') ||
    (typeof message.metadata?.legacyContentFormat === 'string'
      ? (message.metadata.legacyContentFormat as 'string' | 'array')
      : 'array');

  let content: string | ContentPart[];
  if (legacyFormat === 'string' && combinedParts.length === 1 && combinedParts[0].type === 'text') {
    content = combinedParts[0].text ?? '';
  } else if (combinedParts.length === 1 && combinedParts[0].type === 'text') {
    content = combinedParts[0].text ?? '';
  } else {
    content = combinedParts;
  }

  const createdAt =
    typeof metadata.createdAt === 'string' ? new Date(metadata.createdAt) : undefined;

  const extended: ExtendedMessage = {
    id: message.id,
    role: message.role,
    content,
    ...(metadata.name && { name: metadata.name as string }),
    ...(createdAt && { createdAt }),
    ...(attachments.length > 0 ? { attachments } : {}),
  };

  const remainingMetadata = { ...metadata };
  delete remainingMetadata.createdAt;
  delete remainingMetadata.attachments;
  delete remainingMetadata.name;
  delete remainingMetadata.legacyContentFormat;

  if (Object.keys(remainingMetadata).length > 0) {
    extended.metadata = remainingMetadata;
  }

  return extended;
}

export function fromUIMessages(messages: UIMessage<AppMessageMetadata, AppDataTypes>[]): ExtendedMessage[] {
  return messages.map(fromUIMessage);
}

export function fromAPIMessage(message: APIMessage, index: number): ExtendedMessage {
  return {
    id: message.name ? `${message.name}-${index}` : `api-${index}`,
    role: message.role,
    content: message.content,
    ...(message.name && { name: message.name }),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments }
      : {}),
  };
}

export function fromAPIMessages(messages: APIMessage[]): ExtendedMessage[] {
  return messages.map((message, index) => fromAPIMessage(message, index));
}

export function updateMessages(messages: ExtendedMessage[], message: ExtendedMessage): ExtendedMessage[] {
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.id === 'streaming') {
    return [...messages.slice(0, -1), message];
  }
  return [...messages, message];
}

export function appendMessage(messages: ExtendedMessage[], message: ExtendedMessage): ExtendedMessage[] {
  return [...messages, message];
}

function buildMetadata(message: ExtendedMessage): AppMessageMetadata {
  const metadata: AppMessageMetadata = {};

  if (message.name) {
    metadata.name = message.name;
  }

  if (message.createdAt) {
    metadata.createdAt = message.createdAt.toISOString();
  }

  if (message.attachments && message.attachments.length > 0) {
    metadata.attachments = message.attachments;
  }

  metadata.legacyContentFormat = typeof message.content === 'string' ? 'string' : 'array';

  if (message.metadata && Object.keys(message.metadata).length > 0) {
    Object.assign(metadata, message.metadata);
  }

  return metadata;
}

function buildUIPartsFromExtended(
  message: ExtendedMessage,
): UIMessagePart<AppDataTypes, UITools>[] {
  const parts: UIMessagePart<AppDataTypes, UITools>[] = [];

  if (typeof message.content === 'string') {
    const text = message.content.trim();
    if (text.length > 0) {
      parts.push({ type: 'text', text });
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const uiPart = convertContentPartToUIPart(part);
      if (Array.isArray(uiPart)) {
        parts.push(...uiPart);
      } else if (uiPart) {
        parts.push(uiPart);
      }
    }
  }

  if (message.attachments) {
    for (const attachment of message.attachments) {
      const filePart: FileUIPart = {
        type: 'file',
        url: attachment.url,
        filename: attachment.name,
        mediaType: attachment.contentType ?? 'application/octet-stream',
      };
      parts.push(filePart);
    }
  }

  return parts;
}

function convertContentPartToUIPart(
  part: ContentPart,
): UIMessagePart<AppDataTypes, UITools> | UIMessagePart<AppDataTypes, UITools>[] | null {
  switch (part.type) {
    case 'text': {
      const text = part.text ?? '';
      if (text.trim().length === 0) {
        return null;
      }
      return { type: 'text', text };
    }
    case 'image_url': {
      const url = part.image_url?.url;
      if (!url) return null;
      return {
        type: 'file',
        url,
        mediaType: inferMediaTypeFromUrl(url) ?? 'image/*',
        filename: undefined,
      };
    }
    default:
      return {
        type: 'data-content-part',
        data: part,
      };
  }
}

function convertUIPartToContent(
  part: UIMessagePart<AppDataTypes, UITools>,
  attachments: Attachment[],
): ContentPart | ContentPart[] | null {
  if (part.type === 'text') {
    if (!part.text || part.text.length === 0) {
      return null;
    }
    return { type: 'text', text: part.text };
  }

  if (part.type === 'file') {
    const attachment: Attachment = {
      url: part.url,
      name: part.filename,
      contentType: part.mediaType,
    };
    attachments.push(attachment);

    if (part.mediaType?.startsWith('image/')) {
      return {
        type: 'image_url',
        image_url: { url: part.url },
      };
    }

    return {
      type: 'metadata',
      text: part.filename ?? part.url,
      url: part.url,
      mediaType: part.mediaType,
    } as ContentPart;
  }

  if (isDataUIPart<AppDataTypes>(part)) {
    return part.data;
  }

  if (isToolUIPart(part)) {
    // Type assertion needed because isToolUIPart can return DynamicToolUIPart
    // which has type 'dynamic-tool' instead of 'tool-${string}', but both have
    // compatible properties (toolCallId, toolName, input, output, state, etc.)
    return convertToolUIPartToContent(part as ToolUIPart<UITools>);
  }

  return {
    type: 'metadata',
    rawPart: part,
  } as ContentPart;
}

function convertToolUIPartToContent(part: ToolUIPart<UITools>): ContentPart[] {
  const toolName = getToolName(part);
  const base: ContentPart = {
    type: 'tool_call',
    toolCallId: part.toolCallId,
    toolName,
    args: part.input,
    input: part.input,
    providerExecuted: part.providerExecuted,
    state: part.state,
  };

  if (part.state === 'output-available' && part.output !== undefined) {
    const resultPart: ContentPart = {
      type: 'tool_result',
      toolCallId: part.toolCallId,
      toolName,
      output: part.output,
      result: Array.isArray(part.output) ? { documents: part.output } : part.output,
    };
    return [base, resultPart];
  }

  if (part.state === 'output-error') {
    base.errorText = part.errorText ?? 'Unknown tool error';
    return [base];
  }

  return [base];
}

function mergeAdjacentTextParts(parts: ContentPart[]): ContentPart[] {
  const merged: ContentPart[] = [];

  for (const part of parts) {
    if (merged.length === 0) {
      merged.push({ ...part });
      continue;
    }

    const last = merged[merged.length - 1];
    if (last.type === 'text' && part.type === 'text') {
      last.text = `${last.text ?? ''}${part.text ?? ''}`;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}

function inferMediaTypeFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.pdf')) return 'application/pdf';
    if (pathname.endsWith('.mp4')) return 'video/mp4';
  } catch {
    // ignore parsing errors
  }

  return undefined;
}
