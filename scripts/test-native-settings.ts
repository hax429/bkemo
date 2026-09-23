/** Local-only integration coverage. Never accepts a hosted API or database. */
import { strict as assert } from 'node:assert';
import { prisma } from '../server/prisma';
import { mintManagedAccessToken } from '../server/lib/accessTokenService';
import { APP_FULL_SCOPE } from '../shared/lib/accessTokenPlatform';
import { settingsOperations } from '../server/lib/nativeSettings';
const base = 'http://localhost:1111';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('Local database required');
const tokens: number[] = [];
let memberId: number | undefined;
async function mint(accountId: number, fullApp: boolean) {
  const token = await mintManagedAccessToken({ accountId, name: 'native-settings-test', platform: 'macos', scopes: fullApp ? [APP_FULL_SCOPE] : ['notes:read'], fullApp, expiresInDays: 1 });
  tokens.push(token.id);
  return token.token;
}
async function call(token?: string, body?: unknown) {
  const response = await fetch(base + '/api/v1/native/settings' + (body ? '/action' : ''), {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Bkemo-Platform': 'macos', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as any };
}
try {
  assert.equal((await call()).status, 401);
  const owner = await prisma.accounts.findFirstOrThrow({ where: { role: 'superadmin' } });
  const full = await mint(owner.id, true);
  const snapshot = await call(full);
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.data));
  assert.equal(snapshot.data.operations.length, settingsOperations.length);
  assert(snapshot.data.config.every((item: any) => !item.secret || item.value === null));
  assert(snapshot.data.operations.some((item: any) => item.id === 'config.saveStorage'));
  const restricted = await mint(owner.id, false);
  const limited = await call(restricted);
  assert.equal(limited.status, 200);
  assert.equal(limited.data.operations.length, 0);
  assert.equal(limited.data.config.length, 0);
  assert.equal((await call(restricted, { operation: 'config.update', input: { key: 'language', value: 'en' } })).status, 403);
  assert.equal((await call(full, { operation: 'users.clearSiteData' })).status, 412);
  assert.equal((await call(full, { operation: 'users.login', input: {} })).status, 403);
  assert.equal((await call(full, { operation: 'config.update', input: { key: 'largeDeviceCardColumns', value: 99 } })).status, 400);
  const member = await prisma.accounts.create({ data: { name: 'native-test-' + crypto.randomUUID(), password: crypto.randomUUID(), role: 'user' } });
  memberId = member.id;
  const memberToken = await mint(member.id, true);
  const memberSnapshot = await call(memberToken);
  assert.equal(memberSnapshot.status, 200);
  assert(!memberSnapshot.data.operations.some((op: any) => ['storage', 'ai', 'mcp', 'task'].includes(op.section)));
  assert.equal((await call(memberToken, { operation: 'config.saveStorage', input: { provider: 'local' } })).status, 403);
  assert.equal((await call(memberToken, { operation: 'config.update', input: { key: 'language', value: 'en' } })).status, 200);
  assert.equal((await call(memberToken)).data.config.find((item: any) => item.key === 'language').value, 'en');
  await prisma.accounts.update({ where: { id: member.id }, data: { permissions: { enabled: false } } });
  assert.equal((await call(memberToken)).status, 401);
  console.log(`PASS: native API authentication, ${snapshot.data.operations.length} action schemas, restricted tokens, live permissions, confirmed actions, input validation, preference round trip.`);
} finally {
  await prisma.accessToken.deleteMany({ where: { id: { in: tokens } } });
  if (memberId) {
    await prisma.config.deleteMany({ where: { userId: memberId } });
    await prisma.accounts.delete({ where: { id: memberId } });
  }
  await prisma.$disconnect();
}
