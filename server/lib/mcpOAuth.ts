import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Request } from 'express';
import { prisma } from '../prisma';
import { resolvePermissions } from './permissions';
import { sanitizeScopes, type AccessScope } from '../../shared/lib/accessTokenScopes';

export type IntegrationActor = {
  accountId: number;
  accountName: string;
  role: string;
  credentialId: string;
  scopes: AccessScope[];
  source: 'mcp' | 'obsidian' | 'cli' | 'automation' | 'other';
};

export const MCP_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const MCP_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MCP_AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const MCP_SCOPES: AccessScope[] = [
  'notes:read',
  'notes:write',
  'tags:read',
  'attachments:read',
  'comments:read',
  'comments:write',
];

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomOpaqueToken = () => randomBytes(32).toString('base64url');
export const pkceS256 = (value: string) => createHash('sha256').update(value).digest('base64url');

export function publicBaseUrl(req?: Request) {
  const configured = process.env.MCP_PUBLIC_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (!req) throw new Error('MCP_PUBLIC_URL or NEXTAUTH_URL is required');
  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

export const mcpResourceUrl = (req?: Request) => `${publicBaseUrl(req)}/mcp`;

export function parseRequestedScopes(raw: unknown): AccessScope[] {
  const requested = String(raw || 'notes:read').split(/\s+/).filter(Boolean);
  const scopes = sanitizeScopes(requested).filter((scope) => MCP_SCOPES.includes(scope));
  if (!scopes.length || scopes.length !== requested.length) throw new Error('invalid_scope');
  return scopes;
}

export function isAllowedRedirectUri(raw: string) {
  try {
    const url = new URL(raw);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
  } catch {
    return false;
  }
}

export async function validateAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  resource: string;
}, req?: Request) {
  if (input.responseType !== 'code') throw new Error('unsupported_response_type');
  if (input.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    throw new Error('invalid_code_challenge');
  }
  if (input.resource !== mcpResourceUrl(req)) throw new Error('invalid_target');
  const client = await prisma.oauthClient.findUnique({ where: { id: input.clientId } });
  if (!client) throw new Error('invalid_client');
  const redirectUris = (client.redirectUris as string[]) || [];
  if (!redirectUris.includes(input.redirectUri)) throw new Error('invalid_redirect_uri');
  return { client, scopes: parseRequestedScopes(input.scope) };
}

export async function resolveMcpActor(req: Request): Promise<IntegrationActor | null> {
  const header = req.headers.authorization;
  const raw = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) return null;

  const now = new Date();
  const oauth = await prisma.oauthToken.findUnique({
    where: { accessTokenHash: sha256(raw) },
    include: { account: true },
  });
  if (oauth) {
    if (oauth.revokedAt || oauth.expiresAt <= now || oauth.resource !== mcpResourceUrl(req)) return null;
    if (!resolvePermissions(oauth.account).enabled) return null;
    if (!oauth.lastUsedAt || Date.now() - oauth.lastUsedAt.getTime() > 60_000) {
      void prisma.oauthToken.update({ where: { id: oauth.id }, data: { lastUsedAt: now } }).catch(() => undefined);
    }
    return {
      accountId: oauth.accountId,
      accountName: oauth.account.name,
      role: oauth.account.role,
      credentialId: `oauth:${oauth.id}`,
      scopes: sanitizeScopes((oauth.scopes as string[]) || []),
      source: 'mcp',
    };
  }
  return null;
}

export async function issueOAuthTokens(data: {
  clientId: string;
  accountId: number;
  scopes: AccessScope[];
  resource: string;
}) {
  const accessToken = randomOpaqueToken();
  const refreshToken = randomOpaqueToken();
  const now = Date.now();
  await prisma.oauthToken.create({
    data: {
      id: randomUUID(),
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      clientId: data.clientId,
      accountId: data.accountId,
      scopes: data.scopes,
      resource: data.resource,
      expiresAt: new Date(now + MCP_ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now + MCP_REFRESH_TOKEN_TTL_MS),
    },
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(MCP_ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: data.scopes.join(' '),
  };
}
