import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { NoteType, type Note } from '@shared/lib/types';
import { isTask, isDone, bucketQuadrants, laneToDueRange, type TaskLane } from '@/lib/taskFilters';
import { stripLoneCheckbox } from '@/lib/taskSyntax';
import { MarkdownView } from './MarkdownView';
import { ContextMenu, MoreButton, type MenuItem } from './ContextMenu';
import { CardFeedback } from './CommentsSection';
import { getBkemoConfig } from '@/lib/bkemoConfig';
import { eventBus } from '@/lib/event';
import { OnThisDay } from './DailyReview';

export type TodoView = Exclude<TaskLane, 'tomorrow'> | 'matrix';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.10em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const monoCap: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' };
const card: React.CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };

function PriorityDots({ important, urgent }: { important?: boolean; urgent?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      <span title="Important" style={{ width: 6, height: 6, borderRadius: 50, background: important ? 'var(--important)' : 'transparent', border: important ? 'none' : '1px solid var(--fg-3)', boxSizing: 'border-box' }} />
      <span title="Urgent" style={{ width: 6, height: 6, borderRadius: 50, background: urgent ? 'var(--urgent)' : 'transparent', border: urgent ? 'none' : '1px solid var(--fg-3)', boxSizing: 'border-box' }} />
    </span>
  );
}

