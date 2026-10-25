'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { assertDemoContext, canEditDemo, demoReadWhere } from '@/lib/demos';
import { can } from '@/lib/authorization';
import { canEditProject, projectReadWhere } from '@/lib/projects';
import { dateOnly } from '@/lib/demo-operations';
import { eligibleUserWhere } from '@/lib/assignment-eligibility';
import { activeDemoWhere } from '@/lib/unavailable-work';
import { assertEditToken, nextUpdatedAt } from '@/lib/stale-edit';
import { Prisma } from '@prisma/client';

export async function assignDemoOperationalOwner(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('demos.assign');
  const ownerId = Number(form.get('operationalOwnerId'));
  const token = String(form.get('editToken') ?? '');
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('Choose an eligible Demo owner.');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...new Set([actor.id, ownerId])].sort((a, b) => a - b))}) ORDER BY id FOR SHARE`);
    const [currentActor, owner] = await Promise.all([
      tx.user.findUnique({ where: { id: actor.id } }),
      tx.user.findFirst({ where: { id: ownerId, ...eligibleUserWhere('demo-owner') }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    if (!can(currentActor, 'demos.assign')) throw new Error('Access denied');
    if (!owner) throw new Error('Choose an eligible Demo owner.');
    await tx.$queryRaw`SELECT id FROM "DemoRequest" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.demoRequest.findFirst({ where: { AND: [activeDemoWhere, { id }] }, select: { id: true, operationalOwnerId: true, updatedAt: true } });
    if (!row) throw new Error('This Demo no longer requires an operational owner.');
    assertEditToken(row.updatedAt, token);
    if (row.operationalOwnerId === ownerId) return;
    await tx.demoRequest.update({ where: { id, updatedAt: row.updatedAt }, data: { operationalOwnerId: ownerId, updatedAt: nextUpdatedAt(row.updatedAt) } });
    await tx.adminMaintenanceEvent.create({ data: { actorId: actor.id, entityType: 'Demo', action: 'Reassign', recordIds: [id], recordCount: 1, oldValue: row.operationalOwnerId ? `User #${row.operationalOwnerId}` : 'Unassigned', newOwnerId: ownerId, newOwnerName: `${owner.firstName} ${owner.lastName}` } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  revalidatePath(`/demos/${id}`);
  revalidatePath('/administration/ownership');
  return { success: 'Demo follow-up owner saved.' };
}

const optionalId = (value: FormDataEntryValue | null) => {
  if (!value) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a valid relationship.');
  return id;
};

export async function updateDemoContext(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('sales.write');
  const request = await prisma.demoRequest.findFirst({ where: { id, AND: [demoReadWhere(actor)] }, select: { accountId: true, projectId: true, opportunityId: true, requestedById: true, operationalOwnerId: true } });
  if (!request) throw new Error('Demo Request not found.');
  if (!canEditDemo(actor, request)) throw new Error('You can only edit your own Demo Requests.');
  const projectId = optionalId(form.get('projectId')), opportunityId = optionalId(form.get('opportunityId'));
  if (projectId !== request.projectId) await assertModuleEnabled('PROJECTS');
  if (opportunityId !== request.opportunityId) await assertModuleEnabled('OPPORTUNITIES');
  await prisma.$transaction(async tx => {
    await assertDemoContext(tx, actor, request.accountId, projectId === request.projectId ? null : projectId, opportunityId === request.opportunityId ? null : opportunityId);
    await tx.demoRequest.update({ where: { id }, data: { projectId, opportunityId } });
  });
  revalidatePath(`/demos/${id}`);
  revalidatePath(`/accounts/${request.accountId}`);
  for (const project of [request.projectId, projectId]) if (project) revalidatePath(`/projects/${project}`);
  for (const opportunity of [request.opportunityId, opportunityId]) if (opportunity) revalidatePath(`/opportunities/${opportunity}`);
}

export async function linkDemoFromProject(projectId: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  await assertModuleEnabled('PROJECTS');
  const actor = await requireMutation('sales.write');
  if (!can(actor, 'projects.write')) throw new Error('Access denied');
  const demoId = optionalId(form.get('demoId'));
  if (!demoId) throw new Error('Choose a Demo.');
  await prisma.$transaction(async tx => {
    const project = await tx.project.findFirst({ where: { AND: [{ id: projectId, archivedAt: null }, projectReadWhere(actor)] }, include: { primaryAccount: { select: { ownerId: true } } } });
    if (!project || !canEditProject(actor, project)) throw new Error('Project is not available.');
    const demo = await tx.demoRequest.findFirst({ where: { id: demoId, projectId: null, AND: [demoReadWhere(actor)] }, select: { accountId: true, requestedById: true, operationalOwnerId: true } });
    if (!demo || !canEditDemo(actor, demo)) throw new Error('Demo is not available.');
    await assertDemoContext(tx, actor, demo.accountId, projectId, null);
    await tx.demoRequest.update({ where: { id: demoId }, data: { projectId } });
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/demos/${demoId}`);
}

export async function linkDemoFromOpportunity(opportunityId: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  await assertModuleEnabled('OPPORTUNITIES');
  const actor = await requireMutation('sales.write');
  const demoId = optionalId(form.get('demoId'));
  if (!demoId) throw new Error('Choose a Demo.');
  await prisma.$transaction(async tx => {
    const demo = await tx.demoRequest.findFirst({ where: { id: demoId, opportunityId: null, AND: [demoReadWhere(actor)] }, select: { accountId: true, requestedById: true, operationalOwnerId: true } });
    if (!demo || !canEditDemo(actor, demo)) throw new Error('Demo is not available.');
    await assertDemoContext(tx, actor, demo.accountId, null, opportunityId);
    await tx.demoRequest.update({ where: { id: demoId }, data: { opportunityId } });
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/demos/${demoId}`);
}

export async function updateDemoNotes(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('sales.write');
  const request = await prisma.demoRequest.findFirst({ where: { id, AND: [demoReadWhere(actor)] }, select: { requestedById: true, operationalOwnerId: true } });
  if (!request) throw new Error('Demo Request not found.');
  if (!canEditDemo(actor, request)) throw new Error('You can only edit your own Demo Requests.');
  const notes = String(form.get('notes') ?? '').trim();
  if (notes.length > 10000) throw new Error('Notes are too long.');
  await prisma.demoRequest.update({ where: { id }, data: { notes: notes || null } });
  revalidatePath(`/demos/${id}`);
}

export async function recordDemoReturn(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('sales.write');
  const unitIds = form.getAll('unitId').map(Number);
  const returnedAt = new Date(`${String(form.get('returnedAt') ?? '')}T12:00:00Z`);
  const trackingNumber = String(form.get('trackingNumber') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();
  if (!unitIds.length || unitIds.some(value => !Number.isSafeInteger(value) || value <= 0) || new Set(unitIds).size !== unitIds.length || Number.isNaN(returnedAt.valueOf()) || dateOnly(returnedAt) !== form.get('returnedAt') || dateOnly(returnedAt) > dateOnly(new Date()) || trackingNumber.length > 200 || note.length > 4000) throw new Error('Choose outstanding units and a valid return date.');
  await prisma.$transaction(async tx => {
    const request = await tx.demoRequest.findFirst({ where: { id, AND: [demoReadWhere(actor)] }, select: { requestedById: true, operationalOwnerId: true } });
    if (!request || !canEditDemo(actor, request)) throw new Error('Access denied');
    const units = await tx.demoUnit.findMany({ where: { id: { in: unitIds }, demoItem: { demoRequestId: id }, status: 'DEPLOYED', returnedAt: null } });
    if (units.length !== unitIds.length || units.some(unit => !unit.deployedAt || dateOnly(returnedAt) < dateOnly(unit.deployedAt))) throw new Error('Only deployed outstanding units can be returned.');
    for (const unit of units) {
      await tx.demoUnit.update({ where: { id: unit.id }, data: { status: 'RETURNED', returnedAt } });
      await tx.demoReturnEvent.create({ data: { demoUnitId: unit.id, returnedAt, trackingNumber: trackingNumber || null, note: note || null, recordedById: actor.id } });
    }
  });
  revalidatePath(`/demos/${id}`);
  revalidatePath('/reports/demo-inventory');
}

export async function updateDemoExpectedReturn(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('sales.write');
  const value = String(form.get('expectedReturn') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.valueOf()) || dateOnly(parsed) !== value || reason.length > 2000) throw new Error('Enter a valid expected return date.');
  const request = await prisma.demoRequest.findFirst({ where: { id, AND: [demoReadWhere(actor)] }, select: { requestedById: true, operationalOwnerId: true } });
  if (!request || !canEditDemo(actor, request)) throw new Error('Access denied');
  await prisma.demoRequest.update({ where: { id }, data: { expectedReturnOverrideAt: parsed, expectedReturnOverrideById: actor.id, expectedReturnOverrideRecordedAt: new Date(), expectedReturnOverrideReason: reason || null } });
  revalidatePath(`/demos/${id}`);
  revalidatePath('/reports/demo-inventory');
}

export async function deployDemoUnits(id: number, form: FormData) {
  await assertModuleEnabled('DEMOS');
  const actor = await requireMutation('sales.write');
  const unitIds = form.getAll('unitId').map(Number);
  const deployedAt = new Date(`${String(form.get('deployedAt') ?? '')}T12:00:00Z`);
  if (!unitIds.length || unitIds.some(value => !Number.isSafeInteger(value) || value <= 0) || new Set(unitIds).size !== unitIds.length || Number.isNaN(deployedAt.valueOf()) || dateOnly(deployedAt) !== form.get('deployedAt') || dateOnly(deployedAt) > dateOnly(new Date())) throw new Error('Choose units and a valid deployment date.');
  await prisma.$transaction(async tx => {
    const request = await tx.demoRequest.findFirst({ where: { id, AND: [demoReadWhere(actor)] }, select: { requestedById: true, operationalOwnerId: true } });
    if (!request || !canEditDemo(actor, request)) throw new Error('Access denied');
    const units = await tx.demoUnit.findMany({ where: { id: { in: unitIds }, demoItem: { demoRequestId: id, retiredAt: null }, deployedAt: null, returnedAt: null } });
    if (units.length !== unitIds.length) throw new Error('Only not yet deployed units can be deployed.');
    for (const unit of units) await tx.demoUnit.update({ where: { id: unit.id }, data: { status: 'DEPLOYED', deployedAt } });
  });
  revalidatePath(`/demos/${id}`);
  revalidatePath('/reports/demo-inventory');
}
