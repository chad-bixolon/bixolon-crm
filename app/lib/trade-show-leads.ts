import { TradeShowLeadRouting, TradeShowLeadStatus, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { field, optional, positiveId, type Errors } from './crm-validation';
import { dateField } from './work';
import { canEditTradeShowLead } from './trade-shows';
import { canRouteTradeShowLead, referralData, TRADE_SHOW_ROUTINGS, validateTradeShowRouting } from './trade-show-routing';

const statuses = Object.values(TradeShowLeadStatus);
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
    return id;
  };
  const assignedSalesRepUserId = reference('assignedSalesRepUserId');
  const routingRaw = field(form,'routing');
  const routing = TRADE_SHOW_ROUTINGS.includes(routingRaw as TradeShowLeadRouting) ? routingRaw as TradeShowLeadRouting : null;
  if (form.has('routing') && !routing) errors.routing = 'Choose a valid lead routing.';
  const routedPartnerAccountId = reference('routedPartnerAccountId');
  const referralNotes = optional(form,'referralNotes',20000,errors);
  const accountId = reference('accountId');
  const contactId = reference('contactId');
  const competitorId = reference('competitorId');
  return { errors, value: Object.keys(errors).length ? undefined : {
    status: status!, followUpAt, lastContactedAt, salesNotes, productInterest,
    competitorSourceText, competitorId, currentProductBeingUsed, customerPainPoints,
    assignedSalesRepUserId, routing, routedPartnerAccountId, referralNotes, accountId, contactId,
  } };
}

export function tradeShowLeadFailureState(form: FormData, errors: Errors, message = 'Correct the highlighted fields.') {
  return { errors, message, values: Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) };
}

export async function saveTradeShowLeadUpdate(client: PrismaClient, tradeShowId: number, leadId: number, form: FormData, actor: Actor) {
  const parsed = parseTradeShowLeadUpdate(form);
  if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  const input = parsed.value;
  return client.$transaction(async tx => {
    const lead = await tx.tradeShowLead.findFirst({ where: { id: leadId, tradeShowId }, include: { tradeShow: { select: { archivedAt: true } } } });
    if (!lead || lead.tradeShow.archivedAt) throw new Error('Trade Show Lead not found or archived.');
    if (!canEditTradeShowLead(actor, lead)) throw new Error('Access denied');
    if (input.status === 'CONVERTED' && !lead.convertedOpportunityId) throw new Error('Only Opportunity conversion can set Converted status.');
    if (lead.convertedOpportunityId && input.status !== 'CONVERTED') throw new Error('Converted lead status cannot be changed here.');
    if (!can(actor, 'trade-shows.assign') && form.has('assignedSalesRepUserId')) throw new Error('Access denied to rep assignment.');
    const repId = can(actor, 'trade-shows.assign') ? input.assignedSalesRepUserId : lead.assignedSalesRepUserId;
    if (lead.convertedOpportunityId && repId !== lead.assignedSalesRepUserId) throw new Error('Converted lead ownership cannot be changed.');
    if (repId) {
      const rep = await tx.user.findFirst({ where: { id: repId, active: true, archivedAt: null, role: { in: ['SALES', 'SALES_MANAGER'] } } });
      if (!rep && repId !== lead.assignedSalesRepUserId) throw new Error('Choose an active Sales rep.');
    }
    const routing = form.has('routing') ? input.routing! : lead.routing;
    if (form.has('routing') && !canRouteTradeShowLead(actor,lead)) throw new Error('Access denied to lead routing.');
    const requestedPartnerAccountId = form.has('routedPartnerAccountId') ? input.routedPartnerAccountId : lead.routedPartnerAccountId;
    const partnerAccountId = routing==='REFERRED_TO_PARTNER' ? requestedPartnerAccountId : lead.routedPartnerAccountId;
    const notes = routing==='REFERRED_TO_PARTNER'&&form.has('referralNotes') ? input.referralNotes : lead.referralNotes;
    if (form.has('routing') || form.has('routedPartnerAccountId')) await validateTradeShowRouting(tx,routing,repId,partnerAccountId);
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
    await tx.tradeShowLead.update({ where: { id: leadId }, data: {
      status: input.status, followUpAt: input.followUpAt, lastContactedAt: input.lastContactedAt,
      salesNotes: input.salesNotes, productInterest: input.productInterest,
      competitorSourceText: input.competitorSourceText, competitorId: input.competitorId,
      currentProductBeingUsed: input.currentProductBeingUsed, customerPainPoints: input.customerPainPoints,
      assignedSalesRepUserId: repId, routing, routedPartnerAccountId:partnerAccountId,
      ...referralData(routing,lead.routing,actor.id,notes,lead.referredAt), accountId, contactId,
    } });
    return { errors: {} };
  });
}
