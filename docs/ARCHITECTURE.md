# bkemo + como architecture

Snapshot of the current system as implemented in `hax429/bkemo` and
`hax429/como`. This is an architecture export, not a roadmap. Plans under
`docs/plans/` may disagree with source; source wins.

Production origin: `https://bk.hax429.me`. Local full stack:
`http://localhost:1111`.

---

## 1. What the two products are

**bkemo** is a personal, single-tenant knowledge and task workspace derived
from Blinko. It is not a general-purpose Blinko distribution. One account owns
the notes. The same React UI runs in the browser and inside the Tauri macOS
shell. iOS is a separate SwiftUI client against the same API. Production is a
source deployment on a Linux VM, not a Docker image.

The central domain object is a **memo**. A memo becomes a task through
`NoteType.TODO` or task metadata (due date, important, urgent). Notes and
tasks share the editor, tags, attachments, comments, reactions, sharing,
search, and offline cache.

**como** is a private desktop-only Obsidian plugin (`id: como`,
`isDesktopOnly: true`). It is a companion, not a vault projection of bkemo.
v1 does **not** write bkemo notes into the vault as notes. It shows a right
sidebar of remote memos, captures into bkemo, copies/appends markdown on
demand, indexes vault todos, logs vault activity, and hosts Codian AI chat.

The two repositories are standalone. The contract between them is
`/api/v1/obsidian/*` plus platform-bound access tokens.

```text
                    ┌─────────────────────────────────────────┐
                    │         Cloudflare + nginx TLS          │
                    │              bk.hax429.me               │
                    └──────────────────┬──────────────────────┘
                                       │ :1111
                    ┌──────────────────▼──────────────────────┐
                    │     bkemo (Express + tRPC + Vite)       │
                    │     systemd: bun out/output/index.js    │
                    └─┬────────────┬────────────┬─────────────┘
                      │            │            │
              Neon PostgreSQL   R2 / local   LibSQL vectors
                      │         attachments  (.blinko/vector)
          ┌───────────┼───────────┬───────────┬──────────────┐
          │           │           │           │              │
      Web SPA     Tauri macOS   SwiftUI iOS  MCP clients   como
      session       Keychain     Keychain     OAuth /mcp   Obsidian
      JWT           access       access                    access
                    token        token                     token
```

---

## 2. Repositories and layout

### bkemo (`~/Developer/bkemo`)

Turbo + Bun monorepo. Package names still say Blinko (`@blinko/frontend`,
`@blinko/backend`, `@blinko/shared`). Bundle id is `me.hax429.bk`.

```text
bkemo/
├── app/                      React 18 + Vite + MobX + TipTap
│   ├── src/pages/            routes (bkemo shell, signin, share, oauth, quicknote)
│   ├── src/components/bkemo/ product screens
│   ├── src/components/TiptapEditor/
│   ├── src/store/            BlinkoStore, UserStore, plugins
│   ├── src/lib/              sync, cache, routes, platform headers
│   ├── src-tauri → out/macos
│   └── tauri-plugin-blinko/  native helpers (share, color, …)
├── server/                   Express, tRPC, REST, MCP, jobs, AI
│   ├── routerTrpc/           typed app API
│   ├── routerExpress/        files, auth, MCP, Obsidian, SSE
│   ├── lib/                  gateway, pairing, transfer, storage
│   ├── aiServer/             LLM/embedding providers + tools
│   └── jobs/                 archive, backup, weekly knowledge
├── prisma/                   Neon PostgreSQL schema + migrations
├── shared/                   types, scopes, platform enum
├── out/
│   ├── ios/                  SwiftUI app, widget, share extension
│   ├── macos/                Tauri v2 Rust shell
│   ├── obsidian/             leftover companion sources (live plugin is como)
│   └── output/               production build artifacts
├── scripts/                  run-dev, deploy, platform builds
└── docs/agents/              current product memory
```

Runtime: Bun ≥ 1.2.8, Node ≥ 20. Dev launcher: `./scripts/run-dev.sh`
(local Postgres on `5433` unless an approved Neon branch is explicitly
attached).

### como (`~/Developer/como`)

Standalone Obsidian plugin. Build: esbuild + CSS pipeline →
`dist/como/{main.js,manifest.json,styles.css}`.

