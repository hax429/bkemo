/**
 * Instantiates a single instance PrismaClient and save it on the global object.
 * @see https://www.prisma.io/docs/support/help-articles/nextjs-prisma-client-dev-practices
 */
import { PrismaClient } from '@prisma/client';
import { runtimeDatabaseUrl } from './lib/runtimeDatabaseUrl';

const prismaGlobal = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};
export const prisma: PrismaClient =
  prismaGlobal.prisma ??
  new PrismaClient({
    log:
    process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: runtimeDatabaseUrl()
      }
    }
  });

if (process.env.NODE_ENV !== 'production') {
  prismaGlobal.prisma = prisma;
}