import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';

export function canViewMarketingReports(actor: Actor) {
  return can(actor, 'marketing.read') && can(actor, 'contacts.read') && can(actor, 'opportunities.read');
}

export type AttributionFilters = { from?: string; to?: string; leadSourceId?: string; campaignId?: string; campaignStatus?: string; recordType?: string; ownerId?: string; q?: string; page?: string };
const date = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? new Date(`${value}T00:00:00Z`) : null;
const id = (value?: string) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function parseAttributionFilters(input: AttributionFilters) {
  const from = date(input.from), toDate = date(input.to);
  const to = toDate ? new Date(toDate.getTime() + 86400000) : null;
  const recordType = ['CONTACT', 'OPPORTUNITY', 'TRADE_SHOW_LEAD'].includes(input.recordType ?? '') ? input.recordType : null;
  const campaignStatus = ['PLANNED', 'ACTIVE', 'COMPLETED'].includes(input.campaignStatus ?? '') ? input.campaignStatus : null;
  return { from, to, leadSourceId: id(input.leadSourceId), campaignId: id(input.campaignId), campaignStatus, recordType, ownerId: id(input.ownerId), q: (input.q ?? '').trim().slice(0, 100), page: Math.min(id(input.page) ?? 1, 10000) };
}

export async function marketingAttributionReport(client: PrismaClient, actor: Actor, input: AttributionFilters) {
  if (!canViewMarketingReports(actor)) throw new Error('Access denied');
  const f = parseAttributionFilters(input);
  const clauses: Prisma.CampaignInfluenceWhereInput[] = [];
  const sql: Prisma.Sql[] = [];
  if (f.from) { clauses.push({ occurredAt: { gte: f.from } }); sql.push(Prisma.sql`i."occurredAt" >= ${f.from}`); }
  if (f.to) { clauses.push({ occurredAt: { lt: f.to } }); sql.push(Prisma.sql`i."occurredAt" < ${f.to}`); }
  if (f.campaignId) { clauses.push({ campaignId: f.campaignId }); sql.push(Prisma.sql`i."campaignId" = ${f.campaignId}`); }
  if (f.campaignStatus) { clauses.push({ campaign: { status: f.campaignStatus } }); sql.push(Prisma.sql`c.status = ${f.campaignStatus}`); }
  if (f.leadSourceId) {
    clauses.push({ OR: [{ tradeShowLead: { leadSourceId: f.leadSourceId } }, { contact: { leadSourceId: f.leadSourceId } }, { opportunity: { originatingTradeShowLead: { leadSourceId: f.leadSourceId } } }] });
    sql.push(Prisma.sql`(l."leadSourceId" = ${f.leadSourceId} OR t."leadSourceId" = ${f.leadSourceId} OR ol."leadSourceId" = ${f.leadSourceId})`);
  }
  if (f.recordType) {
    const field = f.recordType === 'CONTACT' ? 'contactId' : f.recordType === 'OPPORTUNITY' ? 'opportunityId' : 'tradeShowLeadId';
    clauses.push({ [field]: { not: null } });
    sql.push(f.recordType === 'CONTACT' ? Prisma.sql`i."contactId" IS NOT NULL` : f.recordType === 'OPPORTUNITY' ? Prisma.sql`i."opportunityId" IS NOT NULL` : Prisma.sql`i."tradeShowLeadId" IS NOT NULL`);
  }
  if (f.ownerId) {
    clauses.push({ OR: [{ opportunity: { ownerId: f.ownerId } }, { tradeShowLead: { assignedSalesRepUserId: f.ownerId } }] });
    sql.push(Prisma.sql`(o."ownerId" = ${f.ownerId} OR l."assignedSalesRepUserId" = ${f.ownerId})`);
  }
  if (f.q) {
    clauses.push({ OR: [{ campaign: { name: { contains: f.q, mode: 'insensitive' } } }, { contact: { firstName: { contains: f.q, mode: 'insensitive' } } }, { contact: { lastName: { contains: f.q, mode: 'insensitive' } } }, { opportunity: { name: { contains: f.q, mode: 'insensitive' } } }, { tradeShowLead: { firstName: { contains: f.q, mode: 'insensitive' } } }, { tradeShowLead: { lastName: { contains: f.q, mode: 'insensitive' } } }] });
    const term = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
    sql.push(Prisma.sql`(c.name ILIKE ${term} OR t."firstName" ILIKE ${term} OR t."lastName" ILIKE ${term} OR o.name ILIKE ${term} OR l."firstName" ILIKE ${term} OR l."lastName" ILIKE ${term})`);
  }
  const where: Prisma.CampaignInfluenceWhereInput = { AND: clauses };
  const predicate = sql.length ? Prisma.sql`WHERE ${Prisma.join(sql, ' AND ')}` : Prisma.empty;
  const [activeCampaigns, summaryRows, rows] = await Promise.all([
    client.marketingCampaign.count({ where: { archivedAt: null, status: 'ACTIVE' } }),
    client.$queryRaw<{ influences: bigint; contacts: bigint; opportunities: bigint; leads: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE i."voidedAt" IS NULL)::bigint AS influences,
        COUNT(DISTINCT COALESCE(i."contactId", l."contactId")) FILTER (WHERE i."voidedAt" IS NULL)::bigint AS contacts,
        COUNT(DISTINCT COALESCE(i."opportunityId", l."convertedOpportunityId")) FILTER (WHERE i."voidedAt" IS NULL)::bigint AS opportunities,
        COUNT(DISTINCT i."tradeShowLeadId") FILTER (WHERE i."voidedAt" IS NULL)::bigint AS leads
      FROM "CampaignInfluence" i JOIN "MarketingCampaign" c ON c.id=i."campaignId"
      LEFT JOIN "TradeShowLead" l ON l.id=i."tradeShowLeadId"
      LEFT JOIN "Contact" t ON t.id=i."contactId"
      LEFT JOIN "Opportunity" o ON o.id=i."opportunityId"
      LEFT JOIN "TradeShowLead" ol ON ol."convertedOpportunityId"=o.id ${predicate}`),
    client.campaignInfluence.findMany({ where, select: {
      id: true, occurredAt: true, sourceContext: true, voidedAt: true,
      campaign: { select: { id: true, name: true, status: true, archivedAt: true } },
      tradeShowLead: { select: { id: true, tradeShowId: true, firstName: true, lastName: true, leadSource: { select: { name: true } }, account: { select: { name: true } }, assignedSalesRep: { select: { firstName: true, lastName: true } } } },
      contact: { select: { id: true, firstName: true, lastName: true, leadSource: { select: { name: true } }, account: { select: { name: true } } } },
      opportunity: { select: { id: true, name: true, stage: { select: { name: true } }, forecastCategory: true, owner: { select: { firstName: true, lastName: true } }, originatingTradeShowLead: { select: { leadSource: { select: { name: true } } } }, participants: { select: { account: { select: { name: true } } }, take: 2 } } },
    }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (f.page - 1) * 25, take: 26 }),
  ]);
  const summary = summaryRows[0];
  return { filters: f, activeCampaigns, summary: { influences: Number(summary?.influences ?? 0), contacts: Number(summary?.contacts ?? 0), opportunities: Number(summary?.opportunities ?? 0), leads: Number(summary?.leads ?? 0) }, rows: rows.slice(0, 25), hasNext: rows.length > 25 };
}
