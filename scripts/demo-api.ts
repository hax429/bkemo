/**
 * Demo / seed script: creates REAL, rich memos & todos via the REST API and
 * prints the full returned JSON so you can inspect the responses — and then see
 * the data on the Home page (nothing is deleted).
 *
 *   ./scripts/demo-api.sh         (loads .env, targets http://localhost:1111)
 *   API_BASE=… bun scripts/demo-api.ts
 */
import { prisma } from '../server/prisma';
import { generateApiToken } from '../server/lib/helper';

const BASE = (process.env.API_BASE || 'http://localhost:1111').replace(/\/$/, '');
const API = `${BASE}/api`;
const c = { b: '\x1b[1m', dim: '\x1b[2m', grn: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
let TOKEN = '';

async function call(method: string, path: string, body?: any, token: string | null = TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload: string | undefined;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function show(label: string, status: number, json: any) {
  const okColor = status >= 200 && status < 300 ? c.grn : c.red;
  console.log(`\n${c.b}${c.cyan}▶ ${label}${c.reset}  ${okColor}[${status}]${c.reset}`);
  console.log(typeof json === 'string' ? json : JSON.stringify(json, null, 2));
}

async function main() {
  const acc = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (!acc) { console.error('No account found.'); process.exit(1); }
  TOKEN = await generateApiToken({ id: acc.id, name: acc.name, role: acc.role });
  console.log(`${c.dim}Acting as account #${acc.id} (${acc.name}) on ${BASE}${c.reset}`);

  // ── 1) A rich markdown memo ──
  const memoContent = [
    '# 🚀 Project Kickoff Notes',
    '',
    'Some **bold**, *italic*, and `inline code`. A link to [bkemo](https://github.com).',
    '',
    '## Agenda',
    '1. Review the designs',
    '2. Lock the API surface',
    '3. Schedule the launch',
    '',
    '### Open questions',
    '- How do we handle offline sync?',
    '- What is the rollback plan?',
    '',
    '> "Make it work, make it right, make it fast." — Kent Beck',
    '',
    '```ts',
    'export const ship = (feature: string) => `🚢 ${feature}`;',
    '```',
    '',
    '| Phase | Owner | Status |',
    '| --- | --- | --- |',
    '| Design | Ana | done |',
    '| Build | You | wip |',
    '',
    '#project #demo',
  ].join('\n');
  const memo = await call('POST', '/v1/note/upsert', { content: memoContent });
  show('Create rich markdown MEMO', memo.status, memo.json);
  const memoId = memo.json?.id;

  // ── 2) An urgent + important todo with a due date ──
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(23, 59, 0, 0);
  const todo = await call('POST', '/v1/note/upsert', {
    content: [
      '## 🔥 Ship v1 to production',
      '',
      'Cut the release once these are green:',
      '- [ ] All API smoke tests pass',
      '- [ ] Migrations applied',
      '- [x] Access tokens reviewed',
      '',
      'Blocking the **launch**. #release',
    ].join('\n'),
    type: 2, // NoteType.TODO
    isImportant: true,
    isUrgent: true,
    dueDate: tomorrow.toISOString(),
  });
  show('Create URGENT + IMPORTANT TODO (due tomorrow)', todo.status, todo.json);
  const todoId = todo.json?.id;

  // ── 3) A subtask of that todo ──
  const subtask = await call('POST', '/v1/note/upsert', {
    content: '- [ ] Tag the release commit and draft notes  #release',
    type: 2,
    isImportant: true,
    parentNoteId: todoId,
    dueDate: tomorrow.toISOString(),
  });
  show('Create SUBTASK (parentNoteId → the todo)', subtask.status, subtask.json);

  // ── 4) A comment on the memo ──
  const comment = await call('POST', '/v1/comment/create', { content: 'Looks great — let’s add the rollback plan. 👍', noteId: memoId });
  show('Add a COMMENT to the memo', comment.status, comment.json);
  const comments = await call('POST', '/v1/comment/list', { noteId: memoId });
  show('List comments on the memo', comments.status, comments.json);

  // ── 5) Reactions ──
  await call('POST', '/v1/reaction/toggle', { noteId: memoId, emoji: '🚀' });
  await call('POST', '/v1/reaction/toggle', { noteId: memoId, emoji: '❤️' });
  const reactions = await call('POST', '/v1/reaction/list', { noteId: memoId });
  show('Reactions on the memo (🚀 + ❤️)', reactions.status, reactions.json);

  // ── 6) Share the memo + read its public view ──
  const shared = await call('POST', '/v1/note/share', { id: memoId, isCancel: false });
  show('Share the memo (public link)', shared.status, shared.json);
  const shareUrl = shared.json?.shareEncryptedUrl;
  if (shareUrl) {
    console.log(`${c.dim}   → ${BASE}/m/${shareUrl}${c.reset}`);
    const pub = await call('POST', '/v1/note/public-detail', { shareEncryptedUrl: shareUrl }, null);
    show('Public detail (no auth)', pub.status, pub.json);
  }

  // ── 7) Tags created from the #hashtags ──
  const tags = await call('GET', '/v1/tags/list', undefined);
  show('Tag tree (from #project #demo #release)', tags.status, tags.json);

  // ── 8) Create a scoped access token ──
  const tok = await call('POST', '/v1/access-token/create', { name: 'Demo token', scopes: ['notes:read', 'notes:write'], expiresInDays: 30 });
  show('Create an access token (notes:read + notes:write)', tok.status, tok.json);

  // ── 9) The full list as the API returns it ──
  const list = await call('POST', '/v1/note/list', { page: 1, size: 5 });
  show('note.list (first 5, as the API returns them)', list.status, Array.isArray(list.json) ? list.json.map((n: any) => ({ id: n.id, type: n.type, isImportant: n.isImportant, isUrgent: n.isUrgent, dueDate: n.dueDate, completedAt: n.completedAt, attachments: n.attachments?.length ?? 0, comments: n._count?.comments, reactions: n._count?.reactions, preview: (n.content ?? '').slice(0, 60) })) : list.json);

  console.log(`\n${c.b}${c.grn}✓ Done.${c.reset} Created memo BK-${memoId}, todo BK-${todoId} (+subtask). ${c.dim}Open the Home page to see them — nothing was deleted.${c.reset}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
