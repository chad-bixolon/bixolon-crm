'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { campaignStatuses, canManageAttribution, correctLeadSource } from '@/lib/marketing-attribution';

const id = (value: FormDataEntryValue | null) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const value = (form: FormData, key: string, max: number) => { const text = String(form.get(key) ?? '').trim(); if (text.length > max) throw new Error(`${key} is too long.`); return text; };
async function manager() { const actor = await currentUser(); if (!canManageAttribution(actor)) throw new Error('Access denied'); return actor; }

export async function saveLeadSource(form: FormData) {
  await manager(); const sourceId = id(form.get('id')), name = value(form, 'name', 120); if (!name) throw new Error('Name is required.');
  const active = form.get('active') === 'on'; const sortOrder = Number(form.get('sortOrder'));
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) throw new Error('Choose a valid order.');
  if (sourceId) await prisma.leadSourceOption.update({ where: { id: sourceId }, data: { name, active, sortOrder } });
  else await prisma.leadSourceOption.create({ data: { name, active, sortOrder } });
  revalidatePath('/marketing/lead-sources'); redirect('/marketing/lead-sources');
}

export async function saveCampaign(form: FormData) {
  const actor = await manager(); const campaignId = id(form.get('id')), name = value(form, 'name', 160), category = value(form, 'category', 120) || null, description = value(form, 'description', 10000) || null;
  if (!name) throw new Error('Campaign name is required.');
  const status = value(form, 'status', 20); if (!campaignStatuses.includes(status as never)) throw new Error('Choose a valid status.');
  const yearText = value(form, 'year', 4), year = yearText ? Number(yearText) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) throw new Error('Choose a valid year.');
  const date = (key: string) => { const text = value(form, key, 10); if (!text) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Choose a valid date.'); const result = new Date(`${text}T00:00:00.000Z`); if (result.toISOString().slice(0, 10) !== text) throw new Error('Choose a valid date.'); return result; };
  const startDate = date('startDate'), endDate = date('endDate'); if (startDate && endDate && endDate < startDate) throw new Error('End date precedes start date.');
  const data = { name, category, description, status, year, startDate, endDate, updatedById: actor.id };
  const campaign = campaignId ? await prisma.marketingCampaign.update({ where: { id: campaignId }, data }) : await prisma.marketingCampaign.create({ data: { ...data, createdById: actor.id } });
  revalidatePath('/marketing/campaigns'); redirect(`/marketing/campaigns/${campaign.id}`);
}

export async function setCampaignArchive(form: FormData) {
  const actor = await manager(), campaignId = id(form.get('id')); if (!campaignId) throw new Error('Invalid Campaign.');
  await prisma.marketingCampaign.update({ where: { id: campaignId }, data: { archivedAt: form.get('archive') === 'true' ? new Date() : null, updatedById: actor.id } });
  revalidatePath('/marketing/campaigns'); redirect(`/marketing/campaigns/${campaignId}`);
}

export async function setFirstTouch(form: FormData) {
  const actor = await manager(), contactId = id(form.get('contactId')), tradeShowLeadId = id(form.get('tradeShowLeadId')), sourceId = id(form.get('sourceId'));
  if (!!contactId === !!tradeShowLeadId) throw new Error('Choose a Contact or Trade Show Lead.');
  await correctLeadSource(prisma, contactId ? { contactId } : { tradeShowLeadId: tradeShowLeadId! }, sourceId, actor, value(form, 'reason', 1000));
  revalidatePath(contactId ? `/contacts/${contactId}` : `/trade-shows/${form.get('tradeShowId')}/leads/${tradeShowLeadId}`);
}

export async function addInfluence(form: FormData) {
  const actor = await manager(), campaignId = id(form.get('campaignId')), contactId = id(form.get('contactId')), tradeShowLeadId = id(form.get('tradeShowLeadId'));
  if (!campaignId || !!contactId === !!tradeShowLeadId) throw new Error('Choose one record and one Campaign.');
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } }); if (!campaign || campaign.archivedAt) throw new Error('Choose an active Campaign.');
  const occurredText = value(form, 'occurredAt', 30), occurredAt = new Date(occurredText); if (!occurredText || Number.isNaN(occurredAt.getTime())) throw new Error('Choose a valid touch date.');
  if (contactId && !await prisma.contact.findUnique({ where: { id: contactId } })) throw new Error('Contact not found.');
  if (tradeShowLeadId && !await prisma.tradeShowLead.findUnique({ where: { id: tradeShowLeadId } })) throw new Error('Lead not found.');
  await prisma.campaignInfluence.create({ data: { campaignId, contactId, tradeShowLeadId, occurredAt, sourceContext: 'MANUAL_MARKETING', notes: value(form, 'notes', 10000) || null, capturedById: actor.id } });
  revalidatePath(contactId ? `/contacts/${contactId}` : `/trade-shows/${form.get('tradeShowId')}/leads/${tradeShowLeadId}`);
}

export async function voidInfluence(form: FormData) {
  const actor = await manager(), influenceId = id(form.get('id')), reason = value(form, 'reason', 1000); if (!influenceId || !reason) throw new Error('A correction reason is required.');
  const influence = await prisma.campaignInfluence.findUniqueOrThrow({ where: { id: influenceId } });
  if (influence.voidedAt) throw new Error('Touch already voided.');
  await prisma.campaignInfluence.update({ where: { id: influenceId }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
  if (influence.contactId) revalidatePath(`/contacts/${influence.contactId}`);
  if (influence.tradeShowLeadId) { const lead = await prisma.tradeShowLead.findUnique({ where: { id: influence.tradeShowLeadId }, select: { tradeShowId: true, contactId: true, convertedOpportunityId: true } }); if (lead) { revalidatePath(`/trade-shows/${lead.tradeShowId}/leads/${influence.tradeShowLeadId}`); if (lead.contactId) revalidatePath(`/contacts/${lead.contactId}`); if (lead.convertedOpportunityId) revalidatePath(`/opportunities/${lead.convertedOpportunityId}`); } }
  revalidatePath(`/marketing/campaigns/${influence.campaignId}`);
}
