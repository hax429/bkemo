import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export type StorageActivityInput = {
  category: 'attachment-provider' | 'attachment-transfer' | 'database-transfer' | 'active-setup';
  action: string;
  status: string;
  source?: string;
  destination?: string;
  summary: string;
  details?: Prisma.InputJsonValue;
  requestedById?: number;
};

function redact(value: string) {
  return value
    .replace(/(?:postgres(?:ql)?|s3):\/\/[^\s]+/gi, '[redacted connection]')
    .replace(/(access[_ -]?key|secret[_ -]?key|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1_000);
}

/** Activity logging must never make the storage operation itself fail. */
export async function recordStorageActivity(input: StorageActivityInput) {
  return prisma.storageActivityLog.create({
    data: {
      id: randomUUID(),
      ...input,
      summary: redact(input.summary),
      completedAt: new Date(),
    },
  }).catch((error) => {
    console.error('Could not record storage activity:', error instanceof Error ? error.message : error);
    return null;
  });
}

function currentDatabaseStatus() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const hostname = url.hostname.toLowerCase();
    const neon = hostname.endsWith('.neon.tech');
    return {
      provider: neon ? 'neon' as const : 'local' as const,
      host: hostname,
      pooled: neon && hostname.includes('-pooler.'),
    };
  } catch {
    return { provider: 'local' as const, host: '', pooled: false };
  }
}

export async function getStorageActivity() {
  const [events, attachmentJobs, databaseJobs] = await Promise.all([
    prisma.storageActivityLog.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.storageMigrationJob.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.databaseMigrationJob.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

  const rows = [
    ...events.map((event) => ({
      id: event.id,
      category: event.category,
      action: event.action,
      status: event.status,
      source: event.source,
      destination: event.destination,
      summary: event.summary,
      details: event.details,
      createdAt: event.createdAt,
      completedAt: event.completedAt,
    })),
    ...attachmentJobs.map((job) => ({
      id: `attachment:${job.id}`,
      category: 'attachment-transfer',
      action: job.direction,
      status: job.status,
      source: job.sourceProvider,
      destination: job.destinationProvider,
      summary: `${job.migrated} transferred, ${job.skipped} stale skipped, ${job.failed} failed`,
      details: {
        totalCount: job.totalCount,
        totalBytes: Number(job.totalBytes),
        migratedBytes: Number(job.migratedBytes),
        cleanupStatus: job.cleanupStatus,
        cleanupDeleted: job.cleanupDeleted,
        cleanupFailed: job.cleanupFailed,
      },
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
    ...databaseJobs.map((job) => ({
      id: `database:${job.id}`,
      category: 'database-transfer',
      action: job.direction,
      status: job.status,
      source: job.direction === 'neon-to-local' ? 'neon' : 'local-postgresql',
      destination: job.direction === 'neon-to-local' ? 'local-postgresql' : 'neon',
      summary: job.message ?? `Database migration ${job.status}`,
      details: {
        targetHost: job.targetHost,
        targetDatabase: job.targetDatabase,
        sourceBytes: Number(job.sourceBytes),
        verifiedTableCount: job.verifiedTableCount,
        maintenanceMode: job.maintenanceMode,
      },
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
  ];

  return {
    database: currentDatabaseStatus(),
    records: rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}
