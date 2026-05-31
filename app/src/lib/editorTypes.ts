import { NoteType } from '@shared/lib/types';
import { PromiseState } from '@/store/standard/PromiseState';

/**
 * Editor-adjacent types and compatibility shims, extracted from the removed
 * Vditor integration (`Common/Editor`) so shared utilities/stores no longer
 * depend on the legacy editor. These are vditor-free.
 */
export type FileType = {
  name: string;
  size: number;
  previewType: 'image' | 'audio' | 'video' | 'other';
  extension: string;
  preview: any;
  uploadPromise: PromiseState<any>;
  type: string; // e.g. audio/webm
};

export type OnSendContentType = {
  content: string;
  files: (FileType & { uploadPath: string })[];
  noteType: NoteType;
  references: number[];
  metadata?: any;
};

/**
 * No-op kept for API compatibility. The old implementation focused Vditor's
 * contenteditable on mobile; TipTap manages its own focus, so this does nothing.
 */
export const FocusEditorFixMobile = () => {};
