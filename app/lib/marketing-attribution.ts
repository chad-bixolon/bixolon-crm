import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';

type Tx = Prisma.TransactionClient;
export const canManageAttribution = (actor: Actor | null | undefined) => can(actor, 'marketing.write') && (actor?.role === 'ADMIN' || actor?.role === 'MARKETING_MANAGER');
export const campaignStatuses = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;

export async function ensureTradeShowCampaign(tx: Tx, showId: number, actorId: number) {
  const show = await tx.tradeShow.findUniqueOrThrow({ where: { id: showId }, select: { name: true, startDate: true, endDate: true, archivedAt: true } });
  if (show.archivedAt) throw new Error('Trade Show is archived.');
  const campaign = await tx.marketingCampaign.upsert({
    where: { tradeShowId: showId },
    create: { tradeShowId: showId, name: show.name, year: show.startDate?.getUTCFullYear() ?? null, category: 'Trade Show', status: 'ACTIVE', startDate: show.startDate, endDate: show.endDate, createdById: actorId },
    update: {},
  });
  if (campaign.archivedAt) throw new Error('Reactivate the linked Campaign before importing new Trade Show leads.');
  return campaign;
}

export async function eventsLeadSource(tx: Tx) {
  const source = await tx.leadSourceOption.findUnique({ where: { systemKey: 'TRADE_SHOW_EVENT' } });
  if (!source?.active) throw new Error('Activate the Events Lead Source before importing Trade Show leads.');
  return source;
}

export async function establishContactSource(tx: Tx, contactId: number, sourceId: number | null, actorId: number) {
  if (!sourceId) return;
  const changed = await tx.contact.updateMany({ where: { id: contactId, leadSourceId: null }, data: { leadSourceId: sourceId } });
  if (changed.count) await tx.leadSourceChange.create({ data: { contactId, oldSourceId: null, newSourceId: sourceId, actorId, reason: 'First touch from linked Trade Show Lead' } });
}

export async function attachTradeShowInfluence(tx: Tx, lead: { id: number; tradeShowId: number; capturedAt: Date | null; importedAt: Date; contactId: number | null }, campaignId: number, sourceId: number, actorId: number) {
  const changed = await tx.tradeShowLead.updateMany({ where: { id: lead.id, leadSourceId: null }, data: { leadSourceId: sourceId } });
  if (changed.count) await tx.leadSourceChange.create({ data: { tradeShowLeadId: lead.id, oldSourceId: null, newSourceId: sourceId, actorId, reason: 'Trade Show import' } });
  await tx.campaignInfluence.upsert({
    where: { sourceKey: `trade-show-lead:${lead.id}` },
    create: { campaignId, tradeShowLeadId: lead.id, occurredAt: lead.capturedAt ?? lead.importedAt, sourceContext: 'TRADE_SHOW_IMPORT', sourceKey: `trade-show-lead:${lead.id}`, capturedById: actorId },
    update: {},
  });
  if (lead.contactId) await establishContactSource(tx, lead.contactId, sourceId, actorId);
}

export async function linkLeadAttributionToContact(tx: Tx, leadId: number, contactId: number, actorId: number) {
  const lead = await tx.tradeShowLead.findUniqueOrThrow({ where: { id: leadId }, select: { leadSourceId: true } });
  await establishContactSource(tx, contactId, lead.leadSourceId, actorId);
}

export async function correctLeadSource(client: PrismaClient, target: { contactId: number; tradeShowLeadId?: never } | { tradeShowLeadId: number; contactId?: never }, newSourceId: number | null, actor: Actor, reason: string) {
  if (!canManageAttribution(actor)) throw new Error('Access denied');
  if (!reason.trim()) throw new Error('Give a reason for the correction.');
  return client.$transaction(async tx => {
    if (newSourceId !== null && !await tx.leadSourceOption.findFirst({ where: { id: newSourceId, active: true } })) throw new Error('Choose an active Lead Source.');
    if (target.contactId) {
      const current = await tx.contact.findUniqueOrThrow({ where: { id: target.contactId }, select: { leadSourceId: true } });
      if (current.leadSourceId === newSourceId) return;
      await tx.contact.update({ where: { id: target.contactId }, data: { leadSourceId: newSourceId } });
      await tx.leadSourceChange.create({ data: { contactId: target.contactId, oldSourceId: current.leadSourceId, newSourceId, actorId: actor.id, reason: reason.trim() } });
    } else if (target.tradeShowLeadId) {
      const current = await tx.tradeShowLead.findUniqueOrThrow({ where: { id: target.tradeShowLeadId }, select: { leadSourceId: true } });
      if (current.leadSourceId === newSourceId) return;
      await tx.tradeShowLead.update({ where: { id: target.tradeShowLeadId }, data: { leadSourceId: newSourceId } });
      await tx.leadSourceChange.create({ data: { tradeShowLeadId: target.tradeShowLeadId, oldSourceId: current.leadSourceId, newSourceId, actorId: actor.id, reason: reason.trim() } });
    }
  });
}

export async function contactAttribution(client: PrismaClient, contactId: number) {
  const contact = await client.contact.findUniqueOrThrow({ where: { id: contactId }, select: { leadSource: { select: { name: true } } } });
  const influences = await client.campaignInfluence.findMany({ where: { voidedAt: null, OR: [{ contactId }, { tradeShowLead: { contactId } }] }, include: { campaign: { select: { name: true, archivedAt: true } } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
  return { leadSource: contact.leadSource?.name ?? null, influences };
}

export async function opportunityAttribution(client: PrismaClient, opportunityId: number, contactIds: number[], originatingLeadId: number | null) {
  const contacts = contactIds.length ? await client.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, leadSource: { select: { name: true } } } }) : [];
  const lead = originatingLeadId ? await client.tradeShowLead.findUnique({ where: { id: originatingLeadId }, select: { leadSource: { select: { name: true } } } }) : null;
  const influences = await client.campaignInfluence.findMany({ where: { voidedAt: null, OR: [{ opportunityId }, ...(originatingLeadId ? [{ tradeShowLeadId: originatingLeadId }] : []), ...(contactIds.length ? [{ contactId: { in: contactIds } }, { tradeShowLead: { contactId: { in: contactIds } } }] : [])] }, include: { campaign: { select: { name: true, archivedAt: true } } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
  const names = [...new Set([lead?.leadSource?.name, ...contacts.map(c => c.leadSource?.name)].filter((name): name is string => !!name))];
  return { leadSource: names.join(', ') || null, influences };
}
