# bkemo iOS / macOS — Plan, Build & Verification

**Server:** `https://bk.hax429.me`
**Stack:** Tauri v2 + React + Vditor (extending existing code; no rewrite)
**Last updated:** 2026-05-25
**Replaces:** `IOS_MACOS_IMPL_PLAN.md`, `IOS_BUILD_PROCESS.md` (now deleted)

---

## 1. Goal

Make the iOS and macOS apps feel like real applications on top of the `bk.hax429.me` server instance, with these properties:

1. **Quick capture anywhere** — create / edit / delete notes even with no network, sync on reconnect.
2. **Full offline cold-launch** — opening the app with airplane mode on still works (shell loads from local files).
3. **Auto-update from server** — when the frontend source on the server is updated, the app picks it up automatically on the next launch. No App Store re-submission required for frontend-only changes.
4. **No backend in the app** — the app ships zero Node.js / Express / Prisma code; all data calls hit `bk.hax429.me/api/*`.

| # | Goal | Success Criteria | Status |
|---|------|-----------------|--------|
| G1 | iOS app launches and connects to `bk.hax429.me` | Auth screen → notes list visible on iPhone Simulator | ✅ Done |
| G2 | Markdown editor (Vditor) works on iOS | Can create, edit, save with formatting | ⏳ Pending end-to-end test |
| G3 | macOS app builds and distributes | `.app` bundle runs on macOS Sequoia | ⏳ Pending |
| G4 | Full offline note creation | Notes created offline are queued and sync on reconnect | ✅ Done |
| G5 | Offline edit + delete | Edits/deletes offline applied on reconnect | ✅ Done |
| G6 | Attachment offline viewing | Previously viewed attachments accessible without network | ✅ Done |
| G7 | iOS share sheet for file downloads | Tapping download opens iOS share sheet | ✅ Done |
| G8 | iOS status bar color syncs with theme | Dark/light mode changes status bar tint | ✅ Done |
| G9 | **Cold-launch offline** | Airplane mode at app start → shell still loads, can capture notes | ✅ Done (build-time bundle, 2026-05-25) |
| G10 | **Auto frontend update from server** | Push to `dist/public` on server → next app launch shows new code | ⏳ Pending (Phase 8 — OTA) |
| G11 | App Store / TestFlight ready | Passes Xcode archive + App Store validation | ⏳ Pending |

---

## 2. Architecture

### 2.1 Current architecture (as of 2026-05-25)

iOS production builds now bundle the frontend at build time (`frontendDist: "../../dist/public"` in `tauri.ios.conf.json`). The WKWebView loads `tauri://localhost/index.html` from the embedded bundle and all data calls go to `https://bk.hax429.me/api/*`. Cold launch with no network works because the shell lives on disk.

```
┌────────────────────────────────────────────┐         ┌────────────────────────────┐
│  iOS App (Tauri WKWebView, production)     │         │   bk.hax429.me             │
│                                            │         │                            │
│  Window URL: tauri://localhost/index.html  │         │ (no longer serves the      │
│  (frontendDist baked into the .ipa)        │         │  iOS shell)                │
│                                            │ ──API── │ /api/trpc, /api/file, etc. │
│  getBlinkoEndpoint() → https://bk.hax429.me│         └────────────────────────────┘
│  Native plugins (Swift): setStatusBarColor,
│  openAppSettings, shareFile                │
└────────────────────────────────────────────┘
```

iOS dev (`tauri:ios:dev`) still uses `devUrl: "https://bk.hax429.me"` for fast iteration against the live server — only production builds are offline-capable.

**Pros:** Cold-launch offline works. Offline queue (`offlineNoteStorage` + `offlinePendingOps`) replays on reconnect because the shell loads regardless of network state.
**Cons:** Frontend changes on the server are **not** picked up by the iOS app — every frontend update needs a new TestFlight build. G10 (auto frontend update) requires the Phase 8 OTA work below.

### 2.2 Target architecture — OTA bundle update (Phase 8)

```
┌─────────────────────────────────────────┐         ┌─────────────────────────────────────┐
│  iOS App (Tauri WKWebView)              │         │   bk.hax429.me                      │
│                                         │         │                                     │
│  Window URL: bundle://localhost/        │ ──GET── │ /app-bundle/manifest.json           │
│                                         │ ──GET── │ /app-bundle/bundle-<ver>.zip        │
│  ┌───────────────────────────────────┐  │ ──API── │ /api/trpc/*  /api/file/*  (existing)│
│  │ Rust URI handler:                 │  │         └─────────────────────────────────────┘
│  │   1. <AppData>/bundles/<active>/  │  │
│  │   2. fallback: baked-in baseline  │  │
│  └───────────────────────────────────┘  │
│  Rust background updater:               │
│    fetch manifest → if newer → download │
│    → verify SHA-256 → extract           │
│    → flip current pointer (next launch) │
└─────────────────────────────────────────┘
```

**Pros:** True offline cold-launch (loads from local files); auto-update on next launch when online; no native release for frontend changes.
**Cons:** Adds Rust update logic + a build-time bundle generator on the server; new bundles take effect on the **next** app launch (not hot-swap).

**On-device layout:**
```
<AppData>/
  bundle-state.json         # { "active": "1.8.8" }
  bundles/
    1.8.7/                  # extracted bundle (previous version, kept as rollback)
    1.8.8/                  # extracted bundle (current)
```

