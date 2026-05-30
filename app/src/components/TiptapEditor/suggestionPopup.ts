/**
 * Minimal floating popup renderer for @tiptap/suggestion — no tippy dependency.
 * Renders a positioned list with keyboard (↑/↓/Enter/Esc) + mouse selection,
 * styled with the bkemo design tokens. Used by the slash menu and #tag autocomplete.
 */
export type SuggestItem = { id: string; label: string; hint?: string };

export function makeSuggestionRender(opts?: { emptyText?: string }) {
  let el: HTMLDivElement | null = null;
  let rows: HTMLElement[] = [];
  let items: SuggestItem[] = [];
  let selected = 0;
  let command: ((item: SuggestItem) => void) | null = null;

  const highlight = () => {
    rows.forEach((row, i) => {
      row.style.background = i === selected ? 'var(--hover)' : 'transparent';
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
      empty.textContent = opts?.emptyText ?? 'No matches';
      empty.style.cssText = 'padding:8px 10px;color:var(--fg-3);font-size:12px;font-family:var(--font-mono)';
      el.appendChild(empty);
      return;
    }
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--fg)';
      const label = document.createElement('span');
      label.textContent = it.label;
      label.style.flex = '1';
      row.appendChild(label);
      if (it.hint) {
        const hint = document.createElement('span');
        hint.textContent = it.hint;
        hint.style.cssText = 'color:var(--fg-3);font-size:11px;font-family:var(--font-mono)';
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
    // keep within viewport-ish: flip above if near the bottom
    const below = rect.bottom + 6;
    const maxTop = window.innerHeight - 300;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
    el.style.top = `${below > maxTop ? Math.max(8, rect.top - 290) : below}px`;
  };

  return {
    onStart: (props: any) => {
      items = props.items;
      selected = 0;
      command = (item) => props.command(item);
      el = document.createElement('div');
      el.className = 'bkemo';
      el.style.cssText = 'position:fixed;z-index:9999;min-width:200px;max-width:320px;max-height:280px;overflow:auto;padding:4px;background:var(--bg);border:1px solid var(--border-2);border-radius:var(--radius-lg);box-shadow:0 12px 32px rgba(0,0,0,0.4)';
      document.body.appendChild(el);
      buildList();
      position(props.clientRect?.());
    },
    onUpdate: (props: any) => {
      items = props.items;
      selected = Math.min(selected, Math.max(0, items.length - 1));
      command = (item) => props.command(item);
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
