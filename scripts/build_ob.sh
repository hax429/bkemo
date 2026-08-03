#!/usr/bin/env bash
#
# Build a publishable private Obsidian plugin for bkemo.
#
# Produces the three files Obsidian loads from a plugin folder, plus a zip
# suitable for manual / BRAT-style private install:
#   dist/obsidian/bkemo/{main.js,manifest.json,styles.css}
#   dist/obsidian/bkemo-<version>.zip
#
# Usage:
#   ./scripts/build_ob.sh
#   ./scripts/build_ob.sh --clean
#   ./scripts/build_ob.sh --dev-origin http://localhost:1111
#   ./scripts/build_ob.sh --install ~/Vaults/Notes
#   ./scripts/build_ob.sh --disposable
#   ./scripts/build_ob.sh --open
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/integrations/obsidian"
OUT_ROOT="${REPO_ROOT}/dist/obsidian"
PLUGIN_ID="bkemo"
STAGE_DIR="${OUT_ROOT}/${PLUGIN_ID}"
DISPOSABLE_PLUGIN_DIR="${PLUGIN_DIR}/.disposable-vault/.obsidian/plugins/${PLUGIN_ID}"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CLEAN=0
OPEN_OUT=0
INSTALL_VAULT=""
INSTALL_DISPOSABLE=0
DEV_ORIGIN=""
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Build a publishable private Obsidian plugin for bkemo.

Default production builds always target https://bk.hax429.me (no configurable
origin). Use --dev-origin only for disposable local testing.

Options:
  --clean                 Remove previous dist/obsidian output before building
  --dev-origin <url>      Inject a local origin (e.g. http://localhost:1111)
  --install <vault>       Copy built files into <vault>/.obsidian/plugins/bkemo
  --disposable            Also install into integrations/obsidian/.disposable-vault
  --skip-tests            Skip plugin unit tests before bundling
  --open                  Reveal the staged plugin folder after a successful build
  -h, --help              Show this help

Outputs:
  dist/obsidian/bkemo/main.js
  dist/obsidian/bkemo/manifest.json
  dist/obsidian/bkemo/styles.css
  dist/obsidian/bkemo-<version>.zip
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) CLEAN=1 ;;
    --dev-origin)
      [[ $# -ge 2 ]] || die "--dev-origin requires a URL"
      DEV_ORIGIN="$2"
      shift
      ;;
    --install)
      [[ $# -ge 2 ]] || die "--install requires a vault path"
      INSTALL_VAULT="$2"
      shift
      ;;
    --disposable) INSTALL_DISPOSABLE=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --open) OPEN_OUT=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

command -v bun >/dev/null 2>&1 || die "bun is required (https://bun.sh)"
command -v node >/dev/null 2>&1 || die "node is required"
command -v zip >/dev/null 2>&1 || die "zip is required"
[[ -f "${PLUGIN_DIR}/package.json" ]] || die "plugin package not found at ${PLUGIN_DIR}"
[[ -f "${PLUGIN_DIR}/manifest.json" ]] || die "manifest.json not found"
[[ -f "${PLUGIN_DIR}/styles.css" ]] || die "styles.css not found"

VERSION="$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(m.version);" "${PLUGIN_DIR}/manifest.json")"
[[ -n "$VERSION" ]] || die "could not read plugin version from manifest.json"
ZIP_PATH="${OUT_ROOT}/${PLUGIN_ID}-${VERSION}.zip"

if [[ $CLEAN -eq 1 ]]; then
  printf 'Cleaning %s...\n' "$OUT_ROOT"
  rm -rf "$OUT_ROOT"
fi

mkdir -p "$STAGE_DIR"

printf 'Installing plugin dependencies...\n'
cd "$PLUGIN_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install

if [[ $SKIP_TESTS -eq 0 ]]; then
  printf 'Running plugin tests...\n'
  bun run test
fi

if [[ -n "$DEV_ORIGIN" ]]; then
  printf 'Building Obsidian plugin v%s for local origin %s...\n' "$VERSION" "$DEV_ORIGIN"
  unset BKEMO_DEV_ORIGIN
  export BKEMO_DEV_ORIGIN="$DEV_ORIGIN"
else
  printf 'Building publishable Obsidian plugin v%s (origin https://bk.hax429.me)...\n' "$VERSION"
  unset BKEMO_DEV_ORIGIN
fi

# Ensure a clean bundle artifact before production esbuild write.
rm -f "${PLUGIN_DIR}/main.js" "${PLUGIN_DIR}/main.js.map"
bun run build
[[ -f "${PLUGIN_DIR}/main.js" ]] || die "build completed but main.js was not produced"

# Stage the three files Obsidian expects for private installs / releases.
cp "${PLUGIN_DIR}/main.js" "${STAGE_DIR}/main.js"
cp "${PLUGIN_DIR}/manifest.json" "${STAGE_DIR}/manifest.json"
cp "${PLUGIN_DIR}/styles.css" "${STAGE_DIR}/styles.css"

# Fail closed if a production package still embeds a non-empty local origin override.
if [[ -z "$DEV_ORIGIN" ]] && grep -q 'localhost:1111' "${STAGE_DIR}/main.js"; then
  die "publishable build unexpectedly contains localhost:1111; refuse to package"
fi

rm -f "$ZIP_PATH"
(
  cd "$OUT_ROOT"
  zip -q -r "$(basename "$ZIP_PATH")" "$PLUGIN_ID"
)

install_into_vault() {
  local vault_path="$1"
  local target="${vault_path}/.obsidian/plugins/${PLUGIN_ID}"
  [[ -d "$vault_path" ]] || die "vault path does not exist: ${vault_path}"
  mkdir -p "$target"
  cp "${STAGE_DIR}/main.js" "${STAGE_DIR}/manifest.json" "${STAGE_DIR}/styles.css" "$target/"
  printf 'Installed into %s\n' "$target"
}

if [[ -n "$INSTALL_VAULT" ]]; then
  install_into_vault "$INSTALL_VAULT"
fi

if [[ $INSTALL_DISPOSABLE -eq 1 ]]; then
  mkdir -p "$DISPOSABLE_PLUGIN_DIR"
  cp "${STAGE_DIR}/main.js" "${STAGE_DIR}/manifest.json" "${STAGE_DIR}/styles.css" "$DISPOSABLE_PLUGIN_DIR/"
  printf 'Installed into disposable vault plugin folder:\n  %s\n' "$DISPOSABLE_PLUGIN_DIR"
fi

printf '\nPublishable Obsidian plugin ready:\n'
printf '  folder: %s\n' "$STAGE_DIR"
printf '  zip:    %s\n' "$ZIP_PATH"
printf '\nPrivate install:\n'
printf '  1. Copy dist/obsidian/bkemo/* into <vault>/.obsidian/plugins/bkemo/\n'
printf '  2. Or: unzip %s -d <vault>/.obsidian/plugins/\n' "$(basename "$ZIP_PATH")"
printf '  3. Enable “bkemo” in Obsidian → Settings → Community plugins\n'
if [[ -n "$DEV_ORIGIN" ]]; then
  printf '\nNote: this build is NOT production-publishable; it targets %s\n' "$DEV_ORIGIN"
fi

if [[ $OPEN_OUT -eq 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$STAGE_DIR"
  else
    printf 'open is unavailable; staged folder is %s\n' "$STAGE_DIR"
  fi
fi
