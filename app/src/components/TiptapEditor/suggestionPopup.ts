/**
 * Minimal floating popup renderer for @tiptap/suggestion — no tippy / HeroUI.
 * Portaled outside the app root, so it must carry `.bkemo` theme attrs (see UI.md).
 */
import { loadPrefs } from '@/lib/bkemoSettings';

export type SuggestItem = { id: string; label: string; hint?: string };

function themeAttrs() {
  const prefs = loadPrefs();
  const preset = prefs.theme === 'light'
    ? 'light'
    : (prefs.accent?.toLowerCase() === '#5e6ad2'
      ? 'developer'
      : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));
  return {
    theme: prefs.theme,
    density: prefs.density,
    preset,
    accent: prefs.accent,
  };
}

export function makeSuggestionRender(opts?: { emptyText?: string }) {
  let el: HTMLDivElement | null = null;
  let rows: HTMLElement[] = [];
  let items: SuggestItem[] = [];
  let selected = 0;
  let command: ((item: SuggestItem) => void) | null = null;

  const highlight = () => {
    rows.forEach((row, i) => {
      row.classList.toggle('is-active', i === selected);
    });
  };

  // Rebuild the list only when the items change (NOT on hover) so the row under
  // the cursor isn't destroyed before its mousedown fires.
  const buildList = () => {
    if (!el) return;
    el.innerHTML = '';
    rows = [];
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bk-suggest-empty';
      empty.textContent = opts?.emptyText ?? 'No matches';
      el.appendChild(empty);
      return;
    }
    items.forEach((it, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bk-suggest-row';
      row.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.className = 'bk-suggest-label';
      label.textContent = it.label;
      row.appendChild(label);
      if (it.hint) {
        const hint = document.createElement('span');
        hint.className = 'bk-suggest-hint';
        hint.textContent = it.hint;
        row.appendChild(hint);
      }
      // mousedown (not click) fires before the editor blurs; preventDefault keeps focus.
      row.addEventListener('mousedown', (e) => { e.preventDefault(); command?.(it); });
      row.addEventListener('mousemove', () => { if (selected !== i) { selected = i; highlight(); } });
      rows.push(row);
      el!.appendChild(row);
    });
    highlight();
  };

  const position = (rect: DOMRect | null) => {
    if (!el || !rect) return;
    const below = rect.bottom + 6;
    const maxTop = window.innerHeight - 300;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
    el.style.top = `${below > maxTop ? Math.max(8, rect.top - 290) : below}px`;
  };

  const mount = () => {
    const theme = themeAttrs();
    el = document.createElement('div');
    el.className = 'bkemo bk-suggest-menu';
    el.setAttribute('role', 'listbox');
    el.dataset.theme = theme.theme;
    el.dataset.density = theme.density;
    el.dataset.preset = theme.preset;
    if (theme.accent) el.style.setProperty('--accent', theme.accent);
    document.body.appendChild(el);
  };

  return {
    onStart: (props: any) => {
      items = props.items;
      selected = 0;
      command = (item) => props.command(item);
      mount();
      buildList();
      position(props.clientRect?.());
    },
    onUpdate: (props: any) => {
      items = props.items;
      selected = Math.min(selected, Math.max(0, items.length - 1));
      command = (item) => props.command(item);
      if (!el) mount();
      buildList();
      position(props.clientRect?.());
    },
    onKeyDown: (props: any) => {
      const { event } = props;
      if (event.key === 'ArrowDown') { selected = (selected + 1) % Math.max(1, items.length); highlight(); return true; }
      if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % Math.max(1, items.length); highlight(); return true; }
      if (event.key === 'Enter') { if (items[selected]) command?.(items[selected]); return true; }
      if (event.key === 'Escape') { el?.remove(); el = null; return true; }
      return false;
    },
    onExit: () => { el?.remove(); el = null; rows = []; },
  };
}
