import { z } from 'zod';
import { tokenAllowsPath } from '../../shared/lib/tokenPathMatch';
import { SETTINGS_REDACTED_GRANT, SETTINGS_REDACTED_READS } from '../../shared/lib/accessTokenScopes';
import { ZConfigSchema, ZUserPerferConfigKey } from '../../shared/lib/types';
import { resolvePermissions } from './permissions';

// A deliberately bounded settings surface, not an arbitrary RPC proxy. Existing
// procedures remain responsible for validation, authorization and side effects.
export type SettingsAccess = 'account' | 'site' | 'users' | 'owner';
export type SettingsOperation = { id: string; section: string; title: string; access: SettingsAccess; destructive?: boolean };
const group = (section: string, access: SettingsAccess, entries: [string, string, boolean?][]): SettingsOperation[] =>
  entries.map(([id, title, destructive]) => ({ id, section, title, access, destructive }));
export const settingsOperations = [
  ...group('account', 'account', [
    ['users.detail', 'Your profile'], ['users.upsertUser', 'Update profile or password'],
    ['users.nativeAccountList', 'Linked accounts'], ['users.linkAccount', 'Link account'], ['users.unlinkAccount', 'Unlink account', true],
    ['users.generate2FASecret', 'Set up authenticator'], ['users.verify2FAToken', 'Verify authenticator code'],
    ['users.clearUserData', 'Delete all your data', true],
  ]),
  ...group('account', 'users', [
    ['users.list', 'Users'], ['users.upsertUserByAdmin', 'Add or edit user'], ['users.deleteUser', 'Delete user', true],
  ]),
  ...group('account', 'site', [['users.clearSiteData', 'Delete all site data', true]]),
  ...group('security', 'account', [
    ['accessTokens.list', 'Access tokens'], ['accessTokens.create', 'Create access token'], ['accessTokens.revoke', 'Revoke access token', true],
    ['accessTokens.misuseIncidents', 'Token alerts'], ['accessTokens.dismissMisuse', 'Dismiss token alert'],
    ['oauth.connections', 'Connected applications'], ['oauth.revoke', 'Disconnect application', true],
  ]),
  ...group('ai', 'site', [
    ['ai.getAllProviders', 'Providers'], ['ai.createProvider', 'Add provider'], ['ai.updateProvider', 'Edit provider'], ['ai.deleteProvider', 'Delete provider', true],
    ['ai.getAllModels', 'Models'], ['ai.createModel', 'Add model'], ['ai.updateModel', 'Edit model'], ['ai.deleteModel', 'Delete model', true],
    ['ai.fetchProviderModels', 'Discover provider models'], ['ai.createModelsFromProvider', 'Import selected models'], ['ai.testConnect', 'Test provider connection'],
    ['ai.rebuildEmbeddingProgress', 'Embedding progress'], ['ai.rebuildEmbeddingStart', 'Rebuild embeddings', true],
    ['ai.rebuildEmbeddingResume', 'Resume embedding rebuild'], ['ai.rebuildEmbeddingRetryFailed', 'Retry failed embeddings'], ['ai.rebuildEmbeddingStop', 'Stop embedding rebuild'],
  ]),
  ...group('task', 'site', [
    ['task.list', 'Scheduled jobs'], ['task.upsertTask', 'Configure or run scheduled job'],
    ['task.weeklyKnowledgeSettings', 'Weekly knowledge export'], ['task.saveWeeklyKnowledgeSettings', 'Save weekly knowledge settings'],
    ['task.testWeeklyKnowledgeConnection', 'Test knowledge connection'], ['task.checkWeeklyKnowledgeStatus', 'Check knowledge status'],
  ]),
  ...group('storage', 'site', [
    ['attachments.storageStats', 'Storage usage'], ['attachments.storageActivity', 'Storage activity'],
    ['config.testStorage', 'Test storage connection'], ['config.saveStorage', 'Save storage connection'],
    ['config.verifyActiveSetup', 'Verify active setup'], ['config.removeStorageCredentials', 'Remove storage credentials', true],
    ['attachments.migrationStatus', 'Transfer status'], ['attachments.startStorageMigration', 'Start storage transfer', true],
    ['attachments.retryStorageMigration', 'Retry storage transfer'], ['attachments.cleanupStorageMigrationSources', 'Clean up transferred sources', true],
  ]),
  ...group('storage', 'owner', [
    ['config.neonCuSettings', 'Neon usage settings'], ['config.saveNeonCuSettings', 'Save Neon usage settings'],
    ['config.neonCuUsage', 'Neon usage'], ['config.clearNeonCuSettings', 'Remove Neon usage credentials', true],
  ]),
  ...group('mcp', 'site', [
    ['mcpServers.list', 'Connections'], ['mcpServers.create', 'Add connection'], ['mcpServers.update', 'Edit connection'],
    ['mcpServers.testConnection', 'Test connection'], ['mcpServers.toggle', 'Enable or disable connection'],
    ['mcpServers.delete', 'Delete connection', true], ['mcpServers.emergencyDisable', 'Disable every connection', true],
    ['mcpServers.connectionStatus', 'Connection status'], ['mcpServers.getTools', 'Available tools'],
  ]),
  ...group('data', 'account', [
    ['task.exportPortable', 'Export notes or backup'], ['task.previewPortableImport', 'Preview import'], ['task.importPortable', 'Import backup or notes', true],
  ]),
  ...group('data', 'site', [['task.exportRecoveryKey', 'Export recovery key'], ['task.importRecoveryKey', 'Import recovery key', true]]),
];

