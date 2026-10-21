import type { Prisma, PrismaClient } from '@prisma/client';
import { operationalTaskWhere, operationalActivityWhere } from './operational-where';
import { archivedWhere, recordVisibility } from './record-visibility';
import { detailPage } from './detail-pagination';

export type RelatedWorkOptions = { accountId?: number; opportunityId?: number; projectId?: number; kind: 'tasks' | 'activities' | 'notes'; visibility?: string; page?: string };
const person = { firstName: true, lastName: true } as const;
const context = { id: true, name: true } as const;
export const relatedTaskSelect = { id: true, subject: true, status: true, priority: true, dueDate: true, archivedAt: true } as const satisfies Prisma.TaskSelect;
export const relatedActivitySelect = {
  id: true, subject: true, activityDate: true, direction: true, archivedAt: true,
  description: true, outcome: true, nextStep: true, followUpDate: true,
  activityType: { select: { name: true } }, user: { select: person },
  contacts: { select: { contact: { select: { ...person, archivedAt: true, active: true } } } },
  account: { select: context }, opportunity: { select: context }, project: { select: context },
  supportCase: { select: { id: true, caseNumber: true } }, calendarReview: { select: { eventId: true } },
} as const satisfies Prisma.ActivitySelect;
export const relatedNoteSelect = { id: true, body: true, createdAt: true, archivedAt: true, createdBy: { select: person } } as const satisfies Prisma.NoteSelect;
export type RelatedTask = Prisma.TaskGetPayload<{ select: typeof relatedTaskSelect }>;
export type RelatedActivity = Prisma.ActivityGetPayload<{ select: typeof relatedActivitySelect }>;
export type RelatedNote = Prisma.NoteGetPayload<{ select: typeof relatedNoteSelect }>;

export async function loadRelatedWork(db: PrismaClient, options: RelatedWorkOptions) {
  const { accountId, opportunityId, projectId, kind } = options;
  const visibility = recordVisibility(options.visibility);
  const where = { ...archivedWhere(visibility), ...(accountId ? { accountId } : {}), ...(opportunityId ? { opportunityId } : {}),
    ...(projectId ? { OR: [{ projectId }, { opportunity: { projects: { some: { projectId } } } }] } : {}) };
  const taskWhere = { ...where, ...(visibility === 'active' ? { AND: [operationalTaskWhere] } : {}) };
  const activityWhere = { ...where, ...(visibility === 'active' ? { AND: [operationalActivityWhere] } : {}) };
  // Bound Account history; other parents retain their current navigation contract.
  const total = accountId ? await (kind === 'tasks' ? db.task.count({ where: taskWhere }) : kind === 'activities' ? db.activity.count({ where: activityWhere }) : db.note.count({ where })) : 0;
  const pagination = accountId ? detailPage(total, options.page) : null;
  const bounds: { skip?: number; take?: number } = pagination ? { skip: pagination.skip, take: pagination.take } : {};
  const rows = kind === 'tasks' ? await db.task.findMany({ where: taskWhere, select: relatedTaskSelect, orderBy: [{ dueDate: 'asc' }, { id: 'desc' }], ...bounds })
    : kind === 'activities' ? await db.activity.findMany({ where: activityWhere, select: relatedActivitySelect, orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], ...bounds })
    : await db.note.findMany({ where, select: relatedNoteSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...bounds });
  return { rows, pagination, total: pagination?.total ?? rows.length };
}