**Update flow:**
1. App launches → loads window URL `bundle://localhost/index.html`.
2. Rust URI handler reads `bundle-state.json` → serves files from `bundles/<active>/`. If `active` is missing or files are corrupt → falls back to the baked-in baseline shipped with the binary.
3. In parallel (background task): Rust fetches `<endpoint>/app-bundle/manifest.json`.
4. If `manifest.version != active` and SHA-256 doesn't match a known-good local version → download zip, verify SHA-256, extract to `bundles/<new>/`, atomic write to `bundle-state.json`. Picked up on next launch.
5. tRPC calls and file uploads still target `https://bk.hax429.me` via the existing `getBlinkoEndpoint()` helper.

**Server side changes required:**
- A build-time script that produces `dist/public/app-bundle/manifest.json` and `dist/public/app-bundle/bundle-<version>.zip` from `dist/public/`.
- No new Express routes needed — `express.static('dist/public')` already serves them.
- CORS is already permissive (`server/index.ts:274`: `origin: true`), so the WebView loading from `bundle://localhost` can call `https://bk.hax429.me/api/*` without changes.

### 2.3 Why this architecture vs alternatives

| Approach | Auto-update | Cold-launch offline | Effort | Verdict |
|---|---|---|---|---|
| Keep `devUrl` remote (previous) | ✅ instant | ❌ blank screen | n/a | Replaced — fails G9 |
| PWA service worker hardening | ✅ instant | ⚠️ flaky (SW evictable) | Low | Adopted as defense-in-depth |
| **Frontend bundled at build time, no OTA (current)** | ❌ App Store only | ✅ always | Low | Ships G9 now; G10 deferred to OTA |
| OTA bundle (Phase 8 target) | ✅ next launch | ✅ always | Medium | Adds G10 on top of build-time bundling |

### 2.4 Decisions locked in

| Question | Decision |
|---|---|
| Bundle generated when? | Auto on every `bun run build:web` (post-vite step) |
| Bundle version source | Root `package.json` `version` field — single source of truth |
| macOS scope | **iOS only.** macOS keeps the existing `tauri-plugin-updater` (GitHub-releases-based full-app updates). Gatekeeper / notarization makes runtime-extracted code paths painful on macOS. |
| `minNativeVersion` mismatch behavior | Warning toast, app still usable. No hard block. |
| Asset format | Single zip per version (atomic install, simple integrity check) |
| Hot-swap on update? | No — new bundle activates on next launch. Keeps state clean. |

---

## 3. Phase Status

| Phase | Title | Status | Completed |
|---|---|---|---|
| 0 | iOS Project Initialization | ✅ Complete | 2026-04-25 |
| 1 | Swift Plugin (setStatusBarColor, openAppSettings, shareFile) | ✅ Complete | 2026-04-25 |
| 2 | iOS Build Configuration (permissions, team ID) | ✅ Complete | 2026-04-25 |
| 3 | Frontend iOS Adaptations (isIOS, safe area, share sheet) | ✅ Complete | 2026-04-25 |
| 4 | Enhanced Offline Support (queue, sync, attachment cache) | ✅ Complete | 2026-04-25 |
| 4.5 | Build-time bundled frontend (G9 — cold-launch offline) | ✅ Complete | 2026-05-25 |
| 5 | macOS Polish (signing, distribution) | ⏳ Pending | — |
| 6 | Testing Suite (offline queue + helpers unit tests) | ⏳ Pending | — |
| 7 | Distribution (TestFlight / GitHub releases) | ⏳ Pending | — |
| **8** | **OTA Bundle Updater (G10 — auto frontend update without rebuild)** | ⏳ Pending | — |

### Phase 0–4 — completed work summary

**Phase 0:** Installed CocoaPods, ran `bunx tauri ios init`, added `tauri:ios:dev` + `tauri:ios:build` scripts.

**Phase 1:** Swift plugin at `app/tauri-plugin-blinko/ios/`:
- `setcolor` — overlays status-bar-area `UIView` with hex color (tag `9_001` for replace-on-repeat)
- `openAppSettings` — opens `UIApplication.openSettingsURLString`
- `shareFile` — presents `UIActivityViewController` with a remote URL

**Phase 2:** Permission strings (`NSCameraUsageDescription`, etc.) in `app/src-tauri/gen/apple/project.yml`. Team ID `5L7AP54366` + `minimumSystemVersion: "14.0"` in `app/src-tauri/tauri.ios.conf.json`.

**Phase 3:** `app/src/lib/tauriHelper.ts` — `isIOS()` helper, `downloadFromLink` iOS branch using `shareFile`, `setTauriTheme` iOS branch, `requestMicrophonePermission` iOS branch. `app/index.html` viewport `viewport-fit=cover`. `app/src/styles/globals.css` safe-area + Vditor padding.

**Phase 4:** `app/src/store/blinkoStore.tsx` — `offlinePendingOps` (edits/deletes queue) alongside existing `offlineNoteStorage` (creates). `syncOfflineNotes` processes both, halts on first failure. `app/src/store/baseStore.ts` emits `app:online`. `app/src/lib/attachmentCache.ts` caches files to `BaseDirectory.AppCache`. `app/src/lib/noteCache.ts` uses Dexie/IndexedDB for offline note reads.

**Phase 4.5:** Switched iOS production builds from remote shell to build-time bundle. `app/src-tauri/tauri.ios.conf.json` now sets `frontendDist: "../../dist/public"` + `beforeBuildCommand: "bun run build:no-pwa"`. `devUrl` retained only for `tauri:ios:dev`. `app/src/lib/blinkoEndpoint.ts` defaults to `https://bk.hax429.me` when running in Tauri without a saved endpoint, so the bundled shell can resolve API URLs without user input on first launch. Cold-launch offline (G9) now works; frontend updates still require a TestFlight build until Phase 8 OTA lands.

