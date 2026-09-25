import { observer } from 'mobx-react-lite';
import { pressable } from '@/lib/pressable';
import { useEffect, useRef, useState } from 'react';
import { signOut, navigate } from '@/components/Auth/auth-client';
import { eventBus } from '@/lib/event';
import { RootStore } from '@/store';
import { isInTauri, isMacOS } from '@/lib/tauriHelper';
import { BlinkoStore } from '@/store/blinkoStore';
import { BaseStore } from '@/store/baseStore';
import { UserStore } from '@/store/user';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { SIDEBAR_TOOL_OPTIONS, SIDEBAR_WIDTH, clampSidebarWidth, type SidebarToolId } from '@/lib/bkemoSettings';
import { SidebarIcon } from './SidebarIcons';
import { SidebarHeatmap } from './SidebarHeatmap';

export type BkemoRoute =
  | 'home' | 'daily' | 'random' | 'trash'
  | 'inbox' | 'today' | 'tomorrow' | 'week' | 'matrix'
  | 'analytics' | 'stats' | 'calendar' | 'graph' | 'files' | 'ai' | 'settings'
  | string; // tag:<id>

const TOOL_LABEL = Object.fromEntries(SIDEBAR_TOOL_OPTIONS.map((o) => [o.id, o.label])) as Record<SidebarToolId, string>;

const sectionLbl: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--fg-3)',
  padding: '14px 10px 4px', userSelect: 'none',
};

/** Notion-style flat row: icon, label, optional trailing hint. */
function SideRow({ icon, label, hint, active, accent, onClick }: {
  icon: React.ReactNode; label: string; hint?: React.ReactNode; active?: boolean; accent?: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      {...pressable(onClick, active)}
      aria-label={label}
      className={`h-stack bk-glass-nav${active ? ' is-active' : ''}`}
      style={{ gap: 9, padding: '6px 10px', borderRadius: 'var(--radius-lg, 10px)', fontSize: 13.5, cursor: 'pointer', userSelect: 'none', color: accent ? 'var(--accent)' : undefined, fontWeight: accent ? 600 : 500 }}
    >
      <span style={{ width: 18, display: 'flex', justifyContent: 'center', color: accent ? 'var(--accent)' : 'var(--fg-3)' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {hint}
    </div>
  );
}

function TagNavNode({ node, depth, activeRoute, onNav, collapsed, onToggle }: {
  node: any; depth: number; activeRoute: BkemoRoute; onNav: (route: BkemoRoute) => void;
  collapsed: Set<string>; onToggle: (path: string) => void;
}) {
  const path = node.metadata?.path || node.name;
  const route = `tag:${path}`;
  const active = activeRoute === route;
  const hasChildren = !!node.children?.length;
  const open = hasChildren && !collapsed.has(path);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div
        onClick={() => onNav(route)}
        {...pressable(() => onNav(route), active)}
        className={`h-stack bk-glass-nav${active ? ' is-active' : ''}`}
        style={{ gap: 6, padding: `5px 10px 5px ${6 + depth * 14}px`, borderRadius: 'var(--radius-lg, 10px)', fontSize: 13.5, cursor: 'pointer', userSelect: 'none' }}
        title={`#${path}`}
      >
        <span
          onClick={(e) => { if (!hasChildren) return; e.stopPropagation(); onToggle(path); }}
          aria-label={hasChildren ? (open ? `Collapse ${node.name}` : `Expand ${node.name}`) : undefined}
          className={hasChildren ? 'bk-side-mini' : undefined}
          style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', flexShrink: 0 }}
        >
          {hasChildren
            ? <SidebarIcon name="chevron" size={12} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
            : <SidebarIcon name="hash" size={13} />}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? 'var(--fg)' : undefined }}>
          {node.name}
        </span>
      </div>
      {open && node.children.map((child: any) => (
        <TagNavNode key={`${path}/${child.name}`} node={child} depth={depth + 1} activeRoute={activeRoute} onNav={onNav} collapsed={collapsed} onToggle={onToggle} />
      ))}
    </div>
  );
}

const COLLAPSE_KEY = 'bkemoSidebarCollapsed';
function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
}

