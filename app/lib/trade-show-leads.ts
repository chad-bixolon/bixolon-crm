import { canViewSalesLeadQueue } from './trade-show-lead-policy';
export { canViewSalesLeadQueue } from './trade-show-lead-policy';
import { partnerAssignmentData, auditPartnerAssignment } from './trade-show-partner-state';
import { assertEditToken, nextUpdatedAt, requireEditToken } from './stale-edit';
import { TradeShowLeadRouting, TradeShowLeadStatus, Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { field, optional, positiveId, type Errors } from './crm-validation';
import { dateField } from './work';
import { canEditTradeShowLead } from './trade-shows';
import { assertPartnerOwnerChange, validatePartnerFollowUpOwner, canRouteTradeShowLead, referralData, TRADE_SHOW_ROUTINGS, validateTradeShowRouting } from './trade-show-routing';
import { syncTradeShowFollowUp } from './trade-show-follow-up';
import { tradeShowFollowUpBusinessDays } from './configuration';
import { linkLeadAttributionToContact } from './marketing-attribution';
import { eligibleUserWhere } from './assignment-eligibility';

const statuses = Object.values(TradeShowLeadStatus);
export const actionableTradeShowLeadStatuses: TradeShowLeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED'];
export type SalesLeadQueueFilters = { view?: string; status?: string; tradeShowId?: string };
export function salesLeadQueueWhere(actor: Actor, filters: SalesLeadQueueFilters = {}): Prisma.TradeShowLeadWhereInput {
  if (!canViewSalesLeadQueue(actor)) return { id: -1 };
  const allAssigned = filters.view === 'all' && actor.role !== 'SALES';
  const selectedStatus = statuses.includes(filters.status as TradeShowLeadStatus) ? filters.status as TradeShowLeadStatus : null;
  const tradeShowId = positiveId(filters.tradeShowId ?? '');
  return {
    routing: 'BIXOLON_SALES',
    assignedSalesRepUserId: allAssigned ? { not: null } : actor.id,
    status: selectedStatus ?? { in: actionableTradeShowLeadStatuses },
    tradeShow: { archivedAt: null },
    ...(tradeShowId ? { tradeShowId } : {}),
  };
}
export function parseTradeShowLeadUpdate(form: FormData) {
  const errors: Errors = {};
  const statusRaw = field(form, 'status');
  const status = statuses.includes(statusRaw as TradeShowLeadStatus) ? statusRaw as TradeShowLeadStatus : null;
  if (!status) errors.status = 'Choose a valid lead status.';
  const followUpAt = dateField(field(form, 'followUpAt'), 'followUpAt', errors);
  const lastContactedAt = dateField(field(form, 'lastContactedAt'), 'lastContactedAt', errors);
  const salesNotes = optional(form, 'salesNotes', 20000, errors);
  const productInterest = optional(form, 'productInterest', 5000, errors);
  const competitorSourceText = optional(form, 'competitorSourceText', 500, errors);
  const currentProductBeingUsed = optional(form, 'currentProductBeingUsed', 500, errors);
  const customerPainPoints = optional(form, 'customerPainPoints', 20000, errors);
  const reference = (key: string) => {
    const raw = field(form, key), id = raw ? positiveId(raw) : null;
    if (raw && !id) errors[key] = 'Choose a valid record.';
    if (!id && field(form, `${key}Query`)) errors[key] = 'Select a result from the suggestions.';
    return id;
  };
  const partnerFollowUpOwnerId = reference('partnerFollowUpOwnerId');
  const assignedSalesRepUserId = reference('assignedSalesRepUserId');
  const routingRaw = field(form,'routing');
  const routing = TRADE_SHOW_ROUTINGS.includes(routingRaw as TradeShowLeadRouting) ? routingRaw as TradeShowLeadRouting : null;
  if (form.has('routing') && !routing) errors.routing = 'Choose a valid lead routing.';
  const routedPartnerAccountId = reference('routedPartnerAccountId');
  const referralNotes = optional(form,'referralNotes',20000,errors);
  const partnerHandoffNotes = optional(form,'partnerHandoffNotes',20000,errors);
  const accountId = reference('accountId');
  const contactId = reference('contactId');
  const competitorId = reference('competitorId');
  return { errors, value: Object.keys(errors).length ? undefined : {
    status: status!, followUpAt, lastContactedAt, salesNotes, productInterest,
    competitorSourceText, competitorId, currentProductBeingUsed, customerPainPoints,
    assignedSalesRepUserId, routing, routedPartnerAccountId, partnerFollowUpOwnerId, referralNotes, partnerHandoffNotes, accountId, contactId,
  } };
}

export function tradeShowLeadFailureState(form: FormData, errors: Errors, message = 'Correct the highlighted fields.') {
  return { errors, message, values: Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) };
}

