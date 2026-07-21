import type { StorageConnectionResult, StorageSettings } from './storageConnection';

type DatabaseQueryResult = { database: string };

export type ActiveSetupVerificationDependencies = {
  databaseUrl?: string;
  queryDatabase: () => Promise<DatabaseQueryResult>;
  loadStorageSettings: () => Promise<StorageSettings>;
  testStorage: (settings: StorageSettings) => Promise<StorageConnectionResult>;
  timeoutMs?: number;
};

type VerificationCheck = {
  ok: boolean;
  provider: string;
  message: string;
  latencyMs: number;
};

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/postgres(?:ql)?:\/\/[^\s'"\]]+/gi, '[redacted database URL]')
    .replace(/npg_[A-Za-z0-9_-]+/g, '[redacted password]')
    .replace(/(access[_ -]?key|secret[_ -]?key|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

export function maskInfrastructureHost(hostname: string) {
  const labels = hostname.toLowerCase().split('.');
  if (labels.length < 3 || hostname === 'localhost') return hostname.toLowerCase();
  const first = labels[0]!;
  const masked = first.length > 12 ? `${first.slice(0, 3)}…${first.slice(-7)}` : `${first.slice(0, 2)}…`;
  return `${masked}.${labels.slice(-2).join('.')}`;
}

async function withinTimeout<T>(operation: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} verification timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyActiveSetup(dependencies: ActiveSetupVerificationDependencies) {
  const timeoutMs = dependencies.timeoutMs ?? 15_000;
  let databaseProvider = 'unknown';
  let databaseHost = '';
  let pooled = false;
  try {
    const parsed = new URL(dependencies.databaseUrl ?? '');
    databaseHost = parsed.hostname.toLowerCase();
    databaseProvider = databaseHost.endsWith('.neon.tech') ? 'neon' : 'local';
    pooled = databaseProvider === 'neon' && databaseHost.includes('-pooler.');
  } catch {
    // The database check below returns the actionable configuration error.
  }

  const databaseStarted = Date.now();
  const databasePromise = withinTimeout(dependencies.queryDatabase, timeoutMs, 'Database')
    .then((result) => ({
      ok: true,
      provider: databaseProvider,
      pooled,
      host: maskInfrastructureHost(databaseHost),
      database: result.database,
      message: `${databaseProvider === 'neon' ? 'Neon PostgreSQL' : 'PostgreSQL'} query passed`,
      latencyMs: Date.now() - databaseStarted,
    }))
    .catch((error): VerificationCheck & { pooled: boolean; host: string; database?: string } => ({
      ok: false,
      provider: databaseProvider,
      pooled,
      host: maskInfrastructureHost(databaseHost),
      message: safeMessage(error),
      latencyMs: Date.now() - databaseStarted,
    }));

  const attachmentStarted = Date.now();
  let attachmentProvider = 'unknown';
  const attachmentPromise = withinTimeout(async () => {
    const settings = await dependencies.loadStorageSettings();
    attachmentProvider = settings.provider;
    const result = await dependencies.testStorage(settings);
    return { settings, result };
  }, timeoutMs, 'Attachment storage')
    .then(({ settings, result }) => ({
      ok: true,
      provider: settings.provider,
      message: result.message,
      location: result.location,
      latencyMs: Date.now() - attachmentStarted,
    }))
    .catch((error): VerificationCheck & { location?: string } => ({
      ok: false,
      provider: attachmentProvider,
      message: safeMessage(error),
      latencyMs: Date.now() - attachmentStarted,
    }));

  const [database, attachments] = await Promise.all([databasePromise, attachmentPromise]);
  return {
    ok: database.ok && attachments.ok,
    verifiedAt: new Date().toISOString(),
    database,
    attachments,
  };
}
