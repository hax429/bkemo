import { randomBytes, randomUUID } from 'crypto';
import type { Request } from 'express';
import { prisma } from '../prisma';
import { resolvePermissions } from './permissions';
import { sanitizeScopes, type AccessScope } from '../../shared/lib/accessTokenScopes';
import { verifyToken } from './helper';
import { randomOpaqueToken, sha256, type IntegrationActor } from './mcpOAuth';
import {
  DEVICE_CREDENTIAL_TTL_MS,
  formatPairingCode,
  hasObsidianConnectAccess,
  isValidPairingCodeFormat,
  normalizePairingCode,
  OBSIDIAN_SCOPES,
  PAIRING_CODE_TTL_MS,
  scopesForObsidian,
} from './obsidianContracts';
import { IntegrationError } from './integrationGateway';

export function obsidianScopes(): AccessScope[] {
  return [...OBSIDIAN_SCOPES];
}

export async function issueObsidianPairingCode(input: {
  accountId: number;
  deviceLabel?: string;
}) {
  const raw = formatPairingCode(randomBytes(8));
  const scopes = obsidianScopes();
  const row = await prisma.integrationPairingCode.create({
    data: {
      id: randomUUID(),
      codeHash: sha256(normalizePairingCode(raw)),
      accountId: input.accountId,
      deviceLabel: (input.deviceLabel || 'Obsidian').slice(0, 80),
      scopes,
      expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
    },
  });
  await prisma.integrationAudit.create({
    data: {
      id: randomUUID(),
      accountId: input.accountId,
      credentialId: `pairing:${row.id}`,
      source: 'obsidian',
      operation: 'issue_pairing_code',
      outcome: 'success',
      targetId: row.id,
      durationMs: 0,
    },
  }).catch(() => undefined);
  return {
    code: raw,
    expiresAt: row.expiresAt,
    deviceLabel: row.deviceLabel,
    scopes,
  };
}

export async function exchangeObsidianPairingCode(input: {
  code: string;
  deviceLabel?: string;
}) {
  const normalized = normalizePairingCode(input.code);
  if (!isValidPairingCodeFormat(normalized)) {
    throw new IntegrationError('invalid_pairing_code', 'Pairing code is invalid');
  }

  const codeHash = sha256(normalized);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.integrationPairingCode.findUnique({ where: { codeHash } });
    if (!row) throw new IntegrationError('invalid_pairing_code', 'Pairing code is invalid');
    if (row.usedAt) throw new IntegrationError('pairing_code_used', 'Pairing code was already used');
    if (row.expiresAt <= now) throw new IntegrationError('pairing_code_expired', 'Pairing code has expired');

    const account = await tx.accounts.findUnique({ where: { id: row.accountId } });
    if (!account || !resolvePermissions(account).enabled) {
      throw new IntegrationError('unauthorized', 'Authentication required');
    }

    await tx.integrationPairingCode.update({
      where: { id: row.id },
      data: { usedAt: now },
    });

    const token = randomOpaqueToken();
    const scopes = scopesForObsidian(sanitizeScopes((row.scopes as string[]) || []));
    const deviceLabel = (input.deviceLabel || row.deviceLabel || 'Obsidian').slice(0, 80);
    const credential = await tx.integrationDeviceCredential.create({
      data: {
        id: randomUUID(),
        tokenHash: sha256(token),
        accountId: row.accountId,
        deviceLabel,
        scopes,
        preview: token.slice(-6),
        expiresAt: new Date(Date.now() + DEVICE_CREDENTIAL_TTL_MS),
      },
    });

    await tx.integrationAudit.create({
      data: {
        id: randomUUID(),
        accountId: row.accountId,
        credentialId: `device:${credential.id}`,
        source: 'obsidian',
        operation: 'exchange_pairing_code',
        outcome: 'success',
        targetId: credential.id,
        durationMs: 0,
      },
    });

    return { token, credential, scopes };
  });

  return {
    token: result.token,
    credentialId: result.credential.id,
    deviceLabel: result.credential.deviceLabel,
    scopes: result.scopes,
    expiresAt: result.credential.expiresAt,
    preview: result.credential.preview,
  };
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

async function resolveFromDeviceCredential(raw: string): Promise<IntegrationActor | null> {
  const now = new Date();
  const credential = await prisma.integrationDeviceCredential.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { account: true },
  });
  if (!credential) return null;
  if (credential.revokedAt || (credential.expiresAt && credential.expiresAt <= now)) return null;
  if (!resolvePermissions(credential.account).enabled) return null;

  if (!credential.lastUsedAt || Date.now() - credential.lastUsedAt.getTime() > 60_000) {
    void prisma.integrationDeviceCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: now },
    }).catch(() => undefined);
  }

  const scopes = scopesForObsidian(sanitizeScopes((credential.scopes as string[]) || []));
  if (!hasObsidianConnectAccess(scopes)) return null;

  return {
    accountId: credential.accountId,
    accountName: credential.account.name,
    role: credential.account.role,
    credentialId: `device:${credential.id}`,
    scopes,
    source: 'obsidian',
  };
}

export async function resolveFromAccessToken(raw: string): Promise<IntegrationActor | null> {
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

  const scopes = scopesForObsidian(sanitizeScopes((row.scopes as string[]) || []));
  if (!hasObsidianConnectAccess(scopes)) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void prisma.accessToken.update({
      where: { id: row.id },
      data: { lastUsedAt: now },
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

  const scopes = scopesForObsidian(sanitizeScopes((row.scopes as string[]) || []));
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

  // Device-credential table may be absent before the Obsidian migration is applied.
  try {
    const device = await resolveFromDeviceCredential(token);
    if (device) return device;
  } catch {
    /* fall through to access-token auth */
  }
  return resolveFromAccessToken(token);
}
