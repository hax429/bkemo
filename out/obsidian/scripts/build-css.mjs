#!/usr/bin/env node
/**
 * Build como styles.css = bkemo + Codian (from src/codian/style) + como chrome.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const BKEMO_CSS = path.join(PLUGIN_DIR, 'styles.bkemo.css');
const COMO_CHROME = path.join(PLUGIN_DIR, 'styles.como-chrome.css');
const OUT = path.join(PLUGIN_DIR, 'styles.css');
const CODIAN_STYLE_DIR = path.join(PLUGIN_DIR, 'src/codian/style');
const CODIAN_INDEX = path.join(CODIAN_STYLE_DIR, 'index.css');
const IMPORT_PATTERN = /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/gm;

function listCssFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCssFiles(entryPath, baseDir));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(path.relative(baseDir, entryPath).split(path.sep).join('/'));
    }
  }
  return files;
}

function buildCodianCss() {
  if (!existsSync(CODIAN_INDEX)) {
    throw new Error(`Missing Codian style index at ${CODIAN_INDEX}`);
  }
  const content = readFileSync(CODIAN_INDEX, 'utf8');
  const moduleOrder = [...content.matchAll(IMPORT_PATTERN)].map((m) => m[1]);
  if (moduleOrder.length === 0) {
    throw new Error('No @import entries in Codian style index');
  }

  const parts = ['/* Codian styles (src/codian/style) */\n'];
  const normalizedImports = [];
  const missing = [];
  const invalid = [];

  for (const modulePath of moduleOrder) {
    const resolvedPath = path.resolve(CODIAN_STYLE_DIR, modulePath);
    const relativePath = path.relative(CODIAN_STYLE_DIR, resolvedPath);
    if (relativePath.startsWith('..') || !relativePath.endsWith('.css')) {
      invalid.push(modulePath);
      continue;
    }
    const normalized = relativePath.split(path.sep).join('/');
    normalizedImports.push(normalized);
    if (!existsSync(resolvedPath)) {
      missing.push(normalized);
      continue;
    }
    parts.push(
      `\n/* ============================================\n   ${normalized}\n   ============================================ */\n`,
      readFileSync(resolvedPath, 'utf8'),
    );
  }

  const allCss = listCssFiles(CODIAN_STYLE_DIR).filter((f) => f !== 'index.css');
  const imported = new Set(normalizedImports);
  const unlisted = allCss.filter((f) => !imported.has(f));

  if (invalid.length || missing.length || unlisted.length) {
    if (invalid.length) console.error('Invalid Codian CSS imports:', invalid);
    if (missing.length) console.error('Missing Codian CSS files:', missing);
    if (unlisted.length) console.error('Unlisted Codian CSS files:', unlisted);
    process.exit(1);
  }

  return parts.join('\n');
}

const bkemoSource = existsSync(BKEMO_CSS)
  ? BKEMO_CSS
  : path.join(PLUGIN_DIR, 'styles.css');

const parts = [
  '/* === bkemo === */',
  readFileSync(bkemoSource, 'utf8'),
  '/* === codian === */',
  buildCodianCss(),
  '/* === como chrome === */',
  readFileSync(COMO_CHROME, 'utf8'),
];

writeFileSync(OUT, `${parts.join('\n\n')}\n`);
console.log(`Wrote ${OUT}`);
