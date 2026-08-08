import { Menu, setIcon, type WorkspaceLeaf } from 'obsidian';

export type ComoMode = 'bkemo' | 'codian';

export const COMO_MODE_TRANSITION_MS = 180;
export const BKEMO_VIEW_TYPE = 'bkemo-sidebar';
export const CODIAN_VIEW_TYPE = 'codian-view';

export function viewTypeForMode(mode: ComoMode): string {
  return mode === 'codian' ? CODIAN_VIEW_TYPE : BKEMO_VIEW_TYPE;
}

export function modeForViewType(viewType: string): ComoMode | null {
  if (viewType === CODIAN_VIEW_TYPE) return 'codian';
  if (viewType === BKEMO_VIEW_TYPE) return 'bkemo';
  return null;
}

export interface ComoModeHost {
  activeMode: ComoMode;
  setActiveMode(mode: ComoMode): Promise<void>;
  activateModeView(mode: ComoMode, leaf?: WorkspaceLeaf | null): Promise<void>;
}

/** Fade the leaf content, then swap view type in-place. */
export async function switchComoMode(
  host: ComoModeHost,
  next: ComoMode,
  leaf: WorkspaceLeaf | null,
): Promise<void> {
  if (host.activeMode === next) {
    // Still ensure the correct view is showing if state drifted.
    await host.activateModeView(next, leaf);
    return;
  }

  const targetLeaf = leaf;
  const content = targetLeaf?.view?.containerEl;
  if (content) {
    content.addClass('como-mode-leave');
    await sleep(COMO_MODE_TRANSITION_MS);
  }

  await host.setActiveMode(next);
  await host.activateModeView(next, targetLeaf);

  const el = targetLeaf?.view?.containerEl;
  if (el) {
    el.removeClass('como-mode-leave');
    el.addClass('como-mode-enter');
    window.setTimeout(() => el.removeClass('como-mode-enter'), COMO_MODE_TRANSITION_MS + 40);
  }
}

export function showModeMenu(
  host: ComoModeHost,
  event: MouseEvent,
  anchor: HTMLElement,
  leaf: WorkspaceLeaf | null,
): void {
  const menu = new Menu();
  menu.addItem((item) => {
    item
      .setTitle('Notes')
      .setIcon('notebook-pen')
      .setChecked(host.activeMode === 'bkemo')
      .onClick(() => {
        void switchComoMode(host, 'bkemo', leaf);
      });
  });
  menu.addItem((item) => {
    item
      .setTitle('Chat')
      .setIcon('message-square')
      .setChecked(host.activeMode === 'codian')
      .onClick(() => {
        void switchComoMode(host, 'codian', leaf);
      });
  });
  menu.showAtMouseEvent(event);
  // Keep a11y hint on the anchor.
  anchor.setAttribute('aria-haspopup', 'menu');
}

export function attachModeSwitchTarget(
  el: HTMLElement,
  host: ComoModeHost,
  getLeaf: () => WorkspaceLeaf | null,
): void {
  el.addClass('como-mode-switch-target');
  el.setAttribute('title', 'Double-click to switch mode');
  el.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showModeMenu(host, event, el, getLeaf());
  });
}

/** Optional chevron affordance next to the brand title. */
export function attachModeSwitchChevron(
  parent: HTMLElement,
  host: ComoModeHost,
  getLeaf: () => WorkspaceLeaf | null,
): HTMLElement {
  const btn = parent.createSpan({ cls: 'como-mode-switch-chevron' });
  setIcon(btn, 'chevron-down');
  btn.setAttribute('aria-label', 'Switch como mode');
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showModeMenu(host, event, btn, getLeaf());
  });
  return btn;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
