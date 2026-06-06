import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { TiptapEditor, type TiptapEditorHandle } from '@/components/TiptapEditor';
import { isDone, isTask } from '@/lib/taskFilters';
import { parseTaskSyntax } from '@/lib/taskSyntax';
import { extractNoteLinkIds, noteLinkTitle } from '@/lib/noteLinks';
import { UserStore } from '@/store/user';
import { loadPrefs } from '@/lib/bkemoSettings';
import { api } from '@/lib/trpc';
import { eventBus } from '@/lib/event';

const pill = (active: boolean, color: string): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 100, fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  border: `1px solid ${active ? color : 'var(--border-2)'}`,
  background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
  color: active ? color : 'var(--fg-2)',
});

function dueLabel(dueDate?: Date | string | null): string {
  if (!dueDate) return 'inbox';
  const d = dayjs(dueDate).startOf('day');
  const diff = d.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${-diff}d overdue`;
  return d.format('MMM D');
}

const TinyCheck = observer(function TinyCheck({ note, onAfter }: { note: Note; onAfter: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const done = isDone(note);
  return (
    <span
      onClick={async (e) => { e.stopPropagation(); await blinko.toggleTaskDone.call({ id: note.id!, done: !done, refresh: false }); onAfter(); }}
      style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${done ? 'var(--accent)' : 'var(--fg-3)'}`, background: done ? 'var(--accent)' : 'transparent', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
    >{done ? '✓' : ''}</span>
  );
});

