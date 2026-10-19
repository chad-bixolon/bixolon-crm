import { nextUpdatedAt } from './stale-edit';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin, recordMaintenance } from './admin-maintenance';
import type { Actor } from './authorization';
import { eligibleUserWhere } from './assignment-eligibility';
import { validateBulkRequest, type BulkRequest } from './bulk-action-contract';
import { assertVersions } from './bulk-actions';
import { qualityBulkSupported, qualityPage, qualityRows, qualityWhere } from './data-quality';
import { assignOpportunityOwnerInTransaction } from './opportunities';

export type QualityBulkScope = { issue: string; q: string; page: number };

/** Owner-only corrections, bounded to the current issue page; no general mass edit. */
export async function bulkQualityOwners(db: PrismaClient, actor: Actor, scope: QualityBulkScope, request: BulkRequest) {
  assertAdmin(actor);
  const ids = validateBulkRequest(request);
  if (!scope || !qualityBulkSupported(scope.issue) || request.action !== 'assign') throw new Error('This check requires individual review.');
  const issue = scope.issue;
  if (typeof scope.q !== 'string' || scope.q.length > 100 || qualityPage(String(scope.page)) !== scope.page) throw new Error('Refresh the list and select again.');
  const ownerId = /^\d+$/.test(request.value) ? Number(request.value) : 0;
  if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('Choose an eligible owner.');
  return db.$transaction(async tx => {
    // Hold eligibility and effective Admin permission through commit, including impersonation.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...new Set([actor.id, ownerId])].sort((a, b) => a - b))}) ORDER BY id FOR SHARE`);
    const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
    if (!currentActor) throw new Error('Access denied');
    assertAdmin(currentActor);
    const owner = await tx.user.findFirst({ where: { id: ownerId, ...eligibleUserWhere(issue === 'account-owner' ? 'accounts.write' : 'sales.write') } });
    if (!owner) throw new Error('The chosen owner is no longer available. No records changed. Choose an active, eligible owner.');
    const account = issue === 'account-owner';
    if (account) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Account" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM "Opportunity" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const where = qualityWhere(issue)!;
    const rows = account
      ? await tx.account.findMany({ where: { AND: [where as Prisma.AccountWhereInput, { id: { in: ids } }] }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
      : await tx.opportunity.findMany({ where: { AND: [where as Prisma.OpportunityWhereInput, { id: { in: ids } }] }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } });
    assertVersions(rows, request);
    const visible = await qualityRows(tx as PrismaClient, issue, scope.q.trim(), scope.page);
    if (ids.some(id => !visible.rows.some(row => row.id === id))) throw new Error('The current page changed. No records changed. Refresh the list and select again.');
    for (const row of rows) {
      if (account) await tx.account.update({ where: { id: row.id, updatedAt: row.updatedAt }, data: { ownerId, updatedById: actor.id, updatedAt: nextUpdatedAt(row.updatedAt) } });
      else await assignOpportunityOwnerInTransaction(tx, row.id, owner, currentActor);
    }
    await recordMaintenance(tx, actor.id, account ? 'Account' : 'Opportunity', 'Assign owner', ids, ids.length, { id: owner.id, name: `${owner.firstName} ${owner.lastName}` });
    return rows.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
