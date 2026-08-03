/**
 * Scoped access-token path matching.
 *
 * Tokens store concrete procedure paths (e.g. `notes.list`) and optional
 * prefix grants ending in `.` (e.g. `notifications.`). Matching must be exact
 * (or prefix), never substring — otherwise `notes.list` would also allow
 * `notes.listByIds`.
 */
export function tokenAllowsPath(permissions: string[] | undefined | null, path: string | undefined | null): boolean {
  if (!permissions || !path) return false;
  return permissions.some((perm) => {
    if (!perm) return false;
    if (perm.endsWith('.')) {
      const prefix = perm.slice(0, -1);
      return path === prefix || path.startsWith(perm);
    }
    return path === perm;
  });
}
