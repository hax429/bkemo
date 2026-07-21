import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { deriveDirectNeonUrl, parsePostgresTarget, sanitizeDatabaseMigrationError, verifySuperadminPassword } from './databaseMigration';
import { prismaMigrateInvocation } from './databaseCutoverProtocol';

const REQUIRED_TABLES = ['_prisma_migrations', 'accounts', 'attachments', 'config', 'notes'];

export type DevelopmentNeonAttachGuard = {
  nodeEnv?: string;
  allowExisting?: string;
  consumed: boolean;
};

export function assertDevelopmentNeonAttachAllowed(input: DevelopmentNeonAttachGuard) {
  if (input.nodeEnv === 'production') throw new Error('Existing Neon attachment is unavailable in production');
  if (input.allowExisting?.toLowerCase() !== 'true') throw new Error('Existing Neon attachment is not enabled for this local environment');
  if (input.consumed) throw new Error('The one-use existing Neon attachment approval has already been used');
}

export function validateExistingNeonSchema(tables: string[]) {
  if (!tables.length) throw new Error('The development destination must already contain bkemo data');
  const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
  if (missing.length) throw new Error(`This is not a compatible bkemo database (${missing.join(', ')} missing)`);
  return { tableCount: tables.length };
}

export function replaceDatabaseUrl(contents: string, connectionString: string) {
  const line = `DATABASE_URL=${JSON.stringify(connectionString)}`;
  if (/^DATABASE_URL=.*$/m.test(contents)) return contents.replace(/^DATABASE_URL=.*$/m, line);
  return `${contents.replace(/\s*$/, '')}\n${line}\n`;
}

function configureAttachedDevelopmentEnvironment(contents: string, connectionString: string) {
  const withDatabase = replaceDatabaseUrl(contents, connectionString);
  const line = 'BKEMO_DEV_ATTACHED_NEON=true';
  if (/^BKEMO_DEV_ATTACHED_NEON=.*$/m.test(withDatabase)) return withDatabase.replace(/^BKEMO_DEV_ATTACHED_NEON=.*$/m, line);
  return `${withDatabase.replace(/\s*$/, '')}\n${line}\n`;
}

function projectDirectory() {
  if (process.env.BKEMO_PROJECT_DIR) return path.resolve(process.env.BKEMO_PROJECT_DIR);
  return path.basename(process.cwd()) === 'server' ? path.resolve(process.cwd(), '..') : process.cwd();
}

function environmentFile(root = projectDirectory()) {
  return path.resolve(process.env.BKEMO_ENV_FILE || path.join(root, '.env'));
}

function approvalMarker(root = projectDirectory()) {
  return path.join(root, '.bkemo', 'dev-existing-neon-attach.json');
}

export async function getDevelopmentNeonAttachStatus(root = projectDirectory()) {
  const consumed = existsSync(approvalMarker(root));
  try {
    assertDevelopmentNeonAttachAllowed({
      nodeEnv: process.env.NODE_ENV,
      allowExisting: process.env.BKEMO_DEV_ALLOW_EXISTING_NEON,
      consumed,
    });
    return { available: true, consumed: false, reason: '', environment: process.env.NODE_ENV || 'development' };
  } catch (error) {
    return {
      available: false,
      consumed,
      reason: error instanceof Error ? error.message : 'Existing Neon attachment is unavailable',
      environment: process.env.NODE_ENV || 'development',
    };
  }
}

async function inspectExistingNeon(pooledConnectionString: string) {
  const pooled = parsePostgresTarget(pooledConnectionString);
  const directConnectionString = deriveDirectNeonUrl(pooledConnectionString);
  const client = new PrismaClient({ datasources: { db: { url: directConnectionString } } });
  try {
    const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const schema = validateExistingNeonSchema(rows.map((row) => row.table_name));
    const [accountCount, superadminCount] = await Promise.all([
      client.accounts.count(),
      client.accounts.count({ where: { role: 'superadmin' } }),
    ]);
    if (!superadminCount) throw new Error('The existing Neon database has no superadmin account');
    return {
      targetHost: pooled.host,
      targetDatabase: pooled.database,
      confirmation: `${pooled.host}/${pooled.database}`,
      tableCount: schema.tableCount,
      accountCount,
      superadminCount,
      directConnectionString,
    };
  } finally {
    await client.$disconnect();
  }
}

