#!/usr/bin/env bash
# build_ios.sh — iOS build prep + launch + offline-simulation helper for Blinko (Phase 4.5).
#
# Subcommands:
#   build                          (default)  prepare a device build, or run end-to-end sim build with --sim.
#   offline on [method]            block bk.hax429.me to simulate offline. Methods: pfctl (default, hang) | hosts (fast-fail).
#   offline off                    restore network (clears every method; safe to run idempotently).
#   offline status                 show which blocking methods are currently active.
#
# Build mode (default subcommand):
#   ./build_ios.sh                 device build prep. Opens Xcode at the end; sign + ⌘R yourself.
#   ./build_ios.sh --sim           simulator end-to-end: builds, installs, launches on iPhone 17 Pro.
#
# Build flags:
#   --clean                        wipe app/src-tauri/target/ first
#   --skip-web                     skip the Vite frontend bundle
#   --xcodegen                     also re-run `xcodegen generate`
#   --sim-device <name>            override the simulator (default: "iPhone 17 Pro")
#
# Offline-simulation methods:
#   pfctl    (default)             silently drops TCP/UDP to bk.hax429.me's resolved IP. Hang ≈ TCP timeout (matches iPhone airplane mode).
#   hosts                          maps bk.hax429.me → 127.0.0.1 in /etc/hosts. Fails fast.
#   loss                           reminds you to enable Network Link Conditioner 100% Loss (Apple's tool; manual GUI step).
#   wifi                           turns off the Mac's Wi-Fi via `networksetup`. Nuclear.
#
# Examples:
#   ./build_ios.sh --sim                       # build + launch on sim
#   ./build_ios.sh offline on                  # pfctl block (best for repro)
#   ./build_ios.sh offline on hosts            # /etc/hosts block (fail-fast variant)
#   ./build_ios.sh offline status              # show current state
#   ./build_ios.sh offline off                 # restore everything

set -euo pipefail

# ── Repo paths ────────────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"
APP_DIR="${REPO_ROOT}/app"
TAURI_DIR="${APP_DIR}/src-tauri"
DIST_DIR="${REPO_ROOT}/dist/public"
XCODEPROJ="${TAURI_DIR}/gen/apple/Blinko.xcodeproj"
BUNDLE_ID="me.hax429.blinko"
SCHEME="Blinko_iOS"
TARGET_HOST="bk.hax429.me"
PF_RULES_FILE="/tmp/blinko-offline.pf.conf"
PF_STATE_FILE="/tmp/blinko-offline.pf-was"   # contents: "enabled" or "disabled"
PF_MARKER="# === Blinko offline block ==="
WIFI_STATE_FILE="/tmp/blinko-offline-wifi.was-on"

# ── Colors / logging ──────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi
step()    { printf '\n%s▶ %s%s\n' "${BLUE}${BOLD}" "$1" "${RESET}"; }
info()    { printf '%s  %s%s\n' "${DIM}" "$1" "${RESET}"; }
ok()      { printf '%s✓ %s%s\n' "${GREEN}" "$1" "${RESET}"; }
warn()    { printf '%s! %s%s\n' "${YELLOW}" "$1" "${RESET}"; }
die()     { printf '%s✗ %s%s\n' "${RED}${BOLD}" "$1" "${RESET}" >&2; exit 1; }
elapsed() { printf '%s   (%ss)%s\n' "${DIM}" "$1" "${RESET}"; }

