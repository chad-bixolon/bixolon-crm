import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createAccountRecord, listAccounts } from "./.test-client/accounts.js";

const url = new URL(process.env.DATABASE_URL);
assert.match(url.hostname, /^bixolon-foundation-test-[a-f0-9]+-db$/);
assert.equal(url.pathname, "/compatibility");
const prisma = new PrismaClient();
try {
  const [{ ready }] = await prisma.$queryRaw`SELECT to_regclass('public."AccountBusinessRole"') IS NOT NULL AS ready`;
  const account = await createAccountRecord(prisma, {
    name: ready ? "Post-migration account" : "Pre-migration account",
    accountType: "VAR", industry: "Fixture industry", territory: "Fixture territory",
    website: null, phone: null,
  });
  let row = (await listAccounts(prisma)).find((item) => item.id === account.id);
  assert.equal(row.accountType, "VAR");
  await assert.rejects(() => createAccountRecord(prisma, {
    name: "Invalid role", accountType: "STRATEGIC", industry: null,
    territory: null, website: null, phone: null,
  }), /Invalid account business role/);
  if (ready) {
    await prisma.accountBusinessRole.create({ data: { accountId: account.id, role: "ISV" } });
    const stage = await prisma.salesStage.create({ data: { name: "Compatibility", sortOrder: 10 } });
    await prisma.opportunity.create({ data: {
      name: "Membership-only opportunity", stageId: stage.id,
      participants: { create: { account: { connect: { id: account.id } } } },
    } });
    row = (await listAccounts(prisma)).find((item) => item.id === account.id);
    assert.equal(row.accountType, "ISV, VAR");
    assert.equal(row._count.opportunities, 1);
    assert.equal(await prisma.industry.count({ where: { code: "Fixture industry" } }), 1);
    assert.equal(await prisma.territory.count({ where: { code: "Fixture territory" } }), 1);
  }
  console.log(`PASS: existing account list/create with ${ready ? "revised" : "baseline"} database and revised Prisma Client`);
} finally {
  await prisma.$disconnect();
}
