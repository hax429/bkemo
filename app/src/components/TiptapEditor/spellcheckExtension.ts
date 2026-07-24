/**
 * Decoration-based English spellcheck for TipTap.
 *
 * Native browser spellcheck only marks words the user just typed — loaded
 * note content (the full-page editor) stays unmarked. This extension checks
 * with hunspell (nspell + dictionary-en) and paints wavy underlines so both
 * the stream composer and the note editor behave the same.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type Checker = { correct: (word: string) => boolean };

const key = new PluginKey('bkemoSpellcheck');
const WORD_RE = /[A-Za-z][A-Za-z'-]{1,}/g;
/** Skip tiny tokens and all-caps codes (BK, API, …). */
const SKIP_RE = /^[A-Z]{1,5}$/;
const AFF_URL = `${import.meta.env.BASE_URL}dictionaries/en.aff`;
const DIC_URL = `${import.meta.env.BASE_URL}dictionaries/en.dic`;

let checker: Checker | null = null;
let loadPromise: Promise<Checker | null> | null = null;
const listeners = new Set<() => void>();

function loadChecker(): Promise<Checker | null> {
  if (checker) return Promise.resolve(checker);
  if (loadPromise) return loadPromise;
  // Fetch static assets — do not import `dictionary-en` (Node fs + top-level await).
  loadPromise = import('nspell')
    .then(async (nspellMod) => {
      const nspell = (nspellMod as any).default ?? nspellMod;
      const [aff, dic] = await Promise.all([
        fetch(AFF_URL).then((response) => {
          if (!response.ok) throw new Error(`Failed to load ${AFF_URL}`);
          return response.text();
        }),
        fetch(DIC_URL).then((response) => {
          if (!response.ok) throw new Error(`Failed to load ${DIC_URL}`);
          return response.text();
        }),
      ]);
      checker = nspell({ aff, dic }) as Checker;
      listeners.forEach((fn) => fn());
      return checker;
    })
    .catch((err) => {
      console.warn('[spellcheck] dictionary failed to load', err);
      loadPromise = null;
      return null;
    });
  return loadPromise;
}

/** Product / tech terms we don't want waved. */
const ALLOW = new Set([
  'bkemo', 'blinko', 'tauri', 'trpc', 'neon', 'vpn', 'ui', 'ux', 'api', 'url',
  'http', 'https', 'todo', 'todos', 'memo', 'memos', 'deepseek', 'siliconflow',
  'openai', 'anthropic', 'llm', 'json', 'yaml', 'css', 'html', 'macos', 'ios',
]);

function shouldCheck(word: string): boolean {
  if (word.length < 3) return false;
  if (SKIP_RE.test(word)) return false;
  if (/^bk-/i.test(word)) return false;
  if (ALLOW.has(word.toLowerCase())) return false;
  return true;
}

function buildDecorations(doc: any, spell: Checker | null): DecorationSet {
  if (!spell) return DecorationSet.empty;
  const decorations: ReturnType<typeof Decoration.inline>[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type?.name === 'codeBlock') return false;
    if (!node.isText || !node.text) return;
    // Skip fenced / inline code.
    if (node.marks?.some((m: any) => m.type.name === 'code')) return;
    const text = node.text as string;
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const word = m[0];
      if (!shouldCheck(word)) continue;
      if (spell.correct(word) || spell.correct(word.toLowerCase())) continue;
      decorations.push(
        Decoration.inline(pos + m.index, pos + m.index + word.length, {
          class: 'bk-spell-error',
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const Spellcheck = Extension.create({
  name: 'bkemoSpellcheck',

  onCreate() {
    void loadChecker();
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => buildDecorations(state.doc, checker),
          apply(tr, old) {
            if (!tr.docChanged && !tr.getMeta(key)) return old;
            return buildDecorations(tr.doc, checker);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
        view(view) {
          const refresh = () => {
            view.dispatch(view.state.tr.setMeta(key, true));
          };
          listeners.add(refresh);
          void loadChecker().then(() => refresh());
          return {
            destroy() {
              listeners.delete(refresh);
            },
          };
        },
      }),
    ];
  },
});