### Phase 8 — OTA implementation plan

| # | Task | Status |
|---|---|---|
| 8a | Design OTA protocol (manifest, on-device layout, fallback) | ✅ See §2.2 |
| 8b | Server: `scripts/build-app-bundle.ts` produces `dist/public/app-bundle/{manifest.json, bundle-<ver>.zip}`; wire into `app/package.json:build:web` | ⏳ Pending |
| 8c | App: switch `tauri.ios.conf.json` from `devUrl` to `frontendDist` | ✅ Done in Phase 4.5 (window URL still `tauri://localhost/index.html`; OTA will swap to `bundle://localhost/index.html` later) |
| 8d | App: Rust `bundle_updater` module — fetch manifest, download, verify SHA-256, extract, flip pointer | ⏳ Pending |
| 8e | App: Rust `bundle_resolver` + custom URI scheme `bundle://localhost/` — serves from active extracted bundle, falls back to baseline | ⏳ Pending |
| 8f | App: `app/src/lib/blinkoEndpoint.ts` — default endpoint to `https://bk.hax429.me` if unset; keep prompt as override | ✅ Done in Phase 4.5 |
| 8g | Verification: airplane-mode cold launch → shell loads (✅ in Phase 4.5) → online → new bundle downloaded → next launch uses new bundle | ⏳ Pending (OTA portion) |

---

## 4. Environment

Verified 2026-04-25.

| Tool | Version | Location | Notes |
|------|---------|----------|-------|
| Xcode | 26.4.1 | `/Applications/Xcode.app` | iOS 26 simulators included |
| Rust / Cargo | 1.95.0 | `~/.cargo/bin/` | **Not in default PATH** — source `~/.cargo/env` |
| iOS targets | `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios` | installed | all three required |
| Bun | 1.3.13 | `~/.bun/bin/bun` | **Not in default PATH** |
| Tauri CLI | 2.10.1 | via `bun x @tauri-apps/cli` | |
| CocoaPods | 1.16.2 | `/opt/homebrew/bin/pod` | installed via `brew install cocoapods` |
| xcodegen | latest | `/opt/homebrew/bin/xcodegen` | installed via `brew install xcodegen` |

Shell setup required before any Tauri commands:

```bash
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
source "$HOME/.cargo/env"
```

Add permanently (one-time):
```bash
echo 'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"' >> ~/.zshrc
```

---

## 5. Build & Release

### 5.1 iOS — physical device (Phase 4.5 — offline-bundled)

> The `xcodebuild` CLI cannot sign builds under Xcode 16 (`error: No Account for Team "5L7AP54366"`); signing must go through the Xcode GUI.

**TL;DR — one-shot build script (`build_ios.sh` at repo root):**
```bash
./build_ios.sh                          # Device prep (Steps 0–2). Then open Xcode, ⌘R yourself.
./build_ios.sh --sim                    # Simulator end-to-end: builds, installs, launches iPhone 17 Pro.
./build_ios.sh --sim --sim-device "iPhone 17 Pro Max"   # Different simulator
./build_ios.sh --clean                  # Also wipes target/ (recovery from stale-cache / repo-rename errors)
./build_ios.sh --xcodegen               # Also re-runs xcodegen (if project.yml changed)
./build_ios.sh --skip-web               # Skip the frontend bundle (if dist/public is already fresh)
```
Device mode stops after copying `libapp.a` — Xcode handles signing. Simulator mode boots iPhone 17 Pro, builds via `xcodebuild` with `CODE_SIGNING_ALLOWED=NO`, installs, launches, then prints Safari Web Inspector + `/etc/hosts` offline-test instructions. Manual steps below for reference.

> ⚠️ The Tauri project uses the same `Externals/arm64/release/libapp.a` for the device and the Apple Silicon simulator. Switching modes (e.g. `--sim` after a device run) overwrites that file, so the next opposite-mode run will need to rebuild Rust. The script warns when it detects a mismatch.


**Step 0 — Build the frontend bundle (NEW in Phase 4.5):**
Since iOS production now ships the frontend embedded in the `.ipa` (not loaded from `bk.hax429.me`), `dist/public/` must exist before Xcode packages the app.
```bash
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
cd /Users/hax429/Developer/blinkos/app
bun run build:no-pwa
# verify: ls ../dist/public/index.html
```
~20s. The `beforeBuildCommand` in `tauri.ios.conf.json` runs this for you under `tauri ios build`, but going straight to Xcode skips that hook — run it manually.

**Step 1 — Compile Rust for iOS device:**
```bash
cd /Users/hax429/Developer/blinkos/app/src-tauri
SDKROOT=$(xcrun -sdk iphoneos --show-sdk-path) \
IPHONEOS_DEPLOYMENT_TARGET=14.0 \
cargo build --target aarch64-apple-ios --release --features custom-protocol
```
> `--features custom-protocol` is **required** for production iOS builds. Without it, the runtime treats the binary as dev mode and loads `devUrl` (the remote URL) instead of the local `frontendDist` bundle — even with `--release`. See §6.7 row "WKWebView loads remote URL even after `--release`".
~30s incremental, ~90s first build.

**Step 2 — Copy library to Xcode project:**
```bash
cp /Users/hax429/Developer/blinkos/app/src-tauri/target/aarch64-apple-ios/release/libapp_lib.a \
   /Users/hax429/Developer/blinkos/app/src-tauri/gen/apple/Externals/arm64/release/libapp.a
```
> cargo outputs `libapp_lib.a` (from crate `app_lib`), but Xcode expects `libapp.a`.

**Step 3 — Regenerate Xcode project (only if `project.yml` changed):**
```bash
cd /Users/hax429/Developer/blinkos/app/src-tauri/gen/apple
xcodegen generate
```

