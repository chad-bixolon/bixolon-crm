import { Prisma, TradeShowLeadStatus, type TradeShowLeadRouting, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { field, optional, positiveId, required, type Errors } from './crm-validation';
import { isApprovedTradeShowTimezone } from './trade-show-timezones';
import { dateField } from './work';

export type TradeShowInput = {
  name: string; startDate: Date | null; endDate: Date | null; location: string | null;
  timezone: string; description: string | null; marketingOwnerId: number | null;
};

export function parseTradeShow(form: FormData) {
  const errors: Errors = {};
  const name = required(form, 'name', 'Trade Show name', 200, errors);
  const startDate = dateField(field(form, 'startDate'), 'startDate', errors);
  const endDate = dateField(field(form, 'endDate'), 'endDate', errors);
  if (startDate && endDate && endDate < startDate) errors.endDate = 'End date must be on or after the start date.';
  const location = optional(form, 'location', 300, errors);
  const timezone = required(form, 'timezone', 'Event timezone', 100, errors);
  if (timezone && !isApprovedTradeShowTimezone(timezone)) errors.timezone = 'Choose an approved event timezone.';
  const description = optional(form, 'description', 5000, errors);
  const ownerRaw = field(form, 'marketingOwnerId');
  const marketingOwnerId = ownerRaw ? positiveId(ownerRaw) : null;
  if (ownerRaw && !marketingOwnerId) errors.marketingOwnerId = 'Choose a valid Marketing Owner.';
  return { errors, value: Object.keys(errors).length ? undefined : {
    name, startDate, endDate, location, timezone, description, marketingOwnerId,
  } satisfies TradeShowInput };
}

export function tradeShowFailureState(form: FormData, errors: Errors, message = 'Correct the highlighted fields.') {
  return { errors, message, values: Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) };
}

export function tradeShowReadWhere(actor: Actor): Prisma.TradeShowWhereInput {
  if (!can(actor, 'trade-shows.read')) return { id: -1 };
  return actor.role === 'SALES' ? { leads: { some: { assignedSalesRepUserId: actor.id } } } : {};
}

export function tradeShowLeadReadWhere(actor: Actor): Prisma.TradeShowLeadWhereInput {
  if (!can(actor, 'trade-shows.read')) return { id: -1 };
  return actor.role === 'SALES' ? { assignedSalesRepUserId: actor.id } : {};
}

export function canEditTradeShowLead(actor: Actor, lead: { assignedSalesRepUserId: number | null }) {
  return can(actor, 'trade-shows.leads.write') && (actor.role !== 'SALES' || lead.assignedSalesRepUserId === actor.id);
}

export function tradeShowKpis(leads: { assignedSalesRepUserId: number | null; status: TradeShowLeadStatus; routing?:TradeShowLeadRouting }[]) {
  return {
    total: leads.length,
    assigned: leads.filter(lead => lead.assignedSalesRepUserId !== null).length,
    contacted: leads.filter(lead => ['CONTACTED', 'QUALIFIED', 'CONVERTED'].includes(lead.status)).length,
    qualified: leads.filter(lead => ['QUALIFIED', 'CONVERTED'].includes(lead.status)).length,
    converted: leads.filter(lead => lead.status === 'CONVERTED').length,
    routing:{
      UNREVIEWED:leads.filter(lead=>(lead.routing??'UNREVIEWED')==='UNREVIEWED').length,
      BIXOLON_SALES:leads.filter(lead=>lead.routing==='BIXOLON_SALES').length,
      REFERRED_TO_PARTNER:leads.filter(lead=>lead.routing==='REFERRED_TO_PARTNER').length,
      MARKETING_FOLLOW_UP:leads.filter(lead=>lead.routing==='MARKETING_FOLLOW_UP').length,
    },
  };
}

export async function saveTradeShow(client: PrismaClient, input: TradeShowInput, actor: Actor, id?: number) {
  if (!can(actor, 'trade-shows.manage')) throw new Error('Access denied');
  if (!input.name.trim() || input.name.length > 200) throw new Error('Trade Show name is required and must be 200 characters or fewer.');
  if (input.endDate && input.startDate && input.endDate < input.startDate) throw new Error('End date must be on or after the start date.');
  if (!input.timezone || !isApprovedTradeShowTimezone(input.timezone)) throw new Error('Choose an approved event timezone.');
  return client.$transaction(async tx => {
    const existing = id ? await tx.tradeShow.findUnique({ where: { id } }) : null;
    if (id && (!existing || existing.archivedAt)) throw new Error('Trade Show not found or archived.');
    if (input.marketingOwnerId) {
      const owner = await tx.user.findFirst({ where: { id: input.marketingOwnerId, role: 'MARKETING_MANAGER', active: true, archivedAt: null } });
      if (!owner) throw new Error('Choose an active Marketing Manager.');
    }
    const data = { ...input, updatedById: actor.id };
    const show = existing ? await tx.tradeShow.update({ where: { id }, data }) : await tx.tradeShow.create({ data: { ...data, createdById: actor.id } });
    return show.id;
  });
}

export async function setTradeShowArchived(client: PrismaClient, id: number, archived: boolean, actor: Actor) {
  if (!can(actor, 'trade-shows.manage')) throw new Error('Access denied');
  const show = await client.tradeShow.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
  if (!show) throw new Error('Trade Show not found.');
  if (!!show.archivedAt === archived) throw new Error(archived ? 'Trade Show already archived.' : 'Trade Show already active.');
  await client.tradeShow.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, archivedById: archived ? actor.id : null, updatedById: actor.id } });
}
