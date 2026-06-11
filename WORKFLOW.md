# bkemo — Dev → Test → Ship Workflow

The one loop for every change. **This machine (`/Users/hax429/Developer/bkemo`)
is the local dev + testing environment.** Nothing reaches users until *you* have
tested it locally and said "ship it" — only then does Claude commit, push, and
deploy.

```
 edit ─▶ local dev (localhost:1111) ─▶ YOU test ─▶ "ship it"
                                                      │
                          ┌───────────────────────────┘
                          ▼
        git commit + push (gh)  ─▶  hax429/bkemo @ main
                          │
                          ▼
        ssh Oracle: git pull + build + restart bkemo.service
                          │
                          ▼
        https://bk.hax429.me   ◀── web users + iOS/macOS shells connect here
```

## Topology (the real, verified setup)

| Where | What | Detail |
|---|---|---|
| **Local** | dev + test | `./run-dev.sh` → `http://localhost:1111` (Postgres via Docker/Homebrew, admin/123456) |
| **GitHub** | source of truth | `https://github.com/hax429/bkemo`, branch `main`, `gh` authed as `hax429` |
| **Cloud** | production | host alias **`Oracle`** (`ubuntu@129.80.246.6`, key `~/.ssh/oracle.pem`) |
| **Repo on cloud** | live checkout | `/home/ubuntu/services/notes/bkemo` (git clone of `hax429/bkemo`, `main`) |
| **Process** | runtime | `bkemo.service` (systemd, `bun dist/index.js`, port **1111**, hardcoded) |
| **Edge** | TLS / proxy | nginx `bk.hax429.me` → `localhost:1111` (`/etc/nginx/sites-available/bk.hax429.me`) |
| **Public URL** | what clients hit | `https://bk.hax429.me` — the default endpoint baked into the Tauri shells (`app/src/lib/blinkoEndpoint.ts`) |

> Deploy is **from source only** — no Docker image for bkemo itself (the `db` is a
> separate container). Canonical reference: [`DEPLOYMENT.md`](./DEPLOYMENT.md) §11.

## 1. Develop locally

```bash
./run-dev.sh                 # start full stack on http://localhost:1111
./run-dev.sh --reset         # wipe + recreate the DB first
./run-dev.sh --stop          # stop local Postgres
```

For native (Tauri) testing, see [`IOS.md`](./IOS.md) §5 and [`MAC.md`](./MAC.md):
```bash
./build_ios.sh --sim         # iOS simulator, offline-bundled prod build
bun --cwd app run tauri:desktop:build   # macOS .app
```

## 2. Test (before anything ships)

Run the matrix that's relevant to the change. **Web is the gate for every change;
add the native lanes when Rust/Tauri/offline/native code changed.**

- **Web** (`localhost:1111`): the feature works; `cd app && bun run test` (vitest) is green; `bun run build:web` succeeds.
- **Rust** (if `app/src-tauri/**` changed): `cd app/src-tauri && cargo check && cargo check --target aarch64-apple-ios-sim && cargo test`.
- **iOS** (if mobile/offline changed): `./build_ios.sh --sim`, plus the offline cold-launch check (IOS.md §5.1 Step 5 / §6.6).
- **macOS** (if desktop changed): build the `.app`, exercise the global-shortcut Quick Note (MAC.md), and the offline path.
- **API** (if server/REST changed): `./scripts/test-api.sh` against the running dev server (currently 49/49).

Full per-area checklists live in [`IOS.md`](./IOS.md) §7.

## 3. Ship — only after you confirm

When you say **"ship it"** (or "it's tested, deploy"), Claude does, in order:

### 3a. Commit + push
```bash
git checkout -b <topic>        # if on main; otherwise stay on the feature branch
git add -A
git commit -m "<conventional message>"   # Co-Authored-By: Claude …
git push -u origin HEAD
gh pr create --fill            # optional; or push straight to main if that's the call
```

### 3b. Deploy to the cloud (sync + rebuild + restart)
One command from the local machine (mirrors `DEPLOYMENT.md` §11, adjusted to the
real server path):

```bash
ssh Oracle 'set -e
  export PATH=$HOME/.bun/bin:$PATH
  cd /home/ubuntu/services/notes/bkemo
  git pull
  bun install                                                # only if deps changed
  bunx prisma migrate deploy --schema=prisma/schema.prisma   # only if schema changed
  bun run build:web                                          # → dist/index.js + dist/public
  bun run build:seed
  sudo systemctl restart bkemo'
```

### 3c. Verify production
```bash
curl -o /dev/null -w "%{http_code}\n" https://bk.hax429.me/        # 200
curl https://bk.hax429.me/api/v1/public/site-info                  # JSON
ssh Oracle 'journalctl -u bkemo -n 30 --no-pager'                  # healthy boot log
```
A healthy boot ends with `🎉server start on port http://0.0.0.0:1111 - env: production`.

The iOS/macOS shells load the frontend from `bk.hax429.me`, so a server restart
updates those clients on their next launch — **no App Store resubmission for
frontend-only changes** (that's also what Phase 8 OTA hardens for true offline).

## 4. Mobile/desktop frontend & OTA

- **Today (pre-Phase-8-flip):** the shells fetch the frontend from `bk.hax429.me`,
  so step 3b already updates them. Native/Rust changes still need a Tauri rebuild
  (IOS.md §5.7, MAC.md).
- **After the OTA window-URL flip:** the shells load from a local bundle and pull
  updates via the manifest, so a frontend deploy must also publish the bundle:
  ```bash
  ssh Oracle '… cd …/bkemo && bun run build:web:ota'   # writes dist/public/app-bundle/{manifest.json,bundle-<ver>.zip}
  ```
  Served by the existing `express.static('dist/public')`; clients pick it up next
  launch. Bump root `package.json` `version` so the manifest version changes.

## Rules of engagement (for Claude)

1. **Never deploy or push on your own initiative.** Commit/push/`ssh Oracle`
   happen only after the user explicitly confirms the local test passed.
2. **Branch off `main`** for new work; don't commit straight to `main` unless told.
3. The cloud repo is a plain `git pull` checkout — keep `main` deployable. No
   force-push to `main`.
4. `.env`, `.blinko/`, and `db/` on the server are **production data** — never
   touch them during a sync. Migrations go through `prisma migrate deploy` only.
5. Production changes are outward-facing — confirm before destructive server ops.
