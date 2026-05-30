import { observer } from 'mobx-react-lite';
import { useEffect, useState, useCallback } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { renderMemoBody } from './renderMemoBody';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, cursor: 'pointer' };

export const Random = observer(function Random({ onOpen }: { onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [pool, setPool] = useState<Note[]>([]);
  const [current, setCurrent] = useState<Note | null>(null);

  const reroll = useCallback((p: Note[] = pool) => {
    if (!p.length) { setCurrent(null); return; }
    setCurrent(p[Math.floor(Math.random() * p.length)]);
  }, [pool]);

  useEffect(() => {
    let cancelled = false;
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 500)
      .then((list) => { if (!cancelled) { setPool(list); setCurrent(list[Math.floor(Math.random() * list.length)] ?? null); } })
      .catch((e) => console.error('[random] load failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) reroll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reroll]);

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Random</span>
        <span className="spacer" />
        <button style={btn} onClick={() => reroll()}>↻ Re-roll · R</button>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '28px 28px 40px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={mono}>FOR WHEN YOU'RE STUCK · PRESS R FOR ANOTHER</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 24px', color: 'var(--fg)' }}>A random memo from your archive.</h1>
          {!current ? (
            <div style={{ ...mono, padding: 40, textAlign: 'center' }}>No memos yet.</div>
          ) : (
            <div onClick={() => onOpen?.(current)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-lg)', padding: '32px', cursor: 'pointer' }}>
              <div className="h-stack" style={mono}>
                <span>BK-{current.id}</span>
                <span style={{ margin: '0 10px' }}>·</span>
                <span>{current.createdAt ? dayjs(current.createdAt).format('MMM D, YYYY · HH:mm').toUpperCase() : ''}</span>
                <span className="spacer" />
                <span>{current.createdAt ? dayjs(current.createdAt).fromNow().toUpperCase() : ''}</span>
              </div>
              <div style={{ fontSize: 22, lineHeight: 1.55, color: 'var(--fg)', marginTop: 16 }}>
                {renderMemoBody(current.content ?? '')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
