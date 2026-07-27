const DEFAULT_NEON_CONNECTION_LIMIT = '2';

/**
 * Keep the configured URL untouched except for small pooled Neon runtimes,
 * where Prisma's default pool is unnecessarily large for a single-user app.
 */
export function runtimeDatabaseUrl(raw = process.env.DATABASE_URL): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const isPooledNeon = url.hostname.endsWith('.neon.tech') && url.hostname.includes('-pooler.');
    if (isPooledNeon && !url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', DEFAULT_NEON_CONNECTION_LIMIT);
    }
    return url.toString();
  } catch {
    return raw;
  }
}
