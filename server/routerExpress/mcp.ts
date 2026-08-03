import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod/v3';
import { prisma } from '../prisma';
import { integrationGateway, IntegrationError } from '../lib/integrationGateway';
import {
  isAllowedRedirectUri,
  issueOAuthTokens,
  MCP_SCOPES,
  mcpResourceUrl,
  parseRequestedScopes,
  pkceS256,
  publicBaseUrl,
  resolveMcpActor,
  sha256,
} from '../lib/mcpOAuth';
import { type AccessScope } from '../../shared/lib/accessTokenScopes';

const router = express.Router();
const jsonBody = express.json({ limit: '1mb', type: ['application/json', 'application/*+json'] });
const rateWindows = new Map<string, { resetAt: number; count: number }>();

function takeRateLimit(key: string, limit: number) {
  const now = Date.now();
  if (rateWindows.size > 10_000) {
    for (const [windowKey, window] of rateWindows) {
      if (window.resetAt <= now) rateWindows.delete(windowKey);
    }
  }
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { resetAt: now + 60_000, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function oauthError(res: Response, status: number, error: string, description?: string) {
  return res.status(status).json({ error, ...(description && { error_description: description }) });
}

function resourceMetadataUrl(req: Request) {
  return `${publicBaseUrl(req)}/.well-known/oauth-protected-resource`;
}

function requireHttpsOutsideLocal(req: Request, res: Response) {
  const base = new URL(publicBaseUrl(req));
  if (base.protocol === 'https:' || base.hostname === 'localhost' || base.hostname === '127.0.0.1') return true;
  oauthError(res, 400, 'invalid_request', 'OAuth endpoints require HTTPS outside localhost');
  return false;
}

router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'bkemo MCP',
  });
});

router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: MCP_SCOPES,
  });
});

router.post('/oauth/register', jsonBody, async (req, res) => {
  if (!requireHttpsOutsideLocal(req, res)) return;
  if (!takeRateLimit(`register:${req.ip}`, 20)) return oauthError(res, 429, 'slow_down');
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
  if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some((uri: unknown) => typeof uri !== 'string' || !isAllowedRedirectUri(uri))) {
    return oauthError(res, 400, 'invalid_redirect_uri');
  }
  const authMethod = req.body?.token_endpoint_auth_method || 'none';
  if (authMethod !== 'none') return oauthError(res, 400, 'invalid_client_metadata', 'Only public PKCE clients are supported');
  const grantTypes = req.body?.grant_types || ['authorization_code', 'refresh_token'];
  const responseTypes = req.body?.response_types || ['code'];
  if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code') || grantTypes.some((value: string) => !['authorization_code', 'refresh_token'].includes(value))) {
    return oauthError(res, 400, 'invalid_client_metadata');
  }
  if (!Array.isArray(responseTypes) || !responseTypes.includes('code') || responseTypes.some((value: string) => value !== 'code')) {
    return oauthError(res, 400, 'invalid_client_metadata');
  }
  const clientName = String(req.body?.client_name || '').trim();
  if (!clientName || clientName.length > 255) return oauthError(res, 400, 'invalid_client_metadata');
  const clientUri = req.body?.client_uri;
  const logoUri = req.body?.logo_uri;
  if ((clientUri !== undefined && (typeof clientUri !== 'string' || !isAllowedRedirectUri(clientUri)))
    || (logoUri !== undefined && (typeof logoUri !== 'string' || !isAllowedRedirectUri(logoUri)))) {
    return oauthError(res, 400, 'invalid_client_metadata');
  }

  const client = await prisma.oauthClient.create({
    data: {
      id: randomUUID(),
      clientName,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: 'none',
      clientUri: clientUri || null,
      logoUri: logoUri || null,
    },
  });
  res.status(201).json({
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
    ...(client.clientUri && { client_uri: client.clientUri }),
    ...(client.logoUri && { logo_uri: client.logoUri }),
  });
});

