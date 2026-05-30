import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { isTask, isDone, bucketQuadrants, laneToDueRange, type TaskLane } from '@/lib/taskFilters';
import { renderMemoBody, previewText } from './renderMemoBody';

export type TodoView = TaskLane | 'matrix';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.10em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const monoCap: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' };
const card: React.CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };

function PriorityDots({ important, urgent }: { important?: boolean; urgent?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      <span title="Important" style={{ width: 6, height: 6, borderRadius: 50, background: important ? 'var(--accent)' : 'transparent', border: important ? 'none' : '1px solid var(--fg-3)', boxSizing: 'border-box' }} />
      <span title="Urgent" style={{ width: 6, height: 6, borderRadius: 50, background: urgent ? '#E8A35C' : 'transparent', border: urgent ? 'none' : '1px solid var(--fg-3)', boxSizing: 'border-box' }} />
    </span>
  );
}

const Check = observer(function Check({ note, size = 14 }: { note: Note; size?: number }) {
  const blinko = RootStore.Get(BlinkoStore);
  const done = isDone(note);
  const border = done || (note.isImportant && note.isUrgent) ? 'var(--accent)' : 'var(--fg-3)';
  return (
    <span
      onClick={(e) => { e.stopPropagation(); blinko.toggleTaskDone.call({ id: note.id!, done: !done }); }}
      style={{ width: size, height: size, borderRadius: 3, border: `1.5px solid ${border}`, background: done ? 'var(--accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: size - 4, lineHeight: 1, cursor: 'pointer' }}
    >{done ? '✓' : ''}</span>
  );
});

function dueLabel(n: Note): string {
  if (!n.dueDate) return '';
  const d = dayjs(n.dueDate).startOf('day');
  const diff = d.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return d.format('ddd');
  return d.format('MMM D');
}

const TaskRow = observer(function TaskRow({ note, onOpen }: { note: Note; onOpen?: (n: Note) => void }) {
  const done = isDone(note);
  return (
    <div
      onClick={() => onOpen?.(note)}
      style={{ padding: 'var(--row-pad-y) var(--row-pad-x)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', columnGap: 12, alignItems: 'start', background: 'var(--bg)', cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg)')}
    >
      <span style={{ paddingTop: 2 }}><Check note={note} /></span>
      <span style={{ paddingTop: 4 }}><PriorityDots important={note.isImportant} urgent={note.isUrgent} /></span>
      <div style={{ fontSize: 13.5, lineHeight: 'var(--row-line)', color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none' }}>
        {renderMemoBody(previewText(note.content ?? ''))}
      </div>
      <span style={{ ...monoCap, fontSize: 11, color: dueLabel(note) === 'today' ? 'var(--accent)' : 'var(--fg-3)', paddingTop: 3, textAlign: 'right' }}>{dueLabel(note)}</span>
    </div>
  );
});

const TABS: { id: TodoView; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
  { id: 'matrix', label: 'Matrix' },
];

function Quadrant({ icon, label, sub, tone, tasks, empty, onOpen }: { icon: string; label: string; sub: string; tone: string; tasks: Note[]; empty: string; onOpen?: (n: Note) => void }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="h-stack" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', gap: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 5, background: `color-mix(in srgb, ${tone} 18%, var(--bg-3))`, color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{label}</div>
          <div style={{ ...mono, fontSize: 9, marginTop: 2 }}>{sub}</div>
        </div>
        <span style={{ ...monoCap, fontSize: 11, color: tone, fontWeight: 600 }}>{tasks.length}</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ ...monoCap, padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>{empty}</div>
        ) : tasks.map((t) => <TaskRow key={t.id} note={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function MatrixView({ open, onOpen }: { open: Note[]; onOpen?: (n: Note) => void }) {
  const q = useMemo(() => bucketQuadrants(open), [open]);
  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: 18, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gridTemplateRows: 'auto 1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <div />
        <div style={{ ...mono, fontSize: 11, letterSpacing: '.14em', textAlign: 'center' }}>URGENT</div>
        <div style={{ ...mono, fontSize: 11, letterSpacing: '.14em', textAlign: 'center' }}>NOT URGENT</div>
        <div style={{ ...mono, fontSize: 11, letterSpacing: '.14em', writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>IMPORTANT</div>
        <Quadrant icon="▣" label="Do now" sub="Crises · deadlines" tone="var(--accent)" tasks={q.do} empty="Nothing on fire." onOpen={onOpen} />
        <Quadrant icon="◫" label="Schedule" sub="Strategy · prevention" tone="#5BD0C8" tasks={q.schedule} empty="Plan something." onOpen={onOpen} />
        <div style={{ ...mono, fontSize: 11, letterSpacing: '.14em', writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>NOT IMPORTANT</div>
        <Quadrant icon="◰" label="Delegate" sub="Interruptions · errands" tone="#E8A35C" tasks={q.delegate} empty="No errands waiting." onOpen={onOpen} />
        <Quadrant icon="◱" label="Eliminate" sub="Time-wasters · trivia" tone="#9B6B6B" tasks={q.eliminate} empty="Inbox zero on this one." onOpen={onOpen} />
      </div>
    </div>
  );
}

export const Todos = observer(function Todos({ view, onView, onOpen }: { view: TodoView; onView: (v: TodoView) => void; onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [openTasks, setOpenTasks] = useState<Note[]>([]);
  const [doneTasks, setDoneTasks] = useState<Note[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      blinko.queryNotes({ type: -1, isCompleted: false }, 1, 300),
      blinko.queryNotes({ type: -1, isCompleted: true }, 1, 100),
    ]).then(([open, done]) => {
      if (cancelled) return;
      setOpenTasks(open.filter(isTask));
      setDoneTasks(done.filter(isTask));
    }).catch((e) => console.error('[todos] load failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const laned = useMemo(() => {
    if (view === 'matrix') return [];
    if (view === 'inbox') return openTasks.filter((t) => !t.dueDate);
    const { dueStart, dueEnd } = laneToDueRange(view);
    return openTasks.filter((t) => {
      if (!t.dueDate) return false;
      const d = dayjs(t.dueDate);
      return (!dueStart || d.valueOf() >= dueStart.valueOf()) && (!dueEnd || d.valueOf() <= dueEnd.valueOf());
    });
  }, [view, openTasks]);

  const title = TABS.find((t) => t.id === view)?.label ?? 'Todos';
  const sub = view === 'inbox' ? `${openTasks.length} open · ${doneTasks.length} done`
    : view === 'matrix' ? 'Important × Urgent'
    : `${laned.length} due`;

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* topbar */}
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Todos</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{title}</span>
      </div>
      {/* filter tabs */}
      <div className="h-stack" style={{ height: 40, padding: '0 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
        {TABS.map((t) => (
          <div key={t.id} onClick={() => onView(t.id)} className="h-stack" style={{ padding: '0 14px', height: '100%', gap: 6, color: view === t.id ? 'var(--fg)' : 'var(--fg-2)', borderBottom: view === t.id ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      {view === 'matrix' ? (
        <MatrixView open={openTasks} onOpen={onOpen} />
      ) : (
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: '20px 18px 0', maxWidth: 980, margin: '0 auto' }}>
            <div style={mono}>{sub.toUpperCase()}</div>
            <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', margin: '4px 0 16px', color: 'var(--fg)', lineHeight: 1.05 }}>{title}</h1>
            {laned.length === 0 ? (
              <div style={{ ...monoCap, padding: 30, textAlign: 'center', color: 'var(--fg-3)', border: '1px dashed var(--border-2)', borderRadius: 'var(--radius-lg)' }}>Nothing in this lane.</div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                {laned.map((n) => <TaskRow key={n.id} note={n} onOpen={onOpen} />)}
              </div>
            )}

            {doneTasks.length > 0 && (
              <div style={{ marginTop: 24, marginBottom: 32 }}>
                <div className="h-stack" style={{ ...mono, marginBottom: 10 }}>
                  <span style={{ flex: 1 }}>Done · recent</span>
                  <span style={{ color: 'var(--fg-3)' }}>{doneTasks.length}</span>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', opacity: 0.7 }}>
                  {doneTasks.slice(0, 20).map((n) => <TaskRow key={n.id} note={n} onOpen={onOpen} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
