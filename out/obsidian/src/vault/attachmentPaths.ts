import type { BkemoAttachment } from '../types';
import { normalizeVaultRoot } from './frontmatter';

export function attachmentVaultPath(
  notePortableId: string,
  attachment: BkemoAttachment,
  root = 'bkemo',
): string {
  const safe = (attachment.name || 'attachment')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 180) || 'attachment';
  return `${normalizeVaultRoot(root)}/attachments/${notePortableId}/${safe}`;
}
