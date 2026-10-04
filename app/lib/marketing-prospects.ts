import { Prisma, type PrismaClient } from '@prisma/client';
import { canViewMarketingReports } from './marketing-attribution-report';
import type { Actor } from './authorization';

export type ProspectFilters = { from?: string; to?: string; leadSourceId?: string; campaignId?: string; state?: string; opportunity?: string; ownerId?: string; q?: string; page?: string };
const id = (value?: string) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const date = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? new Date(`${value}T00:00:00Z`) : null;
export function parseProspectFilters(input: ProspectFilters) {
  const to = date(input.to);
  return { from: date(input.from), to: to ? new Date(to.getTime() + 86400000) : null,
    leadSourceId: id(input.leadSourceId), noSource: input.leadSourceId === 'none', campaignId: id(input.campaignId),
    state: ['CONTACT', 'UNRESOLVED_LEAD'].includes(input.state ?? '') ? input.state : null,
    opportunity: ['YES', 'NO'].includes(input.opportunity ?? '') ? input.opportunity : null,
    ownerId: id(input.ownerId), q: (input.q ?? '').trim().slice(0, 100), page: Math.min(id(input.page) ?? 1, 10000) };
}

// One row per Contact plus one row per unresolved Trade Show Lead. All fan-out
// relationships are aggregated or tested with EXISTS before the report groups rows.
export const canonicalProspects = Prisma.sql`
WITH linked_leads AS (
  SELECT l."contactId", COUNT(*)::integer AS lead_count,
    BOOL_OR(l."leadSourceId" IS DISTINCT FROM c."leadSourceId") AS source_conflict,
    MIN(COALESCE(l."capturedAt", l."importedAt")) FILTER (WHERE l."leadSourceId" = c."leadSourceId") AS matching_capture_date,
    MIN(l."assignedSalesRepUserId") AS owner_id,
    COUNT(DISTINCT l."assignedSalesRepUserId") AS owner_count
  FROM "TradeShowLead" l JOIN "Contact" c ON c.id=l."contactId"
  GROUP BY l."contactId"
), opportunity_edges AS (
  SELECT oc."contactId" AS contact_id, NULL::integer AS lead_id, o.id AS opportunity_id
  FROM "OpportunityContact" oc JOIN "Opportunity" o ON o.id=oc."opportunityId" AND o."archivedAt" IS NULL
  UNION ALL
  SELECT l."contactId", CASE WHEN l."contactId" IS NULL THEN l.id ELSE NULL END, o.id
  FROM "TradeShowLead" l JOIN "Opportunity" o ON o.id=l."convertedOpportunityId" AND o."archivedAt" IS NULL
), contact_opportunities AS (
  SELECT contact_id, COUNT(DISTINCT opportunity_id)::integer AS opportunity_count
  FROM opportunity_edges WHERE contact_id IS NOT NULL GROUP BY contact_id
), lead_opportunities AS (
  SELECT lead_id, COUNT(DISTINCT opportunity_id)::integer AS opportunity_count
  FROM opportunity_edges WHERE lead_id IS NOT NULL GROUP BY lead_id
), prospects AS (
  SELECT 'CONTACT'::text AS canonical_type, c.id AS canonical_id, c."firstName" || ' ' || c."lastName" AS display_name,
    a.name AS company, c."leadSourceId" AS lead_source_id,
    COALESCE(ll.matching_capture_date, c."createdAt") AS report_date,
    CASE WHEN ll.matching_capture_date IS NOT NULL THEN 'Linked lead capture' ELSE 'Contact created' END AS date_basis,
    COALESCE(ll.source_conflict, false) AS source_conflict, COALESCE(ll.lead_count, 0) AS linked_leads,
    COALESCE(co.opportunity_count, 0) AS opportunity_count,
    CASE WHEN ll.owner_count=1 THEN ll.owner_id ELSE NULL END AS owner_id
  FROM "Contact" c LEFT JOIN "Account" a ON a.id=c."accountId"
  LEFT JOIN linked_leads ll ON ll."contactId"=c.id
  LEFT JOIN contact_opportunities co ON co.contact_id=c.id
  WHERE c."archivedAt" IS NULL
  UNION ALL
  SELECT 'UNRESOLVED_LEAD', l.id, l."firstName" || ' ' || l."lastName",
    COALESCE(a.name, l."sourceCompany"), l."leadSourceId", COALESCE(l."capturedAt", l."importedAt"),
    CASE WHEN l."capturedAt" IS NOT NULL THEN 'Lead capture' ELSE 'Lead import' END,
    false, 0, COALESCE(lo.opportunity_count, 0), l."assignedSalesRepUserId"
  FROM "TradeShowLead" l LEFT JOIN "Account" a ON a.id=l."accountId"
  LEFT JOIN lead_opportunities lo ON lo.lead_id=l.id
  WHERE l."contactId" IS NULL
)
`;

