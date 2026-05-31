import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | { type?: 'item'; label: string; icon?: string; danger?: boolean; onClick: () => void }
  | { type: 'divider' };

/**
 * Lightweight right-click context menu for bkemo cards. Renders in a portal,
 * clamped to the viewport, closes on outside click / Escape / scroll.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // clamp into viewport once measured
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="bkemo"
      data-theme="dark"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, minWidth: 180, padding: 4,
        background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      }}
    >
      {items.map((it, i) =>
        'type' in it && it.type === 'divider' ? (
          <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        ) : (
          <div
            key={i}
            onClick={() => { (it as any).onClick(); onClose(); }}
            className="h-stack"
            style={{ gap: 10, padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 13, color: (it as any).danger ? '#E0696B' : 'var(--fg)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {(it as any).icon && <span style={{ width: 16, textAlign: 'center', color: (it as any).danger ? '#E0696B' : 'var(--fg-3)' }}>{(it as any).icon}</span>}
            <span style={{ flex: 1 }}>{(it as any).label}</span>
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
