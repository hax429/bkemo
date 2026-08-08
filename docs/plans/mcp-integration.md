# MCP integration and hardening plan

**Status:** implemented 2026-07-31; retained as the audited design record

**Priority:** P0 security, then P1 product

**Goal:** make bkemo a safe, scope-aware MCP server and a controlled MCP client

## Original source audit

bkemo already implements both directions:

1. **bkemo as an MCP server**
   - `server/routerExpress/mcp.ts`
   - legacy HTTP+SSE endpoints at `/sse` and `/messages`
   - tools for note search/create/update/trash, comments, web access, and
     scheduled tasks

2. **bkemo as an MCP client**
   - `server/aiServer/mcp/McpClientManager.ts`
   - stdio, SSE, and Streamable HTTP transports
   - database-backed server configuration
   - Mastra bridge in `McpToolBridge.ts`
   - administration routes in `server/routerTrpc/mcpServers.ts`

The older plan saying MCP is not built is therefore historical.

## Resolved P0 findings

### Session and credential isolation

`server/routerExpress/mcp.ts` stores the latest request token in a module-level
`globalToken`. Concurrent clients can therefore influence which credential a
later tool call receives. Replace this with session/request-bound actor context.

The same file logs tool arguments and the constructed context. Tokens, personal
content, and secrets must never enter normal logs.

### Scope preservation

Current tools verify a token, then construct a `userCaller` with a synthetic
`superadmin` identity. This risks bypassing the scoped access-token permissions
enforced by `authProcedure`.

All MCP calls must cross `IntegrationGateway` with the original actor and
scopes. Tool registration may hide unauthorized tools, but execution must still
enforce authorization server-side.

### Tool exposure

Web search/extraction and scheduled-task tools are materially different from
note tools. They consume site credentials or create persistent behavior.

- Remove them from the default public MCP profile.
- Add separate scopes and explicit administrator policy before enabling them.
- Never return provider configuration or API secrets.
- Require confirmation-capable clients for destructive or persistent actions;
  otherwise expose a prepare/confirm pair.

### Outbound MCP trust

The hosted server can currently start configured stdio commands such as `npx`,
`node`, `python`, `bun`, and `deno`. An argument character denylist does not make
untrusted packages or scripts safe.

- Disable arbitrary stdio MCP configuration in production.
- If stdio is required, allow only preinstalled, version-pinned adapters in a
  sandbox with fixed arguments, working directory, filesystem roots, network
  policy, CPU/memory/time limits, and a minimal environment.
- Validate remote URLs against SSRF, redirect, DNS-rebinding, and private-network
  policy before every connection.
- Encrypt MCP headers/environment secrets at rest and redact them on every read
  response.
- Keep MCP server administration restricted to site-management permission.

## Target architecture

```text
MCP client
    │
    ▼
/mcp  (Streamable HTTP)
    │  verified, request/session-bound IntegrationActor
    ▼
MCP adapter
    │  curated operation name + validated input
    ▼
IntegrationGateway
    ├── ownership + scopes
    ├── idempotency + revision checks
    ├── audit + rate limits
    └── note/tag/attachment implementation
```

Outbound tools use the inverse path:

```text
bkemo AI
    ▼
MCP connector policy
    ├── trusted server registry
    ├── per-tool allowlist
    ├── confirmation policy
    ├── timeout / result-size limits
    └── redacted audit
    ▼
remote MCP server
```

## MCP server interface

Start with a small, curated surface:

### Read tools

- `search_notes`
- `get_note`
- `list_tasks`
- `list_tags`
- `list_recent_changes`

### Write tools

- `create_note`
- `update_note` with `expected_revision`
- `complete_task`
- `archive_note`
- `trash_note`
- `add_comment`

### Resources

- `bkemo://notes/{portableId}`
- `bkemo://tasks/today`
- `bkemo://changes/{cursor}`

Resources are useful for application-controlled context; tools remain the path
for model-controlled actions. Prompts may be added later for daily review or
note synthesis, but they should not be required for core interoperability.

Do not expose hard delete, account administration, provider secrets, raw SQL,
arbitrary file reads, arbitrary URL fetches, or unrestricted scheduled jobs.

## Transport and authorization

- Add one `/mcp` Streamable HTTP endpoint.
- Keep `/sse` and `/messages` only during a measured compatibility window.
- Validate `Origin`, protocol version, content types, session IDs, and request
  sizes.
- Use bearer access tokens for a private alpha, with short expiry and narrow
  scopes.
- Before calling the remote server generally supported, implement the current
  MCP HTTP authorization discovery and OAuth requirements, including protected
  resource metadata, audience-bound tokens, PKCE, and no query-string tokens.
- Rate-limit tool listing, resource reads, and calls separately.

The stable MCP transport specification replaced the old HTTP+SSE transport with
Streamable HTTP and requires a single GET/POST endpoint plus Origin validation.
The current authorization draft also requires protected-resource discovery,
audience validation, and authorization headers on every HTTP request. Recheck
the final specification and SDK support at implementation time.

## Phases

### M0 — containment (complete)

- Remove global token state and secret-bearing logs.
- Preserve original scopes and account identity through tool execution.
- Disable web/persistent/high-risk tools by default.
- Disable production stdio configuration until sandbox policy exists.
- Add cross-session, cross-account, revocation, and scope-denial tests.

### M1 — modern read-only server (complete)

- Implement `/mcp` with Streamable HTTP.
- Register the five read tools and three resources through the gateway.
- Add redacted audit events, rate limits, result-size caps, and timeouts.
- Publish client setup for a dedicated `notes:read` token.

### M2 — safe writes (complete)

- Add conditional revisions and idempotency keys.
- Add narrowly scoped write tools.
- Add tool annotations and confirmation behavior where supported.
- Provide a read/write token setup distinct from read-only.

### M3 — authorization and compatibility (complete)

- Implement standards-compliant OAuth discovery and PKCE flow.
- Bind tokens to the MCP resource/audience.
- Remove legacy SSE immediately.
- Run compatibility tests against at least Codex, Claude Desktop/Code, and one
  independent MCP inspector/client.

### M4 — outbound MCP product (complete)

- Restore a bkemo-native administration UI only after the trust model is
  implemented.
- Support remote Streamable HTTP first.
- Add per-server and per-tool allowlists, connection test, last-used state,
  health, timeouts, and an emergency disable switch.
- Consider sandboxed stdio only for a fixed, reviewed adapter catalogue.

## Verification

- Two simultaneous clients with different accounts and scopes cannot cross.
- Revoking a token terminates or denies its next operation.
- Read-only tokens never expose or execute write tools.
- Tool logs and error traces contain no token, provider key, note body, or
  attachment URL credential.
- Streamable HTTP protocol conformance and Origin tests pass.
- Outbound redirects, localhost/private IPs, oversized results, and slow tools
  fail safely.
- Every mutation replay with the same idempotency key produces one effect.

## Official references

- [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP server primitives](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [MCP authorization draft](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
