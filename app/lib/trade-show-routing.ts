import { signPartnerRoutingIntent, verifyPartnerRoutingIntent } from './trade-show-routing-intent';
import { partnerAssignmentData, auditPartnerAssignment } from './trade-show-partner-state';
import { eligibleUserWhere } from './assignment-eligibility';
import { recordMaintenance } from './admin-maintenance';
import { validateBulkRequest, type BulkRequest } from './bulk-action-contract';
import { assertVersions } from './bulk-actions';
import { nextUpdatedAt } from './stale-edit';
import { pageNumber } from './crm-validation';
import { tradeShowLeadReadWhere } from './trade-shows';
import { AccountBusinessRoleCode, TradeShowLeadRouting, Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { syncTradeShowFollowUp } from './trade-show-follow-up';
import { tradeShowFollowUpBusinessDays } from './configuration';

export const TRADE_SHOW_ROUTINGS = Object.values(TradeShowLeadRouting);
export const PARTNER_ACCOUNT_ROLES: AccountBusinessRoleCode[] = ['DISTRIBUTOR','VAR','ISV','OEM','PARTNER'];
export const tradeShowRoutingLabels: Record<TradeShowLeadRouting,string> = {
  UNREVIEWED: 'Unreviewed',
  BIXOLON_SALES: 'BIXOLON Sales',
  REFERRED_TO_PARTNER: 'Referred to Partner',
  MARKETING_FOLLOW_UP: 'Marketing Follow-Up',
};

export const eligiblePartnerAccountWhere = {
  status: 'ACTIVE', archivedAt: null,
  businessRoles: { some: { role: { in: PARTNER_ACCOUNT_ROLES } } },
} satisfies Prisma.AccountWhereInput;

type RoutingClient = Pick<PrismaClient,'user'|'account'>;
export async function validateTradeShowRouting(client: RoutingClient, routing: TradeShowLeadRouting, repId: number|null, partnerAccountId: number|null, unchangedHistoricalRepId: number|null = null) {
  if (routing === 'BIXOLON_SALES') {
    if (!repId) throw new Error('Select an active Sales rep for BIXOLON Sales routing.');
    const rep = repId === unchangedHistoricalRepId || await client.user.findFirst({where:{id:repId,...eligibleUserWhere('trade-show-sales')},select:{id:true}});
    if (!rep) throw new Error('Choose an active Sales rep.');
  } else if (repId) {
    const rep = repId === unchangedHistoricalRepId || await client.user.findFirst({where:{id:repId,...eligibleUserWhere('trade-show-sales')},select:{id:true}});
    if (!rep) throw new Error('Choose an active Sales rep.');
  }
  if (routing === 'REFERRED_TO_PARTNER') {
    if (!partnerAccountId) throw new Error('Select a Partner Account for partner routing.');
    const partner = await client.account.findFirst({where:{id:partnerAccountId,...eligiblePartnerAccountWhere},select:{id:true}});
    if (!partner) throw new Error('Choose an active Account with an eligible partner Business Role.');
  }
}

export async function validatePartnerFollowUpOwner(client: Pick<PrismaClient, 'user'>, ownerId: number | null) {
  if (!ownerId || !Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('Select a Follow-up Owner for partner routing.');
  const owner = await client.user.findFirst({ where: { id: ownerId, ...eligibleUserWhere('general-task') }, select: { id: true, firstName: true, lastName: true, updatedAt: true } });
  if (!owner) throw new Error('Choose an active Follow-up Owner who can receive Tasks.');
  return owner;
}

export function assertPartnerOwnerChange(lead: { routing: TradeShowLeadRouting; routedPartnerAccountId: number | null; partnerFollowUpOwnerId?: number | null; partnerHandoffStatus?: string | null }, routing: TradeShowLeadRouting, partnerId: number | null, ownerId: number | null) {
  if (routing === 'REFERRED_TO_PARTNER' && lead.routing === routing && lead.routedPartnerAccountId === partnerId && lead.partnerHandoffStatus === 'SENT_TO_PARTNER' && (lead.partnerFollowUpOwnerId ?? null) !== ownerId) throw new Error('This handoff is already complete. Its Follow-up Owner cannot be changed through routing.');
}

async function partnerRoutingIntent(tx: Prisma.TransactionClient, tradeShowId: number, request: BulkRequest, repId: number | null, partnerId: number | null, ownerId: number | null, notes: string | null) {
  await validateTradeShowRouting(tx, 'REFERRED_TO_PARTNER', repId, partnerId);
  const owner = await validatePartnerFollowUpOwner(tx, ownerId);
  const partner = await tx.account.findUniqueOrThrow({ where: { id: partnerId! }, select: { id: true, name: true, updatedAt: true } });
  const intent = { tradeShowId, records: [...request.records].sort((a,b) => a.id-b.id), routing: 'REFERRED_TO_PARTNER', repId, partner, owner, notes };
  return { intent, partner, owner };
}

export async function previewPartnerRouting(client: PrismaClient, tradeShowId: number, request: BulkRequest, repId: number | null, partnerId: number | null, ownerId: number | null, notes: string | null, actor: Actor) {
  if (!can(actor, 'trade-shows.assign') || !can(actor, 'trade-shows.route')) throw new Error('Access denied');
  const ids = validateBulkRequest({ ...request, confirmed: true });
  return client.$transaction(async tx => {
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    if (!current || !can(current, 'trade-shows.assign') || !can(current, 'trade-shows.route')) throw new Error('Access denied');
    const show = await tx.tradeShow.findUnique({ where: { id: tradeShowId }, select: { archivedAt: true } });
    if (!show || show.archivedAt) throw new Error('Trade Show not found or archived.');
    const leads = await tx.tradeShowLead.findMany({ where: { tradeShowId, id: { in: ids }, ...tradeShowLeadReadWhere(current) } });
    assertVersions(leads, request);
    for (const lead of leads) assertPartnerOwnerChange(lead, 'REFERRED_TO_PARTNER', partnerId, ownerId);
    const { intent, partner, owner } = await partnerRoutingIntent(tx, tradeShowId, request, repId, partnerId, ownerId, notes);
    return { token: signPartnerRoutingIntent(current.id, intent), partner: partner.name, owner: `${owner.firstName} ${owner.lastName}` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function canRouteTradeShowLead(actor: Actor, lead: {assignedSalesRepUserId:number|null}) {
  return can(actor,'trade-shows.route') && (actor.role !== 'SALES' || lead.assignedSalesRepUserId === actor.id);
}

export function referralData(routing: TradeShowLeadRouting, priorRouting: TradeShowLeadRouting, actorId: number, notes: string|null, priorReferredAt:Date|null=null) {
  return routing === 'REFERRED_TO_PARTNER' && !priorReferredAt
    ? {referredAt:new Date(),referredByUserId:actorId,referralNotes:notes}
    : routing === 'REFERRED_TO_PARTNER' && priorRouting === 'REFERRED_TO_PARTNER'
      ? {referralNotes:notes}
      : {};
}

export type TradeShowRoutingScope = { where: Prisma.TradeShowLeadWhereInput; page: number };
export async function bulkRouteTradeShowLeads(client: PrismaClient, tradeShowId: number, request: BulkRequest, routing: TradeShowLeadRouting, repId: number | null, partnerAccountId: number | null, notes: string | null, actor: Actor, scope: TradeShowRoutingScope, ownerId: number | null = null, intentToken = '') {
  if (!can(actor, 'trade-shows.assign') || !can(actor, 'trade-shows.route')) throw new Error('Access denied');
  const ids = validateBulkRequest(request);
  if (request.action !== 'route' || !TRADE_SHOW_ROUTINGS.includes(routing) || !scope || !Number.isSafeInteger(scope.page) || scope.page < 1) throw new Error('Refresh the page and select again.');
  for (const id of [tradeShowId, repId, partnerAccountId, ownerId]) if (id !== null && (!Number.isSafeInteger(id) || id < 1)) throw new Error('Choose a valid routing destination.');
  if (notes && notes.length > 20000) throw new Error('Referral notes must be 20,000 characters or fewer.');
  const businessDays = await tradeShowFollowUpBusinessDays(client);
  return client.$transaction(async tx => {
    // Hold effective permission, destination eligibility and event state through commit.
    const users = [...new Set([actor.id, ...(repId ? [repId] : []), ...(ownerId ? [ownerId] : [])])].sort((a, b) => a - b);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR SHARE`);
    const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
    if (!currentActor || !can(currentActor, 'trade-shows.assign') || !can(currentActor, 'trade-shows.route')) throw new Error('Access denied');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "TradeShow" WHERE id = ${tradeShowId} FOR SHARE`);
    const show = await tx.tradeShow.findUnique({ where: { id: tradeShowId }, select: { archivedAt: true } });
    if (!show || show.archivedAt) throw new Error('Trade Show not found or archived.');
    if (partnerAccountId) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Account" WHERE id = ${partnerAccountId} FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT "accountId" FROM "AccountBusinessRole" WHERE "accountId" = ${partnerAccountId} ORDER BY role FOR SHARE`);
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "TradeShowLead" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const where = { AND: [{ tradeShowId }, tradeShowLeadReadWhere(currentActor), scope.where] };
    const count = await tx.tradeShowLead.count({ where });
    const { page } = pageNumber(String(scope.page), count);
    const visible = await tx.tradeShowLead.findMany({ where, select: { id: true }, orderBy: { id: 'desc' }, skip: (page - 1) * 20, take: 20 });
    if (page !== scope.page || ids.some(id => !visible.some(row => row.id === id))) throw new Error('The current page changed. No records changed. Refresh the list and select again.');
    const leads = await tx.tradeShowLead.findMany({ where: { AND: [{ tradeShowId, id: { in: ids } }, tradeShowLeadReadWhere(currentActor)] }, orderBy: { id: 'asc' } });
    assertVersions(leads, request);
    await validateTradeShowRouting(tx, routing, repId, partnerAccountId);
    if (routing === 'REFERRED_TO_PARTNER') {
      const { intent } = await partnerRoutingIntent(tx, tradeShowId, request, repId, partnerAccountId, ownerId, notes);
      verifyPartnerRoutingIntent(intentToken, currentActor.id, intent);
      for (const lead of leads) assertPartnerOwnerChange(lead, routing, partnerAccountId, ownerId);
    }
    if (leads.some(lead => lead.convertedOpportunityId && repId !== lead.assignedSalesRepUserId)) throw new Error('Converted lead ownership cannot be changed.');
    for (const lead of leads) {
      const updated = await tx.tradeShowLead.update({ where: { id: lead.id, updatedAt: lead.updatedAt }, data: {
        updatedAt: nextUpdatedAt(lead.updatedAt), routing, assignedSalesRepUserId: repId,
        partnerFollowUpOwnerId: routing === 'REFERRED_TO_PARTNER' ? ownerId : null,
        ...partnerAssignmentData(lead, { ...lead, routing, routedPartnerAccountId: routing === 'REFERRED_TO_PARTNER' ? partnerAccountId : lead.routedPartnerAccountId }),
        ...(routing === 'REFERRED_TO_PARTNER' ? { routedPartnerAccountId: partnerAccountId } : {}),
        ...referralData(routing, lead.routing, actor.id, notes, lead.referredAt),
      } });
      await auditPartnerAssignment(tx, lead, updated, actor.id);
      await syncTradeShowFollowUp(tx, lead, updated, actor.id, new Date(), businessDays);
    }
    await recordMaintenance(tx, actor.id, 'Trade Show Lead', 'Bulk routing', ids);
    return leads.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
