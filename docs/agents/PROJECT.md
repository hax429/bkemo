# bkemo project guide

## What this project is

bkemo is a personal, single-tenant knowledge and task workspace derived from
Blinko. It is not intended to be a general-purpose Blinko distribution. The
product combines notes and tasks in one stream, keeps the same React interface
across the web and Tauri clients, and is operated as a source deployment at
`https://bk.hax429.me`.

The central product model is a memo that can gain task state. A memo becomes a
task through `NoteType.TODO` or task metadata such as a due date. Tasks can be
completed, prioritized, placed in time lanes or a priority matrix, linked to
other memos, and organized as subtasks. Notes and tasks share the same editor,
tags, attachments, comments, reactions, sharing, search, and offline cache.

The current application lives at `/`. The retired `/bkemo` prefix is normalized
to `/` with replacement navigation. `app/src/App.tsx` no longer routes the old
Blinko page chrome, although some legacy files remain because native quick-
capture windows and shared settings still import them.

## Current product surface

- Capture and edit markdown with TipTap in the stream, note modal, and native
  quick-capture windows.
- Turn a memo into a task with the task control or inline syntax such as `-[]`
  and `due:today`; use `#important` and `#urgent` for priority flags.
- Browse the stream, Today and other task lanes, matrix, calendar, graph, files,
  analytics, daily review, random notes, trash, settings, and AI surfaces.
- Link memos with `[[memo]]`, create parent/subtask relationships, and view the
  link graph.
- Upload arbitrary attachments, preview supported media, and reuse the same
  viewer across cards, note details, public shares, and Files.
- Share a memo at `/m/:id` with guest reactions and comments.
- Share a memo as a PNG card (stream menu → Share as image): templates
  (stamp, peach, calendar, frame, receipt, X card, codeblock, IG post,
  Apple Notes), light/dark, optional accent, font family/size, ratio
  presets, truncate / multipage / long-poster overflow, chrome toggles,
  and 1×/2×/3× export via DOM screenshot. Separate from link share.
- Settings → Data Transfer exports/imports markdown, JSON, and encrypted
  `.bk` archives. Settings → Schedule Task (site-manage) runs pinned
  system jobs: auto-archive, scheduled `.bk` backups (S3/R2 when configured,
  else local; retain last 7), and a Monday 03:00 America/New_York weekly
  knowledge export. The knowledge job combines the configured superadmin's
  notes from the previous completed week into one metadata-rich Markdown file,
  skips recycle and `exclude_from_ai`, keeps the latest local file, and uploads
  it to the configured BigModel knowledge base. Legacy `.bko` backups are
  removed.
- Use tRPC internally or the scoped-token REST API under `/api`; the OpenAPI spec
  is at `/api/openapi.json`, Swagger at `/api-doc`, and the readable reference at
  `/docs`.
- Connect MCP clients to `/mcp`, which uses stateless Streamable HTTP and its
  own audience-bound OAuth 2.1 tokens. Settings -> Security & API manages
  connected applications. Settings -> MCP connections controls encrypted,
  allowlisted outbound Streamable HTTP connectors. See
  [`MCP.md`](./MCP.md).
- Use the native SwiftUI iOS app and Tauri macOS shell with remote API access,
  cached reads, and queued offline creates.
- On macOS, the Tauri app registers Control+W by default for quick capture.
  The shortcut toggles a rounded `/quicknote` capture panel without discarding
  its persisted draft. Web capture and macOS Quick Note share one account-scoped
  draft that saves locally as you type and snapshots to Neon only when the
  browser tab closes or the macOS app quits (not when a window is merely
  hidden). Closing never auto-fills another device; a quiet “Recover draft”
  action appears only when a different server snapshot exists. Explicit Save
  creates a memo and clears the draft. Escape and × hide Quick Note.
- macOS stores only the bearer token in Keychain (`keyring`); each Tauri window
  hydrates its session from Keychain. Profile metadata remains in app data so
  cached notes and offline creation work without a connection.