export async function saveTradeShowLeadUpdate(client: PrismaClient, tradeShowId: number, leadId: number, form: FormData, actor: Actor) {
  const editToken = requireEditToken(form);
  const parsed = parseTradeShowLeadUpdate(form);
  if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  const input = parsed.value;
  const businessDays = await tradeShowFollowUpBusinessDays(client);
  return client.$transaction(async tx => {
    const lead = await tx.tradeShowLead.findFirst({ where: { id: leadId, tradeShowId }, include: { tradeShow: { select: { archivedAt: true } } } });
    if (!lead || lead.tradeShow.archivedAt) throw new Error('Trade Show Lead not found or archived.');
    if (!can(actor, 'trade-shows.leads.write')) throw new Error('Access denied');
    assertEditToken(lead.updatedAt, editToken);
    if (!canEditTradeShowLead(actor, lead)) throw new Error('Access denied');
    if (input.status === 'CONVERTED' && !lead.convertedOpportunityId) throw new Error('Only Opportunity conversion can set Converted status.');
    if (lead.convertedOpportunityId && input.status !== 'CONVERTED') throw new Error('Converted lead status cannot be changed here.');
    if (!can(actor, 'trade-shows.assign') && form.has('assignedSalesRepUserId')) throw new Error('Access denied to rep assignment.');
    const repId = can(actor, 'trade-shows.assign') ? input.assignedSalesRepUserId : lead.assignedSalesRepUserId;
    if (lead.convertedOpportunityId && repId !== lead.assignedSalesRepUserId) throw new Error('Converted lead ownership cannot be changed.');
    if (repId) {
      const rep = await tx.user.findFirst({ where: { id: repId, ...eligibleUserWhere('trade-show-sales') } });
      if (!rep && repId !== lead.assignedSalesRepUserId) throw new Error('Choose an active Sales rep.');
    }
    const routing = form.has('routing') ? input.routing! : lead.routing;
    if (form.has('routing') && !canRouteTradeShowLead(actor,lead)) throw new Error('Access denied to lead routing.');
    const requestedPartnerAccountId = form.has('routedPartnerAccountId') ? input.routedPartnerAccountId : lead.routedPartnerAccountId;
    const partnerAccountId = routing==='REFERRED_TO_PARTNER' ? requestedPartnerAccountId : lead.routedPartnerAccountId;
    const routingSubmitted = ['routing', 'routedPartnerAccountId', 'partnerFollowUpOwnerId'].some(key => form.has(key));
    if (routingSubmitted && !canRouteTradeShowLead(actor, lead)) throw new Error('Access denied to lead routing.');
    const samePartner = lead.routing === routing && lead.routedPartnerAccountId === partnerAccountId;
    const ownerId = routing === 'REFERRED_TO_PARTNER' ? (form.has('partnerFollowUpOwnerId') ? input.partnerFollowUpOwnerId : samePartner ? lead.partnerFollowUpOwnerId : null) : null;
    assertPartnerOwnerChange(lead, routing, partnerAccountId, ownerId ?? null);
    if (routing === 'REFERRED_TO_PARTNER' && (routingSubmitted || !samePartner) && !(samePartner && lead.partnerHandoffStatus === 'SENT_TO_PARTNER')) {
      // Legacy unchanged assignments may remain ownerless until explicitly reviewed.
      if (ownerId || !samePartner || form.has('partnerFollowUpOwnerId')) {
        const userIds = [...new Set([actor.id, ...(ownerId ? [ownerId] : [])])].sort((a,b) => a-b);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR SHARE`);
        const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
        if (!currentActor || !canEditTradeShowLead(currentActor, lead) || !canRouteTradeShowLead(currentActor, lead)) throw new Error('Access denied to lead routing.');
        await validatePartnerFollowUpOwner(tx, ownerId);
      }
    }
    const notes = routing==='REFERRED_TO_PARTNER'&&form.has('referralNotes') ? input.referralNotes : lead.referralNotes;
    if (form.has('routing') || form.has('routedPartnerAccountId')) await validateTradeShowRouting(tx,routing,repId,partnerAccountId,repId===lead.assignedSalesRepUserId&&(routing===lead.routing||routing!=='BIXOLON_SALES')?repId:null);
    if (!can(actor, 'trade-shows.resolve') && (form.has('accountId') || form.has('contactId'))) throw new Error('Access denied to CRM resolution.');
    const accountId = can(actor, 'trade-shows.resolve') ? input.accountId : lead.accountId;
    const contactId = can(actor, 'trade-shows.resolve') ? input.contactId : lead.contactId;
    if (lead.convertedOpportunityId && (accountId !== lead.accountId || contactId !== lead.contactId)) throw new Error('Converted lead CRM links cannot be changed.');
    if (accountId) {
      const account = await tx.account.findFirst({ where: { id: accountId, status: 'ACTIVE', archivedAt: null } });
      if (!account && accountId !== lead.accountId) throw new Error('Choose an active Account.');
    }
    if (contactId) {
      const contact = await tx.contact.findFirst({ where: { id: contactId, active: true, archivedAt: null } });
      if (!contact && contactId !== lead.contactId) throw new Error('Choose an active Contact.');
      if (contact && accountId && contact.accountId && contact.accountId !== accountId) throw new Error('Contact belongs to a different Account.');
    }
    if (input.competitorId) {
      const competitor = await tx.competitorOption.findFirst({ where: { id: input.competitorId, active: true } });
      if (!competitor && input.competitorId !== lead.competitorId) throw new Error('Choose an active Competitor.');
    }
    const updated = await tx.tradeShowLead.update({ where: { id: leadId, tradeShowId, updatedAt: new Date(editToken) }, data: {
      updatedAt: nextUpdatedAt(lead.updatedAt),
      status: input.status, followUpAt: input.followUpAt, lastContactedAt: input.lastContactedAt,
      salesNotes: input.salesNotes, productInterest: input.productInterest,
      competitorSourceText: input.competitorSourceText, competitorId: input.competitorId,
      currentProductBeingUsed: input.currentProductBeingUsed, customerPainPoints: input.customerPainPoints,
      assignedSalesRepUserId: repId, routing, routedPartnerAccountId:partnerAccountId,
      partnerFollowUpOwnerId: ownerId ?? null,
      ...partnerAssignmentData(lead, { ...lead, routing, routedPartnerAccountId: partnerAccountId, status: input.status }),
      ...(form.has('partnerHandoffNotes') ? { partnerHandoffNotes: input.partnerHandoffNotes } : {}),
      ...referralData(routing,lead.routing,actor.id,notes,lead.referredAt), accountId, contactId,
    } });
    await auditPartnerAssignment(tx, lead, updated, actor.id);
    if (contactId && contactId !== lead.contactId) await linkLeadAttributionToContact(tx, leadId, contactId, actor.id);
    await syncTradeShowFollowUp(tx, lead, updated, actor.id, new Date(), businessDays);
    return { errors: {} };
  });
}
