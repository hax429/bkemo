import path from 'path';

type CutoverJob = {
  status: string;
  maintenanceMode: boolean;
};

export function prismaMigrateInvocation(projectDirectory: string, bunExecutable: string) {
  return {
    command: bunExecutable,
    args: [
      path.join(projectDirectory, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      path.join(projectDirectory, 'prisma/schema.prisma'),
    ],
  };
}

type CutoverDatabaseClient = {
  databaseMigrationJob: {
    findUnique(args: { where: { id: string } }): Promise<CutoverJob | null>;
    update(args: {
      where: { id: string };
      data: {
        status: string;
        maintenanceMode: boolean;
        message: string;
        completedAt: null;
      };
    }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
};

export async function prepareNeonDestinationForCutover(input: {
  jobId: string;
  migrate: () => Promise<void>;
  createClient: () => CutoverDatabaseClient;
}) {
  await input.migrate();
  const client = input.createClient();
  try {
    const targetJob = await client.databaseMigrationJob.findUnique({ where: { id: input.jobId } });
    const acceptsLegacyReadyRow = targetJob?.status === 'ready';
    if (!targetJob || !['ready', 'cutover_pending', 'verification_failed'].includes(targetJob.status)
      || (!targetJob.maintenanceMode && !acceptsLegacyReadyRow)) {
      throw new Error('The verified migration record is missing from the Neon destination');
    }
    await client.databaseMigrationJob.update({
      where: { id: input.jobId },
      data: {
        status: 'cutover_pending',
        maintenanceMode: true,
        message: 'Guarded cutover requested; both databases remain read-only',
        completedAt: null,
      },
    });
  } finally {
    await client.$disconnect();
  }
}
