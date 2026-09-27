#!/usr/bin/env node
/** Read-only production preflight for the pending OpportunityProduct CHECK. */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';

const migration = fileURLToPath(new URL('../../prisma/migrations/20260927180000_opportunity_product_account_price_provenance/migration.sql', import.meta.url));
const expectedHost = 'bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com';
const sources = ['MANUAL', 'CATALOG', 'PRICE_EXCEPTION', 'ODM_CUSTOMER', 'OTHER_OR_NULL'];
const peFields = ['priceExceptionLineId', 'priceExceptionCode', 'priceExceptionUnitPrice', 'priceExceptionCurrencyCode', 'priceExceptionSourceQty'];
const accountFields = ['odmCustomerPriceId', 'odmCustomerAccountId', 'odmCustomerBasePrice', 'odmCustomerTariffPercent', 'odmCustomerTariffAmount', 'odmCustomerFinalUnitPrice', 'odmCustomerCurrencyCode', 'odmCustomerEffectiveDate'];

export function checkExpression(sql) {
  const marker = 'ADD CONSTRAINT "OpportunityProduct_price_provenance_check" CHECK (';
  const start = sql.indexOf(marker);
  if (start < 0 || sql.indexOf(marker, start + marker.length) >= 0) throw new Error('Expected exactly one provenance CHECK in the pending migration.');
  let depth = 1;
  for (let i = start + marker.length; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    if (sql[i] === ')' && --depth === 0) {
      if (!/^\s*;\s*$/.test(sql.slice(i + 1))) throw new Error('Unexpected SQL after the provenance CHECK.');
      return sql.slice(start + marker.length, i);
    }
  }
  throw new Error('Unclosed provenance CHECK.');
}

export function issues(row) {
  const source = sources.includes(row.source) ? row.source : 'OTHER_OR_NULL';
  if (source === 'OTHER_OR_NULL') return ['priceSource is null or unsupported'];
  const missing = fields => fields.filter(field => row[field] == null).map(field => `${field} required`);
  const present = fields => fields.filter(field => row[field] != null).map(field => `${field} must be null`);
  const result = missing(['unitPrice']);
  if (source === 'MANUAL') result.push(...present(['catalogPriceTier', ...peFields, ...accountFields]));
  if (source === 'CATALOG') result.push(...missing(['catalogPriceTier']), ...present([...peFields, ...accountFields]));
  if (source === 'PRICE_EXCEPTION') result.push(...missing(['priceExceptionLineId', 'priceExceptionUnitPrice', 'priceExceptionCurrencyCode']), ...present(['catalogPriceTier', ...accountFields]));
  if (source === 'ODM_CUSTOMER') {
    result.push(...missing(accountFields.filter(field => field !== 'odmCustomerEffectiveDate')),
      ...present(['catalogPriceTier', ...peFields]));
    for (const field of ['odmCustomerBasePrice', 'odmCustomerTariffPercent', 'odmCustomerTariffAmount'])
      if (row[field] != null && new Prisma.Decimal(row[field]).isNegative()) result.push(`${field} must be nonnegative`);
    if (row.odmCustomerBasePrice != null && row.odmCustomerTariffAmount != null && row.odmCustomerFinalUnitPrice != null &&
      !new Prisma.Decimal(row.odmCustomerBasePrice).plus(row.odmCustomerTariffAmount).equals(row.odmCustomerFinalUnitPrice)) result.push('odmCustomerFinalUnitPrice must equal base price plus tariff amount');
    if (row.unitPrice != null && row.odmCustomerFinalUnitPrice != null &&
      !new Prisma.Decimal(row.unitPrice).equals(row.odmCustomerFinalUnitPrice)) result.push('unitPrice must equal odmCustomerFinalUnitPrice');
  }
  return result;
}

