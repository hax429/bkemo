/**
 * End-to-end smoke test for the bkemo REST API against a running dev server.
 *
 * Run via the wrapper (loads .env):  ./scripts/test-api.sh
 * Or directly:  API_BASE=http://localhost:1111 bun scripts/test-api.ts
 *
 * It mints a full-access token (no permission scoping) from the first account,
 * resolves each endpoint's HTTP method from /api/openapi.json, then exercises the
 * main flows (notes CRUD, tags, attachments, comments, reactions, notifications,
 * follows, analytics, access tokens, sharing) and prints a PASS/FAIL summary.
 * Everything it creates is cleaned up at the end.
 */
import { prisma } from '../server/prisma';
import { generateApiToken } from '../server/lib/helper';

const BASE = (process.env.API_BASE || 'http://localhost:1111').replace(/\/$/, '');
const API = `${BASE}/api`;

// ── result tracking ──
type Row = { name: string; ok: boolean; status: number | string; note?: string };
const rows: Row[] = [];
let TOKEN = '';
let methods: Record<string, string> = {};

const c = { green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };

function record(name: string, ok: boolean, status: number | string, note?: string) {
  rows.push({ name, ok, status, note });
  const tag = ok ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
  console.log(`  ${tag} ${c.dim}[${String(status).padStart(3)}]${c.reset} ${name}${note ? `  ${c.dim}${note}${c.reset}` : ''}`);
}

