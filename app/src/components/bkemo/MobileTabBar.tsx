import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { BkemoRoute } from './Sidebar';

const MORE_ITEMS: { id: BkemoRoute; glyph: string; label: string }[] = [
  { id: 'graph', glyph: '⊚', label: 'Graph' },
  { id: 'calendar', glyph: '▦', label: 'Calendar' },
  { id: 'files', glyph: '◳', label: 'Files' },
  { id: 'matrix', glyph: '⊞', label: 'Matrix' },
  { id: 'week', glyph: '▥', label: 'This week' },
  { id: 'analytics', glyph: '▤', label: 'Analytics' },
  { id: 'ai', glyph: '✧', label: 'AI' },
];

const MORE_ROUTES = new Set(MORE_ITEMS.map((item) => item.id));

function MoreSheet({ activeRoute, onPick, onClose }: {
  activeRoute: BkemoRoute;
  onPick: (route: BkemoRoute) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.52)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More tools"
        onClick={(event) => event.stopPropagation()}
        style={{ width: '100%', borderRadius: '18px 18px 0 0', borderTop: '1px solid var(--border-2)', background: 'var(--bg)', padding: '10px 14px max(18px, env(safe-area-inset-bottom))', boxShadow: '0 -18px 50px rgba(0,0,0,.28)' }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 999, background: 'var(--border-2)', margin: '2px auto 14px' }} />
        <div style={{ color: 'var(--fg)', fontSize: 15, fontWeight: 600, padding: '0 2px 10px' }}>More</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {MORE_ITEMS.map((item) => {
            const active = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { onPick(item.id); onClose(); }}
                style={{ minHeight: 54, display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 'var(--radius-lg)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-soft)' : 'var(--bg-2)', color: active ? 'var(--accent)' : 'var(--fg)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
              >
                <span aria-hidden="true" style={{ width: 23, fontSize: 18, textAlign: 'center' }}>{item.glyph}</span>
                <span style={{ fontSize: 13, fontWeight: 550 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Bottom tab bar for the mobile (iOS) shell. */
export const MobileTabBar = observer(function MobileTabBar({ activeRoute, onNav, onNew }: {
  activeRoute: BkemoRoute;
  onNav: (r: BkemoRoute) => void;
  onNew: () => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const tabs: { id: BkemoRoute | '__new' | '__more'; glyph: string; label: string }[] = [
    { id: 'home', glyph: '✦', label: 'Home' },
    { id: 'today', glyph: '●', label: 'Today' },
    { id: '__new', glyph: '＋', label: 'New' },
    { id: '__more', glyph: '⋯', label: 'More' },
    { id: 'settings', glyph: '⚙', label: 'Settings' },
  ];
  return (
    <>
      <div
        className="h-stack"
        style={{
          borderTop: '1px solid var(--border)', padding: '8px 18px max(8px, env(safe-area-inset-bottom))',
          justifyContent: 'space-between', background: 'var(--bg-2)', flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === '__more' ? MORE_ROUTES.has(activeRoute) : activeRoute === tab.id;
          const onClick = tab.id === '__new' ? onNew : tab.id === '__more' ? () => setShowMore(true) : () => onNav(tab.id);
          return (
            <button key={tab.id} type="button" onClick={onClick} className="v-stack" style={{ alignItems: 'center', gap: 2, color: active ? 'var(--accent)' : 'var(--fg-3)', cursor: 'pointer', minWidth: 44, border: 0, padding: 0, background: 'transparent', font: 'inherit' }}>
              <span aria-hidden="true" style={{ fontSize: 18 }}>{tab.glyph}</span>
              <span style={{ fontSize: 10 }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {showMore && <MoreSheet activeRoute={activeRoute} onPick={onNav} onClose={() => setShowMore(false)} />}
    </>
  );
});
