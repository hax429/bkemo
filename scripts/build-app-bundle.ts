/**
 * OTA bundle generator (Phase 8b — see MOBILE_CLIENT_DESIGN.md §3a / IOS.md §2.2).
 *
 * Runs after `vite build`. Zips the built frontend (`dist/public`) into
 * `dist/public/app-bundle/bundle-<version>.zip` and writes a `manifest.json` that
 * the iOS/macOS OTA updater fetches to decide whether to pull a new frontend.
 *
 *   bun scripts/build-app-bundle.ts                 # version from root package.json
 *   APP_BUNDLE_MIN_NATIVE=1.8.0 bun scripts/build-app-bundle.ts
 *
 * Wired into `build:web` so every web build refreshes the bundle. Served by the
 * existing `express.static('dist/public')` — no new server routes.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'public');
const OUT_DIR = path.join(DIST, 'app-bundle');

function readVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return String(pkg.version || '0.0.0');
}

/** Recursively collect files under `dir`, excluding the output bundle dir. */
function collect(dir: string, base: string, acc: { abs: string; rel: string }[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (path.resolve(abs) === path.resolve(OUT_DIR)) continue; // never zip ourselves
    if (entry.isDirectory()) collect(abs, base, acc);
    else acc.push({ abs, rel: path.relative(base, abs) });
  }
}

function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`[app-bundle] ${DIST}/index.html not found — run the web build first.`);
    process.exit(1);
  }

  const version = readVersion();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files: { abs: string; rel: string }[] = [];
  collect(DIST, DIST, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel)); // deterministic order

  const zip = new AdmZip();
  for (const f of files) zip.addFile(f.rel.split(path.sep).join('/'), fs.readFileSync(f.abs));
  const buf = zip.toBuffer();

  const zipName = `bundle-${version}.zip`;
  fs.writeFileSync(path.join(OUT_DIR, zipName), buf);

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const manifest = {
    version,
    sha256,
    url: `/app-bundle/${zipName}`,
    size: buf.length,
    files: files.length,
    minNativeVersion: process.env.APP_BUNDLE_MIN_NATIVE || version,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const mb = (buf.length / 1024 / 1024).toFixed(2);
  console.log(`[app-bundle] v${version} · ${files.length} files · ${mb} MB · sha256 ${sha256.slice(0, 12)}…`);
  console.log(`[app-bundle] → ${path.relative(ROOT, path.join(OUT_DIR, zipName))} + manifest.json`);
}

main();
