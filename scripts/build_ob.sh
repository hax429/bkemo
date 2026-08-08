#!/usr/bin/env bash
#
# Build a publishable private Obsidian plugin for como (bkemo + Codian).
#
# Produces the three files Obsidian loads from a plugin folder, plus a zip
# suitable for manual / BRAT-style private install:
#   out/output/obsidian/como/{main.js,manifest.json,styles.css}
#   out/output/obsidian/como-<version>.zip
#
# Usage:
#   ./scripts/build_ob.sh
#   ./scripts/build_ob.sh --dev
#   ./scripts/build_ob.sh --clean
#   ./scripts/build_ob.sh --dev-origin http://localhost:1111
#   ./scripts/build_ob.sh --install ~/Vaults/Notes
#   ./scripts/build_ob.sh --install-primary
#   ./scripts/build_ob.sh --disposable
#   ./scripts/build_ob.sh --open
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/out/obsidian"
OUT_ROOT="${REPO_ROOT}/out/output/obsidian"
PLUGIN_ID="como"
STAGE_DIR="${OUT_ROOT}/${PLUGIN_ID}"
DISPOSABLE_PLUGIN_DIR="${PLUGIN_DIR}/.disposable-vault/.obsidian/plugins/${PLUGIN_ID}"
PRIMARY_VAULT="${HOME}/hax429"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CLEAN=0
OPEN_OUT=0
INSTALL_VAULT=""
INSTALL_PRIMARY=0
INSTALL_DISPOSABLE=0
DEV_ORIGIN=""
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Build a publishable private Obsidian plugin for como (bkemo + Codian).

Default production builds always target https://bk.hax429.me (no configurable
origin). Use --dev-origin only when you need a non-default local origin.
Every successful build increments the plugin patch version before packaging.

Options:
  --dev                   Localhost:1111 build; install into ~/hax429 and the
                          disposable vault (out/obsidian/.disposable-vault)
  --clean                 Remove previous out/output/obsidian before building
  --dev-origin <url>      Inject a local origin (e.g. http://localhost:1111)
  --install <vault>       Copy built files into <vault>/.obsidian/plugins/como
  --install-primary       Replace the como plugin in ~/hax429 and verify it
  --disposable            Also install into out/obsidian/.disposable-vault
  --skip-tests            Skip plugin unit tests before bundling
  --open                  Reveal the staged plugin folder after a successful build
  -h, --help              Show this help

Outputs:
  out/output/obsidian/como/main.js
  out/output/obsidian/como/manifest.json
  out/output/obsidian/como/styles.css
  out/output/obsidian/como-<version>.zip
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

bump_patch_version() {
  node -e '
    const fs = require("fs");
    const paths = process.argv.slice(1);
    const files = paths.map((path) => ({ path, data: JSON.parse(fs.readFileSync(path, "utf8")) }));
    const current = files[0].data.version;
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
    if (!match) throw new Error(`invalid plugin version: ${current}`);
    if (files.some(({ data }) => data.version !== current)) {
      throw new Error("manifest.json and package.json versions do not match");
    }
    const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
    for (const { path, data } of files) {
      data.version = next;
      fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    }
    process.stdout.write(next);
  ' "$1" "$2"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      DEV_ORIGIN="http://localhost:1111"
      INSTALL_PRIMARY=1
      INSTALL_DISPOSABLE=1
      ;;
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
    --install-primary) INSTALL_PRIMARY=1 ;;
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
command -v cmp >/dev/null 2>&1 || die "cmp is required"
[[ -f "${PLUGIN_DIR}/package.json" ]] || die "plugin package not found at ${PLUGIN_DIR}"
[[ -f "${PLUGIN_DIR}/manifest.json" ]] || die "manifest.json not found"
[[ -f "${PLUGIN_DIR}/styles.css" ]] || die "styles.css not found"
[[ -d "${PLUGIN_DIR}/src/codian" ]] || die "Codian sources missing at ${PLUGIN_DIR}/src/codian"

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
  printf 'Building Obsidian plugin for local origin %s...\n' "$DEV_ORIGIN"
  unset BKEMO_DEV_ORIGIN
  export BKEMO_DEV_ORIGIN="$DEV_ORIGIN"
else
  printf 'Building publishable Obsidian plugin for https://bk.hax429.me...\n'
  unset BKEMO_DEV_ORIGIN
fi

# Ensure a clean bundle artifact before production esbuild write.
rm -f "${PLUGIN_DIR}/main.js" "${PLUGIN_DIR}/main.js.map"
bun run build
[[ -f "${PLUGIN_DIR}/main.js" ]] || die "build completed but main.js was not produced"

VERSION="$(bump_patch_version "${PLUGIN_DIR}/manifest.json" "${PLUGIN_DIR}/package.json")"
[[ -n "$VERSION" ]] || die "could not increment plugin version"
ZIP_PATH="${OUT_ROOT}/${PLUGIN_ID}-${VERSION}.zip"
printf 'Incremented Obsidian plugin version to %s.\n' "$VERSION"

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
  [[ -d "${vault_path}/.obsidian" ]] || die "Obsidian config folder does not exist: ${vault_path}/.obsidian"
  mkdir -p "$target"
  for runtime_file in main.js manifest.json styles.css; do
    cp -f "${STAGE_DIR}/${runtime_file}" "${target}/${runtime_file}"
    cmp -s "${STAGE_DIR}/${runtime_file}" "${target}/${runtime_file}" \
      || die "installed ${runtime_file} does not match the published build"
  done
  printf 'Installed and verified in %s\n' "$target"
}

install_primary_vault() {
  install_into_vault "$PRIMARY_VAULT"
}

if [[ -n "$INSTALL_VAULT" ]]; then
  install_into_vault "$INSTALL_VAULT"
fi

if [[ $INSTALL_PRIMARY -eq 1 ]]; then
  install_primary_vault
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
printf '  1. Copy out/output/obsidian/como/* into <vault>/.obsidian/plugins/como/\n'
printf '  2. Or: unzip %s -d <vault>/.obsidian/plugins/\n' "$(basename "$ZIP_PATH")"
printf '  3. Enable “como” in Obsidian → Settings → Community plugins\n'
printf '  4. Dev build (localhost + primary vault + disposable): ./scripts/build_ob.sh --dev\n'
printf '  5. Production primary install: ./scripts/build_ob.sh --install-primary\n'
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
