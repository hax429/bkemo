#!/usr/bin/env bash
# Create real, rich memos/todos via the REST API and print the returned JSON.
# The created data is KEPT so you can see it on the Home page.
#
#   ./scripts/demo-api.sh
#   API_BASE=http://localhost:1111 ./scripts/demo-api.sh
#
# Requires the dev server running and DATABASE_URL in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec bun scripts/demo-api.ts
