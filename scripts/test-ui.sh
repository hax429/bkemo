#!/usr/bin/env bash
#
# Unified UI test runner for web, Obsidian companion, and macOS shell.
#
# Usage:
#   ./scripts/test-ui.sh              # all fast lanes
#   ./scripts/test-ui.sh web
#   ./scripts/test-ui.sh obsidian
#   ./scripts/test-ui.sh mac
#   ./scripts/test-ui.sh web --e2e    # include Playwright browser smoke
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

TARGET="${1:-all}"
shift || true
RUN_E2E=0
for arg in "$@"; do
  case "$arg" in
    --e2e) RUN_E2E=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      printf 'error: unknown option %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

run_web() {
  printf '\n==> web UI (Vitest + Testing Library)\n'
  (cd "${REPO_ROOT}/app" && bunx vitest run)
  if [[ $RUN_E2E -eq 1 ]]; then
    printf '\n==> web UI browser smoke (Playwright)\n'
    (cd "${REPO_ROOT}/app" && bunx playwright test)
  fi
}

run_obsidian() {
  printf '\n==> Obsidian companion UI (node:test + happy-dom)\n'
  (cd "${REPO_ROOT}/out/obsidian" && bun run test:ui)
}

run_mac() {
  printf '\n==> macOS shell (cargo test) + shared React platform checks\n'
  if [[ "$(uname -s)" != "Darwin" ]]; then
    printf 'skip: macOS cargo lane requires Darwin\n'
  else
    # Keep artifacts under out/macos/target (same as builds) so the lane reuses caches.
    CARGO_TARGET_DIR="${REPO_ROOT}/out/macos/target" \
      cargo test --manifest-path "${REPO_ROOT}/out/macos/Cargo.toml" --lib
  fi
  # Shared React surface + Tauri platform header simulation
  (cd "${REPO_ROOT}/app" && bunx vitest run \
    src/lib/__tests__/bkemoPlatform.test.ts \
    src/components/bkemo/AccessTokenMisuseBanner.ui.test.tsx \
    src/components/bkemo/MobileTabBar.test.tsx)
}

case "$TARGET" in
  all)
    run_web
    run_obsidian
    run_mac
    ;;
  web) run_web ;;
  obsidian) run_obsidian ;;
  mac|macos) run_mac ;;
  *)
    printf 'error: target must be all|web|obsidian|mac\n' >&2
    exit 1
    ;;
esac

printf '\nUI test lanes finished (%s).\n' "$TARGET"
