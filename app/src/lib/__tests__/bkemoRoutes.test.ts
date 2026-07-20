import { describe, expect, it } from 'vitest';
import { pathForRoute, pathForSettingsSection, routeFromPath, settingsSectionFromPath } from '../bkemoRoutes';

describe('bkemo canonical root routes', () => {
  it.each([
    ['home', '/'],
    ['today', '/today'],
    ['week', '/week'],
    ['matrix', '/matrix'],
    ['graph', '/graph'],
    ['calendar', '/calendar'],
    ['files', '/files'],
    ['analytics', '/analytics'],
    ['ai', '/ai'],
    ['settings', '/settings'],
  ])('maps %s to %s', (route, pathname) => {
    expect(pathForRoute(route)).toBe(pathname);
    expect(routeFromPath(pathname).known).toBe(true);
  });

  it('does not retain /bkemo as an application route', () => {
    expect(routeFromPath('/bkemo')).toEqual({ route: 'home', known: false });
  });

  it('uses readable direct settings URLs', () => {
    expect(pathForSettingsSection('appear')).toBe('/settings/appearance');
    expect(settingsSectionFromPath('/settings/appearance')).toBe('appear');
    expect(settingsSectionFromPath('/settings/import')).toBe('import');
    expect(settingsSectionFromPath('/settings/export')).toBe('export');
  });
});
