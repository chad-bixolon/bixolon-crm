import { Prisma, type PrismaClient, type Task, type Note, type SupportCaseAttachment, type SupportCaseEmail } from '@prisma/client';
import { supportEventFields, supportEventValue, supportHistoryItems, type SupportHistoryEvent } from './support-case-display';

export type CaseTimelineItem = {
  key: string; at: Date; source: 'Case' | 'Activity' | 'Task' | 'Note' | 'Attachment' | 'Email';
  title: string; detail?: string; fullBody?: string; summary?: { label: string; value: string }[];
  actor?: string; href?: string; noteHref?: string; unavailable?: string;
  kind?: 'Inbound Email' | 'Email Response Logged';
};
export type CaseHistoryView = { timeline: CaseTimelineItem[]; auditEvents: SupportHistoryEvent[]; auditTruncated: boolean };
const LIMIT_PER_WORK_SOURCE = 40;
const LIMIT_AUDIT = 80;
const LIMIT_TIMELINE = 80;
const LIMIT_INITIAL = 24;
const activeStatuses = new Set(['NEW', 'OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL']);
const actorName = (event: SupportHistoryEvent) => `${event.actor.firstName} ${event.actor.lastName}`;
const preview = (value: string, length = 180) => value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;

type TimelineActivity = {
  id: number; activityDate: Date; subject: string; description: string | null;
  type?: string; direction?: string; emailRecipientName?: string | null; emailRecipientEmail?: string | null;
  activityType: { name: string }; user: { firstName: string; lastName: string } | null;
  contacts: { contact: { firstName: string; lastName: string } }[];
};
export function supportActivityTimelineItem(row: TimelineActivity): CaseTimelineItem {
  const actor = row.user ? `${row.user.firstName} ${row.user.lastName}` : undefined;
  const contacts = row.contacts.map(link => `${link.contact.firstName} ${link.contact.lastName}`).join(', ');
  if (row.type === 'EMAIL' && row.direction === 'OUTBOUND') {
    const recipient = row.emailRecipientName || contacts || row.emailRecipientEmail;
    return { key: `activity-${row.id}`, at: row.activityDate, source: 'Activity', kind: 'Email Response Logged', title: 'Email Response Logged', actor: [actor, recipient].filter(Boolean).join(' → '), detail: row.description ? row.emailRecipientEmail ? row.description : preview(row.description, 240) : undefined, href: row.emailRecipientEmail ? undefined : `/activities/${row.id}`,
      summary: [{ label: 'Subject', value: row.subject }, ...(row.emailRecipientEmail ? [{ label: 'To', value: row.emailRecipientEmail }] : [])] };
  }
  return { key: `activity-${row.id}`, at: row.activityDate, source: 'Activity', title: `${row.activityType.name} logged`, detail: [row.subject, row.description && preview(row.description, 240), contacts].filter(Boolean).join(' · '), actor, href: `/activities/${row.id}`, ...(row.type === 'EMAIL' && row.direction === 'INBOUND' ? { kind: 'Inbound Email' as const } : {}) };
}

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

export function classifySupportLifecycle(events: readonly SupportHistoryEvent[], caseCreatedAt: Date, zone: string, includeFieldChanges = false): CaseTimelineItem[] {
  const grouped = supportHistoryItems(events, caseCreatedAt);
  const creation = grouped.find(item => item.kind === 'creation');
  const items: CaseTimelineItem[] = [];
  if (creation) items.push({ key: `history-${creation.event.id}`, at: creation.event.createdAt, source: 'Case', title: 'Case created', actor: actorName(creation.event), summary: creationSummary(creation.fields, zone) });
  for (const item of grouped) {
    if (item.kind === 'creation') continue;
    const event = item.event;
    if (['TASK_COMPLETED', 'TASK_REOPENED', 'TASK_UPDATED'].includes(event.field) && /^TASK:\d+$/.test(event.source)) {
      items.push({ key: `history-${event.id}`, at: event.createdAt, source: 'Task', title: supportEventFields[event.field], detail: event.newLabel ? preview(event.newLabel, 240) : undefined, actor: actorName(event), href: `/tasks/${event.source.slice(5)}` });
      continue;
    }
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
    if (!title && includeFieldChanges) {
      title = supportEventFields[event.field] ? `${supportEventFields[event.field]} changed` : 'Case updated';
      detail = event.field.startsWith('TASK_') ? event.newLabel ? preview(event.newLabel, 240) : undefined : supportEventFields[event.field] ? `${preview(oldValue, 240)} → ${preview(newValue, 240)}` : undefined;
    }
    if (title) items.push({ key: `history-${event.id}`, at: event.createdAt, source: 'Case', title, detail, actor: actorName(event) });
  }
  return items;
}

