import type { NotificationEntityType, NotificationSeverity, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;
export const preferenceCategories = ['TASK', 'OPPORTUNITY', 'PRICE_EXCEPTION', 'SUPPORT_CASE'] as const;
export type PreferenceCategory = typeof preferenceCategories[number];

/** A missing row keeps existing behavior; Critical remains mandatory. */
export async function notificationEnabled(db: Db, userId: number, category: NotificationEntityType, severity: NotificationSeverity) {
  if (severity === 'CRITICAL') return true;
  const model = db.notificationPreference;
  if (!model) return true; // Lightweight existing evaluator test doubles.
  const row = await model.findUnique({ where: { userId_category: { userId, category } }, select: { enabled: true } });
  return row?.enabled ?? true;
}
