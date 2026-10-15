import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type OpportunitySnapshot } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { operationalOpportunityWhere } from './operational-where';

export const SNAPSHOT_SCOPE = 'OPEN_OPERATIONAL_V1';
export const SNAPSHOT_LIMIT = 10000;
export const snapshotWhere: Prisma.OpportunityWhereInput = {
  AND: [operationalOpportunityWhere, { stage: { isClosed: false } }],
};

export function canReadOpportunitySnapshots(actor: Actor) {
  return can(actor, 'sales.read') && ['ADMIN', 'SALES_MANAGER'].includes(actor.role);
}
export function assertSnapshotAdmin(actor: Actor) {
  if (actor.role !== 'ADMIN' || !can(actor, 'users.manage')) throw new Error('Access denied');
}
export function snapshotWeek(at: Date) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const day = new Date(`${local}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day;
}

async function readSnapshotSet(tx: Prisma.TransactionClient) {
  const rows = await tx.opportunity.findMany({
    where: snapshotWhere, orderBy: { id: 'asc' }, take: SNAPSHOT_LIMIT + 1,
    select: {
      id: true, name: true, ownerId: true, stageId: true, currencyCode: true,
      expectedCloseDate: true, probability: true, forecastCategory: true,
      owner: { select: { firstName: true, lastName: true } },
      stage: { select: { name: true, probability: true, isClosed: true, isWon: true } },
      participants: { orderBy: { accountId: 'asc' }, select: { accountId: true, account: { select: { name: true } } } },
      products: { where: { archivedAt: null }, select: { quantity: true, estimatedUnitPrice: true } },
    },
  });
  if (rows.length > SNAPSHOT_LIMIT) throw new Error('Snapshot exceeds 10,000 Opportunities. No partial set was captured.');
  return rows.map(row => ({
    opportunityId: row.id, opportunityName: row.name,
    accountIds: row.participants.map(p => p.accountId),
    accounts: row.participants.map(p => ({ id: p.accountId, name: p.account.name })),
    ownerId: row.ownerId, ownerName: row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : null,
    stageId: row.stageId, stageName: row.stage.name,
    amount: row.products.reduce((sum, line) => sum.add(line.estimatedUnitPrice.mul(line.quantity)), new Prisma.Decimal(0)).toFixed(2),
    currencyCode: row.currencyCode, expectedCloseDate: row.expectedCloseDate,
    probability: row.probability ?? row.stage.probability,
    probabilityOverride: row.probability, stageProbability: row.stage.probability,
    forecastCategory: row.forecastCategory,
    status: row.stage.isClosed ? row.stage.isWon ? 'WON' : 'LOST' : 'OPEN',
    productCount: row.products.length,
  }));
}
function fingerprint(rows: Awaited<ReturnType<typeof readSnapshotSet>>) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export type SnapshotPreview = { preparedAt: string; week: string; count: number; fingerprint: string };

export async function previewOpportunitySnapshot(client: PrismaClient, actor: Actor): Promise<SnapshotPreview> {
  assertSnapshotAdmin(actor);
  return client.$transaction(async tx => {
    const [{ at }] = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
    const week = snapshotWeek(at);
    if (await tx.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: week }, select: { id: true } })) throw new Error('This week already has an immutable snapshot run. Reruns are disabled in v1.');
    const rows = await readSnapshotSet(tx);
    return { preparedAt: at.toISOString(), week: week.toISOString().slice(0, 10), count: rows.length, fingerprint: fingerprint(rows) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
}

// Both manual capture and a future weekly job use this atomic service. The
// preview must be authenticated by the caller; the manual action signs it.
export async function captureOpportunitySnapshot(client: PrismaClient, actor: Actor, preview: SnapshotPreview, confirmed: boolean) {
  assertSnapshotAdmin(actor);
  if (!confirmed) throw new Error('Explicit confirmation is required.');
  const age = Date.now() - new Date(preview.preparedAt).getTime();
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000) throw new Error('Preview expired. Preview the snapshot again.');
  try {
    return await client.$transaction(async tx => {
      const [{ at }] = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
      const week = snapshotWeek(at);
      if (week.toISOString().slice(0, 10) !== preview.week) throw new Error('Snapshot week changed. Preview again.');
      const rows = await readSnapshotSet(tx);
      if (rows.length !== preview.count || fingerprint(rows) !== preview.fingerprint) throw new Error('Opportunity data changed. Preview again before confirming.');
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
      const run = await tx.opportunitySnapshotRun.create({ data: {
        snapshotAt: at, snapshotWeek: week, createdById: actor.id,
        createdByName: `${user.firstName} ${user.lastName}`, opportunityCount: rows.length,
        scopeVersion: SNAPSHOT_SCOPE,
      } });
      // Bounded inserts avoid parameter limits without changing the point-in-time read.
      for (let offset = 0; offset < rows.length; offset += 500) {
        await tx.opportunitySnapshot.createMany({ data: rows.slice(offset, offset + 500).map(row => ({ ...row, runId: run.id, snapshotAt: at })) });
      }
      return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new Error('This week already has an immutable snapshot run. Reruns are disabled in v1.');
    throw error;
  }
}

export function snapshotAccounts(value: Prisma.JsonValue): { id: number; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'number' && typeof item.name === 'string' ? [{ id: item.id, name: item.name }] : []);
}
const dateKey = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;
export function compareOpportunitySnapshots(before: OpportunitySnapshot | null, after: OpportunitySnapshot | null) {
  if (!before) return ['Entered snapshot set'];
  if (!after) return ['Left snapshot scope — closure/removal reason not captured'];
  const changes: string[] = [];
  if (before.stageId !== after.stageId) changes.push('Stage changed');
  else if (before.stageName !== after.stageName) changes.push('Stage renamed');
  if (before.currencyCode !== after.currencyCode) changes.push('Currency changed — values not comparable');
  else if (!before.amount.equals(after.amount)) changes.push(after.amount.gt(before.amount) ? 'Amount increased' : 'Amount decreased');
  if (dateKey(before.expectedCloseDate) !== dateKey(after.expectedCloseDate)) {
    changes.push(before.expectedCloseDate && after.expectedCloseDate
      ? after.expectedCloseDate > before.expectedCloseDate ? 'Close date slipped' : 'Close date pulled in'
      : after.expectedCloseDate ? 'Close date added' : 'Close date cleared');
  }
  if (before.ownerId !== after.ownerId) changes.push('Owner changed');
  if (before.forecastCategory !== after.forecastCategory) changes.push('Forecast category changed');
  if (before.probability !== after.probability) changes.push('Probability changed');
  return changes.length ? changes : ['No tracked movement'];
}

export type SnapshotFilters = { ownerId?: number; stageId?: number; accountId?: number; opportunityId?: number; page?: number };
export async function compareSnapshotRuns(client: PrismaClient, actor: Actor, beforeId: number, afterId: number, filters: SnapshotFilters = {}) {
  if (!canReadOpportunitySnapshots(actor)) throw new Error('Access denied');
  if (![beforeId, afterId].every(id => Number.isSafeInteger(id) && id > 0) || beforeId === afterId) throw new Error('Choose two different snapshot runs.');
  return client.$transaction(async tx => {
    const runs = await tx.opportunitySnapshotRun.findMany({ where: { id: { in: [beforeId, afterId] } }, take: 2 });
    const before = runs.find(r => r.id === beforeId), after = runs.find(r => r.id === afterId);
    if (!before || !after || before.snapshotAt >= after.snapshotAt) throw new Error('Choose an earlier and a later snapshot run.');
    const conditions = [
      filters.ownerId ? Prisma.sql`"ownerId" = ${filters.ownerId}` : Prisma.empty,
      filters.stageId ? Prisma.sql`"stageId" = ${filters.stageId}` : Prisma.empty,
      filters.accountId ? Prisma.sql`"accountIds" @> ARRAY[${filters.accountId}]::integer[]` : Prisma.empty,
      filters.opportunityId ? Prisma.sql`"opportunityId" = ${filters.opportunityId}` : Prisma.empty,
    ].filter(condition => condition !== Prisma.empty);
    // Match all filters on either endpoint, then fetch BOTH endpoints. Filtering
    // rows before matching them would incorrectly turn owner/stage moves into exits.
    const predicate = conditions.length ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const page = Math.max(1, Math.min(10000, Math.floor(filters.page || 1)));
    const keys = await tx.$queryRaw<{ opportunityId: number }[]>(Prisma.sql`
      SELECT DISTINCT "opportunityId" FROM "OpportunitySnapshot"
      WHERE "runId" IN (${beforeId}, ${afterId}) ${predicate}
      ORDER BY "opportunityId" LIMIT 51 OFFSET ${(page - 1) * 50}`);
    const totals = await tx.$queryRaw<{ runId: number; currencyCode: string; count: bigint; amount: Prisma.Decimal }[]>(Prisma.sql`
      SELECT "runId", "currencyCode", count(*) AS count, sum(amount) AS amount
      FROM "OpportunitySnapshot" WHERE "runId" IN (${beforeId}, ${afterId})
      AND "opportunityId" IN (SELECT "opportunityId" FROM "OpportunitySnapshot"
        WHERE "runId" IN (${beforeId}, ${afterId}) ${predicate})
      GROUP BY "runId", "currencyCode" ORDER BY "runId", "currencyCode"`);
    const ids = keys.slice(0, 50).map(row => row.opportunityId);
    const rows = ids.length ? await tx.opportunitySnapshot.findMany({ where: { runId: { in: [beforeId, afterId] }, opportunityId: { in: ids } }, take: 100 }) : [];
    const oldRows = new Map(rows.filter(row => row.runId === beforeId).map(row => [row.opportunityId, row]));
    const newRows = new Map(rows.filter(row => row.runId === afterId).map(row => [row.opportunityId, row]));
    return { before, after, totals, page, hasMore: keys.length > 50, rows: ids.map(id => {
      const old = oldRows.get(id) ?? null, current = newRows.get(id) ?? null;
      return { opportunityId: id, before: old, after: current, changes: compareOpportunitySnapshots(old, current) };
    }) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function opportunitySnapshotHistory(client: PrismaClient, actor: Actor, opportunityId: number) {
  if (!can(actor, 'sales.read') || !['ADMIN', 'SALES_MANAGER', 'SALES'].includes(actor.role)) return [];
  // Keep the existing live detail usable during a staged schema/client rollout.
  // New reporting/capture pages still require the migration before use.
  if (!client.opportunitySnapshot) return [];
  const live = await client.opportunity.findFirst({ where: { id: opportunityId, ...opportunityScope(actor) }, select: { id: true } });
  if (!live) return [];
  try {
    return await client.opportunitySnapshot.findMany({
      where: { opportunityId, ...(actor.role === 'SALES' ? { ownerId: actor.id } : {}) },
      orderBy: [{ snapshotAt: 'desc' }, { id: 'desc' }], take: 8,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021' && String(error.meta?.table).includes('OpportunitySnapshot')) return [];
    throw error;
  }
}
