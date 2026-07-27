import { CronJob } from 'cron';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export type ScheduleTimezone = string;

const timers = new Map<string, CronJob>();
const DEFAULT_CRON = '0 0 * * *';

export async function stopAllScheduleTimers(): Promise<void> {
  for (const timer of timers.values()) timer.stop();
  timers.clear();
}

type LegacySchedule = {
  name: string;
  cron: string;
  data: unknown;
};

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function importLegacySchedule(name: string): Promise<void> {
  const existing = await prisma.systemSchedule.findUnique({ where: { name } });
  if (existing) return;

  try {
    const rows = await prisma.$queryRaw<LegacySchedule[]>(Prisma.sql`
      SELECT name, cron, data
      FROM pgboss.schedule
      WHERE name = ${name}
      LIMIT 1
    `);
    const legacy = rows[0];
    if (!legacy) return;
    const data = (legacy.data && typeof legacy.data === 'object') ? legacy.data as Record<string, unknown> : {};
    await prisma.systemSchedule.create({
      data: {
        name,
        cron: legacy.cron,
        timezone: typeof data.timezone === 'string' ? data.timezone : 'UTC',
        enabled: true,
      },
    });
    console.log(`[${name}] Imported legacy pg-boss schedule`);
  } catch {
    // Fresh installations do not have the pg-boss schema.
  }
}

export abstract class BaseScheduleJob {
  protected static taskName: string;
  protected static cronSchedule: string = DEFAULT_CRON;
  protected static defaultTimezone: ScheduleTimezone = 'UTC';

  protected static async RunTask(): Promise<any> {
    throw new Error('RunTask must be implemented');
  }

  private static installTimer(cron: string, timezone: string): void {
    timers.get(this.taskName)?.stop();
    const owner = this;
    const timer = CronJob.from({
      cronTime: cron,
      timeZone: timezone,
      start: true,
      onTick: () => {
        void owner.executeTask();
      },
    });
    timers.set(this.taskName, timer);
    console.log(`[${this.taskName}] Timer registered: ${cron} (${timezone})`);
  }

  private static async executeTask(): Promise<any> {
    const startedAt = new Date();
    await prisma.systemSchedule.updateMany({
      where: { name: this.taskName },
      data: { lastRunAt: startedAt, lastStatus: 'running' },
    });
    console.log(`[${this.taskName}] Starting job execution...`);
    try {
      const result = await this.RunTask();
      await prisma.systemSchedule.updateMany({
        where: { name: this.taskName },
        data: { lastRunAt: startedAt, lastStatus: 'success', lastOutput: jsonValue(result) },
      });
      console.log(`[${this.taskName}] Job completed successfully`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.systemSchedule.updateMany({
        where: { name: this.taskName },
        data: { lastRunAt: startedAt, lastStatus: 'error', lastOutput: { error: message } },
      }).catch(() => undefined);
      console.error(`[${this.taskName}] Job failed:`, error);
      throw error;
    }
  }

  static async Start(cronTime?: string, immediate: boolean = true, timezone: ScheduleTimezone = this.defaultTimezone): Promise<void> {
    const schedule = cronTime || this.cronSchedule;
    const tz = timezone || 'UTC';

    await prisma.systemSchedule.upsert({
      where: { name: this.taskName },
      update: { cron: schedule, timezone: tz, enabled: true },
      create: { name: this.taskName, cron: schedule, timezone: tz, enabled: true },
    });
    this.installTimer(schedule, tz);
    console.log(`[${this.taskName}] Scheduled with cron: ${schedule} (${tz})`);

    if (immediate) {
      await this.executeTask().catch((error) => {
        console.error(`[${this.taskName}] Immediate run failed:`, error);
      });
    }
  }

  static async Stop(): Promise<void> {
    timers.get(this.taskName)?.stop();
    timers.delete(this.taskName);
    await prisma.systemSchedule.updateMany({
      where: { name: this.taskName },
      data: { enabled: false },
    });
    console.log(`[${this.taskName}] Unscheduled`);
  }

  static async SetCronTime(cronTime: string, timezone?: ScheduleTimezone): Promise<void> {
    const existing = await this.getSchedule();
    const tz = timezone || existing?.timezone || 'UTC';

    await prisma.systemSchedule.upsert({
      where: { name: this.taskName },
      update: { cron: cronTime, timezone: tz, enabled: true },
      create: { name: this.taskName, cron: cronTime, timezone: tz, enabled: true },
    });
    this.installTimer(cronTime, tz);
    console.log(`[${this.taskName}] Rescheduled with cron: ${cronTime} (${tz})`);
  }

  static async TriggerNow(): Promise<string | null> {
    const runId = `${this.taskName}:${Date.now()}`;
    await this.executeTask();
    console.log(`[${this.taskName}] Triggered immediately, runId: ${runId}`);
    return runId;
  }

  static async initialize(defaultSchedule?: string): Promise<void> {
    try {
      await importLegacySchedule(this.taskName);
      const schedule = await prisma.systemSchedule.findUnique({ where: { name: this.taskName } });
      if (schedule?.enabled) {
        this.installTimer(schedule.cron || defaultSchedule || this.cronSchedule, schedule.timezone);
      }
      console.log(`[${this.taskName}] Initialized${schedule?.enabled ? ' and scheduled' : ' (disabled)'}`);
    } catch (error) {
      console.error(`[${this.taskName}] Failed to initialize:`, error);
    }
  }

  static async getSchedule(): Promise<{ name: string; cron: string; data: any; timezone?: string } | null> {
    const found = await prisma.systemSchedule.findUnique({ where: { name: this.taskName } });
    if (!found?.enabled) return null;
    return {
      name: found.name,
      cron: found.cron,
      data: found.lastOutput,
      timezone: found.timezone || 'UTC',
    };
  }

  static async isScheduled(): Promise<boolean> {
    const schedule = await this.getSchedule();
    return schedule !== null;
  }
}