```text
como/
├── src/                      bkemo companion + plugin shell
│   ├── main.ts               ComoPlugin extends ClaudianPlugin
│   ├── bkemoClient.ts        HTTP client for /api/v1/obsidian/*
│   ├── pairing.ts            SecretStorage access-token pairing
│   ├── modeSwitch.ts         Notes / Todos / Activity / Chat
│   ├── view/                 sidebar, dock, editor, cards
│   ├── sync/                 cache, outbox, change pull, audio
│   ├── vault/                append markdown, copy attachments
│   ├── activity/             vault file events + daily seal
│   ├── todos/                vault checkbox index + Send to bkemo
│   ├── media/                paste/drop upload of vault media
│   └── codian/               Codian AI chat (vendored + adapted)
├── res/codian-main/          upstream Codian mirror (not the runtime)
├── .disposable-vault/        local test vault
└── docs/OBSIDIAN.md          product shape + acceptance checklist
```

Primary vault install target: `~/hax429/.obsidian/plugins/como`. Production
builds always target `https://bk.hax429.me`. `--dev` targets
`http://localhost:1111`.

---

## 3. Domain model

### Memo / note

Persisted in `notes`. Integer `id` is internal. External clients use
`portableId` (UUID). Optimistic concurrency uses integer `revision`.

| Field | Meaning |
|---|---|
| `type` | `NoteType.BLINKO` (0), `NOTE` (1), `TODO` (2) |
| `content` | Markdown (source of truth; TipTap round-trips it) |
| `isArchived` / `isRecycle` | archive vs trash |
| `dueDate`, `isImportant`, `isUrgent`, `completedAt` | task state |
| `parentNoteId` | subtask tree |
| `isShare` + share fields | public `/m/:id` |
| `metadata` | JSON sidecar |

A note is **complete** when `completedAt` is non-null. Task detection must
stay consistent across server, UI, and offline filters.

Inline capture syntax (web/macOS composer): `-[]` promotes to task;
`due:today` / `due:tmr` / dates set due; `#important` / `#urgent` set flags.
Memo links: `[[memo]]`. Editor extras: `==highlight==`, `++underline++`.

Related records: `attachments`, `tag` / `tagsToNote`, `noteReference`
(graph), `comments`, `reaction`, `noteHistory`, `noteInternalShare`,
`linkEnrichment`, `conversation`.

### Change journal

`noteChange` is an append-only per-account cursor journal, maintained by a
PostgreSQL trigger on `notes`. Rows do **not** FK to notes, so hard-delete
events remain visible to syncing clients.

Clients reconcile with:

1. Authenticated SSE wake-up (`/api/v1/note/events`)
2. Cursor pages (`notes.changes` / `/api/v1/obsidian/changes`)
3. A 60s recently-active poll (stops after five minutes idle; catch-up on
   focus)

Compose drafts are **not** live-synced over SSE.

### Compose draft

`composeDraft` is one row per account. Web capture and macOS Quick Note share
it. Local typing is local-first; a Neon snapshot is written only when the
browser tab closes or the macOS app quits (not when a window is merely
hidden). Closing never auto-fills another device. A “Recover draft” action
appears only when a different server snapshot exists.

### Account and credentials

Single-tenant in practice. `accounts` still exists from Blinko. External
long-lived credentials are named, scoped, platform-bound **access tokens**
(`accessToken` table, JWT `jti`). Interactive web login is a session JWT.
MCP uses a separate OAuth audience bound to `/mcp`.

Platforms: `web` | `macos` | `ios` | `obsidian` | `api`. Clients send
`X-Bkemo-Platform`. Mismatch is soft-allow plus a misuse incident, not a
hard reject.

---

## 4. Persistence and runtime stores

| Store | Location | Role |
|---|---|---|
| Neon PostgreSQL | production `DATABASE_URL` (pooled) | source of truth |
| Local Postgres | `:5433` via `./scripts/run-dev.sh` | default development |
| Cloudflare R2 | Settings → Storage `objectStorage=s3` | production attachments |
| Local files | `.blinko/files` | fallback attachments + `.bk` backups |
| LibSQL vectors | `.blinko/vector` | embedding index for AI retrieval |
| Dexie (IndexedDB) | web + Tauri | latest 500 notes + opened older notes; offline create/edit replay |
| macOS Keychain | Tauri `keyring` | bearer token only |
| iOS Keychain + App Group | SwiftData `LocalMemo` | token + pending captures |
| Obsidian SecretStorage | como | Obsidian access token |
| Plugin `data.json` | `.obsidian/plugins/como/` | settings, cache snapshot, outbox, mode |
| Activity JSON | `.obsidian/plugins/como/data/activity/YYYY-MM-DD.json` | live vault events |
| Todo link map | `.obsidian/plugins/como/data/todos/links.json` | vault line ↔ bkemo portableId |
| Codian data | `.obsidian/plugins/como/data/` | chat sessions (migrated from `.codian/`) |