const SubtaskRow = observer(function SubtaskRow({ subtask, onOpen, onRefresh }: { subtask: Note; onOpen: (n: Note) => void; onRefresh: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [date, setDate] = useState(subtask.dueDate ? dayjs(subtask.dueDate).format('YYYY-MM-DD') : '');
  const done = isDone(subtask);

  const patch = async (data: { isImportant?: boolean; isUrgent?: boolean; dueDate?: Date | null }) => {
    await blinko.upsertNote.call({ id: subtask.id, ...data, showToast: false, refresh: false });
    onRefresh();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
      <TinyCheck note={subtask} onAfter={onRefresh} />
      <div onClick={() => onOpen(subtask)} style={{ minWidth: 0, cursor: 'pointer' }}>
        <div style={{ color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(subtask.content || 'Untitled subtask').replace(/^#+\s*/, '')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
          <span>{dueLabel(subtask.dueDate)}</span>
          {subtask.isImportant && <span style={{ color: 'var(--important)' }}>important</span>}
          {subtask.isUrgent && <span style={{ color: 'var(--urgent)' }}>urgent</span>}
        </div>
      </div>
      <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <span onClick={() => patch({ isImportant: !subtask.isImportant })} style={pill(!!subtask.isImportant, 'var(--important)')}>!</span>
        <span onClick={() => patch({ isUrgent: !subtask.isUrgent })} style={pill(!!subtask.isUrgent, 'var(--urgent)')}>^</span>
        <input
          type="date"
          value={date}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const value = e.target.value;
            setDate(value);
            patch({ dueDate: value ? dayjs(value).endOf('day').toDate() : null });
          }}
          style={{ width: 118, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '4px 6px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
        />
      </div>
    </div>
  );
});

/** Edit a single memo/task: content (TipTap) + due date + important/urgent + done. */
export const NoteModal = observer(function NoteModal({ note, onClose }: { note: Note; onClose: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const ref = useRef<TiptapEditorHandle>(null);
  const [isTodo, setIsTodo] = useState(note.type === NoteType.TODO || isTask(note));
  const [important, setImportant] = useState(!!note.isImportant);
  const [urgent, setUrgent] = useState(!!note.isUrgent);
  const [due, setDue] = useState(note.dueDate ? dayjs(note.dueDate).format('YYYY-MM-DD') : '');
  const [done, setDone] = useState(isDone(note));
  const [saving, setSaving] = useState(false);
  const [updateTicker, setUpdateTicker] = useState(0);
  const [subtasks, setSubtasks] = useState<Note[]>(() => ((note as any).subtasks ?? []) as Note[]);
  const [subtaskText, setSubtaskText] = useState('');
  const [subtaskDue, setSubtaskDue] = useState('');
  const [subtaskImportant, setSubtaskImportant] = useState(false);
  const [subtaskUrgent, setSubtaskUrgent] = useState(false);
  // Parent (this memo is a subtask of …) + the [[memo]] links in the body.
  const [parentId, setParentId] = useState<number | null>(note.parentNoteId ?? (note as any).parentNote?.id ?? null);
  const [linkIds, setLinkIds] = useState<number[]>(() => extractNoteLinkIds(note.content ?? ''));
  const [linkTitles, setLinkTitles] = useState<Record<number, string>>(() => {
    const t: Record<number, string> = {};
    ((note as any).references ?? []).forEach((r: any) => {
      if (r?.toNoteId && r?.toNote?.content != null) t[r.toNoteId] = noteLinkTitle(r.toNote.content);
    });
    if ((note as any).parentNote?.id && (note as any).parentNote?.content != null) {
      t[(note as any).parentNote.id] = noteLinkTitle((note as any).parentNote.content);
    }
    return t;
  });

  const refreshSubtasks = async () => {
    if (!note.id) return;
    const list = await blinko.queryNotes({ parentNoteId: note.id, type: -1, isRecycle: false, isArchived: false }, 1, 100);
    // Both memos and todos can be subtasks.
    setSubtasks(list);
  };

  // Resolve titles for any linked / parent memos we don't already know.
  useEffect(() => {
    const want = [...new Set([...linkIds, ...(parentId ? [parentId] : [])])];
    const missing = want.filter((id) => !(id in linkTitles));
    if (missing.length === 0) return;
    let cancelled = false;
    api.notes.listByIds
      .mutate({ ids: missing })
      .then((notes) => {
        if (cancelled) return;
        setLinkTitles((prev) => {
          const next = { ...prev };
          (notes as any[]).forEach((n) => { if (n?.id != null) next[n.id] = noteLinkTitle(n.content); });
          missing.forEach((id) => { if (!(id in next)) next[id] = `BK-${id}`; });
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLinkTitles((prev) => { const next = { ...prev }; missing.forEach((id) => { if (!(id in next)) next[id] = `BK-${id}`; }); return next; });
      });
    return () => { cancelled = true; };
  }, [linkIds, parentId, linkTitles]);

  // Make this memo a subtask of `newParent` (or detach when null). Persists
  // immediately for saved memos so the relationship shows under the parent.
  const setParent = async (newParent: number | null) => {
    setParentId(newParent);
    if (note.id) {
      await blinko.upsertNote.call({ id: note.id, parentNoteId: newParent, showToast: false, refresh: true });
    }
  };

  useEffect(() => {
    refreshSubtasks().catch((e) => console.error('[subtasks] load failed:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, blinko.updateTicker]);

  const addSubtask = async () => {
    if (!note.id || !subtaskText.trim()) return;
    await blinko.upsertNote.call({
      content: subtaskText.trim(),
      type: NoteType.TODO,
      parentNoteId: note.id,
      isImportant: subtaskImportant,
      isUrgent: subtaskUrgent,
      dueDate: subtaskDue ? dayjs(subtaskDue).endOf('day').toDate() : null,
      showToast: false,
      refresh: false,
    });
    setSubtaskText('');
    setSubtaskDue('');
    setSubtaskImportant(false);
    setSubtaskUrgent(false);
    await refreshSubtasks();
  };

  const save = async () => {
    if (saving) return;
    const parsed = parseTaskSyntax(ref.current?.getMarkdown() ?? note.content ?? '');
    // Inline syntax can promote a memo to a task or set/clear its due date.
    const todo = isTodo || parsed.isTodo;
    const dueValue = parsed.dueDate !== undefined
      ? parsed.dueDate
      : (due ? dayjs(due).endOf('day').toDate() : null);
    setSaving(true);
    try {
      await blinko.upsertNote.call({
        id: note.id,
        content: parsed.content,
        type: todo ? NoteType.TODO : NoteType.BLINKO,
        // Keep references in sync with the [[memo]] links in the body.
        references: extractNoteLinkIds(parsed.content),
        parentNoteId: parentId,
        // When demoted from task, clear task attributes; a To-do with no due date
        // stays in the Inbox lane.
        isImportant: todo ? important : false,
        isUrgent: todo ? urgent : false,
        dueDate: todo ? dueValue : null,
        completedAt: todo && done ? (note.completedAt ? new Date(note.completedAt as any) : new Date()) : null,
        showToast: true,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const trash = async () => {
    await blinko.trashNote.call({ ids: [note.id!] });
    onClose();
  };

  const prefs = loadPrefs();
  const preset = prefs.theme === 'light' ? 'light' : (prefs.accent?.toLowerCase() === '#5e6ad2' ? 'developer' : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));

  return (
    <div
      className="bkemo"
      data-theme={prefs.theme}
      data-preset={preset}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {})
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
      >
        {/* header */}
        <div className="h-stack" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span>{note.id ? `BK-${note.id}` : 'NEW'}</span>
          <span>·</span>
          <span>{note.createdAt ? dayjs(note.createdAt).format('MMM D, YYYY HH:mm') : ''}</span>
          <span className="spacer" />
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 14 }}>✕</span>
        </div>

        {/* editor */}
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          <TiptapEditor
            ref={ref}
            value={note.content ?? ''}
            autofocus
            onSubmit={save}
            onChange={(md) => {
              setUpdateTicker((v) => v + 1);
              setLinkIds(extractNoteLinkIds(md));
              const parsed = parseTaskSyntax(md);
              if (parsed.isTodo && !isTodo) setIsTodo(true);
              if (parsed.dueDate) setDue(dayjs(parsed.dueDate).format('YYYY-MM-DD'));
              else if (parsed.dueDate === null) setDue('');
            }}
            getTags={() => blinko.tagList.value?.pathTags ?? []}
            getNotes={async (q) => {
              const list = await blinko.queryNotes({ searchText: q, type: -1, isRecycle: false, isArchived: false }, 1, 8);
              return list
                .filter((n) => n.id != null && n.id !== note.id)
                .map((n) => ({ id: n.id!, title: noteLinkTitle(n.content) }));
            }}
          />
          {/* This memo is a subtask of another → quick jump to the parent. */}
          {parentId && (
            <div
              onClick={() => eventBus.emit('bkemo:open-note', { id: parentId })}
              className="h-stack"
              style={{ marginTop: 14, gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', cursor: 'pointer', fontSize: 12 }}
            >
              <span style={{ color: 'var(--accent)' }}>↳</span>
              <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>subtask of BK-{parentId}</span>
              <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkTitles[parentId] ?? ''}</span>
              <span className="spacer" />
              <span onClick={(e) => { e.stopPropagation(); setParent(null); }} style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>detach</span>
            </div>
          )}

          {/* [[memo]] links in the body — each can be promoted to this memo's parent. */}
          {linkIds.length > 0 && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div className="h-stack" style={{ marginBottom: 8, gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>linked memos</span>
              </div>
              <div className="v-stack" style={{ gap: 8 }}>
                {linkIds.map((id) => {
                  const isParent = parentId === id;
                  return (
                    <div key={id} className="h-stack" style={{ gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
                      <span onClick={() => eventBus.emit('bkemo:open-note', { id })} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)', marginRight: 6 }}>BK-{id}</span>
                        <span style={{ color: 'var(--fg)', fontSize: 13 }}>{linkTitles[id] ?? `BK-${id}`}</span>
                      </span>
                      {note.id ? (
                        <span
                          onClick={() => setParent(isParent ? null : id)}
                          style={pill(isParent, 'var(--accent)')}
                          title={isParent ? 'Detach from this parent' : 'Make this memo a subtask of the linked memo'}
                        >{isParent ? '✓ subtask of this' : '↳ make subtask'}</span>
                      ) : (
                        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>save first</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {note.id && (isTodo || subtasks.length > 0) && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div className="h-stack" style={{ marginBottom: 8, gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>subtasks</span>
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{subtasks.filter(isDone).length}/{subtasks.length}</span>
              </div>
              <div className="v-stack" style={{ gap: 8 }}>
                {subtasks.length === 0 ? (
                  <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '8px 0' }}>No subtasks yet.</div>
                ) : subtasks.map((subtask) => (
                  <SubtaskRow key={subtask.id} subtask={subtask} onOpen={(st) => eventBus.emit('bkemo:open-note', { id: st.id })} onRefresh={refreshSubtasks} />
                ))}
              </div>
              <div style={{ marginTop: 10, padding: 10, border: '1px dashed var(--border-2)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
                <input
                  value={subtaskText}
                  onChange={(e) => setSubtaskText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSubtask(); } }}
                  placeholder="Add a subtask..."
                  style={{ width: '100%', background: 'transparent', color: 'var(--fg)', border: 'none', outline: 'none', fontSize: 13, marginBottom: 8 }}
                />
                <div className="h-stack" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input type="date" value={subtaskDue} onChange={(e) => setSubtaskDue(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                  <span onClick={() => setSubtaskImportant((v) => !v)} style={pill(subtaskImportant, 'var(--important)')}>! important</span>
                  <span onClick={() => setSubtaskUrgent((v) => !v)} style={pill(subtaskUrgent, 'var(--urgent)')}>^ urgent</span>
                  <span className="spacer" />
                  <button onClick={addSubtask} disabled={!subtaskText.trim()} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '5px 10px', fontSize: 12, opacity: subtaskText.trim() ? 1 : 0.55 }}>Add subtask</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* task controls — convert to a to-do first, then due/priority/done reveal */}
        <div className="h-stack" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Formatting buttons */}
          <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
          </div>

          <span style={{ width: 1, height: 16, background: 'var(--border-2)', margin: '0 4px' }} />

          <span onClick={() => setIsTodo((v) => !v)} style={pill(isTodo, 'var(--accent)')}>☑ to-do</span>
          {isTodo && (
            <>
              <label className="h-stack" style={{ gap: 6, fontSize: 12, color: 'var(--fg-2)' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>due</span>
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                />
                {due ? <span onClick={() => setDue('')} style={{ cursor: 'pointer', color: 'var(--fg-3)' }}>clear</span> : <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>→ inbox</span>}
              </label>
              <span onClick={() => setImportant((v) => !v)} style={pill(important, 'var(--important)')}>! important</span>
              <span onClick={() => setUrgent((v) => !v)} style={pill(urgent, 'var(--urgent)')}>^ urgent</span>
              <label className="h-stack" style={{ gap: 6, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                done
              </label>
            </>
          )}
          <span className="spacer" />
          {note.id && <button onClick={trash} style={{ background: 'transparent', border: '1px solid #5C2A2A', color: '#E0696B', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12 }}>Trash</button>}
          <button onClick={save} disabled={saving} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, opacity: saving ? 0.6 : 1 }}>Save · ⌘↵</button>
        </div>
      </div>
    </div>
  );
});
