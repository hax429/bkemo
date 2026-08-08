/** Shared leaf/ribbon mark for como (stable across bkemo ↔ Codian modes). */
export const COMO_ICON_ID = 'como-mark';

/** Compact mark: two arcs sharing a center — reads as combined, not Codian's C. */
export const COMO_ICON_SVG = `
  <g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
    <path d="M7 7a7 7 0 0 1 10 0"/>
    <path d="M5 5a10 10 0 0 1 14 0"/>
    <path d="M7 17a7 7 0 0 0 10 0"/>
    <path d="M5 19a10 10 0 0 0 14 0"/>
  </g>
`.trim();
