import type { PrismaClient } from '@prisma/client';
import { supportCaseReadWhere } from './support-cases';
import type { Actor } from './authorization';
import { supportGmailEnabled } from './support-gmail';

const include = { assignedTo: { select: { firstName: true, lastName: true } }, productSku: { select: { partNumber: true } }, account: { select: { name: true } } } as const;
const openStatuses = ['NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL'] as const;
export async function accountSupportSummary(db: PrismaClient, actor: Actor, accountId: number) {
  const visible = supportCaseReadWhere(actor);
  const base = { ...visible, accountId };
  const [open, high, resolved, openCount, recentEmails] = await Promise.all([
    db.supportCase.findMany({ where: { ...base, status: { in: [...openStatuses] } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 10, include }),
    db.supportCase.findMany({ where: { ...base, priority: { in: ['HIGH','CRITICAL'] }, status: { in: [...openStatuses] } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 10, include }),
    db.supportCase.findMany({ where: { ...base, status: 'RESOLVED' }, orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }], take: 10, include }),
    db.supportCase.count({ where: { ...base, status: { in: [...openStatuses] } } }),
    supportGmailEnabled() ? db.supportCaseEmail.findMany({ where: { supportCase: { ...visible, accountId } }, orderBy: [{ messageDate: 'desc' }, { id: 'desc' }], take: 30, select: { id: true, senderEmail: true, subject: true, bodyText: true, messageDate: true, supportCase: { select: { id: true, caseNumber: true, status: true } } } }) : Promise.resolve([]),
  ]);
  const perCase = new Map<number, number>();
  const emails = recentEmails.filter(row => { const count = perCase.get(row.supportCase.id) ?? 0; if (count >= 3) return false; perCase.set(row.supportCase.id, count + 1); return true; }).slice(0, 10);
  return { open, high, resolved, openCount, emails };
}
export async function contactSupportSummary(db: PrismaClient, actor: Actor, contactId: number) {
  const base = { ...supportCaseReadWhere(actor), contactId };
  const [open, recent, openCount] = await Promise.all([
    db.supportCase.findMany({ where: { ...base, status: { in: [...openStatuses] } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 10, include }),
    db.supportCase.findMany({ where: base, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 10, include }),
    db.supportCase.count({ where: { ...base, status: { in: [...openStatuses] } } }),
  ]);
  const rows = [...new Map([...open, ...recent].map(row => [row.id, row])).values()].sort((a,b) => b.openedAt.getTime()-a.openedAt.getTime()).slice(0,20);
  return { rows, openCount };
}