**Step 4 — Build and install via Xcode GUI:**
1. Plug iPhone in over USB (or pair wirelessly: Window → Devices and Simulators → enable "Connect via network")
2. On the iPhone, Settings → General → VPN & Device Management → trust the developer profile for team `5L7AP54366` (first time only)
3. Open `app/src-tauri/gen/apple/bkemo.xcodeproj`
4. Select scheme **bkemo-ios**
5. Select **Gabriel Wang's iPhone** as destination
6. Set Run configuration to **Release**: Product → Scheme → Edit Scheme → Run → Build Configuration → release
7. **Product → Clean Build Folder** (⇧⌘K) if `libapp.a` or `dist/public/` was rebuilt
8. **⌘R** — builds, signs, installs, and launches on device

**Step 5 — Verify offline cold-launch on the device (the whole point of Phase 4.5):**
1. With network ON, open the app, sign in once. Endpoint field is pre-filled with `https://bk.hax429.me`.
2. Pull-to-refresh the notes list so `noteCache.ts` (IndexedDB) gets populated.
3. Force-quit bkemo (swipe up from the app switcher).
4. iPhone → Settings → Airplane Mode **ON**. Wait 5s.
5. Re-open bkemo. **Expected:** shell renders within ~2s (no blank screen), cached notes visible.
6. Create a new note while offline. **Expected:** note shows in the list immediately; under the hood it's in `localStorage.offlineNotes`.
7. Airplane Mode **OFF**.
8. Within 3s the `app:online` event fires; the new note appears on `https://bk.hax429.me` (verify in a desktop browser).

If step 5 fails (blank screen):
- `dist/public/index.html` was missing at build time → redo Step 0 → rebuild
- WKWebView is hitting the network for something → check Safari → Develop → iPhone → bkemo console for failed requests (the **shell** itself must be 100% local; API calls to `bk.hax429.me` failing is fine, those are queued)

### 5.2 iOS — simulator

Two ways:

**5.2.a — Offline-bundled production build on simulator (recommended for debugging offline boot):**
```bash
./build_ios.sh --sim
```
Builds the frontend, compiles Rust for `aarch64-apple-ios-sim` (or `x86_64-apple-ios` on Intel), copies `libapp.a`, builds with `xcodebuild ... CODE_SIGNING_ALLOWED=NO`, installs on the iPhone 17 Pro simulator, launches.

To reproduce the airplane-mode boot path on the sim (the simulator shares the Mac's network, so there's no in-sim airplane toggle):
```bash
# Block only bk.hax429.me — keeps Safari Web Inspector working
sudo sh -c 'echo "127.0.0.1 bk.hax429.me" >> /etc/hosts'
sudo dscacheutil -flushcache

# In the simulator, kill and relaunch bkemo, or:
xcrun simctl terminate booted me.hax429.bk && xcrun simctl launch booted me.hax429.bk

# Restore network when done:
sudo sed -i '' '/bk.hax429.me/d' /etc/hosts && sudo dscacheutil -flushcache
```
Attach Web Inspector: Mac Safari → Develop → Simulator → bkemo → `index.html`.

**5.2.b — Dev mode with hot reload (loads shell from `https://bk.hax429.me`, no offline test possible):**
```bash
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
source "$HOME/.cargo/env"
cd /Users/hax429/Developer/blinkos/app
RUST_BACKTRACE=1 bun run tauri:ios:dev
```
Compiles Vite → Rust (`aarch64-apple-ios-sim`) → Swift plugin → launches the iOS Simulator pointed at the remote `devUrl`. Use this for fast UI iteration; use 5.2.a when validating the offline path.

### 5.3 macOS desktop build

```bash
cd /Users/hax429/Developer/blinkos/app
bun run tauri:desktop:build
# Output: src-tauri/target/release/bundle/macos/bkemo.app
open src-tauri/target/release/bundle/macos/bkemo.app
```

### 5.4 OTA bundle (Phase 8, once 8b lands)

```bash
# Triggered automatically by build:web (post-step)
bun run build:web

# Output (relative to repo root):
# dist/public/app-bundle/manifest.json
# dist/public/app-bundle/bundle-1.8.7.zip
```

Deploying `dist/public/` to the server is the existing path — no extra step. The app fetches `https://bk.hax429.me/app-bundle/manifest.json` on next launch and self-updates.

### 5.5 TestFlight (iOS release)

```bash
cd /Users/hax429/Developer/blinkos/app
bun run tauri:ios:build
open src-tauri/gen/apple/bkemo.xcodeproj
# 1. Select bkemo-ios scheme, "Any iOS Device (arm64)" destination
# 2. Product → Archive
# 3. Distribute App → App Store Connect → Upload
# 4. App Store Connect → TestFlight → add internal testers
```

### 5.6 macOS GitHub Release (existing path — kept for macOS)

```bash
bun run tauri:desktop:build

# Sign
codesign --force --deep \
  --sign "Developer ID Application: YOUR_NAME (TEAM_ID)" \
  src-tauri/target/release/bundle/macos/bkemo.app

# Notarize
ditto -c -k --sequesterRsrc --keepParent \
  src-tauri/target/release/bundle/macos/bkemo.app \
  bkemo.zip
xcrun notarytool submit bkemo.zip \
  --apple-id bondi240827@gmail.com \
  --team-id 5L7AP54366 \
  --wait

# Staple
xcrun stapler staple src-tauri/target/release/bundle/macos/bkemo.app
```

The Tauri updater config (`app/src-tauri/tauri.conf.json:104`) points at `https://github.com/blinkospace/blinko/releases/latest/download/latest.json` for macOS auto-updates.

