import { afterAll, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { databaseObjects } from '../../lib/databaseMigration';

const connectionString = process.env.TEST_DATABASE_MIGRATION_URL;
const emptyConnectionString = process.env.TEST_EMPTY_DATABASE_MIGRATION_URL;
const client = connectionString
  ? new PrismaClient({ datasources: { db: { url: connectionString } } })
  : null;
const emptyClient = emptyConnectionString
  ? new PrismaClient({ datasources: { db: { url: emptyConnectionString } } })
  : null;

afterAll(async () => {
  await Promise.all([
    client?.$disconnect(),
    emptyClient?.$disconnect(),
  ]);
});

const testWithDatabase = connectionString ? test : test.skip;

testWithDatabase('database object inventory query is compatible with hosted PostgreSQL', async () => {
  const objects = await databaseObjects(client!);

  expect(Array.isArray(objects)).toBe(true);
  expect(objects.every((object) => typeof object.object_type === 'string')).toBe(true);
});

const testWithEmptyDatabase = emptyConnectionString ? test : test.skip;

testWithEmptyDatabase('provider-managed objects do not make an empty hosted destination look occupied', async () => {
  expect(await databaseObjects(emptyClient!)).toEqual([]);
});
