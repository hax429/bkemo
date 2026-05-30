import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { previewText } from './renderMemoBody';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };

export const Trash = observer(function Trash() {
  const blinko = RootStore.Get(BlinkoStore);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let cancelled = false;
    blinko.queryNotes({ type: -1, isRecycle: true }, 1, 200)
      .then((list) => { if (!cancelled) setNotes(list); })
      .catch((e) => console.error('[trash] load failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const restore = (n: Note) => blinko.upsertNote.call({ id: n.id, isRecycle: false, content: null as any, showToast: false });
  const remove = (n: Note) => blinko.deleteNote.call({ ids: [n.id!] });

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Trash</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{notes.length} memos</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 28px 40px' }}>
        {notes.length === 0 ? (
          <div style={{ ...mono, padding: 40, textAlign: 'center' }}>Trash is empty.</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div className="h-stack" style={{ padding: '8px 14px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', ...mono, gap: 12 }}>
              <span style={{ flex: 1 }}>Body</span>
              <span style={{ width: 100, textAlign: 'right' }}>Deleted</span>
              <span style={{ width: 110, textAlign: 'right' }}>Actions</span>
            </div>
            {notes.map((n) => (
              <div key={n.id} className="h-stack" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 12, color: 'var(--fg)' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)', textDecoration: 'line-through' }}>{previewText(n.content ?? '') || '(empty)'}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', width: 100, textAlign: 'right' }}>{n.updatedAt ? dayjs(n.updatedAt).fromNow() : ''}</span>
                <div className="h-stack" style={{ width: 110, justifyContent: 'flex-end', gap: 10 }}>
                  <span onClick={() => restore(n)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}>↺ restore</span>
                  <span onClick={() => remove(n)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#E0696B', cursor: 'pointer' }}>⌫</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
