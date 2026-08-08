import type { BkemoAttachment } from '../types';

/** Tracks blob object URLs so authenticated previews can be revoked safely. */
export class ObjectUrlRegistry {
  private urls: string[] = [];

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  }

  revokeAll(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }

  get size(): number {
    return this.urls.length;
  }
}

export function attachmentKind(attachment: BkemoAttachment): 'audio' | 'image' | 'file' {
  const type = (attachment.type || '').toLowerCase();
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  return 'file';
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