### 5.7 What updates require what action

| Changed | Native rebuild needed? | OTA enough? |
|---|---|---|
| `app/src/**` (frontend React/TS) | No (after Phase 8) | ✅ Yes — push to `dist/public/` on server |
| `app/src/styles/**` | No (after Phase 8) | ✅ Yes |
| `app/src-tauri/src/**` (Rust) | Yes — Steps 1–4 in §5.1 | No |
| `app/src-tauri/tauri.ios.conf.json` | Yes (config is embedded in binary) | No |
| `app/src-tauri/gen/apple/project.yml` | Yes — `xcodegen generate` + Steps 1–4 | No |
| `app/tauri-plugin-blinko/ios/**` (Swift) | Yes | No |
| Frontend after Phase 4.5, before Phase 8 | Yes — frontend is baked into the `.ipa`; rebuild + TestFlight to ship a frontend change | Will become no, once OTA lands |

---

## 6. Debug Reference

### 6.1 Live iOS simulator logs

```bash
xcrun simctl spawn booted log stream --predicate 'processImagePath CONTAINS "bkemo"'
```

### 6.2 Tauri Rust + Swift output

```bash
RUST_BACKTRACE=1 bun run tauri:ios:dev 2>&1 | tee /tmp/tauri-ios.log
```

### 6.3 Rust compile check only (fast, no Xcode)

```bash
cd /Users/hax429/Developer/blinkos/app/src-tauri
cargo check --target aarch64-apple-ios-sim
```

### 6.4 Safari Web Inspector (JS / tRPC errors)

Safari → Develop → Simulator → bkemo → main frame. From the console:

```javascript
// Server endpoint
localStorage.getItem('blinkoEndpoint')             // "https://bk.hax429.me"

// Auth token
JSON.parse(localStorage.getItem('blinkoToken') || 'null')

// Offline queues
JSON.parse(localStorage.getItem('offlineNotes') || '[]')        // create queue
JSON.parse(localStorage.getItem('offlinePendingOps') || '[]')   // edit/delete queue

// Attachment cache index
JSON.parse(localStorage.getItem('cachedAttachments') || '{}')

// Platform check
window.__TAURI_OS_PLUGIN_INTERNALS__                // { platform: "ios" }

// Force offline sync (in DEV mode after wiring window.__blinkoSync)
window.__blinkoSync?.()
```

### 6.5 macOS

```bash
# Crash logs
ls ~/Library/Logs/DiagnosticReports/ | grep bkemo

# Sandbox violations
log show --predicate 'process == "bkemo"' --last 5m | grep -i "deny"

# Notarization status
spctl -a -vvv /Applications/bkemo.app
```

### 6.5b Testing offline on a physical iPhone over USB

USB carries Safari's Web Inspector channel, **not** network traffic — so the device can be fully offline and you still get live console + network logs from the Mac. This is the closest match to what users actually experience.

**Prerequisites (one-time):**
```text
iPhone: Settings → Safari → Advanced → Web Inspector              ON
iPhone: Settings → Privacy & Security → Developer Mode             ON  (only needed for Network Link Conditioner)
Mac:    Safari → Settings → Advanced → Show features for web devs  ON
```
Tauri v2 Release builds keep `WKWebView.isInspectable = true`, so Web Inspector works against the Release build, not just dev.

**Offline-toggle methods on the iPhone:**

| Method | Where | Behavior | When to use |
|---|---|---|---|
| **Airplane Mode** | Settings / Control Center | Wi-Fi + cellular off, instant | Default — closest to user-reported bug |
| **Wi-Fi off + Cellular off** | Settings → Wi-Fi / Cellular | Same as airplane, lets Bluetooth stay on | Debugging with a paired Bluetooth tool |
| **Network Link Conditioner** | Settings → Developer → Network Link Conditioner → "100% Loss" | Surgical packet drop, OS-level traffic still works, app sockets hang | Reproduces the exact "long connect timeout" hang |

**Test loop:**
```text
1. Plug in. ⌘R from Xcode to install Release build.
2. With Wi-Fi ON, open bkemo once → sign in → pull-to-refresh (populates noteCache.ts IndexedDB).
3. Mac Safari → Develop → "<your iPhone>" → bkemo  (keep open)
4. iPhone: Airplane Mode ON.
5. iPhone: force-quit bkemo (swipe up in app switcher) so WKWebView drops cached connections.
6. iPhone: re-open bkemo. Watch Safari console.
   Expected: shell renders within ~2s, cached notes visible.
7. Create a note while offline → appears instantly (queues in localStorage.offlineNotes).
8. Airplane Mode OFF → `app:online` event should fire within 3s; queue drains to bk.hax429.me.
```

**Gotchas:**
- WKWebView keeps a connection pool. Always force-quit + relaunch after every toggle, or you'll see stale sockets retry against the old IP.
- iOS shows a brief "no internet" banner — wait 5s before deciding the WebView is hung.
- USB-only debugging keeps working when offline; "Connect via network" pairing does not.
- If the Develop menu doesn't list your iPhone, unlock the phone screen and unplug/replug — Safari only enumerates unlocked devices.

### 6.6 Simulating offline on the iOS simulator

The simulator shares the Mac's network — there is no in-sim airplane toggle. To repro the iPhone airplane-mode bug on the sim you have to block the Mac side. `build_ios.sh` ships four methods, fastest → bluntest:

