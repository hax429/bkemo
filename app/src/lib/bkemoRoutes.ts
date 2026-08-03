import type { BkemoRoute } from '@/components/bkemo/Sidebar';

const ROUTE_PATHS: Record<string, string> = {
  home: '/',
  inbox: '/inbox',
  today: '/today',
  week: '/week',
  matrix: '/matrix',
  trash: '/trash',
  calendar: '/calendar',
  graph: '/graph',
  files: '/files',
  analytics: '/analytics',
  ai: '/ai',
  settings: '/settings',
};

const SETTINGS_PATHS: Record<string, string> = {
  prefs: '',
  appear: 'appearance',
  tools: 'tools',
  account: 'account',
  security: 'security',
  apidocs: 'api',
  ai: 'ai',
  task: 'tasks',
  storage: 'storage',
  mcp: 'mcp',
  desktop: 'desktop',
  developer: 'developer',
  data: 'data',
  import: 'import',
  export: 'export',
  about: 'about',
};

export function normalizeBkemoRoute(route: BkemoRoute): BkemoRoute {
  if (route === 'daily') return 'today';
  if (route === 'tomorrow') return 'week';
  if (route === 'random') return 'home';
  if (route === 'stats') return 'analytics';
  return route;
}

export function routeFromPath(pathname: string): { route: BkemoRoute; known: boolean } {
  if (pathname === '/') return { route: 'home', known: true };
  if (/^\/n\/\d+$/.test(pathname)) return { route: 'home', known: true };
  if (/^\/note\/[0-9a-f-]{36}$/i.test(pathname)) return { route: 'home', known: true };
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return { route: 'settings', known: true };
  if (pathname.startsWith('/tag/')) return { route: `tag:${decodeURIComponent(pathname.slice(5))}`, known: true };
  const match = Object.entries(ROUTE_PATHS).find(([, path]) => path === pathname);
  return match ? { route: match[0], known: true } : { route: 'home', known: false };
}

export function pathForRoute(route: BkemoRoute): string {
  const normalized = normalizeBkemoRoute(route);
  if (typeof normalized === 'string' && normalized.startsWith('tag:')) return `/tag/${encodeURIComponent(normalized.slice(4))}`;
  return ROUTE_PATHS[normalized] ?? '/';
}

export function settingsSectionFromPath(pathname: string): string {
  const segment = pathname.startsWith('/settings/') ? pathname.slice('/settings/'.length) : '';
  return Object.entries(SETTINGS_PATHS).find(([, path]) => path === segment)?.[0] ?? 'prefs';
}

export function pathForSettingsSection(section: string): string {
  const segment = SETTINGS_PATHS[section] ?? '';
  return segment ? `/settings/${segment}` : '/settings';
}
