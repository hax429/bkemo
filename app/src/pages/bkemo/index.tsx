import { observer } from 'mobx-react-lite';
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMediaQuery } from 'usehooks-ts';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { eventBus } from '@/lib/event';
import { api } from '@/lib/trpc';
import type { Note } from '@shared/lib/types';
import { loadPrefs, savePrefs, hydratePrefs, type BkemoPrefs } from '@/lib/bkemoSettings';
import { getBkemoConfig } from '@/lib/bkemoConfig';
import { isInTauri } from '@/lib/tauriHelper';
import { isTask } from '@/lib/taskFilters';
import { ensureNotificationPermission, syncTaskNotifications } from '@/lib/taskNotifications';
import { FontManager } from '@/lib/fontManager';
import { SettingsScreen } from '@/components/bkemo/SettingsScreen';
import { BkemoLayout } from '@/components/bkemo/BkemoLayout';
import { Sidebar, type BkemoRoute } from '@/components/bkemo/Sidebar';
import { MobileTabBar } from '@/components/bkemo/MobileTabBar';
import { Stream } from '@/components/bkemo/Stream';
import { Todos, type TodoView } from '@/components/bkemo/Todos';
import { Trash } from '@/components/bkemo/Trash';
import { Random } from '@/components/bkemo/Random';
import { Calendar } from '@/components/bkemo/Calendar';
import { Graph } from '@/components/bkemo/Graph';
import { FilesScreen } from '@/components/bkemo/FilesScreen';
import { Analytics } from '@/components/bkemo/Analytics';
import { AIScreen } from '@/components/bkemo/AIScreen';
import { AIDebugPanel } from '@/components/bkemo/ai/AIDebugPanel';
import { NoteModal } from '@/components/bkemo/NoteModal';
import { SearchOverlay } from '@/components/bkemo/SearchOverlay';
import { UserStore } from '@/store/user';
import { pathForRoute, pathForSettingsSection, routeFromPath, settingsSectionFromPath } from '@/lib/bkemoRoutes';
import { isAiDebugAvailable } from '@/lib/aiDebug';

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {title} — coming soon
      </div>
    </div>
  );
}

const TODO_VIEWS: TodoView[] = ['inbox', 'today', 'week', 'matrix'];

