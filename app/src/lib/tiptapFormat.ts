import type { Editor } from '@tiptap/react';

/** Last TipTap editor that received focus — used by native Edit menu formatting. */
let activeEditor: Editor | null = null;

export function setActiveTiptapEditor(editor: Editor | null) {
  activeEditor = editor;
}

export function getActiveTiptapEditor(): Editor | null {
  return activeEditor;
}

export type FormatCommand = 'bold' | 'italic' | 'underline' | 'highlight' | 'strike' | 'code' | 'link';

export function runTiptapFormat(command: FormatCommand): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return false;
  const chain = editor.chain().focus();
  switch (command) {
    case 'bold':
      return chain.toggleBold().run();
    case 'italic':
      return chain.toggleItalic().run();
    case 'underline':
      return chain.toggleUnderline().run();
    case 'highlight':
      return chain.toggleHighlight().run();
    case 'strike':
      return chain.toggleStrike().run();
    case 'code':
      return chain.toggleCode().run();
    case 'link': {
      const prev = editor.getAttributes('link').href as string | undefined;
      const url = window.prompt('Link URL', prev ?? 'https://');
      if (url == null) return false;
      if (url.trim() === '') return chain.unsetLink().run();
      return chain.extendMarkRange('link').setLink({ href: url.trim() }).run();
    }
    default:
      return false;
  }
}
