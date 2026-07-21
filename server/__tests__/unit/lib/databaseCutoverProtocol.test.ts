import { describe, expect, test } from 'bun:test';
import { prepareNeonDestinationForCutover, prismaMigrateInvocation } from '../../../lib/databaseCutoverProtocol';

describe('guarded Neon cutover protocol', () => {
  test('runs the Prisma CLI with Bun without invoking the system Node shebang', () => {
    expect(prismaMigrateInvocation('/srv/bkemo', '/opt/bun')).toEqual({
      command: '/opt/bun',
      args: [
        '/srv/bkemo/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema',
        '/srv/bkemo/prisma/schema.prisma',
      ],
    });
  });

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