const BkemoPage = observer(function BkemoPage() {
  const [prefs, setPrefs] = useState<BkemoPrefs>(() => loadPrefs());
  const [editing, setEditing] = useState<Note | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const user = RootStore.Get(UserStore);
  const location = useLocation();
  const navigate = useNavigate();
  const parsedLocation = routeFromPath(location.pathname);
  const route = parsedLocation.route;
  const settingsSection = settingsSectionFromPath(location.pathname);

  const updatePrefs = (p: Partial<BkemoPrefs>) => {
    setPrefs((prev) => { const next = { ...prev, ...p }; savePrefs(next); return next; });
  };
  // The URL is canonical, but navigation intentionally replaces the current
  // entry so browser Back does not walk through bkemo screens.
  const navigateTo = (next: BkemoRoute) => navigate(pathForRoute(next), { replace: true });
  const navigateSettings = (section: string) => navigate(pathForSettingsSection(section), { replace: true });

  const cfg = getBkemoConfig();

  useEffect(() => {
    if (!parsedLocation.known) navigate('/', { replace: true });
  }, [navigate, parsedLocation.known]);

  useEffect(() => {
    const noteMatch = location.pathname.match(/^\/n\/(\d+)$/);
    if (!noteMatch) return;
    let cancelled = false;
    api.notes.detail.mutate({ id: Number(noteMatch[1]) })
      .then((note) => { if (!cancelled && note) setEditing(note as Note); })
      .catch((error) => {
        console.error('[bkemo] direct note load failed:', error);
        if (!cancelled) navigate('/', { replace: true });
      });
    return () => { cancelled = true; };
  }, [location.pathname, navigate]);

  // Ensure tags are loaded for #-autocomplete (sidebar isn't mounted on mobile).
  useEffect(() => {
    const blinko = RootStore.Get(BlinkoStore);
    if (!blinko.tagList.value) blinko.tagList.call();
    // Load the persisted preference config that the workspace honors.
    // After config loads, hydrate bkemoPrefs from server so appearance
    // follows the account across devices.
    blinko.config.call().then((cfg: any) => {
      if (cfg?.bkemoPrefs) {
        setPrefs(hydratePrefs(cfg.bkemoPrefs));
      }
    }).catch(() => { /* ignore */ });
    // Android share intents (from lib/hooks useAndroidShortcuts) → open composer.
    const onQuickCapture = (opts: { text?: string } = {}) => {
      setEditing({ content: opts.text ?? '', type: 2 } as Note);
    };
    eventBus.on('bkemo:quick-capture', onQuickCapture);
    // Clicking an internal [[memo]] link opens that memo in the editor.
    const onOpenNote = async (opts: { id?: number } = {}) => {
      if (!opts.id) return;
      try {
        const note = await api.notes.detail.mutate({ id: opts.id });
        if (note) {
          setEditing(note as Note);
          navigate(`/n/${opts.id}`, { replace: true });
        }
      } catch (e) {
        console.error('[bkemo] open linked note failed:', e);
      }
    };
    eventBus.on('bkemo:open-note', onOpenNote);
    return () => {
      eventBus.off('bkemo:quick-capture', onQuickCapture);
      eventBus.off('bkemo:open-note', onOpenNote);
    };
  }, [navigate]);

  // Apply the custom font-style (registers the @font-face + sets --font-family,
  // which .bkemo reads). Re-runs when the setting changes.
  useEffect(() => {
    if (cfg.fontStyle && cfg.fontStyle !== 'default') {
      FontManager.applyFont(cfg.fontStyle).catch(() => { /* ignore */ });
    }
  }, [cfg.fontStyle]);

  // Native task reminders: in the desktop/mobile app, schedule OS notifications
  // for open tasks at their due time. Reconciles on note changes + reconnect.
  useEffect(() => {
    if (!isInTauri() || prefs.taskReminders === false) return;
    const blinko = RootStore.Get(BlinkoStore);
    let cancelled = false;
    const sync = async () => {
      try {
        if (!(await ensureNotificationPermission())) return;
        const tasks = await blinko.queryNotes({ type: -1, isCompleted: false }, 1, 500);
        if (!cancelled) await syncTaskNotifications(tasks.filter(isTask));
      } catch (e) { console.warn('[notif] task sync failed:', e); }
    };
    sync();
    eventBus.on('app:online', sync);
    return () => { cancelled = true; eventBus.off('app:online', sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.taskReminders, RootStore.Get(BlinkoStore).updateTicker]);

  const newMemo = () => setEditing({ content: '', type: 2 } as Note);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const render = () => {
    if (route === 'home') return <Stream onOpen={setEditing} onNew={newMemo} onExpand={setEditing} />;
    if (route === 'random') return <Random onOpen={setEditing} />;
    if (route === 'trash') return <Trash />;
    if (route === 'calendar') return <Calendar onOpen={setEditing} />;
    if (route === 'graph') return <Graph onOpen={setEditing} showAll={prefs.graphShowAll} />;
    if (route === 'files') return <FilesScreen />;
    if (route === 'analytics' || route === 'stats') return <Analytics />;
    if (route === 'ai') return <AIScreen onOpen={setEditing} />;
    if (route === 'settings') return <SettingsScreen prefs={prefs} onChange={updatePrefs} onNavigate={navigateTo} onSearch={() => setShowSearch(true)} section={settingsSection} onSectionChange={navigateSettings} />;
    if (TODO_VIEWS.includes(route as TodoView)) {
      return <Todos view={route as TodoView} onView={navigateTo} onOpen={setEditing} />;
    }
    if (typeof route === 'string' && route.startsWith('tag:')) {
      return <Stream onOpen={setEditing} onNew={newMemo} onExpand={setEditing} tag={route.slice(4)} />;
    }
    return <ComingSoon title="bkemo" />;
  };

  return (
    <BkemoLayout density={prefs.density} accent={prefs.accent} theme={prefs.theme} bgGradient={prefs.bgGradient}>
      <div className="v-stack" style={{ height: '100%', width: '100%' }}>
        {user.isImpersonating && (
          <div className="h-stack" style={{ flexShrink: 0, gap: 10, padding: '6px 14px', background: 'var(--accent)', color: '#fff', fontSize: 12.5, alignItems: 'center', justifyContent: 'center' }}>
            <span>👁 Viewing as <b>{user.nickname || user.name}</b> — you are seeing this account's data as an admin.</span>
            <button
              onClick={() => user.stopImpersonating()}
              style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', padding: '3px 12px', borderRadius: 100, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
            >
              Return to admin
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          {isMobile ? (
            <div className="v-stack" style={{ height: '100%', width: '100%' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{render()}</div>
              <MobileTabBar
                activeRoute={route}
                onNav={navigateTo}
                onNew={newMemo}
              />
            </div>
          ) : (
            <div className="h-stack" style={{ height: '100%', width: '100%' }}>
              <Sidebar activeRoute={route} onNav={navigateTo} onNewMemo={newMemo} onSearch={() => setShowSearch(true)} />
              {render()}
            </div>
          )}
        </div>
      </div>
      {editing && <NoteModal note={editing} onClose={() => { setEditing(null); if (/^\/n\/\d+$/.test(location.pathname)) navigate('/', { replace: true }); }} />}
      {showSearch && <SearchOverlay onOpen={setEditing} onClose={() => setShowSearch(false)} />}
      {isAiDebugAvailable() ? <AIDebugPanel /> : null}
    </BkemoLayout>
  );
});

export default BkemoPage;
