#!/usr/bin/env bash
#
# run-dev.sh — launch the bkemo full-stack dev server.
#
# Thin wrapper around ./scripts/debug.sh that guarantees bun (and the common
# Homebrew bin dirs) are on PATH, since debug.sh requires `bun` but a
# non-login shell may not have ~/.bun/bin exported. Forwards any flags
# (e.g. --stop, --reset) straight through to debug.sh.
#
# Preferred data plane: Neon PostgreSQL + Cloudflare R2 (Settings → Storage).
# Without an approved Neon attach marker, debug.sh bootstraps local Postgres
# on :5433 so you can attach Neon and configure R2 from the running app.
#
#   ./scripts/run-dev.sh          start everything on http://localhost:1111
#   ./scripts/run-dev.sh --stop   stop the local Postgres (no-op for Neon)
#   ./scripts/run-dev.sh --reset  wipe & recreate local DB only (never for Neon)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure bun and Homebrew tools are reachable regardless of how this is invoked.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

exec "$SCRIPT_DIR/debug.sh" "$@"
