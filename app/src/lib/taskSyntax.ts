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
  /** Markdown with the recognized `due:`/`#important`/`#urgent` tokens removed. */
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
  /** True when a `#important` tag was present (priority flag, applies to any memo). */
  isImportant?: boolean;
  /** True when an `#urgent` tag was present (priority flag, applies to any memo). */
  isUrgent?: boolean;
};

/** A markdown task-list item: `- [ ]`, `-[x]`, `* [X]`, `+ []`, etc. */
const TASK_ITEM_RE = /^[ \t]*[-*+][ \t]*\[[ xX]?\]/m;

/**
 * A task-list checkbox at the start of a line, possibly with the markdown
 * punctuation backslash-escaped. The TipTap composer serializes a plain-text
 * `-[]` (typed without the space its input rule needs) as `\-\[\]`, so we must
 * tolerate the escapes both when detecting the checkbox and when normalizing it
 * back to canonical GFM (`- [ ]` / `- [x]`) so it renders as a real checkbox.
 */
const ESCAPED_CHECKBOX_RE = /^([ \t]*)\\?[-*+][ \t]*\\?\[[ \t]*([xX]?)[ \t]*\\?\]/gm;

/** First `due:<value>` token, anchored to a word boundary so `https://…` is safe. */
const DUE_RE = /(^|\s)due:(\S+)/i;

/**
 * Priority hashtags. `#important` / `#urgent` are a typing shortcut for the
 * priority flags (same as the `!` / `▲` toolbar buttons) and apply to any memo,
 * task or not. They are stripped from the saved content so they don't show up as
 * project tags — the priority dot is the indicator.
 */
const IMPORTANT_TAG_RE = /(^|\s)#important(?=$|\s)/i;
const URGENT_TAG_RE = /(^|\s)#urgent(?=$|\s)/i;

/** Normalize any (possibly escaped) leading checkbox to canonical GFM markup. */
function normalizeCheckboxes(markdown: string): string {
  return markdown.replace(ESCAPED_CHECKBOX_RE, (_full, indent: string, mark: string) =>
    `${indent}- [${mark ? 'x' : ' '}]`,
  );
}

/** Canonical task-list checkbox at the start of a line (global, for counting). */
const CHECKBOX_LINE_RE = /^[ \t]*[-*+][ \t]*\[[ xX]?\]/gm;

/**
 * A memo promoted to a task with a single `- [ ]` carries a body checkbox that
 * just duplicates the memo-level task toggle. Strip that lone checkbox marker
 * (leaving its text) so the card shows one checkbox, not two. Multi-item
 * checklists (>1 checkbox) are real content and left untouched. No-op otherwise.
 */
export function stripLoneCheckbox(markdown: string): string {
  const normalized = normalizeCheckboxes(markdown);
  const matches = normalized.match(CHECKBOX_LINE_RE);
  if (!matches || matches.length !== 1) return markdown;
  return normalized.replace(/^([ \t]*)[-*+][ \t]*\[[ xX]?\][ \t]*/m, '$1');
}

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
  // Normalize escaped checkbox markup first so detection and the saved content
  // both see canonical `- [ ]` (TipTap escapes plain-text `-[]` → `\-\[\]`).
  const normalized = normalizeCheckboxes(markdown);
  const hasCheckbox = TASK_ITEM_RE.test(normalized);
  const m = normalized.match(DUE_RE);
  const dueDate = m ? parseDueValue(m[2]) : undefined;

  // Priority hashtags → flags (stripped from saved content, like `due:`).
  const isImportant = IMPORTANT_TAG_RE.test(normalized) || undefined;
  const isUrgent = URGENT_TAG_RE.test(normalized) || undefined;

  // Strip the recognized tokens, keeping the leading separator so words don't collide.
  let content = normalized
    .replace(IMPORTANT_TAG_RE, (_full, lead: string) => lead)
    .replace(URGENT_TAG_RE, (_full, lead: string) => lead);
  // Only strip the `due:` token when its value was recognized; an unknown value
  // (typo / unrelated text) is left in place.
  if (dueDate !== undefined) {
    content = content.replace(DUE_RE, (_full, lead: string) => lead);
  }
  // Drop a lone promotion checkbox (redundant with the memo-level task toggle).
  content = stripLoneCheckbox(content);
  content = content.replace(/[ \t]+$/gm, '').trim();

  return { content, isTodo: hasCheckbox || dueDate != null, dueDate, isImportant, isUrgent };
}
