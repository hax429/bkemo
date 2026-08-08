import type {
  AudioUploadInput,
  BkemoAttachment,
  BkemoClient,
  BkemoClientError,
  BkemoNote,
  ChangeBatch,
  ConditionalUpdateInput,
  CreateNoteInput,
  NotePage,
  SearchInput,
} from './types';

declare const BKEMO_DEV_ORIGIN: string;

/** Fixed production origin. Local O0 builds may inject BKEMO_DEV_ORIGIN. */
export const BKEMO_ORIGIN =
  (typeof BKEMO_DEV_ORIGIN !== 'undefined' && BKEMO_DEV_ORIGIN) || 'https://bk.hax429.me';

export class BkemoHttpClient implements BkemoClient {
  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly origin: string = BKEMO_ORIGIN,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw { code: 'unauthorized', message: 'Authentication required' } satisfies BkemoClientError;
    }
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Bkemo-Platform', 'obsidian');
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, { ...init, headers });
    } catch {
      throw { code: 'offline', message: 'Notes server unreachable' } satisfies BkemoClientError;
    }
    if (!response.ok) {
      let payload: BkemoClientError = { code: 'internal', message: 'Unexpected server error' };
      try {
        payload = await response.json() as BkemoClientError;
      } catch {
        /* keep default */
      }
      throw payload;
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async publicJson<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, init);
    } catch {
      throw { code: 'offline', message: 'Notes server unreachable' } satisfies BkemoClientError;
    }
    if (!response.ok) {
      throw await response.json() as BkemoClientError;
    }
    return await response.json() as T;
  }

  exchangePairingCode(code: string, deviceLabel = 'Obsidian'): Promise<{ token: string; preview: string }> {
    return this.publicJson('/api/v1/obsidian/pair/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel }),
    });
  }

  validateAccessToken(accessToken: string): Promise<{
    accountName: string;
    scopes: string[];
    preview: string;
    credentialKind: 'access-token';
  }> {
    return this.publicJson('/api/v1/obsidian/pair/access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
  }

  session(): Promise<{ accountName: string; scopes: string[]; credentialKind: 'access-token' | 'device' }> {
    return this.request('/api/v1/obsidian/session');
  }

  search(input: SearchInput): Promise<NotePage> {
    const params = new URLSearchParams();
    if (input.query) params.set('q', input.query);
    if (input.tag) params.set('tag', input.tag);
    if (input.tasksOnly) params.set('tasks', '1');
    if (input.archived) params.set('archived', input.archived);
    if (input.limit) params.set('limit', String(input.limit));
    if (input.cursor) params.set('cursor', input.cursor);
    const query = params.toString();
    return this.request<NotePage>(`/api/v1/obsidian/notes${query ? `?${query}` : ''}`);
  }

  getNote(portableId: string): Promise<BkemoNote> {
    return this.request<BkemoNote>(`/api/v1/obsidian/notes/${portableId}`);
  }

  createNote(input: CreateNoteInput): Promise<BkemoNote> {
    return this.request<BkemoNote>('/api/v1/obsidian/notes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateNote(input: ConditionalUpdateInput): Promise<BkemoNote> {
    return this.request<BkemoNote>(`/api/v1/obsidian/notes/${input.portableId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async uploadAudio(input: AudioUploadInput): Promise<BkemoAttachment> {
    const form = new FormData();
    form.set('file', input.blob, input.fileName);
    form.set('fileName', input.fileName);
    form.set('idempotencyKey', input.idempotencyKey);
    if (input.durationSeconds != null) form.set('durationSeconds', String(input.durationSeconds));
    return this.request<BkemoAttachment>('/api/v1/obsidian/audio', {
      method: 'POST',
      body: form,
    });
  }

  getAttachment(portableId: string): Promise<BkemoAttachment> {
    return this.request<BkemoAttachment>(`/api/v1/obsidian/attachments/${portableId}`);
  }

  async getAttachmentContent(portableId: string): Promise<Blob> {
    const token = await this.getToken();
    if (!token) {
      throw { code: 'unauthorized', message: 'Authentication required' } satisfies BkemoClientError;
    }
    let response: Response;
    try {
      response = await fetch(`${this.origin}/api/v1/obsidian/attachments/${portableId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw { code: 'offline', message: 'Notes server unreachable' } satisfies BkemoClientError;
    }
    if (!response.ok) {
      let payload: BkemoClientError = { code: 'internal', message: 'Unexpected server error' };
      try {
        payload = await response.json() as BkemoClientError;
      } catch {
        /* keep default */
      }
      throw payload;
    }
    return await response.blob();
  }

  readChanges(cursor: number): Promise<ChangeBatch> {
    return this.request<ChangeBatch>(`/api/v1/obsidian/changes?cursor=${cursor}`);
  }

  listTags(): Promise<Array<{ portableId: string; name: string; icon?: string | null }>> {
    return this.request('/api/v1/obsidian/tags');
  }

  getLinkEnrichment(input: { url: string; notePortableId?: string }): Promise<{
    id: string;
    url: string;
    title: string;
    description: string;
    markdown: string;
    archiveUrl: string;
    markdownStatus: string;
    archiveStatus: string;
    status: string;
    error: string;
  }> {
    const params = new URLSearchParams({ url: input.url });
    if (input.notePortableId) params.set('notePortableId', input.notePortableId);
    return this.request(`/api/v1/obsidian/link-enrichments?${params.toString()}`);
  }
}
