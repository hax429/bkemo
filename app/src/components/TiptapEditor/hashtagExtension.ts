import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Lightweight inline decoration that styles `#tag` tokens in the document with
 * the accent color (matching the prototype's BKEMO_RENDER tag highlighting).
 * Decoration-only — it does not alter the stored markdown, so round-tripping is
 * untouched. The actual tag persistence still happens server-side by parsing
 * the markdown content (extractHashtags in note.ts).
 */
const HASHTAG_RE = /(?<!:\/\/)(?<=\s|^)#[^\s#]+/g;

export const Hashtag = Extension.create({
  name: 'hashtagHighlight',

  addProseMirrorPlugins() {
    const key = new PluginKey('hashtagHighlight');
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const text = node.text;
              let m: RegExpExecArray | null;
              HASHTAG_RE.lastIndex = 0;
              while ((m = HASHTAG_RE.exec(text)) !== null) {
                const from = pos + m.index;
                const to = from + m[0].length;
                decorations.push(
                  Decoration.inline(from, to, { class: 'tiptap-hashtag' }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
