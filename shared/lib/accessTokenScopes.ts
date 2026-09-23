/**
 * Access-token permission scopes for the public API.
 *
 * The server enforces permissions in `authProcedure` by exact path match (or a
 * trailing-`.` prefix grant such as `notifications.`). Each scope here expands
 * to the concrete procedure paths it grants, so a token minted with
 * `notes:read` can only hit the read endpoints, `notes:write` the write ones, etc.
 *
 * Shared between server (minting + the scope catalogue endpoint) and client
 * (the Settings → Security & API token creator).
 */

export type AccessScope =
  | 'notes:read'
  | 'notes:write'
  | 'tags:read'
  | 'tags:write'
  | 'attachments:read'
  | 'attachments:write'
  | 'comments:read'
  | 'comments:write'
  | 'reactions'
  | 'share'
  | 'notifications'
  | 'follows'
  | 'analytics:read'
  | 'settings';

export type AccessScopeDef = {
  id: AccessScope;
  label: string;
  description: string;
  /** Exact tRPC procedure paths, or prefix grants ending in `.` (e.g. `notifications.`). */
  paths: string[];
};

/** Pseudo-path: may call SETTINGS_REDACTED_READS via nativeSettings.perform. */
export const SETTINGS_REDACTED_GRANT = 'nativeSettings.redactedRead';

