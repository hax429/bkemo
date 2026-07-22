import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useImperativeHandle, forwardRef } from 'react';
import { Hashtag } from './hashtagExtension';
import { SlashCommand } from './slashCommand';
import { TagSuggestion } from './tagSuggestion';
import { NoteLinkSuggestion, type NoteLinkItem } from './noteLinkSuggestion';
import 'highlight.js/styles/atom-one-dark.css';
import './tiptap.css';

/** Shared lowlight instance (common languages) for live code-block highlighting. */
const lowlight = createLowlight(common);

/** tiptap-markdown stores its serializer on editor.storage.markdown. */
const getMd = (editor: Editor | null | undefined): string =>
  (editor?.storage as any)?.markdown?.getMarkdown?.() ?? '';

export type TiptapEditorHandle = {
  /** Current document as markdown. */
  getMarkdown: () => string;
  /** Replace the document with markdown. */
  setMarkdown: (md: string) => void;
  /** Insert markdown/text at the cursor. */
  insert: (text: string) => void;
  focus: () => void;
  clear: () => void;
  editor: Editor | null;
};

type Props = {
  /** Initial markdown content. Treated as the source of truth on mount only. */
  value?: string;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  className?: string;
  /** Fires with the latest markdown on every change. */
  onChange?: (markdown: string) => void;
  /** Cmd/Ctrl+Enter handler (e.g. send memo). */
  onSubmit?: (markdown: string) => void;
  /** Upload an image file, returning a URL to embed. */
  onUploadImage?: (file: File) => Promise<string>;
  /** Existing tag paths (no leading #) for the "#" autocomplete. */
  getTags?: () => string[];
  /** Search existing memos/todos for the "[[" link autocomplete. */
  getNotes?: (query: string) => Promise<NoteLinkItem[]> | NoteLinkItem[];
  onFocus?: () => void;
  onBlur?: () => void;
};

/**
 * Markdown-backed rich text editor (TipTap v3). Replaces Vditor for the new
 * bkemo flow. Stores/serializes plain markdown so notes.content and the
 * offline cache stay markdown strings — no storage model change.
 */
export const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(function TiptapEditor(
  { value = '', placeholder = 'New memo…', editable = true, autofocus = false, className, onChange, onSubmit, onUploadImage, getTags, getNotes, onFocus, onBlur },
  ref,
) {
  const editor = useEditor({
    editable,
    autofocus,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        // Replaced by CodeBlockLowlight below for ```lang syntax highlighting.
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
      Hashtag,
      SlashCommand,
      TagSuggestion.configure({ getTags: () => getTags?.() ?? [] }),
      NoteLinkSuggestion.configure({ getNotes: (q) => getNotes?.(q) ?? [] }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
        breaks: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange?.(getMd(editor));
    },
    onFocus: () => {
      onFocus?.();
    },
    onBlur: () => {
      onBlur?.();
    },
    editorProps: {
      attributes: { class: 'tiptap-content' },
      handleKeyDown: (view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          onSubmit?.(getMd(editor));
          return true;
        }
        // Inside a code block, Tab indents (2 spaces) instead of leaving the
        // editor / moving focus to the toolbar; Shift+Tab outdents the line.
        if (event.key === 'Tab') {
          const { state } = view;
          if (state.selection.$head.parent.type.name !== 'codeBlock') return false;
          event.preventDefault();
          const { from, to, $from } = state.selection;
          if (event.shiftKey) {
            const blockStart = $from.start();
            const before = state.doc.textBetween(blockStart, from, '\n');
            const lineStart = blockStart + before.lastIndexOf('\n') + 1;
            const lineLead = state.doc.textBetween(lineStart, from, '\n').match(/^[\t ]+/)?.[0] ?? '';
            const remove = lineLead.startsWith('\t') ? 1 : Math.min(2, lineLead.length);
            if (remove > 0) view.dispatch(state.tr.delete(lineStart, lineStart + remove).scrollIntoView());
          } else {
            view.dispatch(state.tr.insertText('  ', from, to).scrollIntoView());
          }
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        if (!onUploadImage) return false;
        const files = Array.from(event.clipboardData?.files ?? []);
        const image = files.find((f) => f.type.startsWith('image/'));
        if (!image) return false;
        event.preventDefault();
        onUploadImage(image)
          .then((url) => editor?.chain().focus().setImage({ src: url }).run())
          .catch((e) => console.error('[tiptap] image upload failed:', e));
        return true;
      },
      handleDrop: (_view, event) => {
        if (!onUploadImage) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        const image = files.find((f) => f.type.startsWith('image/'));
        if (!image) return false;
        event.preventDefault();
        onUploadImage(image)
          .then((url) => editor?.chain().focus().setImage({ src: url }).run())
          .catch((e) => console.error('[tiptap] image upload failed:', e));
        return true;
      },
    },
  });

  // Keep editor editable state in sync.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // Sync external value changes (e.g. switching the selected note) without
  // clobbering in-progress local edits: only reset when the incoming markdown
  // differs from the current document.
  useEffect(() => {
    if (!editor) return;
    const current = getMd(editor);
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => getMd(editor),
    setMarkdown: (md: string) => editor?.commands.setContent(md, { emitUpdate: false }),
    insert: (text: string) => editor?.chain().focus().insertContent(text).run(),
    focus: () => editor?.commands.focus(),
    clear: () => editor?.commands.clearContent(true),
    editor: editor ?? null,
  }), [editor]);

  return <EditorContent editor={editor} className={className} />;
});
