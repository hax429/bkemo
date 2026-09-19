/**
 * One-off cleanup for the iOS/macOS access-token-only auth change.
 *
 * Before this change, iOS/macOS "login" silently minted an unrestricted,
 * non-expiring `app:full` access token per device (see `mintNativeDeviceAccessToken`,
 * since removed from `server/lib/accessTokenService.ts`). Those legacy tokens
 * bypass the scope checks the new pairing flow relies on, so this revokes them,
 * forcing both devices to re-pair with a scoped token from Settings → Security & API.
 *
 * Safe to run more than once (no-op if nothing matches). Delete this file after
 * running it once in each environment (dev + production) that has legacy tokens.
 *
 * Run with: bun --env-file ./.env scripts/revoke-legacy-native-tokens.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.accessToken.findMany({
    where: { platform: { in: ['ios', 'macos'] } },
  });
  const legacy = candidates.filter(
    (row) => Array.isArray(row.scopes) && row.scopes.length === 1 && row.scopes[0] === 'app:full',
  );

  if (legacy.length === 0) {
    console.log('[revoke-legacy-native-tokens] nothing to revoke.');
    return;
  }

  console.log(
    `[revoke-legacy-native-tokens] revoking ${legacy.length} legacy app:full token(s): ` +
      legacy.map((row) => `#${row.id} (${row.platform}, "${row.name}")`).join(', '),
  );
  await prisma.accessToken.deleteMany({ where: { id: { in: legacy.map((row) => row.id) } } });
  console.log('[revoke-legacy-native-tokens] done. Re-pair both devices with a scoped token.');
}

main()
  .catch((e) => { console.error('[revoke-legacy-native-tokens] failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