# ── Offline helpers ──────────────────────────────────────────────────────────────────────────────
relaunch_sim_app() {
  # Force the WKWebView to drop its connection cache by terminating + relaunching the app on the booted simulator.
  local udid
  udid=$(xcrun simctl list devices booted 2>/dev/null | grep -E '\([0-9A-F-]{36}\) \(Booted\)' | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' || true)
  if [[ -z "$udid" ]]; then
    info "No booted simulator detected; skipping relaunch."
    return
  fi
  if xcrun simctl listapps "$udid" 2>/dev/null | grep -q "$BUNDLE_ID"; then
    xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || warn "Could not relaunch app on $udid"
    ok "Relaunched ${BUNDLE_ID} on $udid"
  else
    info "${BUNDLE_ID} not installed on booted sim; skipping relaunch."
  fi
}

offline_status() {
  step "Offline blocking status for ${TARGET_HOST}"

  # hosts
  if grep -E "^[^#]*\b${TARGET_HOST}\b" /etc/hosts >/dev/null 2>&1; then
    printf '  %shosts:   ACTIVE%s — ' "${YELLOW}${BOLD}" "${RESET}"
    grep -E "\b${TARGET_HOST}\b" /etc/hosts | head -1
  else
    printf '  %shosts:   off%s\n' "${DIM}" "${RESET}"
  fi

  # pfctl — primary signal is our state file. Then probe pf without prompting.
  if [[ -f "$PF_STATE_FILE" ]]; then
    printf '  %spfctl:   ACTIVE%s (pre-block was: %s)\n' "${YELLOW}${BOLD}" "${RESET}" "$(cat "$PF_STATE_FILE" 2>/dev/null || echo unknown)"
    if sudo -n pfctl -sr 2>/dev/null | grep -q '^block drop quick'; then
      info "Confirmed: 'block drop quick' rules loaded in the main ruleset."
    else
      info "(run 'sudo pfctl -sr' to confirm the rules are loaded — sudo cache empty)"
    fi
  else
    printf '  %spfctl:   off%s\n' "${DIM}" "${RESET}"
  fi

  # wifi state
  local wifi
  wifi=$(networksetup -getairportpower en0 2>/dev/null | awk -F': ' '{print $2}')
  if [[ "$wifi" == "Off" ]]; then
    printf '  %swifi:    OFF%s\n' "${YELLOW}${BOLD}" "${RESET}"
  else
    printf '  %swifi:    on%s\n' "${DIM}" "${RESET}"
  fi

  # live DNS check (proves what the OS resolver returns)
  printf '  %sresolves to:%s %s\n' "${DIM}" "${RESET}" "$(dig +short +time=2 +tries=1 "$TARGET_HOST" 2>/dev/null | tr '\n' ' ' || echo '(unresolved)')"
}

offline_on_hosts() {
  step "Enabling offline via /etc/hosts (fail-fast)"
  if grep -E "^[^#]*\b${TARGET_HOST}\b" /etc/hosts >/dev/null 2>&1; then
    warn "${TARGET_HOST} is already in /etc/hosts. Skipping write."
  else
    echo "127.0.0.1 ${TARGET_HOST}" | sudo tee -a /etc/hosts >/dev/null
    ok "Added '127.0.0.1 ${TARGET_HOST}' to /etc/hosts"
  fi
  sudo dscacheutil -flushcache
  sudo killall -HUP mDNSResponder 2>/dev/null || true
  ok "DNS cache flushed"
  relaunch_sim_app
  printf '\n%sTest:%s curl -m 3 https://%s/api/auth/profile  → expect cert error or connect refused (fast)\n' "${BLUE}" "${RESET}" "$TARGET_HOST"
}

offline_on_pfctl() {
  step "Enabling offline via pfctl packet drop (matches iPhone airplane mode hang)"
  command -v dig >/dev/null || die "dig not found. brew install bind"
  local ips
  ips=$(dig +short "$TARGET_HOST" | grep -E '^[0-9.]+$')
  [[ -n "$ips" ]] || die "Could not resolve $TARGET_HOST. Are you already offline?"
  info "Resolved IPs:"
  echo "$ips" | sed 's/^/    /'

  # macOS pf evaluates only the rules in its current main ruleset. Anchors must be referenced from
  # /etc/pf.conf to take effect, and the default /etc/pf.conf doesn't include arbitrary anchors.
  # So we synthesize a temporary ruleset = the contents of /etc/pf.conf + our block rules appended,
  # and load that as the active ruleset. On `offline off` we reload the on-disk /etc/pf.conf to restore.
  # NOTE: pf requires strict ordering — options, scrub, queue, translation (nat/rdr), then filter
  # (block/pass) last. /etc/pf.conf contains scrub-anchor / nat-anchor / rdr-anchor lines, so our
  # filter rules MUST come after pf.conf's contents, not before.
  {
    cat /etc/pf.conf
    echo ""
    echo "$PF_MARKER"
    for ip in $ips; do
      echo "block drop quick out proto tcp to $ip"
      echo "block drop quick out proto udp to $ip"
    done
  } | sudo tee "$PF_RULES_FILE" >/dev/null
  info "Synthesized ruleset at $PF_RULES_FILE"

  # Remember pf's pre-block enabled state so we can restore it.
  if sudo pfctl -si 2>&1 | grep -q '^Status: Enabled'; then
    echo "enabled" | sudo tee "$PF_STATE_FILE" >/dev/null
    info "pf was: enabled"
  else
    echo "disabled" | sudo tee "$PF_STATE_FILE" >/dev/null
    info "pf was: disabled"
  fi

  # Load + enable.
  sudo pfctl -f "$PF_RULES_FILE"
  sudo pfctl -E 2>/dev/null || true  # idempotent-ish; logs "pf already enabled" if so
  ok "pf ruleset replaced with synthesized blocks"

  # Sanity check: confirm our rules are loaded.
  if sudo pfctl -sr 2>/dev/null | grep -q '^block drop quick out'; then
    ok "Verified: 'block drop quick out' rules present in active ruleset"
  else
    warn "pf reports loaded but no block rules visible. Try: sudo pfctl -sr"
  fi

  relaunch_sim_app
  printf '\n%sTest:%s curl -m 5 https://%s/api/auth/profile  → expect hang until -m timeout fires\n' "${BLUE}" "${RESET}" "$TARGET_HOST"
}

offline_on_loss() {
  step "Network Link Conditioner — 100%% Loss (manual)"
  if [[ -d "/Library/PreferencePanes/Network Link Conditioner.prefPane" ]] || [[ -d "$HOME/Library/PreferencePanes/Network Link Conditioner.prefPane" ]]; then
    ok "Network Link Conditioner is installed"
    info "Open System Settings → Network Link Conditioner → ON, Profile = '100% Loss'"
    open "/System/Library/PreferencePanes/" 2>/dev/null || true
  else
    warn "Not installed. Download 'Additional Tools for Xcode' from developer.apple.com/download/all/"
    info "Then install Network Link Conditioner.prefPane from the package."
  fi
  info "This is system-wide and survives across runs. Disable in the same pane when done."
}

offline_on_wifi() {
  step "Disabling Wi-Fi (nuclear)"
  local current
  current=$(networksetup -getairportpower en0 2>/dev/null | awk -F': ' '{print $2}')
  if [[ "$current" == "On" ]]; then
    touch "$WIFI_STATE_FILE"
    sudo networksetup -setairportpower en0 off
    ok "Wi-Fi off (state saved to $WIFI_STATE_FILE)"
  else
    warn "Wi-Fi was already off; not touching state"
  fi
  relaunch_sim_app
}

offline_off() {
  step "Restoring network (clearing every method)"

  # hosts
  if grep -E "^[^#]*\b${TARGET_HOST}\b" /etc/hosts >/dev/null 2>&1; then
    sudo sed -i '' "/[[:space:]]${TARGET_HOST}\$/d" /etc/hosts
    sudo sed -i '' "/[[:space:]]${TARGET_HOST}[[:space:]]/d" /etc/hosts
    ok "/etc/hosts cleared"
  else
    info "/etc/hosts: no entry"
  fi
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true

  # pfctl — reload the on-disk pf.conf to wipe our synthesized rules, then restore the pre-block enabled state.
  if [[ -f "$PF_STATE_FILE" ]]; then
    sudo pfctl -f /etc/pf.conf 2>&1 | sed 's/^/    /'
    ok "Default /etc/pf.conf reloaded"
    local prev
    prev=$(cat "$PF_STATE_FILE" 2>/dev/null || echo unknown)
    if [[ "$prev" == "disabled" ]]; then
      sudo pfctl -d 2>/dev/null || true
      ok "pf disabled (restored pre-block state)"
    else
      info "pf left enabled (was enabled before block)"
    fi
    sudo rm -f "$PF_STATE_FILE" "$PF_RULES_FILE"
  else
    info "pfctl: no state file — block was not active (or was cleared externally)"
  fi

  # wifi (only re-enable if we turned it off)
  if [[ -f "$WIFI_STATE_FILE" ]]; then
    sudo networksetup -setairportpower en0 on
    rm -f "$WIFI_STATE_FILE"
    ok "Wi-Fi re-enabled (was disabled by us)"
  else
    info "Wi-Fi: not touched (we didn't disable it)"
  fi

  # Network Link Conditioner: cannot script — remind only.
  info "Network Link Conditioner: turn off manually in System Settings if you enabled it."

  relaunch_sim_app
  offline_status
}

handle_offline() {
  local action="${1:-status}"
  shift || true
  case "$action" in
    on)
      local method="${1:-pfctl}"
      case "$method" in
        pfctl) offline_on_pfctl ;;
        hosts) offline_on_hosts ;;
        loss)  offline_on_loss  ;;
        wifi)  offline_on_wifi  ;;
        *)     die "Unknown offline method: $method (use pfctl|hosts|loss|wifi)" ;;
      esac
      ;;
    off)    offline_off    ;;
    status) offline_status ;;
    *)      die "Unknown offline action: $action (use on|off|status)" ;;
  esac
}

