import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { Note } from '@shared/lib/types';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { previewText } from './renderMemoBody';
import { eventBus } from '@/lib/event';

export const SearchOverlay = observer(function SearchOverlay({ onOpen, onClose }: { onOpen: (note: Note) => void; onClose: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      blinko.queryNotes({ searchText: term, type: -1, isRecycle: false, isArchived: false }, 1, 50)
        .then((notes) => { if (!cancelled) setResults(notes); })
        .catch((error) => console.error('[search] failed:', error))
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, blinko]);

  const open = (note: Note) => {
    onOpen(note);
    onClose();
  };

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.58)', padding: 'max(7vh, 30px) 16px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(660px, 100%)', maxHeight: '78vh', overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)', boxShadow: '0 24px 70px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column' }}>
        <div className="h-stack" style={{ gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--accent)' }}>⌕</span>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every memo and subtask…" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', color: 'var(--fg)', fontSize: 14 }} />
          <span style={{ padding: '2px 6px', border: '1px solid var(--border-2)', borderRadius: 5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>ESC</span>
        </div>
        <div className="bk-scroll" style={{ overflow: 'auto', padding: 8 }}>
          {!query.trim() ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Search includes nested subtasks.</div>
          ) : loading && results.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No matches.</div>
          ) : results.map((note) => {
            const parent = (note as any).parentNote as { id?: number; content?: string } | null | undefined;
            return (
              <div key={note.id} onClick={() => open(note)} style={{ padding: '10px 11px', borderRadius: 9, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                <div className="h-stack" style={{ gap: 7, marginBottom: 4, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
                  <span>BK-{note.id}</span>
                  {parent?.id && <span style={{ color: 'var(--accent)' }}>SUBTASK</span>}
                  <span className="spacer" />
                  {note.isTop && <span style={{ color: 'var(--accent)' }}>PINNED</span>}
                </div>
                <div style={{ color: 'var(--fg)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewText(note.content ?? '') || '(empty)'}</div>
                {parent?.id && (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); eventBus.emit('bkemo:open-note', { id: parent.id }); onClose(); }}
                    style={{ marginTop: 6, border: 0, background: 'transparent', padding: 0, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}
                  >
                    ↳ Parent BK-{parent.id} · {previewText(parent.content ?? '').slice(0, 60)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
