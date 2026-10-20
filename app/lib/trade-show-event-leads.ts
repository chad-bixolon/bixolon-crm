import { TradeShowLeadRouting, TradeShowLeadStatus, type Prisma } from '@prisma/client';
import type { Actor } from './authorization';
import { tradeShowLeadReadWhere } from './trade-shows';
import { positiveId } from './crm-validation';

export type EventLeadFilters = { q?: string; rep?: string; status?: string; routing?: string; account?: string; contact?: string; followUp?: string; page?: string };
// Shared by the event list and submit-time current-page routing revalidation.
export function eventLeadWhere(actor: Actor, filters: EventLeadFilters): Prisma.TradeShowLeadWhereInput {
  const clauses: Prisma.TradeShowLeadWhereInput[] = [tradeShowLeadReadWhere(actor)];
  const repId = positiveId(filters.rep ?? '');
  if (repId) clauses.push({ assignedSalesRepUserId: repId });
  const q = filters.q?.trim().slice(0, 120);
  if (q) clauses.push({ OR: ['firstName', 'lastName', 'sourceCompany', 'email'].map(key => ({ [key]: { contains: q, mode: 'insensitive' } })) });
  if (Object.values(TradeShowLeadStatus).includes(filters.status as TradeShowLeadStatus)) clauses.push({ status: filters.status as TradeShowLeadStatus });
  if (Object.values(TradeShowLeadRouting).includes(filters.routing as TradeShowLeadRouting)) clauses.push({ routing: filters.routing as TradeShowLeadRouting });
  if (filters.account === 'unresolved') clauses.push({ accountId: null });
  if (filters.contact === 'unresolved') clauses.push({ contactId: null });
  if (filters.contact === 'linked') clauses.push({ contactId: { not: null } });
  // Existing lead metadata filters retain their behavior; these are not Task dates.
  if (filters.followUp === 'overdue') clauses.push({ routing: 'BIXOLON_SALES', followUpAt: { lt: new Date() } });
  if (filters.followUp === 'scheduled') clauses.push({ routing: 'BIXOLON_SALES', followUpAt: { not: null } });
  if (filters.followUp === 'none') clauses.push({ routing: 'BIXOLON_SALES', followUpAt: null });
  return { AND: clauses };
}