export function allowsSettingsPath(permissions: string[] | undefined, path: string) {
  return permissions === undefined || tokenAllowsPath(permissions, path) || needsRedactedGrant(permissions, path);
}
/** True when a scoped token may call this secret-bearing read, redacted, via perform. */
export function needsRedactedGrant(permissions: string[] | undefined, path: string) {
  return permissions !== undefined && SETTINGS_REDACTED_READS.includes(path) && !tokenAllowsPath(permissions, path)
    && tokenAllowsPath(permissions, SETTINGS_REDACTED_GRANT);
}
export function allowsSettingsAccess(account: { role?: string; permissions?: unknown }, access: SettingsAccess) {
  const permissions = resolvePermissions(account);
  if (!permissions.enabled) return false;
  return access === 'account' || (access === 'site' && permissions.manageSiteSettings)
    || (access === 'users' && permissions.manageUsers) || (access === 'owner' && account.role === 'superadmin');
}

export const settingLabels: Record<string, string> = {
  textFoldLength: 'Fold memos after this many characters', smallDeviceCardColumns: 'Phone card columns', mediumDeviceCardColumns: 'Tablet card columns',
  largeDeviceCardColumns: 'Desktop card columns', isOrderByCreateTime: 'Order by creation time', isHideCommentInCard: 'Hide comments and reactions on cards',
  hidePcEditor: 'Use modal editor', maxHomePageWidth: 'Maximum content width', timeFormat: 'Timestamp format',
  isAllowRegister: 'Allow registration', autoArchivedDays: 'Archive after days', isAutoArchived: 'Automatic archiving',
  bkemoPrefs: 'Workspace appearance', fontStyle: 'Workspace font', desktopHotkeys: 'Keyboard shortcuts', systemTray: 'Menu bar icon',
};
export const humanizeSetting = (key: string) => settingLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, s => s.toUpperCase());
const secretPattern = /password|secret|apiKey|accessKey|passphrase|consumerKey/i;
export const isSettingsSecret = (key: string) => secretPattern.test(key) && !/configured|masked|hasApiKey|hasPassphrase/i.test(key);

// Supply concrete types where the legacy config schema deliberately uses any.
const overrides: Record<string, z.ZodType> = {
  isAllowRegister: z.boolean(), isOrderByCreateTime: z.boolean(),
  timeFormat: z.enum(['relative', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm', 'HH:mm', 'YYYY-MM-DD HH:mm:ss', 'MM-DD HH:mm', 'MMM DD, YYYY', 'MMM DD, YYYY HH:mm', 'dddd, MMM DD, YYYY']),
  smallDeviceCardColumns: z.number().int().min(1).max(2), mediumDeviceCardColumns: z.number().int().min(1).max(4), largeDeviceCardColumns: z.number().int().min(1).max(6),
  language: z.string().min(2).max(32), theme: z.enum(['light', 'dark', 'system']),
  bkemoPrefs: z.object({theme: z.enum(['light', 'dark']), accent: z.string().regex(/^#[a-fA-F0-9]{6}$/), density: z.enum(['compact', 'regular', 'comfy']), bgGradient: z.enum(['none', 'dusk', 'warm', 'aurora']).optional(), graphShowAll: z.boolean().optional(), taskReminders: z.boolean().optional()}),
  tavilyMaxResult: z.number().int().min(1).max(100),
};
const excludedConfig = new Set(['desktopHotkeys', 'systemTray', 's3AccessKeyId', 's3AccessKeySecret', 's3Endpoint', 's3Bucket', 's3Region', 's3CustomPath', 's3ForcePathStyle', 'localCustomPath', 'objectStorage', 's3CredentialsConfigured', 's3AccessKeyIdMasked', 's3SecretAccessKeyMasked']);
export const settingsConfig = Object.entries(ZConfigSchema.shape).filter(([key]) => !excludedConfig.has(key)).map(([key, original]) => {
  const personal = ZUserPerferConfigKey.safeParse(key).success;
  const section = /bkemoPrefs|theme|fontStyle|Background/.test(key) ? 'appear' : /twoFactor/.test(key) ? 'security'
    : /autoArchived|isAutoArchived/.test(key) ? 'task' : /Model|embedding|Embedding|rerank|ai[A-Z]|globalPrompt|tavily|Proxy/.test(key) ? 'ai' : 'prefs';
  let schema: z.ZodType = overrides[key] ?? original;
  // Unknown config values here are strings; structured values have explicit schemas.
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' });
  if (!json.type && !json.anyOf) schema = z.string();
  if (/Length|Width|Dimensions|TopK|Days|Port/.test(key)) schema = z.number().int().min(0);
  return { key, section, title: humanizeSetting(key), access: (personal ? 'account' : 'site') as SettingsAccess, schema };
});

export function redactSettingsResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSettingsResult);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !isSettingsSecret(key) && !/^(token|tokens|salt)$/i.test(key)).map(([key, entry]) => [key, redactSettingsResult(entry)]));
  }
  return value;
}
