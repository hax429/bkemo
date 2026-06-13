import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPrefs } from '@/lib/bkemoSettings';

export type MenuItem =
  | { type?: 'item'; label: string; icon?: string; danger?: boolean; onClick: () => void }
  | { type: 'divider' };

/**
 * Standard "more actions" trigger for bkemo cards — a real, tappable kebab button
 * (proper 28px hit area + hover state) instead of a dim text node. Pair it with a
 * `.bk-memo` ancestor to get the hover-reveal behaviour from bkemo-theme.css.
 */
export function MoreButton({
  onClick,
  title = 'More actions',
  size = 28,
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className="bk-more-btn"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      style={{
        width: size, height: size, padding: 0, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--fg-3)',
        cursor: 'pointer', fontSize: Math.round(size * 0.64), lineHeight: 1,
      }}
    >
      ⋯
    </button>
  );
}

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

  const prefs = loadPrefs();
  const preset = prefs.theme === 'light' ? 'light' : (prefs.accent?.toLowerCase() === '#5e6ad2' ? 'developer' : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));

  return createPortal(
    <div
      ref={ref}
      className="bkemo"
      data-theme={prefs.theme}
      data-preset={preset}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, minWidth: 196, padding: 5,
        background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {})
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
            style={{ gap: 10, padding: '8px 11px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: (it as any).danger ? '#E0696B' : 'var(--fg)' }}
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
