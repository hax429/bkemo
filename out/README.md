# out

Client sources and all build artifacts that are not the `app`/`server`/`shared`
workspace packages:

| Path | Role |
| --- | --- |
| `obsidian/` | Private Obsidian companion plugin source |
| `ios/` | Native SwiftUI iOS app (XcodeGen) |
| `macos/` | Tauri v2 macOS shell (Rust). `app/src-tauri` symlinks here for the Tauri CLI |
| `output/` | All publishable / production build products |

Build helpers: `scripts/build_ob.sh`, `scripts/build_ios.sh`, `scripts/build_macos.sh`,
plus the normal web/server `build:web` pipeline.
