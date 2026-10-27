import type { NotificationEntityType, NotificationSeverity, PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'notification' | 'notificationPreference'>;
export type NoticeCandidate = { type: string; severity: NotificationSeverity; title: string; message: string; sourceKey: string };
export type NoticeEntry = { entityId: number; userId: number | null; candidates: NoticeCandidate[] };

/** Scheduled evaluation only. Submit-time sync still validates the record and user in its transaction. */
export async function reconcileNotificationBatch(db: Db, entityType: NotificationEntityType, types: string[], entries: NoticeEntry[], now: Date) {
  if (!entries.length) return { created: 0, resolved: 0, allowedSourceKeys: new Set<string>() };
  const ids = entries.map(entry => entry.entityId);
  const userIds = [...new Set(entries.map(entry => entry.userId).filter((id): id is number => id !== null))];
  const [current, preferences] = await Promise.all([
    db.notification.findMany({ where: { entityType, entityId: { in: ids }, type: { in: types }, resolvedAt: null }, select: { id: true, entityId: true, sourceKey: true } }),
    db.notificationPreference && userIds.length ? db.notificationPreference.findMany({ where: { userId: { in: userIds }, category: entityType }, select: { userId: true, enabled: true } }) : [],
  ]);
  const enabled = new Map(preferences.map(row => [row.userId, row.enabled]));
  const keys = new Set(entries.flatMap(entry => entry.candidates.map(candidate => candidate.sourceKey)));
  const obsolete = current.filter(row => !keys.has(row.sourceKey)).map(row => row.id);
  const resolved = obsolete.length ? (await db.notification.updateMany({ where: { id: { in: obsolete } }, data: { resolvedAt: now } })).count : 0;
  const data = entries.flatMap(entry => entry.userId === null ? [] : entry.candidates
    .filter(candidate => candidate.severity === 'CRITICAL' || enabled.get(entry.userId!) !== false)
    .map(candidate => ({ userId: entry.userId!, type: candidate.type, severity: candidate.severity, title: candidate.title, message: candidate.message, entityType, entityId: entry.entityId, actionUrl: entityType === 'TASK' ? `/tasks/${entry.entityId}` : entityType === 'OPPORTUNITY' ? `/opportunities/${entry.entityId}` : entityType === 'SUPPORT_CASE' ? `/support/cases/${entry.entityId}` : `/price-exceptions/${entry.entityId}`, sourceKey: candidate.sourceKey })));
  const created = data.length ? (await db.notification.createMany({ data, skipDuplicates: true })).count : 0;
  return { created, resolved, allowedSourceKeys: new Set(data.map(row => row.sourceKey)) };
}
