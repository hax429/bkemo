#!/usr/bin/env bash
#
# Builds the native macOS quick-capture helper and assembles it into a
# minimal .app bundle (no Xcode project — see docs/plans/mac.md).
#
#   ./build.sh          debug build (fast iteration)
#   ./build.sh release  release build
#
# Rust (out/macos/src/desktop/native_capture.rs) looks for the resulting
# .app at .build/<config>-app/BkemoCapture.app — keep this path in sync if
# you change it here.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-debug}"

cd "$DIR"
swift build -c "$CONFIG"

BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
APP="$DIR/.build/${CONFIG}-app/BkemoCapture.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/BkemoCapture" "$APP/Contents/MacOS/BkemoCapture"
cp "$DIR/Info.plist" "$APP/Contents/Info.plist"

codesign --force --sign - "$APP"
codesign --verify --strict "$APP"
echo "Built $APP"
