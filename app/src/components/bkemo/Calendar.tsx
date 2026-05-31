import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { isTask, isDone } from '@/lib/taskFilters';
import { previewText } from './renderMemoBody';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', color: 'var(--fg-3)', textTransform: 'uppercase' };

function tagColor(tag?: string): string {
  const key = (tag || '').replace(/^#/, '').split('/')[0];
  const map: Record<string, string> = {
    ios: '#5E6AD2', ai: '#A45EE0', server: '#5BD0A6', tauri: '#5BB6D0', daily: '#E0A85E',
    read: '#9B9690', idea: '#E07AA8', bug: '#E06868', log: '#A8855E', deploy: '#5BD08B', ota: '#7A9AD0',
  };
  return map[key] || '#7A8AA8';
}

function firstTag(n: Note): string | undefined {
  const t = (n.tags as any)?.[0]?.tag?.name;
  return t;
}

/** Calendar uses the task's dueDate when present, else the createdAt date. */
function noteDay(n: Note): Date | string | null | undefined {
  return (isTask(n) && n.dueDate) ? (n.dueDate as any) : (n.createdAt as any);
}

export const Calendar = observer(function Calendar({ onOpen }: { onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let cancelled = false;
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 500)
      .then((list) => { if (!cancelled) setNotes(list); })
      .catch((e) => console.error('[calendar] load failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const byDay = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((n) => {
      const d = noteDay(n);
      if (!d) return;
      const key = dayjs(d).format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return map;
  }, [notes]);

  const cells = useMemo(() => {
    const start = month.startOf('month').startOf('week');
    return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
  }, [month]);

  const today = dayjs().format('YYYY-MM-DD');

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 12, background: 'var(--bg)', flexShrink: 0 }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 600 }}>Calendar</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{month.format('MMMM YYYY')}</span>
        <span className="spacer" />
        <span onClick={() => setMonth((m) => m.subtract(1, 'month'))} style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', color: 'var(--fg-2)' }}>‹</span>
        <button onClick={() => setMonth(dayjs().startOf('month'))} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Today</button>
        <span onClick={() => setMonth((m) => m.add(1, 'month'))} style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', color: 'var(--fg-2)' }}>›</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', flexShrink: 0 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
          <div key={d} style={{ padding: '8px 10px', ...mono, borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)', flex: 1, minHeight: 0 }}>
        {cells.map((c) => {
          const key = c.format('YYYY-MM-DD');
          const events = byDay.get(key) ?? [];
          const isCurrentMonth = c.month() === month.month();
          const isToday = key === today;
          return (
            <div key={key} style={{ border: '1px solid var(--border)', background: isToday ? 'color-mix(in srgb, var(--accent) 5%, var(--bg))' : 'var(--bg)', padding: 4, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, opacity: isCurrentMonth ? 1 : 0.45, overflow: 'hidden' }}>
              <div className="h-stack" style={{ marginBottom: 2 }}>
                <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 50, background: isToday ? 'var(--accent)' : 'transparent', color: isToday ? '#fff' : isCurrentMonth ? 'var(--fg-2)' : 'var(--fg-3)', fontSize: 12, fontWeight: isToday ? 600 : 500 }}>{c.date()}</span>
              </div>
              {events.slice(0, 4).map((e) => {
                const c2 = tagColor(firstTag(e));
                const dim = isTask(e) && isDone(e);
                return (
                  <div key={e.id} onClick={() => onOpen?.(e)} title={previewText(e.content ?? '')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 5px', background: `color-mix(in srgb, ${c2} 20%, var(--bg-2))`, borderLeft: `2px solid ${c2}`, borderRadius: 3, fontSize: 11, lineHeight: 1.2, color: dim ? 'var(--fg-3)' : 'var(--fg)', textDecoration: dim ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', cursor: 'pointer' }}>
                    <span style={{ width: isTask(e) ? 9 : 6, height: isTask(e) ? 9 : 6, borderRadius: isTask(e) ? 2 : 50, border: isTask(e) ? `1.5px solid ${c2}` : 'none', background: isTask(e) ? (dim ? c2 : 'transparent') : c2, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewText(e.content ?? '') || '·'}</span>
                  </div>
                );
              })}
              {events.length > 4 && <div style={{ padding: '1px 6px', fontSize: 10, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>+{events.length - 4} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
});