# ── Subcommand dispatch ──────────────────────────────────────────────────────────────────────────
SUBCMD="build"
if [[ $# -gt 0 ]] && [[ "$1" != --* ]] && [[ "$1" != "-h" ]]; then
  SUBCMD="$1"
  shift
fi

case "$SUBCMD" in
  build) ;;  # fall through to existing build logic below
  offline)
    handle_offline "$@"
    exit 0
    ;;
  *)
    die "Unknown subcommand: $SUBCMD (use 'build' or 'offline'; run with -h for help)"
    ;;
esac

# ── Build flags ──────────────────────────────────────────────────────────────────────────────────
MODE="device"
CLEAN=0
SKIP_WEB=0
RUN_XCODEGEN=0
SIM_DEVICE="iPhone 17 Pro"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sim)         MODE="sim" ;;
    --clean)       CLEAN=1 ;;
    --skip-web)    SKIP_WEB=1 ;;
    --xcodegen)    RUN_XCODEGEN=1 ;;
    --sim-device)  SIM_DEVICE="${2:?--sim-device needs a value}"; shift ;;
    -h|--help)     sed -n '2,32p' "$0"; exit 0 ;;
    *)             echo "Unknown flag: $1" >&2; exit 64 ;;
  esac
  shift
done

# ── Per-mode build settings ──────────────────────────────────────────────────────────────────────
HOST_ARCH=$(uname -m)
if [[ "$MODE" == "sim" ]]; then
  if [[ "$HOST_ARCH" == "arm64" ]]; then
    RUST_TARGET="aarch64-apple-ios-sim"
    EXTERNALS_ARCH="arm64"
  else
    RUST_TARGET="x86_64-apple-ios"
    EXTERNALS_ARCH="x86_64"
  fi
  SDK="iphonesimulator"
  XCODE_DESTINATION="platform=iOS Simulator,name=${SIM_DEVICE}"
