#!/usr/bin/env bash
#
# The como Obsidian plugin moved to its own repository.
# See https://github.com/hax429/como (local: ~/Developer/como).
#
set -euo pipefail

COMO_ROOT="${COMO_ROOT:-${HOME}/Developer/como}"
BUILD="${COMO_ROOT}/scripts/build.sh"

if [[ ! -x "$BUILD" ]]; then
  printf 'error: como build script not found at %s\n' "$BUILD" >&2
  printf 'Clone https://github.com/hax429/como or set COMO_ROOT.\n' >&2
  exit 1
fi

printf 'Delegating to %s\n' "$BUILD"
exec "$BUILD" "$@"