| Method | Symptom for `fetch('bk.hax429.me')` | Matches iPhone hang? | Web Inspector still works? |
|---|---|---|---|
| `pfctl` (default) | Packets silently dropped → connect() waits TCP timeout (~30–75s) | **Yes — closest match** | Yes |
| `hosts` | Maps to `127.0.0.1` → TLS/connect error in <100ms | No (fails fast) | Yes |
| `loss` (Network Link Conditioner) | 100% loss profile, system-wide | Yes | Yes |
| `wifi` | All network off | Yes (everything fails) | Yes (loopback / XPC) |

**Quickstart (script handles sudo prompts, idempotent):**
```bash
./build_ios.sh offline on              # default: pfctl drop. Best for reproducing the iPhone hang.
./build_ios.sh offline on hosts        # /etc/hosts swap. Surgical, fails fast.
./build_ios.sh offline on loss         # opens Network Link Conditioner prefpane (Apple tool, manual GUI step)
./build_ios.sh offline on wifi         # disables Mac Wi-Fi (reversible by `offline off`)
./build_ios.sh offline status          # show which methods are currently active + how bk.hax429.me resolves
./build_ios.sh offline off             # restore every method (safe to run any time)
```

The script automatically `terminate`+`launch`es bkemo on the booted simulator after toggling blocks, so WKWebView drops its connection cache without you having to swipe the app away.

**Manual recipes for each method** (in case you can't or don't want to use the script):

```bash
# A. pfctl — packet drop, matches iPhone airplane-mode hang
HOST_IP=$(dig +short bk.hax429.me | tail -1)
sudo tee /etc/pf.anchors/blinko.offline >/dev/null <<EOF
block drop out quick proto tcp to $HOST_IP
block drop out quick proto udp to $HOST_IP
EOF
sudo pfctl -a blinko.offline -f /etc/pf.anchors/blinko.offline
sudo pfctl -E
# undo
sudo pfctl -a blinko.offline -F all && sudo rm /etc/pf.anchors/blinko.offline

# B. /etc/hosts — fast-fail surgical block
sudo sh -c 'echo "127.0.0.1 bk.hax429.me" >> /etc/hosts'
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
# undo
sudo sed -i '' '/[[:space:]]bk.hax429.me$/d; /[[:space:]]bk.hax429.me[[:space:]]/d' /etc/hosts
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder

# C. Network Link Conditioner — Apple's official tool
# Install: download "Additional Tools for Xcode" → install Network Link Conditioner.prefPane
# System Settings → Network Link Conditioner → ON, profile = "100% Loss"

# D. Disable Wi-Fi (nuclear, but trivial)
networksetup -setairportpower en0 off    # off
networksetup -setairportpower en0 on     # on
```

**Reliability tips:**
- WKWebView keeps its own connection cache. After toggling network state, always terminate + relaunch the app: `xcrun simctl terminate booted me.hax429.bk && xcrun simctl launch booted me.hax429.bk`
- `pfctl` rules apply to the IP, not the hostname. If `bk.hax429.me` rotates IPs (Cloudflare) the rule misses. Re-run `dig` + reload, or combine with `/etc/hosts`.
- The simulator's launch screen briefly shows the app logo before JS runs. That's not the hang — wait 5+ seconds before deciding the WebView is stuck.

### 6.7 Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Blank white screen in WebView (prod build) | `dist/public` missing or stale before `tauri ios build` | Run `bun run build:no-pwa` (or rely on the `beforeBuildCommand` in `tauri.ios.conf.json`) and rebuild |
| Blank white screen in WebView (dev) | `bk.hax429.me` unreachable | Check cert + connectivity in Safari; iOS dev still uses the remote `devUrl` |
| `No signing certificate / No team` | xcodebuild CLI cred bug | Open Xcode GUI, sign there |
| Swift plugin: `module not found: SwiftRs` | `.tauri/tauri-api/` not generated | Let `tauri ios dev` run fully once |
| `failed to read CLI options: Connection refused` | Standalone Xcode build with no coordination server | `project.yml` build script's fallback covers this — make sure `libapp.a` is pre-built per §5.1 |
| iOS keyboard covers editor | Missing safe-area CSS | Verify `@supports (-webkit-touch-callout: none)` block in `globals.css` |
| `failed to read plugin permissions: ... /Users/.../<old-repo-name>/...: No such file or directory` | Cargo bakes absolute paths into the tauri plugin codegen under `target/`; renaming or moving the repo invalidates them | `cd app/src-tauri && rm -rf target` then rebuild. `cargo clean --target aarch64-apple-ios` alone is usually not enough because some plugin codegen lives outside the per-target dir. |
| WKWebView loads remote URL (`bk.hax429.me`) even after `--release` build | `tauri/build.rs` sets `let dev = !has_feature("custom-protocol")` — and bare `cargo build --release` does NOT enable that feature unless you pass `--features custom-protocol`. Without it, the runtime sees `cfg(dev)` and loads `devUrl` (remote) instead of `frontendDist` (`tauri://localhost`). The standard Tauri v2 template includes `[features] custom-protocol = ["tauri/custom-protocol"]` with a "DO NOT REMOVE" comment for exactly this reason. Confirm by checking `target/.../build/bkemo-*/output` for `cargo:rustc-cfg=dev` — if present, dev mode is on. | (1) Ensure `app/src-tauri/Cargo.toml` has `[features] custom-protocol = ["tauri/custom-protocol"]`. (2) Build with `cargo build --target aarch64-apple-ios --release --features custom-protocol`. (3) `build_ios.sh` Step 1 now passes this flag automatically. |
| Xcode build error: `Multiple commands produce '.../bkemo.app/libapp.a'` | After running `xcodegen generate` once `arm64/release/libapp.a` exists on disk, xcodegen finds *both* `arm64/debug/libapp.a` and `arm64/release/libapp.a` under the `Externals` source path and adds each as a Resources build file. Two Resources phases trying to deliver the same `libapp.a` to the `.app` root → conflict. | In `gen/apple/project.yml`, the `Externals` sources entry must be `- path: Externals` + `buildPhase: none` (linking goes via `LIBRARY_SEARCH_PATHS` + the `framework: libapp.a` dependency, not Resources). Then `xcodegen generate`, then wipe `~/Library/Developer/Xcode/DerivedData/bkemo-*` so the cached duplicated rule is gone, then ⌘R. |
| WKWebView shows `bk.hax429.me` as the **document** URL (viewport errors / logo.png 404s appear under that host in Safari Web Inspector) | `gen/apple/project.yml` embeds an absolute path to `dist/public` in its pre-build script. After the repo was renamed `blinko → blinkos`, that path stopped resolving and the Xcode build script silently logs `WARNING: Frontend dist not found` to `/tmp/blinko-xcode-build.log`, so the `.ipa` ships whatever was last in `gen/apple/assets/` — a pre-Phase-4.5 shell whose old `blinkoEndpoint.ts` redirected the WebView to the remote URL. | (1) `grep '/Users/.*/blinko/' app/src-tauri/gen/apple/project.yml` — if any matches, fix to the new path and re-run `xcodegen generate`. (2) Manually refresh: `rm -rf app/src-tauri/gen/apple/assets && cp -r dist/public/. app/src-tauri/gen/apple/assets/`. (3) `build_ios.sh` Step 2.5 now does this every run so it's belt-and-braces. (4) Verify with `grep 'index-' app/src-tauri/gen/apple/assets/index.html` matches `grep 'index-' dist/public/index.html`. |

