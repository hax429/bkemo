import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../../prisma/seed';
import { prisma } from '../prisma';
import { pauseBackgroundJobs, startBackgroundJobs } from './jobLifecycle';

const WARN_BYTES = 400 * 1024 * 1024;
const BLOCK_BYTES = 450 * 1024 * 1024;
const activeJobs = new Set<string>();
let maintenanceCache: { value: boolean; expiresAt: number } | null = null;

export type DatabaseMigrationPreflight = {
  targetHost: string;
  targetDatabase: string;
  sourceDatabase: string;
  sourceBytes: number;
  estimatedBytes: number;
  sourceTableCount: number;
  targetPostgresVersion: string;
  pgDumpVersion: string;
  quotaWarning: boolean;
  quotaBlocked: boolean;
  destinationEmpty: true;
};

export function sanitizeDatabaseMigrationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Database migration failed';
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"\]]+/gi, '[redacted database URL]')
    .replace(/(password|passphrase|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/npg_[A-Za-z0-9_-]+/g, '[redacted password]')
    .slice(0, 2000);
}

export function parsePostgresTarget(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString.trim());
  } catch {
    throw new Error('Enter a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('The destination must use postgresql://');
  if (!url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
    throw new Error('The PostgreSQL URL must include host, database, username, and password');
  }
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
    throw new Error('The hosted PostgreSQL destination must require TLS with sslmode=require or stronger');
  }
  return {
    url,
    host: url.hostname,
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

function safeDsn(connectionString: string) {
  const parsed = new URL(connectionString);
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  return {
    dsn: parsed.toString(),
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '15' },
  };
}

async function findBinary(name: 'pg_dump' | 'pg_restore') {
  const configured = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, name) : null;
  const candidates = [
    configured,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await runProcess(candidate, ['--version'], process.env, 15_000);
      return candidate;
    } catch {
      // Try the next well-known location.
    }
  }
  throw new Error(`${name} is unavailable. Install PostgreSQL client tools or set PG_BIN_DIR on the server`);
}

