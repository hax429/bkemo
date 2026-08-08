/**
 * Minimal Obsidian-like DOM helpers for UI tests without loading Obsidian.
 * Install once per process before rendering companion DOM.
 */

type DomAttrs = Record<string, string | number | boolean | null | undefined>;

type CreateOptions = {
  cls?: string | string[];
  text?: string;
  attr?: DomAttrs;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
};

function applyClass(el: Element, cls?: string | string[]) {
  if (!cls) return;
  const list = Array.isArray(cls) ? cls : cls.split(/\s+/).filter(Boolean);
  el.classList.add(...list);
}

function applyAttrs(el: HTMLElement, attr?: DomAttrs) {
  if (!attr) return;
  for (const [key, value] of Object.entries(attr)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      el.setAttribute(key, 'true');
      continue;
    }
    el.setAttribute(key, String(value));
  }
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  options: CreateOptions = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyClass(el, options.cls);
  applyAttrs(el, options.attr);
  if (options.title) el.title = options.title;
  if (options.type && 'type' in el) (el as HTMLInputElement).type = options.type;
  if (options.value !== undefined && 'value' in el) (el as HTMLInputElement).value = options.value;
  if (options.placeholder !== undefined && 'placeholder' in el) {
    (el as HTMLInputElement).placeholder = options.placeholder;
  }
  if (options.text !== undefined) el.textContent = options.text;
  parent.appendChild(el);
  return el;
}

declare global {
  interface HTMLElement {
    empty(): void;
    addClass(...classes: string[]): void;
    setText(text: string): void;
    createDiv(options?: CreateOptions): HTMLDivElement;
    createSpan(options?: CreateOptions): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: CreateOptions,
    ): HTMLElementTagNameMap[K];
  }
}

let installed = false;

/** Patch HTMLElement with Obsidian's createEl / createDiv helpers. */
export function installObsidianDom(): void {
  if (installed) return;
  const proto = HTMLElement.prototype;

  proto.empty = function empty() {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  proto.addClass = function addClass(...classes: string[]) {
    this.classList.add(...classes.filter(Boolean));
  };

  proto.setText = function setText(text: string) {
    this.textContent = text;
  };

  proto.createDiv = function createDiv(options?: CreateOptions) {
    return createChild(this, 'div', options);
  };

  proto.createSpan = function createSpan(options?: CreateOptions) {
    return createChild(this, 'span', options);
  };

  proto.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: CreateOptions,
  ) {
    return createChild(this, tag, options);
  };

  installed = true;
}

/** Fresh document body root for a UI test. */
export function createTestRoot(className = 'bkemo-test-root'): HTMLDivElement {
  installObsidianDom();
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.className = className;
  document.body.appendChild(root);
  return root;
}

export function queryCard(root: ParentNode, portableId: string): HTMLElement | null {
  return root.querySelector(`[data-portable-id="${portableId}"]`);
}
