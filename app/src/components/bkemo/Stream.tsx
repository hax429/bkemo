import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import dayjs from '@/lib/dayjs';
import type { Dayjs } from 'dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { api } from '@/lib/trpc';
import { PageSize } from '@/store/standard/PromiseState';
import { getDisplayTime } from '@/lib/helper';
import { getBkemoConfig } from '@/lib/bkemoConfig';
import { TiptapEditor, type TiptapEditorHandle } from '@/components/TiptapEditor';
import { MarkdownView } from './MarkdownView';
import { ContextMenu, MoreButton, type MenuItem } from './ContextMenu';
import { CommentsSection, CardFeedback } from './CommentsSection';
import { MultiSelectBar } from './MultiSelectBar';
import { isTask, isDone } from '@/lib/taskFilters';
import { parseTaskSyntax, stripLoneCheckbox } from '@/lib/taskSyntax';
import { extractNoteLinkIds, noteLinkTitle } from '@/lib/noteLinks';
import { eventBus } from '@/lib/event';
import { toUpsertAttachment } from '@/lib/attachments';
import { useAttachments, PendingAttachments } from './useAttachments';
import { AttachmentList } from './AttachmentList';
import { noteMatchesProject } from '@/lib/noteCacheFilters';

function dayLabel(d: Dayjs): string {
  const today = dayjs().startOf('day');
  const diff = today.diff(d.startOf('day'), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return d.format('MMM D, YYYY');
}

/** Compact, human due label (`today`, `2d overdue`, `Mon`, `Jun 18`). */
function dueLabel(d: Date | string): string {
  const day = dayjs(d).startOf('day');
  const diff = day.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return day.format('ddd');
  return day.format('MMM D');
}

const TaskCheck = observer(function TaskCheck({ note }: { note: Note }) {
  const blinko = RootStore.Get(BlinkoStore);
  const done = isDone(note);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); blinko.toggleTaskDone.call({ id: note.id!, done: !done }); }}
      style={{
        width: 14, height: 14, borderRadius: 3, marginTop: 3,
        border: `1.5px solid ${done ? 'var(--accent)' : (note.isImportant && note.isUrgent) ? 'var(--urgent)' : 'var(--fg-3)'}`,
        background: done ? 'var(--accent)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: '#fff', fontSize: 10, lineHeight: 1, cursor: 'pointer',
      }}
    >{done ? '✓' : ''}</span>
  );
});

const composerPill = (active: boolean, color: string): React.CSSProperties => ({
  padding: '3px 9px', borderRadius: 100, fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  border: `1px solid ${active ? color : 'var(--border-2)'}`,
  background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
  color: active ? color : 'var(--fg-2)',
});

