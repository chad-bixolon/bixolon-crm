import type { PrismaClient } from '@prisma/client';
import { supportEventFields, supportEventValue, supportHistoryItems, type SupportHistoryEvent } from './support-case-display';

export type CaseTimelineItem = {
  key: string; at: Date; source: 'Case' | 'Activity' | 'Task' | 'Note';
  title: string; detail?: string; summary?: { label: string; value: string }[];
  actor?: string; href?: string;
};
export type CaseHistoryView = { timeline: CaseTimelineItem[]; auditEvents: SupportHistoryEvent[]; auditTruncated: boolean };
const LIMIT_PER_WORK_SOURCE = 40;
const LIMIT_AUDIT = 80;
const LIMIT_TIMELINE = 80;
const LIMIT_INITIAL = 24;
const activeStatuses = new Set(['NEW', 'OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL']);
const actorName = (event: SupportHistoryEvent) => `${event.actor.firstName} ${event.actor.lastName}`;
const preview = (value: string, length = 180) => value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;

function creationSummary(fields: readonly SupportHistoryEvent[], zone: string) {
  const get = (field: string) => fields.find(item => item.field === field);
  const summary: { label: string; value: string }[] = [];
  for (const field of ['customerNameText', 'accountId', 'subject', 'status', 'priority', 'productSkuId', 'description', 'resolutionSummary']) {
    const event = get(field);
    if (!event) continue;
    const value = supportEventValue(field, event.newValue, event.newLabel, zone);
    if (value !== '—') summary.push({ label: supportEventFields[field], value: ['description', 'resolutionSummary'].includes(field) ? preview(value) : value });
  }
  return summary;
}

export function classifySupportLifecycle(events: readonly SupportHistoryEvent[], caseCreatedAt: Date, zone: string): CaseTimelineItem[] {
  const grouped = supportHistoryItems(events, caseCreatedAt);
  const creation = grouped.find(item => item.kind === 'creation');
  const items: CaseTimelineItem[] = [];
  if (creation) items.push({ key: `history-${creation.event.id}`, at: creation.event.createdAt, source: 'Case', title: 'Case created', actor: actorName(creation.event), summary: creationSummary(creation.fields, zone) });
  for (const item of grouped) {
    if (item.kind === 'creation') continue;
    const event = item.event;
    if (event.field === 'CREATED') {
      items.push({ key: `history-${event.id}`, at: event.createdAt, source: 'Case', title: 'Case created', actor: actorName(event) });
      continue;
    }
    let title: string | undefined;
    let detail: string | undefined;
    const oldValue = supportEventValue(event.field, event.oldValue, event.oldLabel, zone);
    const newValue = supportEventValue(event.field, event.newValue, event.newLabel, zone);
    if (event.field === 'status') {
      if (event.newValue === 'RESOLVED') {
        title = 'Case resolved';
        const resolution = events.find(other => other.field === 'resolutionSummary' && other.id > event.id && other.actorId === event.actorId && other.createdAt.getTime() === event.createdAt.getTime())
          ?? [...events].reverse().find(other => other.field === 'resolutionSummary' && other.id < event.id);
        detail = resolution?.newValue ? `Resolution: ${preview(resolution.newValue, 300)}` : `${oldValue} → ${newValue}`;
      } else if (event.newValue === 'CLOSED') {
        title = 'Case closed';
        detail = `${oldValue} → ${newValue}`;
      } else if (activeStatuses.has(event.newValue ?? '') && ['RESOLVED', 'CLOSED'].includes(event.oldValue ?? '')) {
        title = 'Case reopened';
        detail = `${oldValue} → ${newValue}`;
      } else {
        title = 'Status changed';
        detail = `${oldValue} → ${newValue}`;
      }
    } else if (event.field === 'assignedToId') {
      title = event.oldValue ? 'Assignment changed' : `Assigned to ${newValue}`;
      detail = event.oldValue ? `${oldValue} → ${newValue}` : undefined;
    } else if (event.field === 'priority') {
      title = 'Priority changed';
      detail = `${oldValue} → ${newValue}`;
    } else if (event.field === 'archivedAt') {
      title = event.newValue ? 'Case archived' : 'Case restored';
    }
    if (title) items.push({ key: `history-${event.id}`, at: event.createdAt, source: 'Case', title, detail, actor: actorName(event) });
  }
  return items;
}

export async function caseHistoryView(db: PrismaClient, caseId: number, createdAt: Date, zone: string): Promise<CaseHistoryView> {
  const [recent, activities, tasks, notes] = await Promise.all([
    db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_AUDIT + 1, include: { actor: { select: { firstName: true, lastName: true } } } }),
    db.activity.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { activityType: { select: { name: true } }, user: { select: { firstName: true, lastName: true } }, contacts: { include: { contact: { select: { firstName: true, lastName: true } } } } } }),
    db.task.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { assignedTo: { select: { firstName: true, lastName: true } } } }),
    db.note.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { createdBy: { select: { firstName: true, lastName: true } } } }),
  ]);
  const auditEvents = recent.slice(0, LIMIT_AUDIT) as SupportHistoryEvent[];
  const initial = auditEvents.some(event => event.field === 'CREATED') ? [] : await db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LIMIT_INITIAL, include: { actor: { select: { firstName: true, lastName: true } } } });
  const lifecycle = [...new Map([...initial, ...auditEvents].map(event => [event.id, event])).values()].sort((a, b) => a.id - b.id);
  const operational = classifySupportLifecycle(lifecycle, createdAt, zone);
  const activityItems: CaseTimelineItem[] = activities.map(row => ({ key: `activity-${row.id}`, at: row.activityDate, source: 'Activity', title: `${row.activityType.name} logged`, detail: [row.subject, row.description && preview(row.description, 240), row.contacts.map(link => `${link.contact.firstName} ${link.contact.lastName}`).join(', ')].filter(Boolean).join(' · '), actor: row.user ? `${row.user.firstName} ${row.user.lastName}` : undefined, href: `/activities/${row.id}/edit` }));
  const taskItems: CaseTimelineItem[] = tasks.flatMap(row => {
    const detail = [row.subject, row.dueDate ? `Due ${row.dueDate.toISOString().slice(0, 10)}` : null, row.assignedTo ? `Assigned to ${row.assignedTo.firstName} ${row.assignedTo.lastName}` : null].filter(Boolean).join(' · ');
    return [{ key: `task-created-${row.id}`, at: row.createdAt, source: 'Task', title: 'Task created', detail, href: `/tasks/${row.id}` }, ...(row.completedAt ? [{ key: `task-completed-${row.id}`, at: row.completedAt, source: 'Task' as const, title: 'Task completed', detail: row.subject, href: `/tasks/${row.id}` }] : [])];
  });
  const noteItems: CaseTimelineItem[] = notes.map(row => ({ key: `note-${row.id}`, at: row.createdAt, source: 'Note', title: 'Note added', detail: preview(row.body, 240), actor: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : undefined }));
  const created = operational.find(item => item.title === 'Case created');
  const sorted = [...operational.filter(item => item !== created), ...activityItems, ...taskItems, ...noteItems].sort((a, b) => b.at.getTime() - a.at.getTime() || b.key.localeCompare(a.key));
  return { timeline: [...sorted.slice(0, LIMIT_TIMELINE - (created ? 1 : 0)), ...(created ? [created] : [])], auditEvents, auditTruncated: recent.length > LIMIT_AUDIT };
}
