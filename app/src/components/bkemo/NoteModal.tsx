import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { TiptapEditor, type TiptapEditorHandle } from '@/components/TiptapEditor';
import { isDone, isTask } from '@/lib/taskFilters';

const pill = (active: boolean, color: string): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 100, fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  border: `1px solid ${active ? color : 'var(--border-2)'}`,
  background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
  color: active ? color : 'var(--fg-2)',
});

/** Edit a single memo/task: content (TipTap) + due date + important/urgent + done. */
export const NoteModal = observer(function NoteModal({ note, onClose }: { note: Note; onClose: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const ref = useRef<TiptapEditorHandle>(null);
  const [isTodo, setIsTodo] = useState(note.type === NoteType.TODO || isTask(note));
  const [important, setImportant] = useState(!!note.isImportant);
  const [urgent, setUrgent] = useState(!!note.isUrgent);
  const [due, setDue] = useState(note.dueDate ? dayjs(note.dueDate).format('YYYY-MM-DD') : '');
  const [done, setDone] = useState(isDone(note));
  const [saving, setSaving] = useState(false);
  const [shareId, setShareId] = useState<string | null>((note as any).shareEncryptedUrl ?? null);
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = shareId ? `${window.location.origin}/m/${shareId}` : '';

  const toggleShare = async () => {
    if (!note.id) return;
    if (shareId) {
      await blinko.shareNote.call({ id: note.id, isCancel: true });
      setShareId(null);
    } else {
      const res: any = await blinko.shareNote.call({ id: note.id, isCancel: false });
      setShareId(res?.shareEncryptedUrl ?? null);
      setShowShare(true);
    }
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await blinko.upsertNote.call({
        id: note.id,
        content: ref.current?.getMarkdown() ?? note.content ?? '',
        type: isTodo ? NoteType.TODO : NoteType.BLINKO,
        // When demoted from task, clear task attributes; a To-do with no due date
        // stays in the Inbox lane.
        isImportant: isTodo ? important : false,
        isUrgent: isTodo ? urgent : false,
        dueDate: isTodo && due ? dayjs(due).endOf('day').toDate() : null,
        completedAt: isTodo && done ? (note.completedAt ? new Date(note.completedAt as any) : new Date()) : null,
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

  return (
    <div
      className="bkemo"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
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
          {note.id && (
            <span onClick={() => (shareId ? setShowShare((v) => !v) : toggleShare())} title="Share" style={{ cursor: 'pointer', fontSize: 12, color: shareId ? 'var(--accent)' : 'var(--fg-3)' }}>↗ {shareId ? 'Shared' : 'Share'}</span>
          )}
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 14 }}>✕</span>
        </div>

        {/* share panel */}
        {note.id && showShare && shareId && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
            <div className="h-stack" style={{ gap: 8 }}>
              <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '5px 10px', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
              <button onClick={copyLink} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '5px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
              <button onClick={toggleShare} style={{ background: 'transparent', color: '#E0696B', border: '1px solid #5C2A2A', borderRadius: 'var(--radius)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>Unshare</button>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)', marginTop: 6 }}>Anyone with this link can view, comment, and react.</div>
          </div>
        )}

        {/* editor */}
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          <TiptapEditor ref={ref} value={note.content ?? ''} autofocus onSubmit={save} getTags={() => blinko.tagList.value?.pathTags ?? []} />
        </div>

        {/* task controls — convert to a to-do first, then due/priority/done reveal */}
        <div className="h-stack" style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
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
              <span onClick={() => setImportant((v) => !v)} style={pill(important, 'var(--accent)')}>! important</span>
              <span onClick={() => setUrgent((v) => !v)} style={pill(urgent, '#E8A35C')}>^ urgent</span>
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
