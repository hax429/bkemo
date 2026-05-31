import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { signOut, navigate } from '@/components/Auth/auth-client';
import { eventBus } from '@/lib/event';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { BaseStore } from '@/store/baseStore';
import { UserStore } from '@/store/user';
import { getBkemoConfig } from '@/lib/bkemoConfig';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

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
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (!blinko.tagList.value) blinko.tagList.call();
  }, []);

  const tree = blinko.tagList.value?.listTags ?? [];
  const initials = (user?.nickname || user?.name || 'BK').slice(0, 2).toUpperCase();
  const pending = blinko.offlinePendingOps.list?.length ?? 0;
  const { closeDailyReview } = getBkemoConfig();
  const notesNav = closeDailyReview ? NOTES_NAV.filter((n) => n.id !== 'daily') : NOTES_NAV;

  return (
    <div style={{ width: 248, height: '100%', flexShrink: 0, position: 'relative', background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}>
      <div className="v-stack bk-scroll" style={{ height: '100%', overflow: 'auto', padding: '10px 6px 8px', gap: 1 }}>
        {/* workspace trigger */}
        <div style={{ position: 'relative' }}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="h-stack"
            style={{
              gap: 8,
              padding: '6px 10px',
              margin: '0 2px 10px',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              userSelect: 'none',
              alignItems: 'center',
              background: showUserMenu ? 'var(--hover)' : 'transparent',
              transition: 'background .15s'
            }}
            onMouseEnter={(e) => { if (!showUserMenu) e.currentTarget.style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { if (!showUserMenu) e.currentTarget.style.background = 'transparent'; }}
          >
            {user?.image ? (
              <img
                src={getBlinkoEndpoint(`${user.image}?token=${user.tokenData.value?.token}`)}
                alt="avatar"
                style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div className="bk-avatar" style={{ width: 22, height: 22, borderRadius: 5, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', margin: '0 4px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)', lineHeight: 1.2 }}>bkemo</div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'left', lineHeight: 1.2 }}>{user?.nickname || user?.name || 'Guest'}</div>
            </div>
            <span style={{ color: 'var(--fg-3)', fontSize: 9, flexShrink: 0 }}>▼</span>
          </div>

          {/* Back-drop overlay */}
          {showUserMenu && (
            <div
              onClick={() => setShowUserMenu(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 69,
                background: 'transparent'
              }}
            />
          )}

          {/* Dropdown Menu */}
          {showUserMenu && (
            <div
              style={{
                position: 'absolute',
                top: 34,
                left: 2,
                zIndex: 70,
                width: 140,
                background: 'var(--bg-2)',
                border: '1px solid var(--border-2)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1
              }}
            >
              <div
                onClick={() => {
                  onNav('settings');
                  setShowUserMenu(false);
                }}
                style={{
                  padding: '8px 12px',
                  fontSize: 12.5,
                  color: 'var(--fg)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 500
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 13 }}>⚙</span>
                <span>Settings</span>
              </div>
              <div
                style={{
                  height: 1,
                  background: 'var(--border)',
                  margin: '3px 0'
                }}
              />
              <div
                onClick={async () => {
                  setShowUserMenu(false);
                  await signOut({ callbackUrl: '/signin', redirect: false });
                  eventBus.emit('user:signout');
                  navigate('/signin');
                }}
                style={{
                  padding: '8px 12px',
                  fontSize: 12.5,
                  color: '#E0696B',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 500
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 13 }}>🚪</span>
                <span>Log out</span>
              </div>
            </div>
          )}
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
        {notesNav.map((n) => (
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
