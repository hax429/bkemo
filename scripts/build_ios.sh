#!/usr/bin/env bash
# build_ios.sh — native SwiftUI iOS build + offline-simulation helper for bkemo.
#
# Subcommands:
#   build                          (default) prepare/build the out/ios Xcode project
#   offline on [method]            block bk.hax429.me to simulate offline
#   offline off                    restore network
#   offline status                 show which blocking methods are active
#
# Build mode:
#   ./scripts/build_ios.sh                 device: xcodegen + open Xcode
#   ./scripts/build_ios.sh --sim           simulator: build, install, launch
#
# Build flags:
#   --clean                        wipe DerivedData under out/ios/build
#   --xcodegen                     re-run `xcodegen generate` (default on)
#   --skip-xcodegen                use the checked-in .xcodeproj as-is
#   --sim-device <name>            override simulator (default: "iPhone 17 Pro")
#   --open                         open the staged .app / Xcode project
#
# Offline methods: pfctl | hosts | loss | wifi
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IOS_DIR="${REPO_ROOT}/out/ios"
OUT_DIR="${REPO_ROOT}/out/output/ios"
XCODEPROJ="${IOS_DIR}/bkemo.xcodeproj"
BUNDLE_ID="me.hax429.bk"
SCHEME="bkemo"
TARGET_HOST="bk.hax429.me"
PF_RULES_FILE="/tmp/bkemo-offline.pf.conf"
PF_STATE_FILE="/tmp/bkemo-offline.pf-was"
PF_MARKER="# === bkemo offline block ==="
WIFI_STATE_FILE="/tmp/bkemo-offline-wifi.was-on"

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
  build) ;;
  offline)
    handle_offline "$@"
    exit 0
    ;;
  *)
    die "Unknown subcommand: $SUBCMD (use 'build' or 'offline'; run with -h for help)"
    ;;
esac

MODE="device"
CLEAN=0
RUN_XCODEGEN=1
OPEN_OUT=0
SIM_DEVICE="iPhone 17 Pro"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sim)           MODE="sim" ;;
    --clean)         CLEAN=1 ;;
    --xcodegen)      RUN_XCODEGEN=1 ;;
    --skip-xcodegen) RUN_XCODEGEN=0 ;;
    --sim-device)    SIM_DEVICE="${2:?--sim-device needs a value}"; shift ;;
    --open)          OPEN_OUT=1 ;;
    -h|--help)       sed -n '2,24p' "$0"; exit 0 ;;
    *)               echo "Unknown flag: $1" >&2; exit 64 ;;
  esac
  shift
done

[[ "$(uname -s)" == "Darwin" ]] || die "macOS is required"
command -v xcrun >/dev/null || die "xcrun not found"
[[ -f "${IOS_DIR}/project.yml" ]] || die "native iOS project not found at ${IOS_DIR}"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

step "Environment (mode: ${MODE})"
info "Repo:     ${REPO_ROOT}"
info "iOS dir:  ${IOS_DIR}"
info "Output:   ${OUT_DIR}"
[[ "$MODE" == "sim" ]] && info "Sim device: ${SIM_DEVICE}"

if [[ $CLEAN -eq 1 ]]; then
  step "Cleaning iOS build artifacts"
  rm -rf "${IOS_DIR}/build" "${OUT_DIR}"
  ok "Clean done"
fi

if [[ $RUN_XCODEGEN -eq 1 ]]; then
  step "xcodegen generate"
  command -v xcodegen >/dev/null || die "xcodegen not found. brew install xcodegen"
  (
    cd "$IOS_DIR"
    xcodegen generate
  )
  ok "Xcode project regenerated"
fi

[[ -d "$XCODEPROJ" ]] || die "Xcode project missing at ${XCODEPROJ}"

mkdir -p "$OUT_DIR"

if [[ "$MODE" == "device" ]]; then
  step "Done — ready for Xcode"
  info "  open ${XCODEPROJ}"
  info "  → scheme ${SCHEME}, destination = your iPhone"
  info "  → ⌘R (Xcode signs + installs + launches)"
  info "Publishable staging path (after Archive): ${OUT_DIR}"
  if [[ $OPEN_OUT -eq 1 ]]; then
    open "$XCODEPROJ"
  fi
  exit 0
fi

step "Boot ${SIM_DEVICE} simulator"
sim_line=$(xcrun simctl list devices available | grep -E "^\s+${SIM_DEVICE} \(" | head -1 || true)
if [[ -z "$sim_line" ]]; then
  warn "No simulator named '${SIM_DEVICE}' found. Available iPhone simulators:"
  xcrun simctl list devices available | grep "iPhone" || echo "  (none)"
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

step "xcodebuild for simulator (Debug)"
t0=$(date +%s)
DERIVED_DATA="${IOS_DIR}/build/DerivedData"
xcodebuild \
  -project "$XCODEPROJ" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=${SIM_UDID}" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  CODE_SIGNING_ALLOWED=NO \
  build \
  | tee /tmp/bkemo-xcodebuild.log \
  | grep -E "^(===|\*\*|.*error:|.*warning:|CompileSwift|Ld |Touch)" || true

APP_PATH=$(find "${DERIVED_DATA}/Build/Products" -name "bkemo.app" -type d 2>/dev/null | head -1 || true)
[[ -d "$APP_PATH" ]] || die "xcodebuild finished but bkemo.app not found. See /tmp/bkemo-xcodebuild.log"
t=$(( $(date +%s) - t0 ))
ok "App built: ${APP_PATH}"
elapsed "$t"

rm -rf "${OUT_DIR}/bkemo.app"
cp -R "$APP_PATH" "${OUT_DIR}/bkemo.app"
ok "Staged: ${OUT_DIR}/bkemo.app"

step "Install + launch on simulator"
xcrun simctl install "$SIM_UDID" "${OUT_DIR}/bkemo.app"
ok "Installed"
xcrun simctl launch "$SIM_UDID" "$BUNDLE_ID" >/dev/null
ok "Launched ${BUNDLE_ID}"

if [[ $OPEN_OUT -eq 1 ]]; then
  open "$OUT_DIR"
fi

step "Done"
cat <<EOF
${DIM}
Simulate offline:
  ./scripts/build_ios.sh offline on
  ./scripts/build_ios.sh offline off

Staged app:
  ${OUT_DIR}/bkemo.app
${RESET}
EOF