else
  RUST_TARGET="aarch64-apple-ios"
  EXTERNALS_ARCH="arm64"
  SDK="iphoneos"
  XCODE_DESTINATION=""
fi
RUST_OUT="${TAURI_DIR}/target/${RUST_TARGET}/release/libapp_lib.a"
XCODE_LIB="${TAURI_DIR}/gen/apple/Externals/${EXTERNALS_ARCH}/release/libapp.a"

# ── PATH bootstrap ───────────────────────────────────────────────────────────────────────────────
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"

# ── Diagnostics ──────────────────────────────────────────────────────────────────────────────────
step "Environment (mode: ${MODE})"
info "Repo:         ${REPO_ROOT}"
info "Host arch:    ${HOST_ARCH}"
info "Rust target:  ${RUST_TARGET}"
info "Externals:    Externals/${EXTERNALS_ARCH}/release/libapp.a"
[[ "$MODE" == "sim" ]] && info "Sim device:   ${SIM_DEVICE}"
command -v bun     >/dev/null || die "bun not found"
command -v cargo   >/dev/null || die "cargo not found"
command -v xcrun   >/dev/null || die "xcrun not found"
info "bun:          $(bun --version)"
info "cargo:        $(cargo --version | awk '{print $2}')"
info "xcode-select: $(xcode-select -p)"
SDKROOT="$(xcrun -sdk "$SDK" --show-sdk-path 2>/dev/null || true)"
[[ -n "$SDKROOT" ]] || die "Could not resolve $SDK SDK. Run: sudo xcode-select -s /Applications/Xcode.app"
info "$SDK SDK:     ${SDKROOT}"
rustup target list --installed 2>/dev/null | grep -q "^${RUST_TARGET}$" \
  || die "Rust target ${RUST_TARGET} not installed. Run: rustup target add ${RUST_TARGET}"
ok "Environment OK"

