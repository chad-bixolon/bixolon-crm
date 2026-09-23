import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { saveOpportunity, type OpportunityInput } from './opportunities';
import { canEditTradeShowLead } from './trade-shows';

export function canConvertTradeShowLead(actor: Actor, lead: { assignedSalesRepUserId: number | null }) {
  return can(actor, 'sales.write') && canEditTradeShowLead(actor, lead);
}

export async function convertTradeShowLead(client: PrismaClient, tradeShowId: number, leadId: number, input: OpportunityInput, actor: Actor) {
  if (!can(actor, 'sales.write')) throw new Error('Access denied');
  return client.$transaction(async tx => {
    // Serialize conversion attempts for this lead. The unique attribution index is
    // the final database guard; this lock gives the losing request a clear error.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(84721, ${leadId})`;
    const lead = await tx.tradeShowLead.findFirst({ where: { id: leadId, tradeShowId }, include: { tradeShow: { select: { archivedAt: true } }, contact: { select: { accountId: true, active: true, archivedAt: true } } } });
    if (!lead || lead.tradeShow.archivedAt) throw new Error('Trade Show Lead not found or archived.');
    if (!canConvertTradeShowLead(actor, lead)) throw new Error('Access denied');
    if (lead.convertedOpportunityId) throw new Error('This Trade Show Lead has already been converted.');
    if (!lead.accountId) throw new Error('Resolve an Account before creating an Opportunity.');
    if (!input.participants.some(participant => participant.accountId === lead.accountId)) throw new Error('The resolved Account must remain a participating Account with a reviewed role.');
    if (lead.contactId) {
      if (!lead.contact || !lead.contact.active || lead.contact.archivedAt) throw new Error('Resolve an active Contact before conversion.');
      if (lead.contact.accountId && lead.contact.accountId !== lead.accountId) throw new Error('The resolved Contact belongs to a different Account.');
      if (!input.contacts.some(contact => contact.contactId === lead.contactId)) throw new Error('The resolved Contact must remain linked to the Opportunity.');
    }
    const opportunityId = await saveOpportunity(tx as unknown as PrismaClient, input, undefined, actor);
    const result = await tx.tradeShowLead.updateMany({ where: { id: leadId, convertedOpportunityId: null }, data: { convertedOpportunityId: opportunityId, status: 'CONVERTED', convertedAt: new Date() } });
    if (result.count !== 1) throw new Error('This Trade Show Lead has already been converted.');
    return opportunityId;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
