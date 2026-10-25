export interface Folder {
  id: string;
  user_id: string;
  name: string;
  color: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface FolderWithStats extends Folder {
  chat_count: number;
  last_updated: string | null;
}

export interface CreateFolderInput {
  name: string;
  color?: string;
  pinned?: boolean;
}

export interface UpdateFolderInput {
  name?: string;
  color?: string;
  pinned?: boolean;
}

export interface MoveChatToFolderInput {
  chat_ids: string[];
  folder_id: string | null;
}

export interface DeleteFolderInput {
  folder_id: string;
  delete_chats?: boolean;
}