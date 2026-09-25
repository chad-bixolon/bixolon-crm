#!/usr/bin/env node
/** Production-only PE reset. Dry-run by default; no Opportunity pricing records are changed. */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

const EXPECTED_DATABASE = 'bixolon_crm';
const EXPECTED_FKS = [
  'PriceExceptionLine_priceExceptionId_fkey|PriceExceptionLine|PriceException|r',
  'OpportunityProduct_priceExceptionLineId_fkey|OpportunityProduct|PriceExceptionLine|r',
].sort();
const PROTECTED_TABLES = ['Account','Contact','Project','Opportunity','OpportunityProduct','Product','ProductSku','User','ReportDefinition'];
const CONFIRMATION = 'DELETE_ALL_PRICE_EXCEPTIONS';

export function parseResetOptions(argv) {
  const allowed = ['--apply', '--show-system-id', `--confirm=${CONFIRMATION}`];
  if (argv.some(arg => !allowed.includes(arg) && !arg.startsWith('--expect-host=') && !arg.startsWith('--expect-system-id='))) throw new Error('Unknown option. Use --expect-host, --expect-system-id, --apply, and the documented confirmation token.');
  const get = name => {
    const values = argv.filter(arg => arg.startsWith(`${name}=`));
    if (values.length !== 1 || !values[0].slice(name.length + 1)) throw new Error(`Refusing reset: exactly one ${name}=VALUE is required.`);
    return values[0].slice(name.length + 1);
  };
  const expectHost = get('--expect-host');
  const showSystemId = argv.includes('--show-system-id');
  const apply = argv.includes('--apply');
  if (showSystemId && (apply || argv.some(arg => arg.startsWith('--confirm=')) || argv.some(arg => arg.startsWith('--expect-system-id=')))) throw new Error('Refusing reset: --show-system-id cannot be combined with apply or an expected system identifier.');
  const expectSystemId = showSystemId ? null : get('--expect-system-id');
  if (expectSystemId && !/^\d{10,24}$/.test(expectSystemId)) throw new Error('Refusing reset: expected PostgreSQL system identifier must be 10 to 24 digits.');
  if (apply && !argv.includes(`--confirm=${CONFIRMATION}`)) throw new Error(`Apply requires --confirm=${CONFIRMATION}.`);
  if (!apply && argv.some(arg => arg.startsWith('--confirm='))) throw new Error('Confirmation token is only valid with --apply.');
  return { apply, showSystemId, expectHost, expectSystemId };
}
export function assertProductionTarget(env, expectHost) {
  let url;
  try { url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null; } catch { /* Refuse without exposing connection details. */ }
  if (env.NODE_ENV !== 'production' || !url || !['postgres:','postgresql:'].includes(url.protocol) || !expectHost || url.hostname !== expectHost || decodeURIComponent(url.pathname.slice(1)) !== EXPECTED_DATABASE) throw new Error('Refusing reset: expected production database target was not established.');
  return url;
}
export function assertProductionIdentity(env, actual, options) {
  assertProductionTarget(env, options.expectHost);
  if (actual.database !== EXPECTED_DATABASE) throw new Error('Refusing reset: connected database identity did not match.');
  if (!options.showSystemId && (!options.expectSystemId || !/^\d{10,24}$/.test(options.expectSystemId) || actual.systemId !== options.expectSystemId)) throw new Error('Refusing reset: production PostgreSQL cluster identifier did not match.');
}
function readOnlyUrl(url) {
  const safe = new URL(url);
  const prior = safe.searchParams.get('options') ?? '';
  safe.searchParams.set('options', `${prior} -c default_transaction_read_only=on`.trim());
  safe.searchParams.set('connection_limit', '1');
  return safe.toString();
}
export function assertKnownDependencies(foreignKeys, triggers) {
  const actual = foreignKeys.map(row=>`${row.name}|${row.referencingTable}|${row.referencedTable}|${row.deleteAction}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_FKS)) throw new Error('Refusing reset: Price Exception foreign-key graph differs from the reviewed schema.');
  if (triggers.length) throw new Error('Refusing reset: custom triggers exist on Price Exception tables.');
}
async function identity(db) {
  const [row] = await db.$queryRawUnsafe('SELECT current_database() AS database, system_identifier::text AS "systemId" FROM pg_control_system()');
  if (!row) throw new Error('Database identity unavailable.');
  return row;
}
async function dependencies(db) {
  const foreignKeys = await db.$queryRawUnsafe(`SELECT con.conname AS name, src.relname AS "referencingTable", dst.relname AS "referencedTable", con.confdeltype::text AS "deleteAction"
    FROM pg_constraint con
    JOIN pg_class src ON src.oid=con.conrelid JOIN pg_class dst ON dst.oid=con.confrelid
    JOIN pg_namespace ns ON ns.oid=src.relnamespace JOIN pg_namespace nd ON nd.oid=dst.relnamespace
    WHERE con.contype='f' AND nd.nspname='public' AND dst.relname IN ('PriceException','PriceExceptionLine')
    ORDER BY con.conname`);
  const triggers = await db.$queryRawUnsafe(`SELECT tg.tgname AS name FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname IN ('PriceException','PriceExceptionLine') AND NOT tg.tgisinternal`);
  return { foreignKeys, triggers };
}
async function counts(db) {
  const [headers,lines,opportunityLinks,opportunitySnapshots] = await Promise.all([
    db.priceException.count(), db.priceExceptionLine.count(),
    db.opportunityProduct.count({where:{priceExceptionLineId:{not:null}}}),
    db.opportunityProduct.count({where:{priceSource:'PRICE_EXCEPTION'}}),
  ]);
  return { PriceException:headers, PriceExceptionLine:lines, OpportunityProductLinkedToPeLine:opportunityLinks, OpportunityProductPriceExceptionSnapshots:opportunitySnapshots };
}
async function protectedCounts(db) {
  const result={};
  for(const table of PROTECTED_TABLES){const [row]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`);result[table]=row.count;}
  return result;
}
async function inspect(db,env,options) {
  assertProductionIdentity(env,await identity(db),options);
  const graph=await dependencies(db);assertKnownDependencies(graph.foreignKeys,graph.triggers);
  return { counts:await counts(db),protected:await protectedCounts(db),foreignKeys:graph.foreignKeys };
}
export async function runPriceExceptionReset(db,env,options) {
  assertProductionTarget(env,options.expectHost);
  if (options.showSystemId) {
    const actual = await identity(db);
    assertProductionIdentity(env,actual,options);
    return { systemId: actual.systemId };
  }
  if (!options.apply) {
    const before=await inspect(db,env,options);
    return { mode:'DRY RUN',affectedTables:['PriceExceptionLine','PriceException'],deleteOrder:['PriceExceptionLine','PriceException'],before,blocked:before.counts.OpportunityProductLinkedToPeLine>0,reason:before.counts.OpportunityProductLinkedToPeLine>0?'OpportunityProduct rows reference PE lines. Preserving pricing history requires stopping; no deletes can run.':null };
  }
  return db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL lock_timeout = \'5s\'');
    await tx.$executeRawUnsafe('SET LOCAL statement_timeout = \'60s\'');
    await tx.$executeRawUnsafe('LOCK TABLE "PriceException", "PriceExceptionLine", "OpportunityProduct" IN SHARE ROW EXCLUSIVE MODE');
    const before=await inspect(tx,env,options);
    if (before.counts.OpportunityProductLinkedToPeLine>0) throw new Error('Reset blocked: OpportunityProduct pricing history references PE lines. No records deleted.');
    const deletedLines=await tx.priceExceptionLine.deleteMany({});
    const deletedHeaders=await tx.priceException.deleteMany({});
    const afterCounts=await counts(tx),afterProtected=await protectedCounts(tx);
    if(deletedLines.count!==before.counts.PriceExceptionLine || deletedHeaders.count!==before.counts.PriceException || afterCounts.PriceExceptionLine!==0 || afterCounts.PriceException!==0 || JSON.stringify(afterProtected)!==JSON.stringify(before.protected) || afterCounts.OpportunityProductPriceExceptionSnapshots!==before.counts.OpportunityProductPriceExceptionSnapshots) throw new Error('Reset verification failed. Transaction rolled back.');
    return {mode:'APPLIED',affectedTables:['PriceExceptionLine','PriceException'],deleteOrder:['PriceExceptionLine','PriceException'],before,deleted:{PriceExceptionLine:deletedLines.count,PriceException:deletedHeaders.count},after:{counts:afterCounts,protected:afterProtected}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:120000});
}
async function main() {
  try {
    const options=parseResetOptions(process.argv.slice(2));
    const url=assertProductionTarget(process.env,options.expectHost);
    const db=new PrismaClient(options.apply ? undefined : {datasources:{db:{url:readOnlyUrl(url)}}});
    try { console.log(JSON.stringify(await runPriceExceptionReset(db,process.env,options),null,2)); }
    finally { await db.$disconnect(); }
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    console.error(/^(Refusing reset:|Reset blocked:|Reset verification failed\.|Apply requires |Unknown option\.|Confirmation token)/.test(message)?message:'Reset failed; database error details withheld.');
    process.exitCode=1;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
