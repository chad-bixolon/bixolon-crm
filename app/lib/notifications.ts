import { Prisma, type PrismaClient, type Notification, type NotificationSeverity } from '@prisma/client';
import type { Actor } from './authorization';
import { can, opportunityScope, taskScope } from './authorization';
import { scopedPriceExceptionWhere } from './price-exception-visibility';
import { supportCaseReadWhere } from './support-cases';
import { calendarLocalInput, calendarLocalToUtc } from './calendar-time';

type Db = PrismaClient | Prisma.TransactionClient;
export type NotificationView = 'active' | 'unread' | 'all' | 'dismissed' | 'resolved';
export const notificationViews: NotificationView[] = ['active', 'unread', 'all', 'dismissed', 'resolved'];
export const severityLabels: Record<NotificationSeverity, string> = { INFO: 'Info', WARNING: 'Warning', CRITICAL: 'Critical' };
export type NotificationCategory = 'all' | 'price-exceptions' | 'tasks' | 'opportunities' | 'support';
export const notificationCategories: NotificationCategory[] = ['all', 'price-exceptions', 'tasks', 'opportunities', 'support'];

export function snoozeUntil(choice: string, now: Date, timeZone: string, custom?: string) {
  const local = calendarLocalInput(now, timeZone);
  if (choice === 'custom') {
    const date = calendarLocalToUtc(custom ?? '', timeZone);
    return date && date > now && date.getTime() <= now.getTime() + 365 * 86400000 ? date : null;
  }
  if (choice === 'later-today') {
    const end = calendarLocalToUtc(`${local.slice(0, 10)}T23:59`, timeZone);
    return end && end > now ? end : null;
  }
  const days = choice === 'tomorrow' ? 1 : choice === 'three-days' ? 3 : choice === 'one-week' ? 7 : 0;
  if (!days) return null;
  const date = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarLocalToUtc(`${date.toISOString().slice(0, 10)}T09:00`, timeZone);
}

export function notificationWhere(userId: number, view: NotificationView, now = new Date()): Prisma.NotificationWhereInput {
  const awake = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const state = view === 'active' ? { dismissedAt: null, resolvedAt: null, ...awake }
    : view === 'unread' ? { readAt: null, dismissedAt: null, resolvedAt: null, ...awake }
    : view === 'dismissed' ? { dismissedAt: { not: null } }
    : view === 'resolved' ? { resolvedAt: { not: null } } : {};
  return { userId, ...state };
}

async function surfacedPreferenceWhere(db: Db, userId: number): Promise<Prisma.NotificationWhereInput> {
  const model = db.notificationPreference;
  if (!model) return {}; // Lightweight existing notification test doubles.
  const disabled = await model.findMany({ where: { userId, enabled: false }, select: { category: true } });
  if (!disabled.length) return {};
  return { NOT: { entityType: { in: disabled.map(row => row.category) }, severity: { in: ['INFO', 'WARNING'] } } };
}

/** Entity permission is checked on reads as well as at the normal deep link. */
async function visibleEntityWhere(db: Db, actor: Actor, category: NotificationCategory = 'all'): Promise<Prisma.NotificationWhereInput> {
  const types = category === 'all' ? ['PRICE_EXCEPTION', 'TASK', 'OPPORTUNITY', 'SUPPORT_CASE'] as const : [category === 'price-exceptions' ? 'PRICE_EXCEPTION' : category === 'tasks' ? 'TASK' : category === 'support' ? 'SUPPORT_CASE' : 'OPPORTUNITY'] as const;
  const clauses: Prisma.NotificationWhereInput[] = [];
  for (const entityType of types) {
    const permission = entityType === 'PRICE_EXCEPTION' ? 'pricing.read' : entityType === 'TASK' ? 'tasks.read' : entityType === 'SUPPORT_CASE' ? 'support-cases.read' : 'opportunities.read';
    if (!can(actor, permission)) continue;
    const candidates = await db.notification.findMany({ where: { userId: actor.id, entityType }, select: { entityId: true }, distinct: ['entityId'] });
    const ids = candidates.map(row => row.entityId);
    if (!ids.length) continue;
    const rows = entityType === 'PRICE_EXCEPTION' ? await db.priceException.findMany({ where: scopedPriceExceptionWhere(actor, { id: { in: ids } }), select: { id: true } })
      : entityType === 'TASK' ? await db.task.findMany({ where: { id: { in: ids }, ...taskScope(actor) }, select: { id: true } })
      : entityType === 'SUPPORT_CASE' ? await db.supportCase.findMany({ where: { id: { in: ids }, ...supportCaseReadWhere(actor, true) }, select: { id: true } })
      : await db.opportunity.findMany({ where: { id: { in: ids }, ...opportunityScope(actor) }, select: { id: true } });
    if (rows.length) clauses.push({ entityType, entityId: { in: rows.map(row => row.id) } });
  }
  return { OR: clauses };
}