- The native macOS menu is **bkemo / File / Edit / Navigate / Help**. It exposes
  Settings, New Note, Quick Note, Search, Graph, Calendar, Files, Analytics, and
  AI using canonical routes and macOS accelerators.
- The main window caches the latest 500 notes plus older opened notes. Offline
  mode is read-only for existing notes, but new notes appear immediately with a
  pending-sync badge and replay when connectivity returns.
- Open web, macOS, and iOS clients reconcile note changes through an authenticated
  server-sent-event signal backed by a durable per-account change cursor. A
  60-second recently-active poll catches disconnects and server restarts, stops
  after five minutes without keyboard/pointer activity, and catches up
  immediately on focus/activity. SSE stays connected without querying the
  database. Compose drafts are not live-synced over SSE.
- The Dock icon is present while the main window is active and hidden while the
  app runs in the background. The top-right menu bar icon is optional as long
  as the global shortcut remains enabled. Desktop auto-update is intentionally
  not included.

## Architecture map

| Area | Primary locations | Responsibility |
|---|---|---|
| Web and shared UI | `app/src/` | React 18, TypeScript, Vite, MobX, TipTap |
| bkemo product UI | `app/src/pages/bkemo/`, `app/src/components/bkemo/` | Main route, navigation, screens, memo/task interaction |
| Native clients | `out/macos/`, `out/ios/`, `app/tauri-plugin-blinko/` | Tauri macOS shell, SwiftUI iOS app, shared plugin helpers |
| API and jobs | `server/` | Express, tRPC, REST/OpenAPI, auth, AI, background jobs |
| Persistence | `prisma/` | Neon PostgreSQL schema and migrations |
| Attachments | Settings → Storage (`objectStorage`) | Cloudflare R2 (S3-compatible) or local `.blinko/files` |
| Shared contracts | `shared/` | Cross-package types and utilities |

Important implementation anchors:

- `prisma/schema.prisma` — notes, task fields, references, subtasks,
  attachments, comments, conversations, and related records.
- `server/routerTrpc/note.ts` — note/task queries and mutations.
- `app/src/store/blinkoStore.tsx` — online queries, Dexie fallback, and offline
  operation merging/replay.
- `app/src/lib/noteSync.ts` — SSE lifecycle, idle-aware durable polling fallback,
  and cache reconciliation for web and Tauri.
- `app/src/lib/useSharedDraft.ts` — local-as-you-type compose draft, close-only
  Neon snapshot, and opt-in recover.
- `app/src/components/TiptapEditor/` — markdown-backed editor.
- `app/src/lib/taskSyntax.ts` and `app/src/lib/noteLinks.ts` — inline task and
  memo-link parsing.
- `app/src/styles/bkemo-theme.css` and `app/src/lib/bkemoSettings.ts` — scoped
  design tokens and persisted preferences.
- `app/src/lib/blinkoEndpoint.ts` — remote API endpoint used by Tauri clients.
- `app/src/components/BlinkoSettings/TaskSetting.tsx` — Settings → Schedule Task
  (archive, scheduled `.bk` backup, and weekly knowledge export UI).
- `server/jobs/backupJob.ts` / `server/jobs/archivejob.ts` /
  `server/jobs/weeklyKnowledgeJob.ts` — bounded in-process schedules for `.bk`
  backup (retain 7), auto-archive, and weekly knowledge export; no database
  polling occurs between due times.
- `server/lib/bkemoTransfer.ts` — portable `.bk` / markdown / JSON transfer.
- `server/lib/integrationGateway.ts` and `server/routerExpress/mcp.ts` —
  account-scoped MCP operations, OAuth-protected Streamable HTTP transport, and
  integration audit/idempotency behavior.