---

## 7. Verification Checklists

### 7.1 Auth & connection (every release)

- [ ] First launch shows server URL prompt (or defaults to `bk.hax429.me` post-Phase-8f)
- [ ] Entering `https://bk.hax429.me` connects successfully
- [ ] Login with valid credentials succeeds
- [ ] Token persists after app kill + reopen
- [ ] Invalid credentials show error toast

### 7.2 Notes

- [ ] Notes list loads from `bk.hax429.me`
- [ ] Create plain text note → appears in list immediately
- [ ] Create markdown note (bold, italic, code block) → renders correctly
- [ ] Edit a note → changes persist after closing
- [ ] Delete a note → removed from list
- [ ] Pin a note → stays at top

### 7.3 Editor (Vditor)

- [ ] Vditor renders in WYSIWYG mode on iOS
- [ ] Toolbar buttons: bold, italic, heading, code, link work
- [ ] Software keyboard does not obscure toolbar
- [ ] Paste from iOS clipboard works
- [ ] Long-press text selection + copy/paste works
- [ ] Mermaid diagrams render

### 7.4 Attachments

- [ ] Photo from camera attaches to note
- [ ] Photo from photo library attaches
- [ ] Audio recording works (microphone permission granted)
- [ ] Attachment thumbnail renders in note card
- [ ] Tapping download icon shows iOS share sheet

### 7.5 Offline (Phase 4 + Phase 8)

| Test | Steps | Expected |
|------|-------|----------|
| Offline create | Airplane mode ON → create note → airplane mode OFF | Note appears on server within 3s |
| Offline edit | Create online → airplane mode ON → edit → airplane mode OFF | Edit visible from web browser |
| Offline delete | Create online → airplane mode ON → delete → airplane mode OFF | Note gone from server |
| Queue persistence | Airplane mode ON → create note → kill app → reopen → airplane mode OFF | Note still syncs |
| Attachment cache | View note with image online → airplane mode ON → navigate to note | Image still visible |
| Queue order | Create A, B, C offline → go online | Server has A, B, C in order |
| **Cold-launch offline (Phase 8)** | Fresh install → airplane mode → first open | Shell loads from baseline; can capture note; sync on reconnect |
| **OTA update (Phase 8)** | Bump `version` in root `package.json` → `bun run build:web` → deploy → reopen app | Next launch shows updated frontend; `bundle-state.json` reflects new version |

### 7.6 Theme

- [ ] Toggle dark mode → status bar turns dark
- [ ] Toggle light mode → status bar turns light
- [ ] Theme preference persists after app restart

### 7.7 Performance

- [ ] App launches in < 3s on iPhone 17 Pro simulator
- [ ] Note list scrolls at 60fps (no dropped frames in Xcode Instruments)
- [ ] Typing in Vditor has no perceptible lag
- [ ] No memory warnings in Xcode console after 5 minutes of use

---

## 8. File Change Tracker

### Completed (Phases 0–4)

