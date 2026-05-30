import { observer } from 'mobx-react-lite';
import type { BkemoRoute } from './Sidebar';

const TABS: { id: BkemoRoute; glyph: string; label: string }[] = [
  { id: 'home', glyph: '✦', label: 'Home' },
  { id: 'today', glyph: '●', label: 'Today' },
  { id: '__new', glyph: '＋', label: 'New' },
  { id: 'daily', glyph: '☉', label: 'Daily' },
  { id: '__more', glyph: '⋯', label: 'More' },
];

/** Bottom tab bar for the mobile (iOS) shell. */
export const MobileTabBar = observer(function MobileTabBar({ activeRoute, onNav, onNew, onMore }: {
  activeRoute: BkemoRoute;
  onNav: (r: BkemoRoute) => void;
  onNew: () => void;
  onMore: () => void;
}) {
  return (
    <div
      className="h-stack"
      style={{
        borderTop: '1px solid var(--border)', padding: '8px 18px max(8px, env(safe-area-inset-bottom))',
        justifyContent: 'space-between', background: 'var(--bg-2)', flexShrink: 0,
      }}
    >
      {TABS.map((t) => {
        const active = activeRoute === t.id;
        const onClick = t.id === '__new' ? onNew : t.id === '__more' ? onMore : () => onNav(t.id);
        return (
          <div key={t.id} onClick={onClick} className="v-stack" style={{ alignItems: 'center', gap: 2, color: active ? 'var(--accent)' : 'var(--fg-3)', cursor: 'pointer', minWidth: 44 }}>
            <span style={{ fontSize: 18 }}>{t.glyph}</span>
            <span style={{ fontSize: 10 }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
});
