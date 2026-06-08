/**
 * Access-token permission scopes for the public API.
 *
 * The server enforces permissions in `authProcedure` by checking that the called
 * tRPC procedure path contains one of the token's permission strings. Each scope
 * here expands to the concrete procedure paths it grants, so a token minted with
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
  | 'analytics:read';

export type AccessScopeDef = {
  id: AccessScope;
  label: string;
  description: string;
  /** tRPC procedure-path fragments this scope grants (matched as substrings). */
  paths: string[];
};

export const ACCESS_SCOPES: AccessScopeDef[] = [
  {
    id: 'notes:read',
    label: 'Read notes',
    description: 'List, search, and read memos & tasks (and their history).',
    paths: [
      'notes.list',
      'notes.detail',
      'notes.listByIds',
      'notes.dailyReviewNoteList',
      'notes.randomNoteList',
      'notes.relatedNotes',
      'notes.noteReferenceList',
      'notes.getNoteHistory',
      'notes.getNoteVersion',
      'notes.internalSharedWithMe',
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
];

const SCOPE_IDS = new Set(ACCESS_SCOPES.map((s) => s.id));

/** Keep only recognized scope ids. */
export function sanitizeScopes(scopes: string[]): AccessScope[] {
  return scopes.filter((s): s is AccessScope => SCOPE_IDS.has(s as AccessScope));
}

/** Flatten the given scopes to the concrete tRPC path fragments they grant. */
export function expandScopes(scopes: string[]): string[] {
  const out = new Set<string>();
  for (const id of sanitizeScopes(scopes)) {
    ACCESS_SCOPES.find((s) => s.id === id)?.paths.forEach((p) => out.add(p));
  }
  return [...out];
}

/** Catalogue without the internal path lists (for the scope-picker UI / API). */
export function publicScopeCatalogue(): { id: AccessScope; label: string; description: string }[] {
  return ACCESS_SCOPES.map(({ id, label, description }) => ({ id, label, description }));
}
