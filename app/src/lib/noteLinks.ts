/**
 * Internal `[[memo]]` links. The `[[` autocomplete in the TipTap editor inserts a
 * standard markdown link to another memo/todo, using a relative href so it round-
 * trips cleanly through tiptap-markdown (markdown-it) and the Link mark:
 *
 *     [Some memo title](/bkemo/n/123)
 *
 * The link target is the note id. On save, every composer extracts these ids from
 * the markdown and passes them as `references` (the noteReference table) so the
 * link graph stays in sync with the body. Rendering (MarkdownView) and the editor
 * recognize the href shape to style/open them as in-app memo links.
 */

/** Build the relative href that encodes a memo link to note `id`. */
export function noteLinkHref(id: number): string {
  return `/bkemo/n/${id}`;
}

/** Matches a memo-link href and captures the note id. */
export const NOTE_LINK_HREF_RE = /^\/bkemo\/n\/(\d+)$/;

/** All memo-link target ids referenced in a markdown string (deduped, in order). */
export function extractNoteLinkIds(markdown: string): number[] {
  const ids = new Set<number>();
  const re = /\]\(\/bkemo\/n\/(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    ids.add(Number(m[1]));
  }
  return [...ids];
}

/** A short, single-line title for a memo, derived from its markdown body. */
export function noteLinkTitle(content?: string | null): string {
  const firstLine = (content ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  const clean = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+\[[ xX]?\]\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
  return clean.slice(0, 80) || 'Untitled memo';
}
