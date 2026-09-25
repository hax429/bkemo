import type { ReactElement } from 'react';
import type { SidebarToolId } from '@/lib/bkemoSettings';

/**
 * Inline stroke icons for the sidebar (no network fetch, so they render in
 * the offline desktop app). Each one is drawn to read on its own at 18px:
 * a house, a sun for today, a calendar with this week's row filled, and so on.
 */
const PATHS: Record<SidebarToolId | 'search' | 'plus' | 'chevron' | 'hash' | 'settings', ReactElement> = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v10.5h13V9" /><path d="M10 19.5v-5.5h4v5.5" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  week: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><rect x="6" y="12.5" width="12" height="3.5" rx="1" fill="currentColor" stroke="none" /></>,
  matrix: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity=".35" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><circle cx="8" cy="13.25" r=".9" fill="currentColor" /><circle cx="12" cy="13.25" r=".9" fill="currentColor" /><circle cx="16" cy="13.25" r=".9" fill="currentColor" /><circle cx="8" cy="16.75" r=".9" fill="currentColor" /><circle cx="12" cy="16.75" r=".9" fill="currentColor" /></>,
  graph: <><circle cx="6" cy="6.5" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="10" cy="18" r="2.5" /><path d="M8.4 7.1l7.2 1.2M7.1 8.8l1.9 6.9M16.4 10l-4.6 6.2" /></>,
  files: <><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></>,
  trash: <><path d="M4 6.5h16M9.5 6.5V4.5h5v2" /><path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" /><path d="M10 10.5v6.5M14 10.5v6.5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  plus: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  hash: <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

export type SidebarIconName = keyof typeof PATHS;

export function SidebarIcon({ name, size = 18, style }: { name: SidebarIconName; size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
