/**
 * TipTap bookmark block: Notion-like URL card that serializes as a bare URL
 * line so iOS/Obsidian keep plain-link markdown.
 */
import { Node, mergeAttributes, InputRule, PasteRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BookmarkCardView } from './BookmarkCardView';
import { BARE_URL_RE, normalizeUrl } from '@shared/lib/linkUrls';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (attrs: { href: string }) => ReturnType;
    };
  }
}

function findBareUrls(text: string): Array<{ href: string; from: number; to: number }> {
  const out: Array<{ href: string; from: number; to: number }> = [];
  const re = new RegExp(BARE_URL_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const href = normalizeUrl(match[0]);
    if (!href) continue;
    out.push({ href, from: match.index, to: match.index + match[0].length });
  }
  return out;
}

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      favicon: { default: null },
      noteId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark', class: 'bk-bookmark' })];
  },

  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkCardView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          if (node.attrs.href) {
            state.write(node.attrs.href);
            state.closeBlock(node);
          }
        },
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)((?:https?:\/\/|www\.)[^\s]+)\s$/,
        handler: ({ state, range, match }) => {
          const href = normalizeUrl(match[1] ?? '');
          if (!href) return null;
          const start = range.from + (match[0].startsWith(' ') || match[0].startsWith('\n') ? 1 : 0);
          const { tr } = state;
          const node = this.type.create({ href });
          tr.replaceWith(start, range.to, node);
          return tr;
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: /(?:https?:\/\/|www\.)[^\s]+/gi,
        handler: ({ state, range, match }) => {
          const href = normalizeUrl(match[0] ?? '');
          if (!href) return null;
          // Only convert when the pasted chunk is essentially just the URL.
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ href }));
          return tr;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('bookmark-standalone-url'),
        appendTransaction(_transactions, _oldState, newState) {
          let tr = newState.tr;
          let modified = false;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return;
            if (node.childCount !== 1) return;
            const child = node.firstChild;
            if (!child) return;
            let href: string | null = null;
            if (child.type.name === 'text') {
              const urls = findBareUrls(child.text ?? '');
              if (urls.length === 1 && urls[0]!.from === 0 && urls[0]!.to === (child.text?.length ?? 0)) {
                href = urls[0]!.href;
              }
            } else if (child.marks.some((m) => m.type.name === 'link')) {
              const mark = child.marks.find((m) => m.type.name === 'link');
              href = normalizeUrl(String(mark?.attrs?.href || child.text || ''));
              if (href && (child.text ?? '').trim() && normalizeUrl(child.text ?? '') !== href) {
                // Explicit markdown link with custom title — leave alone.
                href = null;
              }
            }
            if (!href) return;
            tr = tr.replaceWith(pos, pos + node.nodeSize, type.create({ href }));
            modified = true;
          });
          return modified ? tr : null;
        },
      }),
    ];
  },
});
