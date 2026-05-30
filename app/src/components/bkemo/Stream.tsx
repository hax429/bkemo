import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import type { Dayjs } from 'dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { TiptapEditor, type TiptapEditorHandle } from '@/components/TiptapEditor';
import { MarkdownView } from './MarkdownView';
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

const MemoRow = observer(function MemoRow({ note, onOpen }: { note: Note; onOpen?: (n: Note) => void }) {
  const task = isTask(note);
  const done = isDone(note);
  const created = note.createdAt ? dayjs(note.createdAt) : dayjs();
  return (
    <div
      onClick={() => onOpen?.(note)}
      style={{
        background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--row-pad-y) 16px', marginBottom: 10, cursor: 'pointer', transition: 'border-color .1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      {/* meta row */}
      <div className="h-stack" style={{ gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 4 }}>
        {task && <TaskCheck note={note} />}
        <span>BK-{note.id}</span>
        <span>·</span>
        <span>{created.format('HH:mm')}</span>
        <span className="spacer" />
        <span>{created.fromNow(true)}</span>
      </div>
      {/* body — markdown preview, consistent with the editor */}
      <div style={{ color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>
        <MarkdownView content={note.content ?? ''} />
      </div>
    </div>
  );
});

export const Stream = observer(function Stream({ onOpen, tag }: { onOpen?: (n: Note) => void; tag?: string }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 200)
      .then((list) => { if (!cancelled) setAllNotes(list); })
      .catch((e) => console.error('[stream] load failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  // When viewing a project (tag), filter by the hashtag in content (offline-safe).
  const notes = tag
    ? allNotes.filter((n) => new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|/)`, 'i').test(n.content ?? ''))
    : allNotes;

  // group by day, newest first
  const groups: { label: string; items: Note[] }[] = [];
  const byKey = new Map<string, Note[]>();
  [...notes]
    .sort((a, b) => dayjs(b.createdAt ?? 0).valueOf() - dayjs(a.createdAt ?? 0).valueOf())
    .forEach((n) => {
      const key = dayjs(n.createdAt ?? undefined).format('YYYY-MM-DD');
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
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 20px 48px' }}>
          <Composer />
          {loading && notes.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No memos yet. Write your first one above.</div>
          ) : (
            groups.map((g) => (
              <div key={g.label} style={{ marginTop: 18 }}>
                <div className="h-stack" style={{ gap: 8, marginBottom: 10, color: 'var(--fg-2)', fontSize: 12, fontWeight: 500 }}>
                  <span>{g.label}</span>
                  <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{g.items.length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)', marginLeft: 4 }} />
                </div>
                {g.items.map((n) => <MemoRow key={n.id} note={n} onOpen={onOpen} />)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
