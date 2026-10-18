import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import type { Actor } from './authorization';
import { adminPage } from './admin-ownership';
import { auditDate } from './admin-audit';
import { failureLabels, failureMessages, integrationLabels, type OperationalFailure } from './integration-attempts';

export type IntegrationFilters = { integration?: string; status?: string; from?: string; to?: string; actor?: string; page?: string; attempt?: string };
export const attemptStatuses = ['Failed', 'Recovered', 'Successful', 'Running'] as const;
export function normalizeIntegrationFilters(raw: IntegrationFilters): IntegrationFilters {
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => ['integration', 'status', 'from', 'to', 'actor', 'page', 'attempt'].includes(k) && typeof v === 'string').map(([k, v]) => [k, v!.trim().slice(0, 40)]));
}
// Derive recovery from immutable evidence, including existing weekly rows. A success
// must START after failure completion. Concurrent partial work cannot prove recovery.
const context = Prisma.sql`CASE WHEN h."jobType" = 'WEEKLY_SNAPSHOTS' THEN h."snapshotWeek"::text WHEN h."jobType" IN ('CALENDAR_SYNC', 'NOTIFICATION_EVALUATOR') THEN 'scheduler' ELSE h."contextKey" END`;
const source = Prisma.sql`SELECT h.id, h."jobType", COALESCE(h.operation, 'RUN') AS operation, h."startedAt", h."completedAt", h."failureCategory", h."actorId", h."isTest", h."supportCaseId", h."calendarConnectionId", h."snapshotWeek", h."opportunitySnapshotRunId", h."forecastSnapshotRunId",
  COALESCE(u."firstName" || ' ' || u."lastName", CASE WHEN h."actorId" IS NOT NULL THEN 'User #' || h."actorId"::text WHEN h."jobType" = 'WEEKLY_SNAPSHOTS' THEN 'Weekly snapshot service' WHEN h."serviceIdentity" = 'calendar-sync' THEN 'Calendar sync service' ELSE 'System' END) AS actor,
  recovery.id AS "recoveryId", recovery."completedAt" AS "recoveredAt",
  CASE WHEN h.status = 'FAILED' THEN CASE WHEN recovery.id IS NULL THEN 'Failed' ELSE 'Recovered' END WHEN h.status = 'SUCCEEDED' THEN 'Successful' ELSE 'Running' END AS state
  FROM "ScheduledJobRun" h LEFT JOIN "User" u ON u.id = h."actorId"
  LEFT JOIN LATERAL (SELECT s.id, s."completedAt" FROM "ScheduledJobRun" s
    WHERE h.status = 'FAILED' AND h."completedAt" IS NOT NULL AND ${context} IS NOT NULL
      AND s."jobType" = h."jobType" AND COALESCE(s.operation, 'RUN') = COALESCE(h.operation, 'RUN') AND s."isTest" = h."isTest"
      AND (CASE WHEN s."jobType" = 'WEEKLY_SNAPSHOTS' THEN s."snapshotWeek"::text WHEN s."jobType" IN ('CALENDAR_SYNC', 'NOTIFICATION_EVALUATOR') THEN 'scheduler' ELSE s."contextKey" END) = ${context}
      AND s.status = 'SUCCEEDED' AND s."completedAt" IS NOT NULL AND s."startedAt" >= h."completedAt" AND s.id > h.id
    ORDER BY s."startedAt", s.id LIMIT 1) recovery ON true
  WHERE h."jobType" IN (${Prisma.join(Object.keys(integrationLabels))})`;
