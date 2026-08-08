# Build output

Everything publishable or production-runnable lands here:

| Path | Produced by | Contents |
| --- | --- | --- |
| `public/` | `bun run build:web` (Vite) | Web frontend assets |
| `index.js` | `bun run build:web` (server esbuild) | Production server bundle |
| `obsidian/` | `./scripts/build_ob.sh` | `bkemo/{main.js,manifest.json,styles.css}` + zip |
| `macos/` | `./scripts/build_macos.sh` | staged `bkemo.app` (and DMG when requested) |
| `ios/` | `./scripts/build_ios.sh` | staged `.app` / archive from the native SwiftUI project |

Production start: `bun out/output/index.js` (with `server/public` → `out/output/public`).
