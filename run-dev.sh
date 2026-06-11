#!/usr/bin/env bash
#
# run-dev.sh — launch the bkemo full-stack dev server.
#
# Thin wrapper around ./debug.sh that guarantees bun (and the common
# Homebrew bin dirs) are on PATH, since debug.sh requires `bun` but a
# non-login shell may not have ~/.bun/bin exported. Forwards any flags
# (e.g. --stop, --reset) straight through to debug.sh.
#
#   ./run-dev.sh          start everything on http://localhost:1111
#   ./run-dev.sh --stop   stop the local Postgres
#   ./run-dev.sh --reset  wipe & recreate the database, then start
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure bun and Homebrew tools are reachable regardless of how this is invoked.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

exec "$ROOT/debug.sh" "$@"
