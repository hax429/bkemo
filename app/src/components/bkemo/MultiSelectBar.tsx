import { createPortal } from 'react-dom';

/** Floating bulk-action bar shown while ≥1 memo is selected. */
export function MultiSelectBar({ count, onPin, onArchive, onTrash, onClear }: {
  count: number;
  onPin: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  const btn: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--fg-2)', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer' };
  return createPortal(
    <div
      className="bkemo"
      data-theme="dark"
      style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9998 }}
    >
      <div className="h-stack" style={{ gap: 8, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 100, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', padding: '0 6px' }}>{count} selected</span>
        <button style={btn} onClick={onPin}>⊕ Pin</button>
        <button style={btn} onClick={onArchive}>▦ Archive</button>
        <button style={{ ...btn, color: '#E0696B', borderColor: '#5C2A2A' }} onClick={onTrash}>⌫ Trash</button>
        <button style={{ ...btn, border: 'none' }} onClick={onClear}>✕</button>
      </div>
    </div>,
    document.body,
  );
}
