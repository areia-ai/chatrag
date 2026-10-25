import { type UIMessage } from 'ai';
import type { Attachment, ContentPart } from './chat';

export interface AppMessageMetadata {
  name?: string;
  createdAt?: string;
  attachments?: Attachment[];
  legacyContentFormat?: 'string' | 'array';
  [key: string]: unknown;
}

export type AppUIMessage = UIMessage<AppMessageMetadata>;

export type { Attachment, ContentPart };
