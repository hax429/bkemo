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
import { ContextMenu, type MenuItem } from './ContextMenu';
import { CommentsSection, CardFeedback } from './CommentsSection';
import { MultiSelectBar } from './MultiSelectBar';
import { isTask, isDone } from '@/lib/taskFilters';
import { parseTaskSyntax } from '@/lib/taskSyntax';
import { extractNoteLinkIds, noteLinkTitle } from '@/lib/noteLinks';

function dayLabel(d: Dayjs): string {
  const today = dayjs().startOf('day');
  const diff = today.diff(d.startOf('day'), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return d.format('MMM D, YYYY');
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

const Composer = observer(function Composer() {
  const blinko = RootStore.Get(BlinkoStore);
  const ref = useRef<TiptapEditorHandle>(null);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [isTodo, setIsTodo] = useState(false);
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [due, setDue] = useState(''); // yyyy-mm-dd, optional
  const [focused, setFocused] = useState(false);

  const reset = () => { setImportant(false); setUrgent(false); setDue(''); setIsTodo(false); };

  // Live-reflect inline task syntax (`- [ ]` checkbox, `due:…`) in the toolbar so
  // the user sees the memo turning into a task as they type.
  const onEditorChange = (md: string) => {
    setContent(md);
    const parsed = parseTaskSyntax(md);
    if (parsed.isTodo && !isTodo) setIsTodo(true);
    if (parsed.dueDate) setDue(dayjs(parsed.dueDate).format('YYYY-MM-DD'));
    else if (parsed.dueDate === null) setDue('');
  };

  const send = async () => {
    const raw = ref.current?.getMarkdown()?.trim() ?? '';
    if (!raw || sending) return;
    const parsed = parseTaskSyntax(raw);
    if (!parsed.content && !parsed.isTodo) return;
    const todo = isTodo || parsed.isTodo;
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
        ...(todo ? {
          isImportant: important,
          isUrgent: urgent,
          dueDate,
        } : {}),
      });
      ref.current?.clear();
      setContent('');
      reset();
    } finally {
      setSending(false);
    }
  };

  const showChrome = focused || content.trim().length > 0;

  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg, 14px)',
        padding: '16px 20px',
        marginBottom: 20,
        transition: 'all 0.2s ease-in-out',
        ...(focused ? {
          borderColor: 'color-mix(in srgb, var(--accent) 55%, transparent)',
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
          <button
            onClick={send}
            disabled={sending || !content.trim()}
            style={{
              background: 'var(--accent)', border: 'none', color: '#fff', padding: '6px 14px',
              borderRadius: 'var(--radius-lg, 8px)', fontSize: 12.5, fontWeight: 600,
              opacity: (sending || !content.trim()) ? 0.55 : 1, transition: 'all 0.15s ease',
              flexShrink: 0
            }}
          >
            {isTodo ? 'Add task' : 'Send'}
          </button>
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
  const subtasks = (((note as any).subtasks ?? []) as Note[]).filter(isTask);
  const doneSubtasks = subtasks.filter(isDone).length;
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
        cursor: 'pointer',
        transition: 'all 0.15s ease-in-out',
        boxShadow: note.isTop && !selected
          ? '0 4px 16px var(--accent-soft)'
          : undefined,
      }}
    >
      {/* meta row */}
      <div className="h-stack bk-memo-meta-row" style={{ gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
        {selectionActive && (
          <span onClick={(e) => { e.stopPropagation(); onToggleSelect(note.id!); }}><SelectBox on={selected} /></span>
        )}
        {task && <TaskCheck note={note} />}
        {note.isTop && <span title="Pinned" style={{ color: 'var(--accent)' }}>⊕</span>}
        <span className="bk-memo-id">BK-{note.id}</span>
        {parent?.id && <span style={{ color: 'var(--fg-3)' }}>↳ BK-{parent.id}</span>}
        <PriorityDots important={note.isImportant} urgent={note.isUrgent} />
        {subtasks.length > 0 && <span style={{ color: 'var(--accent)' }}>{doneSubtasks}/{subtasks.length} subtasks</span>}
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
      </div>
      {/* body — markdown preview, consistent with the editor */}
      <div style={{ position: 'relative', maxHeight: collapsed ? 150 : undefined, overflow: collapsed ? 'hidden' : undefined }}>
        {parent?.id && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
            under BK-{parent.id} · {plainTitle(parent.content).slice(0, 72)}
          </div>
        )}
        <div style={{ color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>
          <MarkdownView content={note.content ?? ''} />
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
      {/* footer: feedback & actions */}
      <div className="h-stack" style={{ gap: 14, marginTop: 8, color: 'var(--fg-3)', fontSize: 12 }}>
        <span className="spacer" />
        <span onClick={(e) => { e.stopPropagation(); onContext(e, note); }} style={{ cursor: 'pointer' }} title="More">···</span>
      </div>
      {!hideComments && (
        <CardFeedback note={note} />
      )}
    </div>
  );
});

export const Stream = observer(function Stream({ onOpen, onNew, tag }: { onOpen?: (n: Note) => void; onNew?: () => void; tag?: string }) {
  const blinko = RootStore.Get(BlinkoStore);
  const cfg = getBkemoConfig();
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null);

  // Responsive card columns (device-card-columns setting).
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1199px)');
  const cols = Math.max(1, isMobile ? cfg.smallCols : isTablet ? cfg.mediumCols : cfg.largeCols);
  const maxW = cfg.maxHomePageWidth > 0 ? cfg.maxHomePageWidth : (cols > 1 ? Math.min(1200, 520 * cols) : 760);
  const showComposer = !(cfg.hidePcEditor && !isMobile);

  // Page size drives the load batch (page-size setting) for the home stream.
  // Project (tag) views filter client-side, so they load a large set up-front.
  const size = tag ? 200 : (PageSize.value || 30);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, size)
      .then((list) => { if (!cancelled) { setAllNotes(list); setPage(1); setHasMore(list.length >= size); } })
      .catch((e) => console.error('[stream] load failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker, size]);

  const loadMore = async () => {
    const next = page + 1;
    try {
      const list = await blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, next, size);
      setAllNotes((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...list.filter((n) => !seen.has(n.id))];
      });
      setPage(next);
      setHasMore(list.length >= size);
    } catch (e) { console.error('[stream] load more failed:', e); }
  };

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
  const archive = async (ids: number[]) => { try { await api.notes.updateMany.mutate({ ids, isArchived: true }); removeLocal(ids); } catch (e) { console.error(e); } };
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

  // When viewing a project (tag), filter by the hashtag in content (offline-safe).
  const notes = tag
    ? allNotes.filter((n) => new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|/)`, 'i').test(n.content ?? ''))
    : allNotes;

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
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{notes.length} memos</span>
      </div>

      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: maxW, margin: '0 auto', padding: '20px 20px 48px' }}>
          {showComposer ? (
            <Composer />
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
                      <div key={colIndex} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--gap, 16px)' }}>
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
              {hasMore && !tag && (
                <div style={{ textAlign: 'center', marginTop: 24 }}>
                  <span
                    onClick={loadMore}
                    style={{ display: 'inline-block', padding: '6px 16px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', color: 'var(--fg-2)', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                  >Load more</span>
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
