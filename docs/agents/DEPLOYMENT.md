# bkemo development and deployment workflow

This is the authoritative path from a local change to production. The local
checkout is the development and acceptance-test environment. Production is
updated only after the user has tested the change and explicitly asked to ship
or deploy it.

```text
edit -> local server -> focused checks -> user acceptance
                                          |
                                  explicit approval
                                          v
                              commit/push -> deploy
                                              |
                                              v
                                  production verification
```

## Runtime topology

| Stage | Location | Role |
|---|---|---|
| Local | `/Users/hax429/Developer/bkemo` | Development and acceptance testing |
| Local app | `http://localhost:1111` | Full web/backend process |
| Database | Neon PostgreSQL | Preferred development and production data |
| Attachments | Cloudflare R2 | Preferred object storage (`objectStorage=s3`) |
| Local bootstrap DB | PostgreSQL on port `5433` | Fallback only before Neon attach |
| Source | `github.com/hax429/bkemo`, normally `main` | Code delivered to production |
| Production host | SSH alias `Oracle` | Ubuntu server |
| Production checkout | `/home/ubuntu/services/notes/bkemo` | Source-built live checkout |
| Production process | `bkemo.service` | systemd service running `bun dist/index.js` on port `1111` |
| Public edge | Cloudflare and nginx | Cloudflare proxies to nginx, which terminates TLS and forwards `bk.hax429.me` to `localhost:1111` |
| Public service | `https://bk.hax429.me` | Web application and API endpoint used by native clients |

Production is a source deployment, not a bkemo Docker image. Neon and R2 hold
application data and attachments; the checkout still uses `.blinko` for plugins,
vectors, dumps, and any remaining local files. On the current host that path may
resolve through a symlink, so inspect the target before maintenance.

## 1. Develop locally

Start the full stack:

```bash
./scripts/run-dev.sh
```

Other supported modes (local bootstrap database only; never for attached Neon):

```bash
./scripts/run-dev.sh --reset   # destructive: recreate the local bootstrap database
./scripts/run-dev.sh --stop    # stop local PostgreSQL
```

When Neon is already attached through the development-only workflow, the
launcher skips local Postgres, runs `prisma migrate deploy` against the direct
Neon endpoint, and keeps existing accounts. Configure Cloudflare R2 in
Settings → Storage, then use Verify active setup.

`./scripts/run-dev.sh` intentionally remains in the foreground. If the user
needs the server to persist beyond an agent command session, use a detached
`screen` session and verify the HTTP endpoint independently:

```bash
screen -ls
screen -dmS bkemo-dev ./scripts/run-dev.sh
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:1111/
```

Local bootstrap PostgreSQL uses shared memory. If it fails in a sandbox with a
`shmat(...): Operation not permitted` error, rerun with the required host
permission; do not rewrite the launcher to work around the sandbox.

## 2. Verify the change

Use the smallest relevant matrix, with the web build as the general release
gate:

| Change area | Required checks |
|---|---|
| React/server/shared code | Focused tests plus `bun run build:web` |
| REST API | Start local server and run `./scripts/test-api.sh` |
| Prisma schema | Review the migration, generate Prisma client, and test migration behavior |
| Rust/Tauri | `cargo check`, relevant target check, and `cargo test` |
| iOS/offline/native | Platform build and the checks in `docs/plans/IOS.md` |

Do not treat a successful build as user acceptance. Keep the local server
available, report what was checked, and wait for the user to approve shipping.

## 3. Approval gate

Commit, push, SSH access to `Oracle`, service restarts, and production deployment
require explicit user authorization. A request to implement or test a feature is
not deployment approval.

Before shipping:

1. Review `git status` and the diff so unrelated working-tree changes are not
   accidentally included.
2. Confirm the local checks and user acceptance are complete.
3. Confirm the intended branch and commit scope.
4. Never commit `.env`, `.blinko/`, database contents, backups, access tokens, or
   other secrets.

## 4. Commit and push

Follow the branch and commit instructions given by the user. When a feature
branch is appropriate:

```bash
git switch -c <topic>
git add <intentional paths>
git commit -m '<conventional message>'
git push -u origin HEAD
```

Keep `main` deployable and never force-push it.

## 5. Deploy the existing production host

The normal deployment updates the existing checkout, applies only repository
migrations, rebuilds, and restarts the service. Run build commands without
piping them through `tail` or another command that could mask their exit code.

```bash
ssh Oracle 'set -e
  export NVM_DIR=$HOME/.nvm
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null
  export PATH=$HOME/.bun/bin:$PATH
  cd /home/ubuntu/services/notes/bkemo
  git pull
  bun install
  bunx prisma migrate deploy --schema=prisma/schema.prisma
  bun run build:web
  bun run build:seed
  sudo systemctl restart bkemo'
```