# ── --clean ──────────────────────────────────────────────────────────────────────────────────────
if [[ $CLEAN -eq 1 ]]; then
  step "Cleaning Rust target dir"
  rm -rf "${TAURI_DIR}/target"
  ok "Clean done. Next build will be ~90s."
fi

# ── Detect mode swap (device↔sim share Externals/arm64/release/libapp.a on Apple Silicon) ────────
if [[ -f "$XCODE_LIB" ]] && [[ "$EXTERNALS_ARCH" == "arm64" ]]; then
  current_arch_info=$(file "$XCODE_LIB" 2>/dev/null || true)
  if [[ "$MODE" == "sim" ]] && ! echo "$current_arch_info" | grep -q "simulator"; then
    warn "Externals/arm64/release/libapp.a appears to be a device build. Overwriting with sim build."
  elif [[ "$MODE" == "device" ]] && echo "$current_arch_info" | grep -q "simulator"; then
    warn "Externals/arm64/release/libapp.a appears to be a sim build. Overwriting with device build."
  fi
fi

# ── Step 0: frontend bundle ──────────────────────────────────────────────────────────────────────
if [[ $SKIP_WEB -eq 0 ]]; then
  step "Step 0 — Frontend bundle (vite → dist/public)"
  t0=$(date +%s)
  cd "$APP_DIR"
  bun run build:no-pwa
  t=$(( $(date +%s) - t0 ))
  [[ -f "${DIST_DIR}/index.html" ]] || die "Build finished but ${DIST_DIR}/index.html is missing"
  ok "dist/public ready ($(du -sk "${DIST_DIR}" | awk '{print $1}')KB)"
  elapsed "$t"
else
  step "Step 0 — Frontend bundle (skipped via --skip-web)"
  [[ -f "${DIST_DIR}/index.html" ]] || warn "${DIST_DIR}/index.html missing — packaged shell will be blank."
fi

# ── Step 1: cargo build ──────────────────────────────────────────────────────────────────────────
step "Step 1 — cargo build --target ${RUST_TARGET} --release --features custom-protocol"
t0=$(date +%s)
cd "$TAURI_DIR"
# --features custom-protocol is REQUIRED for production iOS builds.
# Without it, tauri-build sets cfg(dev) and the WKWebView loads `devUrl` (remote) instead of
# `frontendDist` (tauri://localhost) — even with --release. See IOS.md §6.7.
SDKROOT="$SDKROOT" IPHONEOS_DEPLOYMENT_TARGET=14.0 \
  cargo build --target "$RUST_TARGET" --release --features custom-protocol
t=$(( $(date +%s) - t0 ))
[[ -f "$RUST_OUT" ]] || die "cargo finished but $RUST_OUT is missing"
ok "libapp_lib.a built"
elapsed "$t"

# ── Step 2: copy library ─────────────────────────────────────────────────────────────────────────
step "Step 2 — Copy libapp_lib.a → libapp.a"
mkdir -p "$(dirname "$XCODE_LIB")"
cp "$RUST_OUT" "$XCODE_LIB"
src_sha=$(shasum -a 256 "$RUST_OUT" | awk '{print $1}')
dst_sha=$(shasum -a 256 "$XCODE_LIB" | awk '{print $1}')
[[ "$src_sha" == "$dst_sha" ]] || die "Copy verification failed: hashes differ"
info "sha256: ${src_sha:0:16}…"
ok "Library installed at $XCODE_LIB"

# ── Step 2.5: refresh bundled web assets ────────────────────────────────────────────────────────
# Tauri's Xcode pre-build script tries to copy dist/public → gen/apple/assets/ but it
# silently fails if its embedded path is stale (we hit this after the blinko → blinkos
# rename). Doing it here explicitly means the .ipa never ships a stale shell again.
step "Step 2.5 — Refresh gen/apple/assets/ from dist/public"
ASSETS_DST="${TAURI_DIR}/gen/apple/assets"
if [[ -f "${DIST_DIR}/index.html" ]]; then
  rm -rf "$ASSETS_DST"
  mkdir -p "$ASSETS_DST"
  cp -r "${DIST_DIR}/." "$ASSETS_DST/"
  bundled_chunk=$(grep -oE 'src="/?assets/index-[A-Za-z0-9_-]+\.js"' "$ASSETS_DST/index.html" | head -1)
  info "Bundled shell: $bundled_chunk"
  ok "Assets refreshed ($(du -sk "$ASSETS_DST" | awk '{print $1}')KB)"
