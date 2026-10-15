import { Prisma, type PrismaClient, type ForecastSnapshotRollup } from '@prisma/client';
import type { Actor } from './authorization';
import { assertSnapshotAdmin, canReadOpportunitySnapshots, FORECAST_SNAPSHOT_SCOPE, SNAPSHOT_LIMIT } from './opportunity-snapshots';
import { quarterBounds } from './business-quarter';
import { forecastChange, forecastMetrics, inSnapshotForecast, snapshotCategoryNames, type ForecastPeriod } from './forecast-snapshot-rules';

export { forecastChange, forecastMetrics } from './forecast-snapshot-rules';
export type ForecastCaptureInput = ForecastPeriod & { sourceRunId: number };
export type ForecastPreview = ForecastCaptureInput & { preparedAt: string };
export function assertForecastReportAccess(actor: Actor) {
  if (!canReadOpportunitySnapshots(actor)) throw new Error('Access denied');
}
async function readRollup(tx: Prisma.TransactionClient, input: ForecastCaptureInput) {
  quarterBounds(input.year, input.quarter);
  if (!Number.isSafeInteger(input.sourceRunId) || input.sourceRunId <= 0) throw new Error('Choose a compatible source run.');
  const source = await tx.opportunitySnapshotRun.findUnique({ where: { id: input.sourceRunId } });
  if (!source || source.status !== 'COMPLETE' || source.scopeVersion !== FORECAST_SNAPSHOT_SCOPE) throw new Error('Choose a forecast-ready Opportunity Snapshot Run. Older open-only runs cannot supply owner eligibility or Closed Won history.');
  if (await tx.forecastSnapshotRun.findUnique({ where: { sourceRunId_year_quarter: { sourceRunId: input.sourceRunId, year: input.year, quarter: input.quarter } } })) throw new Error('This source run and forecast period already have an immutable Forecast Snapshot.');
  const snapshots = await tx.opportunitySnapshot.findMany({ where: { runId: source.id }, orderBy: { opportunityId: 'asc' }, take: SNAPSHOT_LIMIT + 1 });
  if (snapshots.length > SNAPSHOT_LIMIT || snapshots.length !== source.opportunityCount || snapshots.some(row => row.ownerForecastEligible === null)) throw new Error('Source snapshot is incomplete or incompatible.');
  const grouped = new Map<string, { ownerId: number; ownerName: string; currencyCode: string; forecastCategory: keyof typeof snapshotCategoryNames; categoryName: string; amount: Prisma.Decimal; opportunityCount: number }>();
  for (const row of snapshots) {
    if (!inSnapshotForecast(row, input)) continue;
    const category = (row.status === 'WON' ? 'CLOSED' : row.forecastCategory) as keyof typeof snapshotCategoryNames;
    const key = `${row.ownerId}:${row.currencyCode}:${category}`;
    const group = grouped.get(key) ?? { ownerId: row.ownerId!, ownerName: row.ownerName!, currencyCode: row.currencyCode, forecastCategory: category, categoryName: snapshotCategoryNames[category], amount: new Prisma.Decimal(0), opportunityCount: 0 };
    group.amount = group.amount.add(row.amount); group.opportunityCount++;
    // A source transaction has one owner name. min also matches SQL validation.
    if (row.ownerName! < group.ownerName) group.ownerName = row.ownerName!;
    grouped.set(key, group);
  }
  const rows = [...grouped.values()].sort((a, b) => a.ownerId - b.ownerId || a.currencyCode.localeCompare(b.currencyCode) || a.forecastCategory.localeCompare(b.forecastCategory));
  return { source, rows, opportunityCount: rows.reduce((n, row) => n + row.opportunityCount, 0), salespersonCount: new Set(rows.map(row => row.ownerId)).size };
}
export async function previewForecastSnapshot(client: PrismaClient, actor: Actor, input: ForecastCaptureInput) {
  assertSnapshotAdmin(actor);
  return client.$transaction(async tx => {
    const result = await readRollup(tx, input);
    return { ...result, preview: { ...input, preparedAt: new Date().toISOString() } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
}
// Shared entry point for explicit manual confirmation and future automation.
// The manual action authenticates this preview with a user-bound signed token.
export async function captureForecastSnapshot(client: PrismaClient, actor: Actor, preview: ForecastPreview, confirmed: boolean) {
  assertSnapshotAdmin(actor);
  if (!confirmed) throw new Error('Explicit confirmation is required.');
  const age = Date.now() - new Date(preview.preparedAt).getTime();
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000) throw new Error('Preview expired. Preview the snapshot again.');
  try {
    return await client.$transaction(async tx => {
      const result = await readRollup(tx, preview);
      const creator = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
      const run = await tx.forecastSnapshotRun.create({ data: {
        sourceRunId: result.source.id, snapshotAt: result.source.snapshotAt,
        createdById: actor.id, createdByName: `${creator.firstName} ${creator.lastName}`,
        year: preview.year, quarter: preview.quarter, opportunityCount: result.opportunityCount,
        salespersonCount: result.salespersonCount, rowCount: result.rows.length,
      } });
      for (let offset = 0; offset < result.rows.length; offset += 500) await tx.forecastSnapshotRollup.createMany({ data: result.rows.slice(offset, offset + 500).map(row => ({ ...row, runId: run.id })) });
      return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new Error('This source run and forecast period already have an immutable Forecast Snapshot.');
    throw error;
  }
}
export function summarizeForecastRows(rows: Pick<ForecastSnapshotRollup, 'forecastCategory' | 'amount' | 'opportunityCount'>[]) {
  const result = { pipeline: new Prisma.Decimal(0), bestCase: new Prisma.Decimal(0), commit: new Prisma.Decimal(0), closedWon: new Prisma.Decimal(0), opportunityCount: new Prisma.Decimal(0) };
  for (const row of rows) {
    if (row.forecastCategory !== 'CLOSED') result.pipeline = result.pipeline.add(row.amount);
    if (row.forecastCategory === 'BEST_CASE') result.bestCase = result.bestCase.add(row.amount);
    if (row.forecastCategory === 'COMMIT') result.commit = result.commit.add(row.amount);
    if (row.forecastCategory === 'CLOSED') result.closedWon = result.closedWon.add(row.amount);
    result.opportunityCount = result.opportunityCount.add(row.opportunityCount);
  }
  return result;
}
export async function compareForecastSnapshotRuns(client: PrismaClient, actor: Actor, beforeId: number, afterId: number, filters: { ownerId?: number; currencyCode?: string } = {}) {
  assertForecastReportAccess(actor);
  if (![beforeId, afterId].every(id => Number.isSafeInteger(id) && id > 0) || beforeId === afterId) throw new Error('Choose two different forecast runs.');
  if (filters.currencyCode && !/^[A-Z]{3}$/.test(filters.currencyCode)) throw new Error('Choose a currency.');
  return client.$transaction(async tx => {
    const runs = await tx.forecastSnapshotRun.findMany({ where: { id: { in: [beforeId, afterId] } }, take: 2 });
    const before = runs.find(run => run.id === beforeId), after = runs.find(run => run.id === afterId);
    if (!before || !after || before.snapshotAt >= after.snapshotAt || before.year !== after.year || before.quarter !== after.quarter) throw new Error('Choose earlier and later runs for the same forecast period.');
    const rows = await tx.forecastSnapshotRollup.findMany({ where: { runId: { in: [beforeId, afterId] }, ...(filters.ownerId ? { ownerId: filters.ownerId } : {}), ...(filters.currencyCode ? { currencyCode: filters.currencyCode } : {}) } });
    const currencies = [...new Set(rows.map(row => row.currencyCode))].sort();
    // Preserve currencies and both endpoint owner sets. A reassignment is a
    // reduction for the previous owner and an increase for the current owner.
    const ownerIds = [...new Set(rows.map(row => row.ownerId))].sort((a, b) => a - b);
    const groups = currencies.flatMap(currencyCode => [undefined, ...ownerIds].flatMap(ownerId => {
      const selected = rows.filter(row => row.currencyCode === currencyCode && (ownerId === undefined || row.ownerId === ownerId));
      if (!selected.length) return [];
      const old = summarizeForecastRows(selected.filter(row => row.runId === beforeId));
      const current = summarizeForecastRows(selected.filter(row => row.runId === afterId));
      return [{ currencyCode, ownerId, ownerName: ownerId === undefined ? 'Team' : (selected.find(row => row.runId === afterId) ?? selected[0]).ownerName,
        previousOwnerName: ownerId === undefined ? null : selected.find(row => row.runId === beforeId)?.ownerName ?? null,
        metrics: forecastMetrics.map(metric => ({ ...metric, ...forecastChange(old[metric.key], current[metric.key]) })) }];
    }));
    return { before, after, groups };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
