import React from 'react';

/**
 * Render a memo's plain text/markdown body with inline #tag highlighting,
 * mirroring the prototype's window.BKEMO_RENDER. For the stream we show a
 * lightweight text preview (not full markdown) — the full TipTap render is used
 * on the detail/edit screen. Strips common markdown task/heading prefixes so the
 * one-line preview reads cleanly.
 */
const TAG_RE = /(#[a-zA-Z0-9_\/-]+)/g;

export function renderMemoBody(body: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={`t${i++}`} className="bk-tag" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

/** Strip markdown checkbox / heading markers for a clean single-line preview. */
export function previewText(body: string): string {
  return (body ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