else
  warn "${DIST_DIR}/index.html missing — skipping asset refresh. .ipa will ship a stale shell."
fi

# ── Step 3 (optional): xcodegen ─────────────────────────────────────────────────────────────────
if [[ $RUN_XCODEGEN -eq 1 ]]; then
  step "Step 3 — xcodegen generate"
  command -v xcodegen >/dev/null || die "xcodegen not found. brew install xcodegen"
  cd "${TAURI_DIR}/gen/apple"
  xcodegen generate
  ok "Xcode project regenerated"
fi

# ── Device mode: stop here, user opens Xcode ────────────────────────────────────────────────────
if [[ "$MODE" == "device" ]]; then
  step "Done — ready for Xcode"
  info "  open ${XCODEPROJ}"
  info "  → scheme ${SCHEME}, destination = your iPhone"
  info "  → Edit Scheme → Run → Build Configuration → release"
  info "  → ⌘R (Xcode signs + installs + launches)"
  exit 0
fi

# ── Simulator mode: boot → build → install → launch ─────────────────────────────────────────────
step "Step 4 — Boot ${SIM_DEVICE} simulator"
sim_line=$(xcrun simctl list devices available | grep -E "^\s+${SIM_DEVICE} \(" | head -1 || true)
if [[ -z "$sim_line" ]]; then
  warn "No simulator named '${SIM_DEVICE}' found. Available iPhone 17 simulators:"
  xcrun simctl list devices available | grep "iPhone 17" || echo "  (none)"
  die "Create one in Xcode → Settings → Platforms, or pass --sim-device with an exact name."
fi
SIM_UDID=$(echo "$sim_line" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
SIM_STATE=$(echo "$sim_line" | sed -E 's/.*\) \((Booted|Shutdown)\).*/\1/')
info "UDID:  ${SIM_UDID}"
info "State: ${SIM_STATE}"
if [[ "$SIM_STATE" != "Booted" ]]; then
  xcrun simctl boot "$SIM_UDID"
  ok "Booted"
else
  ok "Already booted"
fi
open -a Simulator
info "Simulator.app launched (foregrounded)"

step "Step 5 — xcodebuild for simulator (Release)"
t0=$(date +%s)
DERIVED_DATA="${TAURI_DIR}/target/xcode-sim"
xcodebuild \
  -project "$XCODEPROJ" \
  -scheme "$SCHEME" \
  -configuration release \
  -destination "$XCODE_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  CODE_SIGNING_ALLOWED=NO \
  build \
  | tee /tmp/blinko-xcodebuild.log \
  | grep -E "^(===|\*\*|.*error:|.*warning:|Compile|Link|CopyFiles)" || true

APP_PATH=$(find "${DERIVED_DATA}/Build/Products" -name "Blinko.app" -type d 2>/dev/null | head -1 || true)
[[ -d "$APP_PATH" ]] || die "xcodebuild finished but Blinko.app not found. See /tmp/blinko-xcodebuild.log"
t=$(( $(date +%s) - t0 ))
ok "App built: ${APP_PATH}"
elapsed "$t"

step "Step 6 — Install + launch on simulator"
xcrun simctl install "$SIM_UDID" "$APP_PATH"
ok "Installed"
xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" >/dev/null
ok "Launched ${BUNDLE_ID}"

step "Done — debug recipes"
cat <<EOF
${DIM}
Safari Web Inspector:
  Mac Safari → Develop → Simulator → Blinko → index.html

Simulate offline (more detail with: ./build_ios.sh offline -h):
  ./build_ios.sh offline on              # pfctl drop — matches iPhone airplane mode hang
  ./build_ios.sh offline on hosts        # /etc/hosts → 127.0.0.1 — fails fast
  ./build_ios.sh offline status          # which methods are active
  ./build_ios.sh offline off             # restore everything

Useful simctl one-liners:
  xcrun simctl terminate ${SIM_UDID} ${BUNDLE_ID}
  xcrun simctl launch ${SIM_UDID} ${BUNDLE_ID}
  xcrun simctl uninstall ${SIM_UDID} ${BUNDLE_ID}
  xcrun simctl spawn ${SIM_UDID} log stream --predicate 'processImagePath CONTAINS "Blinko"'
${RESET}
EOF
