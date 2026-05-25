# Blinko — Source Deployment Guide

This guide deploys Blinko **from source** (not from the prebuilt `blinkospace/blinko` Docker image). The result is a long-running process you can update with `git pull && bun run build:web && systemctl restart blinko`. The iOS / macOS Tauri shells load the frontend from your server URL, so a server rebuild also updates the mobile/desktop UI on next launch.

For Docker-only deployment, see [`DEV.md`](./DEV.md). For mobile/desktop, see [`IOS.md`](./IOS.md).

---

## 1. Prerequisites

| Component  | Version       | Notes                                                                 |
| ---------- | ------------- | --------------------------------------------------------------------- |
| Bun        | **1.2.8**     | Pinned in `package.json` (`packageManager`). Later versions may work. |
| Node.js    | ≥ 20          | Only needed as a fallback runtime; we use Bun.                        |
| PostgreSQL | 14+           | Local install or a Docker container.                                  |
| Linux host | systemd-based | Examples below assume Ubuntu / Debian.                                |
| nginx      | any recent    | For TLS termination in front of Blinko (recommended).                 |

Install the pinned Bun version into the deploying user's home (no `sudo` required):

```bash
curl -fsSL https://bun.sh/install | bash -s bun-v1.2.8
# adds ~/.bun/bin to PATH in .bashrc
```

> **Important:** Bun must be on `$PATH`, not just invoked by full path. Turbo shells out to discover the package manager and fails with `Unable to find package manager binary` unless `~/.bun/bin` is on `PATH`. The systemd unit below sets `PATH` explicitly for this reason.

## 2. Provision PostgreSQL

You have two reasonable options.

### 2a. Reuse the existing `blinko-postgres` Docker container (recommended when migrating from the Docker image)

Keep the container running. Blinko will connect to it via the host port (default `5435` if you used the upstream `docker-compose.yml`):

```
DATABASE_URL=postgresql://postgres:<password>@localhost:5435/postgres
```

Do **not** touch the container or its data volume — that's your data of record.

### 2b. Fresh PostgreSQL

Create a database and user, then point `DATABASE_URL` at it. Schema migrations are applied later by `prisma migrate deploy`; no manual SQL needed.

## 3. Clone the source

```bash
git clone https://github.com/hax429/blinkos.git /opt/blinko    # or wherever
cd /opt/blinko
```

## 4. Configure `.env`

Create `.env` in the repo root:

```dotenv
NODE_ENV=production
NEXTAUTH_URL=https://your.domain.tld
NEXT_PUBLIC_BASE_URL=https://your.domain.tld
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
DATABASE_URL=postgresql://postgres:<password>@localhost:5435/postgres
DISABLE_SECURE_COOKIE=false
TRUST_PROXY=1
PORT=1111
```

> `PORT` is currently **hardcoded to 1111** in `server/index.ts`. Setting `PORT` in `.env` is harmless but has no effect. If you need a different port, edit `server/index.ts:93` and rebuild, then update nginx / the systemd unit accordingly.

`.env` is in `.gitignore`; never commit it.

## 5. Install, generate, build

Make sure Bun is on PATH for the whole sequence:

```bash
export PATH=$HOME/.bun/bin:$PATH

bun install
bunx prisma generate --schema=prisma/schema.prisma
bun run build:web        # builds frontend + backend → dist/
bun run build:seed       # builds the seed script → dist/seed.js
```

`build:web` produces `dist/index.js` (server bundle) and `dist/public/` (static assets).

## 6. Link the static-assets folder

vite-express in production looks for static files under **`server/public`**, not `dist/public`. The upstream `start:server:production` script copies `dist/public` → `server/public` with `ncp`. For an in-place source deployment, a symlink works just as well and survives rebuilds:

```bash
ln -s ../dist/public server/public
```

(Only needed once. Recreate if you nuke `server/`.)

## 7. Apply migrations & seed

```bash
bunx prisma migrate deploy --schema=prisma/schema.prisma
```

Seeding runs automatically on first server start, but you can pre-run it:

```bash
bun dist/seed.js
```

## 8. Provide the `.blinko` data directory

Blinko reads/writes user data — uploads, plugins, RAG vector store — under `.blinko/` **relative to `process.cwd()`** (see `server/routerTrpc/plugin.ts`). For an in-place install, leave it inside the repo:

```bash
mkdir -p .blinko/{files,plugins,vector,pgdump}
```

**When migrating from the Docker image**, point `.blinko` at the existing host volume so you keep all uploads and plugins:

