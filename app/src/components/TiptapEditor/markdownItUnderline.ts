/**
 * markdown-it plugin: ++text++ → <u>text</u>
 * Adapted from markdown-it-ins (same ++ delimiter, `u` tag instead of `ins`).
 */
export default function markdownItUnderline(md: any) {
  function tokenize(state: any, silent: boolean) {
    const marker = state.src.charCodeAt(state.pos);

    if (silent) return false;
    if (marker !== 0x2b /* + */) return false;

    const scanned = state.scanDelims(state.pos, true);
    let len = scanned.length;
    const ch = String.fromCharCode(marker);

    if (len < 2) return false;

    if (len % 2) {
      const token = state.push('text', '', 0);
      token.content = ch;
      len--;
    }

    for (let i = 0; i < len; i += 2) {
      const token = state.push('text', '', 0);
      token.content = ch + ch;
      if (!scanned.can_open && !scanned.can_close) continue;
      state.delimiters.push({
        marker,
        length: 0,
        jump: i / 2,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close,
      });
    }

    state.pos += scanned.length;
    return true;
  }

  function postProcess(state: any, delimiters: any[]) {
    const loneMarkers: number[] = [];
    const max = delimiters.length;

    for (let i = 0; i < max; i++) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== 0x2b) continue;
      if (startDelim.end === -1) continue;

      const endDelim = delimiters[startDelim.end];

      let token = state.tokens[startDelim.token];
      token.type = 'underline_open';
      token.tag = 'u';
      token.nesting = 1;
      token.markup = '++';
      token.content = '';

      token = state.tokens[endDelim.token];
      token.type = 'underline_close';
      token.tag = 'u';
      token.nesting = -1;
      token.markup = '++';
      token.content = '';

      if (
        state.tokens[endDelim.token - 1]?.type === 'text' &&
        state.tokens[endDelim.token - 1]?.content === '+'
      ) {
        loneMarkers.push(endDelim.token - 1);
      }
    }

    while (loneMarkers.length) {
      const i = loneMarkers.pop()!;
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === 'underline_close') j++;
      j--;
      if (i !== j) {
        const tmp = state.tokens[j];
        state.tokens[j] = state.tokens[i];
        state.tokens[i] = tmp;
      }
    }
  }

  md.inline.ruler.before('emphasis', 'underline', tokenize);
  md.inline.ruler2.before('emphasis', 'underline', (state: any) => {
    const tokensMeta = state.tokens_meta || [];
    postProcess(state, state.delimiters);
    for (let curr = 0; curr < tokensMeta.length; curr++) {
      if (tokensMeta[curr]?.delimiters) {
        postProcess(state, tokensMeta[curr].delimiters);
      }
    }
  });
}
