/**
 * Preload for Obsidian UI tests: install happy-dom globals once per process.
 * Usage: `node --import tsx --import ./src/test/register-dom.ts --test …`
 */
import { Window } from 'happy-dom';

const win = new Window({ url: 'https://bk.hax429.me/' });
const g = globalThis as typeof globalThis & {
  window: Window;
  document: Document;
  HTMLElement: typeof HTMLElement;
  Node: typeof Node;
  MouseEvent: typeof MouseEvent;
  KeyboardEvent: typeof KeyboardEvent;
  Element: typeof Element;
  DocumentFragment: typeof DocumentFragment;
};

g.window = win;
g.document = win.document as unknown as Document;
g.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
g.Node = win.Node as unknown as typeof Node;
g.Element = win.Element as unknown as typeof Element;
g.DocumentFragment = win.DocumentFragment as unknown as typeof DocumentFragment;
g.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
g.KeyboardEvent = win.KeyboardEvent as unknown as typeof KeyboardEvent;
