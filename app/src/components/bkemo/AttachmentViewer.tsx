import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { attachmentUrl, attachmentKind, KIND_ICON } from '@/lib/attachments';
import { loadPrefs } from '@/lib/bkemoSettings';

export type ViewerItem = { path: string; name: string; type?: string | null };

/** Lazily fetch + render a text attachment's content. */
function TextView({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((t) => { if (!cancelled) setText(t.slice(0, 500_000)); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [url]);
  if (err) return <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Couldn’t load text ({err}).</div>;
  if (text == null) return <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Loading…</div>;
  return (
    <pre style={{ width: 'min(900px, 92vw)', maxHeight: '82vh', overflow: 'auto', margin: 0, padding: 20, background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 12, color: 'var(--fg)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
  );
}

function Body({ item }: { item: ViewerItem }) {
  const url = attachmentUrl(item.path);
  const kind = attachmentKind(item.type, item.name);
  const [zoom, setZoom] = useState(false);

  if (kind === 'image') {
    // Fit: contained + centered. Zoom: 1:1 inside a bounded, scrollable box so a
    // large image can be panned instead of overflowing the viewport.
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setZoom((z) => !z); }}
        style={{
          maxWidth: '96vw', maxHeight: '92vh',
          overflow: zoom ? 'auto' : 'hidden',
          borderRadius: 8, boxShadow: '0 10px 50px rgba(0,0,0,0.6)',
          cursor: zoom ? 'zoom-out' : 'zoom-in',
          ...(zoom ? {} : { display: 'flex', alignItems: 'center', justifyContent: 'center' }),
        }}
      >
        <img
          src={url}
          alt={item.name}
          style={{
            display: 'block', objectFit: 'contain',
            maxWidth: zoom ? 'none' : '96vw', maxHeight: zoom ? 'none' : '92vh',
            width: zoom ? 'auto' : undefined, height: zoom ? 'auto' : undefined,
          }}
        />
      </div>
    );
  }
  if (kind === 'pdf') {
    return <iframe title={item.name} src={url} style={{ width: 'min(1000px, 94vw)', height: '90vh', border: '1px solid var(--border-2)', borderRadius: 8, background: '#fff' }} onClick={(e) => e.stopPropagation()} />;
  }
  if (kind === 'text') return <div onClick={(e) => e.stopPropagation()}><TextView url={url} /></div>;
  if (kind === 'video') return <video src={url} controls autoPlay onClick={(e) => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 8, background: '#000' }} />;
  if (kind === 'audio') {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 12, padding: 24, minWidth: 320 }}>
        <div style={{ color: 'var(--fg)', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>{item.name}</div>
        <audio src={url} controls autoPlay style={{ width: '100%' }} />
      </div>
    );
  }
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 12, padding: 32, textAlign: 'center', minWidth: 280 }}>
      <div style={{ fontSize: 40, color: 'var(--accent)', marginBottom: 12 }}>{KIND_ICON[kind]}</div>
      <div style={{ color: 'var(--fg)', fontSize: 14, marginBottom: 16, wordBreak: 'break-word' }}>{item.name}</div>
      <a href={url} target="_blank" rel="noreferrer" style={{ background: 'var(--accent)', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, textDecoration: 'none' }}>Download / open ↗</a>
    </div>
  );
}

/** Full-screen attachment lightbox with prev/next when given a list. */
export function AttachmentViewer({ items, index, onClose }: { items: ViewerItem[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((v) => Math.min(items.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  const item = items[i];
  if (!item) return null;
  const many = items.length > 1;
  const prefs = loadPrefs();

  // Portal to <body> so the overlay is truly viewport-fixed (the `.bkemo` surface
  // and the focused composer use transforms, which would otherwise make a
  // `position:fixed` child anchor to that sub-region). The `.bkemo` wrapper
  // restores the design tokens (kept dark — the lightbox backdrop is dark).
  return createPortal(
    <div className="bkemo" style={prefs.accent ? { ['--accent' as any]: prefs.accent } : undefined}>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* top bar */}
      <div className="h-stack" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', gap: 12, color: '#fff', fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{item.name}</span>
        {many && <span style={{ opacity: 0.6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{i + 1} / {items.length}</span>}
        <span className="spacer" />
        <a href={attachmentUrl(item.path)} target="_blank" rel="noreferrer" style={{ color: '#fff', opacity: 0.85, textDecoration: 'none' }}>open ↗</a>
        <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, lineHeight: 1, opacity: 0.85 }}>✕</span>
      </div>

      {many && i > 0 && (
        <span onClick={(e) => { e.stopPropagation(); setI((v) => Math.max(0, v - 1)); }} style={{ position: 'absolute', left: 12, color: '#fff', fontSize: 34, cursor: 'pointer', opacity: 0.7, userSelect: 'none', padding: 16 }}>‹</span>
      )}
      <Body key={item.path} item={item} />
      {many && i < items.length - 1 && (
        <span onClick={(e) => { e.stopPropagation(); setI((v) => Math.min(items.length - 1, v + 1)); }} style={{ position: 'absolute', right: 12, color: '#fff', fontSize: 34, cursor: 'pointer', opacity: 0.7, userSelect: 'none', padding: 16 }}>›</span>
      )}
    </div>
    </div>,
    document.body,
  );
}
