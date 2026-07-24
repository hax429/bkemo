/**
 * Convert bkemo inline mark syntax to HTML for react-markdown + rehype-raw.
 * Skips fenced code blocks and inline `code` spans.
 *
 *   ==text==  →  <mark class="bk-highlight">text</mark>
 *   ++text++  →  <u>text</u>
 */

function mapOutsideCode(src: string, map: (chunk: string) => string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < src.length) {
    // Fenced code block
    if (src.startsWith('```', i) || src.startsWith('~~~', i)) {
      const fence = src.slice(i, i + 3);
      const end = src.indexOf(fence, i + 3);
      if (end === -1) {
        parts.push(src.slice(i));
        break;
      }
      parts.push(src.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    // Inline code
    if (src[i] === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const close = src.indexOf('`'.repeat(n), i + n);
      if (close === -1) {
        parts.push(map(src.slice(i)));
        break;
      }
      parts.push(src.slice(i, close + n));
      i = close + n;
      continue;
    }
    // Plain run until next backtick / fence
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '`' || src.startsWith('```', j) || src.startsWith('~~~', j)) break;
      j++;
    }
    parts.push(map(src.slice(i, j)));
    i = j;
  }
  return parts.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function expandMarks(chunk: string): string {
  return chunk
    .replace(/==([^\n=]+?)==/g, (_m, inner: string) => `<mark class="bk-highlight">${escapeHtml(inner)}</mark>`)
    .replace(/\+\+([^\n+]+?)\+\+/g, (_m, inner: string) => `<u>${escapeHtml(inner)}</u>`);
}

/** Expand == / ++ marks to HTML outside code. Safe for rehype-raw. */
export function expandBkemoMarkSyntax(markdown: string): string {
  if (!markdown) return markdown;
  if (!markdown.includes('==') && !markdown.includes('++')) return markdown;
  return mapOutsideCode(markdown, expandMarks);
}
