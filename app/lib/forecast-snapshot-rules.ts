import { Prisma, type OpportunitySnapshot, type SalesQuarter } from '@prisma/client';
import { quarterBounds } from './business-quarter';

export type ForecastPeriod = { year: number; quarter: SalesQuarter };
export const forecastSnapshotCategories = ['PIPELINE', 'BEST_CASE', 'COMMIT', 'CLOSED'] as const;
export const snapshotCategoryNames = { PIPELINE: 'Pipeline', BEST_CASE: 'Best Case', COMMIT: 'Commit', CLOSED: 'Closed Won' } as const;
export type ForecastMetric = 'pipeline' | 'bestCase' | 'commit' | 'closedWon' | 'opportunityCount';
export const forecastMetrics: { key: ForecastMetric; label: string }[] = [
  { key: 'commit', label: 'Commit' }, { key: 'bestCase', label: 'Best Case' },
  { key: 'pipeline', label: 'Pipeline (all open forecast categories)' },
  { key: 'closedWon', label: 'Closed Won' }, { key: 'opportunityCount', label: 'Opportunity count (open + won)' },
];
export function inSnapshotForecast(row: OpportunitySnapshot | null, period: ForecastPeriod, filters: { ownerId?: number; currencyCode?: string; category?: string } = {}) {
  const { start, endExclusive } = quarterBounds(period.year, period.quarter);
  if (!row || !row.ownerId || row.ownerForecastEligible !== true || !row.expectedCloseDate || row.expectedCloseDate < start || row.expectedCloseDate >= endExclusive) return false;
  if (filters.ownerId && row.ownerId !== filters.ownerId || filters.currencyCode && row.currencyCode !== filters.currencyCode) return false;
  if (!(row.status === 'OPEN' && ['PIPELINE', 'BEST_CASE', 'COMMIT'].includes(row.forecastCategory) || row.status === 'WON')) return false;
  return !filters.category || (filters.category === 'ALL_OPEN' ? row.status === 'OPEN' : (row.status === 'WON' ? 'CLOSED' : row.forecastCategory) === filters.category);
}
export function forecastChange(previous: Prisma.Decimal | string | number, current: Prisma.Decimal | string | number) {
  const before = new Prisma.Decimal(previous), after = new Prisma.Decimal(current), change = after.sub(before);
  return { previous: before.toFixed(2), current: after.toFixed(2), change: change.toFixed(2), percent: before.isZero() ? null : change.div(before.abs()).mul(100).toFixed(2) };
}
