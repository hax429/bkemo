import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { MarkdownHighlight, MarkdownUnderline } from './markdownMarks';
import './tiptap.css';

const getMd = (editor: Editor | null | undefined): string =>
  (editor?.storage as any)?.markdown?.getMarkdown?.() ?? '';

export type MarkdownOnlyEditorHandle = {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
};

/** TipTap markdown editor without bookmark cards (used inside the bookmark overlay). */
export const MarkdownOnlyEditor = forwardRef<MarkdownOnlyEditorHandle, {
  value?: string;
  placeholder?: string;
  className?: string;
  onChange?: (markdown: string) => void;
}>(function MarkdownOnlyEditor({ value = '', placeholder = '', className, onChange }, ref) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        underline: false,
      }),
      MarkdownUnderline,
      MarkdownHighlight,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
        breaks: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => onChange?.(getMd(ed)),
    editorProps: {
      attributes: { class: 'tiptap-content', spellcheck: 'false' },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== getMd(editor)) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => getMd(editor),
    setMarkdown: (md: string) => editor?.commands.setContent(md, { emitUpdate: false }),
  }));

  return (
    <div className={className}>
      <EditorContent editor={editor} data-placeholder={placeholder} />
    </div>
  );
});
