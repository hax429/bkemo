import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { makeSuggestionRender } from './suggestionPopup';

export type TagSuggestionOptions = {
  /** Returns existing tag paths (without leading #), e.g. ["ios", "ios/bug"]. */
  getTags: () => string[];
};

/** "#" autocomplete over existing project/tags. */
export const TagSuggestion = Extension.create<TagSuggestionOptions>({
  name: 'tagSuggestion',
  addOptions() {
    return { getTags: () => [] };
  },
  addProseMirrorPlugins() {
    const getTags = () => this.options.getTags();
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('tagSuggestion'),
        char: '#',
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertContent(`#${(props as any).label} `).run();
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          const tags = getTags();
          const matched = tags.filter((t) => t.toLowerCase().includes(q)).slice(0, 8);
          // Offer to create the typed tag if it doesn't already exist.
          if (query && !tags.some((t) => t.toLowerCase() === q)) {
            matched.unshift(query);
          }
          return matched.map((t) => ({ id: t, label: t, hint: tags.includes(t) ? undefined : 'new' }));
        },
        render: () => makeSuggestionRender({ emptyText: 'Type a tag…' }),
      }),
    ];
  },
});
