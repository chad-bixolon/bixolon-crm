import { applyPriceExceptionCleanup, previewPriceExceptionCleanup } from '../lib/price-exception-cleanup';
import { applyImport, planImport } from '../lib/import-plan';
import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { ownershipCounts, ownershipRows } from '../lib/admin-ownership';
import { adminAudit } from '../lib/admin-audit';
import { bulkTasks, bulkSupportCases } from '../lib/bulk-actions';
import { resolveUserContext } from '../lib/dev-impersonation';
import { setAccountArchived } from '../lib/accounts';
import { setContactState } from '../lib/contacts';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
test.afterAll(() => db.$disconnect());

test('ownership detection, validated reassignment, durable history and append-only maintenance', async () => {
  const admin = await user(emails.admin), sales = await user(emails.sales), support = await user(emails.support);
  const former = await db.user.create({ data: { email: `${uniqueName('former').replaceAll(' ', '')}@example.test`, firstName: 'Former', lastName: 'Owner', role: 'SALES', active: false } });
  const account = await db.account.create({ data: { name: uniqueName('Ownership account'), ownerId: former.id } });
  const contact = await db.contact.create({ data: { firstName: 'Inherited', lastName: 'Ownership', accountId: account.id } });
  const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
  const opportunity = await db.opportunity.create({ data: { name: uniqueName('Ownership opportunity'), stageId: stage.id, ownerId: former.id } });
  const project = await db.project.create({ data: { name: uniqueName('Ownership project'), ownerId: former.id, createdById: admin.id, primaryAccountRole: 'PROGRAM_OWNER' } });
  const task = await db.task.create({ data: { subject: uniqueName('Ownership task'), assignedToId: former.id } });
  await db.task.create({ data: { subject: 'Completed excluded ownership', status: 'COMPLETED', assignedToId: former.id } });
  await db.account.create({ data: { name: 'Archived excluded ownership', status: 'ARCHIVED', archivedAt: new Date(), ownerId: former.id } });
  const c = await db.supportCase.create({ data: { caseNumber: uniqueName('AUDIT'), subject: 'Ownership case', customerNameText: 'Ownership test customer', description: 'Test', source: 'PHONE', createdById: admin.id, updatedById: admin.id, assignedToId: former.id } });
  expect(await ownershipCounts(db, admin, former.id)).toEqual({ Account: 1, Contact: 1, Opportunity: 1, Project: 1, Task: 1, 'Support Case': 1 });
  for (const [entity, id] of [['Account', account.id], ['Contact', contact.id], ['Opportunity', opportunity.id], ['Project', project.id], ['Task', task.id], ['Support Case', c.id]] as const) expect((await ownershipRows(db, admin, entity, former.id, 1))[0].id).toBe(id);
  const request = { records: [{ id: task.id, updatedAt: task.updatedAt.toISOString() }], action: 'assign', value: String(sales.id), confirmed: true };
  await expect(bulkTasks(db, admin, { ...request, confirmed: false })).rejects.toThrow(/confirmation/);
  await expect(bulkTasks(db, admin, { ...request, value: String(former.id) })).rejects.toThrow(/eligible/);
  expect(await bulkTasks(db, admin, request)).toBe(1);
  await expect(bulkTasks(db, admin, request)).rejects.toThrow(/changed/);
  expect(await db.taskAssignmentEvent.count({ where: { taskId: task.id, actorId: admin.id, fromUserId: former.id, toUserId: sales.id } })).toBe(1);
  const ledger = await db.adminMaintenanceEvent.findFirstOrThrow({ where: { entityType: 'Task', recordIds: { has: task.id } } });
  expect(ledger.action).toBe('Reassign'); expect(ledger.actorId).toBe(admin.id);
  await expect(db.adminMaintenanceEvent.update({ where: { id: ledger.id }, data: { action: 'Changed' } })).rejects.toThrow(/append-only/);
  await expect(db.adminMaintenanceEvent.delete({ where: { id: ledger.id } })).rejects.toThrow(/append-only/);
  await bulkSupportCases(db, admin, { ...request, records: [{ id: c.id, updatedAt: c.updatedAt.toISOString() }], value: String(support.id) });
  expect(await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: c.id, field: 'assignedToId', actorId: admin.id } })).toBe(1);
  expect((await ownershipCounts(db, admin, former.id)).Task).toBe(0);
  await setAccountArchived(db, account.id, true, admin.id); await setAccountArchived(db, account.id, false, admin.id);
  await setContactState(db, contact.id, 'archived', admin.id); await setContactState(db, contact.id, 'active', admin.id);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Account', recordIds: { has: account.id } } })).toBe(2);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Contact', recordIds: { has: contact.id } } })).toBe(2);
});

