import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import type { Actor } from './authorization';
import { adminPage, adminPageSize } from './admin-ownership';
export const auditEntities = ['Opportunity', 'Support Case', 'Task', 'Price Exception', 'Account', 'Contact', 'Activity'] as const;
export const auditActions = ['Outcome', 'Stage', 'Value', 'Expected close date', 'Owner', 'Forecast category', 'Probability', 'Currency', 'Assignment', 'Status', 'Priority', 'Follow-up', 'Relationship', 'Archive', 'Restore', 'Created', 'Other'] as const;
export type AuditFilters = { from?: string; to?: string; actor?: string; entity?: string; action?: string; page?: string };
export function normalizeAuditFilters(raw: AuditFilters): AuditFilters {
  const result: AuditFilters = {};
  for (const key of ['from', 'to', 'actor', 'entity', 'action', 'page'] as const) {
    if (typeof raw[key] === 'string') result[key] = raw[key]!.trim().slice(0, 40);
  }
  return result;
}
export type AuditRow = { key: string; at: Date; actorId: number | null; actor: string | null; entity: string; recordId: number | null; name: string; action: string; detail: string; before: string | null; after: string | null };
const person = Prisma.sql`u."firstName" || ' ' || u."lastName"`;
// Only curated business fields enter this report. No descriptions, notes, tokens, or arbitrary JSON.
function opportunitySource(archive: boolean) {
  const table = archive ? Prisma.sql`"OpportunityHistoryArchive"` : Prisma.sql`"OpportunityHistoryEvent"`;
  return Prisma.sql`SELECT ${archive ? 'opportunity-archive-' : 'opportunity-'} || h.id::text AS key, h."occurredAt" AS at, h."actorId", h."actorName" AS actor,
    'Opportunity'::text AS entity, h."opportunityId" AS "recordId", h."opportunityName" AS name,
    CASE h."eventType" WHEN 'CLOSED' THEN 'Outcome' WHEN 'OUTCOME_REOPENED' THEN 'Outcome' WHEN 'OUTCOME_UPDATED' THEN 'Outcome' WHEN 'STAGE' THEN 'Stage' WHEN 'VALUE' THEN 'Value' WHEN 'EXPECTED_CLOSE_DATE' THEN 'Expected close date' WHEN 'OWNER' THEN 'Owner' WHEN 'FORECAST_CATEGORY' THEN 'Forecast category' WHEN 'PROBABILITY' THEN 'Probability' WHEN 'CURRENCY' THEN 'Currency' WHEN 'ARCHIVED' THEN 'Archive' WHEN 'REOPENED' THEN 'Restore' WHEN 'BASELINE' THEN 'Created' ELSE CASE WHEN h."eventType" LIKE '%ACCOUNT%' OR h."eventType" LIKE '%CONTACT%' OR h."eventType" LIKE '%PROJECT%' THEN 'Relationship' ELSE 'Other' END END AS action,
    CASE h."eventType" WHEN 'CLOSED' THEN 'Opportunity closed' WHEN 'OUTCOME_REOPENED' THEN 'Opportunity reopened' WHEN 'OUTCOME_UPDATED' THEN 'Outcome details updated' ELSE replace(h."eventType", '_', ' ') || COALESCE(': ' || h."relatedRecordName", '') END AS detail,
    CASE h."eventType" WHEN 'CLOSED' THEN concat_ws(' · ', h."oldOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."oldOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."oldOutcome"->>'outcomeReason', 'Unknown')) WHEN 'OUTCOME_REOPENED' THEN concat_ws(' · ', h."oldOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."oldOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."oldOutcome"->>'outcomeReason', 'Unknown')) WHEN 'OUTCOME_UPDATED' THEN concat_ws(' · ', h."oldOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."oldOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."oldOutcome"->>'outcomeReason', 'Unknown')) WHEN 'STAGE' THEN h."oldStageName" WHEN 'VALUE' THEN h."oldValue"::text || ' ' || COALESCE(h."oldCurrencyCode", '') WHEN 'EXPECTED_CLOSE_DATE' THEN to_char(h."oldCloseDate", 'YYYY-MM-DD') WHEN 'OWNER' THEN h."oldOwnerName" WHEN 'FORECAST_CATEGORY' THEN h."oldCategory"::text WHEN 'PROBABILITY' THEN h."oldProbability"::text WHEN 'CURRENCY' THEN h."oldCurrencyCode" WHEN 'ARCHIVED' THEN h."oldArchived"::text WHEN 'REOPENED' THEN h."oldArchived"::text ELSE nullif(array_to_string(h."oldRoles", ', '), '') END AS before,
    CASE h."eventType" WHEN 'CLOSED' THEN concat_ws(' · ', h."newOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."newOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."newOutcome"->>'outcomeReason', 'Unknown')) WHEN 'OUTCOME_REOPENED' THEN concat_ws(' · ', h."newOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."newOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."newOutcome"->>'outcomeReason', 'Unknown')) WHEN 'OUTCOME_UPDATED' THEN concat_ws(' · ', h."newOutcome"->>'status', 'Actual Close Date: ' || COALESCE(h."newOutcome"->>'actualCloseDate', 'Unknown'), 'Outcome Reason: ' || COALESCE(h."newOutcome"->>'outcomeReason', 'Unknown')) WHEN 'STAGE' THEN h."newStageName" WHEN 'VALUE' THEN h."newValue"::text || ' ' || COALESCE(h."newCurrencyCode", '') WHEN 'EXPECTED_CLOSE_DATE' THEN to_char(h."newCloseDate", 'YYYY-MM-DD') WHEN 'OWNER' THEN h."newOwnerName" WHEN 'FORECAST_CATEGORY' THEN h."newCategory"::text WHEN 'PROBABILITY' THEN h."newProbability"::text WHEN 'CURRENCY' THEN h."newCurrencyCode" WHEN 'ARCHIVED' THEN h."newArchived"::text WHEN 'REOPENED' THEN h."newArchived"::text ELSE nullif(array_to_string(h."newRoles", ', '), '') END AS after
    FROM ${table} h ${archive ? Prisma.sql`WHERE NOT EXISTS (SELECT 1 FROM "OpportunityHistoryEvent" live WHERE live.id = h."sourceId")` : Prisma.empty}`;
}
const sources = Prisma.sql`${opportunitySource(false)} UNION ALL ${opportunitySource(true)}
UNION ALL SELECT 'support-' || h.id, h."createdAt", h."actorId", ${person}, 'Support Case', c.id, c."caseNumber" || ': ' || c.subject,
  CASE h.field WHEN 'assignedToId' THEN 'Assignment' WHEN 'status' THEN 'Status' WHEN 'priority' THEN 'Priority' WHEN 'CREATED' THEN 'Created' WHEN 'archivedAt' THEN CASE WHEN h."newValue" IS NULL THEN 'Restore' ELSE 'Archive' END ELSE 'Other' END,
  CASE h.field WHEN 'assignedToId' THEN 'Assigned Support rep' WHEN 'archivedAt' THEN 'Archive state' WHEN 'CREATED' THEN 'Case created' ELSE initcap(h.field) END, COALESCE(h."oldLabel", h."oldValue"), COALESCE(h."newLabel", h."newValue")
  FROM "SupportCaseLifecycleEvent" h JOIN "SupportCase" c ON c.id = h."supportCaseId" JOIN "User" u ON u.id = h."actorId" WHERE h.field IN ('status', 'priority', 'assignedToId', 'archivedAt', 'CREATED')
UNION ALL SELECT 'task-' || h.id, h."createdAt", h."actorId", ${person}, 'Task', t.id, t.subject, 'Assignment', 'Assigned user',
  COALESCE(f."firstName" || ' ' || f."lastName", CASE WHEN h."fromUserId" IS NOT NULL THEN 'User #' || h."fromUserId" END),
  COALESCE(n."firstName" || ' ' || n."lastName", CASE WHEN h."toUserId" IS NOT NULL THEN 'User #' || h."toUserId" END)
  FROM "TaskAssignmentEvent" h JOIN "Task" t ON t.id = h."taskId" LEFT JOIN "User" u ON u.id = h."actorId" LEFT JOIN "User" f ON f.id = h."fromUserId" LEFT JOIN "User" n ON n.id = h."toUserId"
UNION ALL SELECT 'pe-' || h.id, h."createdAt", h."actorId", ${person}, 'Price Exception', p.id, COALESCE(p."peCode", 'Price Exception #' || p.id), 'Status', 'Lifecycle status', h."oldStatus"::text, h."newStatus"::text
  FROM "PriceExceptionLifecycleEvent" h JOIN "PriceException" p ON p.id = h."priceExceptionId" JOIN "User" u ON u.id = h."actorId"
UNION ALL SELECT 'pe-follow-' || h.id || '-' || v.field, h."createdAt", h."actorId", ${person}, 'Price Exception', p.id, COALESCE(p."peCode", 'Price Exception #' || p.id),
  CASE WHEN v.field = 'ownerId' THEN 'Assignment' ELSE 'Follow-up' END, CASE v.field WHEN 'ownerId' THEN 'Follow-up owner' WHEN 'nextFollowUpAt' THEN 'Next follow-up date' ELSE 'Follow-up status' END,
  CASE WHEN v.field = 'ownerId' THEN COALESCE(f."firstName" || ' ' || f."lastName", v.before) ELSE v.before END,
  CASE WHEN v.field = 'ownerId' THEN COALESCE(n."firstName" || ' ' || n."lastName", v.after) ELSE v.after END
  FROM "PriceExceptionFollowUpEvent" h JOIN "PriceException" p ON p.id = h."priceExceptionId" JOIN "User" u ON u.id = h."actorId"
  CROSS JOIN LATERAL (VALUES ('status', h."previousValues"->>'status', h."newValues"->>'status'), ('ownerId', h."previousValues"->>'ownerId', h."newValues"->>'ownerId'), ('nextFollowUpAt', h."previousValues"->>'nextFollowUpAt', h."newValues"->>'nextFollowUpAt')) v(field, before, after)
  LEFT JOIN "User" f ON v.field = 'ownerId' AND f.id::text = v.before LEFT JOIN "User" n ON v.field = 'ownerId' AND n.id::text = v.after
  WHERE v.before IS DISTINCT FROM v.after
UNION ALL SELECT 'account-archive-' || a.id, a."archivedAt", a."archivedById", ${person}, 'Account', a.id, a.name, 'Archive', 'Current archive metadata', NULL, NULL FROM "Account" a LEFT JOIN "User" u ON u.id = a."archivedById" WHERE a."archivedAt" IS NOT NULL
UNION ALL SELECT 'contact-archive-' || a.id, a."archivedAt", a."archivedById", ${person}, 'Contact', a.id, a."firstName" || ' ' || a."lastName", 'Archive', 'Current archive metadata', NULL, NULL FROM "Contact" a LEFT JOIN "User" u ON u.id = a."archivedById" WHERE a."archivedAt" IS NOT NULL
UNION ALL SELECT 'activity-archive-' || a.id, a."archivedAt", a."archivedById", ${person}, 'Activity', a.id, a.subject, 'Archive', 'Current archive metadata', NULL, NULL FROM "Activity" a LEFT JOIN "User" u ON u.id = a."archivedById" WHERE a."archivedAt" IS NOT NULL`;

