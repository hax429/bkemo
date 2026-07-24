import dayjs from '@/lib/dayjs';
import { RATIO_META, type ShareImageRatioId } from './types';

const TAG_RE = /#([a-zA-Z0-9_/-]+)/g;

export function extractShareTags(content: string, noteTags?: { tag?: { name?: string } | null }[] | null): string[] {
  const set = new Set<string>();
  (noteTags ?? []).forEach((t) => {
    const name = t?.tag?.name?.replace(/^#/, '');
    if (name) set.add(name);
  });
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(content ?? '')) !== null) {
    if (m[1] && m[1] !== 'important' && m[1] !== 'urgent') set.add(m[1]);
  }
  return [...set];
}

export function countWords(content: string): number {
  const plain = (content ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/[#>*_~\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

/** ~220 wpm reading time, minimum 1 when there is content. */
export function readingTimeMinutes(content: string): number {
  const words = countWords(content);
  if (!words) return 0;
  return Math.max(1, Math.ceil(words / 220));
}

export function formatShareDate(createdAt?: Date | string | null): { monthDay: string; year: string; day: string; weekday: string; full: string } {
  const d = createdAt ? dayjs(createdAt) : dayjs();
  return {
    monthDay: d.format('MM / DD'),
    year: d.format('YYYY'),
    day: d.format('DD'),
    weekday: d.format('dddd'),
    full: d.format('YYYY / MM.DD'),
  };
}

export function ratioBox(ratio: ShareImageRatioId): { width: number; height: number | 'auto' } {
  const meta = RATIO_META.find((r) => r.id === ratio) ?? RATIO_META[0]!;
  return { width: meta.w, height: meta.h };
}

/** Approximate content char budget per page for multipage splits. */
export function pageCharBudget(ratio: ShareImageRatioId): number {
  const box = ratioBox(ratio);
  if (box.height === 'auto') return 1800;
  const area = box.width * box.height;
  return Math.max(280, Math.round(area / 900));
}

/**
 * Split markdown into pages by paragraph blocks targeting a char budget.
 * Keeps fenced code blocks intact.
 */
export function splitContentPages(content: string, budget: number): string[] {
  const text = (content ?? '').trim();
  if (!text) return [''];
  if (text.length <= budget) return [text];

  const blocks: string[] = [];
  const re = /(```[\s\S]*?```)|((?:.|\n)*?(?:\n\n+|$))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = (m[1] || m[2] || '').replace(/\n+$/, '');
    if (block.trim()) blocks.push(block.trim());
    if (m[0].length === 0) break;
  }
  if (!blocks.length) return [text];

  const pages: string[] = [];
  let cur = '';
  for (const block of blocks) {
    if (!cur) {
      if (block.length > budget * 1.4) {
        // Hard-split very long blocks by lines.
        const lines = block.split('\n');
        let chunk = '';
        for (const line of lines) {
          const next = chunk ? `${chunk}\n${line}` : line;
          if (next.length > budget && chunk) {
            pages.push(chunk);
            chunk = line;
          } else {
            chunk = next;
          }
        }
        if (chunk) cur = chunk;
      } else {
        cur = block;
      }
      continue;
    }
    const next = `${cur}\n\n${block}`;
    if (next.length > budget) {
      pages.push(cur);
      cur = block;
    } else {
      cur = next;
    }
  }
  if (cur) pages.push(cur);
  return pages.length ? pages : [text];
}

export function accountDaysSince(start?: Date | string | null): number {
  if (!start) return 1;
  return Math.max(1, dayjs().startOf('day').diff(dayjs(start).startOf('day'), 'day') + 1);
}
