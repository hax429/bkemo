import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { isTask, isDone, laneToDueRange } from '@/lib/taskFilters';
import { renderMemoBody, previewText } from './renderMemoBody';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.10em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const card: React.CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };

const TaskStripItem = observer(function TaskStripItem({ note, onOpen }: { note: Note; onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const done = isDone(note);
  return (
    <div onClick={() => onOpen?.(note)} style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start', background: 'var(--bg)', cursor: 'pointer' }}>
      <span
        onClick={(e) => { e.stopPropagation(); blinko.toggleTaskDone.call({ id: note.id!, done: !done }); }}
        style={{ width: 13, height: 13, marginTop: 2, borderRadius: 3, border: `1.5px solid ${done ? 'var(--accent)' : 'var(--fg-3)'}`, background: done ? 'var(--accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, cursor: 'pointer', flexShrink: 0 }}
      >{done ? '✓' : ''}</span>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>
        {renderMemoBody(previewText(note.content ?? ''))}
      </div>
    </div>
  );
});

function TaskStrip({ label, accent, tasks, empty, onOpen }: { label: string; accent: string; tasks: Note[]; empty: string; onOpen?: (n: Note) => void }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', borderTop: `2px solid ${accent}` }}>
      <div className="h-stack" style={{ padding: '10px 14px 8px', ...mono, fontSize: 11 }}>
        <span style={{ flex: 1, color: accent }}>{label.toUpperCase()}</span>
        <span>{tasks.length} TASK{tasks.length === 1 ? '' : 'S'}</span>
      </div>
      {tasks.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{empty}</div>
      ) : tasks.map((m) => <TaskStripItem key={m.id} note={m} onOpen={onOpen} />)}
    </div>
  );
}

export const DailyReview = observer(function DailyReview({ onOpen }: { onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [openTasks, setOpenTasks] = useState<Note[]>([]);

  useEffect(() => {
    let cancelled = false;
    blinko.queryNotes({ type: -1, isCompleted: false }, 1, 300)
      .then((list) => { if (!cancelled) setOpenTasks(list.filter(isTask)); })
      .catch((e) => console.error('[daily] load failed:', e));
    if (!blinko.dailyReviewNoteList.value) blinko.dailyReviewNoteList.call().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const { today, tomorrow } = useMemo(() => {
    const inLane = (lane: 'today' | 'tomorrow') => {
      const { dueStart, dueEnd } = laneToDueRange(lane);
      return openTasks.filter((t) => t.dueDate && dayjs(t.dueDate).valueOf() >= (dueStart?.valueOf() ?? 0) && dayjs(t.dueDate).valueOf() <= (dueEnd?.valueOf() ?? Infinity));
    };
    return { today: inLane('today'), tomorrow: inLane('tomorrow') };
  }, [openTasks]);

  const throwbacks: Note[] = (blinko.dailyReviewNoteList.value as Note[]) ?? [];

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Daily review</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{dayjs().format('MMM D')}</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '24px 28px 40px', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={mono}>{today.length} TASKS TODAY · {tomorrow.length} TOMORROW · {throwbacks.length} PAST MEMOS</div>
          <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 6px', color: 'var(--fg)', lineHeight: 1.05 }}>Plan today, write about yesterday.</h1>
          <div style={{ color: 'var(--fg-2)', fontSize: 14, marginTop: 6, maxWidth: 620 }}>Triage tasks first — they're due. Then look at what you wrote on this day in previous years.</div>

          <div style={{ height: 28 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <TaskStrip label="Today" accent="var(--accent)" tasks={today} empty="Nothing due today." onOpen={onOpen} />
            <TaskStrip label="Tomorrow" accent="#E8A35C" tasks={tomorrow} empty="Tomorrow is clear." onOpen={onOpen} />
          </div>

          <div style={{ height: 36 }} />
          <div style={mono}>ON THIS DAY · {throwbacks.length} ENTRIES</div>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: '4px 0 14px', color: 'var(--fg)' }}>What you wrote on {dayjs().format('MMM D')}, before.</h2>
          {throwbacks.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', padding: 20 }}>No past memos for today.</div>
          ) : throwbacks.map((it, i) => (
            <div key={it.id} onClick={() => onOpen?.(it)} style={{ ...card, padding: '20px 22px', marginBottom: 12, borderLeft: i === 0 ? '2px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer' }}>
              <div className="h-stack" style={{ ...mono, marginBottom: 8 }}>
                <span style={{ flex: 1 }}>BK-{it.id} · {it.createdAt ? dayjs(it.createdAt).format('MMM D, YYYY').toUpperCase() : ''}</span>
              </div>
              <div style={{ fontSize: i === 0 ? 16 : 14, lineHeight: 1.6, color: 'var(--fg)' }}>{renderMemoBody(previewText(it.content ?? ''))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
