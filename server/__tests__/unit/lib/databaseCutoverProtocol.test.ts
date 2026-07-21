import { describe, expect, test } from 'bun:test';
import { prepareNeonDestinationForCutover } from '../../../lib/databaseCutoverProtocol';

describe('guarded Neon cutover protocol', () => {
  test('applies pending schema migrations before querying the copied Neon job', async () => {
    let migrated = false;
    const calls: string[] = [];
    const client = {
      databaseMigrationJob: {
        async findUnique() {
          calls.push('findUnique');
          if (!migrated) {
            throw new Error('The column `databaseMigrationJob.direction` does not exist in the current database.');
          }
          return { status: 'ready', maintenanceMode: true };
        },
        async update() {
          calls.push('update');
          return {};
        },
      },
      async $disconnect() { calls.push('disconnect'); },
    };

    await prepareNeonDestinationForCutover({
      jobId: '649e621c-2966-4801-aded-3f0f258c7b25',
      async migrate() { calls.push('migrate'); migrated = true; },
      createClient: () => client,
    });

    expect(calls).toEqual(['migrate', 'findUnique', 'update', 'disconnect']);
  });
});
