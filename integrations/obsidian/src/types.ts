export type BkemoNote = {
  portableId: string;
  revision: number;
  type: number;
  content: string;
  isArchived: boolean;
  isRecycle?: boolean;
  dueDate: string | null;
  isImportant: boolean;
  isUrgent: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source?: string;
  tags?: Array<{ portableId: string; name: string }>;
  attachments?: BkemoAttachment[];
};

export type BkemoAttachment = {
  portableId: string;
  name: string;
  size: number;
  type: string;
  path?: string;
  createdAt?: string;
};

export type NotePage = {
  notes: BkemoNote[];
  nextCursor: string | null;
};

export type ChangeBatch = {
  cursor: number;
  hasMore: boolean;
  changed: BkemoNote[];
  removedPortableIds: string[];
};

export type SearchInput = {
  query?: string;
  tag?: string;
  tasksOnly?: boolean;
  archived?: 'exclude' | 'only' | 'include';
  limit?: number;
  cursor?: string | null;
};

export type CreateNoteInput = {
  content: string;
  task?: boolean;
  attachmentPortableIds?: string[];
  idempotencyKey: string;
};

export type ConditionalUpdateInput = {
  portableId: string;
  expectedRevision: number;
  content?: string;
  idempotencyKey: string;
};

export type AudioUploadInput = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  durationSeconds?: number;
  idempotencyKey: string;
};

export type BkemoClientError = {
  code: string;
  message: string;
};

export interface BkemoClient {
  search(input: SearchInput): Promise<NotePage>;
  getNote(portableId: string): Promise<BkemoNote>;
  createNote(input: CreateNoteInput): Promise<BkemoNote>;
  updateNote(input: ConditionalUpdateInput): Promise<BkemoNote>;
  uploadAudio(input: AudioUploadInput): Promise<BkemoAttachment>;
  readChanges(cursor: number): Promise<ChangeBatch>;
  listTags(): Promise<Array<{ portableId: string; name: string; icon?: string | null }>>;
}
