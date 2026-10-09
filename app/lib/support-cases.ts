import { Prisma, SupportCasePriority, SupportCaseSource, SupportCaseStatus, type PrismaClient } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { eligibleUserWhere } from './assignment-eligibility';
import { notifySupportEvent, syncSupportNotifications } from './support-notifications';

export const supportStatusLabels: Record<SupportCaseStatus, string> = {
  NEW: 'New', OPEN: 'Open', WAITING_ON_CUSTOMER: 'Waiting on Customer',
  WAITING_ON_INTERNAL: 'Waiting on Internal', RESOLVED: 'Resolved', CLOSED: 'Closed',
};
export const supportPriorityLabels: Record<SupportCasePriority, string> = {
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', CRITICAL: 'Critical',
};
export const supportSourceLabels: Record<SupportCaseSource, string> = {
  PHONE: 'Phone', EMAIL: 'Email', WEB: 'Web', INTERNAL_REFERRAL: 'Internal Referral', OTHER: 'Other',
};
const transitions: Record<SupportCaseStatus, readonly SupportCaseStatus[]> = {
  NEW: ['OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL', 'RESOLVED', 'CLOSED'],
  OPEN: ['WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL', 'RESOLVED', 'CLOSED'],
  WAITING_ON_CUSTOMER: ['OPEN', 'WAITING_ON_INTERNAL', 'RESOLVED', 'CLOSED'],
  WAITING_ON_INTERNAL: ['OPEN', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};
export function validSupportTransition(from: SupportCaseStatus, to: SupportCaseStatus) {
  return from === to || transitions[from].includes(to);
}
export function supportCaseReadWhere(actor: Actor, includeArchived = false): Prisma.SupportCaseWhereInput {
  assertPermission(actor, 'support-cases.read');
  assertPermission(actor, 'accounts.read');
  const scope = can(actor, 'support-cases.write') ? {} : { accountId: { not: null } };
  return includeArchived ? scope : { ...scope, archivedAt: null };
}
export type SupportCaseInput = {
  customerNameText?: string | null; accountId?: number | null; contactId?: number | null; subject: string; description: string;
  purchaseSourceText?: string | null; purchasedFromAccountId?: number | null;
  priority?: SupportCasePriority; categoryId?: number | null; assignedToId?: number | null;
  productSkuId?: number | null; serialNumber?: string | null; source: SupportCaseSource;
  nextFollowUpAt?: Date | null; resolutionSummary?: string | null;
  status?: SupportCaseStatus;
};
export type SupportCasePatch = Partial<SupportCaseInput>;
const writableFields = ['customerNameText', 'accountId', 'contactId', 'subject', 'description', 'purchaseSourceText', 'purchasedFromAccountId', 'priority', 'categoryId', 'assignedToId', 'productSkuId', 'serialNumber', 'source', 'nextFollowUpAt', 'resolutionSummary', 'status'] as const;
function cleanPatch(patch: SupportCasePatch): SupportCasePatch {
  return Object.fromEntries(writableFields.filter(key => Object.prototype.hasOwnProperty.call(patch, key)).map(key => [key, (key === 'purchaseSourceText' || key === 'customerNameText') && patch[key] != null ? patch[key].trim() || null : patch[key]])) as SupportCasePatch;
}
function id(value: number | null | undefined, field: string) {
  if (value != null && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`Invalid ${field}.`);
}
function text(value: string, field: string, max: number) {
  if (!value.trim() || value.length > max) throw new Error(`Invalid ${field}.`);
}
function optionalText(value: string | null | undefined, field: string, max: number) {
  if (value != null && value.length > max) throw new Error(`Invalid ${field}.`);
}
function date(value: Date | null | undefined, field: string) {
  if (value != null && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) throw new Error(`Invalid ${field}.`);
}
async function validateReferences(tx: Prisma.TransactionClient, data: SupportCasePatch, current?: { accountId: number | null; contactId: number | null; categoryId: number | null; assignedToId: number | null; productSkuId: number | null; purchasedFromAccountId: number | null }) {
  if (data.accountId !== undefined) {
    id(data.accountId, 'Account');
    if (data.accountId != null && data.accountId !== current?.accountId && !await tx.account.findFirst({ where: { id: data.accountId, archivedAt: null, status: 'ACTIVE' }, select: { id: true } })) throw new Error('Choose an active Account.');
  }
  const accountId = data.accountId ?? current?.accountId;
  if (data.purchasedFromAccountId !== undefined) {
    id(data.purchasedFromAccountId, 'purchased-from Account');
    if (data.purchasedFromAccountId != null && data.purchasedFromAccountId !== current?.purchasedFromAccountId && !await tx.account.findFirst({ where: { id: data.purchasedFromAccountId, archivedAt: null, status: 'ACTIVE' }, select: { id: true } })) throw new Error('Choose an active purchased-from Account.');
  }
  if (data.contactId !== undefined || data.accountId !== undefined) {
    const contactId = data.contactId !== undefined ? data.contactId : current?.contactId;
    id(contactId, 'Contact');
    if (contactId != null && (!accountId || !await tx.contact.findFirst({ where: { id: contactId, accountId, archivedAt: null, active: true }, select: { id: true } }))) throw new Error('Choose an active Contact on this Account.');
  }
  if (data.categoryId !== undefined) {
    id(data.categoryId, 'category');
    if (data.categoryId != null && data.categoryId !== current?.categoryId && !await tx.supportCaseCategory.findFirst({ where: { id: data.categoryId, active: true } })) throw new Error('Choose an active category.');
  }
  if (data.assignedToId !== undefined) {
    id(data.assignedToId, 'assignee');
    if (data.assignedToId != null && data.assignedToId !== current?.assignedToId && !await tx.user.findFirst({ where: { id: data.assignedToId, ...eligibleUserWhere('support-cases.write') }, select: { id: true } })) throw new Error('Select an eligible Support Rep.');
  }
  if (data.productSkuId !== undefined) {
    id(data.productSkuId, 'Product/SKU');
    if (data.productSkuId != null && data.productSkuId !== current?.productSkuId && !await tx.productSku.findFirst({ where: { id: data.productSkuId, active: true }, select: { id: true } })) throw new Error('Choose an active Product/SKU.');
  }
}
function validateFields(data: SupportCasePatch) {
  if (data.subject !== undefined) text(data.subject, 'subject', 300);
  if (data.description !== undefined) text(data.description, 'description', 20000);
  if (data.priority !== undefined && !Object.values(SupportCasePriority).includes(data.priority)) throw new Error('Invalid priority.');
  if (data.source !== undefined && !Object.values(SupportCaseSource).includes(data.source)) throw new Error('Invalid source.');
  if (data.status !== undefined && !Object.values(SupportCaseStatus).includes(data.status)) throw new Error('Invalid status.');
  optionalText(data.serialNumber, 'serial number', 300);
  optionalText(data.customerNameText, 'Customer / End User', 500);
  optionalText(data.purchaseSourceText, 'Purchased From', 500);
  optionalText(data.resolutionSummary, 'resolution summary', 20000);
  date(data.nextFollowUpAt, 'next follow-up date');
}
function validateResolution(status: SupportCaseStatus, summary: string | null | undefined) {
  if ((status === 'RESOLVED' || status === 'CLOSED') && !summary?.trim()) {
    throw new Error('Resolution Summary is required when resolving or closing a Support Case.');
  }
}
function auditValue(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
const auditFields = ['customerNameText', 'accountId', 'contactId', 'subject', 'description', 'status', 'priority', 'categoryId', 'assignedToId', 'productSkuId', 'serialNumber', 'source', 'purchaseSourceText', 'purchasedFromAccountId', 'nextFollowUpAt', 'resolvedAt', 'closedAt', 'resolutionSummary', 'archivedAt'] as const;
async function labels(tx: Prisma.TransactionClient, field: string, values: (number | null)[]) {
  const ids = values.filter((value): value is number => value != null);
  if (!ids.length) return [null, null] as const;
  if (field === 'accountId' || field === 'purchasedFromAccountId') { const rows = await tx.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }); return values.map(v => rows.find(r => r.id === v)?.name ?? null); }
  if (field === 'contactId') { const rows = await tx.contact.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }); return values.map(v => { const r = rows.find(r => r.id === v); return r ? `${r.firstName} ${r.lastName}` : null; }); }
  if (field === 'assignedToId') { const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }); return values.map(v => { const r = rows.find(r => r.id === v); return r ? `${r.firstName} ${r.lastName}` : null; }); }
  if (field === 'categoryId') { const rows = await tx.supportCaseCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }); return values.map(v => rows.find(r => r.id === v)?.name ?? null); }
  if (field === 'productSkuId') { const rows = await tx.productSku.findMany({ where: { id: { in: ids } }, select: { id: true, partNumber: true } }); return values.map(v => rows.find(r => r.id === v)?.partNumber ?? null); }
  return [null, null];
}
async function appendChanges(tx: Prisma.TransactionClient, caseId: number, actorId: number, before: Record<string, unknown> | null, after: Record<string, unknown>, source = 'CRM') {
  const events = [];
  for (const field of auditFields) {
    const oldValue = before ? auditValue(before[field]) : null;
    const newValue = auditValue(after[field]);
    if (before && oldValue === newValue) continue;
    if (!before && newValue === null) continue;
    const [oldLabel, newLabel] = field.endsWith('Id') ? await labels(tx, field, [(before?.[field] as number | null) ?? null, (after[field] as number | null) ?? null]) : [null, null];
    events.push({ supportCaseId: caseId, field, oldValue, newValue, oldLabel, newLabel, actorId, source });
  }
  if (!before) events.unshift({ supportCaseId: caseId, field: 'CREATED', oldValue: null, newValue: null, oldLabel: null, newLabel: null, actorId, source });
  if (events.length) await tx.supportCaseLifecycleEvent.createMany({ data: events });
  const stored = events.length ? await tx.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId }, orderBy: { id: 'desc' }, take: events.length, select: { id: true, field: true } }) : [];
  return new Map(stored.map(event => [event.field, event.id]));
}
export async function createSupportCase(db: PrismaClient, actor: Actor, input: SupportCaseInput) {
  assertPermission(actor, 'support-cases.write');
  assertPermission(actor, 'accounts.read');
  const clean = cleanPatch(input);
  input = clean as SupportCaseInput;
  validateFields(input);
  const status = input.status ?? 'NEW';
  validateResolution(status, input.resolutionSummary);
  id(input.accountId, 'Account');
  if (!input.customerNameText && !input.accountId) throw new Error('Enter a customer/end user or link a CRM Account.');
  if (!input.subject || !input.description || !input.source) throw new Error('Subject, description, and source are required.');
  return db.$transaction(async tx => {
    await validateReferences(tx, input);
    const openedAt = new Date();
    const year = openedAt.getUTCFullYear();
    const rows = await tx.$queryRaw<{ lastNumber: number }[]>`INSERT INTO "SupportCaseNumberCounter" ("year", "lastNumber") VALUES (${year}, 1) ON CONFLICT ("year") DO UPDATE SET "lastNumber" = "SupportCaseNumberCounter"."lastNumber" + 1 RETURNING "lastNumber"`;
    const caseNumber = `BXS-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;
    const row = await tx.supportCase.create({ data: { ...input, status, priority: input.priority ?? 'NORMAL', nextFollowUpAt: status === 'RESOLVED' || status === 'CLOSED' ? null : input.nextFollowUpAt, resolvedAt: status === 'RESOLVED' ? openedAt : null, closedAt: status === 'CLOSED' ? openedAt : null, caseNumber, openedAt, createdById: actor.id, updatedById: actor.id } });
    const events = await appendChanges(tx, row.id, actor.id, null, row as unknown as Record<string, unknown>);
    if (row.assignedToId && status !== 'RESOLVED' && status !== 'CLOSED') await notifySupportEvent(tx, row.id, row.assignedToId, events.get(row.priority === 'CRITICAL' ? 'priority' : 'assignedToId') ?? 0, row.priority === 'CRITICAL' ? 'CRITICAL' : 'ASSIGNED', row.caseNumber);
    await syncSupportNotifications(tx, row.id, openedAt);
    return row;
  });
}
export async function updateSupportCase(db: PrismaClient, actor: Actor, caseId: number, patch: SupportCasePatch) {
  assertPermission(actor, 'support-cases.write');
  assertPermission(actor, 'accounts.read');
  id(caseId, 'case');
  patch = cleanPatch(patch);
  validateFields(patch);
  return db.$transaction(async tx => {
    // Serialize edits to a case so the audit comparison sees the committed predecessor.
    await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id = ${caseId} FOR UPDATE`;
    const before = await tx.supportCase.findUnique({ where: { id: caseId } });
    if (!before) throw new Error('Case not found.');
    if (before.archivedAt) throw new Error('Restore the case before editing.');
    if (!(patch.customerNameText === undefined ? before.customerNameText : patch.customerNameText) && !(patch.accountId === undefined ? before.accountId : patch.accountId)) throw new Error('Enter a customer/end user or link a CRM Account.');
    if (patch.status !== undefined && !validSupportTransition(before.status, patch.status)) throw new Error('Invalid status transition.');
    validateResolution(patch.status ?? before.status, patch.resolutionSummary === undefined ? before.resolutionSummary : patch.resolutionSummary);
    await validateReferences(tx, patch, before);
    const next = { ...patch } as SupportCasePatch & { resolvedAt?: Date | null; closedAt?: Date | null };
    if (patch.status && patch.status !== before.status) {
      if (patch.status === 'RESOLVED') next.resolvedAt = new Date();
      else if (patch.status === 'CLOSED') next.closedAt = new Date();
      else { next.resolvedAt = null; next.closedAt = null; }
    }
    const changed = Object.entries(next).some(([key, value]) => auditValue(value) !== auditValue((before as unknown as Record<string, unknown>)[key]));
    if (!changed) return before;
    const after = await tx.supportCase.update({ where: { id: caseId }, data: { ...next, updatedById: actor.id } });
    const events = await appendChanges(tx, caseId, actor.id, before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    const critical = after.priority === 'CRITICAL' && (before.priority !== 'CRITICAL' || before.assignedToId !== after.assignedToId);
    if (critical) await notifySupportEvent(tx, caseId, after.assignedToId, events.get(before.priority !== 'CRITICAL' ? 'priority' : 'assignedToId') ?? 0, 'CRITICAL', after.caseNumber);
    else if (after.assignedToId && before.assignedToId !== after.assignedToId) await notifySupportEvent(tx, caseId, after.assignedToId, events.get('assignedToId') ?? 0, 'ASSIGNED', after.caseNumber);
    if (['RESOLVED','CLOSED'].includes(before.status) && ['NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL'].includes(after.status)) await notifySupportEvent(tx, caseId, after.assignedToId, events.get('status') ?? 0, 'REOPENED', after.caseNumber);
    await syncSupportNotifications(tx, caseId);
    return after;
  });
}
export function changeSupportCaseStatus(db: PrismaClient, actor: Actor, caseId: number, status: SupportCaseStatus, resolutionSummary?: string | null) {
  return updateSupportCase(db, actor, caseId, { status, ...(resolutionSummary === undefined ? {} : { resolutionSummary }) });
}
async function setArchived(db: PrismaClient, actor: Actor, caseId: number, archived: boolean) {
  assertPermission(actor, 'support-cases.write');
  id(caseId, 'case');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id = ${caseId} FOR UPDATE`;
    const before = await tx.supportCase.findUnique({ where: { id: caseId } });
    if (!before) throw new Error('Case not found.');
    if (Boolean(before.archivedAt) === archived) return before;
    const after = await tx.supportCase.update({ where: { id: caseId }, data: { archivedAt: archived ? new Date() : null, updatedById: actor.id } });
    await appendChanges(tx, caseId, actor.id, before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, archived ? 'ARCHIVE' : 'RESTORE');
    await syncSupportNotifications(tx, caseId);
    return after;
  });
}
export const archiveSupportCase = (db: PrismaClient, actor: Actor, caseId: number) => setArchived(db, actor, caseId, true);
export const restoreSupportCase = (db: PrismaClient, actor: Actor, caseId: number) => setArchived(db, actor, caseId, false);
export async function getSupportCaseById(db: PrismaClient, actor: Actor, caseId: number, includeArchived = false) {
  id(caseId, 'case');
  return db.supportCase.findFirst({ where: { id: caseId, ...supportCaseReadWhere(actor, includeArchived) }, include: { account: true, purchasedFromAccount: { select: { id: true, name: true, archivedAt: true, status: true } }, contact: true, category: true, assignedTo: true, productSku: true, events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 80, include: { actor: { select: { firstName: true, lastName: true } } } } } });
}
export type SupportCaseListOptions = { page?: number; archive?: 'active' | 'archived' | 'all'; includeArchived?: boolean; accountId?: number; assignedToId?: number; status?: SupportCaseStatus; priority?: SupportCasePriority; categoryId?: number; productSkuId?: number; product?: string; account?: string; openedFrom?: Date; openedTo?: Date; search?: string; sort?: 'current' | 'newest' | 'oldest' | 'priority' | 'follow-up' | 'number' | 'updated' };
export function supportCaseListWhere(actor: Actor, options: SupportCaseListOptions = {}): Prisma.SupportCaseWhereInput {
  const where: Prisma.SupportCaseWhereInput = { ...supportCaseReadWhere(actor, options.archive === 'all' || options.archive === 'archived' || options.includeArchived), ...(options.accountId ? { accountId: options.accountId } : {}), ...(options.assignedToId ? { assignedToId: options.assignedToId } : {}), ...(options.status ? { status: options.status } : {}), ...(options.priority ? { priority: options.priority } : {}), ...(options.categoryId ? { categoryId: options.categoryId } : {}), ...(options.productSkuId ? { productSkuId: options.productSkuId } : {}) };
  if (options.accountId !== undefined) id(options.accountId, 'Account');
  if (options.assignedToId !== undefined) id(options.assignedToId, 'assignee');
  if (options.categoryId !== undefined) id(options.categoryId, 'category');
  if (options.productSkuId !== undefined) id(options.productSkuId, 'Product/SKU');
  if (options.status !== undefined && !Object.values(SupportCaseStatus).includes(options.status)) throw new Error('Invalid status.');
  if (options.priority !== undefined && !Object.values(SupportCasePriority).includes(options.priority)) throw new Error('Invalid priority.');
  if (options.archive === 'archived') where.archivedAt = { not: null };
  if (options.account?.trim()) where.account = { name: { contains: options.account.trim().slice(0, 100), mode: 'insensitive' } };
  if (options.product?.trim()) where.productSku = { partNumber: { contains: options.product.trim().slice(0, 100), mode: 'insensitive' } };
  if (options.openedFrom || options.openedTo) where.openedAt = { ...(options.openedFrom ? { gte: options.openedFrom } : {}), ...(options.openedTo ? { lt: options.openedTo } : {}) };
  const q = options.search?.trim().slice(0, 100);
  if (q && /^(BXS|SUP)-\d{4}-\d{6}$/i.test(q)) where.caseNumber = q.toUpperCase();
  else if (q) { const parts = q.split(/\s+/); where.OR = [{ caseNumber: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }, { serialNumber: { contains: q, mode: 'insensitive' } }, { customerNameText: { contains: q, mode: 'insensitive' } }, { account: { name: { contains: q, mode: 'insensitive' } } }, { contact: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, ...(parts.length > 1 ? [{ AND: [{ firstName: { contains: parts[0], mode: 'insensitive' as const } }, { lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' as const } }] }] : [])] } }]; }
  return where;
}
export function supportCaseListOrder(sort: SupportCaseListOptions['sort']): Prisma.SupportCaseOrderByWithRelationInput[] {
  const orders: Record<NonNullable<SupportCaseListOptions['sort']>, Prisma.SupportCaseOrderByWithRelationInput[]> = { current: [{ status: 'asc' }, { openedAt: 'desc' }], newest: [{ openedAt: 'desc' }], oldest: [{ openedAt: 'asc' }], priority: [{ priority: 'desc' }, { openedAt: 'desc' }], 'follow-up': [{ nextFollowUpAt: 'asc' }], number: [{ caseNumber: 'asc' }], updated: [{ updatedAt: 'desc' }] };
  return [...(orders[sort ?? 'current'] ?? orders.current), { id: 'desc' }];
}
export async function listSupportCases(db: PrismaClient, actor: Actor, options: SupportCaseListOptions = {}) {
  const where = supportCaseListWhere(actor, options);
  const count = await db.supportCase.count({ where });
  const pages = Math.max(1, Math.ceil(count / 20));
  const page = Number.isSafeInteger(options.page) ? Math.min(Math.max(options.page!, 1), pages) : 1;
  const cases = await db.supportCase.findMany({ where, take: 20, skip: (page - 1) * 20, orderBy: supportCaseListOrder(options.sort), include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } }, category: { select: { name: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } }, productSku: { select: { partNumber: true } } } });
  return { cases, count, page, pages };
}
export function canManageSupportCategories(actor: Actor) { return can(actor, 'support-categories.manage'); }
