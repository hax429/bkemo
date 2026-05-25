# Blinko iOS / macOS — Plan, Build & Verification

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
| G9 | **Cold-launch offline** | Airplane mode at app start → shell still loads, can capture notes | ⏳ Pending (Phase 8 — OTA) |
| G10 | **Auto frontend update from server** | Push to `dist/public` on server → next app launch shows new code | ⏳ Pending (Phase 8 — OTA) |
| G11 | App Store / TestFlight ready | Passes Xcode archive + App Store validation | ⏳ Pending |

---

## 2. Architecture

### 2.1 Current architecture (as of 2026-05-25)

```
┌──────────────────────────────────────────┐         ┌────────────────────────────┐
│  iOS / macOS App (Tauri WKWebView)       │         │   bk.hax429.me             │
│                                          │         │                            │
│  Window URL: https://bk.hax429.me        │ ──GET── │ /  (index.html + assets)   │
│  (devUrl in tauri.ios.conf.json)         │ ──API── │ /api/trpc, /api/file, etc. │
│                                          │         └────────────────────────────┘
│  Native plugins (Swift): setStatusBarColor,
│  openAppSettings, shareFile              │
└──────────────────────────────────────────┘
```

**Pros:** Frontend updates instantly when server is updated; no native release needed.
**Cons:** Cold launch with no network shows a blank screen — WebView can't fetch the shell. All the offline-write code in `blinkoStore.tsx` never runs because the shell never loads. The service worker partially mitigates this once installed, but iOS WKWebView's SW storage is fragile (evicted under storage pressure).

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
| Keep `devUrl` remote (current) | ✅ instant | ❌ blank screen | Done | Insufficient for G9 |
| PWA service worker hardening | ✅ instant | ⚠️ flaky (SW evictable) | Low | Adopted as defense-in-depth |
| **OTA bundle (chosen)** | ✅ next launch | ✅ always | Medium | Best balance |
| Frontend bundled at build time, no OTA | ❌ App Store only | ✅ always | Low | Fails G10 |

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
| 5 | macOS Polish (signing, distribution) | ⏳ Pending | — |
| 6 | Testing Suite (offline queue + helpers unit tests) | ⏳ Pending | — |
| 7 | Distribution (TestFlight / GitHub releases) | ⏳ Pending | — |
| **8** | **OTA Bundle Updater (cold-launch offline + auto frontend update)** | 🔄 **In progress** | — |

### Phase 0–4 — completed work summary

**Phase 0:** Installed CocoaPods, ran `bunx tauri ios init`, added `tauri:ios:dev` + `tauri:ios:build` scripts.

**Phase 1:** Swift plugin at `app/tauri-plugin-blinko/ios/`:
- `setcolor` — overlays status-bar-area `UIView` with hex color (tag `9_001` for replace-on-repeat)
- `openAppSettings` — opens `UIApplication.openSettingsURLString`
- `shareFile` — presents `UIActivityViewController` with a remote URL

**Phase 2:** Permission strings (`NSCameraUsageDescription`, etc.) in `app/src-tauri/gen/apple/project.yml`. Team ID `5L7AP54366` + `minimumSystemVersion: "14.0"` in `app/src-tauri/tauri.ios.conf.json`.

**Phase 3:** `app/src/lib/tauriHelper.ts` — `isIOS()` helper, `downloadFromLink` iOS branch using `shareFile`, `setTauriTheme` iOS branch, `requestMicrophonePermission` iOS branch. `app/index.html` viewport `viewport-fit=cover`. `app/src/styles/globals.css` safe-area + Vditor padding.

**Phase 4:** `app/src/store/blinkoStore.tsx` — `offlinePendingOps` (edits/deletes queue) alongside existing `offlineNoteStorage` (creates). `syncOfflineNotes` processes both, halts on first failure. `app/src/store/baseStore.ts` emits `app:online`. `app/src/lib/attachmentCache.ts` caches files to `BaseDirectory.AppCache`. `app/src/lib/noteCache.ts` uses Dexie/IndexedDB for offline note reads.

### Phase 8 — OTA implementation plan

| # | Task | Status |
|---|---|---|
| 8a | Design OTA protocol (manifest, on-device layout, fallback) | ✅ See §2.2 |
| 8b | Server: `scripts/build-app-bundle.ts` produces `dist/public/app-bundle/{manifest.json, bundle-<ver>.zip}`; wire into `app/package.json:build:web` | ⏳ Pending |
| 8c | App: switch `tauri.ios.conf.json` from `devUrl` to `frontendDist`; set window URL to `bundle://localhost/index.html` | ⏳ Pending |
| 8d | App: Rust `bundle_updater` module — fetch manifest, download, verify SHA-256, extract, flip pointer | ⏳ Pending |
| 8e | App: Rust `bundle_resolver` + custom URI scheme `bundle://localhost/` — serves from active extracted bundle, falls back to baseline | ⏳ Pending |
| 8f | App: `app/src/lib/blinkoEndpoint.ts` — default endpoint to `https://bk.hax429.me` if unset; keep prompt as override | ⏳ Pending |
| 8g | Verification: airplane-mode cold launch → shell loads → online → new bundle downloaded → next launch uses new bundle | ⏳ Pending |

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

### 5.1 iOS — physical device (current, pre-OTA)

