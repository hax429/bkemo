/**
 * Dev-only: ensure a usable login exists for the local backend.
 * Creates `admin` / `123456` (superadmin) if the accounts table is empty.
 * Password format matches the app's pbkdf2 scheme (see prisma/seed.ts).
 * Run with: bun --env-file ./.env scripts/dev-create-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, pbkdf2 } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    pbkdf2(password, salt, 1000, 64, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve('pbkdf2:' + salt + ':' + key.toString('hex'));
    });
  });
}

async function main() {
  const existing = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } });
  if (existing) {
    console.log(`[dev-admin] account already exists (id=${existing.id}, name="${existing.name}") — leaving it alone.`);
    return;
  }
  const password = await hashPassword('123456');
  const account = await prisma.accounts.create({
    data: { name: 'admin', nickname: 'admin', password, role: 'superadmin' },
  });
  console.log(`[dev-admin] created login → name: admin  password: 123456  (id=${account.id})`);
}

main()
  .catch((e) => { console.error('[dev-admin] failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
