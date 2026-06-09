# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Blinko is an open-source, self-hosted note-taking application with AI-powered features. It's a multi-platform application (web, desktop via Tauri, mobile) built with TypeScript/React frontend and Node.js/Express backend.

## bkemo — Direction D rewrite (current app)

This fork was rebuilt around one idea: **every memo is also a todo**. The new "Direction D" UI is now **the app** — `/` and `/bkemo` render `app/src/pages/bkemo` (a fixed full-screen `.bkemo` surface). The legacy Blinko web UI (`CommonLayout` chrome + the `pages/index|hub|ai|resources|review|settings|plugin|analytics|all|detail` routes) was **removed from routing** in `app/src/App.tsx`; those page files and many legacy components still exist on disk and are not deleted because the Tauri **quick-capture window** (`/quicknote`) and a few shared pieces still import them. The legacy **Vditor** editor has been fully removed from the note-composing paths — `app/src/lib/editorTypes.ts` / `hooks.ts` retain only Vditor-free no-op shims for API compatibility — and **every** composer (Stream, NoteModal, quicknote) now uses TipTap. Global toasts/dialogs come from `<AppProvider/>` (not the removed chrome).

Key bits of the new architecture:
- **Data model**: `notes` reuses `type` (`NoteType.TODO`) plus task columns `dueDate`/`isImportant`/`isUrgent`/`completedAt` (`prisma/schema.prisma`). A memo is a task if typed TODO or any task field is set; done = `completedAt != null`. A `reaction` table powers public reactions.
- **Backend**: `note.list` gained task filters (lane via `dueStart/dueEnd`, `quadrant`, `isImportant/isUrgent/isCompleted`); `note.upsert` persists task fields; `note.toggleDone`. New `reaction` router (`server/routerTrpc/reaction.ts`, public list/toggle). Sharing reuses `note.shareNote` + `note.publicDetail`; comments reuse the public `comment` router. **Public REST API + access tokens**: the whole `appRouter` is exposed as REST via `trpc-to-openapi` (`createOpenApiExpressMiddleware` at `/api`, spec at `/api/openapi.json`, Swagger UI at `/api-doc`, and a readable **Redoc reference webpage at `/docs`** — branded HTML served from `server/index.ts` that renders the live spec) — notes CRUD is already there (`/api/v1/note/{list,detail,upsert,batch-trash,batch-delete,…}`). Named, scope-limited tokens are managed by the new `accessTokens` router (`server/routerTrpc/accessToken.ts`: `scopes`/`list`/`create`/`revoke`) backed by the `accessToken` table (migration `20260607000000_add_access_tokens`). A token is a JWT minted by `generateAccessToken` (`server/lib/helper.ts`) carrying the **expanded permission paths**; `authProcedure` already gates each call on `ctx.permissions.some(p => path.includes(p))`. Scopes (`shared/lib/accessTokenScopes.ts` — `notes:read`/`notes:write`/`tags:read`/`tags:write`/`attachments:read`/`attachments:write`/`comments:read`/`comments:write`/`reactions`/`share`/`notifications`/`follows`/`analytics:read`, each mapping to tRPC path fragments; aligned to the REST-documented routers — `conversation`/`ai`/`message` have no `openapi` meta so they're tRPC-only and intentionally not offered as scopes; `users`/`config`/AI-provider-admin are excluded to prevent privilege escalation, e.g. `users.detail` would leak the account's full token) are flattened via `expandScopes` at mint time. The `attachment` router gained `openapi` metas on `allFiles` (new — flat list of every file across the account's notes, with the source note), `createFolder`, and `delete`.
- **Attachments (any file type)**: every composer (Stream, NoteModal, quicknote) has a 📎 attach button + desktop drag-drop via the `useAttachments` hook (`app/src/components/bkemo/useAttachments.tsx`) — files upload immediately to the multipart `/api/file/upload` route (`app/src/lib/attachments.ts` → `uploadAttachment`, mobile picker works since it's a plain `<input type=file multiple>`), show removable preview chips (`PendingAttachments`), and on save are linked via `note.upsert`'s `attachments` array (`toUpsertAttachment`; upsert only *adds* by `path`, never detaches existing). Memo cards/modal render an "Attachments (n)" section (`AttachmentList.tsx`) with image/PDF/video previews and file chips; clicking opens a full-screen lightbox (`AttachmentViewer.tsx` — **portaled to `document.body`** so it escapes the transformed `.bkemo` surface and is truly viewport-fixed; zoomable images that scroll/pan, PDF in an iframe, fetched text content, audio/video players, download fallback, ←/→/Esc). The **Files** page reuses the same viewer. Attachments + comments/reactions (`CardFeedback`) render not just in Stream but in **Random** and **Daily review** memo cards too. All markdown rendering goes through one `MarkdownView` (react-markdown + remark-gfm; used by Stream/Todos/Random/DailyReview/NoteModal and the public `/m/:id`), which **syntax-highlights fenced code blocks** (```lang) via `react-syntax-highlighter` `PrismAsyncLight` (languages lazy-loaded), theme-aware (`oneDark`/`oneLight`) with a language label; inline code and language-less blocks keep the plain `.tiptap-content` styles. The **editor** highlights code blocks live too: `TiptapEditor` swaps StarterKit's `codeBlock` for `CodeBlockLowlight` (lowlight `common` + `highlight.js/styles/atom-one-dark.css`) — both surfaces use an Atom One Dark palette, and `tiptap-markdown` round-trips the ```lang fences.
- **Mobile**: the `NoteModal` editor is a **bottom sheet** that slides up (`bk-sheet-up`) and fills most of the screen, sized to `window.visualViewport` so it rests above the on-screen keyboard with the toolbar reachable; reading mode is a near-fullscreen sheet. The mobile **More** sheet (`MoreSheet` in `pages/bkemo/index.tsx`) includes Settings, Files, Graph, Calendar, etc. (mobile has no sidebar, so the account-dropdown items live here). Revocation is enforced in `getTokenFromRequest`: tokens carry `tokenType:'access'`+`jti`; on each request the backing row is looked up by `jti` (missing row = revoked → 401) and `lastUsedAt` is refreshed (throttled). Session/legacy `apiToken`s have no `permissions` and keep full access.
- **Frontend**: screens in `app/src/components/bkemo/` (Sidebar, Stream, Todos+Matrix, DailyReview, Random, Trash, Calendar, Graph, Stats, SettingsScreen, NoteModal, MobileTabBar, MarkdownView) wired via `BlinkoStore.queryNotes` + the Dexie cache; Settings has a **Security & API** section (`SecurityScreen.tsx`) to create/list/revoke scoped access tokens (token shown once on create), with the REST base URL, a curl example, and a link to the Swagger docs; an **API Docs** section (`ApiDocsScreen.tsx`) renders a themed, filterable reference generated live from `/api/openapi.json` (endpoints grouped by tag, expandable per-operation body schema + copyable curl). the sidebar account dropdown (the "bkemo" trigger) opens **Graph** (`Graph.tsx` — a canvas force-directed view of the `[[memo]]` link graph, edges from `extractNoteLinkIds`; pan/zoom/drag, click a node to open; shows only linked notes by default, or every note when the `graphShowAll` pref — Settings → Appearance → "Show all notes in graph", stored in `BkemoPrefs` — is on), **Calendar** (`Calendar.tsx` — month grid mapping tasks by `dueDate`, memos by `createdAt`), **Files** (`FilesScreen.tsx` — all attachments across memos/todos/subtasks via `attachments.allFiles`, kind tabs image/audio/video/file, image thumbnails, source-memo chip that emits `bkemo:open-note`, open/delete), and Settings. The Inbox sidebar entry was removed (the `inbox` lane route/logic still exists in `Todos`); responsive (sidebar ≥768px, bottom tab bar below). Editor is **TipTap** (`app/src/components/TiptapEditor`, markdown round-trip, slash menu, #-autocomplete, task lists). **Inline task syntax** (`app/src/lib/taskSyntax.ts` → `parseTaskSyntax`) is applied on save in every composer (Stream, NoteModal, quicknote): a markdown checkbox (`-[]` / `- [ ]`) auto-promotes a memo to `NoteType.TODO`, and a `due:` token sets the due date (`due:today`, `due:tmr`/`due:tomorrow`, `due:MM/DD/YYYY`, `due:MM/DD/YY`, ISO, or `due:none` to clear). TipTap escapes plain-text punctuation (so `-[]` serializes as `\-\[\]`); `parseTaskSyntax` normalizes the (possibly escaped) checkbox to canonical GFM and a **lone** promotion checkbox (`stripLoneCheckbox` — the only one) is stripped on save *and* on card display so it doesn't duplicate the memo-level task toggle, while multi-item checklists are kept. The `due:` token is stripped from saved content. **Priority tags**: `#important` / `#urgent` are a typing shortcut for the priority flags (same as the `!` / `▲` buttons), stripped from saved content, and apply to **any** memo — priority is independent of task-ness (`isTask` no longer counts `isImportant`/`isUrgent`, so a plain memo can show the priority dot without becoming a to-do; every composer persists the flags regardless of type). Date parsing uses dayjs `customParseFormat` (`app/src/lib/dayjs.ts`). Memo cards show a due-date badge and a compact clickable `↳ BK-<id>` parent chip. **Memo links + subtasks**: typing `[[` in any composer opens a memo/todo autocomplete (`app/src/components/TiptapEditor/noteLinkSuggestion.ts`, searches via `queryNotes`) and inserts a markdown link with a relative `/bkemo/n/<id>` href (`app/src/lib/noteLinks.ts`). On save every composer extracts those ids and persists them as `references` (the `noteReference` table) so the link graph mirrors the body; `MarkdownView` renders the href as an in-app chip that emits `bkemo:open-note` (handled in `pages/bkemo/index.tsx`). **Article reading mode**: `NoteModal` auto-opens memos ≥ `ARTICLE_THRESHOLD` (500) chars in a distraction-free reader (near-fullscreen, centered ~720px column, long-form typography via the `.bk-article` class in `tiptap.css`, a reading-time estimate, `MarkdownView` body); the ✎ button switches to the editor and a "read" toggle in the editor header switches back. In the editor, an existing long memo collapses to the first lines (editor `maxHeight` ~240px) with an "⤢ Expand to full page" affordance; the **full-page editor** (`fullscreen` state) is a telegra.ph-style layout — full viewport, centered ~760px column, larger writing typography via `.bk-article-edit`, same toolbar + theme — toggled from the header **at any length** (the `⤢ full page` button is no longer gated on 500 chars). The **Stream composer** also has a `⤢` toolbar button that jumps the current draft (content, task flags, due date, pending uploads via the draft's `__fullscreen`/`__draftAttachments` flags) straight into the full-page editor. In code blocks, **Tab indents** (2 spaces) / Shift+Tab outdents instead of moving focus to the toolbar (`TiptapEditor` `handleKeyDown`). In `NoteModal`, each linked memo can be promoted to the editing memo's **parent** (`notes.parentNoteId`, self-relation `Subtasks` in `schema.prisma`, migration `20260531000000_add_note_subtasks`) — i.e. the current memo becomes a subtask of the one it links to; opening a memo shows its children underneath (`note.list`/`note.detail` include `subtasks`/`parentNote`). Design tokens in `app/src/styles/bkemo-theme.css` (dark default; theme/accent/density in Settings → Appearance, persisted via `app/src/lib/bkemoSettings.ts`). bkemo Settings embeds the reused Blinko setting sections (`allSettings` from `pages/settings`) retheme​d to bkemo tokens.
- **Public share**: `/m/:id` (`app/src/pages/m/[id].tsx`) — gradient public page showing one memo + reactions + guest comments; guest identity in `app/src/lib/guestId.ts`.
- **API smoke test**: `./scripts/test-api.sh` (loads `.env`, runs `scripts/test-api.ts` via bun) exercises the whole REST surface against a running dev server — it mints a full-access token from the first account, resolves each endpoint's method from `/api/openapi.json`, then runs the main flows (notes CRUD, tags, attachments incl. multipart upload, comments, reactions, notifications, follows, analytics, sharing, scoped-token allow/deny) with cleanup and a PASS/FAIL summary. Currently 49/49 pass. `./scripts/demo-api.sh` is a sibling that creates **real, kept** rich data (a markdown memo, an urgent+important todo with a due date, a subtask, a comment, reactions, a public share, tags, an access token) and prints every response — handy for populating the Home page and eyeballing API output. (Building these surfaced + fixed real bugs: subtask creation via `note.upsert` threw because the create mixed a scalar `accountId` with the `parentNote` relation form — now uses the scalar `parentNoteId` — and that branch's `catch` silently returned null instead of throwing.)
- **Local dev**: `./debug.sh` provisions Postgres (Docker or Homebrew), writes `.env`, `prisma db push`, creates `admin/123456`, and runs the backend+frontend on :1111. The root `dev:frontend` script is avoided (a Python `dotenv` shadows the Node one); the server's own `bun --env-file` is used instead.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Tauri (for desktop apps)
- **Backend**: Node.js, Express, tRPC, Prisma ORM
- **Database**: PostgreSQL
- **Package Manager**: Bun (v1.2.8+)
- **Build Tool**: Turbo (monorepo management)
- **AI**: Multiple AI providers (OpenAI, Anthropic, Google, Azure, Ollama, etc.)

## Project Structure

```
blinko/
├── app/                    # Frontend React application
│   ├── src/               # React source code
│   ├── src-tauri/         # Tauri desktop app configuration
│   └── tauri-plugin-blinko/ # Custom Tauri plugin
├── server/                 # Backend Node.js server
│   ├── aiServer/          # AI integration services
│   ├── routerTrpc/        # tRPC API routes
│   └── routerExpress/     # Express API routes
├── prisma/                # Database schema and migrations
├── shared/                # Shared utilities and types
└── blinko-types/         # Type definitions
```

## Common Development Commands

### Setup & Installation
```bash
bun install                # Install dependencies
bun run prisma:generate    # Generate Prisma client
bun run prisma:migrate:dev # Run database migrations
```

### Development
```bash
bun run dev                # Run Tauri desktop app in development
bun run dev:backend        # Run backend server only
bun run dev:frontend       # Run frontend only
bun run prisma:studio      # Open Prisma Studio for database management
```

### Building
```bash
bun run build:web          # Build web application
bun run tauri:desktop:build # Build desktop application
bun run tauri:android:build # Build Android application
```

### Database
```bash
bun run prisma:migrate:deploy # Deploy migrations to production
bun run seed               # Seed database with initial data
```

### Testing & Linting
```bash
bun run test               # Run tests (if configured)
```

## Architecture & Key Components

### Frontend Architecture
- **State Management**: MobX with custom stores in `/app/src/store/`
- **Routing**: React Router v7
- **UI Components**: Custom components with HeroUI (@heroui/react)
- **Editor**: TipTap (markdown round-trip) — see `app/src/components/TiptapEditor`; Vditor has been removed
- **Internationalization**: i18next with multiple language support
- **API Communication**: tRPC client for type-safe API calls

### Backend Architecture
- **API Layer**: Hybrid approach using both tRPC (type-safe) and Express routes
- **Authentication**: Multiple providers (local, OAuth via passport)
- **File Storage**: Local filesystem or S3-compatible storage
- **AI Integration**: Factory pattern for multiple AI providers
- **Background Jobs**: Cron-based scheduled tasks in `/server/jobs/`
- **Embeddings**: RAG (Retrieval-Augmented Generation) support with @mastra/rag

### Database Schema
- **Main Entities**: accounts, notes, attachments, tags, comments, conversations
- **ORM**: Prisma with PostgreSQL
- **Migrations**: Managed through Prisma migrate

## Environment Configuration

Create a `.env` file in the root directory with:
```
DATABASE_URL=postgresql://user:password@localhost:5432/blinko
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:1111

# Optional S3 storage
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# AI Providers (optional)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
# ... other AI provider keys
```

## Important Patterns

1. **File Operations**: Use the filesystem routes in `/server/routerExpress/file/` for file handling
2. **AI Features**: AI providers are configured in `/server/aiServer/providers/`
3. **Type Safety**: Use tRPC routes when possible for type-safe API calls
4. **State Management**: Follow MobX patterns in store files
5. **Component Structure**: React components follow a modular structure with separate index.tsx files

## Deployment

### Docker
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment
1. Build the application: `bun run build:web`
2. Run migrations: `bun run prisma:migrate:deploy`
3. Start the server: `bun run start`

## Port Configuration
- Frontend/Full App: 1111 (default)
- Backend API: Same port (integrated with Vite Express)

## Mobile / Desktop App (Tauri)

- Android development: `bun run tauri:android:dev`
- iOS / macOS: see [`IOS.md`](./IOS.md) for the full plan, build process, debug commands, and verification checklists.
- Custom plugin in `/app/tauri-plugin-blinko/`

### iOS / macOS architecture in one paragraph

The iOS and macOS apps are Tauri v2 WKWebView shells with native Swift/Rust plugins for status-bar, share sheet, and permissions. They ship **no backend code** — all data calls go to `https://bk.hax429.me` via `getBlinkoEndpoint()` (`app/src/lib/blinkoEndpoint.ts`). Offline support is provided by IndexedDB note cache (`noteCache.ts`), localStorage operation queues (`blinkoStore.tsx` — `offlineNoteStorage` + `offlinePendingOps`), and a filesystem attachment cache (`attachmentCache.ts`); the queues are replayed on the `app:online` event. Currently the iOS app loads its shell from the remote URL on every launch (`devUrl` in `tauri.ios.conf.json`), which means **a cold launch with no network shows a blank screen**. Phase 8 (in progress) introduces an OTA bundle updater: a `bundle://localhost` URI scheme served from a downloaded bundle in AppData, with a build-time `dist/public/app-bundle/{manifest.json, bundle-<ver>.zip}` produced by `scripts/build-app-bundle.ts` on every `bun run build:web`. The frontend on the server still updates the app automatically — just on the next launch instead of on every launch — and offline cold-launch works because the shell lives on disk. macOS keeps the existing `tauri-plugin-updater` GitHub-releases path (Gatekeeper/notarization make runtime-extracted code paths painful on macOS).

## Key Dependencies Notes
- Uses Bun as package manager and runtime
- Requires Node.js >= 20.0.0
- PostgreSQL database required
- Tauri requires Rust toolchain for desktop builds