> The `xcodebuild` CLI cannot sign builds under Xcode 16 (`error: No Account for Team "5L7AP54366"`); signing must go through the Xcode GUI.

**Step 1 — Compile Rust for iOS device:**
```bash
cd /Users/hax429/Developer/blinko/app/src-tauri
SDKROOT=$(xcrun -sdk iphoneos --show-sdk-path) \
IPHONEOS_DEPLOYMENT_TARGET=14.0 \
cargo build --target aarch64-apple-ios --release
```
~30s incremental, ~90s first build.

**Step 2 — Copy library to Xcode project:**
```bash
cp /Users/hax429/Developer/blinko/app/src-tauri/target/aarch64-apple-ios/release/libapp_lib.a \
   /Users/hax429/Developer/blinko/app/src-tauri/gen/apple/Externals/arm64/release/libapp.a
```
> cargo outputs `libapp_lib.a` (from crate `app_lib`), but Xcode expects `libapp.a`.

**Step 3 — Regenerate Xcode project (only if `project.yml` changed):**
```bash
cd /Users/hax429/Developer/blinko/app/src-tauri/gen/apple
xcodegen generate
```

**Step 4 — Build and install via Xcode GUI:**
1. Open `app/src-tauri/gen/apple/Blinko.xcodeproj`
2. Select scheme **Blinko_iOS**
3. Select **Gabriel Wang's iPhone** as destination
4. Set Run configuration to **Release**: Product → Scheme → Edit Scheme → Run → Build Configuration → release
5. **Product → Clean Build Folder** (⇧⌘K) if `libapp.a` was changed
6. **⌘R** — builds, signs, installs, and launches on device

### 5.2 iOS — simulator (dev / hot-reload)

```bash
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
source "$HOME/.cargo/env"
cd /Users/hax429/Developer/blinko/app
RUST_BACKTRACE=1 bun run tauri:ios:dev
```

Compiles Vite → Rust (`aarch64-apple-ios-sim`) → Swift plugin → launches the iOS Simulator.

### 5.3 macOS desktop build

```bash
cd /Users/hax429/Developer/blinko/app
bun run tauri:desktop:build
# Output: src-tauri/target/release/bundle/macos/Blinko.app
open src-tauri/target/release/bundle/macos/Blinko.app
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
cd /Users/hax429/Developer/blinko/app
bun run tauri:ios:build
open src-tauri/gen/apple/Blinko.xcodeproj
# 1. Select Blinko_iOS scheme, "Any iOS Device (arm64)" destination
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
  src-tauri/target/release/bundle/macos/Blinko.app

# Notarize
ditto -c -k --sequesterRsrc --keepParent \
  src-tauri/target/release/bundle/macos/Blinko.app \
  Blinko.zip
xcrun notarytool submit Blinko.zip \
  --apple-id bondi240827@gmail.com \
  --team-id 5L7AP54366 \
  --wait

# Staple
xcrun stapler staple src-tauri/target/release/bundle/macos/Blinko.app
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
| Frontend before Phase 8 | No — frontend currently loads live from `https://bk.hax429.me` | n/a |

---

## 6. Debug Reference

### 6.1 Live iOS simulator logs

```bash
xcrun simctl spawn booted log stream --predicate 'processImagePath CONTAINS "Blinko"'
```

### 6.2 Tauri Rust + Swift output

```bash
RUST_BACKTRACE=1 bun run tauri:ios:dev 2>&1 | tee /tmp/tauri-ios.log
```

### 6.3 Rust compile check only (fast, no Xcode)

```bash
cd /Users/hax429/Developer/blinko/app/src-tauri
cargo check --target aarch64-apple-ios-sim
```

### 6.4 Safari Web Inspector (JS / tRPC errors)

Safari → Develop → Simulator → Blinko → main frame. From the console:

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
ls ~/Library/Logs/DiagnosticReports/ | grep Blinko

# Sandbox violations
log show --predicate 'process == "Blinko"' --last 5m | grep -i "deny"

# Notarization status
spctl -a -vvv /Applications/Blinko.app
```

### 6.6 Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Blank white screen in WebView | Pre-Phase-8: server unreachable | Check `bk.hax429.me` cert + connectivity in Safari |
| `No signing certificate / No team` | xcodebuild CLI cred bug | Open Xcode GUI, sign there |
| Swift plugin: `module not found: SwiftRs` | `.tauri/tauri-api/` not generated | Let `tauri ios dev` run fully once |
| `failed to read CLI options: Connection refused` | Standalone Xcode build with no coordination server | `project.yml` build script's fallback covers this — make sure `libapp.a` is pre-built per §5.1 |
| iOS keyboard covers editor | Missing safe-area CSS | Verify `@supports (-webkit-touch-callout: none)` block in `globals.css` |

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

## 9. Device & Account Info

- Apple Developer account: `bondi240827@gmail.com` (NOT `hax42g@gmail.com`)
- Team: Yuan Lin, ID `5L7AP54366`
- Bundle ID: `me.hax429.blinko`
- Test device: Gabriel Wang's iPhone 17 Pro Max
  - UDID: `88CEEC75-5E0B-58BB-A3E8-73407340A8ED` (also `00008150-000A319E210B401C` in xcodebuild output)
- Backend: `https://bk.hax429.me` (Oracle Cloud)
- iOS deployment target: 14.0