export const Sidebar = observer(function Sidebar({ activeRoute, onNav, onNewMemo, onSearch, tools, width, showHeatmap, onWidthChange, onCustomize }: {
  activeRoute: BkemoRoute;
  onNav: (route: BkemoRoute) => void;
  onNewMemo?: () => void;
  onSearch?: () => void;
  tools: SidebarToolId[];
  width: number;
  showHeatmap?: boolean;
  onWidthChange: (width: number) => void;
  onCustomize?: () => void;
}) {
  const blinko = RootStore.Get(BlinkoStore);
  const base = RootStore.Get(BaseStore);
  const user = RootStore.Get(UserStore);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(() => localStorage.getItem('bkemoSidebarTagsOpen') !== '0');
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  // Live width while dragging; committed to prefs on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!blinko.tagList.value) blinko.tagList.call();
  }, []);

  const toggleTags = () => setTagsOpen((open) => {
    try { localStorage.setItem('bkemoSidebarTagsOpen', open ? '0' : '1'); } catch { /* ignore */ }
    return !open;
  });
  const toggleTag = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    setDragWidth(width);
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setDragWidth(clampSidebarWidth(drag.current.w + e.clientX - drag.current.x));
  };
  const onResizeEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dragWidth != null && dragWidth !== width) onWidthChange(dragWidth);
    setDragWidth(null);
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onWidthChange(clampSidebarWidth(width + (e.key === 'ArrowRight' ? 16 : -16)));
  };

  const tree = blinko.tagList.value?.listTags ?? [];
  const initials = (user?.nickname || user?.name || 'BK').slice(0, 2).toUpperCase();
  const pending = blinko.offlineNotes.length + (blinko.offlinePendingOps.list?.length ?? 0);
  const shownWidth = dragWidth ?? width;
  const nativeChrome = isInTauri() && isMacOS();

  return (
    <div
      className="bk-nav-rail"
      data-resizing={dragWidth != null ? '1' : undefined}
      style={{ width: shownWidth, height: '100%', flexShrink: 0, position: 'relative', background: 'color-mix(in srgb, var(--bg) 60%, #000 6%)', borderRight: '1px solid var(--border)' }}
    >
      {nativeChrome && <div data-tauri-drag-region style={{ height: 36 }} />}
      <div className="v-stack bk-scroll" style={{ height: nativeChrome ? 'calc(100% - 36px)' : '100%', overflowY: 'auto', overflowX: 'hidden', padding: nativeChrome ? '0 8px 10px' : '10px 8px', gap: 1 }}>
        {/* workspace switcher */}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            {...pressable(() => setShowUserMenu(!showUserMenu))}
            className={`h-stack bk-glass-nav${showUserMenu ? ' is-active' : ''}`}
            style={{ gap: 9, padding: '6px 8px', borderRadius: 'var(--radius-lg, 10px)', cursor: 'pointer', userSelect: 'none', alignItems: 'center' }}
          >
            {user?.image ? (
              <img
                src={getBlinkoEndpoint(`${user.image}?token=${user.tokenData.value?.token}`)}
                alt=""
                style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div className="bk-avatar" style={{ width: 22, height: 22, borderRadius: 6, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initials}
              </div>
            )}
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.nickname || user?.name || 'bkemo'}
            </span>
            <SidebarIcon name="chevron" size={12} style={{ color: 'var(--fg-3)', transform: 'rotate(90deg)' }} />
          </div>

          {showUserMenu && (
            <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 69, background: 'transparent' }} />
          )}
          {showUserMenu && (
            <div className="bk-glass"
              style={{ position: 'absolute', top: 38, left: 0, zIndex: 70, width: 200, borderRadius: 'var(--radius-lg)', padding: 4, display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {[
                { id: 'analytics' as BkemoRoute, label: 'Analytics' },
                { id: 'ai' as BkemoRoute, label: 'AI' },
                { id: 'graph' as BkemoRoute, label: 'Graph' },
                { id: 'calendar' as BkemoRoute, label: 'Calendar' },
                { id: 'files' as BkemoRoute, label: 'Files' },
                { id: 'settings' as BkemoRoute, label: 'Settings' },
              ].map((item) => (
                <div
                  key={item.id}
                  onClick={() => { onNav(item.id); setShowUserMenu(false); }}
                  {...pressable(() => { onNav(item.id); setShowUserMenu(false); })}
                  className="bk-glass-nav"
                  style={{ padding: '7px 10px', fontSize: 12.5, borderRadius: 'var(--radius)', cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}
                >
                  {item.label}
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
              <div
                onClick={async () => {
                  setShowUserMenu(false);
                  await signOut({ callbackUrl: '/signin', redirect: false });
                  eventBus.emit('user:signout');
                  navigate('/signin');
                }}
                className="bk-glass-nav"
                style={{ padding: '7px 10px', fontSize: 12.5, color: '#E0696B', borderRadius: 'var(--radius)', cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}
              >
                Log out
              </div>
            </div>
          )}
        </div>

        <SideRow icon={<SidebarIcon name="search" size={17} />} label="Search" onClick={onSearch} hint={<span className="bk-kbd" style={{ fontSize: 10 }}>⌘K</span>} />
        <SideRow icon={<SidebarIcon name="plus" size={17} />} label="New memo" accent onClick={onNewMemo} hint={<span className="bk-kbd" style={{ fontSize: 10 }}>⌘N</span>} />

        {/* customizable toolbar */}
        {tools.length > 0 && (
          <div
            role="toolbar"
            aria-label="Sidebar shortcuts"
            className="bk-side-toolbar"
            onContextMenu={onCustomize ? (e) => { e.preventDefault(); onCustomize(); } : undefined}
            style={{ display: 'grid', gridTemplateColumns: `repeat(${tools.length}, 1fr)`, gap: 4, margin: '8px 0 4px' }}
          >
            {tools.map((id) => {
              const active = activeRoute === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={TOOL_LABEL[id]}
                  aria-current={active ? 'page' : undefined}
                  data-tip={TOOL_LABEL[id]}
                  onClick={() => onNav(id)}
                  className={`bk-side-tool bk-glass-nav${active ? ' is-active' : ''}`}
                >
                  <SidebarIcon name={id} size={18} />
                </button>
              );
            })}
          </div>
        )}

        {showHeatmap && <SidebarHeatmap onOpenCalendar={() => onNav('calendar')} />}

        {/* tags */}
        <div
          onClick={toggleTags}
          {...pressable(toggleTags)}
          aria-expanded={tagsOpen}
          className="h-stack bk-side-section"
          style={{ ...sectionLbl, gap: 4, cursor: 'pointer' }}
        >
          <span style={{ flex: 1 }}>Tags</span>
          <SidebarIcon name="chevron" size={11} style={{ transform: tagsOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
        </div>
        {tagsOpen && tree.map((t: any) => (
          <TagNavNode key={t.metadata?.path || t.name} node={t} depth={0} activeRoute={activeRoute} onNav={onNav} collapsed={collapsed} onToggle={toggleTag} />
        ))}
        {tagsOpen && tree.length === 0 && (
          <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--fg-3)' }}>Tags you write, like #idea, show up here.</div>
        )}

        <div style={{ flex: 1 }} />

        {/* footer */}
        <div className="h-stack" style={{ padding: '10px 10px 2px', marginTop: 8, borderTop: '1px solid var(--border)', gap: 8, fontSize: 12, color: 'var(--fg-3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: base.isOnline ? '#3FCB7E' : '#E0696B' }} />
          <span style={{ flex: 1 }}>{base.isOnline ? 'Synced' : 'Offline'}{pending > 0 ? ` · ${pending} pending` : ''}</span>
          <button type="button" className="bk-side-mini" aria-label="Settings" title="Settings" onClick={() => onNav('settings')}>
            <SidebarIcon name="settings" size={14} />
          </button>
        </div>
      </div>

      {/* resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={shownWidth}
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        className="bk-side-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => onWidthChange(SIDEBAR_WIDTH.default)}
        onKeyDown={onResizeKey}
      />
    </div>
  );
});
