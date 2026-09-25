import { operationalOpportunityWhere } from './operational-where';
import { ForecastCategory, Prisma, SalesQuarter, type PrismaClient, type UserRole } from '@prisma/client';
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

type Target = { targetAmount: Prisma.Decimal } | null;
type TeamUser = { id: number; role: UserRole };

// A Sales target is required for SALES; a SALES_MANAGER opts into quota by
// having an active target for this exact period and currency.
export function getRepTargetStatus(role: UserRole, target: Target) {
  if (!target) return role === 'SALES' ? 'MISSING_TARGET' as const : 'NON_QUOTA' as const;
  return target.targetAmount.isZero() ? 'ZERO_TARGET' as const : 'SET' as const;
}

export async function getQuotaParticipants(client: PrismaClient, users: TeamUser[], period: { year: number; quarter: SalesQuarter; currencyCode: string }) {
  quarterBounds(period.year, period.quarter);
  if (!/^[A-Z]{3}$/.test(period.currencyCode)) throw new Error('Choose a currency.');
  const eligible = users.filter(user => user.role === 'SALES' || user.role === 'SALES_MANAGER');
  const targets = eligible.length ? await client.salesTarget.findMany({
    where: { userId: { in: eligible.map(user => user.id) }, year: period.year, quarter: period.quarter, currencyCode: period.currencyCode, archivedAt: null },
    select: { userId: true, targetAmount: true },
  }) : [];
  const byUser = new Map(targets.map(target => [target.userId, target]));
  return eligible.map(user => ({ ...user, target: byUser.get(user.id) ?? null, targetStatus: getRepTargetStatus(user.role, byUser.get(user.id) ?? null) }))
    .filter(user => user.targetStatus !== 'NON_QUOTA');
}

async function forecastForRepWithTarget(client: PrismaClient, actor: Actor, input: { userId: number; year: number; quarter: SalesQuarter; currencyCode: string }, knownTarget?: Target) {
  assertForecastAccess(actor, input.userId);
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new Error('Choose a currency.');
  const { start, endExclusive } = quarterBounds(input.year, input.quarter);
  const [target, opportunities] = await Promise.all([
    knownTarget === undefined ? client.salesTarget.findFirst({ where: { userId: input.userId, year: input.year, quarter: input.quarter, currencyCode: input.currencyCode, archivedAt: null } }) : knownTarget,
    client.opportunity.findMany({ where: { AND: [opportunityScope(actor), { AND: [operationalOpportunityWhere], ownerId: input.userId, archivedAt: null, stage: { isClosed: false }, forecastCategory: { in: [ForecastCategory.PIPELINE, ForecastCategory.BEST_CASE, ForecastCategory.COMMIT] }, currencyCode: input.currencyCode, expectedCloseDate: { gte: start, lt: endExclusive } }] }, select: { forecastCategory: true, probability: true, stage: { select: { probability: true } }, products: { where: { archivedAt: null }, select: { quantity: true, estimatedUnitPrice: true } } } }),
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

export async function forecastForRep(client: PrismaClient, actor: Actor, input: { userId: number; year: number; quarter: SalesQuarter; currencyCode: string }) {
  return forecastForRepWithTarget(client, actor, input);
}

// Team figures sum each visible rep's authoritative forecast. Coverage is
// calculated from the summed amounts and target, never from rep ratios.
export async function forecastForTeam(client: PrismaClient, actor: Actor, input: { users: TeamUser[]; year: number; quarter: SalesQuarter; currencyCode: string }) {
  if (!can(actor, 'sales.read') || actor.role === 'SALES') throw new Error('Access denied');
  const users = [...new Map(input.users.map(user => [user.id, user])).values()];
  const participants = await getQuotaParticipants(client, users, { year: input.year, quarter: input.quarter, currencyCode: input.currencyCode });
  const reps = await Promise.all(participants.map(async user => ({
    ...await forecastForRepWithTarget(client, actor, { ...input, userId: user.id }, user.target),
    targetStatus: user.targetStatus,
  })));
  const sum = (key: 'pipeline' | 'weightedPipeline' | 'commit' | 'target') => reps.reduce((amount, rep) => amount.add(rep[key] ?? 0), new Prisma.Decimal(0));
  const pipeline = sum('pipeline'), weightedPipeline = sum('weightedPipeline'), commit = sum('commit'), target = sum('target');
  const hasTarget = reps.some(rep => rep.target !== null), missingSalesTarget = reps.some(rep => rep.targetStatus === 'MISSING_TARGET');
  const coverageTarget = !missingSalesTarget && hasTarget ? target : null;
  return { ...input, pipeline: pipeline.toFixed(2), weightedPipeline: weightedPipeline.toFixed(2), commit: commit.toFixed(2), target: hasTarget ? target.toFixed(2) : null,
    targetStatus: missingSalesTarget ? 'PARTIAL_TARGET' as const : !hasTarget ? 'NO_TARGET' as const : target.isZero() ? 'ZERO_TARGET' as const : 'SET' as const,
    pipelineCoverage: coverage(pipeline, coverageTarget), weightedCoverage: coverage(weightedPipeline, coverageTarget), commitCoverage: coverage(commit, coverageTarget), reps };
}
