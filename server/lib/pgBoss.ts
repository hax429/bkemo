import { PgBoss } from 'pg-boss';
import { runtimeDatabaseUrl } from './runtimeDatabaseUrl';

let boss: PgBoss | null = null;

/**
 * Get or create the pg-boss instance
 * Uses singleton pattern to ensure only one instance exists
 */
export async function getPgBoss(): Promise<PgBoss> {
  if (!boss) {
    const connectionString = runtimeDatabaseUrl();
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // pg-boss v12 moved retry/retention options (retryLimit, retryDelay,
    // retryBackoff, deleteAfterSeconds, …) out of the constructor — they are now
    // per-queue/per-send QueueOptions. Only database + scheduling/maintenance
    // options belong here.
    boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
    });

    boss.on('error', (error) => {
      console.error('[pg-boss] Error:', error);
    });

    boss.on('monitor-states', (states) => {
      if (states.all.active > 0) {
        console.log(`[pg-boss] Active jobs: ${states.all.active}`);
      }
    });

    await boss.start();
    console.log('[pg-boss] Started successfully');
  }
  
  return boss;
}

/**
 * Stop the pg-boss instance gracefully
 */
export async function stopPgBoss(): Promise<void> {
  if (boss) {
    console.log('[pg-boss] Stopping...');
    await boss.stop({ graceful: true, timeout: 30000 });
    boss = null;
    console.log('[pg-boss] Stopped successfully');
  }
}

/**
 * Check if pg-boss is running
 */
export function isPgBossRunning(): boolean {
  return boss !== null;
}

