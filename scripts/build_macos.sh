#!/usr/bin/env bash
#
# Build the bkemo Tauri client as a macOS .app bundle.
#
# Usage:
#   ./scripts/build_macos.sh
#   ./scripts/build_macos.sh --clean
#   ./scripts/build_macos.sh --dmg
#   ./scripts/build_macos.sh --open
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/app"
TAURI_DIR="${APP_DIR}/src-tauri"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CLEAN=0
INCLUDE_DMG=0
OPEN_APP=0

usage() {
  cat <<'EOF'
Build the bkemo macOS Tauri app.

Options:
  --clean  Run cargo clean before building
  --dmg    Build both the .app bundle and a DMG
  --open   Open the built app after a successful build
  -h, --help
           Show this help
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) CLEAN=1 ;;
    --dmg) INCLUDE_DMG=1 ;;
    --open) OPEN_APP=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[[ "$(uname -s)" == "Darwin" ]] || die "macOS is required"
command -v bun >/dev/null 2>&1 || die "bun is required (https://bun.sh)"
command -v cargo >/dev/null 2>&1 || die "Rust/Cargo is required (https://rustup.rs)"
[[ -f "${TAURI_DIR}/tauri.conf.json" ]] || die "Tauri config not found"

if [[ $CLEAN -eq 1 ]]; then
  printf 'Cleaning Tauri build artifacts...\n'
  cargo clean --manifest-path "${TAURI_DIR}/Cargo.toml"
fi

BUNDLES="app"
if [[ $INCLUDE_DMG -eq 1 ]]; then
  BUNDLES="app,dmg"
fi

printf 'Building bkemo for macOS (%s)...\n' "$BUNDLES"
cd "$APP_DIR"
bun run tauri build --bundles "$BUNDLES"

TARGET_DIR="${CARGO_TARGET_DIR:-${TAURI_DIR}/target}"
APP_BUNDLE="${TARGET_DIR}/release/bundle/macos/bkemo.app"

[[ -d "$APP_BUNDLE" ]] || die "build completed but app bundle was not found at ${APP_BUNDLE}"
printf '\nBuilt: %s\n' "$APP_BUNDLE"

if [[ $INCLUDE_DMG -eq 1 ]]; then
  printf 'DMG directory: %s\n' "${TARGET_DIR}/release/bundle/dmg"
fi

if [[ $OPEN_APP -eq 1 ]]; then
  open "$APP_BUNDLE"
fi