export async function notificationPage(db: Db, actor: Actor, view: NotificationView, page = 1, take = 20, category: NotificationCategory = 'all', severity?: NotificationSeverity) {
  const visible = await visibleEntityWhere(db, actor, category);
  const preference = view === 'active' || view === 'unread' ? await surfacedPreferenceWhere(db, actor.id) : {};
  const where: Prisma.NotificationWhereInput = { ...notificationWhere(actor.id, view), AND: [visible, preference], ...(severity ? { severity } : {}) };
  const count = await db.notification.count({ where });
  const pages = Math.max(1, Math.ceil(count / take));
  const current = Math.min(Math.max(1, page), pages);
  const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (current - 1) * take, take });
  return { rows, count, page: current, pages };
}

export async function notificationSummary(db: Db, actor: Actor) {
  const where: Prisma.NotificationWhereInput = { ...notificationWhere(actor.id, 'active'), AND: [await visibleEntityWhere(db, actor), await surfacedPreferenceWhere(db, actor.id)] };
  const [unread, rows] = await Promise.all([
    db.notification.count({ where: { ...where, readAt: null } }),
    db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 7 }),
  ]);
  return { unread, rows };
}

/** Read-only counts for the two existing Notification Center bulk actions. */
export async function notificationBulkActionAvailability(db: Db, actor: Actor) {
  const where: Prisma.NotificationWhereInput = { ...notificationWhere(actor.id, 'active'), AND: [await visibleEntityWhere(db, actor), await surfacedPreferenceWhere(db, actor.id)] };
  const [unread, read] = await Promise.all([
    db.notification.count({ where: { ...where, readAt: null } }),
    db.notification.count({ where: { ...where, readAt: { not: null } } }),
  ]);
  return { canMarkAllRead: unread > 0, canDismissRead: read > 0 };
}

export async function updateNotification(db: Db, actor: Actor, id: number, operation: 'read' | 'dismiss') {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const row = await db.notification.findFirst({ where: { id, userId: actor.id }, select: { entityType: true, entityId: true } });
  if (!row || !['PRICE_EXCEPTION', 'TASK', 'OPPORTUNITY', 'SUPPORT_CASE'].includes(row.entityType)) return false;
  const visible = await visibleEntityWhere(db, actor, row.entityType === 'PRICE_EXCEPTION' ? 'price-exceptions' : row.entityType === 'TASK' ? 'tasks' : row.entityType === 'SUPPORT_CASE' ? 'support' : 'opportunities');
  if (!(await db.notification.findFirst({ where: { id, userId: actor.id, AND: [visible] }, select: { id: true } }))) return false;
  await db.notification.updateMany({ where: { id, userId: actor.id, ...(operation === 'read' ? { readAt: null } : { dismissedAt: null }) }, data: operation === 'read' ? { readAt: new Date() } : { dismissedAt: new Date() } });
  return true;
}

export async function snoozeUserNotification(db: Db, actor: Actor, id: number, until: Date) {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(until.getTime()) || until <= new Date()) return false;
  const row = await db.notification.findFirst({ where: { id, userId: actor.id, dismissedAt: null, resolvedAt: null }, select: { entityType: true } });
  if (!row) return false;
  const category: NotificationCategory = row.entityType === 'PRICE_EXCEPTION' ? 'price-exceptions' : row.entityType === 'TASK' ? 'tasks' : row.entityType === 'SUPPORT_CASE' ? 'support' : 'opportunities';
  const visible = await visibleEntityWhere(db, actor, category);
  return (await db.notification.updateMany({ where: { id, userId: actor.id, dismissedAt: null, resolvedAt: null, AND: [visible] }, data: { snoozedUntil: until } })).count === 1;
}

export async function markAllNotificationsRead(db: Db, actor: Actor) {
  await db.notification.updateMany({ where: { ...notificationWhere(actor.id, 'unread'), AND: [await visibleEntityWhere(db, actor), await surfacedPreferenceWhere(db, actor.id)] }, data: { readAt: new Date() } });
}

export async function dismissAllReadNotifications(db: Db, actor: Actor) {
  await db.notification.updateMany({ where: { ...notificationWhere(actor.id, 'active'), readAt: { not: null }, AND: [await visibleEntityWhere(db, actor), await surfacedPreferenceWhere(db, actor.id)] }, data: { dismissedAt: new Date() } });
}

export function friendlyNotificationTime(createdAt: Date, now = new Date()) {
  const minutes = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return createdAt.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

export type NotificationItem = Pick<Notification, 'id' | 'title' | 'message' | 'severity' | 'createdAt' | 'readAt' | 'dismissedAt' | 'resolvedAt' | 'snoozedUntil' | 'actionUrl' | 'entityType' | 'entityId'>;
