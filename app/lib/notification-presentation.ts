import type { NotificationEntityType } from '@prisma/client';

export const notificationEntityLabels: Record<NotificationEntityType, string> = {
  PRICE_EXCEPTION: 'Price Exception',
  TASK: 'Task',
  OPPORTUNITY: 'Opportunity',
  DEMO: 'Demo',
  PROJECT: 'Project',
  TRADE_SHOW: 'Trade Show',
  CAMPAIGN: 'Campaign',
};

export function notificationDisplayMessage(row: { entityType: NotificationEntityType; entityId: number; message: string }) {
  // Older unnumbered PE notifications used the database ID as a fallback label.
  return row.entityType === 'PRICE_EXCEPTION'
    ? row.message.replaceAll(new RegExp(`PE #${row.entityId}(?![\\w-])`, 'g'), 'Price Exception')
    : row.message;
}
