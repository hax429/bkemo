import { afterAll, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { databaseObjects } from '../../lib/databaseMigration';

const connectionString = process.env.TEST_DATABASE_MIGRATION_URL;
const client = connectionString
  ? new PrismaClient({ datasources: { db: { url: connectionString } } })
  : null;

afterAll(async () => {
  await client?.$disconnect();
});

const testWithDatabase = connectionString ? test : test.skip;

testWithDatabase('database object inventory query is compatible with hosted PostgreSQL', async () => {
  const objects = await databaseObjects(client!);

  expect(Array.isArray(objects)).toBe(true);
  expect(objects.every((object) => typeof object.object_type === 'string')).toBe(true);
});
