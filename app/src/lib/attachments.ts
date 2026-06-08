/**
 * Attachment upload + classification helpers for the bkemo composers/cards.
 *
 * Files upload via the multipart `/api/file/upload` Express route (which writes
 * the file AND creates the `attachments` row, account-scoped, `noteId` null).
 * On note save we pass the uploaded descriptors as `attachments` to
 * `note.upsert`, which links the existing rows to the note by `path`.
 */
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

export type UploadedAttachment = { path: string; name: string; type: string; size: number };

/** Upload one file; resolves to its stored descriptor. */
export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  const token = RootStore.Get(UserStore).token;
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(getBlinkoEndpoint('/api/file/upload'), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const data: any = await res.json();
  const path = data.filePath ?? data.path;
  if (!path) throw new Error('Upload returned no path');
  return {
    path,
    name: data.fileName ?? data.name ?? file.name,
    type: data.type ?? file.type ?? 'application/octet-stream',
    size: Number(data.size ?? file.size ?? 0),
  };
}

/** Build the full `attachmentsSchema`-shaped object `note.upsert` expects. */
export function toUpsertAttachment(u: UploadedAttachment) {
  const now = new Date();
  return {
    id: 0, isShare: false, sharePassword: '', name: u.name, path: u.path,
    size: u.size, noteId: null, accountId: null, createdAt: now, sortOrder: 0,
    updatedAt: now, type: u.type, depth: null, perfixPath: null,
  };
}

/** Authenticated URL for fetching/serving an attachment by its stored `path`. */
export function attachmentUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const token = RootStore.Get(UserStore).token;
  const sep = path.includes('?') ? '&' : '?';
  return getBlinkoEndpoint(`${path}${token ? `${sep}token=${token}` : ''}`);
}

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'file';

const EXT_IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic'];
const EXT_AUD = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'];
const EXT_VID = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];
const EXT_TXT = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yml', 'yaml', 'ts', 'js', 'py', 'css', 'html'];

export function attachmentKind(type?: string | null, name?: string): AttachmentKind {
  const t = (type ?? '').toLowerCase();
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (t.startsWith('image/') || EXT_IMG.includes(ext)) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (t.startsWith('audio/') || EXT_AUD.includes(ext)) return 'audio';
  if (t.startsWith('video/') || EXT_VID.includes(ext)) return 'video';
  if (t.startsWith('text/') || EXT_TXT.includes(ext)) return 'text';
  return 'file';
}

export const KIND_ICON: Record<AttachmentKind, string> = {
  image: '▣', pdf: '▦', audio: '♪', video: '▶', text: '≣', file: '◳',
};

export function humanSize(size?: number | string | null): string {
  const n = Number(size ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
