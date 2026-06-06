import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { makeSuggestionRender } from './suggestionPopup';
import { noteLinkHref } from '@/lib/noteLinks';

export type NoteLinkItem = { id: number; title: string };

export type NoteLinkSuggestionOptions = {
  /** Search existing memos/todos for the `[[` autocomplete (matched + partial). */
  getNotes: (query: string) => Promise<NoteLinkItem[]> | NoteLinkItem[];
};

/**
 * `[[` autocomplete that links a memo/todo to another one. Typing `[[` opens a
 * popup of matching memos; choosing one inserts a markdown link to that note
 * (see lib/noteLinks). The link is plain text in the document — the relationship
 * is persisted as a noteReference on save (and can be promoted to a subtask).
 */
export const NoteLinkSuggestion = Extension.create<NoteLinkSuggestionOptions>({
  name: 'noteLinkSuggestion',
  addOptions() {
    return { getNotes: () => [] };
  },
  addProseMirrorPlugins() {
    const getNotes = (query: string) => this.options.getNotes(query);
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('noteLinkSuggestion'),
        char: '[[',
        startOfLine: false,
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          // props is the chosen suggestion row: { id: "<noteId>", label, hint }.
          const id = Number((props as any).id);
          const title = (props as any).label as string;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'text', text: title, marks: [{ type: 'link', attrs: { href: noteLinkHref(id) } }] },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        items: async ({ query }) => {
          const notes = await getNotes(query);
          return notes
            .slice(0, 8)
            .map((n) => ({ id: String(n.id), label: n.title, hint: `BK-${n.id}` }));
        },
        render: () => makeSuggestionRender({ emptyText: 'Search memos…' }),
      }),
    ];
  },
});
