import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { makeSuggestionRender, type SuggestItem } from './suggestionPopup';

type Cmd = SuggestItem & { run: (editor: any, range: any) => void };

const COMMANDS: Cmd[] = [
  { id: 'h1', label: 'Heading 1', hint: '#', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', hint: '##', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', hint: '###', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { id: 'bullet', label: 'Bullet list', hint: '-', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', hint: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'task', label: 'To-do list', hint: '[ ]', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'quote', label: 'Quote', hint: '>', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: 'code', label: 'Code block', hint: '```', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { id: 'divider', label: 'Divider', hint: '---', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

/** "/" slash command menu for block formatting. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => (props as Cmd).run(editor, range),
        items: ({ query }) => COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 9),
        render: () => makeSuggestionRender({ emptyText: 'No command' }),
      }),
    ];
  },
});
