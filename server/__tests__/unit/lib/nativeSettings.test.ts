import { describe, expect, test } from 'bun:test';
import { allowsSettingsAccess, allowsSettingsPath, redactSettingsResult, settingsConfig, settingsOperations } from '../../../lib/nativeSettings';

describe('native settings capability boundary', () => {
  test('restricted tokens never gain access through introspection', () => {
    expect(allowsSettingsPath(['notes.read'], 'config.update')).toBe(false);
    expect(allowsSettingsPath([], 'users.detail')).toBe(false);
    expect(allowsSettingsPath(['config.'], 'config.update')).toBe(true);
    expect(allowsSettingsPath(['config.list'], 'config.listExtra')).toBe(false);
    expect(allowsSettingsPath(undefined, 'config.update')).toBe(true);
  });
  test('roles and live account grants intersect separately with token grants', () => {
    expect(allowsSettingsAccess({ role: 'user' }, 'site')).toBe(false);
    expect(allowsSettingsAccess({ role: 'user', permissions: { manageSiteSettings: true } }, 'site')).toBe(true);
    expect(allowsSettingsAccess({ role: 'user', permissions: { manageSiteSettings: true } }, 'owner')).toBe(false);
    expect(allowsSettingsAccess({ role: 'superadmin' }, 'owner')).toBe(true);
    expect(allowsSettingsAccess({ role: 'user', permissions: { enabled: false } }, 'account')).toBe(false);
  });
  test('catalog is explicit and configuration writes validate types', () => {
    expect(new Set(settingsOperations.map(op => op.id)).size).toBe(settingsOperations.length);
    expect(settingsOperations.some(op => op.id === 'users.login')).toBe(false);
    expect(settingsOperations.filter(op => /delete|clearUser|clearSite|revoke/i.test(op.id)).every(op => op.destructive)).toBe(true);
    const columns = settingsConfig.find(item => item.key === 'largeDeviceCardColumns')!;
    expect(columns.schema.safeParse(200).success).toBe(false);
    expect(columns.schema.safeParse(3).success).toBe(true);
    expect(settingsConfig.some(item => item.key === 's3AccessKeySecret')).toBe(false);
  });
  test('workspace appearance keeps sidebar layout through native saves', () => {
    const prefs = settingsConfig.find(item => item.key === 'bkemoPrefs')!;
    const base = { theme: 'dark', accent: '#e2a96b', density: 'regular' };
    const layout = { sidebarTools: ['home', 'calendar', 'trash'], sidebarWidth: 300, sidebarHeatmap: true };
    expect(prefs.schema.parse({ ...base, ...layout })).toEqual({ ...base, ...layout });
    expect(prefs.schema.safeParse({ ...base, sidebarTools: ['home', 'today', 'week', 'matrix', 'files', 'graph'] }).success).toBe(false);
    expect(prefs.schema.safeParse({ ...base, sidebarTools: ['ai'] }).success).toBe(false);
    expect(prefs.schema.safeParse({ ...base, sidebarWidth: 1000 }).success).toBe(false);
  });
  test('nested provider credentials never appear in result lists', () => {
    expect(redactSettingsResult([{ title: 'Provider', apiKey: 'secret', models: [{ provider: { password: 'hidden', title: 'ok' } }] }])).toEqual([{ title: 'Provider', models: [{ provider: { title: 'ok' } }] }]);
  });
});
