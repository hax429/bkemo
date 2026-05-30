import { observer } from 'mobx-react-lite';
import { useState, useEffect } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { loadPrefs, savePrefs, type BkemoPrefs } from '@/lib/bkemoSettings';
import { SettingsScreen } from '@/components/bkemo/SettingsScreen';
import { BkemoLayout } from '@/components/bkemo/BkemoLayout';
import { Sidebar, type BkemoRoute } from '@/components/bkemo/Sidebar';
import { MobileTabBar } from '@/components/bkemo/MobileTabBar';
import { Stream } from '@/components/bkemo/Stream';
import { Todos, type TodoView } from '@/components/bkemo/Todos';
import { Trash } from '@/components/bkemo/Trash';
import { Random } from '@/components/bkemo/Random';
import { DailyReview } from '@/components/bkemo/DailyReview';
import { Calendar } from '@/components/bkemo/Calendar';
import { Stats } from '@/components/bkemo/Stats';
import { NoteModal } from '@/components/bkemo/NoteModal';

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

const MORE_ITEMS: { id: BkemoRoute; label: string }[] = [
  { id: 'inbox', label: 'Inbox' }, { id: 'tomorrow', label: 'Tomorrow' }, { id: 'week', label: 'This week' }, { id: 'matrix', label: 'Matrix' },
  { id: 'random', label: 'Random' }, { id: 'calendar', label: 'Calendar' }, { id: 'stats', label: 'Stats' }, { id: 'trash', label: 'Trash' },
];

function MoreSheet({ onPick, onClose }: { onPick: (r: BkemoRoute) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg)', borderTop: '1px solid var(--border-2)', borderRadius: '16px 16px 0 0', padding: '12px 12px max(16px, env(safe-area-inset-bottom))' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-2)', margin: '4px auto 12px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {MORE_ITEMS.map((m) => (
            <div key={m.id} onClick={() => { onPick(m.id); onClose(); }} style={{ padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)', fontSize: 14, cursor: 'pointer' }}>{m.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TODO_VIEWS: TodoView[] = ['inbox', 'today', 'tomorrow', 'week', 'matrix'];

const BkemoPage = observer(function BkemoPage() {
  const [route, setRoute] = useState<BkemoRoute>('home');
  const [prefs, setPrefs] = useState<BkemoPrefs>(() => loadPrefs());
  const [editing, setEditing] = useState<Note | null>(null);
  const [showMore, setShowMore] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const updatePrefs = (p: Partial<BkemoPrefs>) => {
    setPrefs((prev) => { const next = { ...prev, ...p }; savePrefs(next); return next; });
  };

  // Ensure tags are loaded for #-autocomplete (sidebar isn't mounted on mobile).
  useEffect(() => {
    const blinko = RootStore.Get(BlinkoStore);
    if (!blinko.tagList.value) blinko.tagList.call();
  }, []);

  const render = () => {
    if (route === 'home') return <Stream onOpen={setEditing} />;
    if (route === 'daily') return <DailyReview onOpen={setEditing} />;
    if (route === 'random') return <Random onOpen={setEditing} />;
    if (route === 'trash') return <Trash />;
    if (route === 'calendar') return <Calendar onOpen={setEditing} />;
    if (route === 'stats') return <Stats />;
    if (route === 'settings') return <SettingsScreen prefs={prefs} onChange={updatePrefs} />;
    if (TODO_VIEWS.includes(route as TodoView)) {
      return <Todos view={route as TodoView} onView={(v) => setRoute(v)} onOpen={setEditing} />;
    }
    if (typeof route === 'string' && route.startsWith('tag:')) {
      return <Stream onOpen={setEditing} tag={route.slice(4)} />;
    }
    return <ComingSoon title="bkemo" />;
  };

  return (
    <BkemoLayout density={prefs.density} accent={prefs.accent} theme={prefs.theme}>
      {isMobile ? (
        <div className="v-stack" style={{ height: '100%', width: '100%' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{render()}</div>
          <MobileTabBar
            activeRoute={route}
            onNav={setRoute}
            onNew={() => setEditing({ content: '', type: 2 } as Note)}
            onMore={() => setShowMore(true)}
          />
          {showMore && <MoreSheet onPick={setRoute} onClose={() => setShowMore(false)} />}
        </div>
      ) : (
        <div className="h-stack" style={{ height: '100%', width: '100%' }}>
          <Sidebar activeRoute={route} onNav={setRoute} onNewMemo={() => setRoute('home')} />
          {render()}
        </div>
      )}
      {editing && <NoteModal note={editing} onClose={() => setEditing(null)} />}
    </BkemoLayout>
  );
});

export default BkemoPage;
