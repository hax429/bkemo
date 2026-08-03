import type { Editor, TFile } from 'obsidian';
import type { BkemoNote } from '../types';
import { appendNoteToEditor } from './append';
import { buildProjectionFrontmatter, defaultProjectionPath } from './frontmatter';

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

/** O0 stub — vault writes land in O2. */
export class StubProjectionService implements ProjectionService {
  constructor(private readonly root: string) {}

  async save(note: BkemoNote): Promise<ProjectionResult> {
    return { status: 'exists', path: defaultProjectionPath(note, this.root) };
  }

  async refresh(note: BkemoNote): Promise<ProjectionResult> {
    return { status: 'refreshed', path: defaultProjectionPath(note, this.root) };
  }

  async push(_file: TFile): Promise<PushResult> {
    return { status: 'error', message: 'Push arrives in O3' };
  }

  append(note: BkemoNote, editor: Editor): void {
    appendNoteToEditor(note, editor);
  }
}

export function projectionFrontmatterPreview(note: BkemoNote, hash: string) {
  return buildProjectionFrontmatter(note, hash);
}
