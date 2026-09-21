import { ForecastCategory, Prisma, SalesQuarter, type PrismaClient } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { opportunityTotal, weightedValue } from './opportunities';

export const quarters = Object.values(SalesQuarter);
export function quarterBounds(year: number, quarter: SalesQuarter) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !quarters.includes(quarter)) throw new Error('Choose a valid year and quarter.');
  const month = quarters.indexOf(quarter) * 3;
  // SalesHub stores date-only expected close dates at noon UTC. UTC calendar
  // boundaries therefore include every New York calendar date, including DST days.
  return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 3, 1)) };
}

export function assertForecastAccess(actor: Actor, userId: number) {
  if (!can(actor, 'sales.read') || (actor.role === 'SALES' && actor.id !== userId)) throw new Error('Access denied');
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Choose a sales rep.');
}

export function coverage(amount: Prisma.Decimal, target: Prisma.Decimal | null) {
  return target && target.gt(0) ? amount.div(target).toDecimalPlaces(2).toFixed(2) : null;
}

export async function forecastForRep(client: PrismaClient, actor: Actor, input: { userId: number; year: number; quarter: SalesQuarter; currencyCode: string }) {
  assertForecastAccess(actor, input.userId);
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new Error('Choose a currency.');
  const { start, endExclusive } = quarterBounds(input.year, input.quarter);
  const [target, opportunities] = await Promise.all([
    client.salesTarget.findFirst({ where: { userId: input.userId, year: input.year, quarter: input.quarter, currencyCode: input.currencyCode, archivedAt: null } }),
    client.opportunity.findMany({ where: { AND: [opportunityScope(actor), { ownerId: input.userId, archivedAt: null, stage: { isClosed: false }, forecastCategory: { in: [ForecastCategory.PIPELINE, ForecastCategory.BEST_CASE, ForecastCategory.COMMIT] }, currencyCode: input.currencyCode, expectedCloseDate: { gte: start, lt: endExclusive } }] }, select: { forecastCategory: true, probability: true, stage: { select: { probability: true } }, products: { where: { archivedAt: null }, select: { quantity: true, estimatedUnitPrice: true } } } }),
  ]);
  let pipeline = new Prisma.Decimal(0), weightedPipeline = new Prisma.Decimal(0), commit = new Prisma.Decimal(0), bestCase = new Prisma.Decimal(0);
  for (const row of opportunities) {
    const value = opportunityTotal(row.products);
    pipeline = pipeline.add(value);
    weightedPipeline = weightedPipeline.add(weightedValue(value, row.probability ?? row.stage.probability));
    if (row.forecastCategory === ForecastCategory.COMMIT) commit = commit.add(value);
    if (row.forecastCategory === ForecastCategory.BEST_CASE) bestCase = bestCase.add(value);
  }
  const targetAmount = target?.targetAmount ?? null;
  return {
    ...input, periodStart: start.toISOString().slice(0, 10), periodEnd: new Date(endExclusive.getTime() - 86400000).toISOString().slice(0, 10),
    target: targetAmount?.toFixed(2) ?? null, targetStatus: !target ? 'NO_TARGET' as const : targetAmount!.isZero() ? 'ZERO_TARGET' as const : 'SET' as const,
    pipeline: pipeline.toFixed(2), weightedPipeline: weightedPipeline.toFixed(2), commit: commit.toFixed(2), bestCase: bestCase.toFixed(2),
    pipelineCoverage: coverage(pipeline, targetAmount), weightedCoverage: coverage(weightedPipeline, targetAmount), commitCoverage: coverage(commit, targetAmount),
    opportunityCount: opportunities.length, commitCount: opportunities.filter(row => row.forecastCategory === ForecastCategory.COMMIT).length, bestCaseCount: opportunities.filter(row => row.forecastCategory === ForecastCategory.BEST_CASE).length,
  };
}
