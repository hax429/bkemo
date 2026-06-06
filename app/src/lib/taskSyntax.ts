import dayjs from '@/lib/dayjs';

/**
 * Inline task syntax for the memo composer. Two affordances let you turn a memo
 * into a task without touching the toolbar:
 *
 *   1. A markdown checkbox  ( `- [ ]` / `-[]` / `* [x]` )  marks the memo a TODO.
 *   2. A `due:` token sets the due date:
 *        due:today  due:tod
 *        due:tomorrow  due:tmr  due:tom
 *        due:06/25/2026  due:06/25/26  (MM/DD/YYYY or MM/DD/YY)
 *        due:2026-06-25  (ISO)
 *        due:none / due:clear / due:inbox  → clears the due date (→ inbox)
 *
 * The `due:` token is stripped from the returned content; the checkbox markup is
 * left intact (it is meaningful markdown / a real task-list item).
 */

export type ParsedTaskSyntax = {
  /** Markdown with the recognized `due:` token removed. */
  content: string;
  /** True when the content carries a task-list checkbox. */
  isTodo: boolean;
  /**
   * Parsed due date (end of day):
   *   - a Date when an explicit/relative date was given,
   *   - null when the token explicitly clears the date (e.g. `due:none`),
   *   - undefined when no recognized `due:` token was present.
   */
  dueDate?: Date | null;
};

/** A markdown task-list item: `- [ ]`, `-[x]`, `* [X]`, `+ []`, etc. */
const TASK_ITEM_RE = /^[ \t]*[-*+][ \t]*\[[ xX]?\]/m;

/** First `due:<value>` token, anchored to a word boundary so `https://…` is safe. */
const DUE_RE = /(^|\s)due:(\S+)/i;

/** Resolve a `due:` value to a Date (end of day), null (clear), or undefined (unknown). */
function parseDueValue(raw: string): Date | null | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'today' || v === 'tod') return dayjs().endOf('day').toDate();
  if (v === 'tomorrow' || v === 'tmr' || v === 'tom') return dayjs().add(1, 'day').endOf('day').toDate();
  if (v === 'none' || v === 'clear' || v === 'inbox') return null;
  for (const fmt of ['MM/DD/YYYY', 'M/D/YYYY', 'MM/DD/YY', 'M/D/YY', 'YYYY-MM-DD', 'YYYY/MM/DD']) {
    const d = dayjs(raw.trim(), fmt, true);
    if (d.isValid()) return d.endOf('day').toDate();
  }
  return undefined;
}

export function parseTaskSyntax(markdown: string): ParsedTaskSyntax {
  const hasCheckbox = TASK_ITEM_RE.test(markdown);
  const m = markdown.match(DUE_RE);
  const dueDate = m ? parseDueValue(m[2]) : undefined;

  // Unknown `due:` value (typo / unrelated text) → leave content untouched.
  if (dueDate === undefined) {
    return { content: markdown, isTodo: hasCheckbox };
  }

  // Strip the token, keeping the leading separator so words don't collide.
  const content = markdown
    .replace(DUE_RE, (_full, lead: string) => lead)
    .replace(/[ \t]+$/gm, '')
    .trim();

  return { content, isTodo: hasCheckbox || dueDate != null, dueDate };
}