```bash
# example: the old docker-compose mounted ./blinko:/app/.blinko
ln -s /home/ubuntu/services/notes/blinko /opt/blinko/.blinko

# fix ownership if it came from a docker container running as a different uid
sudo chown -R $(id -u):$(id -g) /home/ubuntu/services/notes/blinko
```

`.blinko/` should be in `.gitignore` — it is user data, not source.

## 9. Run with systemd

Create `/etc/systemd/system/blinko.service`:

```ini
[Unit]
Description=Blinko (source build)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/blinko
EnvironmentFile=/opt/blinko/.env
Environment=PATH=/home/ubuntu/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/ubuntu/.bun/bin/bun dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Adjust `User`, `WorkingDirectory`, `EnvironmentFile`, and the `bun` path to match your install. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now blinko
sudo systemctl status blinko --no-pager
journalctl -u blinko -f          # live logs
```

A healthy boot ends with:

```
vite-express] Serving static files from /opt/blinko/server/public
🎉server start on port http://0.0.0.0:1111 - env: production
✨ Seed done! ✨
```

## 10. nginx (TLS reverse proxy)

Minimal config — terminate TLS, proxy to `localhost:1111`, allow large bodies for attachment uploads, forward upgrade headers for WebSocket / SSE:

```nginx
server {
    listen 80;
    server_name your.domain.tld;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your.domain.tld;

    ssl_certificate     /etc/letsencrypt/live/your.domain.tld/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain.tld/privkey.pem;

    client_max_body_size 128M;

    location / {
        proxy_pass http://localhost:1111;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Reload nginx (`sudo nginx -t && sudo systemctl reload nginx`) and verify:

```bash
curl -o /dev/null -w "%{http_code}\n" https://your.domain.tld/
curl https://your.domain.tld/api/v1/public/site-info
```

## 11. Updating

```bash
cd /opt/blinko
git pull
export PATH=$HOME/.bun/bin:$PATH
bun install                                                # if deps changed
bunx prisma migrate deploy --schema=prisma/schema.prisma   # if schema changed
bun run build:web
bun run build:seed
sudo systemctl restart blinko
```

The iOS / macOS Tauri shells load the frontend from your server (see `app/src/lib/blinkoEndpoint.ts`), so restarting the server is all that's needed for those clients to pick up the new build on their next launch / network call.

## 12. Migrating from the prebuilt Docker image

If you're switching from `blinkospace/blinko:latest`:

1. Stop only the app container; **leave Postgres running** so data isn't disturbed:

   ```bash
   docker stop blinko-website
   docker update --restart=no blinko-website   # don't let it come back on reboot
   ```

2. Follow sections 3–9 above. In section 4, point `DATABASE_URL` at the running Postgres container's host port (default `localhost:5435`). In section 8, symlink the existing `./blinko` host volume into the source checkout.

3. The first systemd start will apply any pending Prisma migrations against the existing DB. Verify with a row count:

   ```bash
   docker exec blinko-postgres psql -U postgres -d postgres -c "SELECT COUNT(*) FROM notes;"
   ```

4. **Rollback** (if you need to revert to the Docker image):

   ```bash
   sudo systemctl stop blinko
   sudo systemctl disable blinko
   docker update --restart=always blinko-website
   docker start blinko-website
   ```

## 13. Troubleshooting

| Symptom                                                          | Cause / Fix                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unable to find package manager binary` from `turbo`             | `~/.bun/bin` not on `$PATH`. `export PATH=$HOME/.bun/bin:$PATH` before running any `bun run …`. The systemd unit sets this explicitly via `Environment=PATH=`.    |
| `vite-express: Static files at .../server/public not found!`     | The `server/public` symlink is missing. Re-run section 6.                                                                                                         |
| Server logs `port http://0.0.0.0:1111` even though you set `PORT` | Port is hardcoded in `server/index.ts:93`. Edit there and rebuild if you need a different port.                                                                   |
| Uploads / plugins disappeared after switching to source          | `.blinko/` isn't pointing at the original host volume. Re-symlink as in section 8 and fix ownership.                                                              |
| `prisma migrate deploy` says `No pending migrations to apply.`   | Expected when reusing an existing DB that's already current.                                                                                                      |
| Permission denied writing into `.blinko/files/`                  | Container-era files are often owned by a different uid (e.g. `opc`). `sudo chown -R $(id -u):$(id -g) <data-dir>`.                                                |
