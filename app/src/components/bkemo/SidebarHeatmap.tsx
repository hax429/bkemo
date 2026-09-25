import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { pressable } from '@/lib/pressable';
import { SidebarIcon } from './SidebarIcons';

/** Tint for a day by memo count: none, then four steps of the accent. */
function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 2;
  return Math.min(4, 1 + Math.floor(((count - 1) / (max - 1)) * 3.999));
}
const LEVEL_MIX = [0, 16, 26, 38, 54];

/**
 * One-month activity calendar for the sidebar: each day is tinted by how
 * many memos were written, today carries a dot, and clicking a day opens
 * the Calendar view.
 */
export const SidebarHeatmap = observer(function SidebarHeatmap({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const year = month.year();

  useEffect(() => {
    let cancelled = false;
    api.analytics.dailyNoteCount
      .mutate({ utcOffsetMinutes: -new Date().getTimezoneOffset(), mode: 'year', year })
      .then((rows) => { if (!cancelled) setCounts(new Map(rows.map((r) => [r.date, r.count]))); })
      .catch((e) => console.warn('[sidebar] heatmap load failed:', e));
    return () => { cancelled = true; };
  }, [year, blinko.updateTicker]);

  const cells = useMemo(() => {
    const start = month.startOf('week');
    const weeks = Math.ceil((month.diff(start, 'day') + month.daysInMonth()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => start.add(i, 'day'));
  }, [month]);

  const max = useMemo(() => {
    let m = 0;
    cells.forEach((d) => { if (d.month() === month.month()) m = Math.max(m, counts.get(d.format('YYYY-MM-DD')) ?? 0); });
    return m;
  }, [cells, counts, month]);

  const today = dayjs().format('YYYY-MM-DD');
  const isCurrent = month.isSame(dayjs(), 'month');
  const step = (delta: number) => setMonth((m) => m.add(delta, 'month'));

  return (
    <div className="bk-side-heatmap" style={{ padding: '4px 6px 2px' }}>
      <div className="h-stack" style={{ padding: '0 4px 6px', gap: 4, alignItems: 'center' }}>
        <span
          {...pressable(() => setMonth(dayjs().startOf('month')))}
          onClick={() => setMonth(dayjs().startOf('month'))}
          title={isCurrent ? undefined : 'Back to this month'}
          style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', cursor: isCurrent ? 'default' : 'pointer', userSelect: 'none' }}
        >
          {month.format('MMMM YYYY')}
        </span>
        <button type="button" className="bk-side-mini" aria-label="Previous month" onClick={() => step(-1)}>
          <SidebarIcon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button type="button" className="bk-side-mini" aria-label="Next month" onClick={() => step(1)}>
          <SidebarIcon name="chevron" size={13} />
        </button>
      </div>
      <div role="grid" aria-label={`Memos in ${month.format('MMMM YYYY')}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((d) => {
          const key = d.format('YYYY-MM-DD');
          const inMonth = d.month() === month.month();
          const count = counts.get(key) ?? 0;
          const lv = inMonth ? level(count, max) : 0;
          const isToday = key === today;
          return (
            <div
              key={key}
              role="gridcell"
              {...pressable(onOpenCalendar)}
              onClick={onOpenCalendar}
              title={`${d.format('ddd, MMM D')} · ${count} memo${count === 1 ? '' : 's'}`}
              className="bk-side-day"
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 7,
                fontSize: 11.5,
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
                userSelect: 'none',
                color: !inMonth ? 'var(--fg-3)' : lv >= 3 ? 'var(--fg)' : 'var(--fg-2)',
                opacity: inMonth ? 1 : 0.4,
                fontWeight: isToday ? 700 : 400,
                background: lv ? `color-mix(in srgb, var(--accent) ${LEVEL_MIX[lv]}%, transparent)` : 'transparent',
                boxShadow: isToday ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent)' : undefined,
              }}
            >
              {d.date()}
              {isToday && (
                <span style={{ position: 'absolute', bottom: 2.5, left: '50%', width: 3, height: 3, marginLeft: -1.5, borderRadius: 3, background: 'var(--accent)' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
