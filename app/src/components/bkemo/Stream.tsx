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
        border: `1.5px solid ${done || (note.isImportant && note.isUrgent) ? 'var(--accent)' : 'var(--fg-3)'}`,
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

  const reset = () => { setImportant(false); setUrgent(false); setDue(''); setIsTodo(false); };

  const send = async () => {
    const md = ref.current?.getMarkdown()?.trim() ?? '';
    if (!md || sending) return;
    setSending(true);
    try {
      await blinko.upsertNote.call({
        content: md,
        // A To-do with no due date is still a task — it lands in the Inbox lane.
        type: isTodo ? NoteType.TODO : NoteType.BLINKO,
        ...(isTodo ? {
          isImportant: important,
          isUrgent: urgent,
          dueDate: due ? dayjs(due).endOf('day').toDate() : null,
        } : {}),
      });
      ref.current?.clear();
      setContent('');
      reset();
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 14 }}>
      <TiptapEditor
        ref={ref}
        value={content}
        placeholder="New memo · / for commands, #tag to file, ⌘↵ to send"
        onChange={setContent}
        onSubmit={send}
        getTags={() => blinko.tagList.value?.pathTags ?? []}
      />
      <div className="h-stack" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {/* Convert this memo into a task first; task options reveal when on. */}
        <span onClick={() => setIsTodo((v) => !v)} style={composerPill(isTodo, 'var(--accent)')}>☑ to-do</span>
        {isTodo && (
          <>
            <label className="h-stack" style={{ gap: 6, fontSize: 11, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>
              <span>due</span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '3px 7px', fontSize: 11, fontFamily: 'inherit' }} />
              {due ? <span onClick={() => setDue('')} style={{ cursor: 'pointer', color: 'var(--fg-3)' }}>clear</span> : <span style={{ color: 'var(--fg-3)' }}>→ inbox</span>}
            </label>
            <span onClick={() => setImportant((v) => !v)} style={composerPill(important, 'var(--accent)')}>! important</span>
            <span onClick={() => setUrgent((v) => !v)} style={composerPill(urgent, '#E8A35C')}>^ urgent</span>
          </>
        )}
        <span className="spacer" />
        <button
          onClick={send}
          disabled={sending}
          style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, opacity: sending ? 0.6 : 1 }}
        >{isTodo ? 'Add task' : 'Send'}</button>
      </div>
    </div>
  );
});

const SelectBox = ({ on }: { on: boolean }) => (
  <span style={{ width: 14, height: 14, borderRadius: 3, marginTop: 2, flexShrink: 0, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--fg-3)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{on ? '✓' : ''}</span>
);

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

  // Fold long memos behind a "Show more" (textFoldLength = 0 disables folding).
  const longBody = textFoldLength > 0 && (note.content?.length ?? 0) > textFoldLength;
  const collapsed = longBody && !expanded;

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); onContext(e, note); }}
      onClick={() => (selectionActive ? onToggleSelect(note.id!) : onOpen?.(note))}
      style={{
        background: 'var(--bg-2)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)',
        padding: 'var(--row-pad-y) 16px', cursor: 'pointer', transition: 'border-color .1s',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = 'var(--border-2)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* meta row */}
      <div className="h-stack" style={{ gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 4 }}>
        {selectionActive && (
          <span onClick={(e) => { e.stopPropagation(); onToggleSelect(note.id!); }}><SelectBox on={selected} /></span>
        )}
        {task && <TaskCheck note={note} />}
        {note.isTop && <span title="Pinned" style={{ color: 'var(--accent)' }}>⊕</span>}
        <span>BK-{note.id}</span>
        <span className="spacer" />
        <span>{getDisplayTime(note.createdAt, note.updatedAt)}</span>
      </div>
      {/* body — markdown preview, consistent with the editor */}
      <div style={{ position: 'relative', maxHeight: collapsed ? 150 : undefined, overflow: collapsed ? 'hidden' : undefined }}>
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

  const menuItems = (n: Note): MenuItem[] => [
    { label: 'Edit', icon: '✎', onClick: () => onOpen?.(n) },
    { label: n.isTop ? 'Unpin' : 'Pin', icon: '⊕', onClick: () => pin(n) },
    { label: isTask(n) ? 'Make memo' : 'Make to-do', icon: '☑', onClick: () => setType(n, isTask(n) ? NoteType.BLINKO : NoteType.TODO) },
    { label: 'Copy text', icon: '⧉', onClick: () => navigator.clipboard?.writeText(n.content ?? '') },
    { label: 'Select', icon: '☑', onClick: () => toggleSelect(n.id!) },
    { type: 'divider' },
    { label: 'Archive', icon: '▦', onClick: () => archive([n.id!]) },
    { label: 'Trash', icon: '⌫', danger: true, onClick: () => trash([n.id!]) },
  ];

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
              {groups.map((g) => (
                <div key={g.label} style={{ marginTop: 18 }}>
                  <div className="h-stack" style={{ gap: 8, marginBottom: 10, color: 'var(--fg-2)', fontSize: 12, fontWeight: 500 }}>
                    <span>{g.label}</span>
                    <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{g.items.length}</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)', marginLeft: 4 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10, alignItems: 'start' }}>
                    {g.items.map((n) => (
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
                </div>
              ))}
              {hasMore && !tag && (
                <div style={{ textAlign: 'center', marginTop: 20 }}>
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
