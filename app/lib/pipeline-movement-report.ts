import { getCurrencyConfiguration } from './currency-configuration';
import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { listSalesReps } from './assignment-eligibility';
import { businessQuarter, quarterBounds, quarters } from './business-quarter';
import { FORECAST_SNAPSHOT_SCOPE, SNAPSHOT_SCOPE, SNAPSHOT_LIMIT } from './opportunity-snapshots';
import { analyzePipelineMovement, type MovementPolicy } from './pipeline-movement';

export class MovementInputError extends Error {}

export function canReadPipelineMovement(actor: Actor) {
  return can(actor, 'pipeline-movement.read');
}
// Deployment policy is separate from the generic engine. Null eligibility is
// legacy/unknown, preserved as captured rather than inferred from live users.
export const salesHubMovementPolicy: MovementPolicy = {
  categoryOrder: ['PIPELINE', 'BEST_CASE', 'COMMIT'],
  participates: row => row.ownerId !== null && row.ownerForecastEligible !== false && (row.status !== 'OPEN' || ['PIPELINE', 'BEST_CASE', 'COMMIT'].includes(row.forecastCategory ?? '')),
};
export const validMovementRunWhere = {
  status: 'COMPLETE', scopeVersion: { in: [SNAPSHOT_SCOPE, FORECAST_SNAPSHOT_SCOPE] }, opportunityCount: { lte: SNAPSHOT_LIMIT, gte: 0 },
};
export type MovementQuery = { before?: string; after?: string; year?: string; quarter?: string; ownerId?: string; currencyCode?: string; page?: string };
const id = (value?: string) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function movementOwner(actor: Actor, requested: string | undefined, reps: readonly { id: number }[]) {
  if (requested === undefined || requested === '') return actor.role === 'SALES' ? actor.id : undefined;
  if (requested === 'team' && actor.role !== 'SALES') return undefined;
  const selected = id(requested);
  if (!selected || !reps.some(rep => rep.id === selected)) throw new MovementInputError('Choose an eligible salesperson.');
  return selected;
}
export async function loadPipelineMovement(client: PrismaClient, actor: Actor, query: MovementQuery) {
  if (!canReadPipelineMovement(actor)) throw new Error('Access denied');
  const currencyConfig = await getCurrencyConfiguration(client);
  // A bounded selector, with explicitly requested older runs fetched separately.
  const [recent, reps] = await Promise.all([
    client.opportunitySnapshotRun.findMany({ where: validMovementRunWhere, orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 104 }),
    listSalesReps(client),
  ]);
  if (query.after && !id(query.after) || query.before && !id(query.before)) throw new MovementInputError('Choose valid snapshot IDs.');
  const requested = [id(query.after), id(query.before)].filter((n): n is number => n !== null && !recent.some(run => run.id === n));
  const older = requested.length ? await client.opportunitySnapshotRun.findMany({ where: { ...validMovementRunWhere, id: { in: requested } }, take: 2 }) : [];
  const runs = [...recent, ...older].sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime() || b.id - a.id);
  const after = query.after ? runs.find(run => run.id === id(query.after)) : runs[0];
  if (query.after && !after) throw new MovementInputError('Later snapshot is unavailable or incompatible.');
  const before = query.before ? runs.find(run => run.id === id(query.before)) : after ? await client.opportunitySnapshotRun.findFirst({ where: { ...validMovementRunWhere, snapshotAt: { lt: after.snapshotAt } }, orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }] }) : undefined;
  if (query.before && !before) throw new MovementInputError('Earlier snapshot is unavailable or incompatible.');
  if (before && after && before.snapshotAt >= after.snapshotAt) throw new MovementInputError('Choose an earlier snapshot before the later snapshot.');
  if (before && !runs.some(run => run.id === before.id)) runs.push(before);
  const defaults = businessQuarter(after?.snapshotAt ?? new Date());
  const year = query.year === undefined ? defaults.year : Number(query.year);
  const quarter = query.quarter === undefined ? defaults.quarter : quarters.find(q => q === query.quarter);
  if (!quarter) throw new MovementInputError('Choose a valid quarter.');
  if ((query.year !== undefined || before && after) && (!Number.isInteger(year) || year < 2000 || year > 2100)) throw new MovementInputError('Choose a valid year.');
  const ownerId = movementOwner(actor, query.ownerId, reps);
  const runIds = [before?.id, after?.id].filter((n): n is number => n !== undefined);
  const currencies = runIds.length ? await client.opportunitySnapshot.findMany({ where: { runId: { in: runIds } }, distinct: ['currencyCode'], select: { currencyCode: true }, take: 200 }) : [];
  const codes = [...new Set([...currencyConfig.activeCurrencies.map(row => row.code), ...currencies.map(row => row.currencyCode)])].sort();
  const currencyCode = query.currencyCode ?? currencyConfig.defaultCurrency;
  if (!/^[A-Z]{3}$/.test(currencyCode) || query.currencyCode && !codes.includes(currencyCode)) throw new MovementInputError('Choose a captured currency.');
  const context = { runs, before, after, reps, ownerId, year, quarter, currencyCode, currencies: codes };
  if (!before || !after) return { ...context, result: null };
  const period = quarterBounds(year, quarter);
  // Select keys matching the chosen scope at either endpoint, then load BOTH
  // states by immutable (runId, opportunityId). This preserves exits/transfers.
  const ownerPredicate = ownerId === undefined ? Prisma.empty : Prisma.sql`AND "ownerId" = ${ownerId}`;
  const keys = await client.$queryRaw<{ opportunityId: number }[]>(Prisma.sql`
    SELECT DISTINCT "opportunityId" FROM "OpportunitySnapshot"
    WHERE "runId" IN (${before.id}, ${after.id})
      AND "expectedCloseDate" >= ${period.start} AND "expectedCloseDate" < ${period.endExclusive}
      AND "currencyCode" = ${currencyCode} ${ownerPredicate}
    ORDER BY "opportunityId" LIMIT ${SNAPSHOT_LIMIT * 2 + 1}`);
  if (keys.length > SNAPSHOT_LIMIT * 2) throw new Error('Comparison exceeds the supported snapshot size.');
  const rows = keys.length ? await client.opportunitySnapshot.findMany({
    where: { runId: { in: [before.id, after.id] }, opportunityId: { in: keys.map(row => row.opportunityId) } },
    orderBy: [{ opportunityId: 'asc' }, { runId: 'asc' }], take: SNAPSHOT_LIMIT * 2 + 1,
  }) : [];
  if (rows.length > SNAPSHOT_LIMIT * 2) throw new Error('Comparison exceeds the supported snapshot size.');
  const result = analyzePipelineMovement(rows.filter(row => row.runId === before.id), rows.filter(row => row.runId === after.id), { period, ownerId, currencyCode }, salesHubMovementPolicy);
  return { ...context, result };
}
