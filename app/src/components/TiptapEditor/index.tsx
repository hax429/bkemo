import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useImperativeHandle, forwardRef } from 'react';
import { Hashtag } from './hashtagExtension';
import { SlashCommand } from './slashCommand';
import { TagSuggestion } from './tagSuggestion';
import './tiptap.css';

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
};

/**
 * Markdown-backed rich text editor (TipTap v3). Replaces Vditor for the new
 * Direction D flow. Stores/serializes plain markdown so notes.content and the
 * offline cache stay markdown strings — no storage model change.
 */
export const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(function TiptapEditor(
  { value = '', placeholder = 'New memo…', editable = true, autofocus = false, className, onChange, onSubmit, onUploadImage, getTags },
  ref,
) {
  const editor = useEditor({
    editable,
    autofocus,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        codeBlock: {},
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
      Hashtag,
      SlashCommand,
      TagSuggestion.configure({ getTags: () => getTags?.() ?? [] }),
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
    editorProps: {
      attributes: { class: 'tiptap-content' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          onSubmit?.(getMd(editor));
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
