import { ContentPart } from './chat';

export interface ExtendedFormEvent extends React.FormEvent<HTMLFormElement> {
  messageContent?: ContentPart | ContentPart[];
} 