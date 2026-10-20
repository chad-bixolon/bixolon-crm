import { Prisma, type PrismaClient, type TradeShowLeadRouting } from '@prisma/client';
import { can, type Actor } from './authorization';

type LeadCounts = { total: number; assigned: number; contacted: number; qualified: number; converted: number; contactsResolved: number };
type Amount = { currency: string; opportunityCount: number; pipeline: Prisma.Decimal; weightedPipeline: Prisma.Decimal; closedWonValue: Prisma.Decimal };
// Aggregate on the server so opening one lead page never loads all event leads
// or the full attribution report into application memory.
export async function tradeShowEventSummary(db: PrismaClient, actor: Actor, id: number) {
  const scope = can(actor, 'trade-shows.read') ? actor.role === 'SALES' ? Prisma.sql`l."assignedSalesRepUserId" = ${actor.id}` : Prisma.sql`TRUE` : Prisma.sql`FALSE`;
  const [counts, routes, amounts] = await Promise.all([
    db.$queryRaw<LeadCounts[]>(Prisma.sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "assignedSalesRepUserId" IS NOT NULL)::int AS assigned,
      count(*) FILTER (WHERE status IN ('CONTACTED','QUALIFIED','CONVERTED'))::int AS contacted,
      count(*) FILTER (WHERE status IN ('QUALIFIED','CONVERTED'))::int AS qualified,
      count(*) FILTER (WHERE status = 'CONVERTED')::int AS converted,
      count(*) FILTER (WHERE "contactId" IS NOT NULL)::int AS "contactsResolved"
      FROM "TradeShowLead" l WHERE "tradeShowId" = ${id} AND ${scope}`),
    db.tradeShowLead.groupBy({ by: ['routing'], where: { tradeShowId: id, ...(actor.role === 'SALES' ? { assignedSalesRepUserId: actor.id } : {}), ...(!can(actor, 'trade-shows.read') ? { id: -1 } : {}) }, _count: true }),
    db.$queryRaw<Amount[]>(Prisma.sql`SELECT "currencyCode" AS currency, count(*)::int AS "opportunityCount",
      sum(CASE WHEN open THEN value ELSE 0 END) AS pipeline,
      sum(CASE WHEN open THEN value * probability / 100 ELSE 0 END) AS "weightedPipeline",
      sum(CASE WHEN won THEN value ELSE 0 END) AS "closedWonValue"
      FROM (SELECT o.id, o."currencyCode", COALESCE(o.probability, stage.probability) AS probability,
        (NOT stage."isClosed" AND o."forecastCategory" IN ('PIPELINE','BEST_CASE','COMMIT')) AS open,
        (stage."isClosed" AND stage."isWon") AS won, COALESCE(sum(p.quantity * p."unitPrice"), 0) AS value
        FROM "TradeShowLead" l JOIN "TradeShow" s ON s.id = l."tradeShowId"
        JOIN "Opportunity" o ON o.id = l."convertedOpportunityId" AND o."archivedAt" IS NULL
        JOIN "SalesStage" stage ON stage.id = o."stageId"
        LEFT JOIN "OpportunityProduct" p ON p."opportunityId" = o.id AND p."archivedAt" IS NULL
        WHERE l."tradeShowId" = ${id} AND s."archivedAt" IS NULL AND ${scope}
        GROUP BY o.id, stage.id) outcomes GROUP BY "currencyCode" ORDER BY "currencyCode"`),
  ]);
  const routing: Record<TradeShowLeadRouting, number> = { UNREVIEWED: 0, BIXOLON_SALES: 0, REFERRED_TO_PARTNER: 0, MARKETING_FOLLOW_UP: 0 };
  routes.forEach(row => { routing[row.routing] = row._count; });
  return { ...counts[0], routing, amounts };
}
