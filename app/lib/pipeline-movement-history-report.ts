import { Prisma, type PrismaClient } from '@prisma/client';
import { type Actor, opportunityReadWhere } from './authorization';
import { listSalesReps } from './assignment-eligibility';
import { businessQuarter, quarterBounds, quarters } from './business-quarter';
import { SNAPSHOT_LIMIT } from './opportunity-snapshots';
import { canReadPipelineMovement, movementOwner, MovementInputError, validMovementRunWhere, salesHubMovementPolicy } from './pipeline-movement-report';
import { analyzeHistory, capturedAccounts, capturedScope, cohortOutcomes, compareQuarterHistory, historicalPolicy, historyWindow, WEEK, type CurrentOutcome, type HistoryCapture } from './pipeline-movement-history';

export type HistoryQuery = { year?: string; quarter?: string; window?: string; ownerId?: string; currencyCode?: string; category?: string; accountId?: string; cohortCategory?: string; cohortRun?: string; compareYear?: string; compareQuarter?: string; reasonView?: string; reason?: string; detailPage?: string; slipPage?: string };
const positiveId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export async function loadMovementHistory(client: PrismaClient, actor: Actor, query: HistoryQuery) {
  if (!canReadPipelineMovement(actor)) throw new Error('Access denied');
  const defaults = businessQuarter();
  const year = query.year === undefined ? defaults.year : Number(query.year);
  const quarter = quarters.find(q => q === (query.quarter ?? defaults.quarter));
  if (!quarter || !Number.isInteger(year) || year < 2000 || year > 2100) throw new MovementInputError('Choose a valid year and quarter.');
  const period = quarterBounds(year, quarter), window = query.window ?? '4';
  if (!['4', '8', '12', 'quarter'].includes(window)) throw new MovementInputError('Choose 4, 8, 12 weeks or the full quarter.');
  const reps = await listSalesReps(client), ownerId = movementOwner(actor, query.ownerId, reps);
  const category = query.category || undefined;
  if (category && !['PIPELINE', 'BEST_CASE', 'COMMIT'].includes(category)) throw new MovementInputError('Choose a captured Forecast Category.');
  const cohortCategory = query.cohortCategory ?? 'COMMIT';
  if (!['COMMIT', 'BEST_CASE', 'all'].includes(cohortCategory)) throw new MovementInputError('Choose a cohort category.');
  const accountId = query.accountId ? positiveId(query.accountId) : undefined;
  if (accountId === null) throw new MovementInputError('Choose a captured Account.');
  const reasonView = query.reasonView ?? 'all';
  if (!['all', 'won', 'lost', 'lost-commit', 'lost-slipped'].includes(reasonView)) throw new MovementInputError('Choose an outcome reason view.');
  async function runsFor(p: typeof period) {
    const runs = await client.opportunitySnapshotRun.findMany({ where: { ...validMovementRunWhere, snapshotAt: { gte: p.start, lt: p.endExclusive } }, orderBy: [{ snapshotAt: 'asc' }, { id: 'asc' }], take: 16 });
    if (runs.length > 15) throw new MovementInputError('Quarter exceeds the supported weekly capture limit.');
    return runs;
  }
  const runs = await runsFor(period);
  const end = runs.at(-1)?.snapshotWeek ?? period.start;
  const bounds = historyWindow(end, period, window);
  const selectedRuns = window === 'quarter' || bounds.start.getTime() === period.start.getTime() ? runs : runs.filter(r => r.snapshotWeek >= bounds.start);
  const target = new Date(period.endExclusive.getTime() - 4 * WEEK);
  const defaultCohort = [...runs].reverse().find(r => r.snapshotAt < new Date(target.getTime() + 86400000) && r.snapshotAt >= new Date(target.getTime() - WEEK));
  const cohortRun = query.cohortRun ? runs.find(r => r.id === positiveId(query.cohortRun!)) : defaultCohort;
  if (query.cohortRun && !cohortRun) throw new MovementInputError('Choose a cohort snapshot in the selected quarter.');
  let comparisonPeriod: typeof period | null = null;
  let comparisonRuns: typeof runs = [];
  if (query.compareYear || query.compareQuarter) {
    const cy = Number(query.compareYear), cq = quarters.find(q => q === query.compareQuarter);
    if (!cq || !Number.isInteger(cy) || cy < 2000 || cy > 2100 || cy === year && cq === quarter) throw new MovementInputError('Choose a different valid comparison quarter and year.');
    comparisonPeriod = quarterBounds(cy, cq); comparisonRuns = await runsFor(comparisonPeriod);
  }
  const allRuns = [...new Map([...selectedRuns, ...(cohortRun ? [cohortRun] : []), ...comparisonRuns].map(r => [r.id, r])).values()];
  // Metadata first: no snapshot rows outside the bounded selected windows.
  const rawRows = allRuns.length ? await client.opportunitySnapshot.findMany({ where: { runId: { in: allRuns.map(r => r.id) } }, orderBy: [{ runId: 'asc' }, { opportunityId: 'asc' }], take: SNAPSHOT_LIMIT * allRuns.length + 1 }) : [];
  if (rawRows.length > SNAPSHOT_LIMIT * allRuns.length || allRuns.some(r => rawRows.filter(row => row.runId === r.id).length !== r.opportunityCount)) throw new MovementInputError('Snapshot rows are incomplete or exceed the supported size.');
  const currencies = [...new Set(rawRows.map(r => r.currencyCode))].sort();
  const currencyCode = query.currencyCode ?? (currencies.includes('USD') ? 'USD' : currencies[0] ?? 'USD');
  if (!/^[A-Z]{3}$/.test(currencyCode) || currencies.length && !currencies.includes(currencyCode)) throw new MovementInputError('Choose a captured currency.');
  const accounts = [...new Map(rawRows.flatMap(capturedAccounts).map(a => [a.id, a])).values()].sort((a, b) => a.name.localeCompare(b.name));
  if (accountId !== undefined && !accounts.some(a => a.id === accountId)) throw new MovementInputError('Choose a captured Account.');
  const policy = historicalPolicy(salesHubMovementPolicy, accountId, category);
  const filters = { period, currencyCode, ownerId };
  const rowsByRun = new Map<number, typeof rawRows>();
  for (const row of rawRows) { const list = rowsByRun.get(row.runId) ?? []; list.push(row); rowsByRun.set(row.runId, list); }
  const captures = (selected: typeof runs): HistoryCapture[] => selected.map(r => ({ ...r, rows: rowsByRun.get(r.id) ?? [] }));
  const options = { categoryKeys: { bestCase: 'BEST_CASE', commit: 'COMMIT' }, hasClosureEvidence: (capture: HistoryCapture) => capture.scopeVersion !== 'OPEN_OPERATIONAL_V1' };
  const history = analyzeHistory(captures(selectedRuns), filters, policy, options);
  const comparison = comparisonPeriod ? analyzeHistory(captures(comparisonRuns), { ...filters, period: comparisonPeriod }, policy, options) : null;
  const pairs = comparison && comparisonPeriod ? compareQuarterHistory(history, comparison, period, comparisonPeriod) : [];
  const ids = [...new Set(rawRows.filter(r => capturedScope(r, filters, policy) || comparisonPeriod && capturedScope(r, { ...filters, period: comparisonPeriod }, policy)).map(r => r.opportunityId))];
  if (ids.length > 20000) throw new MovementInputError('More than 20,000 distinct Opportunities. Narrow the owner, Account or historical window.');
  const outcomes: CurrentOutcome[] = ids.length ? await client.$transaction(async tx => {
    const current = await tx.opportunity.findMany({ where: { id: { in: ids }, ...opportunityReadWhere(actor) }, select: { id: true, expectedCloseDate: true, actualCloseDate: true, outcomeReasonName: true, stage: { select: { isClosed: true, isWon: true } } }, take: ids.length });
    const historyWhere = { opportunityId: { in: current.map(o => o.id) }, eventType: { in: ['CLOSED', 'OUTCOME_REOPENED', 'OUTCOME_UPDATED'] } };
    const select = { id: true, opportunityId: true, occurredAt: true, eventType: true, oldOutcome: true, newOutcome: true };
    const [events, archived] = await Promise.all([
      tx.opportunityHistoryEvent.findMany({ where: historyWhere, select, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 50001 }),
      tx.opportunityHistoryArchive.findMany({ where: historyWhere, select: { ...select, sourceId: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 50001 }),
    ]);
    if (events.length + archived.length > 50000) throw new MovementInputError('Outcome history exceeds 50,000 events. Narrow the owner or historical window.');
    const byOpportunity = new Map<number, Map<number, typeof events[number]>>();
    for (const e of [...archived.map(e => ({ ...e, id: e.sourceId })), ...events]) { const map = byOpportunity.get(e.opportunityId) ?? new Map(); map.set(e.id, e); byOpportunity.set(e.opportunityId, map); }
    return current.map(o => ({ ...o, status: o.stage.isClosed ? o.stage.isWon ? 'WON' : 'LOST' : 'OPEN', events: [...(byOpportunity.get(o.id)?.values() ?? [])] }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 }) : [];
  const outcomeMap = new Map(outcomes.map(outcome => [outcome.id, outcome]));
  const cohort = cohortOutcomes(cohortRun ? rowsByRun.get(cohortRun.id) ?? [] : [], outcomeMap, filters, policy, cohortCategory === 'all' ? undefined : cohortCategory);
  // One first in-scope observation per deal for descriptive outcome/reason views.
  const observed = (selected: typeof runs, p: typeof period) => {
    const unique = new Map<number, ReturnType<typeof cohortOutcomes>[number]>();
    for (const run of selected) for (const item of cohortOutcomes(rowsByRun.get(run.id) ?? [], outcomeMap, { ...filters, period: p }, policy, undefined, true)) if (!unique.has(item.row.opportunityId)) unique.set(item.row.opportunityId, item);
    return [...unique.values()];
  };
  const population = observed(selectedRuns, period);
  const previouslyCommit = new Set(rawRows.filter(r => selectedRuns.some(run => run.id === r.runId) && r.forecastCategory === 'COMMIT' && r.status === 'OPEN' && r.currencyCode === currencyCode && (ownerId === undefined || r.ownerId === ownerId) && policy.participates?.(r) && r.expectedCloseDate && r.expectedCloseDate >= period.start && r.expectedCloseDate < period.endExclusive).map(r => r.opportunityId));
  const slips = history.slips.map(slip => ({ ...slip, analysis: cohortOutcomes([slip.before], outcomeMap, filters, policy)[0] }));
  const slippedBeforeClose = new Set(slips.filter(s => s.analysis?.current?.actualCloseDate && s.observedAt.toISOString().slice(0, 10) <= s.analysis.current.actualCloseDate.toISOString().slice(0, 10)).map(s => s.opportunityId));
  const reasons = population.filter(item => ['WON', 'LOST'].includes(item.current?.status ?? '') && (reasonView === 'all' || reasonView === 'won' && item.current?.status === 'WON' || reasonView !== 'won' && item.current?.status === 'LOST' && (reasonView === 'lost' || reasonView === 'lost-commit' && previouslyCommit.has(item.row.opportunityId) || reasonView === 'lost-slipped' && slippedBeforeClose.has(item.row.opportunityId))));
  const reasonLabels = [...new Set(reasons.map(r => r.reason))].sort();
  const filteredReasons = query.reason ? reasons.filter(r => r.reason === query.reason) : reasons;
  const forecastRuns = allRuns.length ? await client.forecastSnapshotRun.findMany({ where: { sourceRunId: { in: allRuns.map(r => r.id) }, year, quarter, status: 'COMPLETE', rulesVersion: 'QUARTERLY_V1' }, select: { id: true, sourceRunId: true }, take: 32 }) : [];
  return { year, quarter, window, ownerId, reps, currencyCode, currencies: currencies.length ? currencies : ['USD'], accounts, accountId, category, cohortCategory, cohortRun, runs, history, cohort, population, slips, reasons: filteredReasons, reasonLabels, reasonView, comparison, comparisonPopulation: comparisonPeriod ? observed(comparisonRuns.filter(run => pairs.some(p => p.comparison.id === run.id)), comparisonPeriod) : [], comparisonSelectedPopulation: observed(selectedRuns.filter(run => pairs.some(p => p.selected.id === run.id)), period), pairs, forecastRuns, readAt: new Date() };
}
