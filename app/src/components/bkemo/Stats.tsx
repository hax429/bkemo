import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const card: React.CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };

const WEEKS = 12;

export const Stats = observer(function Stats() {
  const blinko = RootStore.Get(BlinkoStore);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let cancelled = false;
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 1000)
      .then((list) => { if (!cancelled) setNotes(list); })
      .catch((e) => console.error('[stats] load failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const { heat, max, topTags, total, last7 } = useMemo(() => {
    // heatmap: WEEKS*7 day buckets ending today
    const start = dayjs().startOf('week').subtract(WEEKS - 1, 'week');
    const counts = new Array(WEEKS * 7).fill(0);
    const tagCount = new Map<string, number>();
    let last7n = 0;
    const weekAgo = dayjs().subtract(7, 'day');
    notes.forEach((n) => {
      const d = n.createdAt ? dayjs(n.createdAt) : null;
      if (d) {
        const idx = d.startOf('day').diff(start, 'day');
        if (idx >= 0 && idx < counts.length) counts[idx]++;
        if (d.isAfter(weekAgo)) last7n++;
      }
      (n.tags as any)?.forEach((t: any) => {
        const name = t?.tag?.name;
        if (name) tagCount.set(name, (tagCount.get(name) ?? 0) + 1);
      });
    });
    const max = Math.max(1, ...counts);
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxTag = Math.max(1, ...topTags.map((t) => t[1]));
    return { heat: counts, max, topTags: topTags.map(([tag, c]) => ({ tag, c, w: (c / maxTag) * 100 })), total: notes.length, last7: last7n };
  }, [notes]);

  const intensity = (v: number) => {
    if (v === 0) return 'var(--bg-3)';
    const a = [0.22, 0.45, 0.68, 0.92][Math.min(3, Math.ceil((v / max) * 4) - 1)] ?? 0.22;
    return `color-mix(in srgb, var(--accent) ${a * 100}%, var(--bg-3))`;
  };

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Stats</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>Last {WEEKS} weeks</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '24px 28px 40px' }}>
        {/* hero */}
        <div style={mono}>TOTAL MEMOS</div>
        <div className="h-stack" style={{ alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--fg)', lineHeight: 1 }}>{total}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>+{last7} this week</span>
        </div>

        <div style={{ height: 28 }} />

        {/* heatmap */}
        <div style={{ ...card, padding: '18px 20px' }}>
          <div className="h-stack" style={mono}>
            <span style={{ flex: 1 }}>Activity · {WEEKS} weeks</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gridTemplateRows: 'repeat(7, 14px)', gap: 3, gridAutoFlow: 'column', marginTop: 14 }}>
            {heat.map((v, i) => <div key={i} style={{ height: 14, borderRadius: 2, background: intensity(v) }} title={`${v} memos`} />)}
          </div>
        </div>

        <div style={{ height: 18 }} />

        {/* top tags */}
        <div style={{ ...card, padding: '18px 20px' }}>
          <div style={mono}>Top tags</div>
          <div className="v-stack" style={{ gap: 8, marginTop: 12 }}>
            {topTags.length === 0 ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>No tags yet.</div>
            ) : topTags.map((t) => (
              <div key={t.tag} className="h-stack" style={{ gap: 12, fontSize: 12 }}>
                <span style={{ width: 90, color: 'var(--accent)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{t.tag}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${t.w}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', width: 30, textAlign: 'right' }}>{t.c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
