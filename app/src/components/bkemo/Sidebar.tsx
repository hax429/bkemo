import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { BaseStore } from '@/store/baseStore';
import { UserStore } from '@/store/user';

export type BkemoRoute =
  | 'home' | 'daily' | 'random' | 'trash'
  | 'inbox' | 'today' | 'tomorrow' | 'week' | 'matrix'
  | 'stats' | 'calendar' | 'settings'
  | string; // tag:<id>

const NOTES_NAV: { id: BkemoRoute; icon: string; title: string }[] = [
  { id: 'home', icon: '✦', title: 'Home' },
  { id: 'daily', icon: '☉', title: 'Daily review' },
  { id: 'random', icon: '↻', title: 'Random' },
  { id: 'trash', icon: '⌫', title: 'Trash' },
];
const TODOS_NAV: { id: BkemoRoute; icon: string; title: string }[] = [
  { id: 'inbox', icon: '▤', title: 'Inbox' },
  { id: 'today', icon: '●', title: 'Today' },
  { id: 'tomorrow', icon: '○', title: 'Tomorrow' },
  { id: 'week', icon: '▦', title: 'This week' },
  { id: 'matrix', icon: '⊞', title: 'Matrix' },
];

function NavRow({ icon, title, count, active, onClick }: { icon: string; title: string; count?: number | null; active?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className="h-stack"
      style={{
        gap: 8, padding: '5px 8px', borderRadius: 'var(--radius)',
        background: active ? 'var(--hover)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-2)',
        fontSize: 13, cursor: 'pointer', userSelect: 'none',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 16, fontSize: 12, textAlign: 'center', color: active ? 'var(--accent)' : 'var(--fg-3)', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      {count != null && <span style={{ color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{count}</span>}
    </div>
  );
}

const sectionLbl: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.10em',
  color: 'var(--fg-3)', textTransform: 'uppercase', fontWeight: 500,
  padding: '10px 12px 6px',
};

export const Sidebar = observer(function Sidebar({ activeRoute, onNav, onNewMemo, onSearch }: {
  activeRoute: BkemoRoute;
  onNav: (route: BkemoRoute) => void;
  onNewMemo?: () => void;
  onSearch?: () => void;
}) {
  const blinko = RootStore.Get(BlinkoStore);
  const base = RootStore.Get(BaseStore);
  const user = RootStore.Get(UserStore);

  useEffect(() => {
    if (!blinko.tagList.value) blinko.tagList.call();
  }, []);

  const tree = blinko.tagList.value?.listTags ?? [];
  const initials = (user?.nickname || user?.name || 'BK').slice(0, 2).toUpperCase();
  const pending = blinko.offlinePendingOps.list?.length ?? 0;

  return (
    <div style={{ width: 248, height: '100%', flexShrink: 0, position: 'relative', background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}>
      <div className="v-stack bk-scroll" style={{ height: '100%', overflow: 'auto', padding: '10px 6px 8px', gap: 1 }}>
        {/* workspace trigger */}
        <div className="h-stack" style={{ gap: 8, padding: '6px 10px', margin: '0 2px 10px', borderRadius: 'var(--radius)' }}>
          <div className="bk-avatar" style={{ width: 22, height: 22, borderRadius: 5, fontSize: 11 }}>{initials}</div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)', flex: 1 }}>bkemo</div>
          <span onClick={() => onNav('settings')} title="Settings" style={{ color: 'var(--fg-3)', fontSize: 13, cursor: 'pointer' }}>⚙</span>
        </div>

        {/* search */}
        <div onClick={onSearch} className="h-stack" style={{ margin: '0 6px 8px', padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', gap: 8, color: 'var(--fg-3)', fontSize: 12, cursor: 'pointer' }}>
          <span>⌕</span><span style={{ flex: 1 }}>Search…</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>⌘K</span>
        </div>

        {/* new memo */}
        <div onClick={onNewMemo} className="h-stack" style={{ margin: '0 6px 14px', padding: '6px 10px', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)', borderRadius: 'var(--radius)', gap: 8, color: 'var(--accent)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
          <span>＋</span><span style={{ flex: 1 }}>New memo</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>⌘N</span>
        </div>

        <div style={sectionLbl}>Notes</div>
        {NOTES_NAV.map((n) => (
          <NavRow key={n.id} icon={n.icon} title={n.title} active={activeRoute === n.id} onClick={() => onNav(n.id)} />
        ))}

        <div style={sectionLbl}>Todos</div>
        {TODOS_NAV.map((n) => (
          <NavRow key={n.id} icon={n.icon} title={n.title} active={activeRoute === n.id} onClick={() => onNav(n.id)} />
        ))}

        <div className="h-stack" style={{ ...sectionLbl, alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1 }}>Projects (tags)</span>
        </div>
        {tree.map((t: any) => (
          <div key={t.name}>
            <div
              onClick={() => onNav(`tag:${t.name}`)}
              className="h-stack"
              style={{ gap: 6, padding: '4px 8px', borderRadius: 'var(--radius)', fontSize: 13, cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 10, fontSize: 9, color: 'var(--fg-3)' }}>{t.children?.length ? '▾' : ' '}</span>
              <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', flex: 1 }}>#{t.name}</span>
            </div>
            {t.children?.map((c: any) => (
              <div
                key={c.name}
                onClick={() => onNav(`tag:${t.name}/${c.name}`)}
                className="h-stack"
                style={{ gap: 6, padding: '3px 8px 3px 30px', fontSize: 12, cursor: 'pointer', borderRadius: 'var(--radius)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: 'var(--accent)', opacity: 0.75, fontFamily: 'var(--font-mono)', flex: 1 }}>#{c.name}</span>
              </div>
            ))}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {/* footer sync status */}
        <div className="h-stack" style={{ padding: '10px 12px 4px', borderTop: '1px solid var(--border)', gap: 8, fontSize: 12, color: 'var(--fg-3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: base.isOnline ? '#3FCB7E' : '#E0696B' }} />
          <span>{base.isOnline ? 'Synced' : 'Offline'}{pending > 0 ? ` · ${pending} pending` : ''}</span>
        </div>
      </div>
    </div>
  );
});