test('audit union supports date/actor/type/action filters, old/new, missing values and pagination', async ({ page }) => {
  const admin = await user(emails.admin);
  const actor = await db.user.create({ data: { email: `${uniqueName('auditactor').replaceAll(' ', '')}@example.test`, firstName: 'Audit', lastName: 'Actor' } });
  const task = await db.task.create({ data: { subject: uniqueName('Paged audit') } });
  await db.taskAssignmentEvent.createMany({ data: Array.from({ length: 27 }, (_, i) => ({ taskId: task.id, actorId: actor.id, fromUserId: null, toUserId: admin.id, createdAt: new Date(Date.UTC(2001, 0, 1, 0, i)) })) });
  const f = { from: '2001-01-01', to: '2001-01-01', actor: String(actor.id), entity: 'Task', action: 'Assignment' };
  const first = await adminAudit(db, admin, f), second = await adminAudit(db, admin, { ...f, page: '2' });
  expect(first.count).toBe(27); expect(first.rows.length).toBe(25); expect(second.rows.length).toBe(2);
  expect(first.rows[0].before).toBeNull(); expect(first.rows[0].after).toBe(`${admin.firstName} ${admin.lastName}`);
  expect(first.rows.some(a => second.rows.some(b => a.key === b.key))).toBe(false);
  expect((await adminAudit(db, admin, { ...f, action: 'Priority' })).count).toBe(0);
  expect((await adminAudit(db, admin, { ...f, from: '2001-01-02' })).count).toBe(0);
  const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
  const opportunity = await db.opportunity.create({ data: { name: uniqueName('Audited deal'), stageId: stage.id } });
  await db.opportunityHistoryEvent.create({ data: { opportunityId: opportunity.id, opportunityName: opportunity.name, actorId: actor.id, actorName: 'Preserved actor', eventType: 'STAGE', oldStageName: 'Discovery', newStageName: 'Qualified', occurredAt: new Date('2001-01-01T02:00:00Z') } });
  await db.opportunityHistoryArchive.create({ data: { sourceId: 900000000 + actor.id, archiveBatchId: '123e4567-e89b-42d3-a456-426614174000', opportunityId: opportunity.id, opportunityName: opportunity.name, actorId: actor.id, actorName: 'Preserved actor', eventType: 'OWNER', oldOwnerName: 'Former owner', newOwnerName: 'New owner', occurredAt: new Date('2001-01-01T03:00:00Z'), createdAt: new Date('2001-01-01T03:00:00Z') } });
  const dealHistory = await adminAudit(db, admin, { ...f, entity: 'Opportunity', action: '' });
  expect(dealHistory.count).toBe(2);
  expect(dealHistory.rows.find(row => row.action === 'Owner')).toMatchObject({ before: 'Former owner', after: 'New owner', actor: 'Preserved actor' });
  await signInAs(page, 'admin'); await page.goto(`/administration/audit-history?${new URLSearchParams({ ...f, entity: 'Opportunity', action: 'Stage' })}`);
  await expect(page.locator('main article')).toContainText('Discovery'); await expect(page.locator('main article')).toContainText('Qualified');
  await page.goto(`/administration/audit-history?${new URLSearchParams(f)}`);
  await expect(page.locator('main article')).toHaveCount(25);
  await expect(page.locator('main')).toContainText('Not recorded');
  await page.getByRole('link', { name: 'Next', exact: true }).click(); await expect(page.locator('main article')).toHaveCount(2);
  await page.goto('/administration/maintenance-history?entity=Task&action=Reassign'); await expect(page.locator('main h1')).toHaveText('Maintenance History');
});

test('Admin reports deny other roles and an impersonated Sales user', async ({ page, context }) => {
  test.setTimeout(120_000);
  const admin = await user(emails.admin), sales = await user(emails.sales);
  const effective = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  await expect(adminAudit(db, effective.effective!, {})).rejects.toThrow(/Access denied/);
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) {
    await signInAs(page, role); await page.waitForLoadState('networkidle');
    for (const route of ['ownership', 'audit-history', 'maintenance-history', 'system-health']) { await page.goto(`/administration/${route}`); await page.waitForLoadState('networkidle'); await expect(page).toHaveURL(/access-denied/); await page.waitForLoadState('networkidle'); }
  }
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await signInAs(page, 'admin'); await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(sales.id), url: baseURL }]);
    await page.goto('/administration/audit-history'); await expect(page).toHaveURL(/access-denied/); await page.waitForLoadState('networkidle');
  }
});

for (const width of [1440, 768, 390]) test(`Administration tools fit ${width}px and preserve clear navigation`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await signInAs(page, 'admin');
  for (const [route, title] of [['ownership', 'Ownership & Reassignment'], ['audit-history', 'Audit History'], ['maintenance-history', 'Maintenance History'], ['system-health', 'System Health']]) {
    await page.goto(`/administration/${route}`); await page.waitForLoadState('networkidle'); await expect(page.locator('main h1')).toHaveText(title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (route === 'system-health') { await expect(page.locator('main')).toContainText('Support Gmail'); await expect(page.locator('main')).toContainText('Calendar integration'); }
    await page.screenshot({ path: `test-results/admin-${route}-${width}.png`, fullPage: true, caret: 'initial' });
  }
});

