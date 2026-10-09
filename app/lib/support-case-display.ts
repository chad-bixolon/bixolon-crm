import { supportPriorityLabels, supportSourceLabels, supportStatusLabels } from './support-cases';
import { formatDateTimeForUser } from './display-format';

export function supportAge(openedAt: Date, status: string, resolvedAt: Date | null, closedAt: Date | null, now = new Date()) {
  const end = status === 'CLOSED' ? closedAt ?? resolvedAt ?? now : status === 'RESOLVED' ? resolvedAt ?? now : now;
  const days = Math.max(0, Math.floor((end.getTime() - openedAt.getTime()) / 86400000));
  return days >= 60 ? `${Math.floor(days / 30)} months` : `${days} ${days === 1 ? 'day' : 'days'}`;
}
export const supportEventFields: Record<string, string> = { CREATED: 'Case created', customerNameText: 'Customer / End User', accountId: 'Linked CRM Account', contactId: 'Contact', subject: 'Subject', description: 'Description', status: 'Status', priority: 'Priority', categoryId: 'Category', assignedToId: 'Assigned To', productSkuId: 'Product / SKU', serialNumber: 'Serial Number', source: 'Source', purchaseSourceText: 'Purchased From', purchasedFromAccountId: 'Linked Purchased-From Account', nextFollowUpAt: 'Next Follow-up', resolvedAt: 'Resolved', closedAt: 'Closed', resolutionSummary: 'Resolution Summary', archivedAt: 'Archive' };
const creationFieldOrder = ['customerNameText', 'accountId', 'contactId', 'subject', 'description', 'status', 'priority', 'categoryId', 'assignedToId', 'productSkuId', 'serialNumber', 'source', 'purchaseSourceText', 'purchasedFromAccountId', 'nextFollowUpAt', 'resolvedAt', 'closedAt', 'resolutionSummary', 'archivedAt'];
export type SupportHistoryEvent = {
  id: number; supportCaseId: number; field: string; oldValue: string | null; newValue: string | null;
  oldLabel: string | null; newLabel: string | null; actorId: number; source: string; createdAt: Date;
  actor: { firstName: string; lastName: string };
};
export type SupportHistoryItem = { kind: 'creation'; event: SupportHistoryEvent; fields: SupportHistoryEvent[] } | { kind: 'event'; event: SupportHistoryEvent };

export function supportHistoryItems(events: readonly SupportHistoryEvent[], caseCreatedAt: Date): SupportHistoryItem[] {
  const creation = events[0];
  if (!creation || creation.field !== 'CREATED' || creation.source !== 'CRM' || Math.abs(creation.createdAt.getTime() - caseCreatedAt.getTime()) > 86400000)
    return events.map(event => ({ kind: 'event', event }));
  const fields: SupportHistoryEvent[] = [];
  let previousId = creation.id;
  let previousFieldIndex = -1;
  for (const event of events.slice(1)) {
    const fieldIndex = creationFieldOrder.indexOf(event.field);
    if (event.supportCaseId !== creation.supportCaseId || event.id !== previousId + 1 ||
        event.createdAt.getTime() !== creation.createdAt.getTime() || event.actorId !== creation.actorId ||
        event.source !== creation.source || event.oldValue !== null || event.newValue === null ||
        fieldIndex <= previousFieldIndex) break;
    fields.push(event);
    previousId = event.id;
    previousFieldIndex = fieldIndex;
  }
  return [{ kind: 'creation', event: creation, fields }, ...events.slice(fields.length + 1).map(event => ({ kind: 'event' as const, event }))];
}
export function supportEventValue(field: string, value: string | null, label: string | null, zone: string) {
  if (label) return label;
  if (!value) return '—';
  if (field.endsWith('Id')) return 'Unavailable';
  if (field === 'status') return supportStatusLabels[value as keyof typeof supportStatusLabels] ?? 'Unknown';
  if (field === 'priority') return supportPriorityLabels[value as keyof typeof supportPriorityLabels] ?? 'Unknown';
  if (field === 'source') return supportSourceLabels[value as keyof typeof supportSourceLabels] ?? 'Unknown';
  if (['nextFollowUpAt', 'resolvedAt', 'closedAt', 'archivedAt'].includes(field)) return formatDateTimeForUser(new Date(value), zone);
  return value;
}