- `server/lib/obsidianPairing.ts` and `server/routerExpress/obsidian.ts` —
  Obsidian pairing and `/api/v1/obsidian/*`. The private **como** companion
  plugin (`id: como`) lives in [hax429/como](https://github.com/hax429/como).
  Source links use `/note/{portableId}`.

## Data and API conventions

- A note is complete when `completedAt` is non-null. Keep task detection and
  task filters consistent between the server, UI, and offline filtering.
- Preserve markdown as the stored note format. TipTap must round-trip markdown
  rather than introduce a second storage representation. bkemo extensions:
  `==highlight==` (yellow) and `++underline++`.
- Use tRPC for typed application calls. Add REST/OpenAPI metadata when a route is
  intentionally part of the external API.
- Platform-bound access tokens are the external API security boundary (iOS,
  macOS, Obsidian, scripts). Web interactive login stays a session JWT. Clients
  send `X-Bkemo-Platform`; mismatches soft-allow and warn on Mac/Web. Never
  expose account administration, provider secrets, or unrestricted user data
  through a convenience scope. See
  [`../plans/platform-bound-access-tokens.md`](../plans/platform-bound-access-tokens.md).
- `.env`, `.blinko/`, and database directories contain local or production state
  and must never be committed or replaced during a source update.

## Local development

The repository expects Bun 1.2.8 or newer and Node 20 or newer. Normal
development uses local PostgreSQL and local attachment storage. Use an explicit,
auto-suspending Neon development branch plus Cloudflare R2 only for integration
testing that requires the hosted data plane; never point local development at
the production branch.
The full local app process runs on `http://localhost:1111`.

```bash
bun install
bun run prisma:generate
./scripts/run-dev.sh
```

`./scripts/run-dev.sh` is a foreground launcher. It bootstraps local PostgreSQL
on port `5433` when `.env` uses the local URL. A `.env` that points at an
approved Neon development branch (`.bkemo/dev-existing-neon-attach.json`) is
accepted only when `BKEMO_DEV_USE_NEON=true`; otherwise the launcher stops
instead of consuming remote compute accidentally. You can attach Neon and
configure R2 from
Settings → Storage (`BKEMO_DEV_ALLOW_EXISTING_NEON=true`, then Verify active
setup). `--reset` and `--stop` apply only to that local bootstrap database.

For a server that must survive an agent command session, first check
`screen -ls`, then use:

```bash
screen -dmS bkemo-dev ./scripts/run-dev.sh
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:1111/
```

Useful checks:

```bash
bun run test
bun run build:web
./scripts/test-api.sh
```

`bun run test` is the fast unit lane. It runs the frontend Vitest suite with
Testing Library, the backend Bun unit suite, and shared package tests through
Turbo without building production bundles first. Use the narrower lanes while
developing:

```bash
bun --cwd app run test:watch
bun --cwd server run test:watch
bun run test:backend:integration
bun run test:backend:e2e
```

UI interaction lanes (web React, Obsidian companion DOM, macOS shell):

```bash
bun run test:ui            # all fast UI lanes
bun run test:ui:web        # Vitest + Testing Library under `.bkemo`
bun run test:ui:obsidian   # happy-dom memo-card / attachment UI
bun run test:ui:mac        # cargo test + shared React platform checks
bun run test:ui:e2e        # Playwright browser smoke (needs local server)
```

Component tests should prefer `renderBkemo` from `app/src/test/render.tsx`.
Obsidian companion UI tests live in [hax429/como](https://github.com/hax429/como)
(`bun run test` / `bun run test:ui`). Mac shares the React UI with web; shell
behavior is covered by `cargo test` in `out/macos`.

Backend integration tests may require their documented test environment
variables. Backend end to end tests require a running local server and database.
Keep those explicit rather than making the fast unit lane depend on external
state.

Run focused tests for the area changed. If native Rust code changes, also run
the relevant `cargo check`/`cargo test` and platform build described in
[`../plans/IOS.md`](../plans/IOS.md).

## Current guidance versus future plans

This file describes the current system. Large proposed or unfinished efforts
belong under `docs/plans/`, not here. When implementation lands, update this
guide to describe the resulting behavior and either update or retire the plan.
