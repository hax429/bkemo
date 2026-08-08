import type { Editor } from 'obsidian';
import type { BkemoNote } from '../types';

export function appendNoteToEditor(note: BkemoNote, editor: Editor): void {
  const source = note.source || `https://bk.hax429.me/note/${note.portableId}`;
  const fragment = `${note.content}\n\n[bkemo](${source})\n`;
  editor.replaceSelection(fragment);
}