async function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30 * 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${path.basename(command)} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-16_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed: ${stderr || `exit ${code}`}`));
    });
  });
}

async function withTarget<T>(connectionString: string, callback: (client: PrismaClient) => Promise<T>) {
  const target = new PrismaClient({
    log: [],
    datasources: { db: { url: connectionString } },
  });
  try {
    return await callback(target);
  } finally {
    await target.$disconnect().catch(() => undefined);
  }
}

async function publicTables(client: PrismaClient) {
  return client.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
}

type DatabaseObject = { schema_name: string; object_name: string; object_type: string };

export async function databaseObjects(client: PrismaClient): Promise<DatabaseObject[]> {
  return client.$queryRawUnsafe<DatabaseObject[]>(`
    SELECT n.nspname AS schema_name, c.relname AS object_name, 'relation:'::text || c.relkind::text AS object_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND n.nspname <> 'neon_auth'
      AND pg_get_userbyid(c.relowner) <> 'neon_service'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
    UNION ALL
    SELECT n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'routine:'::text || p.prokind::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND n.nspname <> 'neon_auth'
      AND pg_get_userbyid(p.proowner) <> 'neon_service'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
    UNION ALL
    SELECT n.nspname, n.nspname, 'schema'
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('public', 'information_schema', 'neon_auth')
      AND n.nspname !~ '^pg_'
      AND pg_get_userbyid(n.nspowner) <> 'neon_service'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e'
      )
    ORDER BY 1, 2, 3
  `);
}

function databaseObjectKeys(objects: DatabaseObject[]) {
  return objects.map((item) => `${item.object_type}:${item.schema_name}.${item.object_name}`).sort();
}

async function databaseInfo(client: PrismaClient) {
  const rows = await client.$queryRawUnsafe<Array<{ database: string; bytes: string; version: string }>>(
    `SELECT current_database() AS database, pg_database_size(current_database())::bigint::text AS bytes, current_setting('server_version') AS version`,
  );
  return rows[0]!;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function tableRowCounts(client: PrismaClient, tables: string[]) {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const rows = await client.$queryRawUnsafe<Array<{ count: string }>>(`SELECT COUNT(*)::bigint::text AS count FROM public.${quoteIdentifier(table)}`);
    result[table] = Number(rows[0]?.count ?? 0);
  }
  return result;
}

function currentDatabaseHost() {
  try {
    return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : '';
  } catch {
    return '';
  }
}

export function setDatabaseMaintenanceCache(value: boolean) {
  maintenanceCache = { value, expiresAt: Date.now() + 5_000 };
}

export async function isDatabaseWriteLocked() {
  if (maintenanceCache && maintenanceCache.expiresAt > Date.now()) return maintenanceCache.value;
  const job = await prisma.databaseMigrationJob.findFirst({
    where: { maintenanceMode: true },
    orderBy: { createdAt: 'desc' },
    select: { targetHost: true },
  }).catch(() => null);
  // A cloned target contains the source's maintenance row. It is safe to open
  // writes once the process is actually connected to that target host.
  const value = !!job && job.targetHost !== currentDatabaseHost();
  maintenanceCache = { value, expiresAt: Date.now() + 5_000 };
  return value;
}

async function verifySuperadminPassword(accountId: number, password: string) {
  const account = await prisma.accounts.findUnique({ where: { id: accountId }, select: { role: true, password: true } });
  if (!account || account.role !== 'superadmin') throw new Error('Only the superadmin can migrate the site database');
  if (!(await verifyPassword(password, account.password))) throw new Error('Current password is incorrect');
}

export async function preflightDatabaseMigration(connectionString: string, accountId: number, password: string): Promise<DatabaseMigrationPreflight> {
  await verifySuperadminPassword(accountId, password);
  const target = parsePostgresTarget(connectionString);
  if (target.host === currentDatabaseHost()) throw new Error('The destination is the database currently used by this server');

  const pgDump = await findBinary('pg_dump');
  await findBinary('pg_restore');
  const pgDumpVersion = (await runProcess(pgDump, ['--version'], process.env, 15_000)).stdout.trim();
  const [sourceInfo, sourceTables, targetResult] = await Promise.all([
    databaseInfo(prisma),
    publicTables(prisma),
    withTarget(connectionString, async (client) => ({ info: await databaseInfo(client), objects: await databaseObjects(client) })),
  ]).catch((error) => { throw new Error(sanitizeDatabaseMigrationError(error)); });

  if (targetResult.objects.length) {
    throw new Error(`Destination is not empty (${targetResult.objects.length} user object(s) found). Use a new empty Neon database`);
  }
  const sourceBytes = Number(sourceInfo.bytes);
  const estimatedBytes = Math.ceil(sourceBytes * 1.15);
  return {
    targetHost: target.host,
    targetDatabase: target.database,
    sourceDatabase: sourceInfo.database,
    sourceBytes,
    estimatedBytes,
    sourceTableCount: sourceTables.length,
    targetPostgresVersion: targetResult.info.version,
    pgDumpVersion,
    quotaWarning: estimatedBytes >= WARN_BYTES,
    quotaBlocked: estimatedBytes >= BLOCK_BYTES,
    destinationEmpty: true,
  };
}

async function updateTargetJob(connectionString: string, jobId: string, status: string, message: string) {
  await withTarget(connectionString, async (client) => {
    await client.databaseMigrationJob.update({
      where: { id: jobId },
      data: { status, message, maintenanceMode: false, completedAt: new Date() },
    });
  });
}

async function runDatabaseMigration(jobId: string, connectionString: string) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  let tempDir: string | null = null;
  try {
    const target = parsePostgresTarget(connectionString);
    const sourceUrl = process.env.DATABASE_URL;
    if (!sourceUrl) throw new Error('DATABASE_URL is not configured');
    const source = safeDsn(sourceUrl);
    const destination = safeDsn(connectionString);
    const pgDump = await findBinary('pg_dump');
    const pgRestore = await findBinary('pg_restore');

    await prisma.databaseMigrationJob.update({
      where: { id: jobId },
      data: { status: 'pausing', maintenanceMode: true, message: 'Blocking writes and pausing background jobs' },
    });
    setDatabaseMaintenanceCache(true);
    await pauseBackgroundJobs();

    const sourceTables = (await publicTables(prisma)).map((row) => row.table_name);
    const sourceObjectKeys = databaseObjectKeys(await databaseObjects(prisma));
    const sourceCounts = await tableRowCounts(prisma, sourceTables);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bkemo-db-migration-'));
    const dumpPath = path.join(tempDir, 'site.dump');
    await prisma.databaseMigrationJob.update({ where: { id: jobId }, data: { status: 'dumping', message: 'Creating a consistent PostgreSQL snapshot' } });
    await runProcess(pgDump, ['--format=custom', '--no-owner', '--no-acl', '--file', dumpPath, '--dbname', source.dsn], source.env);

    const targetObjects = await withTarget(connectionString, databaseObjects);
    if (targetObjects.length) throw new Error('Destination stopped being empty before restore; migration was cancelled');
    await prisma.databaseMigrationJob.update({ where: { id: jobId }, data: { status: 'restoring', message: `Restoring the snapshot to ${target.host}` } });
    await runProcess(pgRestore, ['--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--dbname', destination.dsn, dumpPath], destination.env);

    await prisma.databaseMigrationJob.update({ where: { id: jobId }, data: { status: 'verifying', message: 'Comparing every public table row count' } });
    const targetCounts = await withTarget(connectionString, (client) => tableRowCounts(client, sourceTables));
    const mismatches = sourceTables.filter((table) => sourceCounts[table] !== targetCounts[table]);
    if (mismatches.length) throw new Error(`Verification failed for ${mismatches.slice(0, 8).join(', ')}`);
    const targetObjectKeys = databaseObjectKeys(await withTarget(connectionString, databaseObjects));
    const missingObjects = sourceObjectKeys.filter((key) => !targetObjectKeys.includes(key));
    const unexpectedObjects = targetObjectKeys.filter((key) => !sourceObjectKeys.includes(key));
    if (missingObjects.length || unexpectedObjects.length) {
      throw new Error(`Schema verification failed (${missingObjects.length} missing, ${unexpectedObjects.length} unexpected object(s))`);
    }

    const readyMessage = 'Copy verified. Set DATABASE_URL to the Neon pooled connection and restart bkemo';
    await updateTargetJob(connectionString, jobId, 'ready', readyMessage);
    await prisma.databaseMigrationJob.update({
      where: { id: jobId },
      data: {
        status: 'ready',
        verifiedTableCount: sourceTables.length,
        maintenanceMode: true,
        message: readyMessage,
        completedAt: new Date(),
      },
    });
    setDatabaseMaintenanceCache(true);
  } catch (error) {
    const message = sanitizeDatabaseMigrationError(error);
    await prisma.databaseMigrationJob.update({
      where: { id: jobId },
      data: { status: 'failed', maintenanceMode: false, message, completedAt: new Date() },
    }).catch(() => undefined);
    setDatabaseMaintenanceCache(false);
    await startBackgroundJobs().catch((resumeError) => console.error('Failed to resume background jobs after database migration:', sanitizeDatabaseMigrationError(resumeError)));
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    activeJobs.delete(jobId);
  }
}

export async function startDatabaseMigration(input: {
  connectionString: string;
  password: string;
  confirmHost: string;
  overrideQuota?: boolean;
}, accountId: number) {
  const active = await prisma.databaseMigrationJob.findFirst({ where: { status: { in: ['queued', 'pausing', 'dumping', 'restoring', 'verifying', 'ready'] } } });
  if (active) throw new Error('A database migration or cutover is already active');
  const preflight = await preflightDatabaseMigration(input.connectionString, accountId, input.password);
  if (input.confirmHost !== preflight.targetHost) throw new Error('Destination host confirmation did not match');
  if (preflight.quotaBlocked && !input.overrideQuota) throw new Error('Estimated restored size exceeds 450 MiB. Explicit quota override is required');

  const id = randomUUID();
  await prisma.databaseMigrationJob.create({
    data: {
      id,
      status: 'queued',
      targetHost: preflight.targetHost,
      targetDatabase: preflight.targetDatabase,
      sourceDatabase: preflight.sourceDatabase,
      sourceBytes: BigInt(preflight.sourceBytes),
      estimatedBytes: BigInt(preflight.estimatedBytes),
      sourceTableCount: preflight.sourceTableCount,
      requestedById: accountId,
      message: 'Migration queued',
    },
  });
  void runDatabaseMigration(id, input.connectionString);
  return getDatabaseMigrationStatus(id);
}

export async function cancelReadyDatabaseMigration(jobId: string, accountId: number, password: string, confirmation: string) {
  await verifySuperadminPassword(accountId, password);
  if (confirmation !== 'UNLOCK LOCAL DATABASE') throw new Error('Confirmation text did not match');
  const job = await prisma.databaseMigrationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'ready') throw new Error('No ready cutover can be cancelled');
  await prisma.databaseMigrationJob.update({
    where: { id: jobId },
    data: { status: 'cancelled', maintenanceMode: false, message: 'Local database unlocked; Neon copy retained', completedAt: new Date() },
  });
  setDatabaseMaintenanceCache(false);
  await startBackgroundJobs();
  return getDatabaseMigrationStatus(jobId);
}

function serializeJob(job: any) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    targetHost: job.targetHost,
    targetDatabase: job.targetDatabase,
    sourceDatabase: job.sourceDatabase,
    sourceBytes: Number(job.sourceBytes),
    estimatedBytes: Number(job.estimatedBytes),
    sourceTableCount: job.sourceTableCount,
    verifiedTableCount: job.verifiedTableCount,
    maintenanceMode: job.maintenanceMode,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export async function getDatabaseMigrationStatus(jobId?: string) {
  const job = jobId
    ? await prisma.databaseMigrationJob.findUnique({ where: { id: jobId } })
    : await prisma.databaseMigrationJob.findFirst({ orderBy: { createdAt: 'desc' } });
  return serializeJob(job);
}

/** A connection URL is intentionally never persisted, so an interrupted copy
 * cannot resume after process restart. Mark it failed and safely reopen local
 * writes; the transactional restore leaves the empty target unchanged. */
export async function recoverInterruptedDatabaseMigrationJobs() {
  const interrupted = await prisma.databaseMigrationJob.updateMany({
    where: { status: { in: ['queued', 'pausing', 'dumping', 'restoring', 'verifying'] } },
    data: {
      status: 'failed',
      maintenanceMode: false,
      message: 'Migration was interrupted by a server restart. The local database was unlocked; retry with an empty destination',
      completedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }));
  if (interrupted.count) setDatabaseMaintenanceCache(false);
  return interrupted.count;
}
