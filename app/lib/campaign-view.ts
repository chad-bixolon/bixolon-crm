import type { Prisma } from '@prisma/client';
import { can, opportunityReadWhere, type Actor } from './authorization';
import { canManageAttribution } from './marketing-attribution';
import { tradeShowLeadReadWhere } from './trade-shows';

export const campaignStatusLabels: Record<string, string> = { PLANNED: 'Planned', ACTIVE: 'Active', COMPLETED: 'Completed' };
export const campaignStatusLabel = (status: string, archivedAt?: Date | null) => archivedAt ? 'Archived' : campaignStatusLabels[status] ?? status;
export const influenceSourceLabels: Record<string, string> = { TRADE_SHOW_IMPORT: 'Trade Show import', MANUAL_MARKETING: 'Added by Marketing' };
export const influenceSourceLabel = (source: string) => influenceSourceLabels[source] ?? 'Other source';
export const canReadCampaigns = (actor: Actor) => can(actor, 'marketing.read') || can(actor, 'trade-shows.read');

export function campaignInfluenceReadWhere(actor: Actor, campaignId: number): Prisma.CampaignInfluenceWhereInput {
  if (canManageAttribution(actor)) return { campaignId };
  const visible: Prisma.CampaignInfluenceWhereInput[] = [];
  if (can(actor, 'trade-shows.read')) visible.push({ tradeShowLead: { is: tradeShowLeadReadWhere(actor) } });
  if (can(actor, 'contacts.read')) visible.push({ contactId: { not: null } });
  if (can(actor, 'opportunities.read')) visible.push({ opportunity: { is: opportunityReadWhere(actor) } });
  return { campaignId, OR: visible.length ? visible : [{ id: -1 }] };
}

export function campaignContactWhere(actor: Actor, campaignId: number, tradeShowsEnabled = true, opportunitiesEnabled = true): Prisma.ContactWhereInput {
  if (!can(actor, 'contacts.read')) return { id: -1 };
  return { OR: [
    { campaignInfluences: { some: { campaignId, voidedAt: null, ...(tradeShowsEnabled ? {} : { tradeShowLeadId: null }), ...(opportunitiesEnabled ? {} : { opportunityId: null }) } } },
    ...(tradeShowsEnabled ? [{ tradeShowLeads: { some: { campaignInfluences: { some: { campaignId, voidedAt: null } }, ...(actor.role === 'SALES' ? tradeShowLeadReadWhere(actor) : {}) } } }] : []),
  ] };
}

export function campaignOpportunityWhere(actor: Actor, campaignId: number, tradeShowsEnabled = true): Prisma.OpportunityWhereInput {
  if (!can(actor, 'opportunities.read') && !canManageAttribution(actor)) return { id: -1 };
  const contactInfluence: Prisma.ContactWhereInput = campaignContactWhere(actor, campaignId, tradeShowsEnabled);
  return { AND: [opportunityReadWhere(actor), { OR: [
    { campaignInfluences: { some: { campaignId, voidedAt: null, ...(tradeShowsEnabled ? {} : { tradeShowLeadId: null }) } } },
    ...(tradeShowsEnabled ? [{ originatingTradeShowLead: { is: { campaignInfluences: { some: { campaignId, voidedAt: null } }, ...(actor.role === 'SALES' ? tradeShowLeadReadWhere(actor) : {}) } } }] : []),
    { contacts: { some: { contact: { is: contactInfluence } } } },
  ] }] };
}
