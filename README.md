# bkemo

A personal, self-hosted note app — derived from [blinkospace/blinko](https://github.com/blinkospace/blinko). bkemo trims the upstream project down to a single-user, source-deployed setup with native iOS and Tauri macOS clients, offline support, and an OTA-style update path.

> bkemo is not a fork intended for general use. It's the codebase that powers one person's note server at `bk.hax429.me` and the corresponding iOS/macOS app. The upstream Blinko project is the right starting point if you want a polished, multi-user, Docker-deployable note app.

## What's different from upstream Blinko

- **No Docker.** The server runs from source on a Linux VM under `systemd`. See the [deployment workflow](./docs/agents/DEPLOYMENT.md).
- **Unified notes and tasks.** The web UI uses one memo/task model and a TipTap editor. Inline task syntax in any composer includes `-[]` to promote a memo to a task and a `due:` token (`due:today`, `due:tmr`, `due:06/25/2026`, `due:06/25/26`) to set the due date.
- **Portable backups.** Settings → Data Transfer exports encrypted `.bk` archives (plus markdown/JSON). Settings → Schedule Task can run site-managed auto-archive and scheduled `.bk` backups to local storage or R2/S3 (last 7 retained). Legacy Blinko `.bko` backups are gone.
- **iOS / macOS first.** Native SwiftUI on iOS; Tauri shell on macOS. The web UI still works. See the [iOS plan](./docs/plans/IOS.md) and [macOS plan](./docs/plans/mac.md).
- **Single-tenant.** No multi-user provisioning, no PikaPods, no public install.sh.
- **Renamed.** Bundle id is `me.hax429.bk`, Xcode target is `bkemo`, Cargo crate is `bkemo`.

Everything else — tRPC API, the Prisma schema, much of the React frontend, the AI provider abstractions, the tag/note model — descends from upstream Blinko. Credit and the GPLv3 obligations live with them. (The note composer has since been rewritten on TipTap, replacing upstream's Vditor.)

## Stack

| Layer    | Tech                                             |
| -------- | ------------------------------------------------ |
| Frontend | React 18, TypeScript, Vite, TailwindCSS, MobX    |
| Editor   | TipTap (markdown round-trip)                     |
| API      | tRPC (typed) + Express                           |
| DB       | PostgreSQL via Prisma                            |
| Mobile   | Native SwiftUI (iOS); Tauri v2 (macOS)           |
| Runtime  | Bun ≥ 1.2.8 / Node ≥ 20                          |
| Build    | Turbo monorepo                                   |

## Layout

```
.
├── app/                  React frontend + Tauri plugin helpers
│   ├── src/              React app
│   ├── src-tauri →       symlink to out/macos (Tauri CLI)
│   └── tauri-plugin-blinko/
├── server/               Node + tRPC + Express backend
├── prisma/               DB schema + migrations
├── shared/               Shared utilities & contracts
├── out/
│   ├── obsidian/         Obsidian companion plugin source
│   ├── ios/              Native SwiftUI iOS app
│   ├── macos/            Tauri macOS shell (Rust)
│   └── output/           Web/server + platform build artifacts
├── scripts/              Dev, test, and platform build helpers
├── docs/agents/          Current project and deployment memory
├── docs/plans/           Roadmap and feature plans
└── AGENTS.md             Navigation index for coding agents
```

## Quickstart (dev)

```bash
bun install
bun run prisma:generate
bun run prisma:migrate:dev
bun run dev:backend     # backend on :1111
bun run dev:frontend    # vite dev server
```

`bun run dev` launches the full Tauri desktop shell. Platform builds:

```bash
./scripts/build_macos.sh
./scripts/build_ios.sh --sim
./scripts/build_ob.sh
```

## Deployment

- **Server:** [deployment workflow](./docs/agents/DEPLOYMENT.md) — local acceptance, source deployment to the systemd host, and production verification.
- **iOS / macOS:** [iOS plan](./docs/plans/IOS.md) and [macOS plan](./docs/plans/mac.md).

## Credits & license

bkemo is a derivative work of [**blinkospace/blinko**](https://github.com/blinkospace/blinko) by the Blinko authors. The upstream project is licensed under **GNU General Public License v3.0**, and this repository inherits the same license — see [`LICENSE`](./LICENSE).

The original note model, the tRPC architecture, the AI feature surface, and large parts of the React frontend are upstream work. If you're looking to use a polished version of this software, **use the upstream project**, not this fork.

If you build on bkemo's iOS-specific changes, the GPLv3 obligations carry forward: source must remain available, derivative works must be GPL-compatible, and modifications must be marked. See the [Blinko upstream README](https://github.com/blinkospace/blinko/blob/main/README.md) for the canonical project description and community resources.
