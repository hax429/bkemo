import { getPgBoss } from "../lib/pgBoss";

export type ScheduleTimezone = string;

export abstract class BaseScheduleJob {
  protected static taskName: string;
  protected static cronSchedule: string = '0 0 * * *';
  protected static isWorkerRegistered: boolean = false;
  protected static defaultTimezone: ScheduleTimezone = 'UTC';

  protected static async RunTask(): Promise<any> {
    throw new Error('RunTask must be implemented');
  }

  protected static async registerWorker(): Promise<void> {
    if (this.isWorkerRegistered) {
      return;
    }

    const boss = await getPgBoss();
    const taskName = this.taskName;
    const RunTask = this.RunTask.bind(this);

    await boss.createQueue(taskName);

    await boss.work(taskName, async () => {
      console.log(`[${taskName}] Starting job execution...`);
      try {
        const res = await RunTask();
        console.log(`[${taskName}] Job completed successfully`);
        return res;
      } catch (error: any) {
        console.error(`[${taskName}] Job failed:`, error);
        throw error;
      }
    });

    this.isWorkerRegistered = true;
    console.log(`[${taskName}] Worker registered`);
  }

  static async Start(cronTime?: string, immediate: boolean = true, timezone: ScheduleTimezone = this.defaultTimezone): Promise<void> {
    const boss = await getPgBoss();
    const schedule = cronTime || this.cronSchedule;
    const tz = timezone || 'UTC';

    await this.registerWorker();

    await boss.schedule(this.taskName, schedule, { timezone: tz }, {
      tz,
    });

    console.log(`[${this.taskName}] Scheduled with cron: ${schedule} (${tz})`);

    if (immediate) {
      try {
        await this.RunTask();
      } catch (error: any) {
        console.error(`[${this.taskName}] Immediate run failed:`, error);
      }
    }
  }

  static async Stop(): Promise<void> {
    const boss = await getPgBoss();
    await boss.unschedule(this.taskName);
    console.log(`[${this.taskName}] Unscheduled`);
  }

  static async SetCronTime(cronTime: string, timezone?: ScheduleTimezone): Promise<void> {
    const boss = await getPgBoss();
    const existing = await this.getSchedule();
    const tz = timezone || existing?.timezone || 'UTC';

    await boss.unschedule(this.taskName);
    await boss.schedule(this.taskName, cronTime, { timezone: tz }, {
      tz,
    });

    console.log(`[${this.taskName}] Rescheduled with cron: ${cronTime} (${tz})`);
  }

  static async TriggerNow(): Promise<string | null> {
    const boss = await getPgBoss();
    await this.registerWorker();
    const jobId = await boss.send(this.taskName, {});
    console.log(`[${this.taskName}] Triggered immediately, jobId: ${jobId}`);
    return jobId;
  }

  static async initialize(defaultSchedule?: string): Promise<void> {
    const schedule = defaultSchedule || this.cronSchedule;

    try {
      await this.registerWorker();
      console.log(`[${this.taskName}] Initialized with default schedule: ${schedule}`);
    } catch (error) {
      console.error(`[${this.taskName}] Failed to initialize:`, error);
    }
  }

  static async getSchedule(): Promise<{ name: string; cron: string; data: any; timezone?: string } | null> {
    const boss = await getPgBoss();
    const schedules = await boss.getSchedules();
    const found = schedules.find((s) => s.name === this.taskName);
    if (!found) return null;
    return {
      name: found.name,
      cron: found.cron,
      data: found.data,
      timezone: (found as any).timezone || found.data?.timezone || 'UTC',
    };
  }

  static async isScheduled(): Promise<boolean> {
    const schedule = await this.getSchedule();
    return schedule !== null;
  }
}