async function isolateDevelopmentAttachmentConfiguration(directConnectionString: string) {
  const client = new PrismaClient({ datasources: { db: { url: directConnectionString } } });
  const entries: Array<[string, unknown]> = [
    ['objectStorage', 'local'],
    ['localCustomPath', 'development'],
    ['s3Endpoint', ''],
    ['s3Region', 'auto'],
    ['s3Bucket', ''],
    ['s3AccessKeyId', ''],
    ['s3AccessKeySecret', ''],
    ['s3CustomPath', ''],
    ['s3ForcePathStyle', true],
  ];
  try {
    await client.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.config.deleteMany({ where: { key, userId: null } });
        await tx.config.create({ data: { key, config: { type: typeof value, value } } });
      }
    });
  } finally {
    await client.$disconnect();
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory(), env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4_000); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(sanitizeDatabaseMigrationError(new Error(`${path.basename(command)} failed (${code}): ${stderr.slice(-1_000)}`))));
    });
  });
}

async function authorizedDevelopmentNeonPreflight(pooledConnectionString: string, accountId: number, password: string) {
  const status = await getDevelopmentNeonAttachStatus();
  assertDevelopmentNeonAttachAllowed({
    nodeEnv: process.env.NODE_ENV,
    allowExisting: process.env.BKEMO_DEV_ALLOW_EXISTING_NEON,
    consumed: status.consumed,
  });
  await verifySuperadminPassword(accountId, password);
  return inspectExistingNeon(pooledConnectionString);
}

export async function preflightDevelopmentNeonAttach(pooledConnectionString: string, accountId: number, password: string) {
  const { directConnectionString: _directConnectionString, ...result } = await authorizedDevelopmentNeonPreflight(pooledConnectionString, accountId, password);
  return result;
}

export async function attachExistingDevelopmentNeon(input: {
  pooledConnectionString: string;
  password: string;
  confirmation: string;
}, accountId: number) {
  const root = projectDirectory();
  const preflight = await authorizedDevelopmentNeonPreflight(input.pooledConnectionString, accountId, input.password);
  if (input.confirmation !== preflight.confirmation) throw new Error('Neon host and database confirmation did not match');

  const marker = approvalMarker(root);
  await mkdir(path.dirname(marker), { recursive: true });
  await writeFile(marker, JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  let environmentChanged = false;
  try {
    const migration = prismaMigrateInvocation(root, process.execPath);
    await run(migration.command, migration.args, { ...process.env, DATABASE_URL: preflight.directConnectionString });
    const verified = await inspectExistingNeon(input.pooledConnectionString);
    await isolateDevelopmentAttachmentConfiguration(preflight.directConnectionString);

    const envFile = environmentFile(root);
    const previous = await readFile(envFile, 'utf8');
    const temporary = `${envFile}.existing-neon-${process.pid}`;
    await writeFile(temporary, configureAttachedDevelopmentEnvironment(previous, input.pooledConnectionString), { mode: 0o600 });
    await rename(temporary, envFile);
    await chmod(envFile, 0o600);
    environmentChanged = true;

    await writeFile(marker, JSON.stringify({
      status: 'completed',
      host: verified.targetHost,
      database: verified.targetDatabase,
      completedAt: new Date().toISOString(),
    }), { mode: 0o600 });
    return {
      ok: true,
      restartRequired: true,
      targetHost: verified.targetHost,
      targetDatabase: verified.targetDatabase,
      message: 'Existing Neon development database configured. Restart the local bkemo server to connect.',
    };
  } catch (error) {
    if (!environmentChanged) await unlink(marker).catch(() => undefined);
    throw error;
  }
}
