# bkemo MCP Server — Design (planned)

Expose bkemo to LLM agents (Claude Desktop, Claude Code, the API) as an **MCP
server** that wraps the **REST API you already built** — the `trpc-to-openapi`
surface at `/api/v1/*` gated by **scoped access tokens**. No new backend: the MCP
server is a thin client that forwards to `https://bk.hax429.me/api/*` with a
`Bearer` token, so the token's scopes are the security boundary.

> Status: **planned** — not built yet. This is the design + task list.

## 1. Why this shape

Everything an MCP tool needs already exists:
- **REST surface**: `/api/v1/note/{list,detail,upsert,toggle-done,batch-trash,batch-delete}`,
  plus tags, attachments (incl. `allFiles`), comments, reactions, notifications,
  follows, analytics — all documented (`/api/openapi.json`, Swagger `/api-doc`,
  Redoc `/docs`). See [`../agents/PROJECT.md`](../agents/PROJECT.md).
- **Auth + scopes**: named tokens from Settings → **Security & API**
  (`SecurityScreen.tsx` → `accessToken` router), minted as JWTs carrying expanded
  permission paths; `authProcedure` gates each call (`shared/lib/accessTokenScopes.ts`).
- **Reference client**: `scripts/test-api.ts` already calls every endpoint with a
  token and resolves methods from the OpenAPI spec — reuse it as the integration map.

So the MCP server is a **stateless adapter**: MCP tool call → REST call → result.
The hard parts (data model, permissions, validation) stay server-side.

## 2. Architecture

```
Claude Desktop / Claude Code / Agent SDK
        │  (MCP, stdio)
        ▼
   bkemo-mcp  (new package: mcp/)
        │  HTTPS + Authorization: Bearer <BKEMO_TOKEN>
        ▼
   https://bk.hax429.me/api/v1/*   (existing REST, scope-gated)
```

- **Package**: new monorepo workspace `mcp/` (TypeScript, `@modelcontextprotocol/sdk`),
  runnable via `bunx bkemo-mcp` with a `bin` entry. Bun runtime, like the rest.
- **Config (env)**: `BKEMO_ENDPOINT` (default `https://bk.hax429.me`), `BKEMO_TOKEN`
  (a scoped access token the user pastes from Settings → Security & API).
- **Transport**: **stdio** first (Claude Desktop + Claude Code local). Optional
  **streamable-HTTP** transport later for a hosted multi-tenant server (each user
  supplies their own token).
- **Scope-aware tool exposure**: on startup, call `accessTokens.scopes`/introspect
  the token and only register tools whose scope the token holds (a read-only token
  exposes only read tools). Fail closed with a clear error if a tool's scope is missing.

## 3. Tool surface (curated, not auto-generated)

A hand-picked set reads better to an LLM than a 1:1 OpenAPI dump. Each maps to one
REST call and declares its required scope:

| MCP tool | REST | Scope |
|---|---|---|
| `search_notes(query, filters)` | `note.list` | `notes:read` |
| `list_todos(quadrant?, lane?, completed?)` | `note.list` (task filters) | `notes:read` |
| `get_note(id)` | `note.detail` | `notes:read` |
| `create_note(content, tags?, attachments?)` | `note.upsert` | `notes:write` |
| `create_todo(content, dueDate?, important?, urgent?)` | `note.upsert` (type TODO) | `notes:write` |
| `update_note(id, …)` | `note.upsert` | `notes:write` |
| `complete_task(id, done)` | `note.toggle-done` | `notes:write` |
| `trash_note(id)` / `delete_note(id)` | `note.batch-trash` / `batch-delete` | `notes:write` |
| `list_tags()` | `tags.list` | `tags:read` |
| `list_files()` | `attachment.allFiles` | `attachments:read` |
| `add_comment(noteId, text)` | `comment.create` | `comments:write` |
| `share_note(id)` | `note.shareNote` | `share` |

Optional **MCP resources**: expose recent notes / a specific note as
`bkemo://note/<id>` resources so the agent can attach them as context without a
tool round-trip.

Notes on fidelity: reuse the inline-syntax helpers the web app uses so agent input
behaves like human input — `parseTaskSyntax` (`due:`, `-[]`, `#important`/`#urgent`),
`[[memo]]` link extraction (`noteLinks.ts`). Ideally share these from `shared/`
rather than reimplementing in the MCP package.

## 4. Client config

Claude Desktop (`claude_desktop_config.json`) / Claude Code (`.mcp.json`):
```json
{
  "mcpServers": {
    "bkemo": {
      "command": "bunx",
      "args": ["bkemo-mcp"],
      "env": {
        "BKEMO_ENDPOINT": "https://bk.hax429.me",
        "BKEMO_TOKEN": "<scoped access token from Settings → Security & API>"
      }
    }
  }
}
```

## 5. Phased plan

| # | Task | Status |
|---|---|---|
| M1 | Scaffold `mcp/` workspace (sdk, bin, tsconfig, build) | ⏳ |
| M2 | REST client (endpoint + bearer token, error mapping) reusing `scripts/test-api.ts` patterns | ⏳ |
| M3 | Read tools (`search_notes`, `list_todos`, `get_note`, `list_tags`, `list_files`) | ⏳ |
| M4 | Write tools (`create_note/todo`, `update_note`, `complete_task`, trash/delete) | ⏳ |
| M5 | Scope-aware registration (introspect token; hide unauthorized tools) | ⏳ |
| M6 | Share inline-syntax + note-link helpers from `shared/` | ⏳ |
| M7 | MCP resources (`bkemo://note/<id>`) + comments/share tools | ⏳ |
| M8 | Optional streamable-HTTP transport for a hosted server | ⏳ |
| M9 | Docs: client config, scopes, examples; smoke test like `test-api.sh` | ⏳ |

## 6. Decisions

- **Reuse the REST API, don't add tRPC-only surface.** Tools map to documented
  `openapi`-meta endpoints; `conversation`/`ai`/`message` are intentionally tRPC-only
  and out of scope (matching the access-token scope design in
  [`../agents/PROJECT.md`](../agents/PROJECT.md)).
- **Token = boundary.** The MCP server never holds credentials beyond the user's
  scoped token; revoking it (Settings → Security & API) instantly cuts MCP access
  (revocation enforced in `getTokenFromRequest`).
- **Stdio-first, hosted-later.** Local Claude Desktop/Code is the first target;
  a multi-tenant HTTP server is a later, optional add.

## Cross-references
- [`../agents/PROJECT.md`](../agents/PROJECT.md) — current REST API and access-token conventions.
- `scripts/test-api.ts` / `scripts/test-api.sh` — working calls for every endpoint.
- For building MCP servers / the Agent SDK, use the `claude-api` skill reference.
