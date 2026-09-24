import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL);
assert.match(url.hostname, /^bixolon-foundation-test-[a-f0-9]+-db$/);
assert.equal(url.pathname, "/upgrade");
const prisma = new PrismaClient();
const rollback = new Error("ROLLBACK_SYNTHETIC_CLIENT_TEST");
try {
  await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        name: "Client fixture",
        strategicAccount: true,
        businessRoles: { create: [{ role: "VAR" }, { role: "ISV" }] },
        createdBy: { connect: { id: 100 } },
      },
      include: { businessRoles: true },
    });
    assert.equal(account.businessRoles.length, 2);
    const opportunity = await tx.opportunity.create({
      data: {
        name: "Client opportunity",
        stage: { connect: { id: 100 } },
        participants: {
          create: [{
            account: { connect: { id: account.id } },
            roles: { create: [{ role: "VAR_RESELLER" }, { role: "ISV_PARTNER" }] },
          }],
        },
        products: {
          create: [
            { product: { connect: { id: 100 } }, quantity: 3, estimatedUnitPrice: new Prisma.Decimal("0.10") },
            { product: { connect: { id: 100 } }, quantity: 2, estimatedUnitPrice: new Prisma.Decimal("0.20") },
          ],
        },
      },
      include: { products: true, participants: { include: { roles: true } } },
    });
    assert.equal(opportunity.legacyAccountId, null);
    assert.equal(opportunity.currencyCode, "USD");
    assert.equal(opportunity.participants[0].roles.length, 2);
    const total = opportunity.products.reduce(
      (sum, line) => sum.plus(line.estimatedUnitPrice.mul(line.quantity)),
      new Prisma.Decimal(0),
    );
    assert.equal(total.toFixed(2), "0.70");
    const membership = { opportunityId_accountId: { opportunityId: opportunity.id, accountId: account.id } };
    const task = await tx.task.create({ data: { subject: "Client task", membership: { connect: membership } } });
    const activity = await tx.activity.create({ data: { subject: "Client activity", activityType: { connect: { code: "CALL" } }, account: { connect: { id: account.id } }, opportunity: { connect: { id: opportunity.id } } } });
    const note = await tx.note.create({ data: { body: "Client note", membership: { connect: membership }, createdBy: { connect: { id: 100 } } } });
    for (const row of [task, activity, note]) {
      assert.equal(row.accountId, account.id);
      assert.equal(row.opportunityId, opportunity.id);
    }
    const document = await tx.document.create({ data: {
      originalFileName: "Client Contract.pdf",
      storageKey: `test/documents/${randomUUID()}`,
      mimeType: "application/pdf",
      fileSize: 128,
      documentType: "CONTRACT",
      uploadedBy: { connect: { id: 100 } },
      account: { connect: { id: account.id } },
    } });
    assert.equal(document.accountId, account.id);
    assert.equal(document.projectId, null);
    assert.equal(document.opportunityId, null);
    await tx.opportunity.update({ where: { id: opportunity.id }, data: { archivedAt: new Date(), archivedById: 100 } });
    await tx.account.update({ where: { id: account.id }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedById: 100 } });
    assert.equal(await tx.note.count({ where: { opportunityId: opportunity.id } }), 1);
    assert.equal(await tx.activity.count({ where: { opportunityId: opportunity.id } }), 1);
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log("PASS: generated Prisma Client nested roles, participants, composite membership, attribution, Decimal totals and archival preservation");
} finally {
  await prisma.$disconnect();
}
