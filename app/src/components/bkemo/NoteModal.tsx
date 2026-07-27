import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { TiptapEditor, type TiptapEditorHandle } from '@/components/TiptapEditor';
import { isDone, isTask } from '@/lib/taskFilters';
import { parseTaskSyntax } from '@/lib/taskSyntax';
import { extractNoteLinkIds, noteLinkTitle } from '@/lib/noteLinks';
import { loadPrefs } from '@/lib/bkemoSettings';
import { api } from '@/lib/trpc';
import { eventBus } from '@/lib/event';
import { MarkdownView } from './MarkdownView';
import { toUpsertAttachment } from '@/lib/attachments';
import { useAttachments, PendingAttachments } from './useAttachments';
import { AttachmentList } from './AttachmentList';
import { ShareImageSheet } from './ShareImage';
import { NoteAIThread } from './ai/AIThread';
import { useSharedDraft } from '@/lib/useSharedDraft';

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
export const NoteModal = observer(function NoteModal({ note, onClose, startFullscreen }: { note: Note; onClose: () => void; startFullscreen?: boolean }) {
  const blinko = RootStore.Get(BlinkoStore);
  const isNew = !note.id;
  const shared = useSharedDraft(isNew);
  const ref = useRef<TiptapEditorHandle>(null);
  const [isTodo, setIsTodo] = useState(note.type === NoteType.TODO || isTask(note));
  const [important, setImportant] = useState(!!note.isImportant);
  const [urgent, setUrgent] = useState(!!note.isUrgent);
  const [due, setDue] = useState(note.dueDate ? dayjs(note.dueDate).format('YYYY-MM-DD') : '');
  const [done, setDone] = useState(isDone(note));
  const [saving, setSaving] = useState(false);
  const [updateTicker, setUpdateTicker] = useState(0);
  const currentIsTodo = isNew ? shared.draft.type === NoteType.TODO : isTodo;
  const currentImportant = isNew ? shared.draft.isImportant : important;
  const currentUrgent = isNew ? shared.draft.isUrgent : urgent;
  const currentDue = isNew && shared.draft.dueDate
    ? dayjs(shared.draft.dueDate).format('YYYY-MM-DD')
    : due;
  const readOnlyOffline = !!note.id && !blinko.isOnline;
  // Existing notes open in details (read). New / expanded drafts open in full-page edit.
  const [reading, setReading] = useState(() => {
    if (readOnlyOffline) return true;
    if (!note.id) return false;
    if (startFullscreen || (note as any).__fullscreen) return false;
    return true;
  });
  const readMins = Math.max(1, Math.round((note.content?.trim().split(/\s+/).filter(Boolean).length ?? 0) / 220));
  const enterEdit = () => { if (!readOnlyOffline) setReading(false); };

  useEffect(() => {
    if (readOnlyOffline) setReading(true);
  }, [readOnlyOffline]);
  // Seed pending uploads from a composer "expand" draft so they aren't lost.
  const att = useAttachments((note as any).__draftAttachments);
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
    if (saving || readOnlyOffline) return;
    const parsed = parseTaskSyntax(ref.current?.getMarkdown() ?? note.content ?? '');
    // Inline syntax can promote a memo to a task or set/clear its due date.
    const todo = currentIsTodo || parsed.isTodo;
    // Priority flags apply to any memo (task or not); toolbar buttons or the
    // `#important` / `#urgent` tags set them.
    const flagImportant = currentImportant || !!parsed.isImportant;
    const flagUrgent = currentUrgent || !!parsed.isUrgent;
    const dueValue = parsed.dueDate !== undefined
      ? parsed.dueDate
      : (currentDue ? dayjs(currentDue).endOf('day').toDate() : null);
    setSaving(true);
    try {
      if (isNew) {
        shared.update({
          content: parsed.content,
          type: todo ? NoteType.TODO : NoteType.BLINKO,
          isImportant: flagImportant,
          isUrgent: flagUrgent,
          dueDate: todo && dueValue ? dueValue.toISOString() : null,
        });
        const created = await shared.finalize(att.items.map(toUpsertAttachment));
        if (created) onClose();
        return;
      }
      await blinko.upsertNote.call({
        id: note.id,
        content: parsed.content,
        type: todo ? NoteType.TODO : NoteType.BLINKO,
        // Keep references in sync with the [[memo]] links in the body.
        references: extractNoteLinkIds(parsed.content),
        // Newly uploaded files (existing ones stay linked server-side).
        attachments: att.items.map(toUpsertAttachment),
        parentNoteId: parentId,
        // Priority is independent of task state; a due date only applies to tasks.
        isImportant: flagImportant,
        isUrgent: flagUrgent,
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

  // Closing a new editor only hides it. The shared compose draft remains local
  // and server-synced until the user explicitly presses Save.
  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const prefs = loadPrefs();
  const preset = prefs.theme === 'light' ? 'light' : (prefs.accent?.toLowerCase() === '#5e6ad2' ? 'developer' : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));
  const isMobile = useMediaQuery('(max-width: 768px)');
  // Track the visual viewport so the bottom sheet sits *above* the on-screen
  // keyboard (the toolbar stays reachable), like a native composer.
  const [vvH, setVvH] = useState<number | null>(null);
  const [shareImageOpen, setShareImageOpen] = useState(false);
  useEffect(() => {
    const vv = (typeof window !== 'undefined') ? window.visualViewport : null;
    if (!isMobile || !vv) { setVvH(null); return; }
    const onResize = () => setVvH(vv.height);
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [isMobile]);

  // Editing is always full-page (telegra.ph-style). Reading keeps the detail sheet/modal.
  const editContainerStyle: React.CSSProperties = {
    width: '100vw',
    height: (isMobile && vvH) ? `${vvH}px` : '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  };

  return (
    <div
      className="bkemo"
      data-theme={prefs.theme}
      data-preset={preset}
      onClick={handleClose}
      style={{
        position: 'fixed', left: 0, right: 0, top: 0,
        // On mobile, size the overlay to the visual viewport so a bottom-anchored
        // sheet rests above the keyboard; otherwise fill the whole viewport.
        bottom: (isMobile && vvH && reading) ? undefined : 0,
        height: (isMobile && vvH && reading) ? `${vvH}px` : undefined,
        zIndex: 60, background: reading ? 'rgba(0,0,0,0.5)' : 'var(--bg)', display: 'flex',
        alignItems: (reading && isMobile) ? 'flex-end' : (reading ? 'center' : 'stretch'),
        justifyContent: 'center',
        padding: (reading && !isMobile) ? 24 : 0,
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {})
      }}
    >
      {reading && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={isMobile
            ? { width: '100%', height: '96%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderTop: '1px solid var(--border-2)', borderRadius: '18px 18px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)', animation: 'bk-sheet-up 0.24s cubic-bezier(0.32,0.72,0,1)' }
            : { width: 'min(900px, 100%)', height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
        >
          {/* reader header */}
          <div className="h-stack" style={{ padding: '14px 22px', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <span onClick={handleClose} title="Back" className="bk-icon-btn" style={{ cursor: 'pointer', fontSize: 18, color: 'var(--fg-2)', width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>←</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{note.id ? `BK-${note.id}` : 'NEW'}{note.createdAt ? ` · ${dayjs(note.createdAt).format('MMM D, YYYY')}` : ''}</span>
            {readOnlyOffline && <span style={{ color: 'var(--important)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>OFFLINE · READ ONLY</span>}
            <span className="spacer" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{readMins} min read</span>
            {!!note.id && (
              <span
                onClick={() => setShareImageOpen(true)}
                title="Share as image"
                className="bk-icon-btn"
                style={{ cursor: 'pointer', fontSize: 14, color: 'var(--fg-2)', width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
              >▣</span>
            )}
            {!readOnlyOffline && <span onClick={enterEdit} title="Edit" className="bk-icon-btn" style={{ cursor: 'pointer', fontSize: 15, color: 'var(--fg-2)', width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>✎</span>}
          </div>
          {/* article body — double-click content to enter full-page edit */}
          <div
            className="bk-scroll bk-article"
            style={{ flex: 1, overflow: 'auto', padding: '28px 24px 96px' }}
            onDoubleClick={enterEdit}
            title={readOnlyOffline ? undefined : 'Double-click to edit'}
          >
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              {parentId && (
                <div onClick={() => eventBus.emit('bkemo:open-note', { id: parentId })} className="h-stack" style={{ marginBottom: 24, gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-3)', cursor: 'pointer' }}>
                  <span style={{ color: 'var(--accent)' }}>↳</span>
                  <span>subtask of BK-{parentId}</span>
                  <span style={{ color: 'var(--fg-2)' }}>{linkTitles[parentId] ?? ''}</span>
                </div>
              )}
              <MarkdownView content={note.content ?? ''} />
              <AttachmentList attachments={(note as any).attachments} />
              {/* AI stays on details/read only — not in the editing surface. */}
              <NoteAIThread note={note} onOpen={(n) => eventBus.emit('bkemo:open-note', { id: n.id })} />
            </div>
          </div>
        </div>
      )}
      {!reading && (
      <div
        onClick={(e) => e.stopPropagation()}
        style={editContainerStyle}
      >
        {/* header */}
        <div className="h-stack" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span>{note.id ? `BK-${note.id}` : 'NEW'}</span>
          <span>·</span>
          <span>{note.createdAt ? dayjs(note.createdAt).format('MMM D, YYYY HH:mm') : ''}</span>
          <span className="spacer" />
          {note.id && <span onClick={() => setReading(true)} title="Back to details" style={{ cursor: 'pointer', color: 'var(--fg-2)' }}>← read</span>}
          <span onClick={handleClose} style={{ cursor: 'pointer', fontSize: 14 }}>✕</span>
        </div>

        {/* full-page editor column */}
        <div {...att.dragProps} className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '40px 24px 96px', outline: att.dragOver ? '2px dashed var(--accent)' : 'none', outlineOffset: -4 }}>
          <div className="bk-article-edit" style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
          <TiptapEditor
            ref={ref}
            value={isNew ? shared.draft.content : (note.content ?? '')}
            editable={!isNew || !shared.locked}
            autofocus
            onSubmit={save}
            onDropFiles={(files) => { void att.addFiles(files); }}
            onChange={(md) => {
              setUpdateTicker((v) => v + 1);
              setLinkIds(extractNoteLinkIds(md));
              const parsed = parseTaskSyntax(md);
              if (isNew) {
                shared.update({
                  content: md,
                  ...(parsed.isTodo ? { type: NoteType.TODO } : {}),
                  ...(parsed.isImportant ? { isImportant: true } : {}),
                  ...(parsed.isUrgent ? { isUrgent: true } : {}),
                  ...(parsed.dueDate !== undefined
                    ? { dueDate: parsed.dueDate ? parsed.dueDate.toISOString() : null }
                    : {}),
                });
              } else {
                if (parsed.isTodo && !isTodo) setIsTodo(true);
                if (parsed.isImportant && !important) setImportant(true);
                if (parsed.isUrgent && !urgent) setUrgent(true);
                if (parsed.dueDate) setDue(dayjs(parsed.dueDate).format('YYYY-MM-DD'));
                else if (parsed.dueDate === null) setDue('');
              }
            }}
            getTags={() => blinko.tagList.value?.pathTags ?? []}
            getNotes={async (q) => {
              const list = await blinko.queryNotes({ searchText: q, type: -1, isRecycle: false, isArchived: false }, 1, 8);
              return list
                .filter((n) => n.id != null && n.id !== note.id)
                .map((n) => ({ id: n.id!, title: noteLinkTitle(n.content) }));
            }}
          />
          {isNew && shared.locked && (
            <div className="h-stack" style={{ gap: 8, marginTop: 10, color: 'var(--fg-2)', fontSize: 12 }}>
              <span>This draft is being edited on another device.</span>
              <button className="bk-native-button is-ghost is-small" onClick={() => { void shared.takeOver(); }}>Take over</button>
            </div>
          )}
          {isNew && shared.recovery && (
            <div className="h-stack" style={{ gap: 8, marginTop: 10, color: 'var(--important)', fontSize: 12 }}>
              <span>An offline version was preserved.</span>
              <button className="bk-native-button is-ghost is-small" onClick={shared.restoreRecovery}>Restore</button>
              <button className="bk-native-button is-ghost is-small" onClick={shared.dismissRecovery}>Dismiss</button>
            </div>
          )}
          {/* Already-attached files + pending uploads. */}
          <AttachmentList attachments={(note as any).attachments} />
          {att.fileInput}
          <PendingAttachments items={att.items} uploading={att.uploading} onRemove={att.remove} />
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
        </div>

        {/* task controls — convert to a to-do first, then due/priority/done reveal */}
        <div className="h-stack" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Block / action chrome — text marks live in the selection bubble. */}
          <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
          </div>

          <span style={{ width: 1, height: 16, background: 'var(--border-2)', margin: '0 4px' }} />

          <span
            onClick={() => isNew ? shared.update({ type: currentIsTodo ? NoteType.BLINKO : NoteType.TODO }) : setIsTodo((v) => !v)}
            style={pill(currentIsTodo, 'var(--accent)')}
          >☑ to-do</span>
          {currentIsTodo && (
            <>
              <label className="h-stack" style={{ gap: 6, fontSize: 12, color: 'var(--fg-2)' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>due</span>
                <input
                  type="date"
                  value={currentDue}
                  onChange={(e) => {
                    if (isNew) shared.update({ dueDate: e.target.value ? dayjs(e.target.value).endOf('day').toISOString() : null });
                    else setDue(e.target.value);
                  }}
                  style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                />
                {currentDue ? <span onClick={() => isNew ? shared.update({ dueDate: null }) : setDue('')} style={{ cursor: 'pointer', color: 'var(--fg-3)' }}>clear</span> : <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>→ inbox</span>}
              </label>
              <span onClick={() => isNew ? shared.update({ isImportant: !currentImportant }) : setImportant((v) => !v)} style={pill(currentImportant, 'var(--important)')}>! important</span>
              <span onClick={() => isNew ? shared.update({ isUrgent: !currentUrgent }) : setUrgent((v) => !v)} style={pill(currentUrgent, 'var(--urgent)')}>^ urgent</span>
              {!isNew && <label className="h-stack" style={{ gap: 6, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                done
              </label>}
            </>
          )}
          <span className="spacer" />
          {note.id && <button onClick={trash} style={{ background: 'transparent', border: '1px solid #5C2A2A', color: '#E0696B', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12 }}>Trash</button>}
          <button onClick={save} disabled={saving || (isNew && shared.locked)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, opacity: saving || (isNew && shared.locked) ? 0.6 : 1 }}>Save · ⌘↵</button>
        </div>
      </div>
      )}
      {shareImageOpen && <ShareImageSheet note={note} onClose={() => setShareImageOpen(false)} />}
    </div>
  );
});
