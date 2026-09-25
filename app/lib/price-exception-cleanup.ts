import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';

import type { CleanupIssue, CleanupRequest } from './price-exception-cleanup-shared';
export { cleanupIssues, cleanupIssueKeys } from './price-exception-cleanup-shared';
export type { CleanupAction, CleanupIssue, CleanupRequest } from './price-exception-cleanup-shared';
type AccountRef = { status: string; archivedAt: Date | null; ownerId?: number | null } | null;
export type CleanupRecord = {
  id: number; peCode: string | null; sourceType: string; status: string; archivedAt: Date | null;
  assignedSalesRepUserId: number | null; effectiveDate: Date | null; expirationDate: Date | null;
  distributorAccountId: number | null; varAccountId: number | null; endUserAccountId: number | null;
  distributorSourceName: string | null; varSourceName: string | null; endUserSourceName: string | null;
  distributorAccount: AccountRef; varAccount: AccountRef; endUserAccount: AccountRef;
  lines: { productSkuId: number | null; sourceSku: string | null }[];
};
export function utcToday(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
const filled = (value: string | null) => !!value?.trim();
export function classifyPriceException(row: CleanupRecord, duplicateCodes: ReadonlySet<string>, today = utcToday()): CleanupIssue[] {
  const issues: CleanupIssue[] = [];
  const accounts = [row.distributorAccount, row.varAccount, row.endUserAccount];
  const ids = [row.distributorAccountId, row.varAccountId, row.endUserAccountId];
  const names = [row.distributorSourceName, row.varSourceName, row.endUserSourceName];
  if (row.assignedSalesRepUserId === null) issues.push('missingOwner');
  if (ids.every(id => id === null) || ids.some((id, index) => id === null && filled(names[index]))) issues.push('missingAccount');
  if (accounts.some(account => account && (account.status !== 'ACTIVE' || !!account.archivedAt))) issues.push('inactiveAccount');
  if (row.status === 'EXPIRED' || row.expirationDate && row.expirationDate < today) issues.push('expired');
  if (row.status === 'ACTIVE' && row.expirationDate && row.expirationDate < today) issues.push('activePastExpiration');
  if (row.status === 'ARCHIVED' || row.archivedAt) issues.push('archived');
  if (ids.every(id => id === null) && names.every(name => !filled(name))) issues.push('incompleteCustomer');
  if (!row.lines.length || row.lines.some(line => line.productSkuId === null)) issues.push('missingSku');
  if (row.sourceType === 'LEGACY_WORKBOOK' && row.assignedSalesRepUserId === null) issues.push('legacyUnassigned');
  if (row.peCode && duplicateCodes.has(row.peCode.trim().toLowerCase())) issues.push('possibleDuplicate');
  if (row.effectiveDate && row.expirationDate && row.effectiveDate > row.expirationDate ||
    row.status === 'EXPIRED' && (!row.expirationDate || row.expirationDate >= today) ||
    row.status === 'ACTIVE' && !!row.expirationDate && row.expirationDate < today ||
    row.status === 'ARCHIVED' !== !!row.archivedAt) issues.push('inconsistentStatus');
  return issues;
}
export function duplicatePeCodes(rows: Pick<CleanupRecord, 'peCode'>[]) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.peCode?.trim()) { const key = row.peCode.trim().toLowerCase(); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}
const accountFields = { linkDistributor: 'distributorAccountId', linkVar: 'varAccountId', linkEndUser: 'endUserAccountId' } as const;
const safeIds = (ids: number[]) => [...new Set(ids)].sort((a,b) => a-b);
export function validateCleanupRequest(actor: Actor, request: CleanupRequest) {
  assertPermission(actor, 'users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Administrator access required.');
  if (!Array.isArray(request.ids) || request.ids.length === 0 || request.ids.length > 500 || request.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Select 1 to 500 Price Exceptions.');
  if (!['assignOwner','linkDistributor','linkVar','linkEndUser','expire','archive'].includes(request.action)) throw new Error('Invalid bulk action.');
  if (request.action !== 'expire' && request.action !== 'archive' && (!Number.isSafeInteger(request.targetId) || (request.targetId ?? 0) <= 0)) throw new Error('Choose a valid target.');
  return { ...request, ids: safeIds(request.ids) };
}
const selected = { id:true, peCode:true, status:true, archivedAt:true, expirationDate:true, assignedSalesRepUserId:true, distributorAccountId:true, varAccountId:true, endUserAccountId:true, updatedAt:true } as const;
type Selected = Prisma.PriceExceptionGetPayload<{ select: typeof selected }>;
function eligible(row: Selected, request: CleanupRequest, today: Date) {
  if (request.action === 'archive') return !row.archivedAt && row.status !== 'ARCHIVED';
  if (row.archivedAt || row.status === 'ARCHIVED') return false;
  if (request.action === 'expire') return row.status === 'ACTIVE' && !!row.expirationDate && row.expirationDate < today;
  if (request.action === 'assignOwner') return row.assignedSalesRepUserId === null;
  return row[accountFields[request.action]] === null;
}
function beforeAfter(row: Selected, request: CleanupRequest, targetLabel: string) {
  if (request.action === 'archive') return { before: row.status, after: 'ARCHIVED' };
  if (request.action === 'expire') return { before: row.status, after: 'EXPIRED' };
  return { before: 'Unassigned', after: targetLabel };
}
function digest(rows: Selected[], request: CleanupRequest) {
  return createHash('sha256').update(JSON.stringify({ request, rows: rows.map(row => [row.id,row.status,row.archivedAt,row.expirationDate,row.assignedSalesRepUserId,row.distributorAccountId,row.varAccountId,row.endUserAccountId,row.updatedAt]) })).digest('hex');
}
async function target(db: PrismaClient | Prisma.TransactionClient, request: CleanupRequest) {
  if (request.action === 'expire' || request.action === 'archive') return '';
  if (request.action === 'assignOwner') {
    const user = await db.user.findUnique({ where: { id: request.targetId }, select: { firstName:true,lastName:true,role:true,active:true,archivedAt:true } });
    if (!user || !user.active || user.archivedAt || !['SALES','SALES_MANAGER'].includes(user.role)) throw new Error('Choose an active Sales or Sales Manager user.');
    return `${user.firstName} ${user.lastName}`;
  }
  const account = await db.account.findUnique({ where: { id: request.targetId }, select: { name:true,status:true,archivedAt:true } });
  if (!account || account.status !== 'ACTIVE' || account.archivedAt) throw new Error('Choose an active Account.');
  return account.name;
}
async function prepare(db: PrismaClient | Prisma.TransactionClient, actor: Actor, input: CleanupRequest) {
  const request = validateCleanupRequest(actor, input);
  const targetLabel = await target(db, request);
  const rows = await db.priceException.findMany({ where: { id: { in: request.ids } }, select: selected, orderBy: { id:'asc' } });
  if (rows.length !== request.ids.length) throw new Error('Selection changed. Refresh the audit and preview again.');
  const today = utcToday();
  if (rows.some(row => !eligible(row, request, today))) throw new Error('Some selected records are not eligible. Narrow the selection and preview again.');
  return { request, rows, targetLabel, fingerprint: digest(rows, request), changes: rows.map(row => ({ id:row.id, code:row.peCode ?? `#${row.id}`, ...beforeAfter(row, request, targetLabel) })) };
}
export async function previewPriceExceptionCleanup(db: PrismaClient, actor: Actor, request: CleanupRequest) { return prepare(db, actor, request); }
export async function applyPriceExceptionCleanup(db: PrismaClient, actor: Actor, request: CleanupRequest, expectedFingerprint: string, confirmedCount: number, confirmed: boolean) {
  validateCleanupRequest(actor, request);
  if (confirmed !== true || !/^[a-f0-9]{64}$/.test(expectedFingerprint) || !Number.isSafeInteger(confirmedCount)) throw new Error('Preview and explicit confirmation required.');
  return db.$transaction(async tx => {
    const plan = await prepare(tx, actor, request);
    if (plan.fingerprint !== expectedFingerprint || plan.rows.length !== confirmedCount) throw new Error('Selection or records changed. Preview again.');
    const now = new Date();
    const data: Prisma.PriceExceptionUncheckedUpdateManyInput = request.action === 'archive' ? { status:'ARCHIVED', archivedAt:now, updatedById:actor.id } : request.action === 'expire' ? { status:'EXPIRED', updatedById:actor.id } : request.action === 'assignOwner' ? { assignedSalesRepUserId: request.targetId, updatedById:actor.id } : { [accountFields[request.action]]: request.targetId, updatedById:actor.id };
    for (const row of plan.rows) {
      const result = await tx.priceException.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data });
      if (result.count !== 1) throw new Error('A Price Exception changed. Preview again.');
    }
    return plan.rows.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
