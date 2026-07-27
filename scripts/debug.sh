#!/usr/bin/env bash
#
# debug.sh — one-command local full-stack for bkemo.
#
# Local PostgreSQL on :5433 is the default development data plane. The launcher
# uses an attached, auto-suspending Neon development branch only when the
# one-use integration-test attach marker exists; never attach production.
#
# Prefer ./scripts/run-dev.sh (PATH wrapper). Direct usage:
#   ./scripts/debug.sh          start everything on http://localhost:1111
#   ./scripts/debug.sh --stop   stop the local Postgres started by this script
#   ./scripts/debug.sh --reset  wipe & recreate local DB only (never for Neon)
#
# Login (created if a local DB has no accounts):  admin / 123456
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PG_PORT=5433
PG_USER=postgres
PG_PASS=postgres
PG_DB=bkemo
PGDATA="$ROOT/.bkemo-pg"
DOCKER_NAME=bkemo-pg
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}?schema=public"

c_blue() { printf "\033[1;34m%s\033[0m\n" "$1"; }
c_green() { printf "\033[1;32m%s\033[0m\n" "$1"; }
c_yellow() { printf "\033[1;33m%s\033[0m\n" "$1"; }
c_red() { printf "\033[1;31m%s\033[0m\n" "$1"; }
die() { c_red "✗ $1"; exit 1; }

USE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  USE_DOCKER=1
fi

# ---------------------------------------------------------------------------
# Postgres lifecycle
# ---------------------------------------------------------------------------
pg_bindir() {
  # Locate a Homebrew postgres keg's bin dir.
  for v in 17 16 15; do
    local p
    p="$(brew --prefix "postgresql@${v}" 2>/dev/null || true)"
    [ -n "$p" ] && [ -x "$p/bin/pg_ctl" ] && { echo "$p/bin"; return 0; }
  done
  return 1
}

start_pg_docker() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$DOCKER_NAME"; then
    docker start "$DOCKER_NAME" >/dev/null
  else
    c_blue "→ Starting Postgres (Docker, pgvector/pgvector:pg16) on :$PG_PORT"
    docker run -d --name "$DOCKER_NAME" \
      -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_USER="$PG_USER" -e POSTGRES_DB="$PG_DB" \
      -p "${PG_PORT}:5432" pgvector/pgvector:pg16 >/dev/null
  fi
  # wait for readiness
  for _ in $(seq 1 30); do
    if docker exec "$DOCKER_NAME" pg_isready -U "$PG_USER" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "Postgres (docker) did not become ready"
}

start_pg_brew() {
  command -v brew >/dev/null 2>&1 || die "No Docker and no Homebrew. Install one, or set DATABASE_URL and re-run."
  local bindir
  if ! bindir="$(pg_bindir)"; then
    c_yellow "→ Installing postgresql@16 via Homebrew (one-time, may take a few minutes)…"
    brew install postgresql@16
    bindir="$(pg_bindir)" || die "postgresql@16 install did not provide pg_ctl"
  fi
  export PATH="$bindir:$PATH"

  if [ ! -d "$PGDATA/base" ]; then
    c_blue "→ Initializing local Postgres cluster at .bkemo-pg (trust auth, dev only)"
    initdb -D "$PGDATA" -U "$PG_USER" --auth=trust >/dev/null
    echo "unix_socket_directories = '$PGDATA'" >> "$PGDATA/postgresql.conf"
  fi

  if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    c_blue "→ Starting Postgres (Homebrew) on :$PG_PORT"
    pg_ctl -D "$PGDATA" -o "-p $PG_PORT -k '$PGDATA'" -l "$PGDATA/server.log" -w start >/dev/null
  fi

  # ensure the role has the expected password and the db exists
  psql -h "$PGDATA" -p "$PG_PORT" -U "$PG_USER" -d postgres -tc \
    "ALTER ROLE ${PG_USER} WITH PASSWORD '${PG_PASS}';" >/dev/null 2>&1 || true
  if ! psql -h "$PGDATA" -p "$PG_PORT" -U "$PG_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
    createdb -h "$PGDATA" -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
  fi
}

stop_pg() {
  if [ "$USE_DOCKER" = "1" ] && docker ps --format '{{.Names}}' | grep -qx "$DOCKER_NAME"; then
    docker stop "$DOCKER_NAME" >/dev/null && c_green "✓ Stopped Postgres (docker)"
  elif [ -d "$PGDATA/base" ]; then
    local bindir; bindir="$(pg_bindir)" && export PATH="$bindir:$PATH"
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 && c_green "✓ Stopped Postgres (brew)" || c_yellow "Postgres not running"
  fi
}

drop_db() {
  c_yellow "→ Resetting database (wiping local data)…"
  if [ "$USE_DOCKER" = "1" ]; then
    docker exec "$DOCKER_NAME" psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS ${PG_DB};" >/dev/null 2>&1 || true
    docker exec "$DOCKER_NAME" psql -U "$PG_USER" -d postgres -c "CREATE DATABASE ${PG_DB};" >/dev/null 2>&1 || true
  else
    local bindir; bindir="$(pg_bindir)" && export PATH="$bindir:$PATH"
    dropdb -h "$PGDATA" -p "$PG_PORT" -U "$PG_USER" --if-exists "$PG_DB" >/dev/null 2>&1 || true
    createdb -h "$PGDATA" -p "$PG_PORT" -U "$PG_USER" "$PG_DB" >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------
case "${1:-}" in
  --stop) stop_pg; exit 0 ;;
  --reset) RESET=1 ;;
  "" ) RESET=0 ;;
  *) die "Unknown flag: $1 (use --stop or --reset)" ;;
