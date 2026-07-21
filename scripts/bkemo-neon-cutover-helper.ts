#!/usr/bin/env bun
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { prepareNeonDestinationForCutover } from '../server/lib/databaseCutoverProtocol';

const socketPath = process.env.BKEMO_CUTOVER_SOCKET || '/run/bkemo-cutover.sock';
const projectDirectory = process.env.BKEMO_PROJECT_DIR || process.cwd();
const environmentFile = process.env.BKEMO_ENV_FILE || path.join(projectDirectory, '.env');
const serviceName = process.env.BKEMO_SERVICE_NAME || 'bkemo.service';
const healthUrl = process.env.BKEMO_HEALTH_URL || 'http://127.0.0.1:1111/health';
const statusFile = process.env.BKEMO_CUTOVER_STATUS_FILE || '/run/bkemo-cutover-status.json';
let active = false;

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database URL]')
    .replace(/npg_[A-Za-z0-9_-]+/g, '[redacted password]')
    .slice(0, 1_000);
}

async function setStatus(jobId: string, state: 'running' | 'awaiting-verification' | 'failed', message: string) {
  await writeFile(statusFile, JSON.stringify({ jobId, state, message: safeMessage(message), updatedAt: new Date().toISOString() }), { mode: 0o640 });
  const group = process.env.BKEMO_SOCKET_GROUP;
  if (group) await run('/usr/bin/chgrp', [group, statusFile], process.env, 10_000);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 120_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(-4_000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code}): ${stderr.slice(-1_000)}`));
    });
  });
}

function replaceDatabaseUrl(contents: string, connectionString: string) {
  const line = `DATABASE_URL=${JSON.stringify(connectionString)}`;
  if (/^DATABASE_URL=.*$/m.test(contents)) return contents.replace(/^DATABASE_URL=.*$/m, line);
  return `${contents.replace(/\s*$/, '')}\n${line}\n`;
}

function readDatabaseUrl(contents: string) {
  const value = contents.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
  if (!value) throw new Error('DATABASE_URL is missing from the retained local environment');
  if (value.startsWith('"')) return JSON.parse(value);
  return value.replace(/^['"]|['"]$/g, '');
}

function pgConnection(connectionString: string) {
  const url = new URL(connectionString);
  const password = decodeURIComponent(url.password);
  url.password = '';
  return { dsn: url.toString(), env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '15' } };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The service is expected to be unavailable briefly while restarting.
    }
    await Bun.sleep(1_000);
  }
  throw new Error('bkemo did not become healthy within 30 seconds');
}

async function performCutover(payload: any) {
  const jobId = String(payload.jobId || '');
  const pooled = new URL(String(payload.pooledConnectionString || ''));
  const direct = new URL(String(payload.directConnectionString || ''));
  const expectedHost = String(payload.expectedTargetHost || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) throw new Error('Cutover job ID is invalid');
  if (!pooled.hostname.endsWith('.neon.tech') || !pooled.hostname.includes('-pooler.')) throw new Error('Pooled URL is not a Neon pooled endpoint');
  if (!direct.hostname.endsWith('.neon.tech') || direct.hostname.includes('-pooler.')) throw new Error('Direct URL is not a Neon direct endpoint');
  if (direct.hostname.toLowerCase() !== expectedHost) throw new Error('Direct URL does not match the verified Neon host');

  const bun = process.execPath;
  await prepareNeonDestinationForCutover({
    jobId,
    migrate: () => run(bun, ['run', 'prisma:migrate:deploy'], { ...process.env, DATABASE_URL: direct.toString() }, 30 * 60_000),
    createClient: () => new PrismaClient({ datasources: { db: { url: direct.toString() } } }),
  });

  const previous = await readFile(environmentFile, 'utf8');
  const backup = `${environmentFile}.pre-neon`;
  if (!existsSync(backup)) {
    await copyFile(environmentFile, backup);
    await chmod(backup, 0o600);
  }
  const temporary = `${environmentFile}.cutover-${process.pid}`;
  await writeFile(temporary, replaceDatabaseUrl(previous, pooled.toString()), { mode: 0o600 });
  await rename(temporary, environmentFile);

  try {
    await run('/usr/bin/systemctl', ['restart', serviceName], process.env, 60_000);
    await waitForHealth();
  } catch (error) {
    await copyFile(backup, environmentFile);
    await chmod(environmentFile, 0o600);
    await run('/usr/bin/systemctl', ['restart', serviceName], process.env, 60_000).catch(() => undefined);
    throw error;
  }
}

async function performReturnLocal(payload: any) {
  const pooled = new URL(String(payload.pooledConnectionString || ''));
  if (!pooled.hostname.endsWith('.neon.tech') || !pooled.hostname.includes('-pooler.')) throw new Error('Current database is not a Neon pooled endpoint');
  const direct = new URL(pooled.toString());
  direct.hostname = direct.hostname.replace(/-pooler(?=\.)/i, '');

  const retainedEnvironment = `${environmentFile}.pre-neon`;
  if (!existsSync(retainedEnvironment)) throw new Error('The retained local PostgreSQL environment backup is unavailable');
  const localConnectionString = readDatabaseUrl(await readFile(retainedEnvironment, 'utf8'));
  const localUrl = new URL(localConnectionString);
  if (localUrl.hostname.endsWith('.neon.tech')) throw new Error('The retained database is not local PostgreSQL');

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'bkemo-return-local-'));
  const snapshot = path.join(temporaryDirectory, 'neon-current.dump');
  const backupDirectory = path.join(projectDirectory, 'backups');
  const localBackup = path.join(backupDirectory, `local-before-return-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  const source = pgConnection(direct.toString());
  const destination = pgConnection(localConnectionString);
  await mkdir(backupDirectory, { recursive: true });

  try {
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', snapshot, '--dbname', source.dsn], source.env, 30 * 60_000);
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', localBackup, '--dbname', destination.dsn], destination.env, 30 * 60_000);
    await chmod(localBackup, 0o600);
    await run('pg_restore', ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--dbname', destination.dsn, snapshot], destination.env, 30 * 60_000);

    const currentEnvironment = await readFile(environmentFile, 'utf8');
    const temporaryEnvironment = `${environmentFile}.return-${process.pid}`;
    await writeFile(temporaryEnvironment, replaceDatabaseUrl(currentEnvironment, localConnectionString), { mode: 0o600 });
    await rename(temporaryEnvironment, environmentFile);
    try {
      await run('/usr/bin/systemctl', ['restart', serviceName], process.env, 60_000);
      await waitForHealth();
    } catch (error) {
      await writeFile(environmentFile, replaceDatabaseUrl(currentEnvironment, pooled.toString()), { mode: 0o600 });
      await run('/usr/bin/systemctl', ['restart', serviceName], process.env, 60_000).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await mkdir(path.dirname(socketPath), { recursive: true });
await unlink(socketPath).catch(() => undefined);

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || !['/cutover', '/return-local'].includes(request.url || '')) {
    response.writeHead(404).end('Not found');
    return;
  }
  if (active) {
    response.writeHead(409).end('A cutover is already running');
    return;
  }
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 16_384) request.destroy();
  });
  request.on('end', () => {
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { response.writeHead(400).end('Invalid JSON'); return; }
    active = true;
    response.writeHead(202, { 'content-type': 'application/json' }).end('{"accepted":true}');
    const operation = request.url === '/return-local' ? performReturnLocal : performCutover;
    const jobId = String((payload as any).jobId || (payload as any).id || '');
    setTimeout(() => {
      void setStatus(jobId, 'running', 'Guarded database transfer is running')
        .then(() => operation(payload))
        .then(() => setStatus(jobId, 'awaiting-verification', 'Destination restarted and is waiting for authenticated verification'))
        .catch(async (error) => {
          console.error('Guarded Neon cutover failed:', safeMessage(error));
          await setStatus(jobId, 'failed', safeMessage(error));
        })
        .finally(() => { active = false; });
    }, 250);
  });
});

server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  const group = process.env.BKEMO_SOCKET_GROUP;
  if (group) await run('/usr/bin/chgrp', [group, socketPath], process.env, 10_000);
  console.log(`bkemo guarded cutover helper listening on ${socketPath}`);
});
