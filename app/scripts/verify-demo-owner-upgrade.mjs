import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { databaseUrl } from '../e2e/constants.mjs';

const databaseName = new URL(databaseUrl).pathname.slice(1);
if (databaseName !== 'saleshub_e2e_demo_upgrade' || process.env.DATABASE_URL !== databaseUrl) throw new Error('Use only the dedicated local Demo upgrade database.');
const db = new PrismaClient();
try {
  const phase = process.argv[2];
  if (phase === 'before') {
    const [account, requester, reviewer, shipper] = await Promise.all([
      db.account.findFirstOrThrow({ where: { name: 'E2E Acme Customer' } }),
      db.user.findFirstOrThrow({ where: { email: 'sales@e2e.saleshub.local' } }),
      db.user.findFirstOrThrow({ where: { email: 'manager@e2e.saleshub.local' } }),
      db.user.findFirstOrThrow({ where: { email: 'admin@e2e.saleshub.local' } }),
    ]);
    await db.demoRequest.create({ data: { accountId: account.id, demoNumber: 'DEMO-OWNER-UPGRADE-PRESERVATION', requestedAt: new Date('2026-01-02T12:00:00Z'), requestedById: requester.id, reviewedById: reviewer.id, shippedById: shipper.id, status: 'APPROVED' } });
    await db.$executeRawUnsafe('ALTER TABLE "DemoRequest" DROP COLUMN "operationalOwnerId"');
    await db.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = \'20261024210000_demo_operational_owner\'');
  } else if (phase === 'after') {
    const row = await db.demoRequest.findFirstOrThrow({ where: { demoNumber: 'DEMO-OWNER-UPGRADE-PRESERVATION' }, include: { requestedBy: true, reviewedBy: true, shippedBy: true } });
    assert.equal(row.operationalOwnerId, null);
    assert.equal(row.requestedBy?.email, 'sales@e2e.saleshub.local');
    assert.equal(row.reviewedBy?.email, 'manager@e2e.saleshub.local');
    assert.equal(row.shippedBy?.email, 'admin@e2e.saleshub.local');
    const [index, constraint] = await Promise.all([
      db.$queryRawUnsafe('SELECT indexname FROM pg_indexes WHERE tablename = \'DemoRequest\' AND indexname = \'DemoRequest_operationalOwnerId_status_idx\''),
      db.$queryRawUnsafe('SELECT conname FROM pg_constraint WHERE conname = \'DemoRequest_operationalOwnerId_fkey\''),
    ]);
    assert.equal(index.length, 1);
    assert.equal(constraint.length, 1);
    console.log('Populated Demo upgrade preserved all historical actors and added nullable operational ownership, index, and FK.');
  } else throw new Error('Choose before or after.');
} finally { await db.$disconnect(); }
