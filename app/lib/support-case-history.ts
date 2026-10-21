import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { supportCaseReadWhere } from './support-cases';
import { supportHistoryItems, type SupportHistoryEvent } from './support-case-display';
import {
  caseNotePreviews, classifySupportLifecycle, supportActivityTimelineItem,
  supportAttachmentTimelineItems, supportEmailTimelineItem, supportNoteTimelineItem,
  supportTaskTimelineItems, type CaseTimelineItem,
} from './support-case-timeline';

export const CASE_HISTORY_PAGE_SIZE = 25;
export const caseHistoryFilters = { all: 'All', notes: 'Notes', tasks: 'Tasks', changes: 'Case changes', email: 'Email activity' } as const;
export type CaseHistoryFilter = keyof typeof caseHistoryFilters;
export function caseHistoryOptions(raw: { page?: string; type?: string }) {
  const parsed = typeof raw.page === 'string' && /^[1-9]\d*$/.test(raw.page) ? Number(raw.page) : 1;
  return { page: Number.isSafeInteger(parsed) ? parsed : 1, type: typeof raw.type === 'string' && Object.hasOwn(caseHistoryFilters, raw.type) ? raw.type as CaseHistoryFilter : 'all' as const };
}
const person = { firstName: true, lastName: true } as const;
const header = { id: true, caseNumber: true, subject: true, createdAt: true, status: true, archivedAt: true } as const;
type HistoryKey = { key: string; id: number; at: Date; model: string };

/** SQL pages the union of the existing sources before any work records are hydrated. */
export function caseHistorySource(caseId: number, creationFieldIds: number[]) {
  return Prisma.sql`
    SELECT 'history-' || e.id AS key, e.id, e."createdAt" AS at, 'lifecycle'::text AS model,
      CASE WHEN e.field IN ('TASK_COMPLETED', 'TASK_REOPENED', 'TASK_UPDATED') THEN 'tasks' ELSE 'changes' END AS category
      FROM "SupportCaseLifecycleEvent" e WHERE e."supportCaseId" = ${caseId}
      ${creationFieldIds.length ? Prisma.sql`AND e.id NOT IN (${Prisma.join(creationFieldIds)})` : Prisma.empty}
    UNION ALL SELECT 'activity-' || a.id, a.id, a."activityDate", 'activity', CASE WHEN a.type = 'EMAIL' THEN 'email' ELSE 'activity' END
      FROM "Activity" a WHERE a."supportCaseId" = ${caseId} AND a."archivedAt" IS NULL
    UNION ALL SELECT 'task-created-' || t.id, t.id, t."createdAt", 'task', 'tasks'
      FROM "Task" t WHERE t."supportCaseId" = ${caseId} AND t."archivedAt" IS NULL
    UNION ALL SELECT 'task-completed-' || t.id, t.id, t."completedAt", 'task', 'tasks'
      FROM "Task" t WHERE t."supportCaseId" = ${caseId} AND t."archivedAt" IS NULL AND t."completedAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "SupportCaseLifecycleEvent" e WHERE e."supportCaseId" = t."supportCaseId"
        AND e.field = 'TASK_COMPLETED' AND e.source = 'TASK:' || t.id AND e."createdAt" = t."completedAt")
    UNION ALL SELECT 'note-' || n.id, n.id, n."createdAt", 'note', 'notes'
      FROM "Note" n WHERE n."supportCaseId" = ${caseId} AND n."archivedAt" IS NULL
    UNION ALL SELECT 'attachment-added-' || f.id, f.id, f."createdAt", 'attachment', 'attachment'
      FROM "SupportCaseAttachment" f WHERE f."supportCaseId" = ${caseId}
    UNION ALL SELECT 'attachment-removed-' || f.id, f.id, f."deletedAt", 'attachment', 'attachment'
      FROM "SupportCaseAttachment" f WHERE f."supportCaseId" = ${caseId} AND f."deletedAt" IS NOT NULL AND f."deletedByUserId" IS NOT NULL
    UNION ALL SELECT 'email-' || m.id, m.id, m."messageDate", 'email', 'email'
      FROM "SupportCaseEmail" m WHERE m."supportCaseId" = ${caseId}`;
}

