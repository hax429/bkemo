/**
 * Selection bubble for TipTap — text marks + H1–H3.
 * Portaled to document.body; carries `.bkemo` theme attrs (UI.md).
 */
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState, type Editor } from '@tiptap/react';
import type { CSSProperties } from 'react';
import { loadPrefs } from '@/lib/bkemoSettings';

function themeShell() {
  const prefs = loadPrefs();
  const preset = prefs.theme === 'light'
    ? 'light'
    : (prefs.accent?.toLowerCase() === '#5e6ad2'
      ? 'developer'
      : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));
  return {
    className: 'bkemo bk-editor-bubble',
    'data-theme': prefs.theme,
    'data-density': prefs.density,
    'data-preset': preset,
    style: (prefs.accent ? { ['--accent']: prefs.accent } : undefined) as CSSProperties | undefined,
  };
}

type BtnProps = {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
};

function Btn({ title, active, onClick, children, accent }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      className={`bk-editor-bubble-btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={accent && active ? { color: accent, background: 'var(--hover)' } : undefined}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="bk-editor-bubble-sep" aria-hidden />;
}

export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      highlight: ed.isActive('highlight'),
      strike: ed.isActive('strike'),
      code: ed.isActive('code'),
      link: ed.isActive('link'),
      h1: ed.isActive('heading', { level: 1 }),
      h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }),
    }),
  });

  if (!editor || !active) return null;

  const shell = themeShell();
  const chain = () => editor.chain().focus();

  const toggleLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url == null) return;
    if (url.trim() === '') {
      chain().unsetLink().run();
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={120}
      appendTo={() => document.body}
      options={{ placement: 'top', offset: 8, flip: true, shift: true }}
      shouldShow={({ editor: ed, state }) => {
        if (!ed.isEditable || ed.isDestroyed) return false;
        if (typeof document !== 'undefined' && document.querySelector('.bk-suggest-menu')) return false;
        const { empty, from, to } = state.selection;
        if (empty) return false;
        const text = state.doc.textBetween(from, to, '\n');
        return text.trim().length > 0;
      }}
      {...shell}
    >
      <Btn title="Bold (⌘B)" active={active.bold} onClick={() => chain().toggleBold().run()}>
        <strong>B</strong>
      </Btn>
      <Btn title="Italic (⌘I)" active={active.italic} onClick={() => chain().toggleItalic().run()}>
        <em>I</em>
      </Btn>
      <Btn title="Underline (⌘U)" active={active.underline} onClick={() => chain().toggleUnderline().run()}>
        <span style={{ textDecoration: 'underline' }}>U</span>
      </Btn>
      <Btn
        title="Highlight"
        active={active.highlight}
        onClick={() => chain().toggleHighlight().run()}
        accent="#1a1b1f"
      >
        <span className="bk-editor-bubble-mark">A</span>
      </Btn>
      <Btn title="Strikethrough" active={active.strike} onClick={() => chain().toggleStrike().run()}>
        <span style={{ textDecoration: 'line-through' }}>S</span>
      </Btn>
      <Btn title="Code (⌘E)" active={active.code} onClick={() => chain().toggleCode().run()}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{'</>'}</span>
      </Btn>
      <Btn title="Link" active={active.link} onClick={toggleLink}>
        ↗
      </Btn>
      <Divider />
      <Btn title="Heading 1" active={active.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        H1
      </Btn>
      <Btn title="Heading 2" active={active.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H2
      </Btn>
      <Btn title="Heading 3" active={active.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        H3
      </Btn>
    </BubbleMenu>
  );
}
