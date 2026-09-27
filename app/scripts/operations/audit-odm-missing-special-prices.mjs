// Read-only: prints missing Special Configuration prices; never writes to the database.
import { PrismaClient } from '@prisma/client';
import { missingSpecialConfigurationPrices } from '../../lib/odm-missing-price-audit.mjs';

const db = new PrismaClient();
try {
  const [evidence, skus, accounts] = await Promise.all([
    db.odmPricingImportSource.findMany({ where: { disposition: 'IMPORTED' }, select: { sourceKey: true, workbook: true, sheet: true, rowNumber: true, partIndex: true, disposition: true, source: true, resolution: true } }),
    db.productSku.findMany({ where: { catalogSource: 'ODM', odmSubtype: 'SPECIAL_CONFIGURATION' }, select: { id: true, partNumber: true, normalizedPartNumber: true, catalogSource: true, odmSubtype: true, odmCustomers: { select: { accountId: true, archivedAt: true, prices: { where: { archivedAt: null }, select: { archivedAt: true } } } } } }),
    db.account.findMany({ select: { id: true, name: true } }),
  ]);
  const rows = missingSpecialConfigurationPrices(evidence, skus, accounts);
  const auditedKeys = new Set(rows.map(row => row.sourceKey));
  const unresolvedAccountCandidates = evidence.filter(row => row.disposition === 'IMPORTED' && row.resolution?.subtype === 'SPECIAL_CONFIGURATION' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(String(row.resolution?.price ?? '')) && row.source?.customerCell && !auditedKeys.has(row.sourceKey) && !row.resolution?.accountId && !row.resolution?.choices?.accountId).map(row => ({ sku: row.resolution.partNumber, sourceCustomer: row.source.customerCell, sourcePrice: row.resolution.price, tariffPercent: row.resolution.tariffPercent ?? row.source.tariffPercent, tariffAmount: row.resolution.tariffAmount ?? row.source.tariffAmount, workbook: row.workbook, sheet: row.sheet, rowNumber: row.rowNumber, partIndex: row.partIndex, sourceKey: row.sourceKey }));
  console.log(JSON.stringify({ count: rows.length, rows, unresolvedAccountCandidates }, null, 2));
} finally {
  await db.$disconnect();
}