/** Call a tRPC-openapi endpoint, resolving GET/POST from the spec (default POST). */
async function call(path: string, opts: { body?: any; params?: Record<string, any>; method?: string; token?: string | null } = {}) {
  const method = (opts.method || methods[path] || 'POST').toUpperCase();
  let url = `${API}${path}`;
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let body: string | undefined;
  if (method === 'GET') {
    const p = opts.params ?? opts.body ?? {};
    const qs = Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`).join('&');
    if (qs) url += `?${qs}`;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, method };
}

/** Run a test: pass when status is in `expect` (default [200]). Returns the response. */
async function test(name: string, path: string, opts: Parameters<typeof call>[1] & { expect?: number[] } = {}) {
  const expect = opts.expect ?? [200];
  try {
    const r = await call(path, opts);
    const ok = expect.includes(r.status);
    const note = `${r.method} ${path}${ok ? '' : ` · ${typeof r.json === 'object' ? JSON.stringify(r.json).slice(0, 120) : String(r.json).slice(0, 120)}`}`;
    record(name, ok, r.status, note);
    return r;
  } catch (e: any) {
    record(name, false, 'ERR', `${path} · ${e?.message ?? e}`);
    return { status: 0, json: null, method: '' };
  }
}

function section(title: string) { console.log(`\n${c.bold}${title}${c.reset}`); }

async function main() {
  console.log(`${c.bold}bkemo API smoke test${c.reset} → ${BASE}\n`);

  // 1) Server reachable + load the spec for method resolution.
  try {
    const r = await fetch(`${API}/openapi.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const spec = await r.json();
    for (const [p, ops] of Object.entries<any>(spec.paths ?? {})) {
      const m = Object.keys(ops).find((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k));
      if (m) methods[p] = m.toUpperCase();
    }
    record('GET /api/openapi.json (spec loaded)', true, r.status, `${Object.keys(methods).length} endpoints`);
  } catch (e: any) {
    console.error(`${c.red}Cannot reach the dev server at ${BASE} — is it running on :1111?${c.reset}`, e?.message ?? e);
    process.exit(1);
  }

  // 2) Mint a full-access token from the first account (no permissions = unscoped).
  const acc = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!acc) { console.error('No account in the database.'); process.exit(1); }
  TOKEN = await generateApiToken({ id: acc.id, name: acc.name, role: acc.role });
  console.log(`${c.dim}Acting as account #${acc.id} (${acc.name}, ${acc.role})${c.reset}`);

  // auth sanity: a request with no token must be 401
  await test('auth: missing token → 401', '/v1/note/list', { body: { page: 1, size: 1 }, token: null, expect: [401] });

  let memoId = 0, todoId = 0, refTargetId = 0, shareUrl = '';
  let commentId = 0, tokenId = 0, uploadPath = '', attachmentId = 0;

  // ── Notes ──
  section('Notes');
  {
    const r = await test('note.upsert (create memo)', '/v1/note/upsert', { body: { content: '# API test memo\n\nbody text for [[link]] test' } });
    memoId = r.json?.id ?? 0;
  }
  {
    const r = await test('note.upsert (create todo)', '/v1/note/upsert', { body: { content: '- [ ] api test task', type: 2, isImportant: true, dueDate: new Date(Date.now() + 86400000).toISOString() } });
    todoId = r.json?.id ?? 0;
  }
  {
    const r = await test('note.upsert (create ref target)', '/v1/note/upsert', { body: { content: 'reference target memo' } });
    refTargetId = r.json?.id ?? 0;
  }
  await test('note.list', '/v1/note/list', { body: { page: 1, size: 10 } });
  await test('note.list (task filter)', '/v1/note/list', { body: { page: 1, size: 10, isCompleted: false } });
  if (memoId) await test('note.detail', '/v1/note/detail', { body: { id: memoId } });
  if (memoId) await test('note.list-by-ids', '/v1/note/list-by-ids', { body: { ids: [memoId, todoId] } });
  if (todoId) await test('note.toggle-done', '/v1/note/toggle-done', { body: { id: todoId, done: true } });
  if (memoId) await test('note.batch-update (pin)', '/v1/note/batch-update', { body: { ids: [memoId], isTop: true } });
  if (memoId && refTargetId) await test('note.add-reference', '/v1/note/add-reference', { body: { fromNoteId: memoId, toNoteId: refTargetId } });
  if (memoId) await test('note.reference-list', '/v1/note/reference-list', { body: { noteId: memoId } });
  await test('note.daily-review-list', '/v1/note/daily-review-list', { params: {} });
  await test('note.random-list', '/v1/note/random-list', { params: {} });
  if (memoId) await test('note.related-notes', '/v1/note/related-notes', { params: { id: memoId } });
  if (memoId) await test('note.history', '/v1/note/history', { params: { noteId: memoId } });
  await test('note.shared-with-me', '/v1/note/shared-with-me', { body: {} });

  // ── Sharing + public ──
  section('Sharing & public');
  if (memoId) {
    const r = await test('note.share (create link)', '/v1/note/share', { body: { id: memoId, isCancel: false } });
    shareUrl = r.json?.shareEncryptedUrl ?? '';
  }
  await test('note.public-list', '/v1/note/public-list', { body: { page: 1, size: 10 }, token: null });
  if (shareUrl) await test('note.public-detail', '/v1/note/public-detail', { body: { shareEncryptedUrl: shareUrl }, token: null });

  // ── Reactions (public, on a note) ──
  section('Reactions');
  if (memoId) {
    await test('reaction.toggle (add 👍)', '/v1/reaction/toggle', { body: { noteId: memoId, emoji: '👍' } });
    await test('reaction.list', '/v1/reaction/list', { body: { noteId: memoId } });
    await test('reaction.toggle (remove 👍)', '/v1/reaction/toggle', { body: { noteId: memoId, emoji: '👍' } });
  }

  // ── Comments ──
  section('Comments');
  if (memoId) {
    const r = await test('comment.create', '/v1/comment/create', { body: { content: 'api test comment', noteId: memoId } });
    // comment.create returns boolean; fetch the id via list
    const list = await test('comment.list', '/v1/comment/list', { body: { noteId: memoId } });
    commentId = Array.isArray(list.json) ? (list.json[0]?.id ?? list.json?.items?.[0]?.id ?? 0) : (list.json?.items?.[0]?.id ?? 0);
    if (commentId) await test('comment.update', '/v1/comment/update', { body: { id: commentId, content: 'api test comment (edited)' } });
    if (commentId) await test('comment.delete', '/v1/comment/delete', { body: { id: commentId } });
  }

  // ── Tags ──
  section('Tags');
  await test('tag.list', '/v1/tags/list', { body: {} });

  // ── Attachments (upload → link → list → delete) ──
  section('Attachments');
  {
    const form = new FormData();
    form.append('file', new Blob(['hello bkemo api test'], { type: 'text/plain' }), 'api-test.txt');
    try {
      const res = await fetch(`${API}/file/upload`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
      const j: any = await res.json().catch(() => null);
      uploadPath = j?.filePath ?? j?.path ?? '';
      record('file.upload (multipart)', res.ok && !!uploadPath, res.status, uploadPath || JSON.stringify(j).slice(0, 100));
    } catch (e: any) { record('file.upload (multipart)', false, 'ERR', e?.message); }
  }
  if (uploadPath && memoId) {
    await test('note.upsert (attach file)', '/v1/note/upsert', { body: { id: memoId, attachments: [{ id: 0, isShare: false, sharePassword: '', name: 'api-test.txt', path: uploadPath, size: 20, noteId: null, accountId: null, createdAt: new Date().toISOString(), sortOrder: 0, updatedAt: new Date().toISOString(), type: 'text/plain' }] } });
  }
  {
    const r = await test('attachment.all-files', '/v1/attachment/all-files', { params: {} });
    const found = Array.isArray(r.json) ? r.json.find((a: any) => a.path === uploadPath) : null;
    attachmentId = found?.id ?? 0;
  }
  if (attachmentId) await test('attachment.delete', '/v1/attachment/delete', { body: { id: attachmentId } });

  // ── Notifications ──  (only list + create are exposed over REST)
  section('Notifications');
  await test('notification.list', '/v1/notification/list', { params: { page: 1, size: 10 } });
  await test('notification.create', '/v1/notification/create', { body: { type: 'system', content: 'api smoke test', title: 'test' } });

  // ── Follows ──
  section('Follows');
  await test('follows.recommand-list', '/v1/follows/recommand-list', { params: {} });
  await test('follows.follow-list', '/v1/follows/follow-list', { params: {} });
  await test('follows.followers', '/v1/follows/followers', { params: {} });

  // ── Analytics ──
  section('Analytics');
  await test('analytics.daily-note-count', '/v1/analytics/daily-note-count', { body: {} });
  await test('analytics.monthly-stats', '/v1/analytics/monthly-stats', { body: { month: new Date().toISOString().slice(0, 7) } });

  // ── Access tokens ──
  section('Access tokens');
  await test('accessTokens.scopes', '/v1/access-token/scopes', { params: {} });
  await test('accessTokens.list', '/v1/access-token/list', { params: {} });
  {
    const r = await test('accessTokens.create', '/v1/access-token/create', { body: { name: 'api-smoke-test', scopes: ['notes:read'], expiresInDays: 1 } });
    tokenId = r.json?.id ?? 0;
    // the freshly minted token should be able to read but not write
    const minted = r.json?.token;
    if (minted) {
      await test('  scoped token: read allowed', '/v1/note/list', { body: { page: 1, size: 1 }, token: minted, expect: [200] });
      await test('  scoped token: write blocked → 403', '/v1/note/upsert', { body: { content: 'nope' }, token: minted, expect: [403] });
    }
  }
  if (tokenId) await test('accessTokens.revoke', '/v1/access-token/revoke', { body: { id: tokenId } });

  // ── Cleanup ──
  section('Cleanup');
  const cleanupIds = [memoId, todoId, refTargetId].filter(Boolean);
  if (cleanupIds.length) {
    await test('note.batch-trash', '/v1/note/batch-trash', { body: { ids: cleanupIds } });
    await test('note.batch-delete', '/v1/note/batch-delete', { body: { ids: cleanupIds } });
  }
  await test('note.clear-recycle-bin', '/v1/note/clear-recycle-bin', { body: {} });

  // ── Summary ──
  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${c.bold}── Summary ──${c.reset}`);
  console.log(`${c.green}${passed} passed${c.reset}, ${failed.length ? c.red : c.dim}${failed.length} failed${c.reset}, ${rows.length} total`);
  if (failed.length) {
    console.log(`\n${c.yellow}Failures:${c.reset}`);
    failed.forEach((f) => console.log(`  ${c.red}✗${c.reset} ${f.name} ${c.dim}[${f.status}] ${f.note ?? ''}${c.reset}`));
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
