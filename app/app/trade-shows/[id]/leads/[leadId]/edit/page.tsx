import { NAV_CATEGORIES } from '../../../../../../lib/navigation-categories';
import { notFound, redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { TradeShowLeadForm } from '@/components/trade-show-lead-form';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canEditTradeShowLead, tradeShowLeadReadWhere } from '@/lib/trade-shows';
import { canRouteTradeShowLead } from '@/lib/trade-show-routing';

export const dynamic = 'force-dynamic';
export default async function EditTradeShowLeadPage({ params }: { params: Promise<{ id: string; leadId: string }> }) {
  const actor = await currentUser();
  const { id: rawShowId, leadId: rawLeadId } = await params;
  const tradeShowId = Number(rawShowId), leadId = Number(rawLeadId);
  if (!Number.isSafeInteger(tradeShowId) || tradeShowId < 1 || !Number.isSafeInteger(leadId) || leadId < 1) notFound();
  const lead = await prisma.tradeShowLead.findFirst({ where: { AND: [{ id: leadId, tradeShowId }, tradeShowLeadReadWhere(actor)] }, include: { assignedSalesRep: { select: { firstName: true, lastName: true } }, contact: { select: { firstName: true, lastName: true, active: true, archivedAt: true } }, tradeShow: { select: { archivedAt: true } } } });
  if (!lead) notFound();
  if (!canEditTradeShowLead(actor, lead)) redirect('/access-denied');
  const canAssign = can(actor, 'trade-shows.assign') && !lead.convertedOpportunityId, canResolve = can(actor, 'trade-shows.resolve') && !lead.convertedOpportunityId, canRoute = canRouteTradeShowLead(actor,lead);
  const [reps, accounts, contacts, competitors, partnerAccounts] = await Promise.all([
    canAssign ? prisma.user.findMany({ where: { active: true, archivedAt: null, role: { in: ['SALES', 'SALES_MANAGER'] } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }) : Promise.resolve([]),
    canResolve && lead.accountId ? prisma.account.findMany({ where: { id: lead.accountId }, select: { id: true, name: true } }) : Promise.resolve([]),
    canResolve && lead.contactId ? prisma.contact.findMany({ where: { id: lead.contactId }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true, account: { select: { name: true } } } }) : Promise.resolve([]),
    prisma.competitorOption.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    canRoute && lead.routedPartnerAccountId ? prisma.account.findMany({ where: { id: lead.routedPartnerAccountId }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title={`Edit ${lead.firstName} ${lead.lastName}`}/>{lead.tradeShow.archivedAt ? <div className="panel p-6">Reactivate this Trade Show before editing its leads.</div> : <TradeShowLeadForm tradeShowId={tradeShowId} leadId={leadId} initial={lead} canAssign={canAssign} canResolve={canResolve} canRoute={canRoute} reps={reps.map(rep => ({ id: rep.id, name: `${rep.firstName} ${rep.lastName}` }))} currentRep={lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : null} partnerAccounts={partnerAccounts} accounts={accounts} contacts={contacts.map(contact => ({ id: contact.id, name: `${contact.firstName} ${contact.lastName}`, accountId: contact.accountId, context: [contact.account?.name, contact.email].filter(Boolean).join(' · ') }))} competitors={competitors}/>}</Content>;
}
