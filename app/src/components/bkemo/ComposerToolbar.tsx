import type { Editor } from '@tiptap/react';
import type { ReactNode, SVGProps } from 'react';

const stroke = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg {...stroke} {...props} />;
}

/** Linear stroke icons — one weight/size for the composer chrome. */
export const ComposerIcons = {
  bullet: () => (
    <Svg>
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </Svg>
  ),
  ordered: () => (
    <Svg>
      <line x1="10" x2="21" y1="6" y2="6" />
      <line x1="10" x2="21" y1="12" y2="12" />
      <line x1="10" x2="21" y1="18" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </Svg>
  ),
  hash: () => (
    <Svg>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </Svg>
  ),
  paperclip: () => (
    <Svg>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  ),
  expand: () => (
    <Svg>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" x2="14" y1="3" y2="10" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </Svg>
  ),
  focus: () => (
    <Svg>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </Svg>
  ),
  focusExit: () => (
    <Svg>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </Svg>
  ),
  todo: () => (
    <Svg>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  ),
  important: () => (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </Svg>
  ),
  urgent: () => (
    <Svg>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </Svg>
  ),
};

function ToolBtn({
  title,
  active,
  activeColor,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  activeColor?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const color = active ? (activeColor ?? 'var(--accent)') : 'var(--fg-2)';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="bk-composer-tool"
      style={{
        color,
        background: active ? 'var(--hover)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="bk-composer-tool-sep" aria-hidden />;
}

export type ComposerToolbarProps = {
  editor: Editor | null | undefined;
  onTag: () => void;
  onAttach: () => void;
  /** Full-page NoteModal expand (stream only). */
  onExpand?: () => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  isTodo: boolean;
  onToggleTodo: () => void;
  /** When false, hide important/urgent until todo is on (NoteModal). Default true. */
  showPriorityAlways?: boolean;
  important: boolean;
  onToggleImportant: () => void;
  urgent: boolean;
  onToggleUrgent: () => void;
  /** Due picker / clear / inbox hint. */
  afterFlags?: ReactNode;
};

/**
 * Shared stream + NoteModal formatting / task chrome.
 * Text marks stay in the selection bubble; this row is blocks + memo flags.
 */
export function ComposerToolbar({
  editor,
  onTag,
  onAttach,
  onExpand,
  focusMode,
  onToggleFocus,
  isTodo,
  onToggleTodo,
  showPriorityAlways = true,
  important,
  onToggleImportant,
  urgent,
  onToggleUrgent,
  afterFlags,
}: ComposerToolbarProps) {
  const showPriority = showPriorityAlways || isTodo;
  return (
    <div className="h-stack bk-composer-tools" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <ToolBtn
        title="Bulleted list"
        active={!!editor?.isActive('bulletList')}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <ComposerIcons.bullet />
      </ToolBtn>
      <ToolBtn
        title="Numbered list"
        active={!!editor?.isActive('orderedList')}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ComposerIcons.ordered />
      </ToolBtn>
      <ToolBtn title="Add tag (#)" onClick={onTag}>
        <ComposerIcons.hash />
      </ToolBtn>
      <ToolBtn title="Attach a file (any type)" onClick={onAttach}>
        <ComposerIcons.paperclip />
      </ToolBtn>
      {onExpand && (
        <ToolBtn title="Expand to full-page editor" onClick={onExpand}>
          <ComposerIcons.expand />
        </ToolBtn>
      )}
      {onToggleFocus && (
        <ToolBtn
          title={focusMode ? 'Exit focus mode' : 'Focus mode'}
          active={!!focusMode}
          onClick={onToggleFocus}
        >
          {focusMode ? <ComposerIcons.focusExit /> : <ComposerIcons.focus />}
        </ToolBtn>
      )}

      <Sep />

      <ToolBtn title="Toggle to-do task" active={isTodo} onClick={onToggleTodo}>
        <ComposerIcons.todo />
      </ToolBtn>
      {showPriority && (
        <>
          <ToolBtn
            title="Important"
            active={important}
            activeColor="var(--important)"
            onClick={onToggleImportant}
          >
            <ComposerIcons.important />
          </ToolBtn>
          <ToolBtn
            title="Urgent"
            active={urgent}
            activeColor="var(--urgent)"
            onClick={onToggleUrgent}
          >
            <ComposerIcons.urgent />
          </ToolBtn>
        </>
      )}
      {afterFlags}
    </div>
  );
}
