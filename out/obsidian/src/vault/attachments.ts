import { App, Notice, TFile } from 'obsidian';
import type { BkemoAttachment } from '../types';
import { attachmentVaultPath } from './attachmentPaths';
import { assertPathUnderRoot } from './frontmatter';

export { attachmentVaultPath } from './attachmentPaths';

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

export type CopyAttachmentResult =
  | { status: 'created'; path: string }
  | { status: 'replaced'; path: string }
  | { status: 'unchanged'; path: string };

/** Explicit Copy attachment — never called implicitly by Save to vault / Append. */
export async function copyAttachmentToVault(
  app: App,
  notePortableId: string,
  attachment: BkemoAttachment,
  blob: Blob,
  root = 'bkemo',
): Promise<CopyAttachmentResult> {
  const path = assertPathUnderRoot(
    attachmentVaultPath(notePortableId, attachment, root),
    root,
  );
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (parent) await ensureFolder(app, parent);

  const buffer = await blob.arrayBuffer();
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = await app.vault.readBinary(existing);
    if (current.byteLength === buffer.byteLength) {
      const same = new Uint8Array(current).every((byte, index) => byte === new Uint8Array(buffer)[index]);
      if (same) return { status: 'unchanged', path };
    }
    await app.vault.modifyBinary(existing, buffer);
    return { status: 'replaced', path };
  }
  if (existing) throw new Error('Attachment path is not a file');
  await app.vault.createBinary(path, buffer);
  return { status: 'created', path };
}

export function notifyCopyAttachment(result: CopyAttachmentResult): void {
  if (result.status === 'created') new Notice(`Copied attachment to ${result.path}`);
  else if (result.status === 'replaced') new Notice(`Updated attachment at ${result.path}`);
  else new Notice(`Attachment already at ${result.path}`);
}
