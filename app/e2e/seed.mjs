import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails, names } from './constants.mjs';

if (process.env.DATABASE_URL !== databaseUrl) throw new Error('E2E seed requires the dedicated local database URL.');
const db = new PrismaClient();
try {
  for (const [role, email] of Object.entries(emails)) {
    const crmRole = { admin: 'ADMIN', support: 'SUPPORT', sales: 'SALES', salesManager: 'SALES_MANAGER', marketing: 'MARKETING_MANAGER', readOnly: 'READ_ONLY' }[role];
    await db.user.upsert({ where: { email }, update: { active: true, archivedAt: null, role: crmRole }, create: { email, firstName: 'E2E', lastName: role, role: crmRole } });
  }
  const account = await db.account.findFirst({ where: { name: names.account } }) ?? await db.account.create({ data: { name: names.account } });
  const other = await db.account.findFirst({ where: { name: names.otherAccount } }) ?? await db.account.create({ data: { name: names.otherAccount } });
  const reseller = await db.account.findFirst({ where: { name: names.purchasedFrom } }) ?? await db.account.create({ data: { name: names.purchasedFrom } });
  for (const row of [account, other, reseller]) await db.account.update({ where: { id: row.id }, data: { status: 'ACTIVE', archivedAt: null } });
  if (!await db.contact.findFirst({ where: { accountId: account.id, firstName: 'E2E Jane', lastName: 'Smith' } })) await db.contact.create({ data: { accountId: account.id, firstName: 'E2E Jane', lastName: 'Smith' } });
  const product = await db.product.upsert({ where: { sku: names.sku }, update: { active: true, archivedAt: null }, create: { sku: names.sku, name: 'E2E Receipt Printer' } });
  await db.productSku.upsert({ where: { normalizedPartNumber: names.sku }, update: { active: true }, create: { productId: product.id, partNumber: names.sku, normalizedPartNumber: names.sku } });
  for (let index = 1; index <= 25; index++) {
    const partNumber = `E2E-PICK-${String(index).padStart(2, '0')}`;
    await db.productSku.upsert({ where: { normalizedPartNumber: partNumber }, update: { active: true }, create: { productId: product.id, partNumber, normalizedPartNumber: partNumber } });
  }
  await db.supportCaseCategory.upsert({ where: { name: names.category }, update: { active: true }, create: { name: names.category } });
  await db.salesStage.upsert({ where: { name: 'E2E Qualification' }, update: { active: true }, create: { name: 'E2E Qualification', sortOrder: 10, probability: 20 } });
  await db.currency.upsert({ where: { code: 'USD' }, update: { active: true }, create: { code: 'USD', name: 'US Dollar' } });
  await db.priceException.upsert({ where: { sourceType_sourceKey: { sourceType: 'EXTERNAL_EXPORT', sourceKey: 'e2e-pe-001' } }, update: { status: 'ACTIVE', archivedAt: null, distributorAccountId: account.id }, create: { peCode: names.pe, sourceType: 'EXTERNAL_EXPORT', sourceKey: 'e2e-pe-001', status: 'ACTIVE', distributorSourceName: names.account, distributorAccountId: account.id } });
  console.log('E2E fixtures ready in dedicated saleshub_e2e database.');
} finally {
  await db.$disconnect();
}
