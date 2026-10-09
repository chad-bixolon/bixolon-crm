import type { NotificationEntityType } from '@prisma/client';

export const notificationEntityLabels: Record<NotificationEntityType, string> = {
  PRICE_EXCEPTION: 'Price Exception',
  SUPPORT_CASE: 'Support Case',
  TASK: 'Task',
  OPPORTUNITY: 'Opportunity',
  DEMO: 'Demo',
  PROJECT: 'Project',
  TRADE_SHOW: 'Trade Show',
  CAMPAIGN: 'Campaign',
};

export function notificationDisplayMessage(row: { entityType: NotificationEntityType; entityId: number; message: string }) {
  const label = notificationEntityLabels[row.entityType];
  const names = row.entityType === 'PRICE_EXCEPTION' ? ['PE', label] : [label];
  return names.reduce((message, name) => message.replaceAll(new RegExp(`${name} #${row.entityId}(?![\\w-])`, 'g'), label), row.message);
}