export async function leadSourcesReport(client: PrismaClient, actor: Actor, input: ProspectFilters) {
  if (!canViewMarketingReports(actor)) throw new Error('Access denied');
  const f = parseProspectFilters(input);
  const conditions: Prisma.Sql[] = [];
  if (f.from) conditions.push(Prisma.sql`p.report_date >= ${f.from}`);
  if (f.to) conditions.push(Prisma.sql`p.report_date < ${f.to}`);
  if (f.leadSourceId) conditions.push(Prisma.sql`p.lead_source_id = ${f.leadSourceId}`);
  if (f.noSource) conditions.push(Prisma.sql`p.lead_source_id IS NULL`);
  if (f.state) conditions.push(Prisma.sql`p.canonical_type = ${f.state}`);
  if (f.opportunity) conditions.push(f.opportunity === 'YES' ? Prisma.sql`p.opportunity_count > 0` : Prisma.sql`p.opportunity_count = 0`);
  if (f.ownerId) conditions.push(Prisma.sql`p.owner_id = ${f.ownerId}`);
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(Prisma.sql`(p.display_name ILIKE ${term} OR p.company ILIKE ${term})`);
  }
  if (f.campaignId) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "CampaignInfluence" i WHERE i."campaignId"=${f.campaignId} AND i."voidedAt" IS NULL
      AND (i."contactId"=CASE WHEN p.canonical_type='CONTACT' THEN p.canonical_id END
        OR EXISTS (SELECT 1 FROM "TradeShowLead" cl WHERE cl.id=i."tradeShowLeadId"
          AND ((p.canonical_type='CONTACT' AND cl."contactId"=p.canonical_id)
            OR (p.canonical_type='UNRESOLVED_LEAD' AND cl.id=p.canonical_id))))
  )`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  type SummaryRow = { lead_source_id: number | null; lead_source: string | null; unique_prospects: bigint; resolved_contacts: bigint; contact_only: bigint; unresolved_leads: bigint; with_opportunities: bigint; source_conflicts: bigint };
  type DetailRow = { canonical_type: string; canonical_id: number; display_name: string; company: string | null; lead_source_id: number | null; lead_source: string | null; report_date: Date; date_basis: string; source_conflict: boolean; linked_leads: number; opportunity_count: number; owner_name: string | null; trade_show_id: number | null; campaign_names: string | null };
  const [groups, detail] = await Promise.all([
    client.$queryRaw<SummaryRow[]>(Prisma.sql`${canonicalProspects}
      SELECT p.lead_source_id, s.name AS lead_source, COUNT(*)::bigint AS unique_prospects,
        COUNT(*) FILTER (WHERE p.canonical_type='CONTACT' AND p.linked_leads>0)::bigint AS resolved_contacts,
        COUNT(*) FILTER (WHERE p.canonical_type='CONTACT' AND p.linked_leads=0)::bigint AS contact_only,
        COUNT(*) FILTER (WHERE p.canonical_type='UNRESOLVED_LEAD')::bigint AS unresolved_leads,
        COUNT(*) FILTER (WHERE p.opportunity_count>0)::bigint AS with_opportunities,
        COUNT(*) FILTER (WHERE p.source_conflict)::bigint AS source_conflicts
      FROM prospects p LEFT JOIN "LeadSourceOption" s ON s.id=p.lead_source_id ${where}
      GROUP BY p.lead_source_id, s.name ORDER BY COUNT(*) DESC, s.name NULLS LAST`),
    client.$queryRaw<DetailRow[]>(Prisma.sql`${canonicalProspects}
      SELECT page.*, s.name AS lead_source, u."firstName" || ' ' || u."lastName" AS owner_name,
        l."tradeShowId" AS trade_show_id, campaigns.names AS campaign_names
      FROM (SELECT p.* FROM prospects p ${where} ORDER BY p.report_date DESC, p.canonical_type, p.canonical_id DESC
        LIMIT 26 OFFSET ${(f.page - 1) * 25}) page
      LEFT JOIN "LeadSourceOption" s ON s.id=page.lead_source_id
      LEFT JOIN "User" u ON u.id=page.owner_id
      LEFT JOIN "TradeShowLead" l ON l.id=page.canonical_id AND page.canonical_type='UNRESOLVED_LEAD'
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name) AS names
        FROM "CampaignInfluence" i JOIN "MarketingCampaign" c ON c.id=i."campaignId"
        LEFT JOIN "TradeShowLead" cl ON cl.id=i."tradeShowLeadId"
        WHERE i."voidedAt" IS NULL AND (i."contactId"=CASE WHEN page.canonical_type='CONTACT' THEN page.canonical_id END
          OR (page.canonical_type='CONTACT' AND cl."contactId"=page.canonical_id)
          OR (page.canonical_type='UNRESOLVED_LEAD' AND cl.id=page.canonical_id))
      ) campaigns ON true
      ORDER BY page.report_date DESC, page.canonical_type, page.canonical_id DESC`),
  ]);
  const summary = groups.reduce((total, row) => ({ uniqueProspects: total.uniqueProspects + Number(row.unique_prospects), resolvedContacts: total.resolvedContacts + Number(row.resolved_contacts), contactOnly: total.contactOnly + Number(row.contact_only), unresolvedLeads: total.unresolvedLeads + Number(row.unresolved_leads), withOpportunities: total.withOpportunities + Number(row.with_opportunities), sourceConflicts: total.sourceConflicts + Number(row.source_conflicts) }), { uniqueProspects: 0, resolvedContacts: 0, contactOnly: 0, unresolvedLeads: 0, withOpportunities: 0, sourceConflicts: 0 });
  return { filters: f, summary, groups: groups.map(row => ({ leadSourceId: row.lead_source_id, leadSource: row.lead_source ?? 'Unspecified', uniqueProspects: Number(row.unique_prospects), resolvedContacts: Number(row.resolved_contacts), contactOnly: Number(row.contact_only), unresolvedLeads: Number(row.unresolved_leads), withOpportunities: Number(row.with_opportunities), sourceConflicts: Number(row.source_conflicts) })), rows: detail.slice(0, 25), hasNext: detail.length > 25 };
}