`.env`, `.blinko/`, and database directories are runtime state and must not
be committed or replaced on source update.

---

## 5. bkemo server

One Express process on port **1111**, started from `server/index.ts`. In
development ViteExpress serves the app. In production static files come from
`out/output/public` (linked as `server/public`).

### HTTP surface

| Path | Mechanism | Audience |
|---|---|---|
| `/api/trpc` | tRPC | web + Tauri session |
| `/api` | tRPC-to-OpenAPI REST | iOS, scripts, docs |
| `/api/v1/obsidian/*` | Express + `IntegrationGateway` | como |
| `/api/file`, `/api/s3file`, `/api/attachment` | Express | uploads / downloads |
| `/api/auth` | session auth | web login |
| `/api/v1/note/events` | SSE | web, Tauri, iOS |
| `/mcp` + `/.well-known/oauth-*` + `/oauth/*` | Streamable HTTP + OAuth 2.1 | MCP clients |
| `/v1` | OpenAI-compatible shim | legacy |
| `/api/rss` | RSS | public feeds |
| `/api/openapi.json`, `/api-doc`, `/docs` | OpenAPI / Swagger / Redoc | humans |
| `/health` | JSON | deploy checks |
| `/m/:id` | React public share | guests |
| `/` | SPA | product |

During a database cutover, non-GET mutations (except tRPC, which gates
itself) return 503.

### tRPC routers (`server/routerTrpc/_app.ts`)

`ai`, `notes`, `tags`, `users`, `attachments`, `config`, `public`, `task`,
`aiTask`, `analytics`, `comments`, `follows`, `notifications`, `plugin`,
`conversation`, `message`, `mcpServers`, `fonts`, `reaction`,
`accessTokens`, `databaseMigration`, `draft`, `oauth`, `obsidian`,
`linkEnrichment`.

Primary note/task mutations live in `server/routerTrpc/note.ts`.

### IntegrationGateway

`server/lib/integrationGateway.ts` is the account-scoped seam used by MCP
and Obsidian. It does not invent a privileged user. Writes require an
8–128 character **idempotency key**. Updates and state changes require
`expectedRevision`; stale revisions fail with `revision_conflict` (HTTP 409)
instead of overwriting.

Operations: `searchNotes`, `getNote`, `listTasks`, `listTags`, `listFiles`,
`listRecentChanges`, `createNote`, `updateNote`, `completeTask`,
`archiveNote`, `trashNote`, `addComment`, `getAttachment`, `uploadAudio`,
`uploadFile`.

Every operation is audited (`integrationAudit`) without storing bodies or
credentials. Idempotency rows live in `integrationIdempotency`.

MCP and Obsidian **do not** expose hard delete, account administration,
provider secrets, raw arbitrary files, or scheduled-task control.

### Auth layers

```text
Web interactive login  → session JWT (short-lived)
iOS / macOS login      → managed access token, platform ios/macos, app:full
Obsidian               → managed access token, platform obsidian, scoped
Scripts / curl         → managed access token, platform api, scoped
MCP clients            → OAuth 2.1 tokens audience-bound to /mcp
```

Scopes (REST / Obsidian / MCP, not identical expansion): `notes:read`,
`notes:write`, `tags:read`, `tags:write`, `attachments:read`,
`attachments:write`, `comments:read`, `comments:write`, plus REST-only
`reactions`, `share`, `notifications`, `follows`, `analytics:read`.

Native login mints `app:full` (session-equivalent, no path ACL). Cap: 50
tokens per account. Legacy `accounts.apiToken` is emptied and not accepted.
Pairing codes and device credentials are retired.

### Jobs

In-process timers (`server/jobs/baseScheduleJob.ts`). No database polling
between due times. Paused when a Neon development branch is attached or
during cutover write-lock.

