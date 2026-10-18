import { Prisma } from '@prisma/client';
import { analyzePipelineMovement, type MovementState, type MovementFilters, type MovementPolicy, type ReportingPeriod } from './pipeline-movement';

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const sum = (values: (string | Prisma.Decimal)[]) => values.reduce<Prisma.Decimal>((n, v) => n.add(v), new Decimal(0)).toFixed(2);
export const WEEK = 7 * 86400000;
export type HistoryCapture = { id: number; snapshotAt: Date; snapshotWeek: Date; scopeVersion: string; source: string; rows: MovementState[] };
export type OutcomeEvent = { id: number; occurredAt: Date; eventType: string; oldOutcome: Prisma.JsonValue | null; newOutcome: Prisma.JsonValue | null };
export type CurrentOutcome = { id: number; status: string; expectedCloseDate: Date | null; actualCloseDate: Date | null; outcomeReasonName: string | null; events: OutcomeEvent[] };
const inside = (date: Date | null, period: ReportingPeriod) => !!date && date >= period.start && date < period.endExclusive;
export const calendarPeriod = (date: Date | null) => date ? `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}` : 'Unknown';
export function historyWindow(end: Date, period: ReportingPeriod, window: string) {
  if (!['4', '8', '12', 'quarter'].includes(window)) throw new Error('Choose 4, 8, 12 weeks or the full quarter.');
  return { start: window === 'quarter' ? period.start : new Date(Math.max(period.start.getTime(), end.getTime() - Number(window) * WEEK)), end };
}
export function capturedAccounts(row: MovementState) {
  return Array.isArray(row.accounts) ? row.accounts.flatMap(a => a && typeof a === 'object' && !Array.isArray(a) && typeof a.id === 'number' && typeof a.name === 'string' ? [{ id: a.id, name: a.name }] : []) : [];
}
export function historicalPolicy(base: MovementPolicy, accountId?: number, category?: string): MovementPolicy {
  return { ...base, participates: row => (base.participates?.(row) ?? true) && (accountId === undefined || capturedAccounts(row).some(a => a.id === accountId)) && (!category || row.forecastCategory === category) };
}
export function capturedScope(row: MovementState, filters: MovementFilters, policy: MovementPolicy) {
  return inside(row.expectedCloseDate, filters.period) && row.currencyCode === filters.currencyCode && (filters.ownerId === undefined || row.ownerId === filters.ownerId) && (policy.participates?.(row) ?? true);
}
export type HistoryOptions = { categoryKeys?: { bestCase: string; commit: string }; hasClosureEvidence?: (capture: HistoryCapture) => boolean };
export function analyzeHistory(captures: HistoryCapture[], filters: MovementFilters, policy: MovementPolicy = {}, options: HistoryOptions = {}) {
  const ordered = [...captures].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
  let slipped = new Decimal(0), entered = new Decimal(0);
  const slips = new Map<number, { opportunityId: number; before: MovementState; after: MovementState; observedAt: Date; weeks: number | null }>();
  const points = ordered.map((capture, i) => {
    const rows = capture.rows.filter(row => capturedScope(row, filters, policy));
    const open = rows.filter(row => row.status === 'OPEN');
    const delta = i ? analyzePipelineMovement(ordered[i - 1].rows, capture.rows, filters, policy) : null;
    if (delta) {
      slipped = slipped.sub(delta.totals.slipped); entered = entered.add(delta.totals.additions).add(delta.totals.entered);
      for (const row of delta.rows) if (row.bucket === 'slipped' && row.before && row.after && !slips.has(row.opportunityId)) slips.set(row.opportunityId, {
        opportunityId: row.opportunityId, before: row.before, after: row.after, observedAt: capture.snapshotAt,
        weeks: row.before.expectedCloseDate && row.after.expectedCloseDate ? Math.ceil((row.after.expectedCloseDate.getTime() - row.before.expectedCloseDate.getTime()) / WEEK) : null,
      });
    }
    return { id: capture.id, at: capture.snapshotAt, week: capture.snapshotWeek, source: capture.source, scopeVersion: capture.scopeVersion,
      pipeline: sum(open.map(r => r.amount)), bestCase: options.categoryKeys ? sum(open.filter(r => r.forecastCategory === options.categoryKeys!.bestCase).map(r => r.amount)) : null,
      commit: options.categoryKeys ? sum(open.filter(r => r.forecastCategory === options.categoryKeys!.commit).map(r => r.amount)) : null,
      closedWon: options.hasClosureEvidence?.(capture) === false ? null : sum(rows.filter(r => r.status === 'WON').map(r => r.amount)),
      slipped: slipped.toFixed(2), entered: entered.toFixed(2), intervalSlipped: delta ? new Decimal(delta.totals.slipped).neg().toFixed(2) : null,
      intervalEntered: delta ? sum([delta.totals.additions, delta.totals.entered]) : null,
      gap: i > 0 && capture.snapshotWeek.getTime() - ordered[i - 1].snapshotWeek.getTime() > WEEK,
    };
  });
  const reconciliation = ordered.length > 1 ? analyzePipelineMovement(ordered[0].rows, ordered.at(-1)!.rows, filters, policy) : null;
  return { points, slips: [...slips.values()], reconciliation };
}
export function timingOutcome(expected: Date | null, current: CurrentOutcome | undefined) {
  if (!current) return 'Outcome unavailable';
  if (current.status === 'OPEN') return expected && current.expectedCloseDate && calendarPeriod(expected) !== calendarPeriod(current.expectedCloseDate) ? 'Slipped to another quarter' : 'Still open';
  if (!current.actualCloseDate) return 'Actual close unknown';
  if (!expected) return 'Expected close unknown';
  if (calendarPeriod(expected) === calendarPeriod(current.actualCloseDate)) return 'Closed in expected period';
  return current.actualCloseDate > expected ? 'Closed later than expected' : 'Closed earlier than expected';
}
function jsonStatus(value: Prisma.JsonValue | null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value.status : undefined;
}
export function cohortOutcomes(rows: MovementState[], outcomes: CurrentOutcome[] | ReadonlyMap<number, CurrentOutcome>, filters: MovementFilters, policy: MovementPolicy = {}, category?: string, includeClosed = false) {
  const byId = Array.isArray(outcomes) ? new Map(outcomes.map(o => [o.id, o])) : outcomes;
  return rows.filter(row => (includeClosed || row.status === 'OPEN') && capturedScope(row, filters, policy) && (!category || row.forecastCategory === category)).map(row => {
    const current = byId.get(row.opportunityId);
    let outcome = 'Outcome unavailable';
    if (current?.status === 'WON') outcome = !current.actualCloseDate ? 'Closed Won · actual close unknown' : inside(current.actualCloseDate, filters.period) ? 'Closed Won in-period' : current.actualCloseDate >= filters.period.endExclusive ? 'Closed Won later' : 'Closed Won earlier';
    else if (current?.status === 'LOST') outcome = 'Closed Lost';
    else if (current?.status === 'OPEN') outcome = current.expectedCloseDate && !inside(current.expectedCloseDate, filters.period) ? 'Slipped to another quarter' : 'Still open';
    const events = [...(current?.events ?? [])].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id);
    const latest = events.at(-1);
    const expectedStatus = current?.status === 'WON' ? 'Closed Won' : current?.status === 'LOST' ? 'Closed Lost' : 'Open';
    const latestValue = latest?.newOutcome;
    const context = latestValue && typeof latestValue === 'object' && !Array.isArray(latestValue) ? latestValue : null;
    const ambiguous = !!latest && (jsonStatus(latest.newOutcome) !== expectedStatus || !!context && (
      'actualCloseDate' in context && context.actualCloseDate !== (current?.actualCloseDate?.toISOString().slice(0, 10) ?? null) ||
      'outcomeReason' in context && context.outcomeReason !== (current?.outcomeReasonName ?? null)));

    return { row, current, outcome, timing: timingOutcome(row.expectedCloseDate, current),
      reason: current?.outcomeReasonName ?? 'Not recorded', events, ambiguous,
      closures: events.filter(e => e.eventType === 'CLOSED').length, reopens: events.filter(e => e.eventType === 'OUTCOME_REOPENED').length };
  });
}
export type CohortRow = ReturnType<typeof cohortOutcomes>[number];
export function outcomeGroups(rows: CohortRow[], dimension: 'outcome' | 'reason' | 'owner' | 'account' | 'timing') {
  const groups = new Map<string, { label: string; count: number; value: string; won: number; lost: number; open: number }>();
  for (const item of rows) {
    const labels = dimension === 'account' ? [...new Set(capturedAccounts(item.row).map(a => `${a.name} (#${a.id})`))] : [dimension === 'owner' ? `${item.row.ownerName ?? 'Unknown'} (#${item.row.ownerId ?? '—'})` : dimension === 'reason' ? `${item.current?.status ?? 'Unknown'} · ${item.reason}` : item[dimension]];
    for (const label of labels.length ? labels : ['No captured Account']) {
      const g = groups.get(label) ?? { label, count: 0, value: '0.00', won: 0, lost: 0, open: 0 };
      g.count++; g.value = sum([g.value, item.row.amount]);
      if (item.current?.status === 'WON') g.won++; if (item.current?.status === 'LOST') g.lost++; if (item.current?.status === 'OPEN') g.open++;
      groups.set(label, g);
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function compareQuarterHistory(a: ReturnType<typeof analyzeHistory>, b: ReturnType<typeof analyzeHistory>, aPeriod: ReportingPeriod, bPeriod: ReportingPeriod) {
  const weekIndex = (date: Date, period: ReportingPeriod) => Math.floor((date.getTime() - period.start.getTime()) / WEEK);
  const pairs = a.points.flatMap((point, index) => {
    const other = b.points.find(p => weekIndex(p.at, bPeriod) === weekIndex(point.at, aPeriod) && p.scopeVersion === point.scopeVersion && p.closedWon !== null && point.closedWon !== null);
    const otherIndex = other ? b.points.indexOf(other) : -1;
    const sameInterval = index > 0 && otherIndex > 0 && weekIndex(a.points[index - 1].at, aPeriod) === weekIndex(b.points[otherIndex - 1].at, bPeriod) && a.points[index - 1].scopeVersion === b.points[otherIndex - 1].scopeVersion;
    return other ? [{ sameInterval, week: weekIndex(point.at, aPeriod) + 1, selected: point, comparison: other }] : [];
  });
  return pairs.length >= 2 ? pairs : [];
}

/** Endpoint attribution preserves transfers and overlapping Account membership. */
export function movementGroups(result: ReturnType<typeof analyzePipelineMovement> | null, dimension: 'account' | 'owner') {
  const groups = new Map<string, { label: string; starting: string; ending: string; change: string }>();
  for (const row of result?.rows ?? []) for (const endpoint of ['before', 'after'] as const) {
    const captured = row[endpoint];
    if (!captured) continue;
    const labels = dimension === 'account' ? [...new Set(capturedAccounts(captured).map(a => `${a.name} (#${a.id})`))] : [`${captured.ownerName ?? 'Unknown'} (#${captured.ownerId ?? '—'})`];
    for (const label of labels.length ? labels : ['No captured Account']) {
      const group = groups.get(label) ?? { label, starting: '0.00', ending: '0.00', change: '0.00' };
      if (endpoint === 'before') group.starting = sum([group.starting, row.previous]);
      else group.ending = sum([group.ending, row.current]);
      group.change = new Decimal(group.ending).sub(group.starting).toFixed(2);
      groups.set(label, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