export async function caseHistoryPage(db: PrismaClient, actor: Actor, caseId: number, raw: { page?: string; type?: string } = {}, zone = 'UTC') {
  const scope = supportCaseReadWhere(actor, true);
  if (!Number.isSafeInteger(caseId) || caseId < 1) return null;
  const options = caseHistoryOptions(raw);
  return db.$transaction(async tx => {
    const row = await tx.supportCase.findFirst({ where: { id: caseId, ...scope }, select: header });
    if (!row) return null;
    // The existing creation grouping inspects at most 24 rows, regardless of Case age.
    const initial = await tx.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 24, include: { actor: { select: person } } });
    const creation = supportHistoryItems(initial, row.createdAt).find(item => item.kind === 'creation');
    const source = caseHistorySource(caseId, creation?.kind === 'creation' ? creation.fields.map(event => event.id) : []);
    const condition = options.type === 'all' ? Prisma.sql`true` : Prisma.sql`category = ${options.type}`;
    const totals = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM (${source}) history WHERE ${condition}`);
    const count = Number(totals[0]?.count ?? 0), pages = Math.max(1, Math.ceil(count / CASE_HISTORY_PAGE_SIZE));
    const page = Math.min(options.page, pages);
    const keys = await tx.$queryRaw<HistoryKey[]>(Prisma.sql`SELECT key, id, at, model FROM (${source}) history WHERE ${condition}
      ORDER BY at DESC, key COLLATE "C" DESC LIMIT ${CASE_HISTORY_PAGE_SIZE} OFFSET ${(page - 1) * CASE_HISTORY_PAGE_SIZE}`);
    const ids = (model: string) => [...new Set(keys.filter(key => key.model === model).map(key => key.id))];
    const where = (model: string) => ({ supportCaseId: caseId, id: { in: ids(model) } });
    const [events, activities, tasks, notes, attachments, emails] = await Promise.all([
      ids('lifecycle').length ? tx.supportCaseLifecycleEvent.findMany({ where: where('lifecycle'), take: CASE_HISTORY_PAGE_SIZE, include: { actor: { select: person } } }) : [],
      ids('activity').length ? tx.activity.findMany({ where: where('activity'), take: CASE_HISTORY_PAGE_SIZE, select: { id: true, activityDate: true, subject: true, description: true, type: true, direction: true, emailRecipientName: true, emailRecipientEmail: true, activityType: { select: { name: true } }, user: { select: person }, contacts: { select: { contact: { select: person } } } } }) : [],
      ids('task').length ? tx.task.findMany({ where: where('task'), take: CASE_HISTORY_PAGE_SIZE, select: { id: true, subject: true, createdAt: true, completedAt: true, dueDate: true, assignedTo: { select: person } } }) : [],
      caseNotePreviews(tx, caseId, ids('note')),
      ids('attachment').length ? tx.supportCaseAttachment.findMany({ where: where('attachment'), take: CASE_HISTORY_PAGE_SIZE, select: { id: true, createdAt: true, deletedAt: true, originalFileName: true, sourceGmailMessageId: true, uploadedBy: { select: person }, deletedBy: { select: person } } }) : [],
      ids('email').length ? tx.supportCaseEmail.findMany({ where: where('email'), take: CASE_HISTORY_PAGE_SIZE, select: { id: true, messageDate: true, gmailMessageId: true, subject: true, senderEmail: true, bodyText: true } }) : [],
    ]);
    const lifecycle = [...new Map([...(creation && keys.some(key => key.id === creation.event.id && key.model === 'lifecycle') ? initial : []), ...events].map(event => [event.id, event])).values()].sort((a, b) => a.id - b.id) as SupportHistoryEvent[];
    const origin = initial.find(event => event.field === 'CREATED' && event.source.startsWith('EMAIL_ORIGIN:'))?.source.slice('EMAIL_ORIGIN:'.length);
    const candidates = [
      ...classifySupportLifecycle(lifecycle, row.createdAt, zone, true),
      ...activities.map(supportActivityTimelineItem),
      ...tasks.flatMap(task => supportTaskTimelineItems(task, false)),
      ...notes.map(note => supportNoteTimelineItem(note, caseId)),
      ...attachments.flatMap(file => supportAttachmentTimelineItems(file).map(item => ({ ...item, ...(file.deletedAt ? { unavailable: 'Attachment unavailable' } : { href: `/api/support/attachments/${file.id}/download` }) }))),
      ...emails.map(email => supportEmailTimelineItem(email, origin)),
    ];
    const byKey = new Map(candidates.map(item => [item.key, item]));
    const items = keys.map(key => byKey.get(key.key) ?? { key: key.key, at: key.at, source: 'Case' as const, title: 'History entry unavailable' });
    // Resolve historical Task references in one batch; deleted/moved Tasks have no dead link.
    const taskIds = [...new Set(items.flatMap(item => item.href?.match(/^\/tasks\/(\d+)$/)?.slice(1).map(Number) ?? []))];
    const readableTasks = taskIds.length && (can(actor, 'tasks.read') || can(actor, 'support-work.write'))
      ? await tx.task.findMany({ where: { id: { in: taskIds }, supportCaseId: caseId }, take: CASE_HISTORY_PAGE_SIZE, select: { id: true } }) : [];
    const available = new Set(readableTasks.map(task => task.id));
    const safeItems: CaseTimelineItem[] = items.map(item => {
      const taskId = Number(item.href?.match(/^\/tasks\/(\d+)$/)?.[1]);
      return taskId && !available.has(taskId) ? { ...item, href: undefined, unavailable: 'Task unavailable' } : item;
    });
    return { row, items: safeItems, count, page, pages, type: options.type };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Case-scoped read permission, never the Note edit route or a client-supplied parent alone. */
export async function caseNoteForReading(db: PrismaClient, actor: Actor, caseId: number, noteId: number) {
  const scope = supportCaseReadWhere(actor, true);
  if (![caseId, noteId].every(id => Number.isSafeInteger(id) && id > 0)) return null;
  return db.note.findFirst({ where: { id: noteId, supportCaseId: caseId, archivedAt: null, supportCase: { is: scope } }, select: {
    id: true, body: true, createdAt: true, createdBy: { select: person }, supportCase: { select: header },
  } });
}
