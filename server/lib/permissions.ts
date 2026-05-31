/**
 * Per-user permission model for bkemo.
 *
 * Roles stay binary in `accounts.role` ('superadmin' = owner, anything else =
 * member). Fine-grained capabilities live in the nullable `accounts.permissions`
 * JSON column. The owner always has every capability and is resolved here so
 * call sites never special-case null/owner.
 */

export type UserPermissions = {
  /** Can publicly share memos (note.shareNote + /m/:id links). */
  canShare: boolean;
  /** "Admin power" — can edit global site settings (AI, storage, schedule…). */
  manageSiteSettings: boolean;
  /** Can create/edit/delete other users and set their permissions. */
  manageUsers: boolean;
  /** When false the account cannot log in (soft-disable). */
  enabled: boolean;
};

export type PermissionFlag = keyof UserPermissions;

type AccountLike = { role?: string | null; permissions?: unknown } | null | undefined;

export const OWNER_ROLE = 'superadmin';

export const isOwner = (account: AccountLike): boolean => account?.role === OWNER_ROLE;

/** Defaults for a non-owner account (sharing on, everything privileged off). */
export const DEFAULT_PERMISSIONS: UserPermissions = {
  canShare: true,
  manageSiteSettings: false,
  manageUsers: false,
  enabled: true,
};

export function resolvePermissions(account: AccountLike): UserPermissions {
  if (isOwner(account)) {
    return { canShare: true, manageSiteSettings: true, manageUsers: true, enabled: true };
  }
  const p = (account?.permissions ?? {}) as Partial<UserPermissions>;
  return {
    canShare: p.canShare ?? DEFAULT_PERMISSIONS.canShare,
    manageSiteSettings: p.manageSiteSettings ?? DEFAULT_PERMISSIONS.manageSiteSettings,
    manageUsers: p.manageUsers ?? DEFAULT_PERMISSIONS.manageUsers,
    enabled: p.enabled ?? DEFAULT_PERMISSIONS.enabled,
  };
}

/** Coerce an arbitrary input object into a clean permissions JSON to persist. */
export function normalizePermissions(input: Partial<UserPermissions> | undefined | null): UserPermissions {
  return {
    canShare: !!(input?.canShare ?? DEFAULT_PERMISSIONS.canShare),
    manageSiteSettings: !!(input?.manageSiteSettings ?? DEFAULT_PERMISSIONS.manageSiteSettings),
    manageUsers: !!(input?.manageUsers ?? DEFAULT_PERMISSIONS.manageUsers),
    enabled: !!(input?.enabled ?? DEFAULT_PERMISSIONS.enabled),
  };
}
