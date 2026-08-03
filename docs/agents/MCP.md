# MCP integration guide

## Current contract

bkemo exposes one stateless Streamable HTTP MCP endpoint at `/mcp`. The legacy
HTTP+SSE `/sse` and `/messages` transports are removed. The endpoint accepts
only OAuth access tokens issued for the exact `/mcp` resource; ordinary bkemo
session tokens and scoped REST API tokens are not MCP credentials.

The authorization server provides:

- protected-resource metadata at `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/mcp`;
- authorization-server metadata at
  `/.well-known/oauth-authorization-server`;
- public-client dynamic registration at `/oauth/register`;
- authenticated consent at `/oauth/authorize`;
- authorization-code exchange and refresh rotation at `/oauth/token`;
- S256 PKCE, exact redirect matching, short-lived access tokens, hashed stored
  credentials, audience binding, and user revocation.

Set `MCP_PUBLIC_URL` to the externally reachable origin, without a trailing
slash. `NEXTAUTH_URL` is the fallback. This value is security-sensitive because
it becomes the OAuth issuer and defines the only accepted MCP audience. Public
deployments must use HTTPS. Keep `JWT_SECRET` stable and set a separate
`BKEMO_CONFIG_ENCRYPTION_KEY` when outbound connector headers are stored.

## Scopes and surface

OAuth consent supports only scopes used by the curated MCP surface:

| Scope | Capability |
|---|---|
| `notes:read` | `search_notes` (returns `{ notes, nextCursor }`), `get_note`, `list_tasks`, `list_recent_changes`, note/task/change resources |
| `notes:write` | `create_note`, `create_task`, `update_note`, `complete_task`, `archive_note`, `trash_note` |
| `tags:read` | `list_tags` and tag metadata in note results |
| `attachments:read` | `list_files` and attachment metadata in note results |
| `comments:read` | comment metadata in note results |
| `comments:write` | `add_comment` |

Note results use portable UUIDs. Writes require an 8-128 character idempotency
key. Updates and state changes also require the last observed positive
`expectedRevision`; a stale revision fails instead of overwriting newer data.
Trash is recoverable. MCP does not expose hard delete, account administration,
provider configuration, arbitrary URL fetches, raw files, or scheduled tasks.

Resources:

- `bkemo://notes/{portableId}`
- `bkemo://tasks/today`
- `bkemo://changes/{cursor}`

Every gateway operation is account-scoped and audited without storing request
bodies or credentials. Requests and results are bounded, credential traffic is
rate-limited, and the endpoint validates `Origin` when one is present.

## User controls

Settings -> Security & API shows the MCP URL and every active OAuth consent.
Disconnecting an application revokes all of its access and refresh tokens for
that account. The consent screen lists the exact requested scopes and preserves
OAuth `state` on approval or denial.

Compatible clients should be given only the MCP URL. They discover registration
and authorization metadata automatically. Do not paste an ordinary API token
into an MCP client.

## Outbound MCP

Settings -> MCP connections is restricted to site administrators. Outbound
connectors support remote Streamable HTTP only. Stdio and legacy SSE connectors
are rejected.

New connectors start disabled. Testing a disabled connector may discover its
tools, but bkemo AI cannot invoke it until it is enabled. Only explicitly
allowlisted tools are exposed. Administrators can set time and result-size
limits, disconnect or disable individual connectors, or use Emergency disable
to stop all connectors.

For every outbound request bkemo:

- rejects embedded URL credentials, localhost, private, link-local, reserved,
  `.local`, and `.internal` destinations;
- resolves DNS again in the socket connector and rejects private results to
  prevent DNS rebinding;
- rejects redirects and requires HTTPS in production;
- applies an abortable timeout and response-body size ceiling;
- encrypts configured headers at rest and returns only redacted header values;
- blocks hop-by-hop, forwarding, cookie, host, and content framing headers;
- records only redacted connection status and errors.

## Database and verification

Apply `prisma/migrations/20260731090000_mcp_oauth_integration/migration.sql`
before starting code that uses this contract. It adds note revisions, OAuth
clients/codes/tokens/consents, idempotency records, audit records, and outbound
connector policy fields.

Minimum release checks:

```bash
bunx prisma generate
bun test server/__tests__/unit/lib/mcpOAuth.test.ts \
  server/__tests__/unit/lib/safeOutboundUrl.test.ts \
  server/__tests__/unit/lib/storageCredentialEncryption.test.ts
bun run build:web
cd server && bun esbuild.config.ts
```

Also run an OAuth client smoke test covering discovery, PKCE, required
`resource`, scope-limited tool discovery, refresh rotation, and revocation; a
write smoke test covering replay and stale revisions; and a second-account
isolation test. Production connection and deployment remain separately
approved actions.
