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
  if (argv.some(arg => !['--apply',`--confirm=${CONFIRMATION}`].includes(arg))) throw new Error('Unknown option. Use --apply and the documented confirmation token.');
  const apply = argv.includes('--apply');
  if (apply && !argv.includes(`--confirm=${CONFIRMATION}`)) throw new Error(`Apply requires --confirm=${CONFIRMATION}.`);
  if (!apply && argv.some(arg => arg.startsWith('--confirm='))) throw new Error('Confirmation token is only valid with --apply.');
  return { apply };
}
export function assertProductionIdentity(env, actual) {
  const url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  if (env.NODE_ENV !== 'production' || !url || url.hostname !== 'db' || url.pathname.slice(1) !== EXPECTED_DATABASE || actual.database !== EXPECTED_DATABASE) throw new Error('Refusing reset: expected production database identity was not established.');
  const expected = env.BIXOLON_PRODUCTION_SYSTEM_ID;
  if (!expected || !/^\d{10,24}$/.test(expected) || actual.systemId !== expected) throw new Error('Refusing reset: production PostgreSQL cluster identifier did not match.');
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
async function inspect(db,env) {
  assertProductionIdentity(env,await identity(db));
  const graph=await dependencies(db);assertKnownDependencies(graph.foreignKeys,graph.triggers);
  return { counts:await counts(db),protected:await protectedCounts(db),foreignKeys:graph.foreignKeys };
}
export async function runPriceExceptionReset(db,env,options) {
  if (!options.apply) {
    const before=await inspect(db,env);
    return { mode:'DRY RUN',affectedTables:['PriceExceptionLine','PriceException'],deleteOrder:['PriceExceptionLine','PriceException'],before,blocked:before.counts.OpportunityProductLinkedToPeLine>0,reason:before.counts.OpportunityProductLinkedToPeLine>0?'OpportunityProduct rows reference PE lines. Preserving pricing history requires stopping; no deletes can run.':null };
  }
  return db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL lock_timeout = \'5s\'');
    await tx.$executeRawUnsafe('SET LOCAL statement_timeout = \'60s\'');
    await tx.$executeRawUnsafe('LOCK TABLE "PriceException", "PriceExceptionLine", "OpportunityProduct" IN SHARE ROW EXCLUSIVE MODE');
    const before=await inspect(tx,env);
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
    const db=new PrismaClient();
    try { console.log(JSON.stringify(await runPriceExceptionReset(db,process.env,options),null,2)); }
    finally { await db.$disconnect(); }
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    console.error(/^(Refusing reset:|Reset blocked:|Reset verification failed\.|Apply requires |Unknown option\.|Confirmation token)/.test(message)?message:'Reset failed; database error details withheld.');
    process.exitCode=1;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