export type IntegrationRow = { id: number; jobType: string; operation: string; startedAt: Date; completedAt: Date | null; failureCategory: string | null; actorId: number | null; actor: string; isTest: boolean; supportCaseId: number | null; calendarConnectionId: number | null; snapshotWeek: Date | null; opportunitySnapshotRunId: number | null; forecastSnapshotRunId: number | null; recoveryId: number | null; recoveredAt: Date | null; state: string };
export function safeAttemptFailure(category: string | null) {
  const snapshot: Record<string, string> = { OPPORTUNITY_CAPTURE_FAILED: 'Opportunity capture did not complete. Retry the intended week.', FORECAST_CAPTURE_FAILED: 'Forecast capture did not complete. The Opportunity Snapshot is preserved. Retry the intended week.', INCOMPATIBLE_SOURCE: 'Configuration issue. This week has an incompatible Opportunity Snapshot. Admin review required.', MISSING_HISTORICAL_SOURCE: 'The historical Opportunity Snapshot is missing. Historical live data cannot be reconstructed.' };
  if (category && Object.hasOwn(snapshot, category)) return snapshot[category];
  return category && Object.hasOwn(failureMessages, category) ? failureMessages[category as OperationalFailure] : failureMessages.UNKNOWN;
}
export function safeFailureLabel(category: string | null) { return category && Object.hasOwn(failureLabels, category) ? failureLabels[category as OperationalFailure] : category === 'INCOMPATIBLE_SOURCE' || category === 'MISSING_HISTORICAL_SOURCE' ? 'Configuration issue' : category === 'OPPORTUNITY_CAPTURE_FAILED' || category === 'FORECAST_CAPTURE_FAILED' ? 'Snapshot capture failed' : 'Unknown failure'; }
export function safeFailureDetail(category: string | null) {
  const message = safeAttemptFailure(category), prefix = `${safeFailureLabel(category)}. `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}
export function integrationConditions(raw: IntegrationFilters) {
  const f = normalizeIntegrationFilters(raw), clauses = [Prisma.sql`true`];
  const from = auditDate(f.from), to = auditDate(f.to);
  if (from) clauses.push(Prisma.sql`"startedAt" >= ${from}`);
  if (to) clauses.push(Prisma.sql`"startedAt" < ${new Date(to.getTime() + 86400000)}`);
  if (f.integration && Object.hasOwn(integrationLabels, f.integration)) clauses.push(Prisma.sql`"jobType" = ${f.integration}`);
  if (attemptStatuses.includes(f.status as typeof attemptStatuses[number])) clauses.push(Prisma.sql`state = ${f.status}`);
  if (/^[1-9]\d*$/.test(f.attempt ?? '') && Number.isSafeInteger(Number(f.attempt))) clauses.push(Prisma.sql`id = ${Number(f.attempt)}`);
  if (f.actor === 'system') clauses.push(Prisma.sql`"actorId" IS NULL`);
  else if (/^[1-9]\d*$/.test(f.actor ?? '') && Number.isSafeInteger(Number(f.actor))) clauses.push(Prisma.sql`"actorId" = ${Number(f.actor)}`);
  return Prisma.join(clauses, ' AND ');
}
export async function adminIntegrationHistory(db: PrismaClient, actor: Actor, filters: IntegrationFilters) {
  assertAdmin(actor);
  const conditions = integrationConditions(filters);
  return db.$transaction(async tx => {
    const [countRow] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM (${source}) history WHERE ${conditions}`;
    const count = Number(countRow.count), pages = Math.max(1, Math.ceil(count / 25)), page = Math.min(adminPage(filters.page), pages);
    const rows = await tx.$queryRaw<IntegrationRow[]>`SELECT * FROM (${source}) history WHERE ${conditions} ORDER BY "startedAt" DESC, id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`;
    return { rows, count, page, pages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function durableIntegrationHealth(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  return Promise.all((['SUPPORT_GMAIL', 'CALENDAR_CONNECTION_SYNC', 'WEEKLY_SNAPSHOTS'] as const).map(async jobType => {
    const [latest, successful, failed] = await Promise.all([
      db.$queryRaw<IntegrationRow[]>`SELECT * FROM (${source}) history WHERE "jobType" = ${jobType} AND NOT "isTest" ORDER BY "startedAt" DESC, id DESC LIMIT 1`,
      db.$queryRaw<IntegrationRow[]>`SELECT * FROM (${source}) history WHERE "jobType" = ${jobType} AND NOT "isTest" AND state = 'Successful' ORDER BY "completedAt" DESC, id DESC LIMIT 1`,
      db.$queryRaw<IntegrationRow[]>`SELECT * FROM (${source}) history WHERE "jobType" = ${jobType} AND NOT "isTest" AND state = 'Failed' ORDER BY "startedAt" DESC, id DESC LIMIT 1`,
    ]);
    return { jobType, latest: latest[0] ?? null, successful: successful[0] ?? null, failed: failed[0] ?? null };
  }));
}