Why the environment setup matters:

- Non-login SSH shells do not automatically load nvm. Without sourcing it, the
  host may use an obsolete system Node that cannot run current Turbo/Vite code.
- Bun must be on `PATH`; Turbo invokes the package manager by name.
- `set -e` must observe each build command directly so a failure prevents the
  service restart.

If dependencies and migrations are known to be unchanged, `bun install` and
`prisma migrate deploy` may be no-ops, but keeping them in the standard sequence
makes the deployment deterministic.

## 6. Verify production

Deployment is not complete until the process, local listener, public edge, API,
and recent logs agree that it is healthy:

```bash
ssh Oracle 'systemctl is-active bkemo && curl -fsS -o /dev/null http://localhost:1111/'
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' https://bk.hax429.me/
curl -fsS https://bk.hax429.me/api/v1/public/site-info
ssh Oracle 'journalctl -u bkemo -n 50 --no-pager'
```

A healthy startup log includes the server listening on `0.0.0.0:1111`. Also
check the user-visible behavior that motivated the deployment; HTTP 200 alone
does not verify a feature.

## 7. Cache-safe frontend releases

Keep stable app-shell and service-worker URLs revalidated on every request.
`server/lib/staticCache.ts` must continue serving `index.html`, manifests,
`registerSW.js`, and every `sw*.js` file with `no-cache, no-store,
must-revalidate`. Only content-hashed files under `assets/` are immutable.

`app/public/sw.js` is a permanent retirement endpoint for browsers controlled
by the legacy worker. Do not remove or turn it back into an application worker.
It clears the legacy caches, unregisters itself, and reloads open windows so the
current app shell can register `sw-bkemo-v2.js`.

If Cloudflare previously cached an update-sensitive URL with an immutable
header, deploy the corrected origin first and then purge only the affected URLs,
normally `/`, `/index.html`, `/registerSW.js`, `/sw.js`, and the current
versioned worker. Verify the returned cache headers and perform a browser mount
check after the purge; HTTP 200 alone cannot detect an empty React root.

## 8. Native clients and frontend delivery

The web deployment immediately updates the browser application and backend API.
The production Tauri builds currently package `dist/public` through
`frontendDist`, so a normal server deployment does **not** replace their bundled
frontend. Native code or bundled-frontend changes require the appropriate signed
client build until the planned OTA bundle path is activated and device-verified.

The OTA generator already exists in the app package:

```bash
bun --cwd app run build:web:ota
```

Do not substitute that command into the production workflow until the active
client URL and rollout procedure in [`../plans/IOS.md`](../plans/IOS.md) are
verified. Native clients continue to use `https://bk.hax429.me` for API data.

## 9. Host bootstrap reference

For a new systemd host, the required shape is:

1. Install Bun 1.2.8, Node 20 or newer, and nginx. Prefer Neon for
   `DATABASE_URL` and Cloudflare R2 for attachments (configured in app storage
   settings after first boot).
2. Clone `hax429/bkemo` and create a production `.env` with Neon `DATABASE_URL`,
   `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TRUST_PROXY=1`, and secure-cookie settings.
3. Run `bun install`, Prisma generation/migrations, `bun run build:web`, and
   `bun run build:seed`.
4. Ensure `server/public` resolves to `dist/public` and create the required
   `.blinko/{files,plugins,vector,pgdump}` runtime directories.
5. Run `bun dist/index.js` from the repository root under systemd and expose it
   through nginx with TLS and upload-size/upgrade headers.
6. Keep `.env`, `.blinko`, database storage, and backups outside Git lifecycle
   operations.

The repository also contains `deploy/bkemo-cutover-helper.service` for the
guarded PostgreSQL-to-Neon cutover. It is a specialized migration path, not part
of routine deployment. Review its service paths, socket permissions, direct
Neon URL, rollback snapshot, and maintenance-mode behavior before enabling it.

## Troubleshooting

| Symptom | Likely cause and response |
|---|---|
| `Unable to find package manager binary` | Put `$HOME/.bun/bin` on `PATH` before Turbo commands. |
| Modern JS syntax error from Turbo/Vite | The non-login shell found the old system Node; source nvm and select the default Node. |
| `server/public` missing | Repair the link to `dist/public`, then rebuild and verify static files. |
| `.blinko` path warning after host cleanup | Inspect the active symlink target and recreate only the required runtime directories. |
| Migration reports no pending migrations | Expected when the database already matches the repository. |
| Service is active but UI is stale | Verify the built asset path, `server/public` target, cache headers/service worker, and public response—not only systemd state. |
