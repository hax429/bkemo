import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { prisma } from '../prisma';
import { resolvePermissions } from './permissions';
import { sanitizeScopes, type AccessScope } from '../../shared/lib/accessTokenScopes';
import { verifyToken } from './helper';
import { type IntegrationActor } from './mcpOAuth';
import {
  hasObsidianConnectAccess,
  OBSIDIAN_SCOPES,
  scopesForObsidian,
} from './obsidianContracts';
import { IntegrationError } from './integrationGateway';

export function obsidianScopes(): AccessScope[] {
  return [...OBSIDIAN_SCOPES];
}

export async function issueObsidianPairingCode(_input: {
  accountId: number;
  deviceLabel?: string;
}): Promise<never> {
  throw new IntegrationError(
    'invalid_request',
    'Pairing codes are retired — create an Obsidian access token in Settings → Security & API',
  );
}

export async function exchangeObsidianPairingCode(_input: {
  code: string;
  deviceLabel?: string;
}): Promise<never> {
  throw new IntegrationError(
    'invalid_request',
    'Pairing codes are retired — create an Obsidian access token in Settings → Security & API',
  );
}

export async function listObsidianDevices(accountId: number) {
  const rows = await prisma.integrationDeviceCredential.findMany({
    where: { accountId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    deviceLabel: row.deviceLabel,
    scopes: sanitizeScopes((row.scopes as string[]) || []),
    preview: row.preview,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

export async function revokeObsidianDevice(accountId: number, credentialId: string) {
  const updated = await prisma.integrationDeviceCredential.updateMany({
    where: { id: credentialId, accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 1) {
    await prisma.integrationAudit.create({
      data: {
        id: randomUUID(),
        accountId,
        credentialId: `device:${credentialId}`,
        source: 'obsidian',
        operation: 'revoke_device',
        outcome: 'success',
        targetId: credentialId,
        durationMs: 0,
      },
    }).catch(() => undefined);
  }
  return { success: updated.count === 1 };
}

export async function resolveFromAccessToken(
  raw: string,
  declaredPlatform: string = 'unknown',
): Promise<IntegrationActor | null> {
  const tokenData = await verifyToken(raw) as {
    tokenType?: string;
    jti?: string;
    sub?: string | number;
    name?: string;
    role?: string;
    exp?: number;
  } | null;
  if (!tokenData || tokenData.tokenType !== 'access' || !tokenData.jti) return null;

  const now = new Date();
  if (tokenData.exp && tokenData.exp * 1000 <= now.getTime()) return null;

  const row = await prisma.accessToken.findUnique({
    where: { jti: tokenData.jti },
    include: { account: true },
  });
  if (!row || !row.account) return null;
  if (row.expiresAt && row.expiresAt <= now) return null;
  if (!resolvePermissions(row.account).enabled) return null;

  const rawScopes = (row.scopes as string[]) || [];
  const scopes = scopesForObsidian(rawScopes.includes('app:full') ? rawScopes : sanitizeScopes(rawScopes));
  if (!hasObsidianConnectAccess(scopes)) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void prisma.accessToken.update({
      where: { id: row.id },
      data: { lastUsedAt: now },
    }).catch(() => undefined);
  }

  const expected = (row.platform || 'api').toLowerCase();
  if (declaredPlatform !== expected) {
    const { recordAccessTokenPlatformMismatch } = await import('./accessTokenService');
    void recordAccessTokenPlatformMismatch({
      accountId: row.accountId,
      accessTokenId: row.id,
      tokenName: row.name,
      expectedPlatform: expected,
      observedPlatform: declaredPlatform,
    }).catch(() => undefined);
  }

  return {
    accountId: row.accountId,
    accountName: row.account.name,
    role: row.account.role,
    credentialId: `access:${row.jti}`,
    scopes,
    source: 'obsidian',
  };
}

/** Normalize pasted credentials: trim, drop a leading Bearer prefix, strip wrapping quotes. */
export function normalizeCredentialInput(raw: string): string {
  let token = raw.trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token.replace(/\s+/g, '');
}

export async function validateObsidianAccessToken(raw: string) {
  const token = normalizeCredentialInput(raw);
  if (!token) throw new IntegrationError('invalid_access_token', 'Access token is invalid or was not issued by this bkemo instance');

  const tokenData = await verifyToken(token) as {
    tokenType?: string;
    jti?: string;
    exp?: number;
  } | null;
  if (!tokenData) {
    // Wrong JWT secret (e.g. production token against local) or malformed JWT.
    throw new IntegrationError('invalid_access_token', 'Access token is invalid or was not issued by this bkemo instance');
  }
  if (tokenData.tokenType !== 'access' || !tokenData.jti) {
    throw new IntegrationError(
      'invalid_access_token',
      'Access token is invalid or was not issued by this bkemo instance',
    );
  }
  if (tokenData.exp && tokenData.exp * 1000 <= Date.now()) {
    throw new IntegrationError('access_token_expired', 'Access token has expired — create a new one in Settings → Security');
  }

  const row = await prisma.accessToken.findUnique({
    where: { jti: tokenData.jti },
    include: { account: true },
  });
  if (!row) {
    throw new IntegrationError('access_token_revoked', 'Access token was revoked');
  }
  if (row.expiresAt && row.expiresAt <= new Date()) {
    throw new IntegrationError('access_token_expired', 'Access token has expired — create a new one in Settings → Security');
  }
  if (!row.account || !resolvePermissions(row.account).enabled) {
    throw new IntegrationError('unauthorized', 'Authentication required');
  }

  const rawScopes = (row.scopes as string[]) || [];
  const scopes = scopesForObsidian(rawScopes.includes('app:full') ? rawScopes : sanitizeScopes(rawScopes));
  if (!hasObsidianConnectAccess(scopes)) {
    throw new IntegrationError('forbidden', 'Missing permission for this operation');
  }

  const actor = await resolveFromAccessToken(token);
  if (!actor) throw new IntegrationError('invalid_access_token', 'Access token is invalid or was not issued by this bkemo instance');

  await prisma.integrationAudit.create({
    data: {
      id: randomUUID(),
      accountId: actor.accountId,
      credentialId: actor.credentialId,
      source: 'obsidian',
      operation: 'validate_access_token',
      outcome: 'success',
      durationMs: 0,
    },
  }).catch(() => undefined);
  return {
    accountName: actor.accountName,
    scopes: actor.scopes,
    preview: token.slice(-6),
    credentialKind: 'access-token' as const,
  };
}

export async function resolveObsidianActor(req: Request): Promise<IntegrationActor | null> {
  const header = req.headers.authorization;
  const raw = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) return null;
  const token = normalizeCredentialInput(raw);
  const platformHeader = req.headers['x-bkemo-platform'];
  const declared = typeof platformHeader === 'string' && platformHeader.trim()
    ? platformHeader.trim().toLowerCase()
    : 'unknown';
  // Device credentials are retired; access tokens only.
  return resolveFromAccessToken(token, declared);
}