test('ownership UI confirms reassignment and removes the resolved issue', async ({ page }) => {
  const sales = await user(emails.sales);
  const former = await db.user.create({ data: { email: `${uniqueName('uiowner').replaceAll(' ', '')}@example.test`, firstName: 'UI', lastName: 'Former', role: 'SALES', active: false } });
  const task = await db.task.create({ data: { subject: uniqueName('UI ownership reassignment'), assignedToId: former.id } });
  await signInAs(page, 'admin'); await page.goto(`/administration/ownership?entity=Task&owner=${former.id}`);
  await page.getByLabel(`Select ${task.subject}`, { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
  await dialog.getByLabel('Assignee').selectOption(String(sales.id));
  await dialog.getByRole('button', { name: /^Confirm 1 updates$/  }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('main')).toContainText('No records need reassignment for these filters.');
  expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(sales.id);
});

test('confirmed imports and PE Cleanup append maintenance only after successful validation', async ({ page }) => {
  const admin = await user(emails.admin), sales = await user(emails.sales);
  const accountName = uniqueName('Audit import account');
  const csv = `record_type,account_name\naccount,${accountName}`;
  const preview = await planImport(db, csv);
  expect(preview.counts.errors).toBe(0);
  await applyImport(db, csv, preview.digest, admin.id);
  const imported = await db.adminMaintenanceEvent.findFirstOrThrow({ where: { actorId: admin.id, entityType: 'CRM import' }, orderBy: { id: 'desc' } });
  expect(imported.action).toBe('Import'); expect(imported.recordCount).toBe(1);
  const account = await db.account.findFirstOrThrow({ where: { name: accountName } });
  await signInAs(page, 'admin'); await page.goto(`/accounts/${account.id}`);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).archivedAt).toBeNull();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account archived.');
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Account', action: 'Archive', recordIds: { has: account.id } } })).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reactivate account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account reactivated.');
  const unchanged = await planImport(db, csv), before = await db.adminMaintenanceEvent.count({ where: { entityType: 'CRM import' } });
  await applyImport(db, csv, unchanged.digest, admin.id);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'CRM import' } })).toBe(before);
  const pe = await db.priceException.create({ data: { peCode: uniqueName('Audit cleanup'), sourceType: 'LEGACY_WORKBOOK', sourceKey: uniqueName('audit-maintenance'), status: 'ACTIVE' } });
  const request = { ids: [pe.id], action: 'assignOwner' as const, targetId: sales.id };
  const plan = await previewPriceExceptionCleanup(db, admin, request);
  await expect(applyPriceExceptionCleanup(db, admin, request, plan.fingerprint, 1, false)).rejects.toThrow(/confirmation/);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Price Exception', recordIds: { has: pe.id } } })).toBe(0);
  await applyPriceExceptionCleanup(db, admin, request, plan.fingerprint, 1, true);
  const event = await db.adminMaintenanceEvent.findFirstOrThrow({ where: { entityType: 'Price Exception', recordIds: { has: pe.id } } });
  expect(event.action).toBe('Cleanup assignment'); expect(event.actorId).toBe(admin.id);
});

test('Task and Activity archive/restore preserve attribution and append maintenance entries', async ({ page }) => {
  const admin = await user(emails.admin);
  const task = await db.task.create({ data: { subject: uniqueName('Maintenance task'), assignedToId: admin.id } });
  await signInAs(page, 'admin'); await page.goto(`/tasks/${task.id}/edit`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?visibility=archived/);
  expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).archivedById).toBe(admin.id);
  await page.goto(`/tasks/${task.id}/edit`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reactivate task', exact: true }).click();
  await expect(page.locator('main h1')).toContainText('Edit task');
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Task', recordIds: { has: task.id }, action: { in: ['Archive', 'Restore'] } } })).toBe(2);
  const account = await db.account.create({ data: { name: uniqueName('Activity maintenance Account') } });
  const type = await db.activityType.findFirstOrThrow({ where: { active: true } });
  const activity = await db.activity.create({ data: { subject: uniqueName('Maintenance activity'), accountId: account.id, userId: admin.id, type: type.code } });
  await page.goto(`/activities/${activity.id}/edit`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore Activity', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restore Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive Activity', exact: true })).toBeVisible();
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Activity', recordIds: { has: activity.id } } })).toBe(2);
  expect((await db.activity.findUniqueOrThrow({ where: { id: activity.id } })).archivedById).toBeNull();
});
