import type { Prisma, TradeShowLeadRouting } from '@prisma/client';
import { eligibleUserWhere } from './assignment-eligibility';
import { notifyTaskAssignment, syncTaskNotifications } from './work-notification-evaluator';

export const TRADE_SHOW_FOLLOW_UP_SOURCE = 'TRADE_SHOW_LEAD_FOLLOW_UP';
type Client = Prisma.TransactionClient;
export type FollowUpLead = {
  id: number; tradeShowId: number; routing: TradeShowLeadRouting; assignedSalesRepUserId: number | null;
  firstName: string; lastName: string; sourceCompany: string | null; email: string | null;
  productInterest: string | null; accountId: number | null; contactId: number | null;
};

// Task dates use the CRM's date-only convention: noon UTC represents the due calendar day.
export function followUpDueDate(assignedAt: Date, businessDays = 2) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(assignedAt);
  const part = (name: string) => Number(parts.find(item => item.type === name)?.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day'), 12));
  let remaining = businessDays;
  while (remaining) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining--;
  }
  return date;
}

export function followUpTitle(lead: FollowUpLead) {
  const name = lead.sourceCompany?.trim() || [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return `Follow up with Trade Show lead${name ? ` — ${name}` : ''}`.slice(0, 200);
}

export function followUpDescription(lead: FollowUpLead, showName: string) {
  return [
    `Trade Show: ${showName}`,
    [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() && `Lead: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()}`,
    lead.sourceCompany?.trim() && `Company: ${lead.sourceCompany.trim()}`,
    lead.email?.trim() && `Email: ${lead.email.trim()}`,
    lead.productInterest?.trim() && `Product interest: ${lead.productInterest.trim()}`,
  ].filter(Boolean).join('\n').slice(0, 5000);
}

export async function syncTradeShowFollowUp(tx: Client, before: Pick<FollowUpLead, 'routing' | 'assignedSalesRepUserId'> | null, after: FollowUpLead, actorId: number, assignedAt = new Date(), businessDays = 2) {
  const previousRep = before?.routing === 'BIXOLON_SALES' ? before.assignedSalesRepUserId : null;
  const nextRep = after.routing === 'BIXOLON_SALES' ? after.assignedSalesRepUserId : null;
  if (previousRep === nextRep) return;
  const active = await tx.task.findFirst({ where: { source: TRADE_SHOW_FOLLOW_UP_SOURCE, tradeShowLeadId: after.id, archivedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { id: 'desc' } });
  if (!nextRep) {
    if (active) { await tx.task.update({ where: { id: active.id }, data: { status: 'CANCELLED', updatedById: actorId } }); if (tx.notification) await syncTaskNotifications(tx, active.id); }
    return;
  }
  const eligible = await tx.user.findFirst({ where: { id: nextRep, ...eligibleUserWhere('tasks.write') }, select: { id: true } });
  if (!eligible) throw new Error(`Assigned Sales rep ${nextRep} cannot receive Tasks. Lead assignment was not changed.`);
  if (active) {
    if (active.assignedToId !== nextRep) {
      const fromUserId = active.assignedToId;
      await tx.task.update({ where: { id: active.id }, data: { assignedToId: nextRep, updatedById: actorId } });
      const event = await tx.taskAssignmentEvent.create({ data: { taskId: active.id, fromUserId, toUserId: nextRep, actorId } });
      if (tx.notification) { await notifyTaskAssignment(tx, active.id, nextRep, event.id); await syncTaskNotifications(tx, active.id); }
    }
    return;
  }
  const show = await tx.tradeShow.findUnique({ where: { id: after.tradeShowId }, select: { name: true } });
  if (!show) throw new Error('Trade Show not found.');
  const task = await tx.task.create({ data: {
    source: TRADE_SHOW_FOLLOW_UP_SOURCE, tradeShowLeadId: after.id,
    originalAssigneeId: nextRep, assignedToId: nextRep, createdById: actorId, updatedById: actorId,
    subject: followUpTitle(after), description: followUpDescription(after, show.name),
    accountId: after.accountId, contactId: after.contactId,
    dueDate: followUpDueDate(assignedAt, businessDays), status: 'OPEN', priority: 'NORMAL',
  } });
  const event = await tx.taskAssignmentEvent.create({ data: { taskId: task.id, fromUserId: previousRep, toUserId: nextRep, actorId } });
  if (tx.notification) { await notifyTaskAssignment(tx, task.id, nextRep, event.id); await syncTaskNotifications(tx, task.id); }
}