| Job | Purpose |
|---|---|
| `ArchiveJob` | auto-archive pinned system job |
| `BackupJob` | scheduled `.bk` archives (R2 or local; retain last 7) |
| `WeeklyKnowledgeJob` | Monday 03:00 America/New_York markdown export to BigModel KB |
| attachment migration | resume in-flight local ↔ S3 copies |
| link enrichment | Defuddle markdown + Wayback sidecar for pasted URLs |

AI automations / custom scripts on Settings → Schedule Task are deferred.
pg-boss exists for some background work (`server/lib/pgBoss.ts`).

### AI (in-app)

`server/aiServer/` — LangChain / Mastra / Vercel AI SDK providers
(OpenAI, Anthropic, Azure, Google, xAI, DeepSeek, OpenRouter, MiniMax, …).
Embeddings in LibSQL. Tools can search/create/update/delete notes, comment,
run web search, and inspect scheduled tasks. Conversations persist as
`conversation` / `message`.

This is **not** the same as Codian in como. bkemo AI is server-side against
the note corpus. Codian is local-to-Obsidian, talking to CLI/SDK providers
with vault context.

### Outbound MCP (bkemo as client)

Settings → MCP connections (site admin). Remote Streamable HTTP only. Stdio
and legacy SSE rejected. New connectors start disabled; only allowlisted
tools are exposed. SSRF controls: no private/localhost destinations, DNS
rebinding check, no redirects, HTTPS in production, encrypted headers at
rest.

---

## 6. bkemo web and shared UI

Stack: React 18, TypeScript, Vite, MobX (`RootStore`), TipTap, Tailwind plus
scoped `.bkemo` tokens (`app/src/styles/bkemo-theme.css`). Dark-first,
Linear/Issue-inspired. Native controls + `bk-*` classes over HeroUI.

### Routes (`app/src/App.tsx`, `app/src/lib/bkemoRoutes.ts`)

| Path | Screen |
|---|---|
| `/` | stream (home) |
| `/inbox`, `/today`, `/week`, `/matrix` | task lanes |
| `/calendar`, `/graph`, `/files`, `/analytics`, `/ai` | tools |
| `/trash` | recycle |
| `/tag/:name` | tag filter |
| `/n/:id`, `/note/:portableId` | open note modal on home |
| `/settings…` | prefs, appearance, account, security, API, AI, tasks, storage, MCP, data transfer, … |
| `/signin`, `/signup` | auth |
| `/oauth/authorize`, `/oauth-callback` | MCP OAuth consent |
| `/m/:id` | public share |
| `/quicknote` | Tauri quick-capture window |

Retired `/bkemo` prefix is normalized to `/`.

The main page (`app/src/pages/bkemo/index.tsx`) hosts `BkemoLayout` +
`Sidebar` + screen components (`Stream`, `Todos`, `Graph`, `Calendar`,
`FilesScreen`, `Analytics`, `AIScreen`, `SettingsScreen`, …). Search is an
overlay. Note editing is a modal (`NoteModal`) using the same TipTap editor
as the stream composer.

### Offline (web / Tauri)

`app/src/lib/noteCache.ts` + `blinkoStore.tsx`: Dexie cache of the latest
500 notes plus older notes the user opened. Offline is read-only for
existing notes except **new notes**, which appear immediately with a
pending-sync badge and replay when connectivity returns. `noteSync.ts`
owns SSE lifecycle, idle-aware polling, and cache reconciliation.

macOS stores only the bearer token in Keychain; each window hydrates the
session from Keychain. Profile metadata stays in app data so cached notes
and offline creates work without a connection.

### Share-as-image

Separate from link share. DOM screenshot of styled templates (stamp, peach,
calendar, frame, receipt, X card, codeblock, IG post, Apple Notes),
1×/2×/3× export.

### Static cache

`server/lib/staticCache.ts`: `index.html`, manifests, `registerSW.js`, and
`sw*.js` are `no-cache`. Only hashed `assets/` are immutable. `app/public/sw.js`
is a retirement worker that uninstalls the legacy PWA worker in favor of
`sw-bkemo-v2.js`.

---

## 7. Native clients

### macOS (Tauri v2, `out/macos/`)

