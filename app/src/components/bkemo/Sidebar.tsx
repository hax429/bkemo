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
  | 'stats' | 'calendar' | 'graph' | 'files' | 'settings'
  | string; // tag:<id>

const NOTES_NAV: { id: BkemoRoute; icon: string; title: string }[] = [
  { id: 'home', icon: '✦', title: 'Home' },
  { id: 'daily', icon: '☉', title: 'Daily review' },
  { id: 'random', icon: '↻', title: 'Random' },
  { id: 'trash', icon: '⌫', title: 'Trash' },
];
const TODOS_NAV: { id: BkemoRoute; icon: string; title: string }[] = [
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
        gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-lg, 12px)',
        background: active ? 'var(--hover)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-2)',
        fontSize: 13.5, cursor: 'pointer', userSelect: 'none',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'all 0.12s ease-in-out',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 16, fontSize: 13, textAlign: 'center', color: active ? 'var(--accent)' : 'var(--fg-3)', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      {count != null && <span style={{ color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{count}</span>}
    </div>
  );
}

const sectionLbl: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em',
  color: 'var(--fg-3)', textTransform: 'lowercase', fontWeight: 500,
  padding: '16px 12px 6px',
};

function TagNavNode({ node, depth, activeRoute, onNav }: { node: any; depth: number; activeRoute: BkemoRoute; onNav: (route: BkemoRoute) => void }) {
  const path = node.metadata?.path || node.name;
  const route = `tag:${path}`;
  const active = activeRoute === route;
  const hasChildren = !!node.children?.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div
        onClick={() => onNav(route)}
        className="h-stack"
        style={{
          gap: 8,
          padding: depth === 0 ? '8px 12px' : `6px 12px 6px ${24 + depth * 14}px`,
          borderRadius: 'var(--radius-lg, 12px)',
          fontSize: depth === 0 ? 13.5 : 12.5,
          cursor: 'pointer',
          transition: 'all 0.12s ease-in-out',
          color: active ? 'var(--fg)' : 'var(--fg-2)',
          background: active ? 'var(--hover)' : 'transparent'
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        title={`#${path}`}
      >
        <span style={{ width: 10, fontSize: 9, color: 'var(--fg-3)', flexShrink: 0 }}>{hasChildren ? '▾' : depth === 0 ? ' ' : '└'}</span>
        <span style={{ color: 'var(--accent)', opacity: depth === 0 ? 1 : 0.72, fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          #{node.name}
        </span>
      </div>
      {node.children?.map((child: any) => (
        <TagNavNode key={`${path}/${child.name}`} node={child} depth={depth + 1} activeRoute={activeRoute} onNav={onNav} />
      ))}
    </div>
  );
}

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
  const [showMore, setShowMore] = useState(true);

  useEffect(() => {
    if (!blinko.tagList.value) blinko.tagList.call();
  }, []);

  const tree = blinko.tagList.value?.listTags ?? [];
  const initials = (user?.nickname || user?.name || 'BK').slice(0, 2).toUpperCase();
  const pending = blinko.offlinePendingOps.list?.length ?? 0;
  const { closeDailyReview } = getBkemoConfig();
  const notesNav = closeDailyReview ? NOTES_NAV.filter((n) => n.id !== 'daily') : NOTES_NAV;

  // Collapsible logic to make sidebar breathe
  const notesToShow = showMore ? notesNav : notesNav.filter((n) => n.id === 'home');
  const todosToShow = showMore ? TODOS_NAV : TODOS_NAV.filter((t) => t.id === 'today');
  const tagsToShow = showMore ? tree : tree.slice(0, 3);

  return (
    <div style={{ width: 248, height: '100%', flexShrink: 0, position: 'relative', background: 'color-mix(in srgb, var(--bg) 60%, #000 6%)', borderRight: '1px solid var(--border)' }}>
      <div className="v-stack bk-scroll" style={{ height: '100%', overflow: 'auto', padding: '12px 8px 12px', gap: 2 }}>
        {/* workspace trigger */}
        <div style={{ position: 'relative' }}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="h-stack"
            style={{
              gap: 8,
              padding: '8px 10px',
              margin: '0 2px 10px',
              borderRadius: 'var(--radius-lg, 12px)',
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
                style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div className="bk-avatar" style={{ width: 22, height: 22, borderRadius: 6, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
                top: 36,
                left: 2,
                zIndex: 70,
                width: 160,
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
              {[
                { id: 'graph' as BkemoRoute, icon: '⊚', label: 'Graph' },
                { id: 'calendar' as BkemoRoute, icon: '▦', label: 'Calendar' },
                { id: 'files' as BkemoRoute, icon: '◳', label: 'Files' },
                { id: 'settings' as BkemoRoute, icon: '⚙', label: 'Settings' },
              ].map((item) => (
                <div
                  key={item.id}
                  onClick={() => { onNav(item.id); setShowUserMenu(false); }}
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
                  <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              ))}
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
        <div onClick={onSearch} className="h-stack" style={{ margin: '0 4px 8px', padding: '7px 12px', background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg, 12px)', gap: 10, color: 'var(--fg-3)', fontSize: 13, cursor: 'pointer', transition: 'all 0.12s ease-in-out' }}
             onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
             onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-2)'}
        >
          <span>⌕</span><span style={{ flex: 1 }}>Search…</span>
          <span className="bk-kbd" style={{ fontSize: 10 }}>⌘K</span>
        </div>

        {/* new memo */}
        <div onClick={onNewMemo} className="h-stack" style={{ margin: '0 4px 14px', padding: '8px 12px', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 'var(--radius-lg, 12px)', gap: 10, color: 'var(--accent)', fontSize: 13.5, cursor: 'pointer', fontWeight: 600, transition: 'all 0.12s ease-in-out' }}
             onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
             onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
        >
          <span>＋</span><span style={{ flex: 1 }}>New memo</span>
          <span className="bk-kbd" style={{ fontSize: 10, background: 'rgba(255,255,255,0.08)' }}>⌘N</span>
        </div>

        <div style={sectionLbl}>journal</div>
        {notesToShow.map((n) => (
          <NavRow key={n.id} icon={n.icon} title={n.title} active={activeRoute === n.id} onClick={() => onNav(n.id)} />
        ))}

        <div style={sectionLbl}>tasks</div>
        {todosToShow.map((n) => (
          <NavRow key={n.id} icon={n.icon} title={n.title} active={activeRoute === n.id} onClick={() => onNav(n.id)} />
        ))}

        <div style={sectionLbl}>projects</div>
        {tagsToShow.map((t: any) => <TagNavNode key={t.metadata?.path || t.name} node={t} depth={0} activeRoute={activeRoute} onNav={onNav} />)}

        {/* Collapsible trigger */}
        {(notesNav.length > notesToShow.length || TODOS_NAV.length > todosToShow.length || tree.length > tagsToShow.length) && (
          <div
            onClick={() => setShowMore(!showMore)}
            className="h-stack"
            style={{
              gap: 10, padding: '8px 12px', marginTop: 8, borderRadius: 'var(--radius-lg, 12px)',
              color: 'var(--fg-3)', fontSize: 13, cursor: 'pointer', userSelect: 'none',
              transition: 'all 0.12s ease-in-out',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ width: 16, fontSize: 12, textAlign: 'center' }}>{showMore ? '▴' : '▾'}</span>
            <span>{showMore ? 'Show less' : 'More…'}</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* footer sync status */}
        <div className="h-stack" style={{ padding: '12px 12px 4px', borderTop: '1px solid var(--border)', gap: 8, fontSize: 12, color: 'var(--fg-3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: base.isOnline ? '#3FCB7E' : '#E0696B' }} />
          <span>{base.isOnline ? 'Synced' : 'Offline'}{pending > 0 ? ` · ${pending} pending` : ''}</span>
        </div>
      </div>
    </div>
  );
});
