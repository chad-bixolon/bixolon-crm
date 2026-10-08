import type { PrismaClient } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { supportCaseReadWhere } from './support-cases';

export function canCreateCaseWork(actor: Actor) {
  return can(actor, 'tasks.write') || can(actor, 'support-work.write');
}

export function assertWorkPermission(actor: Actor, supportCaseId: number | null) {
  if (can(actor, 'tasks.write')) return;
  if (supportCaseId && can(actor, 'support-work.write')) return;
  assertPermission(actor, 'tasks.write');
}

export async function caseWorkContext(db: PrismaClient, actor: Actor, supportCaseId: number, accountId?: number | null, contactIds: number[] = [], allowHistorical = false) {
  if (!Number.isSafeInteger(supportCaseId) || supportCaseId < 1) throw new Error('Choose a valid Support Case.');
  const row = await db.supportCase.findFirst({ where: { id: supportCaseId, ...supportCaseReadWhere(actor, allowHistorical) }, select: { id: true, caseNumber: true, subject: true, accountId: true, contactId: true, status: true, archivedAt: true, account: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } } });
  if (!row) throw new Error('Support Case not found or unavailable.');
  if (!allowHistorical && (row.archivedAt || row.status === 'CLOSED')) throw new Error('Reopen or restore the Support Case before adding work.');
  if (accountId !== undefined && row.accountId !== accountId) throw new Error('Support Case Account does not match the selected Account.');
  if (contactIds.length) {
    const contacts = await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, accountId: true } });
    if (contacts.length !== new Set(contactIds).size || contacts.some(contact => !contactIds.includes(contact.id) || (contact.accountId !== null && contact.accountId !== row.accountId))) throw new Error('Contact does not belong to the Support Case Account.');
  }
  return row;
}
