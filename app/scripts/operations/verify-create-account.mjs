// Run in the app container after compiling lib/accounts.ts into this temporary path.
// The actual create/list service runs inside one rolled-back Prisma transaction.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountRecord, listAccounts } from '/tmp/bixolon-live-verification/accounts.js';

const prisma = new PrismaClient();
const marker = `foundation_verification_${randomUUID()}`;
const rollback = new Error('ROLLBACK_LIVE_ACCOUNT_VERIFICATION');
let createdId;
try {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const serviceClient = { $transaction: (callback) => callback(tx) };
      const created = await createAccountRecord(serviceClient, {
        name: marker, accountType: 'VAR', industry: `${marker}_industry`,
        territory: `${marker}_territory`, website: null, phone: null,
      });
      createdId = created.id;
      const row = (await listAccounts(serviceClient)).find((account) => account.id === createdId);
      assert.equal(row.name, marker);
      assert.equal(row.accountType, 'VAR');
      const account = await tx.account.findUniqueOrThrow({where: {id: createdId}});
      assert.equal(account.strategicAccount, false);
      assert.equal(account.status, 'ACTIVE');
      assert.equal(await tx.accountBusinessRole.count({where:{accountId:createdId,role:'VAR'}}),1);
      throw rollback;
    }, {timeout:15000});
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.ok(createdId);
  assert.equal(await prisma.account.count({where:{id:createdId}}),0);
  assert.equal(await prisma.industry.count({where:{code:`${marker}_industry`}}),0);
  assert.equal(await prisma.territory.count({where:{code:`${marker}_territory`}}),0);
  assert.equal(await prisma.accountBusinessRole.count({where:{accountId:createdId}}),0);
  console.log('PASS: live create/list service, lookup/role writes and defaults; transaction rolled back and no test rows remain.');
  console.log('Expected PostgreSQL behavior: the rolled-back insert consumes one Account sequence value.');
} finally {
  await prisma.$disconnect();
}