router.post('/oauth/token', express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
  if (!requireHttpsOutsideLocal(req, res)) return;
  if (!takeRateLimit(`token:${req.ip}`, 60)) return oauthError(res, 429, 'slow_down');
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  const grantType = String(req.body?.grant_type || '');
  const clientId = String(req.body?.client_id || '');
  const client = await prisma.oauthClient.findUnique({ where: { id: clientId } });
  if (!client) return oauthError(res, 401, 'invalid_client');

  if (grantType === 'authorization_code') {
    const code = String(req.body?.code || '');
    const verifier = String(req.body?.code_verifier || '');
    const redirectUri = String(req.body?.redirect_uri || '');
    const resource = String(req.body?.resource || '');
    const row = await prisma.oauthAuthorizationCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!row || row.clientId !== clientId || row.redirectUri !== redirectUri || row.resource !== resource || row.expiresAt <= new Date() || row.usedAt) {
      return oauthError(res, 400, 'invalid_grant');
    }
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || pkceS256(verifier) !== row.codeChallenge) {
      return oauthError(res, 400, 'invalid_grant');
    }
    const consent = await prisma.oauthConsent.findUnique({
      where: { accountId_clientId: { accountId: row.accountId, clientId } },
    });
    if (!consent || consent.revokedAt) return oauthError(res, 400, 'invalid_grant');
    const consumed = await prisma.oauthAuthorizationCode.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) return oauthError(res, 400, 'invalid_grant');
    return res.json(await issueOAuthTokens({
      clientId,
      accountId: row.accountId,
      scopes: (row.scopes as AccessScope[]) || [],
      resource: row.resource,
    }));
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(req.body?.refresh_token || '');
    const resource = String(req.body?.resource || '');
    const old = await prisma.oauthToken.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!old || old.clientId !== clientId || old.resource !== resource || old.revokedAt || !old.refreshExpiresAt || old.refreshExpiresAt <= new Date()) {
      return oauthError(res, 400, 'invalid_grant');
    }
    const consent = await prisma.oauthConsent.findUnique({
      where: { accountId_clientId: { accountId: old.accountId, clientId } },
    });
    if (!consent || consent.revokedAt) return oauthError(res, 400, 'invalid_grant');
    let requested: AccessScope[];
    try {
      requested = req.body?.scope ? parseRequestedScopes(req.body.scope) : (old.scopes as AccessScope[]);
    } catch {
      return oauthError(res, 400, 'invalid_scope');
    }
    const granted = new Set((consent.scopes as string[]) || []);
    if (requested.some((scope) => !granted.has(scope))) return oauthError(res, 400, 'invalid_scope');
    const revoked = await prisma.oauthToken.updateMany({ where: { id: old.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (revoked.count !== 1) return oauthError(res, 400, 'invalid_grant');
    return res.json(await issueOAuthTokens({
      clientId,
      accountId: old.accountId,
      scopes: requested,
      resource: old.resource,
    }));
  }

  return oauthError(res, 400, 'unsupported_grant_type');
});

function toolResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text) > 1024 * 1024) throw new IntegrationError('result_too_large', 'Result exceeds 1 MiB');
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { items: Array.isArray(value) ? value : [value] };
  return { content: [{ type: 'text' as const, text }], structuredContent };
}

function hasScope(scopes: AccessScope[], scope: AccessScope) {
  return scopes.includes(scope);
}

