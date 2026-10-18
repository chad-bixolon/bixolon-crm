import { Prisma, type PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';

import { currencyConfiguration, type CurrencyDefinition } from './currency-rules';
export { currencyConfiguration, canRetainCurrency, showCurrencyControl } from './currency-rules';
export type { CurrencyDefinition, CurrencyConfiguration } from './currency-rules';

export async function getCurrencyConfiguration(client: Pick<PrismaClient, 'currency'>) {
  return currencyConfiguration(await client.currency.findMany({ orderBy: { code: 'asc' } }));
}


// New entries use active definitions. Reports also offer inactive currencies
// with stored data; deactivation never makes history inaccessible.
export async function getReportingCurrencies(client: PrismaClient) {
  return client.$queryRaw<CurrencyDefinition[]>(Prisma.sql`
    WITH codes AS (
      SELECT code AS "currencyCode" FROM "Currency" WHERE active
      UNION
      SELECT "currencyCode" FROM "Opportunity"
      UNION SELECT "currencyCode" FROM "OpportunitySnapshot"
      UNION SELECT "currencyCode" FROM "ForecastSnapshotRollup"
      UNION SELECT "currencyCode" FROM "ForecastSnapshot"
      UNION SELECT "currencyCode" FROM "ForecastSnapshotArchive"
      UNION SELECT "currencyCode" FROM "SalesPlan"
      UNION SELECT "currencyCode" FROM "SalesTarget"
      UNION SELECT "currencyCode" FROM "ProductPrice"
      UNION SELECT "currencyCode" FROM "PriceExceptionLine"
      UNION SELECT "currencyCode" FROM "ProductSkuOdmCustomerPrice"
    ) SELECT codes."currencyCode" AS code, COALESCE(c.name, codes."currencyCode") AS name,
      COALESCE(c.active, false) AS active, COALESCE(c."isDefault", false) AS "isDefault"
      FROM codes LEFT JOIN "Currency" c ON c.code = codes."currencyCode" ORDER BY code`);
}

export function supportedCurrencies() {
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  return Intl.supportedValuesOf('currency').map(code => ({ code, name: names.of(code) ?? code }));
}
export async function configureCurrency(client: PrismaClient, actor: Actor, action: string, code: string) {
  // Use the effective actor, including during impersonation.
  if (actor.role !== 'ADMIN' || !actor.active || actor.archivedAt) throw new Error('Access denied');
  const supported = supportedCurrencies().find(currency => currency.code === code);
  if (!supported || !['add', 'activate', 'deactivate', 'default'].includes(action)) throw new Error('Choose a supported currency and action.');
  return client.$transaction(async tx => {
    // Serialize configuration changes, including simultaneous default changes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(726341002)::text`;
    const current = await tx.currency.findUnique({ where: { code } });
    if (action === 'add') {
      if (current) throw new Error('This currency is already configured.');
      await tx.currency.create({ data: { ...supported, active: true } });
    } else {
      if (!current) throw new Error('Currency not found.');
      if (action === 'deactivate') {
        if (current.isDefault) throw new Error('Set another active currency as default before deactivating this currency.');
        if (await tx.currency.count({ where: { active: true } }) <= 1 && current.active) throw new Error('Keep at least one active currency.');
        await tx.currency.update({ where: { code }, data: { active: false } });
      } else if (action === 'activate') {
        await tx.currency.update({ where: { code }, data: { active: true } });
      } else {
        if (!current.active) throw new Error('Activate this currency before setting it as default.');
        await tx.currency.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.currency.update({ where: { code }, data: { isDefault: true } });
      }
    }
  });
}
