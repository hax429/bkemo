import { App, Notice, TFile, type Editor } from 'obsidian';
import type { BkemoNote } from '../types';
import { appendNoteToEditor } from './append';
import {
  assertPathUnderRoot,
  buildProjectionFrontmatter,
  defaultProjectionPath,
  normalizeVaultRoot,
  stripFrontmatter,
  wrapProjectionMarkdown,
} from './frontmatter';
import { contentHash } from './hash';

export type ProjectionMapEntry = { path: string; contentHash: string };
export type ProjectionMap = Record<string, ProjectionMapEntry>;

export type ProjectionResult =
  | { status: 'created'; path: string }
  | { status: 'exists'; path: string }
  | { status: 'refreshed'; path: string }
  | { status: 'blocked'; path: string; reason: string };

export type PushResult =
  | { status: 'pushed'; note: BkemoNote }
  | { status: 'conflict'; local: string; remote: BkemoNote }
  | { status: 'error'; message: string };

export interface ProjectionService {
  save(note: BkemoNote): Promise<ProjectionResult>;
  refresh(note: BkemoNote): Promise<ProjectionResult>;
  push(file: TFile): Promise<PushResult>;
  append(note: BkemoNote, editor: Editor): void;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) await app.vault.createFolder(current);
  }
}

async function openProjectionFile(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.workspace.getLeaf(false).openFile(file);
  }
}

export class VaultProjectionService implements ProjectionService {
  constructor(
    private readonly app: App,
    private readonly getRoot: () => string,
    private readonly getMap: () => ProjectionMap,
    private readonly setMap: (map: ProjectionMap) => void | Promise<void>,
  ) {}

  private root(): string {
    return normalizeVaultRoot(this.getRoot());
  }

  private async writeNoteFile(path: string, note: BkemoNote, hash: string): Promise<void> {
    const safePath = assertPathUnderRoot(path, this.root());
    const parent = safePath.includes('/') ? safePath.slice(0, safePath.lastIndexOf('/')) : '';
    if (parent) await ensureFolder(this.app, parent);
    const markdown = wrapProjectionMarkdown(buildProjectionFrontmatter(note, hash), note.content || '');
    const existing = this.app.vault.getAbstractFileByPath(safePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, markdown);
    } else if (existing) {
      throw new Error('Projection path is not a file');
    } else {
      await this.app.vault.create(safePath, markdown);
    }
    const map = { ...this.getMap(), [note.portableId]: { path: safePath, contentHash: hash } };
    await this.setMap(map);
  }

  private resolveExisting(note: BkemoNote): { path: string; file: TFile | null; entry?: ProjectionMapEntry } {
    const entry = this.getMap()[note.portableId];
    const path = entry?.path || defaultProjectionPath(note, this.root());
    const safePath = assertPathUnderRoot(path, this.root());
    const abstract = this.app.vault.getAbstractFileByPath(safePath);
    return {
      path: safePath,
      file: abstract instanceof TFile ? abstract : null,
      entry,
    };
  }

  private async isLocallyDirty(file: TFile, expectedHash?: string): Promise<boolean> {
    if (!expectedHash) return false;
    const raw = await this.app.vault.read(file);
    const body = stripFrontmatter(raw);
    const localHash = await contentHash(body);
    return localHash !== expectedHash;
  }

  async save(note: BkemoNote): Promise<ProjectionResult> {
    const { path, file, entry } = this.resolveExisting(note);
    if (file) {
      await openProjectionFile(this.app, path);
      return { status: 'exists', path };
    }
    const hash = await contentHash(note.content || '');
    await this.writeNoteFile(entry?.path || path, note, hash);
    await openProjectionFile(this.app, path);
    return { status: 'created', path };
  }

  async refresh(note: BkemoNote): Promise<ProjectionResult> {
    const { path, file, entry } = this.resolveExisting(note);
    if (file) {
      const expected = entry?.contentHash;
      if (await this.isLocallyDirty(file, expected)) {
        return {
          status: 'blocked',
          path,
          reason: 'Local changes differ from the last bkemo projection',
        };
      }
    }
    const hash = await contentHash(note.content || '');
    await this.writeNoteFile(path, note, hash);
    await openProjectionFile(this.app, path);
    return { status: file ? 'refreshed' : 'created', path };
  }

  async push(_file: TFile): Promise<PushResult> {
    return { status: 'error', message: 'Push arrives in O3' };
  }

  append(note: BkemoNote, editor: Editor): void {
    appendNoteToEditor(note, editor);
  }
}

/** @deprecated Kept for tests that only need frontmatter preview helpers. */
export function projectionFrontmatterPreview(note: BkemoNote, hash: string) {
  return buildProjectionFrontmatter(note, hash);
}

export function notifyProjectionResult(result: ProjectionResult): void {
  if (result.status === 'created') new Notice(`Saved to ${result.path}`);
  else if (result.status === 'exists') new Notice(`Already saved · opened ${result.path}`);
  else if (result.status === 'refreshed') new Notice(`Refreshed ${result.path}`);
  else new Notice(`Blocked: ${result.reason}`);
}