Rust shell around the same React app. Menu: **bkemo / File / Edit /
Navigate / Help**. Default global shortcut Control+W is still registered by
Tauri (`hotkey.rs`), but as of 2026-09-20 it — and the tray's "Quick Note"
item — route to a separate **native SwiftUI helper**
(`out/macos/native-capture/`, see `docs/plans/mac.md` §13) instead of the
old `/quicknote` webview: `native_capture.rs` sends a `toggle`/`show`
message plus the current bearer token over a local Unix-domain socket to an
already-running `BkemoCapture.app` (spawned by `setup_app`, torn down on
Tauri exit). The helper owns the panel entirely — Liquid Glass background,
plain-text editor with a toggle-based markdown preview, its own
persist-then-drain upload queue POSTing `/api/v1/note/upsert` (reusing
`out/ios/Shared`'s `BkemoShared` package, now also targeting macOS) — and
hides immediately on save, uploading in the background. The old
`/quicknote` webview, `quicknote_panel.rs`, and `capture_queue.rs` are
unchanged and still serve web and any non-macOS Tauri platform.

Other shell pieces: tray, dock visibility (shown with main window, hidden in
background), keychain, capture queue (still used for web/non-macOS ⌃W),
hotkey, window state, optional OTA bundle resolver (not the production
delivery path yet). Desktop auto-update is intentionally omitted. Tauri
currently packages `out/output/public` via `frontendDist`, so a server
deploy does **not** replace the bundled frontend.

### iOS (SwiftUI, `out/ios/`)

Native UI, not the React SPA. `BkemoClient` talks REST. `SyncEngine`
replays pending `LocalMemo` rows (SwiftData), then reconciles via SSE +
cursor (`MemoReconciler`). Offline creates get a pending badge. Also:
share extension, widget (`OpenBkemoIntent`), biometric gate, App Group
defaults. Platform header: `ios`.

---

## 8. MCP inbound (`/mcp`)

Stateless Streamable HTTP. Ordinary session JWTs and REST access tokens are
**not** MCP credentials. Tokens must be issued for the exact `/mcp`
resource.

OAuth 2.1 public client: PKCE S256, exact redirect match, short-lived
access tokens, hashed stored credentials, audience binding, user
revocation. Metadata at `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`. Dynamic registration at
`/oauth/register`.

Tools: `search_notes`, `get_note`, `list_tasks`, `list_recent_changes`,
`list_tags`, `list_files`, `create_note`, `create_task`, `update_note`,
`complete_task`, `archive_note`, `trash_note`, `add_comment`.

Resources: `bkemo://notes/{portableId}`, `bkemo://tasks/today`,
`bkemo://changes/{cursor}`.

---

## 9. como plugin architecture

`ComoPlugin` (`src/main.ts`) **extends** `ClaudianPlugin` (`src/codian/main.ts`).
One Obsidian plugin, four modes in one right-sidebar leaf, switched from the
in-view brand (`como · notes` / chevron):

| Mode | View type | Source of truth |
|---|---|---|
| Notes | `bkemo-sidebar` | bkemo server (cached locally) |
| Todos | `como-todos` | vault markdown task lines |
| Activity | `como-activity` | vault file events (plugin JSON, not notes) |
| Chat | `codian-view` | local Codian sessions + provider CLIs/SDKs |

Settings tab bar: **Notes · Chat · Providers · Activity · Todos**.

### Notes mode (no-projection v1)

`BkemoSidebarView`: right-sidebar feed + bottom dock (capture / preview /
edit).

- Single-click → dock preview + actions
- Double-click → dock editor (blur/Esc save; conflict modal on stale
  `revision`)
- Copy Markdown, Append to active note, Open in bkemo
  (`/note/{portableId}`), Copy attachment to
  `bkemo/attachments/<note-id>/…`
- Typed capture and voice capture (review / discard / upload)
- Offline typed (and voice) capture queued in `sync/outbox.ts`, replayed
  on reconnect
- Filters: search, tag, tasks, archive
- `sync/changes.ts` pulls bounded change pages into the plugin cache

`BkemoHttpClient` always sends `Authorization: Bearer` and
`X-Bkemo-Platform: obsidian`. Origin is compile-time:
production `https://bk.hax429.me`, `--dev` localhost.

Pairing: paste a Settings → Security token with platform `obsidian`.
`POST /api/v1/obsidian/pair/access-token` validates; the JWT is stored in
Obsidian SecretStorage. Disconnect clears **local** secret only; revoke on
Mac/Web. Pairing codes are rejected.

Required scope: `notes:read`. Recommended: `notes:read`, `notes:write`,
`tags:read`, `attachments:read`, `attachments:write`.

### Vault Todos

`TodoService` + `TodoIndex`. Parses `- [ ]` / `- [x]` with optional
`due:YYYY-MM-DD|today|tomorrow`, bare `important` / `urgent` (not `#`
tags), and stable `id:<token>`. Vault markdown is source of truth; the
panel rewrites the line for toggle / due / flags.

Lanes: Open, Inbox, Overdue, Today, Week, Later, Done. Timezone follows
Activity settings.

**Send to bkemo** is explicit: creates a linked TODO note. Later, toggling
the checkbox calls `POST /api/v1/obsidian/notes/:portableId/complete`.
Link map: `data/todos/links.json`.

### Vault Activity

`ActivityService` = tracker + store + sealer + scheduler.

Desktop capture of create / coalesced modify / delete / rename. Live
filterable view. Hybrid **seal** into
`Journal/day/YYYY-MM-DD.md` as an immutable
`%%como-vault-activity:start … end%%` panel (callout `como-activity`).
Refuses reseal. Day boundary uses timezone from `Resources/agent/USER.md`
(overridable); events before the auto-seal clock (default 02:00) belong to
the previous journal date.

Live logs are plugin JSON, not vault notes. Defaults ignore `.obsidian/`,
`Resources/Media/`, `Resources/agent/`. Journal **Modified** suppressed by
default. Init sets a baseline so install-day noise is not sealed.

### Media

`MediaService` intercepts editor paste/drop, uploads to bkemo (or optional
custom R2), and rewrites markdown to remote URLs. Separate from the Notes
dock “Copy attachment” path (which pulls **from** bkemo **into** the vault).

### Codian (Chat mode)

Vendored AI chat inside the same plugin. Built-in providers registered in
`src/codian/providers/index.ts`: Claude, Codex, Grok, OpenCode, Kimi, Pi
(plus native ACP adapters). Each provider has runtime, history, settings
UI, and command catalog.

Chat talks to **local CLIs/SDKs**, not to bkemo’s `aiServer`. System prompt
can require reading `Resources/agent/AGENT.md` (+ companions, default
`USER.md`) before replies. Saving a chat reply as a bkemo note goes through
`ComoPlugin.saveChatMarkdownAsNote` (online create or offline outbox).

Sessions live under `.obsidian/plugins/como/data/`. Settings → Notes / Chat
can **Export everything** (zip of `data.json` + that tree).

Legacy `bkemo` / `codianz` / `codian` plugin data migrates into como on
first load when como’s `data.json` is empty.

---

## 10. Obsidian HTTP contract

Mounted at `/api/v1/obsidian`. Actor resolution:
`resolveObsidianActor` — access-token JWTs only.

| Method | Path | Gateway op |
|---|---|---|
| POST | `/pair/access-token` | validate token (unauthenticated) |
| POST | `/pair/exchange` | retired pairing-code path (kept for errors) |
| GET | `/session` | identity + scopes |
| GET | `/notes` | `searchNotes` (`q`, `tag`, `tasks`, `archived`, cursor) |
| GET | `/notes/:portableId` | `getNote` |
| POST | `/notes` | `createNote` (`task`, `dueDate`, `important`, `urgent`, idempotency) |
| PATCH | `/notes/:portableId` | `updateNote` (`expectedRevision`) |
| POST | `/notes/:portableId/complete` | `completeTask` |
| GET | `/changes` | `listRecentChanges` |
| GET | `/tags` | `listTags` |
| GET | `/link-enrichments` | bookmark sidecar for listed notes |
| GET | `/attachments/:portableId` | metadata |
| GET | `/attachments/:portableId/content` | bytes |
| GET | `/public-media/:portableId` | public vault media |
| POST | `/audio` | `uploadAudio` (multipart) |
| POST | `/files` | `uploadFile` (multipart) |

Errors are redacted codes: `unauthorized`, `revision_conflict`,
`invalid_media`, `oversized_media`, `access_token_*`, etc. Security misuse
alerts in plugin settings are redirect-only; revoke/dismiss is Mac/Web.

---

## 11. Sync topology (all clients)

```text
                    notes table
                         │ trigger
                         ▼
                   noteChange journal ──── cursor pages ──► clients
                         │
                         ▼
                   noteSyncHub.publish
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     SSE (web/mac)   SSE (iOS)    (como pulls /changes;
                                   no SSE in plugin)
          │              │
          └────── 60s idle-aware poll (web/mac/iOS)
```

como does not subscribe to SSE. The sidebar refreshes via search + bounded
`/changes` when the view is active / on reconnect. Offline captures sit in
the plugin outbox until `createNote` / `uploadAudio` succeed.

Conflict rule for edits: last observed `revision` must match. Plugin dock
editor shows reload vs keep-editing. Gateway never silent-overwrites.

---

## 12. Production topology

```text
Developer laptop                         Oracle (Ubuntu)
─────────────────                        ────────────────
edit → localhost:1111                    /home/ubuntu/services/notes/bkemo
focused tests                            bun out/output/index.js :1111
user acceptance                          systemd bkemo.service
explicit approve → git push              git pull + prisma migrate + build
                                         nginx → Cloudflare → bk.hax429.me
```

Neon: pooled endpoint, 0.25–1 CU, five-minute scale to zero. Runtime adds
`connection_limit=2` when unset. Superadmin Storage screen can show CU-hour
estimates (Neon API key encrypted in site config).

Commit, push, SSH, and deploy require explicit user authorization. Native
client rebuilds are separate from web deploys until OTA is verified.

---

## 13. Design tokens and UI boundaries

bkemo product UI must sit under `.bkemo` with `data-theme`, optional
`data-preset` (`coffee` | `developer` | `dusk`), `data-density`, and
`--accent`. Priority colors `--important` (gold) and `--urgent` (red) are
not the brand accent. Note body font is Lora; UI is Inter; meta kickers are
mono uppercase.

como UI is Obsidian-native (ItemView, workspace leaves, SecretStorage,
editor extensions). It does not load the React app. Memo cards in the
sidebar are plugin DOM (`src/view/noteCard.ts`) styled to feel like bkemo
without sharing CSS.

---

## 14. What is explicitly out of current architecture

- Vault projection of the full bkemo corpus (como v1)
- Hard platform-mismatch reject / device attestation
- MCP stdio / legacy SSE transports
- Docker-based bkemo distribution
- Desktop auto-update; verified OTA frontend for Tauri/iOS
- AI automations and custom scripts on Schedule Task
- Multi-tenant provisioning

Those live in `docs/plans/` until implementation lands and this document
is updated.

---

## 15. File anchors

| Concern | Path |
|---|---|
| Schema | `bkemo/prisma/schema.prisma` |
| Note API | `bkemo/server/routerTrpc/note.ts` |
| Gateway | `bkemo/server/lib/integrationGateway.ts` |
| Obsidian HTTP | `bkemo/server/routerExpress/obsidian.ts` |
| Pairing | `bkemo/server/lib/obsidianPairing.ts` |
| MCP | `bkemo/server/routerExpress/mcp.ts`, `bkemo/server/lib/mcpOAuth.ts` |
| SSE / journal | `bkemo/server/lib/noteSync.ts`, `bkemo/server/routerExpress/noteSync.ts` |
| Transfer `.bk` | `bkemo/server/lib/bkemoTransfer.ts` |
| Web store / offline | `bkemo/app/src/store/blinkoStore.tsx`, `bkemo/app/src/lib/noteSync.ts` |
| Editor | `bkemo/app/src/components/TiptapEditor/` |
| Tokens / prefs | `bkemo/app/src/styles/bkemo-theme.css`, `bkemo/app/src/lib/bkemoSettings.ts` |
| Scopes / platforms | `bkemo/shared/lib/accessTokenScopes.ts`, `accessTokenPlatform.ts` |
| macOS shell | `bkemo/out/macos/src/` |
| iOS sync | `bkemo/out/ios/bkemo/Data/SyncEngine.swift` |
| Plugin entry | `como/src/main.ts` |
| HTTP client | `como/src/bkemoClient.ts` |
| Sidebar | `como/src/view/BkemoSidebarView.ts` |
| Activity | `como/src/activity/ActivityService.ts` |
| Todos | `como/src/todos/TodoService.ts` |
| Codian | `como/src/codian/` |
| Product guides | `bkemo/docs/agents/PROJECT.md`, `como/docs/OBSIDIAN.md` |
