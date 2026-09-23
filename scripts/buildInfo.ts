/**
 * Build stamp shared by the web (Vite) and server (esbuild) bundles, so
 * Settings → About can show which build is live. `build` is the commit count on
 * the deployed branch: it only goes up, which makes "did the update land?"
 * a single-number comparison.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type BuildInfo = { version: string; build: string; commit: string; builtAt: string };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export function getBuildInfo(): BuildInfo {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commit = git('rev-parse --short HEAD') || 'unknown';
  const dirty = git('status --porcelain --untracked-files=no') ? '-dirty' : '';
  return {
    version,
    build: git('rev-list --count HEAD') || '0',
    commit: commit + dirty,
    builtAt: new Date().toISOString(),
  };
}
