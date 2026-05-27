# bkemo

A personal, self-hosted note app — derived from [blinkospace/blinko](https://github.com/blinkospace/blinko). bkemo trims the upstream project down to a single-user, source-deployed setup with a Tauri-based iOS shell, offline support, and an OTA-style update path.

> bkemo is not a fork intended for general use. It's the codebase that powers one person's note server at `bk.hax429.me` and the corresponding iOS/macOS app. The upstream Blinko project is the right starting point if you want a polished, multi-user, Docker-deployable note app.

## What's different from upstream Blinko

- **No Docker.** The server runs from source on a Linux VM under `systemd`. See [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- **iOS / macOS first.** The Tauri shell is the primary client. The web UI still works; the iOS app gets dedicated offline handling, keyboard-aware editor sizing, an OTA bundle updater, and visualViewport-based layout. See [`IOS.md`](./IOS.md).
- **Single-tenant.** No multi-user provisioning, no PikaPods, no public install.sh.
- **Renamed.** Bundle id is `me.hax429.bk`, Xcode target is `bkemo-ios`, Cargo crate is `bkemo`.

Everything else — tRPC API, Prisma schema, the React + Vditor frontend, the AI provider abstractions, the tag/note model — is upstream Blinko. Credit and the GPLv3 obligations live with them.

## Stack

| Layer    | Tech                                             |
| -------- | ------------------------------------------------ |
| Frontend | React 18, TypeScript, Vite, TailwindCSS, MobX    |
| Editor   | Vditor                                           |
| API      | tRPC (typed) + Express                           |
| DB       | PostgreSQL via Prisma                            |
| Mobile   | Tauri v2 (WKWebView on iOS, custom Swift plugin) |
| Runtime  | Bun ≥ 1.2.8 / Node ≥ 20                          |
| Build    | Turbo monorepo                                   |

## Layout

```
.
├── app/                  Tauri shell + React frontend
│   ├── src/              React app
│   ├── src-tauri/        Rust + iOS/macOS native bits
│   └── tauri-plugin-blinko/  Swift/Kotlin plugin (status bar, share sheet, permissions)
├── server/               Node + tRPC + Express backend
├── prisma/               DB schema + migrations
├── shared/, blinko-types/  Shared utilities & type defs
├── DEPLOYMENT.md         Source-from-scratch server deployment
├── IOS.md                iOS build, debug, and offline-mode recipes
└── CLAUDE.md             Notes for Claude Code when working in this repo
```

## Quickstart (dev)

```bash
bun install
bun run prisma:generate
bun run prisma:migrate:dev
bun run dev:backend     # backend on :1111
bun run dev:frontend    # vite dev server
```

`bun run dev` launches the full Tauri desktop shell. For iOS, see [`IOS.md`](./IOS.md) (you'll need the Xcode toolchain and an Apple developer account).

## Deployment

- **Server:** [`DEPLOYMENT.md`](./DEPLOYMENT.md) — bare-metal install on a systemd host with nginx in front.
- **iOS / macOS:** [`IOS.md`](./IOS.md) — Tauri shell build, code signing, offline diagnosis, OTA bundle.

## Credits & license

bkemo is a derivative work of [**blinkospace/blinko**](https://github.com/blinkospace/blinko) by the Blinko authors. The upstream project is licensed under **GNU General Public License v3.0**, and this repository inherits the same license — see [`LICENSE`](./LICENSE).

All design, the original note model, the tRPC architecture, the editor integration, the AI feature surface, and most of the React frontend are upstream work. If you're looking to use a polished version of this software, **use the upstream project**, not this fork.

If you build on bkemo's iOS-specific changes, the GPLv3 obligations carry forward: source must remain available, derivative works must be GPL-compatible, and modifications must be marked. See the [Blinko upstream README](https://github.com/blinkospace/blinko/blob/main/README.md) for the canonical project description and community resources.