esac

command -v bun >/dev/null 2>&1 || die "bun is required (https://bun.sh)"

# A remote Neon database is allowed only after the development-only attach
# workflow validates it and writes the consumed approval marker. Production
# migration remains a separate empty-destination flow.
REMOTE_NEON=0
if [ -f .env ]; then
  DB_KIND="$(bun --env-file ./.env -e 'try { const host = new URL(process.env.DATABASE_URL || "").hostname; console.log(host.endsWith(".neon.tech") ? "neon" : "local") } catch { console.log("local") }')"
  if [ "$DB_KIND" = "neon" ]; then
    [ -f .bkemo/dev-existing-neon-attach.json ] || die "Remote Neon was not configured through the one-use development attach workflow"
    [ "${BKEMO_DEV_USE_NEON:-false}" = "true" ] || die "Neon development is opt-in. Set BKEMO_DEV_USE_NEON=true for an explicit hosted integration test, or restore the local PostgreSQL DATABASE_URL"
    REMOTE_NEON=1
  fi
fi

# ---------------------------------------------------------------------------
# 1. Postgres
# ---------------------------------------------------------------------------
if [ "$REMOTE_NEON" = "1" ]; then
  [ "${RESET:-0}" = "0" ] || die "--reset is never allowed for an attached Neon development database"
  c_green "✓ Using the approved existing Neon development database"
else
  if [ "$USE_DOCKER" = "1" ]; then start_pg_docker; else start_pg_brew; fi
  [ "${RESET:-0}" = "1" ] && drop_db
  c_green "✓ Postgres ready on localhost:$PG_PORT (db=$PG_DB)"
fi

# ---------------------------------------------------------------------------
# 2. .env
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  c_blue "→ Writing .env"
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || bun -e 'console.log(crypto.randomBytes(32).toString("hex"))')"
  cat > .env <<EOF
# Generated by scripts/debug.sh — local development bootstrap
# Local PostgreSQL is the default. Hosted integration tests must explicitly set
# BKEMO_DEV_USE_NEON=true after attaching a non-production Neon branch.
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
NEXTAUTH_SECRET=${JWT_SECRET}
NEXTAUTH_URL=http://localhost:1111
NODE_ENV=development
EOF
else
  c_yellow "→ .env already exists — leaving it as-is (delete it to regenerate)"
fi

# ---------------------------------------------------------------------------
# 3. Dependencies + Prisma
# ---------------------------------------------------------------------------
need_install=0
[ -d node_modules ] || need_install=1
[ -x "$ROOT/node_modules/.bin/prisma" ] || need_install=1
if [ "$need_install" = "1" ]; then
  c_blue "→ bun install"
  bun install
fi
[ -x "$ROOT/node_modules/.bin/prisma" ] || die "prisma CLI missing after bun install (expected 5.22.0 in node_modules/.bin)"
export PATH="$ROOT/node_modules/.bin:$PATH"

c_blue "→ Prisma generate"
( cd prisma && prisma generate >/dev/null )

if [ "$REMOTE_NEON" = "1" ]; then
  DIRECT_DATABASE_URL="$(bun --env-file ./.env -e 'const url = new URL(process.env.DATABASE_URL); url.hostname = url.hostname.replace(/-pooler(?=\.)/i, ""); console.log(url.toString())')"
  c_blue "→ Prisma migrate deploy (approved Neon development branch, direct endpoint)"
  ( cd prisma && DATABASE_URL="$DIRECT_DATABASE_URL" prisma migrate deploy )
else
  c_blue "→ Prisma db push (applies task columns)"
  ( cd prisma && DATABASE_URL="$DATABASE_URL" prisma db push --skip-generate )
fi

# ---------------------------------------------------------------------------
# 4. Dev login
# ---------------------------------------------------------------------------
if [ "$REMOTE_NEON" = "1" ]; then
  c_green "✓ Keeping accounts from the existing Neon development database"
else
  c_blue "→ Ensuring dev login (admin / 123456)"
  bun --env-file ./.env scripts/dev-create-admin.ts || c_yellow "  (admin step skipped/failed — you can sign up in the UI)"
fi

# ---------------------------------------------------------------------------
# 5. Run the app (backend + frontend on :1111)
# ---------------------------------------------------------------------------
# Free port 1111 from any stale Vite/preview server.
if lsof -ti tcp:1111 >/dev/null 2>&1; then
  c_yellow "→ Port 1111 in use — stopping the previous process"
  lsof -ti tcp:1111 | xargs kill -9 >/dev/null 2>&1 || true
fi

c_green "──────────────────────────────────────────────"
c_green " bkemo is starting on  http://localhost:1111"
c_green " App:                  http://localhost:1111/"
if [ "$REMOTE_NEON" = "1" ]; then
  c_green " Database:             approved Neon development branch"
  c_green " Attachments:          configure Cloudflare R2 in Settings → Storage"
else
  c_green " Database:             local Postgres on :$PG_PORT (Neon attach available in UI)"
  c_green " Login:                admin / 123456"
  c_green " Stop local DB later:  ./scripts/run-dev.sh --stop"
fi
c_green "──────────────────────────────────────────────"

# Run the backend directly (it serves the frontend via vite-express on :1111).
# We bypass the root `dev:frontend` script because it relies on a `dotenv` +
# `turbo` wrapper that isn't reliably on PATH (a Python `dotenv` often shadows
# the Node dotenv-cli). The server's own dev script loads ../.env via bun's
# --env-file, so this is equivalent and dependency-free.
cd "$ROOT/server"
exec bun run dev
