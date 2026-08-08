import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { prisma } from '../prisma';
import { generateAccessToken } from './helper';
import { expandScopes, sanitizeScopes, type AccessScope } from '../../shared/lib/accessTokenScopes';
import {
  ACCESS_TOKEN_ACCOUNT_CAP,
  APP_FULL_SCOPE,
  isAccessTokenPlatform,
  type AccessTokenPlatform,
} from '../../shared/lib/accessTokenPlatform';
import { noteSyncHub } from './noteSync';

const NATIVE_DEFAULT_NAME: Record<'ios' | 'macos', string> = {
  ios: 'iPhone',
  macos: 'Mac',
};

export async function mintManagedAccessToken(input: {
  accountId: number;
  name: string;
  platform: AccessTokenPlatform;
  scopes: string[];
  expiresInDays?: number | null;
  /** When true (native login), JWT has no path ACL — session-equivalent. */
  fullApp?: boolean;
}) {
  const account = await prisma.accounts.findUnique({ where: { id: input.accountId } });
  if (!account) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

  const count = await prisma.accessToken.count({ where: { accountId: input.accountId } });
  if (count >= ACCESS_TOKEN_ACCOUNT_CAP) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `At most ${ACCESS_TOKEN_ACCOUNT_CAP} access tokens per account. Revoke one first.`,
    });
  }

  if (!isAccessTokenPlatform(input.platform)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid platform' });
  }

  const name = input.name.trim().slice(0, 80);
  if (!name) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Give the token a name.' });

  const fullApp = input.fullApp === true || input.scopes.includes(APP_FULL_SCOPE);
  const scopes: string[] = fullApp ? [APP_FULL_SCOPE] : sanitizeScopes(input.scopes);
  if (scopes.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid scopes selected' });
  }

  const jti = randomUUID();
  const expSeconds = input.expiresInDays
    ? Math.floor(Date.now() / 1000) + input.expiresInDays * 86400
    : undefined;
  const permissions = fullApp ? undefined : expandScopes(scopes as AccessScope[]);
  const token = await generateAccessToken(
    { id: account.id, name: account.name, role: account.role },
    permissions,
    jti,
    expSeconds,
    input.platform,
  );
  const preview = token.slice(-6);
  const row = await prisma.accessToken.create({
    data: {
      accountId: input.accountId,
      name,
      platform: input.platform,
      jti,
      scopes,
      preview,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null,
    },
  });

  return {
    id: row.id,
    name: row.name,
    platform: row.platform as AccessTokenPlatform,
    scopes,
    token,
    preview,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Mint a full-app device token for iOS/macOS sign-in. */
export async function mintNativeDeviceAccessToken(input: {
  accountId: number;
  platform: 'ios' | 'macos';
  deviceName?: string | null;
  expiresInDays?: number | null;
}) {
  const name = (input.deviceName?.trim() || NATIVE_DEFAULT_NAME[input.platform]).slice(0, 80);
  return mintManagedAccessToken({
    accountId: input.accountId,
    name,
    platform: input.platform,
    scopes: [APP_FULL_SCOPE],
    expiresInDays: input.expiresInDays ?? null,
    fullApp: true,
  });
}

/**
 * Record a soft platform mismatch. Dedupes open incidents; wakes SSE listeners.
 * Returns whether a new incident was created (for notify-once semantics).
 */
export async function recordAccessTokenPlatformMismatch(input: {
  accountId: number;
  accessTokenId: number;
  tokenName: string;
  expectedPlatform: string;
  observedPlatform: string;
}): Promise<{ created: boolean }> {
  const existing = await prisma.accessTokenMisuseIncident.findFirst({
    where: {
      accessTokenId: input.accessTokenId,
      observedPlatform: input.observedPlatform,
      dismissedAt: null,
    },
  });

  if (existing) {
    await prisma.accessTokenMisuseIncident.update({
      where: { id: existing.id },
      data: {
        requestCount: { increment: 1 },
        lastSeenAt: new Date(),
        tokenName: input.tokenName,
        expectedPlatform: input.expectedPlatform,
      },
    });
    return { created: false };
  }

  await prisma.accessTokenMisuseIncident.create({
    data: {
      accountId: input.accountId,
      accessTokenId: input.accessTokenId,
      expectedPlatform: input.expectedPlatform,
      observedPlatform: input.observedPlatform,
      tokenName: input.tokenName,
      requestCount: 1,
    },
  });

  noteSyncHub.publish(input.accountId, { kind: 'security' });

  await prisma.integrationAudit.create({
    data: {
      id: randomUUID(),
      accountId: input.accountId,
      credentialId: `access:${input.accessTokenId}`,
      source: 'other',
      operation: 'access_token_platform_mismatch',
      outcome: 'denied',
      durationMs: 0,
      errorCode: `${input.expectedPlatform}->${input.observedPlatform}`.slice(0, 64),
    },
  }).catch(() => undefined);

  return { created: true };
}
