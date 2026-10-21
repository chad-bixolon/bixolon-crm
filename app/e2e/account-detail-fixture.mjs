import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails } from './constants.mjs';

export const largeAccountName = 'E2E Account Detail Performance v1';
export const fixtureCounts = { Contacts: 125, Opportunities: 35, Projects: 35, Demos: 30, Activity: 150, Tasks: 60, Notes: 70 };

/** Always uses the guarded, dedicated localhost E2E URL, never DATABASE_URL. */
export async function ensureLargeAccount() {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const existing = await db.account.findFirst({ where: { name: largeAccountName } });
    if (existing) return existing.id;
    const manager = await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } });
    const sales = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
    const stage = await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } });
    await db.activityType.upsert({ where: { code: 'E2E_ACCOUNT_DETAIL' }, update: {}, create: { code: 'E2E_ACCOUNT_DETAIL', name: 'Account detail fixture' } });
    // Atomic fixture creation makes reruns safe after a failed seed.
    return await db.$transaction(async tx => {
      const account = await tx.account.create({ data: { name: largeAccountName, ownerId: manager.id, businessRoles: { create: { role: 'END_USER' } } } });
      const id = account.id;
      const archivedAt = new Date('2025-01-01T12:00:00Z');
      const date = index => new Date(Date.UTC(2025, 0, 1, 12, index));
      const suffix = index => String(index).padStart(3, '0');
      await tx.contact.createMany({ data: Array.from({ length: 130 }, (_, i) => ({ accountId: id, firstName: 'History', lastName: `Contact ${suffix(i)}`, title: 'Fixture contact', isPrimary: i === 0, active: i !== 1 && i < 125, archivedAt: i >= 125 ? archivedAt : null })) });
      await tx.activity.createMany({ data: Array.from({ length: 155 }, (_, i) => ({ accountId: id, subject: `History Activity ${suffix(i)}`, type: 'E2E_ACCOUNT_DETAIL', userId: manager.id, activityDate: date(i), description: 'Fixture activity context. '.repeat(30), archivedAt: i >= 150 ? archivedAt : null })) });
      await tx.task.createMany({ data: Array.from({ length: 65 }, (_, i) => ({ accountId: id, subject: `History Task ${suffix(i)}`, assignedToId: manager.id, dueDate: date(i), status: i % 3 === 0 ? 'COMPLETED' : 'OPEN', archivedAt: i >= 60 ? archivedAt : null })) });
      await tx.note.createMany({ data: Array.from({ length: 73 }, (_, i) => ({ accountId: id, body: `History Note ${suffix(i)}\n${'Retained note text. '.repeat(30)}`, createdById: manager.id, createdAt: date(i), archivedAt: i >= 70 ? archivedAt : null })) });
      await tx.project.createMany({ data: Array.from({ length: 34 }, (_, i) => ({ primaryAccountId: id, primaryAccountRole: 'END_CUSTOMER', name: `History Project ${suffix(i)}`, createdById: manager.id, ownerId: manager.id, updatedAt: date(i), archivedAt: i === 33 ? archivedAt : null })) });
      await tx.project.create({ data: { name: 'History Additional Project', primaryAccountRole: 'PROGRAM_OWNER', createdById: manager.id, participants: { create: { accountId: id, roles: { create: { role: 'ISV' } } } } } });
      for (let i = 0; i < 36; i++) await tx.opportunity.create({ data: { name: `History Opportunity ${suffix(i)}`, ownerId: manager.id, stageId: stage.id, currencyCode: 'USD', archivedAt: i === 35 ? archivedAt : null, participants: { create: { accountId: id, roles: { create: { role: 'END_USER' } } } } } });
      // Non-archived rows with inactive relationships must remain hidden in operational views.
      const inactive = await tx.account.create({ data: { name: 'E2E Account Detail Inactive Parent', status: 'INACTIVE' } });
      const hidden = await tx.opportunity.create({ data: { name: 'History hidden inactive relationship', ownerId: manager.id, stageId: stage.id, currencyCode: 'USD', participants: { create: [{ accountId: id }, { accountId: inactive.id }] } } });
      await tx.activity.create({ data: { accountId: id, opportunityId: hidden.id, subject: 'History hidden Activity', type: 'E2E_ACCOUNT_DETAIL' } });
      await tx.task.create({ data: { accountId: id, opportunityId: hidden.id, subject: 'History hidden Task' } });
      await tx.document.createMany({ data: Array.from({ length: 43 }, (_, i) => ({ accountId: id, originalFileName: `History Document ${suffix(i)}.txt`, storageKey: `e2e-account-detail-${id}-${i}`, mimeType: 'text/plain', fileSize: 100, documentType: 'OTHER', uploadedByUserId: manager.id, createdAt: date(i), archivedAt: i >= 40 ? archivedAt : null, archivedByUserId: i >= 40 ? manager.id : null })) });
      await tx.priceException.createMany({ data: Array.from({ length: 35 }, (_, i) => ({ distributorAccountId: id, peCode: `HISTORY-PE-${suffix(i)}`, sourceType: 'EXTERNAL_EXPORT', sourceKey: `account-detail-${id}-${i}`, status: i === 34 ? 'ARCHIVED' : 'ACTIVE', archivedAt: i === 34 ? archivedAt : null, assignedSalesRepUserId: i < 10 ? sales.id : manager.id })) });
      for (let i = 0; i < 30; i++) await tx.demoRequest.create({ data: { accountId: id, demoNumber: `HISTORY-DEMO-${suffix(i)}`, requestedAt: date(i), requestedById: manager.id, opportunityId: i < 5 ? hidden.id : null, items: { create: { sourceLineKey: '1', sourceRowNumber: 1, sourceSku: 'HISTORY-SKU', quantity: 1, serialNumbers: [], trackingNumbers: [], inventoryLocations: [], sourceValues: {}, units: { create: { ordinal: 1 } } } } } });
      return id;
    }, { timeout: 60_000 });
  } finally { await db.$disconnect(); }
}
