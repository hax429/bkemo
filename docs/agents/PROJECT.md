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
- Use tRPC internally or the scoped-token REST API under `/api`; the OpenAPI spec
  is at `/api/openapi.json`, Swagger at `/api-doc`, and the readable reference at
  `/docs`.
- Use the Tauri iOS/macOS shells with local frontend assets, remote API access,
  cached reads, queued offline writes, and cached attachments.

## Architecture map

| Area | Primary locations | Responsibility |
|---|---|---|
| Web and shared UI | `app/src/` | React 18, TypeScript, Vite, MobX, TipTap |
| bkemo product UI | `app/src/pages/bkemo/`, `app/src/components/bkemo/` | Main route, navigation, screens, memo/task interaction |
| Native clients | `app/src-tauri/`, `app/tauri-plugin-blinko/` | Tauri v2, Rust, Swift/Kotlin integrations |
| API and jobs | `server/` | Express, tRPC, REST/OpenAPI, auth, AI, background jobs |
| Persistence | `prisma/` | Neon PostgreSQL schema and migrations |
| Attachments | Settings → Storage (`objectStorage`) | Cloudflare R2 (S3-compatible) or local `.blinko/files` |
| Shared contracts | `shared/`, `blinko-types/` | Cross-package types and utilities |

Important implementation anchors:

- `prisma/schema.prisma` — notes, task fields, references, subtasks,
  attachments, comments, conversations, and related records.
- `server/routerTrpc/note.ts` — note/task queries and mutations.
- `app/src/store/blinkoStore.tsx` — online queries, Dexie fallback, and offline
  operation merging/replay.
- `app/src/components/TiptapEditor/` — markdown-backed editor.
- `app/src/lib/taskSyntax.ts` and `app/src/lib/noteLinks.ts` — inline task and
  memo-link parsing.
- `app/src/styles/bkemo-theme.css` and `app/src/lib/bkemoSettings.ts` — scoped
  design tokens and persisted preferences.
- `app/src/lib/blinkoEndpoint.ts` — remote API endpoint used by Tauri clients.

## Data and API conventions

- A note is complete when `completedAt` is non-null. Keep task detection and
  task filters consistent between the server, UI, and offline filtering.
- Preserve markdown as the stored note format. TipTap must round-trip markdown
  rather than introduce a second storage representation.
- Use tRPC for typed application calls. Add REST/OpenAPI metadata when a route is
  intentionally part of the external API.
- Scoped access tokens are the external API security boundary. Never expose
  account administration, provider secrets, or unrestricted user data through a
  convenience scope.
- `.env`, `.blinko/`, and database directories contain local or production state
  and must never be committed or replaced during a source update.

## Local development

The repository expects Bun 1.2.8 or newer and Node 20 or newer. The preferred
development data plane is Neon PostgreSQL plus Cloudflare R2 for attachments.
The full local app process runs on `http://localhost:1111`.

```bash
bun install
bun run prisma:generate
./scripts/run-dev.sh
```

`./scripts/run-dev.sh` is a foreground launcher. When `.env` points at an
approved Neon development branch (`.bkemo/dev-existing-neon-attach.json`), it
uses that database and skips local Postgres. Otherwise it bootstraps local
PostgreSQL on port `5433` so you can attach Neon and configure R2 from
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

Run focused tests for the area changed. If native Rust code changes, also run
the relevant `cargo check`/`cargo test` and platform build described in
[`../plans/IOS.md`](../plans/IOS.md).

## Current guidance versus future plans

This file describes the current system. Large proposed or unfinished efforts
belong under `docs/plans/`, not here. When implementation lands, update this
guide to describe the resulting behavior and either update or retire the plan.