export async function caseHistoryView(db: PrismaClient, caseId: number, createdAt: Date, zone: string, includeEmail = false): Promise<CaseHistoryView> {
  const [recent, activities, tasks, notes, attachments, emails] = await Promise.all([
    db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_AUDIT + 1, include: { actor: { select: { firstName: true, lastName: true } } } }),
    db.activity.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { activityType: { select: { name: true } }, user: { select: { firstName: true, lastName: true } }, contacts: { include: { contact: { select: { firstName: true, lastName: true } } } } } }),
    db.task.findMany({ where: { supportCaseId: caseId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { assignedTo: { select: { firstName: true, lastName: true } } } }),
    caseNotePreviews(db, caseId),
    db.supportCaseAttachment.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE, include: { uploadedBy: { select: { firstName: true, lastName: true } }, deletedBy: { select: { firstName: true, lastName: true } } } }),
    includeEmail ? db.supportCaseEmail.findMany({ where: { supportCaseId: caseId }, orderBy: [{ messageDate: 'desc' }, { id: 'desc' }], take: LIMIT_PER_WORK_SOURCE }) : Promise.resolve([]),
  ]);
  const auditEvents = recent.slice(0, LIMIT_AUDIT) as SupportHistoryEvent[];
  const initial = auditEvents.some(event => event.field === 'CREATED') ? [] : await db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LIMIT_INITIAL, include: { actor: { select: { firstName: true, lastName: true } } } });
  const lifecycle = [...new Map([...initial, ...auditEvents].map(event => [event.id, event])).values()].sort((a, b) => a.id - b.id);
  const operational = classifySupportLifecycle(lifecycle, createdAt, zone);
  const activityItems: CaseTimelineItem[] = activities.map(supportActivityTimelineItem);
  const taskItems = tasks.flatMap(row => supportTaskTimelineItems(row, lifecycle.some(event => event.field === 'TASK_COMPLETED' && event.source === `TASK:${row.id}` && event.createdAt.getTime() === row.completedAt?.getTime())));
  const noteItems = notes.map(row => supportNoteTimelineItem(row, caseId));
  const attachmentItems = attachments.flatMap(supportAttachmentTimelineItems);
  const origin = lifecycle.find(event => event.field === 'CREATED' && event.source.startsWith('EMAIL_ORIGIN:'))?.source.slice('EMAIL_ORIGIN:'.length);
  const emailItems = emails.map(row => supportEmailTimelineItem(row, origin));
  const created = operational.find(item => item.title === 'Case created');
  const sorted = [...operational.filter(item => item !== created), ...activityItems, ...taskItems, ...noteItems, ...attachmentItems, ...emailItems].sort((a, b) => b.at.getTime() - a.at.getTime() || b.key.localeCompare(a.key));
  return { timeline: [...sorted.slice(0, LIMIT_TIMELINE - (created ? 1 : 0)), ...(created ? [created] : [])], auditEvents, auditTruncated: recent.length > LIMIT_AUDIT };
}