function createMcpServer(actor: Awaited<ReturnType<typeof resolveMcpActor>>) {
  if (!actor) throw new Error('actor required');
  const server = new McpServer({ name: 'bkemo', version: '2.0.0' });

  if (hasScope(actor.scopes, 'notes:read')) {
    server.registerTool('search_notes', {
      description: 'Search the current account notes.',
      inputSchema: {
        query: z.string().max(500).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        includeArchived: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, (input) => integrationGateway.searchNotes(actor, input).then(toolResult));

    server.registerTool('get_note', {
      description: 'Read one note by portable UUID.',
      inputSchema: { portableId: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, ({ portableId }) => integrationGateway.getNote(actor, portableId).then(toolResult));

    server.registerTool('list_tasks', {
      description: 'List tasks owned by the current account.',
      inputSchema: {
        completed: z.boolean().optional(),
        dueBefore: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, (input) => integrationGateway.listTasks(actor, input).then(toolResult));

    server.registerTool('list_recent_changes', {
      description: 'Read ordered account note changes after a cursor.',
      inputSchema: {
        cursor: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, ({ cursor, limit }) => integrationGateway.listRecentChanges(actor, cursor, limit).then(toolResult));

    server.registerResource('note', new ResourceTemplate('bkemo://notes/{portableId}', { list: undefined }), {
      description: 'A bkemo note owned by the authorized account',
      mimeType: 'application/json',
    }, async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await integrationGateway.getNote(actor, String(variables.portableId))) }],
    }));

    server.registerResource('today-tasks', 'bkemo://tasks/today', {
      description: 'Incomplete tasks due by the end of today',
      mimeType: 'application/json',
    }, async (uri) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await integrationGateway.listTasks(actor, { completed: false, dueBefore: end.toISOString() })) }] };
    });

    server.registerResource('changes', new ResourceTemplate('bkemo://changes/{cursor}', { list: undefined }), {
      description: 'Ordered note changes after a cursor',
      mimeType: 'application/json',
    }, async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await integrationGateway.listRecentChanges(actor, Number(variables.cursor), 100)) }],
    }));
  }

  if (hasScope(actor.scopes, 'tags:read')) {
    server.registerTool('list_tags', {
      description: 'List tags owned by the current account.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, () => integrationGateway.listTags(actor).then(toolResult));
  }

  if (hasScope(actor.scopes, 'attachments:read')) {
    server.registerTool('list_files', {
      description: 'List attachment metadata without file URLs or credentials.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, ({ limit }) => integrationGateway.listFiles(actor, limit).then(toolResult));
  }

  if (hasScope(actor.scopes, 'notes:write')) {
    const createSchema = {
      content: z.string().min(1).max(100000),
      dueDate: z.string().datetime().nullable().optional(),
      important: z.boolean().optional(),
      urgent: z.boolean().optional(),
      idempotencyKey: z.string().min(8).max(128),
    };
    server.registerTool('create_note', {
      description: 'Create a note. Hashtags use the same tag parsing as the app.',
      inputSchema: createSchema,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.createNote(actor, input).then(toolResult));
    server.registerTool('create_task', {
      description: 'Create a task.',
      inputSchema: createSchema,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.createNote(actor, { ...input, task: true }).then(toolResult));
    server.registerTool('update_note', {
      description: 'Update a note only if its revision still matches.',
      inputSchema: {
        portableId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        content: z.string().max(100000).optional(),
        dueDate: z.string().datetime().nullable().optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
        idempotencyKey: z.string().min(8).max(128),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.updateNote(actor, input).then(toolResult));

    const stateSchema = {
      portableId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      idempotencyKey: z.string().min(8).max(128),
    };
    server.registerTool('complete_task', {
      description: 'Set a task completion state if its revision matches.',
      inputSchema: { ...stateSchema, done: z.boolean() },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.completeTask(actor, input).then(toolResult));
    server.registerTool('archive_note', {
      description: 'Set a note archive state if its revision matches.',
      inputSchema: { ...stateSchema, archived: z.boolean() },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.archiveNote(actor, input).then(toolResult));
    server.registerTool('trash_note', {
      description: 'Move a note to trash if its revision matches. This is recoverable.',
      inputSchema: stateSchema,
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.trashNote(actor, input).then(toolResult));
  }

  if (hasScope(actor.scopes, 'comments:write')) {
    server.registerTool('add_comment', {
      description: 'Add a comment to an owned note.',
      inputSchema: {
        portableId: z.string().uuid(),
        text: z.string().min(1).max(10000),
        idempotencyKey: z.string().min(8).max(128),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (input) => integrationGateway.addComment(actor, input).then(toolResult));
  }
  return server;
}

router.all('/mcp', jsonBody, async (req, res) => {
  const actor = await resolveMcpActor(req);
  if (!actor) {
    res.set('WWW-Authenticate', `Bearer realm="bkemo-mcp", resource_metadata="${resourceMetadataUrl(req)}", scope="notes:read"`);
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!takeRateLimit(`${actor.credentialId}:${req.method}`, req.method === 'POST' ? 120 : 30)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const origin = req.headers.origin;
  if (origin && origin !== publicBaseUrl(req)) return res.status(403).json({ error: 'origin_not_allowed' });
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const server = createMcpServer(actor);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    res.once('finish', () => void server.close().catch(() => undefined));
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      const code = error instanceof IntegrationError ? error.code : 'internal_error';
      res.status(error instanceof IntegrationError ? 400 : 500).json({ error: code });
    }
  }
});

export default router;