const Composer = observer(function Composer({ onExpand }: { onExpand?: (draft: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const ref = useRef<TiptapEditorHandle>(null);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [isTodo, setIsTodo] = useState(false);
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [due, setDue] = useState(''); // yyyy-mm-dd, optional
  const [focused, setFocused] = useState(false);
  const att = useAttachments();

  const reset = () => { setImportant(false); setUrgent(false); setDue(''); setIsTodo(false); att.clear(); };

  // Live-reflect inline task syntax (`- [ ]` checkbox, `due:…`) in the toolbar so
  // the user sees the memo turning into a task as they type.
  const onEditorChange = (md: string) => {
    setContent(md);
    const parsed = parseTaskSyntax(md);
    if (parsed.isTodo && !isTodo) setIsTodo(true);
    if (parsed.isImportant && !important) setImportant(true);
    if (parsed.isUrgent && !urgent) setUrgent(true);
    if (parsed.dueDate) setDue(dayjs(parsed.dueDate).format('YYYY-MM-DD'));
    else if (parsed.dueDate === null) setDue('');
  };

  const send = async () => {
    if (sending) return;
    const raw = ref.current?.getMarkdown()?.trim() ?? '';
    const parsed = parseTaskSyntax(raw);
    // Allow an attachment-only memo (no text, no checkbox).
    if (!parsed.content && !parsed.isTodo && att.items.length === 0) return;
    const todo = isTodo || parsed.isTodo;
    // Priority flags apply to any memo (task or not); `#important`/`#urgent` tags
    // OR the toolbar buttons set them.
    const flagImportant = important || !!parsed.isImportant;
    const flagUrgent = urgent || !!parsed.isUrgent;
    // Inline `due:` wins over the picker; otherwise fall back to the picked date.
    const dueDate = parsed.dueDate !== undefined
      ? parsed.dueDate
      : (due ? dayjs(due).endOf('day').toDate() : null);
    setSending(true);
    try {
      await blinko.upsertNote.call({
        content: parsed.content,
        // A To-do with no due date is still a task — it lands in the Inbox lane.
        type: todo ? NoteType.TODO : NoteType.BLINKO,
        // Persist [[memo]] links as references so the link graph mirrors the body.
        references: extractNoteLinkIds(parsed.content),
        attachments: att.items.map(toUpsertAttachment),
        isImportant: flagImportant,
        isUrgent: flagUrgent,
        // A due date only applies to tasks (and itself makes a memo a task).
        dueDate: todo ? dueDate : null,
      });
      ref.current?.clear();
      setContent('');
      reset();
    } finally {
      setSending(false);
    }
  };

  // Move the current draft into the full-page (article) editor, keeping content,
  // task flags, due date, and any pending uploads.
  const expand = () => {
    const md = ref.current?.getMarkdown() ?? '';
    const todo = isTodo || parseTaskSyntax(md).isTodo;
    const draft = {
      content: md,
      type: todo ? NoteType.TODO : NoteType.BLINKO,
      isImportant: important,
      isUrgent: urgent,
      dueDate: due ? dayjs(due).endOf('day').toDate() : null,
      __fullscreen: true,
      __draftAttachments: att.items,
    } as unknown as Note;
    onExpand?.(draft);
    ref.current?.clear();
    setContent('');
    reset();
  };

  const showChrome = focused || content.trim().length > 0 || att.items.length > 0 || att.uploading > 0;

  return (
    <div
      {...att.dragProps}
      style={{
        background: 'var(--bg-2)',
        // Single `border` shorthand (no separate borderColor) to avoid React's
        // shorthand/longhand conflict warning on focus/drag transitions.
        border: `1px solid ${att.dragOver ? 'var(--accent)' : focused ? 'color-mix(in srgb, var(--accent) 55%, transparent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg, 14px)',
        padding: '16px 20px',
        marginBottom: 20,
        transition: 'all 0.2s ease-in-out',
        ...(focused ? {
          boxShadow: '0 0 0 4px var(--accent-soft), 0 12px 30px -10px rgba(0,0,0,0.5)',
          transform: 'translateY(-1px)',
        } : {}),
      }}
    >
      <TiptapEditor
        ref={ref}
        value={content}
        placeholder="Throw a thought in here…  ( -[] makes a task · due:today / due:06/25/26 sets a date )"
        onChange={onEditorChange}
        onSubmit={send}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        getTags={() => blinko.tagList.value?.pathTags ?? []}
        getNotes={async (q) => {
          const list = await blinko.queryNotes({ searchText: q, type: -1, isRecycle: false, isArchived: false }, 1, 8);
          return list.filter((n) => n.id != null).map((n) => ({ id: n.id!, title: noteLinkTitle(n.content) }));
        }}
      />
      {att.fileInput}
      <PendingAttachments items={att.items} uploading={att.uploading} onRemove={att.remove} />
      {showChrome && (
        <div className="h-stack" style={{ gap: 8, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          {/* List out everything as small icons/buttons underneath the editor */}
          <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current?.editor?.chain().focus().toggleBold().run()}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: ref.current?.editor?.isActive('bold') ? 'var(--accent)' : 'var(--fg-2)',
                background: ref.current?.editor?.isActive('bold') ? 'var(--hover)' : 'transparent',
                fontWeight: 'bold', fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Bold (⌘B)"
            >
              B
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current?.editor?.chain().focus().toggleItalic().run()}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: ref.current?.editor?.isActive('italic') ? 'var(--accent)' : 'var(--fg-2)',
                background: ref.current?.editor?.isActive('italic') ? 'var(--hover)' : 'transparent',
                fontStyle: 'italic', fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Italic (⌘I)"
            >
              I
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current?.editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: ref.current?.editor?.isActive('heading') ? 'var(--accent)' : 'var(--fg-2)',
                background: ref.current?.editor?.isActive('heading') ? 'var(--hover)' : 'transparent',
                fontWeight: 'bold', fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Heading (H2)"
            >
              H
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current?.editor?.chain().focus().toggleBulletList().run()}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: ref.current?.editor?.isActive('bulletList') ? 'var(--accent)' : 'var(--fg-2)',
                background: ref.current?.editor?.isActive('bulletList') ? 'var(--hover)' : 'transparent',
                fontSize: 14, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Bulleted List"
            >
              •—
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current?.editor?.chain().focus().toggleOrderedList().run()}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: ref.current?.editor?.isActive('orderedList') ? 'var(--accent)' : 'var(--fg-2)',
                background: ref.current?.editor?.isActive('orderedList') ? 'var(--hover)' : 'transparent',
                fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', transition: 'all 0.12s'
              }}
              title="Numbered List"
            >
              1.
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                ref.current?.editor?.chain().focus().run();
                ref.current?.insert('#');
              }}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: 'var(--fg-2)', fontSize: 14, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Add Tag (#)"
            >
              #
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={att.openPicker}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: 'var(--fg-2)', fontSize: 15, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Attach a file (any type)"
            >
              📎
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={expand}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: 'var(--fg-2)', fontSize: 14, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Expand to full-page (article) editor"
            >
              ⤢
            </button>

            <span style={{ width: 1, height: 16, background: 'var(--border-2)', margin: '0 6px' }} />

            {/* Todo Type Toggle */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setIsTodo((v) => !v)}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: isTodo ? 'var(--accent)' : 'var(--fg-2)',
                background: isTodo ? 'var(--hover)' : 'transparent',
                fontSize: 14, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Toggle to-do task"
            >
              ☑
            </button>

            {/* Urgent & Important status toggles */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setImportant((v) => !v)}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: important ? 'var(--important)' : 'var(--fg-2)',
                background: important ? 'var(--hover)' : 'transparent',
                fontSize: 14, border: 'none', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.12s'
              }}
              title="Important status"
            >
              !
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setUrgent((v) => !v)}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                color: urgent ? 'var(--urgent)' : 'var(--fg-2)',
                background: urgent ? 'var(--hover)' : 'transparent',
                fontSize: 14, border: 'none', cursor: 'pointer', transition: 'all 0.12s'
              }}
              title="Urgent status"
            >
              ▲
            </button>

            {isTodo && (
              <label className="h-stack" style={{ gap: 6, fontSize: 11.5, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>
                <span>due</span>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius, 6px)', padding: '2px 6px', fontSize: 11.5, fontFamily: 'inherit' }} />
                {due ? <span onClick={() => setDue('')} style={{ cursor: 'pointer', color: 'var(--fg-3)' }}>clear</span> : <span style={{ color: 'var(--fg-3)' }}>→ inbox</span>}
              </label>
            )}
          </div>

          {/* Right Action Button */}
          {(() => {
            const canSend = !sending && att.uploading === 0 && (content.trim().length > 0 || att.items.length > 0);
            return (
              <button
                onClick={send}
                disabled={!canSend}
                style={{
                  background: 'var(--accent)', border: 'none', color: '#fff', padding: '6px 14px',
                  borderRadius: 'var(--radius-lg, 8px)', fontSize: 12.5, fontWeight: 600,
                  opacity: canSend ? 1 : 0.55, transition: 'all 0.15s ease',
                  flexShrink: 0
                }}
              >
                {isTodo ? 'Add task' : 'Send'}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
});

const SelectBox = ({ on }: { on: boolean }) => (
  <span style={{ width: 14, height: 14, borderRadius: 3, marginTop: 2, flexShrink: 0, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--fg-3)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{on ? '✓' : ''}</span>
);

function plainTitle(content?: string | null): string {
  return (content || 'Untitled task').replace(/^#+\s*/, '').replace(/\n+/g, ' ').trim();
}

const PriorityDots = ({ important, urgent }: { important?: boolean; urgent?: boolean }) => {
  if (!important && !urgent) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginLeft: 4 }}>
      {important && <span title="Important" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--important)' }} />}
      {urgent && <span title="Urgent" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--urgent)' }} />}
    </span>
  );
};

const NestedSubtasks = observer(function NestedSubtasks({ subtasks, onOpen }: { subtasks: Note[]; onOpen?: (note: Note) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (subtasks.length === 0) return null;
  const visible = showAll ? subtasks : subtasks.slice(0, 3);
  return (
    <div onClick={(event) => event.stopPropagation()} style={{ marginTop: 14, borderTop: '1px dashed var(--border)', paddingTop: 9 }}>
      <div style={{ marginBottom: 5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>
        Subtasks · {subtasks.length}
      </div>
      {visible.map((child) => {
        const task = isTask(child);
        const done = isDone(child);
        return (
          <div
            key={child.id}
            onClick={() => onOpen?.(child)}
            className="h-stack"
            style={{ minHeight: 28, gap: 8, padding: '3px 2px', borderRadius: 6, color: done ? 'var(--fg-3)' : 'var(--fg-2)', cursor: 'pointer' }}
          >
            {task ? <TaskCheck note={child} /> : <span style={{ width: 14, color: 'var(--fg-3)', textAlign: 'center' }}>↳</span>}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, textDecoration: done ? 'line-through' : undefined }}>
              {plainTitle(child.content)}
            </span>
            {child.isTop && <span title="Also shown as a pinned card" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>PINNED</span>}
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>BK-{child.id}</span>
          </div>
        );
      })}
      {subtasks.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          style={{ border: 0, background: 'transparent', color: 'var(--accent)', padding: '4px 2px 0', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}
        >
          {showAll ? 'Show fewer' : `Show ${subtasks.length - 3} more`}
        </button>
      )}
    </div>
  );
});

const MemoRow = observer(function MemoRow({ note, onOpen, selected, selectionActive, onToggleSelect, onContext, hideComments, textFoldLength }: {
  note: Note;
  onOpen?: (n: Note) => void;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (id: number) => void;
  onContext: (e: React.MouseEvent, n: Note) => void;
  hideComments: boolean;
  textFoldLength: number;
}) {
  const task = isTask(note);
  const done = isDone(note);
  const [expanded, setExpanded] = useState(false);
  const subtasks = (((note as any).subtasks ?? []) as Note[]);
  const taskSubtasks = subtasks.filter(isTask);
  const doneSubtasks = taskSubtasks.filter(isDone).length;
  const parent = (note as any).parentNote as { id?: number; content?: string } | null | undefined;

  // Fold long memos behind a "Show more" (textFoldLength = 0 disables folding).
  const longBody = textFoldLength > 0 && (note.content?.length ?? 0) > textFoldLength;
  const collapsed = longBody && !expanded;

  return (
    <div
      className="bk-memo"
      onContextMenu={(e) => { e.preventDefault(); onContext(e, note); }}
      onClick={() => (selectionActive ? onToggleSelect(note.id!) : onOpen?.(note))}
      style={{
        background: 'var(--bg-2)',
        border: selected
          ? '1.5px solid var(--accent)'
          : note.isTop
            ? '1.5px solid var(--accent)'
            : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg, 14px)',
        padding: '18px 20px',
        minWidth: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.15s ease-in-out',
        boxShadow: note.isTop && !selected
          ? '0 4px 16px var(--accent-soft)'
          : undefined,
      }}
    >
      {/* meta row */}
      <div className="h-stack bk-memo-meta-row" style={{ gap: 8, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
        {selectionActive && (
          <span onClick={(e) => { e.stopPropagation(); onToggleSelect(note.id!); }}><SelectBox on={selected} /></span>
        )}
        {task && <TaskCheck note={note} />}
        {note.isTop && <span title="Pinned" style={{ color: 'var(--accent)' }}>⊕</span>}
        <span className="bk-memo-id">BK-{note.id}</span>
        <PriorityDots important={note.isImportant} urgent={note.isUrgent} />
        {task && note.dueDate && (() => {
          const overdue = dayjs(note.dueDate).endOf('day').isBefore(dayjs());
          const soon = dueLabel(note.dueDate) === 'today';
          const color = done ? 'var(--fg-3)' : overdue ? 'var(--urgent)' : soon ? 'var(--accent)' : 'var(--fg-2)';
          return (
            <span title={dayjs(note.dueDate).format('YYYY-MM-DD')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, borderRadius: 100, padding: '1px 7px', fontSize: 10 }}>
              <span>◷</span><span>{dueLabel(note.dueDate)}</span>
            </span>
          );
        })()}
        {taskSubtasks.length > 0 && (
          <span
            title="Subtasks"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}
          >
            <span style={{ display: 'inline-block', width: 22, height: 3, borderRadius: 2, background: 'var(--border-2)', position: 'relative', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(doneSubtasks / taskSubtasks.length) * 100}%`, background: 'var(--accent)' }} />
            </span>
            <span>{doneSubtasks}/{taskSubtasks.length}</span>
          </span>
        )}
        {!!(note as any).shareEncryptedUrl && (
          <span style={{ color: 'var(--accent)', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--accent-soft)', padding: '2px 6px', borderRadius: 4, fontWeight: 500 }} title="Shared memo">
            <span>↗</span>
            <span>shared</span>
          </span>
        )}
        <span className="spacer" />
        <span className="bk-memo-time" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span className="bk-rel">{getDisplayTime(note.createdAt, note.updatedAt)}</span>
          <span className="bk-exact">BK-{note.id} · {dayjs(note.createdAt).format('YYYY-MM-DD HH:mm')}</span>
        </span>
        <MoreButton size={26} onClick={(e) => onContext(e, note)} />
      </div>
      {/* body — markdown preview, consistent with the editor */}
      <div style={{ position: 'relative', maxHeight: collapsed ? 150 : undefined, overflow: collapsed ? 'hidden' : undefined }}>
        {parent?.id && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>
            <span style={{ padding: '2px 7px', borderRadius: 100, background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600 }}>PINNED SUBTASK</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); eventBus.emit('bkemo:open-note', { id: parent.id! }); }}
              title={`Open parent BK-${parent.id}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px 2px 7px', borderRadius: 100, border: '1px solid var(--border-2)', background: 'var(--hover)', color: 'var(--fg-2)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}
            >
              <span style={{ color: 'var(--accent)' }}>↳</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Parent BK-{parent.id} · {plainTitle(parent.content).slice(0, 48)}</span>
            </button>
          </div>
        )}
        <div style={{ color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>
          {/* A task's lone body checkbox duplicates the meta-row toggle — hide it. */}
          <MarkdownView content={task ? stripLoneCheckbox(note.content ?? '') : (note.content ?? '')} />
        </div>
        {collapsed && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 48, background: 'linear-gradient(transparent, var(--bg-2))', pointerEvents: 'none' }} />
        )}
      </div>
      {longBody && (
        <span
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          style={{ display: 'inline-block', marginTop: 4, color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
        >{expanded ? 'Show less' : 'Show more'}</span>
      )}
      <AttachmentList attachments={(note as any).attachments} />
      {!parent?.id && <NestedSubtasks subtasks={subtasks} onOpen={onOpen} />}
      {!hideComments && (
        <CardFeedback note={note} />
      )}
    </div>
  );
});

export const Stream = observer(function Stream({ onOpen, onNew, onExpand, tag }: { onOpen?: (n: Note) => void; onNew?: () => void; onExpand?: (draft: Note) => void; tag?: string }) {
  const blinko = RootStore.Get(BlinkoStore);
  const cfg = getBkemoConfig();
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [pinnedSubtasks, setPinnedSubtasks] = useState<Note[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Responsive card columns (device-card-columns setting).
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1199px)');
  const cols = Math.max(1, isMobile ? cfg.smallCols : isTablet ? cfg.mediumCols : cfg.largeCols);
  const maxW = cfg.maxHomePageWidth > 0 ? cfg.maxHomePageWidth : (cols > 1 ? Math.min(1200, 520 * cols) : 760);
  const showComposer = !(cfg.hidePcEditor && !isMobile);

  // Home and project streams paginate the same top-level unit. Pinned children
  // are a deliberate exception: they also get one independent, labelled card.
  const size = PageSize.value || 30;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTotal(null);
    const projectFilter = tag ? { projectTag: tag } : {};
    Promise.all([
      blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false, parentNoteId: null, ...projectFilter }, 1, size),
      blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false, hasParent: true, isTop: true, ...projectFilter }, 1, 200),
    ])
      .then(([list, pinned]) => {
        if (!cancelled) {
          setAllNotes(list);
          setPinnedSubtasks(pinned);
          setPage(1);
          setHasMore(list.length >= size);
        }
      })
      .catch((e) => console.error('[stream] load failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    if (blinko.isOnline) {
      api.notes.streamCount.query(projectFilter)
        .then((count) => {
          if (!cancelled) {
            setTotal(count);
            setHasMore(count > size);
          }
        })
        .catch((e) => console.warn('[stream] count unavailable:', e));
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker, size, tag, blinko.isOnline]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    try {
      const list = await blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false, parentNoteId: null, ...(tag ? { projectTag: tag } : {}) }, next, size);
      setAllNotes((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const merged = [...prev, ...list.filter((n) => !seen.has(n.id))];
        setHasMore(total != null ? merged.length < total : list.length >= size);
        return merged;
      });
      setPage(next);
    } catch (e) {
      console.error('[stream] load more failed:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const target = loadMoreRef.current;
    const root = scrollRef.current;
    if (!target || !root || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: '240px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, page, loadingMore, tag, total]);

  const toggleSelect = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(new Set());
  const removeLocal = (ids: number[]) => setAllNotes((prev) => prev.filter((n) => !ids.includes(n.id!)));

  // ── single-note actions (context menu) ──
  const pin = (n: Note) => blinko.upsertNote.call({ id: n.id, isTop: !n.isTop, showToast: false });
  const setType = (n: Note, type: NoteType) => blinko.upsertNote.call({ id: n.id, type, showToast: false });
  const archive = async (ids: number[]) => {
    try {
      if (blinko.isOnline) {
        await api.notes.updateMany.mutate({ ids, isArchived: true });
      } else {
        await Promise.all(ids.map((id) => blinko.upsertNote.call({ id, isArchived: true, showToast: false })));
      }
      removeLocal(ids);
    } catch (e) { console.error(e); }
  };
  const trash = async (ids: number[]) => { await blinko.trashNote.call({ ids }); removeLocal(ids); };

  const share = async (n: Note) => {
    try {
      const res: any = await blinko.shareNote.call({ id: n.id!, isCancel: false });
      if (res?.shareEncryptedUrl) {
        (n as any).shareEncryptedUrl = res.shareEncryptedUrl;
        blinko.updateTicker++;
        const url = `${window.location.origin}/m/${res.shareEncryptedUrl}`;
        navigator.clipboard?.writeText(url);
      }
    } catch (e) {
      console.error('[stream] share failed:', e);
    }
  };

  const unshare = async (n: Note) => {
    try {
      await blinko.shareNote.call({ id: n.id!, isCancel: true });
      (n as any).shareEncryptedUrl = null;
      blinko.updateTicker++;
    } catch (e) {
      console.error('[stream] unshare failed:', e);
    }
  };

  const menuItems = (n: Note): MenuItem[] => {
    const isShared = !!(n as any).shareEncryptedUrl;
    const shareUrl = isShared ? `${window.location.origin}/m/${(n as any).shareEncryptedUrl}` : '';

    return [
      { label: 'Edit', icon: '✎', onClick: () => onOpen?.(n) },
      { label: n.isTop ? 'Unpin' : 'Pin', icon: '⊕', onClick: () => pin(n) },
      { label: isTask(n) ? 'Make memo' : 'Make to-do', icon: '☑', onClick: () => setType(n, isTask(n) ? NoteType.BLINKO : NoteType.TODO) },
      { label: 'Copy text', icon: '⧉', onClick: () => navigator.clipboard?.writeText(n.content ?? '') },
      { label: 'Select', icon: '☑', onClick: () => toggleSelect(n.id!) },
      { type: 'divider' },
      isShared ? {
        label: 'Copy link',
        icon: '⧉',
        onClick: () => {
          navigator.clipboard?.writeText(shareUrl);
        }
      } : {
        label: 'Share',
        icon: '↗',
        onClick: () => share(n)
      },
      ...(isShared ? [{
        label: 'Unshare',
        icon: '✕',
        danger: true,
        onClick: () => unshare(n)
      }] : []),
      { type: 'divider' },
      { label: 'Archive', icon: '▦', onClick: () => archive([n.id!]) },
      { label: 'Trash', icon: '⌫', danger: true, onClick: () => trash([n.id!]) },
    ];
  };

  // Re-check tags exactly on the client because the SQL contains query is a
  // candidate filter. A parent remains visible when one of its children matches.
  const topNotes = tag ? allNotes.filter((note) => noteMatchesProject(note, tag)) : allNotes;
  const visiblePinnedSubtasks = tag ? pinnedSubtasks.filter((note) => noteMatchesProject(note, tag)) : pinnedSubtasks;
  const notes = [...visiblePinnedSubtasks, ...topNotes];

  // Sort + group by the configured field (create vs update time), newest first.
  const sortField = (n: Note) => (cfg.orderByCreate ? n.createdAt : n.updatedAt) ?? n.createdAt;
  const groups: { label: string; items: Note[] }[] = [];
  const byKey = new Map<string, Note[]>();
  [...notes]
    .sort((a, b) => dayjs(sortField(b) ?? 0).valueOf() - dayjs(sortField(a) ?? 0).valueOf())
    .forEach((n) => {
      const key = dayjs(sortField(n) ?? undefined).format('YYYY-MM-DD');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(n);
    });
  byKey.forEach((items, key) => groups.push({ label: dayLabel(dayjs(key)), items }));

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* topbar */}
      <div className="h-stack" style={{ height: 44, padding: '0 14px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>{tag ? '#' : '✦ '}{tag ?? 'Home'}</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{tag ? 'Project' : 'Stream'}</span>
        <span className="spacer" />
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {blinko.isOnline && total != null ? `${topNotes.length} of ${total} memos` : `${topNotes.length} cached memos`}
          {visiblePinnedSubtasks.length > 0 ? ` · ${visiblePinnedSubtasks.length} pinned subtask${visiblePinnedSubtasks.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div ref={scrollRef} className="bk-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: maxW, margin: '0 auto', padding: '20px 20px 48px' }}>
          {showComposer ? (
            <Composer onExpand={onExpand} />
          ) : (
            <div
              onClick={onNew}
              className="h-stack"
              style={{ gap: 8, padding: '10px 14px', marginBottom: 14, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg-2)', fontSize: 13, cursor: 'pointer' }}
            >
              <span style={{ color: 'var(--accent)' }}>＋</span>
              <span>New memo…</span>
            </div>
          )}
          {loading && notes.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No memos yet. Write your first one above.</div>
          ) : (
            <>
              {(() => {
                const sortedNotes = [...notes].sort((a, b) => {
                  if (a.isTop && !b.isTop) return -1;
                  if (!a.isTop && b.isTop) return 1;
                  return dayjs(sortField(b) ?? 0).valueOf() - dayjs(sortField(a) ?? 0).valueOf();
                });
                const columnItems = Array.from({ length: cols }, () => [] as Note[]);
                sortedNotes.forEach((item, index) => {
                  columnItems[index % cols].push(item);
                });
                return (
                  <div style={{ display: 'flex', gap: 'var(--gap, 16px)', alignItems: 'start', marginTop: 18 }}>
                    {columnItems.map((colItems, colIndex) => (
                      <div key={colIndex} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--gap, 16px)' }}>
                        {colItems.map((n) => (
                          <MemoRow
                            key={n.id}
                            note={n}
                            onOpen={onOpen}
                            selected={selected.has(n.id!)}
                            selectionActive={selected.size > 0}
                            onToggleSelect={toggleSelect}
                            onContext={(e, note) => setMenu({ x: e.clientX, y: e.clientY, note })}
                            hideComments={cfg.hideComments}
                            textFoldLength={cfg.textFoldLength}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {hasMore && (
                <div ref={loadMoreRef} style={{ textAlign: 'center', marginTop: 24, minHeight: 32 }}>
                  <span
                    onClick={loadMore}
                    style={{ display: 'inline-block', padding: '6px 16px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', color: 'var(--fg-2)', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                  >{loadingMore ? 'Loading…' : 'Load more'}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.note)} onClose={() => setMenu(null)} />}
      <MultiSelectBar
        count={selected.size}
        onPin={() => { [...selected].forEach((id) => { const n = allNotes.find((x) => x.id === id); if (n) pin(n); }); clearSelection(); }}
        onArchive={() => { archive([...selected]); clearSelection(); }}
        onTrash={() => { trash([...selected]); clearSelection(); }}
        onClear={clearSelection}
      />
    </div>
  );
});
