import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { MarkdownView } from './MarkdownView';
import { AttachmentList } from './AttachmentList';
import { CardFeedback } from './CommentsSection';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.10em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const card: React.CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' };

/** Historical notes for today's date, embedded below the Today task workflow. */
export const OnThisDay = observer(function OnThisDay({ onOpen }: { onOpen?: (n: Note) => void }) {
  const blinko = RootStore.Get(BlinkoStore);

  useEffect(() => {
    if (!blinko.dailyReviewNoteList.value) blinko.dailyReviewNoteList.call().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  const throwbacks: Note[] = (blinko.dailyReviewNoteList.value as Note[]) ?? [];

  return (
    <section style={{ marginTop: 36, paddingBottom: 40 }}>
      <div style={mono}>ON THIS DAY · {throwbacks.length} {throwbacks.length === 1 ? 'ENTRY' : 'ENTRIES'}</div>
      <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: '4px 0 6px', color: 'var(--fg)' }}>What you wrote on {dayjs().format('MMM D')}, before.</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 13, marginBottom: 14 }}>A quiet look back after planning today.</div>
      {throwbacks.length === 0 ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', padding: 20, border: '1px dashed var(--border-2)', borderRadius: 'var(--radius-lg)' }}>No past memos for today.</div>
      ) : throwbacks.map((it, i) => (
        <div key={it.id} onClick={() => onOpen?.(it)} style={{ ...card, padding: '20px 22px', marginBottom: 12, borderLeft: i === 0 ? '2px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer' }}>
          <div className="h-stack" style={{ ...mono, marginBottom: 8 }}>
            <span style={{ flex: 1 }}>BK-{it.id} · {it.createdAt ? dayjs(it.createdAt).format('MMM D, YYYY').toUpperCase() : ''}</span>
          </div>
          <div style={{ fontSize: i === 0 ? 16 : 14, lineHeight: 1.6, color: 'var(--fg)' }}><MarkdownView content={it.content ?? ''} /></div>
          <AttachmentList attachments={(it as any).attachments} compact />
          <CardFeedback note={it} />
        </div>
      ))}
    </section>
  );
});

/** Legacy wrapper kept for internal compatibility; visible navigation now uses Today. */
export const DailyReview = observer(function DailyReview({ onOpen }: { onOpen?: (n: Note) => void }) {
  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Today</span>
      </div>
      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 18px 0', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}><OnThisDay onOpen={onOpen} /></div>
      </div>
    </div>
  );
});
