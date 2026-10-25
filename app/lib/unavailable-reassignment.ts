import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import { can, type Actor } from './authorization';
import { eligibleUserWhere, type Eligibility } from './assignment-eligibility';
import { ownershipWhere } from './admin-ownership';
import { canOwnReportType } from './reporting';
import { assertEditToken, nextUpdatedAt, RecordChangedError } from './stale-edit';
import { syncTradeShowFollowUp } from './trade-show-follow-up';
import { canViewPriceException } from './price-exception-visibility';
import { notifyPeFollowUpAssignment, syncPeNotificationsInTransaction } from './pe-notification-evaluator';
import { assignOpportunityOwnerInTransaction } from './opportunities';

export const recoverableOwnershipTypes = ['Opportunity', 'Project', 'Trade Show Lead', 'Trade Show', 'Demo', 'Price Exception Follow-up', 'Audience', 'Saved Report'] as const;
export type RecoverableOwnershipType = typeof recoverableOwnershipTypes[number];
const policy: Record<RecoverableOwnershipType, Eligibility> = {
  Opportunity: 'opportunity-owner', Project: 'project-owner',
  'Trade Show Lead': 'trade-show-sales', 'Trade Show': 'marketing-owner', Demo: 'demo-owner',
  'Price Exception Follow-up': 'pe-follow-up', Audience: 'audience-owner', 'Saved Report': 'report-owner',
};
export const recoveryPolicy = (type: RecoverableOwnershipType) => policy[type];

export async function reassignUnavailable(db: PrismaClient, actor: Actor, type: RecoverableOwnershipType, id: number, targetId: number, editToken: string) {
  assertAdmin(actor);
  if (!recoverableOwnershipTypes.includes(type) || !Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(targetId) || targetId < 1) throw new Error('Choose a valid record and replacement.');
  assertEditToken(new Date(editToken), editToken);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...new Set([actor.id, targetId])].sort((a, b) => a - b))}) ORDER BY id FOR SHARE`);
    const [currentActor, target] = await Promise.all([
      tx.user.findUnique({ where: { id: actor.id } }),
      tx.user.findFirst({ where: { id: targetId, ...eligibleUserWhere(policy[type]) }, select: { id: true, role: true, active: true, archivedAt: true, firstName: true, lastName: true } }),
    ]);
    if (!currentActor || !can(currentActor, 'maintenance.manage')) throw new Error('Access denied');
    if (!target) throw new Error('Choose an eligible replacement user.');
    let oldOwnerId: number | null = null;
    let version: Date;
    if (type === 'Opportunity') {
      await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.opportunity.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.OpportunityWhereInput, { id }] }, select: { id: true, updatedAt: true, ownerId: true } });
      if (!row) throw new Error('This Opportunity no longer needs reassignment. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.ownerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await assignOpportunityOwnerInTransaction(tx, id, target, currentActor);
    } else if (type === 'Project') {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.project.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.ProjectWhereInput, { id }] } });
      if (!row) throw new Error('This Project no longer needs reassignment. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.ownerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.project.update({ where: { id, updatedAt: version }, data: { ownerId: targetId, updatedById: actor.id, updatedAt: nextUpdatedAt(version) } });
    } else if (type === 'Trade Show Lead') {
      await tx.$queryRaw`SELECT id FROM "TradeShowLead" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.tradeShowLead.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.TradeShowLeadWhereInput, { id }] } });
      if (!row) throw new Error('This lead no longer needs reassignment. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.assignedSalesRepUserId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      const updated = await tx.tradeShowLead.update({ where: { id, updatedAt: version }, data: { assignedSalesRepUserId: targetId, updatedAt: nextUpdatedAt(version) } });
      await syncTradeShowFollowUp(tx, row, updated, actor.id);
    } else if (type === 'Trade Show') {
      await tx.$queryRaw`SELECT id FROM "TradeShow" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.tradeShow.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.TradeShowWhereInput, { id }] } });
      if (!row) throw new Error('This Trade Show no longer needs reassignment. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.marketingOwnerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.tradeShow.update({ where: { id, updatedAt: version }, data: { marketingOwnerId: targetId, updatedById: actor.id, updatedAt: nextUpdatedAt(version) } });
    } else if (type === 'Demo') {
      await tx.$queryRaw`SELECT id FROM "DemoRequest" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.demoRequest.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.DemoRequestWhereInput, { id }] } });
      if (!row) throw new Error('This Demo no longer needs assignment. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.operationalOwnerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.demoRequest.update({ where: { id, updatedAt: version }, data: { operationalOwnerId: targetId, updatedAt: nextUpdatedAt(version) } });
    } else if (type === 'Price Exception Follow-up') {
      await tx.$queryRaw`SELECT id FROM "PriceException" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.priceException.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.PriceExceptionWhereInput, { id }] }, include: { followUp: true } });
      if (!row) throw new Error('This follow-up no longer needs assignment. Refresh the page.');
      if (!canViewPriceException(target, { ...row, followUp: { ownerId: targetId } })) throw new Error('Replacement cannot access this Price Exception.');
      version = row.followUp?.updatedAt ?? row.updatedAt; oldOwnerId = row.followUp?.ownerId ?? null;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.priceExceptionFollowUp.upsert({ where: { priceExceptionId: id }, create: { priceExceptionId: id, ownerId: targetId }, update: { ownerId: targetId, updatedAt: nextUpdatedAt(version) } });
      const event = await tx.priceExceptionFollowUpEvent.create({ data: { priceExceptionId: id, actorId: actor.id, previousValues: { ownerId: oldOwnerId }, newValues: { ownerId: targetId }, note: 'Unavailable-work recovery' } });
      await notifyPeFollowUpAssignment(tx, id, targetId, event.id, actor.id);
      await syncPeNotificationsInTransaction(tx, id);
    } else if (type === 'Audience') {
      await tx.$queryRaw`SELECT id FROM "MarketingAudience" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.marketingAudience.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.MarketingAudienceWhereInput, { id }] } });
      if (!row) throw new Error('This Audience no longer needs transfer. Refresh the page.');
      version = row.updatedAt; oldOwnerId = row.ownerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.marketingAudience.update({ where: { id, updatedAt: version }, data: { ownerId: targetId, updatedById: actor.id, updatedAt: nextUpdatedAt(version) } });
    } else {
      await tx.$queryRaw`SELECT id FROM "ReportDefinition" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.reportDefinition.findFirst({ where: { AND: [ownershipWhere(type) as Prisma.ReportDefinitionWhereInput, { id }] } });
      if (!row) throw new Error('This Report no longer needs transfer. Refresh the page.');
      if (!canOwnReportType(target, row.reportType)) throw new Error('Replacement cannot manage this report type.');
      version = row.updatedAt; oldOwnerId = row.ownerId;
      if (version.toISOString() !== editToken) throw new RecordChangedError();
      await tx.reportDefinition.update({ where: { id, updatedAt: version }, data: { ownerId: targetId, updatedById: actor.id, updatedAt: nextUpdatedAt(version) } });
    }
    const previous = oldOwnerId ? await tx.user.findUnique({ where: { id: oldOwnerId }, select: { firstName: true, lastName: true } }) : null;
    await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: type, action: 'Reassign', recordIds: [id], recordCount: 1, oldValue: previous ? `${previous.firstName} ${previous.lastName}` : oldOwnerId ? `User #${oldOwnerId}` : 'Unassigned', newOwnerId: targetId, newOwnerName: `${target.firstName} ${target.lastName}`, newValue: `${target.firstName} ${target.lastName}` } });
    return { success: `${type} assigned to ${target.firstName} ${target.lastName}.` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
