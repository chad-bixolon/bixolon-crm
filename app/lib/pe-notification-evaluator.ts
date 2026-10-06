import { Prisma, type PrismaClient, type PriceExceptionFollowUpStatus } from '@prisma/client';
import { businessToday, daysUntilExpiration } from './price-exception-expiration';
import { followUpOverdue } from './price-exception-follow-up';

type Db = PrismaClient | Prisma.TransactionClient;
type Pe = { id: number; peCode: string | null; status: 'ACTIVE' | 'EXPIRED' | 'ARCHIVED'; archivedAt: Date | null; expirationDate: Date | null; assignedSalesRepUserId: number | null; followUp: { ownerId: number | null; status: PriceExceptionFollowUpStatus; nextFollowUpAt: Date | null } | null };
type Candidate = { type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; message: string; sourceKey: string };

export function peNotificationRecipient(pe: Pe, users: Map<number, { role: string }>) {
  const ownerId = pe.followUp ? pe.followUp.ownerId : pe.assignedSalesRepUserId;
  const role = ownerId ? users.get(ownerId)?.role : undefined;
  // A Sales user can only open a PE assigned to them under existing PE permissions.
  return role && (role !== 'SALES' || pe.assignedSalesRepUserId === ownerId) ? ownerId : null;
}

export function peNotificationCandidates(pe: Pe, userId: number, today: Date): Candidate[] {
  if (pe.archivedAt || pe.status === 'ARCHIVED') return [];
  const label = pe.peCode ?? `PE #${pe.id}`;
  const days = daysUntilExpiration(pe.expirationDate, today);
  const candidates: Candidate[] = [];
  if (days !== null && days >= 31 && days <= 60) candidates.push({ type: 'PE_EXPIRING_60', severity: 'INFO', title: 'Price Exception expires within 60 days', message: `${label} expires in ${days} days.`, sourceKey: `PE:${pe.id}:${userId}:EXPIRING_60` });
  if (days !== null && days >= 0 && days <= 30) candidates.push({ type: 'PE_EXPIRING_30', severity: 'WARNING', title: 'Price Exception expires within 30 days', message: `${label} expires ${days === 0 ? 'today' : `in ${days} days`}.`, sourceKey: `PE:${pe.id}:${userId}:EXPIRING_30` });
  if (days !== null && days < 0) candidates.push({ type: 'PE_EXPIRED', severity: 'CRITICAL', title: 'Price Exception has expired', message: `${label} has expired${(pe.followUp?.status ?? 'NOT_STARTED') === 'NOT_STARTED' ? ' and follow-up has not started' : ''}.`, sourceKey: `PE:${pe.id}:${userId}:EXPIRED` });
  if (followUpOverdue(pe.followUp?.nextFollowUpAt, pe.followUp?.status ?? 'NOT_STARTED', today)) candidates.push({ type: 'PE_FOLLOW_UP_OVERDUE', severity: 'WARNING', title: 'Price Exception follow-up overdue', message: `${label} follow-up was due ${pe.followUp!.nextFollowUpAt!.toISOString().slice(0, 10)}.`, sourceKey: `PE:${pe.id}:${userId}:FOLLOW_UP_OVERDUE:${pe.followUp!.nextFollowUpAt!.toISOString().slice(0, 10)}` });
  return candidates;
}

async function evaluateOne(db: Db, pe: Pe, users: Map<number, { role: string }>, today: Date) {
  const recipient = peNotificationRecipient(pe, users);
  const candidates = recipient ? peNotificationCandidates(pe, recipient, today) : [];
  const current = await db.notification.findMany({ where: { entityType: 'PRICE_EXCEPTION', entityId: pe.id, resolvedAt: null, type: { in: ['PE_EXPIRING_60', 'PE_EXPIRING_30', 'PE_EXPIRED', 'PE_FOLLOW_UP_OVERDUE'] } }, select: { id: true, sourceKey: true } });
  const keys = new Set(candidates.map(candidate => candidate.sourceKey));
  const obsolete = current.filter(row => !keys.has(row.sourceKey)).map(row => row.id);
  if (obsolete.length) await db.notification.updateMany({ where: { id: { in: obsolete } }, data: { resolvedAt: new Date() } });
  for (const candidate of candidates) {
    await db.notification.createMany({ data: [{ userId: recipient!, type: candidate.type, severity: candidate.severity, title: candidate.title, message: candidate.message, entityType: 'PRICE_EXCEPTION', entityId: pe.id, actionUrl: `/price-exceptions/${pe.id}`, sourceKey: candidate.sourceKey }], skipDuplicates: true });
    // Keep the actionable expired message in sync when follow-up starts.
    if (candidate.type === 'PE_EXPIRED') await db.notification.updateMany({ where: { sourceKey: candidate.sourceKey, resolvedAt: null }, data: { message: candidate.message } });
  }
  return { createdCandidates: candidates.length, resolved: obsolete.length };
}

/** Safe to rerun; source keys are unique and obsolete active notifications are resolved. */
export async function evaluatePeNotifications(db: PrismaClient, now = new Date()) {
  const today = businessToday(now);
  const users = new Map((await db.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, role: true } })).map(user => [user.id, { role: user.role }]));
  let cursor = 0, evaluated = 0, resolved = 0;
  while (true) {
    const rows = await db.priceException.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 200, select: { id: true, peCode: true, status: true, archivedAt: true, expirationDate: true, assignedSalesRepUserId: true, followUp: { select: { ownerId: true, status: true, nextFollowUpAt: true } } } });
    if (!rows.length) break;
    for (const row of rows) { const result = await evaluateOne(db, row, users, today); evaluated++; resolved += result.resolved; }
    cursor = rows.at(-1)!.id;
  }
  return { evaluated, resolved };
}

export async function syncPeNotificationsInTransaction(db: Prisma.TransactionClient, peId: number, now = new Date()) {
  const pe = await db.priceException.findUnique({ where: { id: peId }, select: { id: true, peCode: true, status: true, archivedAt: true, expirationDate: true, assignedSalesRepUserId: true, followUp: { select: { ownerId: true, status: true, nextFollowUpAt: true } } } });
  if (!pe) return;
  const ids = [pe.followUp?.ownerId, pe.assignedSalesRepUserId].filter((id): id is number => id !== null && id !== undefined);
  const users = new Map((await db.user.findMany({ where: { id: { in: ids }, active: true, archivedAt: null }, select: { id: true, role: true } })).map(user => [user.id, { role: user.role }]));
  await evaluateOne(db, pe, users, businessToday(now));
}

export async function notifyPeFollowUpAssignment(db: Prisma.TransactionClient, peId: number, userId: number, eventId: number, actorId: number, now = new Date()) {
  if (userId === actorId) return;
  const pe = await db.priceException.findUnique({ where: { id: peId }, select: { peCode: true, assignedSalesRepUserId: true } });
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, archivedAt: true, role: true } });
  if (!pe || !user?.active || user.archivedAt || (user.role === 'SALES' && pe.assignedSalesRepUserId !== userId)) return;
  await db.notification.createMany({ data: [{ userId, type: 'PE_FOLLOW_UP_ASSIGNED', severity: 'INFO', title: 'Price Exception follow-up assigned to you', message: `${pe.peCode ?? `PE #${peId}`} follow-up was assigned to you.`, entityType: 'PRICE_EXCEPTION', entityId: peId, actionUrl: `/price-exceptions/${peId}`, sourceKey: `PE:${peId}:${userId}:FOLLOW_UP_ASSIGNED:${eventId}`, createdAt: now }], skipDuplicates: true });
}
