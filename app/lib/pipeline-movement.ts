import { Prisma } from '@prisma/client';

// The engine receives period boundaries and ordering/participation policy. It has
// no dependency on calendar quarters, tenant labels, live Opportunities or users.
export type ReportingPeriod = { start: Date; endExclusive: Date };
export type MovementState = {
  accounts?: Prisma.JsonValue;
  opportunityId: number; opportunityName: string; ownerId: number | null; ownerName: string | null;
  amount: Prisma.Decimal | string; currencyCode: string; expectedCloseDate: Date | null;
  stageId: number; stageName: string; stageProbability: number;
  forecastCategory: string | null; status: string; ownerForecastEligible: boolean | null;
};
export type MovementPolicy = {
  categoryOrder?: readonly string[];
  stageOrder?: ReadonlyMap<number, number>;
  participates?: (row: MovementState) => boolean;
};
export type MovementFilters = { period: ReportingPeriod; currencyCode: string; ownerId?: number };
export const financialLabels = {
  additions: 'Additions', increases: 'Value Increases', decreases: 'Value Decreases',
  entered: 'Entered Quarter', slipped: 'Slipped Out', won: 'Closed Won', lost: 'Closed Lost',
  removed: 'Other removals from this view', scopeEntries: 'Other additions or reopened deals',
} as const;
export type FinancialBucket = keyof typeof financialLabels;
export const movementLabels = {
  WON: 'Closed Won', LOST: 'Closed Lost', SLIPPED: 'Slipped out of quarter', ENTERED: 'Entered quarter',
  NEW: 'Newly included', DECREASE: 'Value decreased', INCREASE: 'Value increased',
  FORECAST_DOWN: 'Forecast downgraded', FORECAST_UP: 'Forecast upgraded', FORECAST_CHANGED: 'Forecast category changed',
  STAGE_DOWN: 'Stage regressed', STAGE_UP: 'Stage advanced', STAGE_CHANGED: 'Stage changed',
  REMOVED: 'Removed from active pipeline', REOPENED: 'Reopened', OWNER: 'Owner changed',
  CURRENCY: 'Currency changed', ELIGIBILITY: 'Forecast eligibility changed', DETAILS: 'Other captured changes', UNCHANGED: 'Unchanged',
} as const;
export type MovementType = keyof typeof movementLabels;
// Attribute precedence is independent of financial allocation. Unknown absence
// is never interpreted as Lost. Secondary changes are always retained.
const precedence: MovementType[] = ['WON', 'LOST', 'SLIPPED', 'ENTERED', 'NEW', 'REMOVED', 'REOPENED', 'DECREASE', 'INCREASE', 'FORECAST_DOWN', 'FORECAST_UP', 'FORECAST_CHANGED', 'STAGE_DOWN', 'STAGE_UP', 'STAGE_CHANGED', 'OWNER', 'CURRENCY', 'ELIGIBILITY', 'DETAILS'];
// Two 10,000-row Decimal(18,2) runs can exceed Decimal’s default
// significant-digit precision. Keep cents exact without changing global settings.
const MovementDecimal = Prisma.Decimal.clone({ precision: 40 });
const zero = () => new MovementDecimal(0);
const money = (row: MovementState | null) => row ? new MovementDecimal(row.amount) : zero();
const dateKey = (date: Date | null) => date?.toISOString().slice(0, 10) ?? '—';
const inPeriod = (row: MovementState | null, period: ReportingPeriod) => !!row?.expectedCloseDate && row.expectedCloseDate >= period.start && row.expectedCloseDate < period.endExclusive;
function matchesScope(row: MovementState | null, filters: MovementFilters, policy: MovementPolicy) {
  return !!row && inPeriod(row, filters.period) && row.currencyCode === filters.currencyCode &&
    (filters.ownerId === undefined || row.ownerId === filters.ownerId) && (policy.participates?.(row) ?? true);
}
export function compareMovement(before: MovementState | null, after: MovementState | null, filters: MovementFilters, policy: MovementPolicy = {}) {
  if (!before && !after) throw new Error('A movement requires a snapshot endpoint.');
  const was = before?.status === 'OPEN' && matchesScope(before, filters, policy), now = after?.status === 'OPEN' && matchesScope(after, filters, policy);
  const closureVisible = !!after && ['WON', 'LOST'].includes(after.status) && before?.status !== after.status && (matchesScope(before, filters, policy) || matchesScope(after, filters, policy));
  const previous = was ? money(before) : zero(), current = now ? money(after) : zero();
  const impact = current.sub(previous);
  const changes: { type: MovementType; detail: string }[] = [];
  const add = (type: MovementType, detail: string = movementLabels[type]) => changes.push({ type, detail });
  if (!before) {
    add('NEW', 'Newly included in the later snapshot; creation or prior scope entry is not distinguishable.');
    if (after?.status === 'WON') add('WON', 'Captured Won in the later snapshot; earlier state was not captured.');
    if (after?.status === 'LOST') add('LOST', 'Captured Lost in the later snapshot; earlier state was not captured.');
  }
  if (!after) add('REMOVED', 'No longer captured; reason not recorded. Closure cannot be inferred.');
  if (before && after) {
    if (before.status !== after.status) {
      if (after.status === 'WON') add('WON');
      else if (after.status === 'LOST') add('LOST');
      else if (after.status === 'OPEN') add('REOPENED');
    }
    if (inPeriod(before, filters.period) && !inPeriod(after, filters.period)) add('SLIPPED');
    if (!inPeriod(before, filters.period) && inPeriod(after, filters.period)) add('ENTERED');
    if (before.currencyCode !== after.currencyCode) add('CURRENCY', `${before.currencyCode} → ${after.currencyCode}; amounts are not comparable across currencies.`);
    else if (!money(before).equals(money(after))) add(money(after).lt(money(before)) ? 'DECREASE' : 'INCREASE', `${money(before).toFixed(2)} → ${money(after).toFixed(2)} ${after.currencyCode}`);
    if (before.forecastCategory !== after.forecastCategory) {
      const a = policy.categoryOrder?.indexOf(before.forecastCategory ?? '') ?? -1, b = policy.categoryOrder?.indexOf(after.forecastCategory ?? '') ?? -1;
      add(a >= 0 && b >= 0 ? b > a ? 'FORECAST_UP' : 'FORECAST_DOWN' : 'FORECAST_CHANGED', `${before.forecastCategory ?? 'None'} → ${after.forecastCategory ?? 'None'}`);
    }
    if (before.stageId !== after.stageId) {
      // Only use frozen ordering evidence. Current stage configuration must not
      // retroactively change history. Equal probabilities have unknown direction.
      const a = policy.stageOrder?.get(before.stageId) ?? before.stageProbability, b = policy.stageOrder?.get(after.stageId) ?? after.stageProbability;
      add(b > a ? 'STAGE_UP' : b < a ? 'STAGE_DOWN' : 'STAGE_CHANGED', `${before.stageName} → ${after.stageName}`);
    } else if (before.stageName !== after.stageName) add('DETAILS', `Stage renamed: ${before.stageName} → ${after.stageName}`);
    if (dateKey(before.expectedCloseDate) !== dateKey(after.expectedCloseDate)) add('DETAILS', `Expected close: ${dateKey(before.expectedCloseDate)} → ${dateKey(after.expectedCloseDate)}`);
    if (before.ownerId !== after.ownerId) add('OWNER', `${before.ownerName ?? 'Unassigned'} → ${after.ownerName ?? 'Unassigned'}`);
    if (before.ownerForecastEligible !== after.ownerForecastEligible) add('ELIGIBILITY');
    if (JSON.stringify(before.accounts) !== JSON.stringify(after.accounts)) add('DETAILS', 'Captured Accounts changed.');
    if (before.opportunityName !== after.opportunityName) add('DETAILS', `Opportunity renamed: ${before.opportunityName} → ${after.opportunityName}`);
  }
  const primary = precedence.find(type => changes.some(change => change.type === type)) ?? 'UNCHANGED';
  let bucket: FinancialBucket | null = null;
  if (was && now) bucket = impact.gt(0) ? 'increases' : impact.lt(0) ? 'decreases' : null;
  else if (was) bucket = after?.status === 'WON' ? 'won' : after?.status === 'LOST' ? 'lost' : after && !inPeriod(after, filters.period) ? 'slipped' : 'removed';
  else if (now) bucket = !before ? 'additions' : !inPeriod(before, filters.period) ? 'entered' : 'scopeEntries';
  // Per-category impact is computed from the same endpoint contributions as the
  // pipeline. Entry/exit uses full endpoint values; retained deals use value delta.
  const categories = [...new Set([was ? before?.forecastCategory : null, now ? after?.forecastCategory : null].filter((c): c is string => !!c))];
  const forecast = categories.map(category => {
    const oldMember = was && before?.forecastCategory === category, newMember = now && after?.forecastCategory === category;
    const oldValue = oldMember ? previous : zero(), newValue = newMember ? current : zero();
    return { category, previous: oldValue.toFixed(2), current: newValue.toFixed(2),
      into: newMember && !oldMember ? newValue.toFixed(2) : '0.00', out: oldMember && !newMember ? oldValue.toFixed(2) : '0.00',
      retained: oldMember && newMember ? impact.toFixed(2) : '0.00', impact: newValue.sub(oldValue).toFixed(2) };
  });
  return { opportunityId: (after ?? before)!.opportunityId, before, after, was, now, closureVisible, primary, changes, bucket,
    previous: previous.toFixed(2), current: current.toFixed(2), impact: impact.toFixed(2), forecast };
}
export type DealMovement = ReturnType<typeof compareMovement>;
export function analyzePipelineMovement(before: readonly MovementState[], after: readonly MovementState[], filters: MovementFilters, policy: MovementPolicy = {}) {
  if (!/^[A-Z]{3}$/.test(filters.currencyCode)) throw new Error('Choose one currency.');
  if (!(filters.period.start < filters.period.endExclusive)) throw new Error('Choose a valid reporting period.');
  const index = (rows: readonly MovementState[]) => {
    const map = new Map<number, MovementState>();
    for (const row of rows) { if (map.has(row.opportunityId)) throw new Error('Duplicate snapshot endpoint.'); map.set(row.opportunityId, row); }
    return map;
  };
  const old = index(before), current = index(after);
  const rows = [...new Set([...old.keys(), ...current.keys()])].map(id => compareMovement(old.get(id) ?? null, current.get(id) ?? null, filters, policy)).filter(row => row.was || row.now || row.closureVisible);
  const totals = Object.fromEntries(Object.keys(financialLabels).map(key => [key, zero()])) as Record<FinancialBucket, Prisma.Decimal>;
  let starting = zero(), ending = zero();
  const composition = new Map<string, { previous: Prisma.Decimal; current: Prisma.Decimal; into: Prisma.Decimal; out: Prisma.Decimal; retained: Prisma.Decimal }>();
  for (const row of rows) {
    starting = starting.add(row.previous); ending = ending.add(row.current);
    if (row.bucket) totals[row.bucket] = totals[row.bucket].add(row.impact);
    for (const item of row.forecast) {
      const sum = composition.get(item.category) ?? { previous: zero(), current: zero(), into: zero(), out: zero(), retained: zero() };
      for (const key of ['previous', 'current', 'into', 'out', 'retained'] as const) sum[key] = sum[key].add(item[key]);
      composition.set(item.category, sum);
    }
  }
  const reconciled = starting.add(Object.values(totals).reduce((sum, value) => sum.add(value), zero()));
  if (!reconciled.equals(ending)) throw new Error('Pipeline reconciliation failed.');
  const forecast = [...new Set([...(policy.categoryOrder ?? []), ...composition.keys()])].map(category => {
    const sum = composition.get(category) ?? { previous: zero(), current: zero(), into: zero(), out: zero(), retained: zero() };
    if (!sum.previous.add(sum.into).sub(sum.out).add(sum.retained).equals(sum.current)) throw new Error('Forecast reconciliation failed.');
    return { category, ...Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, value.toFixed(2)])) } as { category: string; previous: string; current: string; into: string; out: string; retained: string };
  });
  const sorted = [...rows].sort((a, b) => new MovementDecimal(b.impact).comparedTo(a.impact) || a.opportunityId - b.opportunityId);
  const has = (row: DealMovement, type: MovementType) => row.changes.some(change => change.type === type);
  return { starting: starting.toFixed(2), ending: ending.toFixed(2), change: ending.sub(starting).toFixed(2), reconciled: true,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)])) as Record<FinancialBucket, string>, rows, forecast,
    groups: {
      positive: sorted.filter(row => new MovementDecimal(row.impact).gt(0)).slice(0, 5),
      negative: [...sorted].reverse().filter(row => new MovementDecimal(row.impact).lt(0)).slice(0, 5),
      slipped: rows.filter(row => has(row, 'SLIPPED')).slice(0, 5),
      upgrades: rows.filter(row => has(row, 'FORECAST_UP')).slice(0, 5), downgrades: rows.filter(row => has(row, 'FORECAST_DOWN')).slice(0, 5),
      won: rows.filter(row => has(row, 'WON')).slice(0, 5), lost: rows.filter(row => has(row, 'LOST')).slice(0, 5),
    } };
}
