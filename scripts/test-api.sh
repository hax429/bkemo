#!/usr/bin/env bash
# Smoke-test every bkemo REST endpoint against the local dev server.
#
#   ./scripts/test-api.sh                 # tests http://localhost:1111
#   API_BASE=http://localhost:1111 ./scripts/test-api.sh
#
# Requires: the dev server running (bun run dev / ./debug.sh) and a populated
# DATABASE_URL in .env (used to mint a full-access token from the first account).
set -euo pipefail
cd "$(dirname "$0")/.."

# Load DATABASE_URL (and friends) from .env if present.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec bun scripts/test-api.ts