type Person = { firstName: string; lastName: string };
type TimelineTask = Pick<Task, 'id' | 'subject' | 'createdAt' | 'completedAt' | 'dueDate'> & { assignedTo: Person | null };
type TimelineNote = Pick<Note, 'id' | 'createdAt' | 'body'> & { createdBy: Person | null };
type TimelineAttachment = Pick<SupportCaseAttachment, 'id' | 'createdAt' | 'deletedAt' | 'originalFileName' | 'sourceGmailMessageId'> & { uploadedBy: Person; deletedBy: Person | null };

/** Project the preview in PostgreSQL: full Note bodies are loaded only on the read-only Note page. */
export function caseNotePreviews(db: Pick<Prisma.TransactionClient, '$queryRaw'>, caseId: number, ids?: number[]) {
  if (ids && !ids.length) return Promise.resolve([] as TimelineNote[]);
  return db.$queryRaw<TimelineNote[]>(Prisma.sql`SELECT n.id, n."createdAt", left(n.body, 241) AS body,
    CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('firstName', u."firstName", 'lastName', u."lastName") END AS "createdBy"
    FROM "Note" n LEFT JOIN "User" u ON u.id = n."createdById"
    WHERE n."supportCaseId" = ${caseId} AND n."archivedAt" IS NULL ${ids ? Prisma.sql`AND n.id IN (${Prisma.join(ids)})` : Prisma.empty}
    ORDER BY n."createdAt" DESC, n.id DESC LIMIT ${ids ? ids.length : LIMIT_PER_WORK_SOURCE}`);
}
export function supportNoteTimelineItem(row: TimelineNote, caseId: number): CaseTimelineItem {
  return { key: `note-${row.id}`, at: row.createdAt, source: 'Note', title: 'Note added', detail: preview(row.body, 240), actor: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : undefined, noteHref: `/support/cases/${caseId}/notes/${row.id}` };
}
export function supportTaskTimelineItems(row: TimelineTask, recordedCompletion: boolean): CaseTimelineItem[] {
  const detail = [row.subject, row.dueDate ? `Due ${row.dueDate.toISOString().slice(0, 10)}` : null, row.assignedTo ? `Assigned to ${row.assignedTo.firstName} ${row.assignedTo.lastName}` : null].filter(Boolean).join(' · ');
  return [{ key: `task-created-${row.id}`, at: row.createdAt, source: 'Task', title: 'Task created', detail, href: `/tasks/${row.id}` }, ...(row.completedAt && !recordedCompletion ? [{ key: `task-completed-${row.id}`, at: row.completedAt, source: 'Task' as const, title: 'Task completed', detail: row.subject, href: `/tasks/${row.id}` }] : [])];
}
export function supportAttachmentTimelineItems(row: TimelineAttachment): CaseTimelineItem[] {
  return [
    { key: `attachment-added-${row.id}`, at: row.createdAt, source: 'Attachment', title: row.sourceGmailMessageId ? 'Email attachment imported' : 'Attachment added', detail: row.originalFileName, actor: `${row.uploadedBy.firstName} ${row.uploadedBy.lastName}` },
    ...(row.deletedAt && row.deletedBy ? [{ key: `attachment-removed-${row.id}`, at: row.deletedAt, source: 'Attachment' as const, title: 'Attachment removed', detail: row.originalFileName, actor: `${row.deletedBy.firstName} ${row.deletedBy.lastName}` }] : []),
  ];
}
export function supportEmailTimelineItem(row: Pick<SupportCaseEmail, 'id' | 'messageDate' | 'gmailMessageId' | 'subject' | 'senderEmail' | 'bodyText'>, origin?: string): CaseTimelineItem {
  return { key: `email-${row.id}`, at: row.messageDate, source: 'Email', kind: 'Inbound Email', title: `${origin === row.gmailMessageId ? 'Case originated from email' : 'Email received'} · ${row.subject}`, detail: `${row.senderEmail} · ${preview(row.bodyText || row.subject, 240)}`, fullBody: row.bodyText };
}
