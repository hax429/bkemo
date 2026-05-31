# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Blinko is an open-source, self-hosted note-taking application with AI-powered features. It's a multi-platform application (web, desktop via Tauri, mobile) built with TypeScript/React frontend and Node.js/Express backend.

## bkemo — Direction D rewrite (current app)

This fork was rebuilt around one idea: **every memo is also a todo**. The new "Direction D" UI is now **the app** — `/` and `/bkemo` render `app/src/pages/bkemo` (a fixed full-screen `.bkemo` surface). The legacy Blinko web UI (`CommonLayout` chrome + the `pages/index|hub|ai|resources|review|settings|plugin|analytics|all|detail` routes) was **removed from routing** in `app/src/App.tsx`; those page files and many legacy components still exist on disk and are not deleted because the Tauri **quick-capture windows** (`/quicknote|quickai|quicktool`) and a few shared pieces still import them (and still use the legacy **Vditor** editor). Global toasts/dialogs come from `<AppProvider/>` (not the removed chrome).

Key bits of the new architecture:
- **Data model**: `notes` reuses `type` (`NoteType.TODO`) plus task columns `dueDate`/`isImportant`/`isUrgent`/`completedAt` (`prisma/schema.prisma`). A memo is a task if typed TODO or any task field is set; done = `completedAt != null`. A `reaction` table powers public reactions.
- **Backend**: `note.list` gained task filters (lane via `dueStart/dueEnd`, `quadrant`, `isImportant/isUrgent/isCompleted`); `note.upsert` persists task fields; `note.toggleDone`. New `reaction` router (`server/routerTrpc/reaction.ts`, public list/toggle). Sharing reuses `note.shareNote` + `note.publicDetail`; comments reuse the public `comment` router.
- **Frontend**: screens in `app/src/components/bkemo/` (Sidebar, Stream, Todos+Matrix, DailyReview, Random, Trash, Calendar, Stats, SettingsScreen, NoteModal, MobileTabBar, MarkdownView) wired via `BlinkoStore.queryNotes` + the Dexie cache; responsive (sidebar ≥768px, bottom tab bar below). Editor is **TipTap** (`app/src/components/TiptapEditor`, markdown round-trip, slash menu, #-autocomplete, task lists). Design tokens in `app/src/styles/bkemo-theme.css` (dark default; theme/accent/density in Settings → Appearance, persisted via `app/src/lib/bkemoSettings.ts`). bkemo Settings embeds the reused Blinko setting sections (`allSettings` from `pages/settings`) retheme​d to bkemo tokens.
- **Public share**: `/m/:id` (`app/src/pages/m/[id].tsx`) — gradient public page showing one memo + reactions + guest comments; guest identity in `app/src/lib/guestId.ts`.
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
- **Editor**: Vditor for markdown editing
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