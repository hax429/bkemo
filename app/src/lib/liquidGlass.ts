/**
 * Refractive "liquid glass" for bkemo's glass buttons and surfaces.
 *
 * Adapted from nikdelvin/liquid-glass (MIT, © 2025 Nikita Stadnik): an SVG
 * displacement map, sized to each element and its corner radius, bends the
 * backdrop near the rim, with a touch of chromatic aberration, then
 * brightness + saturation. It is applied as `backdrop-filter: url(...)`,
 * which only Chromium supports; elsewhere (Safari, the macOS app's WebKit
 * view) the plain blur glass from bkemo-theme.css stays in place.
 *
 * Opt-in by selector below. Memo cards are deliberately excluded: there can
 * be hundreds, and each filter is a GPU pass.
 */

type GlassOptions = { depth: number; strength: number; aberration: number; blur: number; brightness: number; saturate: number };

const SELECTOR = [
  '.bk-glass-btn',
  '.bk-glass',
  '.bk-native-button:not(.is-ghost)',
  '.bk-ai-dialog-button',
  '.bk-settings-float',
  '.bk-glass-nav.is-active',
  '.bk-context-menu',
  '.bk-mobile-tabs',
].join(',');

const BUTTON: GlassOptions = { depth: 8, strength: 42, aberration: 2, blur: 1.5, brightness: 1.25, saturate: 1.2 };
const SURFACE: GlassOptions = { depth: 12, strength: 64, aberration: 1.5, blur: 3, brightness: 1.08, saturate: 1.5 };

function optionsFor(el: HTMLElement): GlassOptions {
  const isButton = el.matches('.bk-glass-btn, .bk-native-button, .bk-ai-dialog-button, .bk-glass-nav');
  return isButton ? BUTTON : SURFACE;
}

function displacementMap(width: number, height: number, radius: number, depth: number): string {
  const yEdge = Math.ceil((radius / height) * 15);
  const xEdge = Math.ceil((radius / width) * 15);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg height="${height}" width="${width}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      '<style>.mix{mix-blend-mode:screen}</style>' +
      '<defs>' +
        `<linearGradient id="Y" x1="0" x2="0" y1="${yEdge}%" y2="${100 - yEdge}%"><stop offset="0%" stop-color="#0F0"/><stop offset="100%" stop-color="#000"/></linearGradient>` +
        `<linearGradient id="X" x1="${xEdge}%" x2="${100 - xEdge}%" y1="0" y2="0"><stop offset="0%" stop-color="#F00"/><stop offset="100%" stop-color="#000"/></linearGradient>` +
      '</defs>' +
      `<rect x="0" y="0" height="${height}" width="${width}" fill="#808080"/>` +
      '<g filter="blur(2px)">' +
        `<rect x="0" y="0" height="${height}" width="${width}" fill="#000080"/>` +
        `<rect x="0" y="0" height="${height}" width="${width}" fill="url(#Y)" class="mix"/>` +
        `<rect x="0" y="0" height="${height}" width="${width}" fill="url(#X)" class="mix"/>` +
        // Neutral grey centre = no displacement; only the rim refracts.
        `<rect x="${depth}" y="${depth}" height="${Math.max(0, height - 2 * depth)}" width="${Math.max(0, width - 2 * depth)}" fill="#808080" rx="${radius}" ry="${radius}" filter="blur(${depth}px)"/>` +
      '</g>' +
    '</svg>',
  );
}

function displacementFilter(width: number, height: number, radius: number, o: GlassOptions): string {
  const map = displacementMap(width, height, radius, o.depth);
  // One displacement per colour channel at slightly different strengths gives
  // the chromatic fringe at the edge.
  const channel = (scale: number, matrix: string, result: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>` +
    `<feColorMatrix type="matrix" values="${matrix}" result="${result}"/>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg height="${height}" width="${width}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      '<defs><filter id="lg" color-interpolation-filters="sRGB">' +
        `<feImage x="0" y="0" height="${height}" width="${width}" href="${map}" result="map"/>` +
        channel(o.strength + o.aberration * 2, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r') +
        channel(o.strength + o.aberration, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g') +
        channel(o.strength, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b') +
        '<feBlend in="r" in2="g" mode="screen"/><feBlend in2="b" mode="screen"/>' +
      '</filter></defs>' +
    '</svg>',
  ) + '#lg';
}

export function supportsRefraction(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('div');
  probe.style.cssText = 'backdrop-filter: url(#probe)';
  return probe.style.backdropFilter === 'url(#probe)' || probe.style.backdropFilter === 'url("#probe")';
}

const cache = new Map<string, string>();

function paint(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 4 || height < 4) return;
  const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, height / 2, width / 2);
  const o = optionsFor(el);
  const key = `${width}x${height}r${Math.round(radius)}:${o === BUTTON ? 'b' : 's'}`;
  let filter = cache.get(key);
  if (!filter) {
    filter = `blur(${o.blur / 2}px) url("${displacementFilter(width, height, radius, o)}") blur(${o.blur}px) brightness(${o.brightness}) saturate(${o.saturate})`;
    if (cache.size > 200) cache.clear();
    cache.set(key, filter);
  }
  if (el.dataset.lgKey === key) return;
  el.dataset.lgKey = key;
  el.style.setProperty('backdrop-filter', filter);
}

let started = false;

/** Call once at startup. No-op where refraction isn't supported. */
export function startLiquidGlass(): void {
  if (started || typeof window === 'undefined' || !supportsRefraction()) return;
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return;
  started = true;
  document.documentElement.classList.add('bk-lg-on');

  const sized = new ResizeObserver((entries) => {
    for (const entry of entries) paint(entry.target as HTMLElement);
  });
  const attach = (el: Element) => {
    if (!(el instanceof HTMLElement) || el.dataset.lgBound) return;
    el.dataset.lgBound = '1';
    sized.observe(el);
    paint(el);
  };
  // An element that stops matching (e.g. a nav row losing `is-active`) must
  // drop its filter, or its transparent box would keep bending the backdrop.
  const detach = (el: HTMLElement) => {
    sized.unobserve(el);
    delete el.dataset.lgBound;
    delete el.dataset.lgKey;
    el.style.removeProperty('backdrop-filter');
  };
  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.matches(SELECTOR)) attach(root);
    root.querySelectorAll?.(SELECTOR).forEach(attach);
  };

  scan(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => { if (node instanceof Element) scan(node); });
      // Class toggles (e.g. is-ghost → primary) change eligibility.
      if (m.type === 'attributes' && m.target instanceof HTMLElement) {
        if (m.target.matches(SELECTOR)) attach(m.target);
        else if (m.target.dataset.lgBound) detach(m.target);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