export function auditDate(raw?: string) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? date : null;
}
export function auditConditions(f: AuditFilters, maintenance = false) {
  const from = auditDate(f.from), to = auditDate(f.to);
  const clauses = [Prisma.sql`true`];
  if (from) clauses.push(Prisma.sql`at >= ${from}`);
  if (to) clauses.push(Prisma.sql`at < ${new Date(to.getTime() + 86400000)}`);
  if (/^[1-9]\d*$/.test(f.actor ?? '') && Number.isSafeInteger(Number(f.actor))) clauses.push(Prisma.sql`"actorId" = ${Number(f.actor)}`);
  if (f.entity && (maintenance || auditEntities.includes(f.entity as typeof auditEntities[number]))) clauses.push(Prisma.sql`entity = ${f.entity.slice(0, 40)}`);
  if (f.action && (maintenance || auditActions.includes(f.action as typeof auditActions[number]))) clauses.push(Prisma.sql`action = ${f.action.slice(0, 40)}`);
  return Prisma.join(clauses, ' AND ');
}
export async function adminAudit(db: PrismaClient, actor: Actor, f: AuditFilters, maintenance = false) {
  assertAdmin(actor);
  f = normalizeAuditFilters(f);
  const source = maintenance ? Prisma.sql`SELECT 'maintenance-' || h.id AS key, h."occurredAt" AS at, h."actorId", ${person} AS actor, h."entityType" AS entity, h."recordIds"[1] AS "recordId", CASE WHEN h.action IN ('Assign owner', 'Reassign') AND h."newOwnerName" IS NOT NULL THEN CASE WHEN h.action = 'Reassign' THEN 'Reassigned ' ELSE 'Assigned ' END || h."recordCount"::text || ' ' || CASE WHEN h."entityType" = 'Opportunity' AND h."recordCount" <> 1 THEN 'Opportunities' ELSE h."entityType" || CASE WHEN h."recordCount" = 1 THEN '' ELSE 's' END END || ' to ' || h."newOwnerName" ELSE h."recordCount"::text || CASE WHEN h."recordCount" = 1 THEN ' record' ELSE ' records' END END AS name, h.action, 'Maintenance action'::text AS detail, NULL::text AS before, NULL::text AS after, h."recordCount" AS count, h."recordIds" AS ids FROM "AdminMaintenanceEvent" h LEFT JOIN "User" u ON u.id = h."actorId"` : sources;
  const conditions = auditConditions(f, maintenance);
  return db.$transaction(async tx => {
    const totals = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM (${source}) report WHERE ${conditions}`);
    const count = Number(totals[0]?.count ?? 0), pages = Math.max(1, Math.ceil(count / adminPageSize)), page = Math.min(adminPage(f.page), pages);
    const rows = await tx.$queryRaw<(AuditRow & { count?: number; ids?: number[] })[]>(Prisma.sql`SELECT * FROM (${source}) report WHERE ${conditions} ORDER BY at DESC, key DESC LIMIT ${adminPageSize} OFFSET ${(page - 1) * adminPageSize}`);
    return { rows, count, page, pages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export function auditValue(value: string | null | undefined) { return value == null || value === '' ? 'Not recorded' : value; }
export function auditHref(entity: string, id: number | null) {
  if (!id) return null;
  const path: Record<string, string> = { Opportunity: 'opportunities', 'Support Case': 'support/cases', Task: 'tasks', 'Price Exception': 'price-exceptions', Account: 'accounts', Contact: 'contacts', Activity: 'activities' };
  return path[entity] ? `/${path[entity]}/${id}${entity === 'Activity' ? '/edit' : ''}` : null;
}