| File | Change | Status |
|------|--------|--------|
| `app/tauri-plugin-blinko/ios/Package.swift` | Created — Swift Package manifest | ✅ |
| `app/tauri-plugin-blinko/ios/Sources/BlinkoPlugin.swift` | Created — `setcolor`, `openAppSettings`, `shareFile` | ✅ |
| `app/tauri-plugin-blinko/src/models.rs` | Added `ShareFileRequest` | ✅ |
| `app/tauri-plugin-blinko/src/commands.rs` | Added `share_file` command | ✅ |
| `app/tauri-plugin-blinko/src/mobile.rs` | Added `share_file` to mobile impl | ✅ |
| `app/tauri-plugin-blinko/src/desktop.rs` | Added no-op `share_file` | ✅ |
| `app/tauri-plugin-blinko/src/lib.rs` | Registered `share_file` in invoke handler | ✅ |
| `app/tauri-plugin-blinko/build.rs` | Added `share_file` to COMMANDS | ✅ |
| `app/tauri-plugin-blinko/guest-js/index.ts` | Exported `shareFile()` | ✅ |
| `app/tauri-plugin-blinko/dist-js/index.js` + `.cjs` | Rebuilt | ✅ |
| `app/tauri-plugin-blinko/permissions/default.toml` | Added `allow-share-file` | ✅ |
| `app/tauri-plugin-blinko/permissions/autogenerated/commands/shareFile.toml` | Created | ✅ |
| `app/tauri-plugin-blinko/android/BlinkoPlugin.kt` | Added `shareFile` @Command | ✅ |
| `app/tauri-plugin-blinko/android/Blinko.kt` | Added `shareFile` (Intent share) | ✅ |
| `app/package.json` | Added `tauri:ios:dev`, `tauri:ios:build` scripts | ✅ |
| `app/src-tauri/gen/apple/` | Generated by `tauri ios init` | ✅ |
| `app/src-tauri/gen/apple/project.yml` | Added NSCamera/Microphone/PhotoLibrary descriptions | ✅ |
| `app/src-tauri/tauri.ios.conf.json` | Added `developmentTeam` + `minimumSystemVersion` | ✅ |
| `app/src/lib/tauriHelper.ts` | Added `isIOS()`, fixed download, theme, mic perms | ✅ |
| `app/index.html` | Added `viewport-fit=cover` | ✅ |
| `app/src/styles/globals.css` | Added safe-area + keyboard CSS | ✅ |
| `app/src/store/blinkoStore.tsx` | Added `offlinePendingOps` for edits/deletes | ✅ |
| `app/src/store/baseStore.ts` | Triggers sync on `online` event | ✅ |
| `app/src/lib/attachmentCache.ts` | Created — attachment offline caching | ✅ |
| `app/src/lib/noteCache.ts` | Created — Dexie/IndexedDB note cache | ✅ |
| `app/src-tauri/tauri.ios.conf.json` | Phase 4.5 — added `frontendDist` + `beforeBuildCommand` (G9) | ✅ |
| `app/src/lib/blinkoEndpoint.ts` | Phase 4.5 — default endpoint to `https://bk.hax429.me` in Tauri | ✅ |

### Planned (Phase 8 — OTA)

| File | Change | Status |
|------|--------|--------|
| `scripts/build-app-bundle.ts` | Create — produce `manifest.json` + `bundle-<ver>.zip` after vite build | ⏳ |
| `app/package.json` | `build:web` post-step calls bundle generator | ⏳ |
| `app/src-tauri/tauri.ios.conf.json` | Remove `devUrl`; add `frontendDist`; window URL `bundle://localhost/index.html` | ⏳ |
| `app/src-tauri/Cargo.toml` | Add deps `zip`, `sha2`, `reqwest` (or use `tauri-plugin-http`) | ⏳ |
| `app/src-tauri/src/bundle_updater.rs` | Create — fetch manifest, download, verify, extract, flip pointer | ⏳ |
| `app/src-tauri/src/bundle_resolver.rs` | Create — resolves a request path → file path in active bundle or baseline | ⏳ |
| `app/src-tauri/src/lib.rs` | Register `bundle://` URI scheme; spawn updater task on `setup()` | ⏳ |
| `app/src/lib/blinkoEndpoint.ts` | Default endpoint to `https://bk.hax429.me` if unset | ⏳ |

### Planned (Phase 6 — Tests)

| File | Change | Status |
|------|--------|--------|
| `app/src/store/__tests__/offlineQueue.test.ts` | Offline queue unit tests | ⏳ |
| `app/src/lib/__tests__/tauriHelper.test.ts` | Platform detection unit tests | ⏳ |
| `app/src/lib/__tests__/attachmentCache.test.ts` | Cache unit tests | ⏳ |

---

## 9. Next Steps

After Phase 4.5 shipped (cold-launch offline via build-time bundle on 2026-05-25), in priority order:

1. **Test on physical iPhone** — follow §5.1 Steps 0–5. This is the validation gate for Phase 4.5; nothing else should happen until offline cold-launch is confirmed on Gabriel Wang's iPhone 17 Pro Max.
2. **Phase 7 — TestFlight upload** (§5.5). Once §5.1 verifies on one device, push to TestFlight so the build is reproducible and reachable on devices without a paired Mac. Pre-req: a one-time App Store Connect listing for `me.hax429.bk`.
3. **Phase 6 — Tests.** Lock in regression coverage for the offline queue (`offlinePendingOps`, `offlineNoteStorage`, `syncOfflineNotes` ordering) and `blinkoEndpoint.ts` default behavior before more refactors layer on top. Files planned in §8.
4. **Phase 8 — OTA bundle updater** (delivers G10). Only worth doing once you start shipping frontend changes that you don't want to push through TestFlight every time. Phase 4.5 already covers tasks 8c and 8f, so the remaining work is server-side bundle generation + Rust updater/resolver.
5. **Phase 5 — macOS polish.** Signing, notarization, GitHub releases. Independent of iOS work — schedule whenever a macOS distribution is needed.

---

## 10. Device & Account Info

- Apple Developer account: `bondi240827@gmail.com` (NOT `hax42g@gmail.com`)
- Team: Yuan Lin, ID `5L7AP54366`
- Bundle ID: `me.hax429.bk`
- Test device: Gabriel Wang's iPhone 17 Pro Max
  - UDID: `88CEEC75-5E0B-58BB-A3E8-73407340A8ED` (also `00008150-000A319E210B401C` in xcodebuild output)
- Backend: `https://bk.hax429.me` (Oracle Cloud)
- iOS deployment target: 14.0