export function report(rows) {
  const groups = Object.fromEntries(sources.map(source => [source, { total: 0, valid: 0, violating: 0, failures: [] }]));
  for (const row of rows) {
    const source = sources.includes(row.source) ? row.source : 'OTHER_OR_NULL';
    const group = groups[source];
    const explanation = issues(row);
    if (row.valid !== (explanation.length === 0)) throw new Error('Preflight CHECK and diagnostic rules differ.');
    group.total++;
    if (row.valid) group.valid++;
    else { group.violating++; group.failures.push({ id: row.id, fields: explanation }); }
  }
  return groups;
}

export function target(env) {
  let url;
  try { url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null; } catch { /* Never expose the URL. */ }
  if (env.NODE_ENV !== 'production' || !url || !['postgres:','postgresql:'].includes(url.protocol) ||
    url.hostname !== expectedHost || decodeURIComponent(url.pathname.slice(1)) !== 'bixolon_crm')
    throw new Error('Expected production target was not established.');
  const safe = new URL(url);
  safe.searchParams.set('options', `${safe.searchParams.get('options') ?? ''} -c default_transaction_read_only=on -c statement_timeout=30000`.trim());
  safe.searchParams.set('connection_limit', '1');
  return safe.toString();
}

export async function preflight(client, expression) {
  const [safety] = await client.$queryRawUnsafe(`SELECT current_database() AS database, current_setting('transaction_read_only') AS mode`);
  if (safety?.database !== 'bixolon_crm' || safety?.mode !== 'on') throw new Error('Read-only production database session was not established.');
  const [constraint] = await client.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conrelid='public."OpportunityProduct"'::regclass AND conname='OpportunityProduct_price_provenance_check' AND contype='c'`);
  if (!constraint) throw new Error('Expected existing provenance CHECK was not found.');
  const columns = ['unitPrice', 'catalogPriceTier', ...peFields, ...accountFields].map(field => `"${field}"`).join(', ');
  const rows = await client.$queryRawUnsafe(`SELECT id, "priceSource"::text AS source, (${expression}) IS TRUE AS valid, ${columns} FROM "OpportunityProduct" ORDER BY id`);
  const [shape] = await client.$queryRawUnsafe(`SELECT (${expression}) IS TRUE AS valid FROM (
    SELECT 'ODM_CUSTOMER'::"OpportunityProductPriceSource" AS "priceSource", 425.70::numeric AS "unitPrice",
      NULL::"ProductPriceTier" AS "catalogPriceTier", NULL::integer AS "priceExceptionLineId",
      NULL::text AS "priceExceptionCode", NULL::numeric AS "priceExceptionUnitPrice",
      NULL::varchar(3) AS "priceExceptionCurrencyCode", NULL::text AS "priceExceptionSourceQty",
      1::integer AS "odmCustomerPriceId", 1::integer AS "odmCustomerAccountId",
      425.70::numeric AS "odmCustomerBasePrice", 0::numeric AS "odmCustomerTariffPercent",
      0::numeric AS "odmCustomerTariffAmount", 425.70::numeric AS "odmCustomerFinalUnitPrice",
      'USD'::varchar(3) AS "odmCustomerCurrencyCode", NULL::date AS "odmCustomerEffectiveDate"
  ) AS production_style_shape`);
  return { groups: report(rows), productionStyleShapeValid: shape?.valid === true };
}

async function main() {
  let stage = 'configuration';
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected command arguments.');
    const url = target(process.env);
    const expression = checkExpression(readFileSync(migration, 'utf8'));
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      stage = 'read-only query';
      const result = await preflight(client, expression);
      console.log('Source | Total | Valid | Violating');
      for (const source of sources) {
        const group = result.groups[source];
        console.log(`${source} | ${group.total} | ${group.valid} | ${group.violating}`);
        for (const failure of group.failures) console.log(`  id=${failure.id}: ${failure.fields.join('; ')}`);
      }
      console.log(`Production-style ODM_CUSTOMER 425.70 / zero tariff CHECK shape: ${result.productionStyleShapeValid ? 'VALID' : 'INVALID'}`);
      if (!result.productionStyleShapeValid || sources.some(source => result.groups[source].violating)) process.exitCode = 2;
    } finally { await client.$disconnect(); }
  } catch {
    console.error(`Preflight failed at ${stage}; connection and query details withheld.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