const Check = observer(function Check({ note, size = 14 }: { note: Note; size?: number }) {
  const blinko = RootStore.Get(BlinkoStore);
  const done = isDone(note);
  const border = done ? 'var(--accent)' : (note.isImportant && note.isUrgent) ? 'var(--urgent)' : 'var(--fg-3)';
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

function plainTitle(content?: string | null): string {
  return (content || 'Untitled task').replace(/^#+\s*/, '').replace(/\n+/g, ' ').trim();
}

const TaskRow = observer(function TaskRow({ note, onOpen, onContext, compact }: { note: Note; onOpen?: (n: Note) => void; onContext?: (e: React.MouseEvent, n: Note) => void; compact?: boolean }) {
  const done = isDone(note);
  const { hideComments } = getBkemoConfig();
  const subtasks = (((note as any).subtasks ?? []) as Note[]).filter(isTask);
  const doneSubtasks = subtasks.filter(isDone).length;
  const parent = (note as any).parentNote as { id?: number; content?: string } | null | undefined;

  return (
    <div
      className="bk-more-host"
      onContextMenu={(e) => { if (onContext) { e.preventDefault(); onContext(e, note); } }}
      style={{ padding: compact ? '7px 12px' : 'var(--row-pad-y) var(--row-pad-x)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg)')}
    >
      <div onClick={() => onOpen?.(note)} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', columnGap: compact ? 8 : 12, alignItems: 'start', cursor: 'pointer' }}>
        <span style={{ paddingTop: 2 }}><Check note={note} /></span>
        <span style={{ paddingTop: 4 }}><PriorityDots important={note.isImportant} urgent={note.isUrgent} /></span>
        <div style={{ fontSize: compact ? 12.5 : 13.5, lineHeight: 'var(--row-line)', color: done ? 'var(--fg-3)' : 'var(--fg)', textDecoration: done ? 'line-through' : 'none', minWidth: 0 }}>
          {parent?.id && (
            <span
              onClick={(e) => { e.stopPropagation(); eventBus.emit('bkemo:open-note', { id: parent.id! }); }}
              title={`Subtask of BK-${parent.id} · ${plainTitle(parent.content).slice(0, 64)}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 6, padding: '1px 8px 1px 6px', borderRadius: 100, border: '1px solid var(--border-2)', background: 'var(--hover)', color: 'var(--fg-2)', fontSize: 10.5, fontFamily: 'var(--font-mono)', textDecoration: 'none', cursor: 'pointer', verticalAlign: 'middle' }}
            >
              <span style={{ color: 'var(--accent)' }}>↳</span>
              <span>BK-{parent.id}</span>
            </span>
          )}
          {note.isTop && <span title="Pinned" style={{ color: 'var(--accent)', marginRight: 6 }}>⊕</span>}
          {/* A task's lone body checkbox duplicates the row's own toggle — hide it. */}
          <MarkdownView content={stripLoneCheckbox(note.content ?? '')} />
        </div>
        <span style={{ ...monoCap, fontSize: compact ? 10 : 11, color: dueLabel(note) === 'today' ? 'var(--accent)' : 'var(--fg-3)', paddingTop: 3, textAlign: 'right', whiteSpace: 'nowrap' }}>{dueLabel(note)}</span>
      </div>
      {/* footer: more actions (hidden in the dense matrix layout) */}
      {!compact && (
        <div className="h-stack" style={{ gap: 10, marginTop: 6, marginLeft: 26, color: 'var(--fg-3)', fontSize: 12 }}>
          <span className="spacer" />
          {subtasks.length > 0 && <span style={{ fontFamily: 'var(--font-mono)' }}>{doneSubtasks}/{subtasks.length} subtasks</span>}
          {onContext && <MoreButton size={24} onClick={(e) => onContext(e, note)} />}
        </div>
      )}
      {compact && subtasks.length > 0 && (
        <div style={{ marginLeft: 26, marginTop: 2, color: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>{doneSubtasks}/{subtasks.length} subtasks</div>
      )}
      {!compact && !hideComments && <div style={{ marginLeft: 26 }}><CardFeedback note={note} /></div>}
    </div>
  );
});

const TABS: { id: TodoView; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'matrix', label: 'Matrix' },
];

function Quadrant({ icon, label, sub, tone, tasks, empty, onOpen, onContext }: { icon: string; label: string; sub: string; tone: string; tasks: Note[]; empty: string; onOpen?: (n: Note) => void; onContext?: (e: React.MouseEvent, n: Note) => void }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Single-line header: icon · label · muted sub · count */}
      <div className="h-stack" style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', gap: 8 }}>
        <span style={{ width: 20, height: 20, borderRadius: 5, background: `color-mix(in srgb, ${tone} 18%, var(--bg-3))`, color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', flexShrink: 0 }}>{label}</span>
        <span style={{ ...mono, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{sub}</span>
        <span className="spacer" />
        <span style={{ ...monoCap, fontSize: 11, color: tone, fontWeight: 600, flexShrink: 0 }}>{tasks.length}</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ ...monoCap, padding: 16, textAlign: 'center', color: 'var(--fg-3)', fontSize: 10.5 }}>{empty}</div>
        ) : tasks.map((t) => <TaskRow key={t.id} note={t} onOpen={onOpen} onContext={onContext} compact />)}
      </div>
    </div>
  );
}

const axisLabel: React.CSSProperties = { ...mono, fontSize: 10, letterSpacing: '.14em' };

function MatrixView({ open, onOpen, onContext }: { open: Note[]; onOpen?: (n: Note) => void; onContext?: (e: React.MouseEvent, n: Note) => void }) {
  const q = useMemo(() => bucketQuadrants(open), [open]);
  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: 12, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 1fr', gridTemplateRows: 'auto 1fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
        <div />
        <div style={{ ...axisLabel, textAlign: 'center' }}>URGENT</div>
        <div style={{ ...axisLabel, textAlign: 'center' }}>NOT URGENT</div>
        <div style={{ ...axisLabel, writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>IMPORTANT</div>
        <Quadrant icon="▣" label="Do now" sub="Crises · deadlines" tone="var(--urgent)" tasks={q.do} empty="Nothing on fire." onOpen={onOpen} onContext={onContext} />
        <Quadrant icon="◫" label="Schedule" sub="Strategy · prevention" tone="#5BD0C8" tasks={q.schedule} empty="Plan something." onOpen={onOpen} onContext={onContext} />
        <div style={{ ...axisLabel, writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>NOT IMPORTANT</div>
        <Quadrant icon="◰" label="Delegate" sub="Interruptions · errands" tone="#E8A35C" tasks={q.delegate} empty="No errands waiting." onOpen={onOpen} onContext={onContext} />
        <Quadrant icon="◱" label="Eliminate" sub="Time-wasters · trivia" tone="#9B6B6B" tasks={q.eliminate} empty="Inbox zero on this one." onOpen={onOpen} onContext={onContext} />
      </div>
    </div>
  );
}

export const Todos = observer(function Todos({ view, onView, onOpen }: { view: TodoView; onView: (v: TodoView) => void; onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [openTasks, setOpenTasks] = useState<Note[]>([]);
  // All open memos/notes (not just to-dos) — the matrix also surfaces important/
  // urgent/due-today memos that aren't typed to-dos.
  const [openAll, setOpenAll] = useState<Note[]>([]);
  const [doneTasks, setDoneTasks] = useState<Note[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null);

  const removeLocal = (id: number) => {
    setOpenTasks((p) => p.filter((n) => n.id !== id));
    setOpenAll((p) => p.filter((n) => n.id !== id));
    setDoneTasks((p) => p.filter((n) => n.id !== id));
  };

  const taskMenuItems = (n: Note): MenuItem[] => [
    { label: 'Edit', icon: '✎', onClick: () => onOpen?.(n) },
    { label: isDone(n) ? 'Mark undone' : 'Mark done', icon: '✓', onClick: () => blinko.toggleTaskDone.call({ id: n.id!, done: !isDone(n) }) },
    { label: n.isImportant ? 'Not important' : 'Important', icon: '!', onClick: () => blinko.setTaskPriority.call({ id: n.id!, isImportant: !n.isImportant }) },
    { label: n.isUrgent ? 'Not urgent' : 'Urgent', icon: '^', onClick: () => blinko.setTaskPriority.call({ id: n.id!, isUrgent: !n.isUrgent }) },
    { label: n.dueDate ? 'Clear due date' : 'Due today', icon: '●', onClick: () => blinko.setTaskDue.call({ id: n.id!, dueDate: n.dueDate ? null : dayjs().endOf('day').toDate() }) },
    { label: 'Open subtasks', icon: '↳', onClick: () => onOpen?.(n) },
    { label: n.isTop ? 'Unpin' : 'Pin', icon: '⊕', onClick: () => blinko.upsertNote.call({ id: n.id, isTop: !n.isTop, showToast: false }) },
    { label: 'Make memo', icon: '✦', onClick: () => blinko.upsertNote.call({ id: n.id, type: NoteType.BLINKO, showToast: false }) },
    { label: 'Copy text', icon: '⧉', onClick: () => navigator.clipboard?.writeText(n.content ?? '') },
    { type: 'divider' },
    { label: 'Archive', icon: '▦', onClick: async () => { try { await blinko.upsertNote.call({ id: n.id!, isArchived: true, showToast: false }); removeLocal(n.id!); } catch (e) { console.error(e); } } },
    { label: 'Trash', icon: '⌫', danger: true, onClick: async () => { await blinko.trashNote.call({ ids: [n.id!] }); removeLocal(n.id!); } },
  ];
  const openMenu = (e: React.MouseEvent, note: Note) => setMenu({ x: e.clientX, y: e.clientY, note });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      blinko.queryNotes({ type: -1, isCompleted: false }, 1, 300),
      blinko.queryNotes({ type: -1, isCompleted: true }, 1, 100),
    ]).then(([open, done]) => {
      if (cancelled) return;
      setOpenAll(open);
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
        <MatrixView open={openAll} onOpen={onOpen} onContext={openMenu} />
      ) : (
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: '20px 18px 0', maxWidth: 980, margin: '0 auto' }}>
            <div style={mono}>{sub.toUpperCase()}</div>
            <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', margin: '4px 0 16px', color: 'var(--fg)', lineHeight: 1.05 }}>{title}</h1>
            {laned.length === 0 ? (
              <div style={{ ...monoCap, padding: 30, textAlign: 'center', color: 'var(--fg-3)', border: '1px dashed var(--border-2)', borderRadius: 'var(--radius-lg)' }}>Nothing in this lane.</div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                {laned.map((n) => <TaskRow key={n.id} note={n} onOpen={onOpen} onContext={openMenu} />)}
              </div>
            )}

            {doneTasks.length > 0 && (
              <div style={{ marginTop: 24, marginBottom: 32 }}>
                <div className="h-stack" style={{ ...mono, marginBottom: 10 }}>
                  <span style={{ flex: 1 }}>Done · recent</span>
                  <span style={{ color: 'var(--fg-3)' }}>{doneTasks.length}</span>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', opacity: 0.7 }}>
                  {doneTasks.slice(0, 20).map((n) => <TaskRow key={n.id} note={n} onOpen={onOpen} onContext={openMenu} />)}
                </div>
              </div>
            )}

            {view === 'today' ? <OnThisDay onOpen={onOpen} /> : null}
          </div>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={taskMenuItems(menu.note)} onClose={() => setMenu(null)} />}
    </div>
  );
});