export const ACCESS_SCOPES: AccessScopeDef[] = [
  {
    id: 'notes:read',
    label: 'Read notes',
    description: 'List, search, and read memos & tasks (and their history).',
    paths: [
      'notes.list',
      'notes.changes',
      'notes.detail',
      'notes.listByIds',
      'notes.streamCount',
      'notes.dailyReviewNoteList',
      'notes.randomNoteList',
      'notes.relatedNotes',
      'notes.noteReferenceList',
      'notes.getNoteHistory',
      'notes.getNoteVersion',
      'notes.internalSharedWithMe',
      // Bookmark cards render stored link metadata for the note being read.
      'linkEnrichment.getByUrl',
      'linkEnrichment.listForNote',
    ],
  },
  {
    id: 'notes:write',
    label: 'Write notes',
    description: 'Create, edit, complete, reorder, trash, and delete memos & tasks.',
    paths: [
      'notes.upsert',
      'notes.toggleDone',
      'notes.reviewNote',
      'notes.updateMany',
      'notes.trashMany',
      'notes.deleteMany',
      'notes.addReference',
      'notes.clearRecycleBin',
      'notes.updateAttachmentsOrder',
      'notes.updateNotesOrder',
      // The composer's cross-device draft and bookmark re-fetch/edit.
      'draft.get',
      'draft.snapshot',
      'draft.clear',
      'draft.finalize',
      'linkEnrichment.retry',
      'linkEnrichment.saveMarkdown',
      'linkEnrichment.process',
    ],
  },
  {
    id: 'tags:read',
    label: 'Read tags',
    description: 'List the tag tree.',
    paths: ['tags.list', 'tags.fullTagNameById'],
  },
  {
    id: 'tags:write',
    label: 'Manage tags',
    description: 'Rename, re-icon, reorder, and delete tags.',
    paths: ['tags.updateTagMany', 'tags.updateTagName', 'tags.updateTagIcon', 'tags.deleteOnlyTag', 'tags.deleteTagWithAllNote', 'tags.updateTagOrder'],
  },
  {
    id: 'attachments:read',
    label: 'Read files',
    description: 'List files attached across your notes.',
    paths: ['attachments.allFiles', 'attachments.list'],
  },
  {
    id: 'attachments:write',
    label: 'Manage files',
    description: 'Create folders, rename, move, and delete attachments.',
    paths: ['attachments.delete', 'attachments.createFolder', 'attachments.rename', 'attachments.move'],
  },
  {
    id: 'comments:read',
    label: 'Read comments',
    description: 'List comments on notes.',
    paths: ['comments.list'],
  },
  {
    id: 'comments:write',
    label: 'Write comments',
    description: 'Create, edit, and delete comments.',
    paths: ['comments.create', 'comments.update', 'comments.delete'],
  },
  {
    id: 'reactions',
    label: 'Reactions',
    description: 'List and toggle reactions on shared notes.',
    paths: ['reaction.list', 'reaction.toggle'],
  },
  {
    id: 'share',
    label: 'Share',
    description: 'Create public & internal share links.',
    paths: ['notes.shareNote', 'notes.internalShareNote', 'notes.getInternalSharedUsers'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'List, create, mark-read, and delete your notifications.',
    paths: ['notifications.'],
  },
  {
    id: 'follows',
    label: 'Follows',
    description: 'Follow / unfollow and read your follow lists.',
    paths: ['follows.'],
  },
  {
    id: 'analytics:read',
    label: 'Read analytics',
    description: 'Read note-count and monthly activity stats.',
    paths: ['analytics.'],
  },
  {
    id: 'settings',
    label: 'Manage settings',
    description: 'Preferences plus your AI, schedule, storage, MCP and data settings (as your account allows). Secrets stay redacted. Cannot mint tokens, change password/2FA, administer users, or touch the recovery key.',
    paths: [
      'config.list', 'config.update',
      'users.nativeAccountList', 'users.clearUserData',
      'accessTokens.list', 'accessTokens.revoke', 'accessTokens.misuseIncidents', 'accessTokens.dismissMisuse',
      'oauth.connections', 'oauth.revoke',
      'ai.createProvider', 'ai.updateProvider', 'ai.deleteProvider',
      'ai.createModel', 'ai.updateModel', 'ai.deleteModel',
      'ai.fetchProviderModels', 'ai.createModelsFromProvider', 'ai.testConnect',
      'ai.rebuildEmbeddingProgress', 'ai.rebuildEmbeddingStart', 'ai.rebuildEmbeddingResume', 'ai.rebuildEmbeddingRetryFailed', 'ai.rebuildEmbeddingStop',
      'task.list', 'task.upsertTask', 'task.saveWeeklyKnowledgeSettings',
      'task.testWeeklyKnowledgeConnection', 'task.checkWeeklyKnowledgeStatus',
      'attachments.storageStats', 'attachments.storageActivity', 'attachments.migrationStatus',
      'attachments.startStorageMigration', 'attachments.retryStorageMigration', 'attachments.cleanupStorageMigrationSources',
      'config.testStorage', 'config.saveStorage', 'config.verifyActiveSetup', 'config.removeStorageCredentials',
      'config.saveNeonCuSettings', 'config.neonCuUsage', 'config.clearNeonCuSettings',
      'mcpServers.create', 'mcpServers.update', 'mcpServers.testConnection', 'mcpServers.toggle',
      'mcpServers.delete', 'mcpServers.emergencyDisable', 'mcpServers.connectionStatus', 'mcpServers.getTools',
      'task.exportPortable', 'task.previewPortableImport', 'task.importPortable',
      SETTINGS_REDACTED_GRANT,
    ],
  },
];

/**
 * Reads whose raw tRPC result carries secrets (provider API keys, MCP headers,
 * export credentials). A `settings` token reaches them only through
 * `nativeSettings.perform`, which redacts the result; the pseudo-path below
 * marks that permission.
 */
export const SETTINGS_REDACTED_READS = [
  'ai.getAllProviders', 'ai.getAllModels', 'mcpServers.list', 'task.weeklyKnowledgeSettings', 'config.neonCuSettings',
];

/**
 * Settings operations a scoped token can never reach: each would widen its own
 * access (mint a Full access token, take over the login, attach an account),
 * administer other users, or expose/replace the site recovery key. They need
 * a Full access token or the web session.
 */
export const SETTINGS_PRIVILEGED_PATHS = [
  'accessTokens.create', 'users.upsertUser', 'users.generate2FASecret', 'users.verify2FAToken',
  'users.linkAccount', 'users.unlinkAccount',
  'users.list', 'users.upsertUserByAdmin', 'users.deleteUser', 'users.clearSiteData',
  'task.exportRecoveryKey', 'task.importRecoveryKey',
];

/**
 * Granted to every scoped token: reading your own profile and harmless client
 * boot metadata. Without these a scoped native session 403s on startup.
 */
export const BASE_TOKEN_PATHS = ['users.detail', 'ai.configStatus', 'plugin.getPluginCssContents'];

const SCOPE_IDS = new Set(ACCESS_SCOPES.map((s) => s.id));

/** Keep only recognized scope ids. */
export function sanitizeScopes(scopes: string[]): AccessScope[] {
  return scopes.filter((s): s is AccessScope => SCOPE_IDS.has(s as AccessScope));
}

/** Flatten the given scopes to the concrete tRPC path fragments they grant. */
export function expandScopes(scopes: string[]): string[] {
  const out = new Set<string>(BASE_TOKEN_PATHS);
  for (const id of sanitizeScopes(scopes)) {
    ACCESS_SCOPES.find((s) => s.id === id)?.paths.forEach((p) => out.add(p));
  }
  return [...out];
}

/** Catalogue without the internal path lists (for the scope-picker UI / API). */
export function publicScopeCatalogue(): { id: AccessScope; label: string; description: string }[] {
  return ACCESS_SCOPES.map(({ id, label, description }) => ({ id, label, description }));
}
