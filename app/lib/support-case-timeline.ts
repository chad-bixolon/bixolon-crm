import type { PrismaClient } from '@prisma/client';
import { supportEventFields, supportEventValue, supportHistoryItems, type SupportHistoryEvent } from './support-case-display';

export type CaseTimelineItem = { key: string; at: Date; source: 'Case History' | 'Activity' | 'Task' | 'Note'; title: string; detail: string; actor?: string; href?: string };
const LIMIT_PER_SOURCE = 40;
const LIMIT_TOTAL = 80;
export async function caseTimeline(db: PrismaClient, caseId: number, createdAt: Date, zone: string): Promise<CaseTimelineItem[]> {
  const [events, activities, tasks, notes] = await Promise.all([
    db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_SOURCE, include: { actor: { select: { firstName: true, lastName: true } } } }),
    db.activity.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], take: LIMIT_PER_SOURCE, include: { activityType: { select: { name: true } }, user: { select: { firstName: true, lastName: true } }, contacts: { include: { contact: { select: { firstName: true, lastName: true } } } } } }),
    db.task.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_SOURCE, include: { assignedTo: { select: { firstName: true, lastName: true } } } }),
    db.note.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_SOURCE, include: { createdBy: { select: { firstName: true, lastName: true } } } }),
  ]);
  const history = supportHistoryItems([...events].reverse() as SupportHistoryEvent[], createdAt).map(item => {
    const event = item.event;
    const title = item.kind === 'creation' ? 'Case created' : event.source === 'ARCHIVE' ? 'Case archived' : event.source === 'RESTORE' ? 'Case restored' : `${supportEventFields[event.field] ?? 'Case'} changed`;
    const detail = item.kind === 'creation' ? 'Support Case opened' : event.field === 'archivedAt' ? '' : `${supportEventValue(event.field, event.oldValue, event.oldLabel, zone)} → ${supportEventValue(event.field, event.newValue, event.newLabel, zone)}`;
    return { key: `history-${event.id}`, at: event.createdAt, source: 'Case History' as const, title, detail, actor: `${event.actor.firstName} ${event.actor.lastName}` };
  });
  const activityItems = activities.map(row => ({ key: `activity-${row.id}`, at: row.activityDate, source: 'Activity' as const, title: `${row.activityType.name}: ${row.subject}`, detail: [row.description?.slice(0, 240), row.contacts.map(link => `${link.contact.firstName} ${link.contact.lastName}`).join(', ')].filter(Boolean).join(' · '), actor: row.user ? `${row.user.firstName} ${row.user.lastName}` : undefined, href: `/activities/${row.id}/edit` }));
  const taskItems = tasks.map(row => ({ key: `task-${row.id}`, at: row.createdAt, source: 'Task' as const, title: `Task created: ${row.subject}`, detail: [row.status.replaceAll('_', ' '), row.dueDate ? `Due ${row.dueDate.toISOString().slice(0,10)}` : null, row.completedAt ? `Completed ${row.completedAt.toISOString().slice(0,10)}` : null, row.assignedTo ? `Assigned to ${row.assignedTo.firstName} ${row.assignedTo.lastName}` : 'Unassigned'].filter(Boolean).join(' · '), href: `/tasks/${row.id}` }));
  const noteItems = notes.map(row => ({ key: `note-${row.id}`, at: row.createdAt, source: 'Note' as const, title: 'Note', detail: row.body.slice(0, 500), actor: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : undefined }));
  return [...history, ...activityItems, ...taskItems, ...noteItems].sort((a,b) => b.at.getTime()-a.at.getTime() || a.key.localeCompare(b.key)).slice(0, LIMIT_TOTAL);
}
