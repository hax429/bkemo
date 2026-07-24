/**
 * TipTap mark extensions with tiptap-markdown round-trip:
 *   highlight ↔ ==text==
 *   underline ↔ ++text++
 */
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import markdownItMark from 'markdown-it-mark';
import markdownItUnderline from './markdownItUnderline';

export const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', expelEnclosingWhitespace: true },
        parse: {
          setup(md: any) {
            md.use(markdownItMark);
          },
        },
      },
    };
  },
}).configure({
  multicolor: false,
  HTMLAttributes: { class: 'bk-highlight' },
});

export const MarkdownUnderline = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '++', close: '++', expelEnclosingWhitespace: true },
        parse: {
          setup(md: any) {
            md.use(markdownItUnderline);
          },
        },
      },
    };
  },
});
