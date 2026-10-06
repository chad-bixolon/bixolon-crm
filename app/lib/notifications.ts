import { Prisma, type PrismaClient, type Notification, type NotificationSeverity } from '@prisma/client';
import type { Actor } from './authorization';
import { can } from './authorization';
import { scopedPriceExceptionWhere } from './price-exception-visibility';

type Db = PrismaClient | Prisma.TransactionClient;
export type NotificationView = 'active' | 'unread' | 'all' | 'dismissed' | 'resolved';
export const notificationViews: NotificationView[] = ['active', 'unread', 'all', 'dismissed', 'resolved'];
export const severityLabels: Record<NotificationSeverity, string> = { INFO: 'Info', WARNING: 'Warning', CRITICAL: 'Critical' };

export function notificationWhere(userId: number, view: NotificationView): Prisma.NotificationWhereInput {
  const state = view === 'active' ? { dismissedAt: null, resolvedAt: null }
    : view === 'unread' ? { readAt: null, dismissedAt: null, resolvedAt: null }
    : view === 'dismissed' ? { dismissedAt: { not: null } }
    : view === 'resolved' ? { resolvedAt: { not: null } } : {};
  return { userId, ...state };
}

/** Entity permission is checked on reads as well as at the normal deep link. */
async function visibleEntityIds(db: Db, actor: Actor) {
  if (!can(actor, 'pricing.read')) return [];
  const candidates = await db.notification.findMany({ where: { userId: actor.id, entityType: 'PRICE_EXCEPTION' }, select: { entityId: true }, distinct: ['entityId'] });
  if (!candidates.length) return [];
  const rows = await db.priceException.findMany({ where: scopedPriceExceptionWhere(actor, { id: { in: candidates.map(row => row.entityId) } }), select: { id: true } });
  return rows.map(row => row.id);
}

export async function notificationPage(db: Db, actor: Actor, view: NotificationView, page = 1, take = 20) {
  const ids = await visibleEntityIds(db, actor);
  const where: Prisma.NotificationWhereInput = { ...notificationWhere(actor.id, view), entityType: 'PRICE_EXCEPTION', entityId: { in: ids } };
  const count = await db.notification.count({ where });
  const pages = Math.max(1, Math.ceil(count / take));
  const current = Math.min(Math.max(1, page), pages);
  const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (current - 1) * take, take });
  return { rows, count, page: current, pages };
}

export async function notificationSummary(db: Db, actor: Actor) {
  const ids = await visibleEntityIds(db, actor);
  const where: Prisma.NotificationWhereInput = { ...notificationWhere(actor.id, 'active'), entityType: 'PRICE_EXCEPTION', entityId: { in: ids } };
  const [unread, rows] = await Promise.all([
    db.notification.count({ where: { ...where, readAt: null } }),
    db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 7 }),
  ]);
  return { unread, rows };
}

export async function updateNotification(db: Db, actor: Actor, id: number, operation: 'read' | 'dismiss') {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const row = await db.notification.findFirst({ where: { id, userId: actor.id }, select: { entityType: true, entityId: true } });
  if (!row || row.entityType !== 'PRICE_EXCEPTION' || !can(actor, 'pricing.read')) return false;
  const pe = await db.priceException.findFirst({ where: scopedPriceExceptionWhere(actor, { id: row.entityId }), select: { id: true } });
  if (!pe) return false;
  await db.notification.updateMany({ where: { id, userId: actor.id, ...(operation === 'read' ? { readAt: null } : { dismissedAt: null }) }, data: operation === 'read' ? { readAt: new Date() } : { dismissedAt: new Date() } });
  return true;
}

export async function markAllNotificationsRead(db: Db, actor: Actor) {
  const ids = await visibleEntityIds(db, actor);
  await db.notification.updateMany({ where: { ...notificationWhere(actor.id, 'unread'), entityType: 'PRICE_EXCEPTION', entityId: { in: ids } }, data: { readAt: new Date() } });
}

export async function dismissAllReadNotifications(db: Db, actor: Actor) {
  const ids = await visibleEntityIds(db, actor);
  await db.notification.updateMany({ where: { ...notificationWhere(actor.id, 'active'), readAt: { not: null }, entityType: 'PRICE_EXCEPTION', entityId: { in: ids } }, data: { dismissedAt: new Date() } });
}

export function friendlyNotificationTime(createdAt: Date, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return createdAt.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

export type NotificationItem = Pick<Notification, 'id' | 'title' | 'message' | 'severity' | 'createdAt' | 'readAt' | 'dismissedAt' | 'resolvedAt' | 'actionUrl' | 'entityType' | 'entityId'>;
