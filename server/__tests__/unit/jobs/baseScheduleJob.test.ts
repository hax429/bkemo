import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const systemSchedule = {
  findUnique: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
};
const queryRaw = vi.fn();

vi.mock('../../../prisma', () => ({
  prisma: {
    systemSchedule,
    $queryRaw: queryRaw,
  },
}));

import { BaseScheduleJob, stopAllScheduleTimers } from '../../../jobs/baseScheduleJob';

class TestScheduleJob extends BaseScheduleJob {
  protected static taskName = 'test-low-cost-job';
  protected static cronSchedule = '0 0 * * *';
  static run = vi.fn(async () => ({ ok: true }));

  protected static async RunTask() {
    return this.run();
  }
}

describe('BaseScheduleJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemSchedule.upsert.mockResolvedValue({});
    systemSchedule.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    await stopAllScheduleTimers();
  });

  test('does not poll the database between due times', async () => {
    await TestScheduleJob.Start('0 0 * * *', false, 'UTC');
    expect(systemSchedule.upsert).toHaveBeenCalledOnce();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(systemSchedule.updateMany).not.toHaveBeenCalled();
    expect(TestScheduleJob.run).not.toHaveBeenCalled();
  });

  test('run now records bounded start and success updates', async () => {
    await TestScheduleJob.TriggerNow();

    expect(TestScheduleJob.run).toHaveBeenCalledOnce();
    expect(systemSchedule.updateMany).toHaveBeenCalledTimes(2);
    expect(systemSchedule.updateMany.mock.calls[1][0].data.lastStatus).toBe('success');
  });
});
