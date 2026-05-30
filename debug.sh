#!/usr/bin/env bash
#
# debug.sh — one-command local full-stack for bkemo.
#
# Provisions a local Postgres (Docker if available, else Homebrew postgresql@16),
# writes .env, pushes the Prisma schema (incl. the new task columns), creates a
# dev login, and starts the backend + frontend on http://localhost:1111.
#
#   ./debug.sh          start everything (DB stays up, app runs in foreground)
#   ./debug.sh --stop   stop the local Postgres started by this script
#   ./debug.sh --reset  drop & recreate the database (wipes local data), then start
#
# Login (created if the DB has no accounts):  admin / 123456
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# ---------------------------------------------------------------------------
# 1. Postgres
# ---------------------------------------------------------------------------
if [ "$USE_DOCKER" = "1" ]; then start_pg_docker; else start_pg_brew; fi
[ "${RESET:-0}" = "1" ] && drop_db
c_green "✓ Postgres ready on localhost:$PG_PORT (db=$PG_DB)"

# ---------------------------------------------------------------------------
# 2. .env
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  c_blue "→ Writing .env"
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || bun -e 'console.log(crypto.randomBytes(32).toString("hex"))')"
  cat > .env <<EOF
# Generated by debug.sh — local development
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
[ -d node_modules ] || { c_blue "→ bun install"; bun install; }

c_blue "→ Prisma generate"
( cd prisma && bunx prisma generate >/dev/null )

c_blue "→ Prisma db push (applies task columns)"
( cd prisma && DATABASE_URL="$DATABASE_URL" bunx prisma db push --skip-generate )

# ---------------------------------------------------------------------------
# 4. Dev login
# ---------------------------------------------------------------------------
c_blue "→ Ensuring dev login (admin / 123456)"
bun --env-file ./.env scripts/dev-create-admin.ts || c_yellow "  (admin step skipped/failed — you can sign up in the UI)"

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
c_green " New UI:               http://localhost:1111/bkemo"
c_green " Login:                admin / 123456"
c_green " Stop DB later with:   ./debug.sh --stop"
c_green "──────────────────────────────────────────────"

# Run the backend directly (it serves the frontend via vite-express on :1111).
# We bypass the root `dev:frontend` script because it relies on a `dotenv` +
# `turbo` wrapper that isn't reliably on PATH (a Python `dotenv` often shadows
# the Node dotenv-cli). The server's own dev script loads ../.env via bun's
# --env-file, so this is equivalent and dependency-free.
cd "$ROOT/server"
exec bun run dev
