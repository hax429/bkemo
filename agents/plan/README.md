# bkemo potential development roadmap

**Status:** mixed; MCP is implemented, other entries remain proposals

**Investigated:** 2026-07-31

**Scope:** future integration work that builds on the current bkemo product

This directory records potential work requested for `agents/plan/`. It is
separate from `docs/agents/`, which describes current behavior, and
`docs/plans/`, which contains older feature-specific plans. Source code wins
when any plan disagrees with the repository.

## Current foundation

The project already has more integration infrastructure than the older plans
describe:

- Scoped, revocable access tokens are implemented in
  `shared/lib/accessTokenScopes.ts`, `server/routerTrpc/accessToken.ts`, and
  `server/lib/helper.ts`.
- REST/OpenAPI routes are available under `/api/v1/*`.
- `notes.changes` and `/api/v1/note/events` provide an ordered cursor plus an
  SSE wake-up signal for syncing clients.
- Notes, tags, attachments, and other portable records already have UUID
  `portableId` fields.
- Markdown/JSON/`.bk` import and export already preserve portable IDs,
  attachments, metadata, and relationships in `server/lib/bkemoTransfer.ts`.
- bkemo exposes an OAuth-protected Streamable HTTP MCP server at `/mcp` and is
  also a policy-controlled client for remote Streamable HTTP servers. Legacy
  SSE and arbitrary stdio transports are removed.
- No dedicated Obsidian integration exists. The only current Obsidian-specific
  behavior is the relation graph description and broadly compatible Markdown.

## Guiding design

Create one deep **integration module** behind a small interface. MCP, Obsidian,
CLI clients, calendar connectors, and future automations should all use the
same authorization, ownership, validation, change-journal, idempotency,
conflict, and audit behavior.

Proposed interface:

```ts
type IntegrationActor = {
  accountId: number;
  credentialId: string;
  scopes: string[];
  source: 'mcp' | 'obsidian' | 'cli' | 'automation' | 'other';
};

type IntegrationOperation =
  | { kind: 'query'; name: string; input: unknown }
  | { kind: 'command'; name: string; input: unknown; idempotencyKey: string };

interface IntegrationGateway {
  execute(actor: IntegrationActor, operation: IntegrationOperation): Promise<unknown>;
  readChanges(actor: IntegrationActor, cursor: number, limit: number): Promise<ChangeBatch>;
}
```

This is the external seam and test surface. Provider-specific adapters may
translate MCP calls or Obsidian files, but they must not manufacture privileged
users or call Prisma directly.

## Priority order

| Priority | Plan | Why it comes here | Entry gate |
|---|---|---|---|
| P0 | [Integration foundation](./integration-foundation.md) | Prevent each connector from inventing auth, sync, and conflict behavior | None |
| P0/P1 | [MCP integration](./mcp-integration.md) | Existing code has useful capability and urgent isolation/security debt | Foundation actor + audit contracts agreed |
| P1 | [Obsidian sidebar plugin](./obsidian-integration.md) | Private desktop browsing, capture, guarded editing, and explicit vault copies | O0 started: pairing + gateway contracts + plugin scaffold |
| P2 | [Future opportunities](./future-opportunities.md) | Reuses the same seams after two real adapters validate them | MCP and Obsidian pilots produce evidence |

## Suggested milestones

1. **Secure the present:** isolate MCP sessions, preserve token scopes, remove
   secret-bearing logs, and disable unsafe server-side subprocess/network
   behavior until policy exists.
2. **Stabilize the integration contract:** portable-ID reads, conditional
   writes, idempotency keys, ordered changes, audit events, and redacted errors.
3. **Operate the narrow MCP v1:** curated read/write tools and resources over
   OAuth-protected Streamable HTTP, with outbound connectors disabled by
   default and tool allowlists enforced.
4. **Pilot the Obsidian sidebar:** recent notes, search, preview, typed and voice
   capture, explicit copy actions, and no remote deletions.
5. **Add guarded Obsidian editing:** direct sidebar editing and explicit vault
   pushes using portable IDs, conditional writes, and blocked conflict review.
6. **Generalize only after evidence:** CLI/SDK, webhooks, calendars, and
   user-defined automations.

## Cross-cutting acceptance gates

- No connector can read or mutate another account's data.
- A scoped token cannot obtain more privilege through an adapter.
- Credentials and note bodies are absent from normal logs and diagnostics.
- Every write is idempotent or explicitly non-retriable.
- A stale client cannot silently overwrite a newer note.
- Deletes are recoverable by default and require an explicit capability.
- Cursor replay after disconnect produces the same final state as continuous
  operation.
- Local development uses local PostgreSQL unless hosted integration testing is
  explicitly enabled.
- Production connection, deployment, and release remain separately approved
  actions.

## Decisions still required

- Should MCP remain private to one account, or become a supported public
  integration for multiple accounts?
- Are externally connected MCP tools allowed in production at all, and if so,
  which transports and trust levels?
