import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { userChangeImpact } from '../lib/user-lifecycle';
import { ownershipCounts } from '../lib/admin-ownership';
import { reassignUnavailable } from '../lib/unavailable-reassignment';
import { updateSupportCase } from '../lib/support-cases';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(() => db.$disconnect());

test('Admin recovers active Demo work while preserving historical actors', async ({ page }) => {
  const [admin, sales, account] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: emails.admin } }),
    db.user.findUniqueOrThrow({ where: { email: emails.sales } }),
    db.account.findFirstOrThrow({ where: { name: 'E2E Acme Customer' } }),
  ]);
  const historical = await db.user.create({ data: { email: `${Date.now()}-demo-unavailable@example.test`, firstName: 'Past', lastName: 'Owner', role: 'SALES', active: false } });
  const demo = await db.demoRequest.create({ data: { accountId: account.id, demoNumber: uniqueName('Recovery Demo'), requestedAt: new Date(), requestedById: historical.id, reviewedById: admin.id, shippedById: historical.id, operationalOwnerId: historical.id, status: 'APPROVED' } });
  await expect(reassignUnavailable(db, sales, 'Demo', demo.id, sales.id, demo.updatedAt.toISOString())).rejects.toThrow(/Access denied/);
  await expect(reassignUnavailable(db, admin, 'Demo', demo.id, admin.id, demo.updatedAt.toISOString())).rejects.toThrow(/eligible replacement/);
  await expect(reassignUnavailable(db, admin, 'Demo', demo.id, sales.id, new Date(demo.updatedAt.getTime() - 1).toISOString())).rejects.toThrow(/changed/);
  await signInAs(page, 'admin');
  await page.goto('/administration/ownership?entity=Demo');
  const row = page.getByRole('row').filter({ hasText: demo.demoNumber! });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Past Owner');
  await row.getByLabel('Replacement user').selectOption(String(sales.id));
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Assign' }).click();
  await expect.poll(() => db.demoRequest.findUniqueOrThrow({ where: { id: demo.id } }).then(value => value.operationalOwnerId)).toBe(sales.id);
  const saved = await db.demoRequest.findUniqueOrThrow({ where: { id: demo.id } });
  expect([saved.requestedById, saved.reviewedById, saved.shippedById]).toEqual([historical.id, admin.id, historical.id]);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Demo', recordIds: { has: demo.id }, newOwnerId: sales.id } })).toBe(1);
  const project = await db.project.create({ data: { name: uniqueName('Demo owner context'), status: 'ACTIVE', primaryAccountId: account.id, primaryAccountRole: 'END_CUSTOMER', ownerId: sales.id, createdById: admin.id } });
  await signInAs(page, 'sales');
  await page.goto(`/projects/${project.id}?tab=demos`);
  await expect(page.locator('select[name="demoId"] option', { hasText: demo.demoNumber! })).toHaveCount(1);
});

for (const width of [1440, 1024, 820, 768, 390]) test(`cleanup filters, counts, selection and confirmation at ${width}px`, async ({ page }) => {
  test.setTimeout(90_000);
  const sales = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
  const unavailable = await db.user.create({ data: { email: `${Date.now()}-${width}-responsive-task@example.test`, firstName: 'Past', lastName: 'Task', role: 'SALES', active: false } });
  const task = await db.task.create({ data: { subject: uniqueName(`Responsive cleanup ${width}`), status: 'OPEN', assignedToId: unavailable.id } });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await signInAs(page, 'admin');
  await page.goto(`/administration/ownership?entity=Task&owner=${unavailable.id}`);
  await expect(page.getByRole('heading', { name: 'Ownership & Reassignment' })).toBeVisible();
  if (width < 900) await page.getByRole('button', { name: /^Show filters/ }).click();
  await expect(page.getByLabel('Record type')).toHaveValue('Task');
  await expect(page.getByRole('link', { name: /Task/ }).first()).toBeVisible();
  await page.getByRole('checkbox', { name: `Select ${task.subject}` }).check();
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Assignee').selectOption(String(sales.id));
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId).toBe(unavailable.id);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await dialog.getByLabel('Assignee').selectOption(String(sales.id));
  await dialog.getByRole('button', { name: 'Confirm 1 updates' }).click();
  await expect.poll(() => db.task.findUniqueOrThrow({ where: { id: task.id } }).then(row => row.assignedToId)).toBe(sales.id);
  await page.goto('/administration/ownership?entity=Task');
  if (width < 900) await page.getByRole('button', { name: /^Show filters/ }).click();
  await page.getByLabel('Record type').selectOption('Demo');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/entity=Demo/);
  await expect(page.getByText(/records · Page 1 of/)).toBeVisible();
  const table = page.locator('table');
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  if (width === 390) await expect(table.evaluate(el => el.parentElement!.scrollWidth > el.parentElement!.clientWidth)).resolves.toBe(true);
});

test('cross-functional recovery remains Admin-only', async ({ page }) => {
  for (const role of ['salesManager', 'supportManager', 'marketing', 'executive', 'readOnly'] as const) {
    await signInAs(page, role);
    await page.goto('/administration/ownership?entity=Demo');
    await expect(page).toHaveURL(/access-denied/);
  }
});

test('lifecycle preview and cleanup agree across Sales, Support, Marketing and inactivity changes', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const openStage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
  const closedStage = await db.salesStage.findFirst({ where: { isClosed: true } }) ?? await db.salesStage.create({ data: { name: uniqueName('Lifecycle closed stage'), sortOrder: 999, isClosed: true, isWon: false } });
  const sales = await db.user.create({ data: { email: `${Date.now()}-lifecycle-sales@example.test`, firstName: 'Lifecycle', lastName: 'Sales', role: 'SALES' } });
  const account = await db.account.create({ data: { name: uniqueName('Lifecycle recovery'), ownerId: sales.id } });
  await db.opportunity.create({ data: { name: uniqueName('Lifecycle open opportunity'), stageId: openStage.id, ownerId: sales.id, currencyCode: 'USD' } });
  const historicalOpportunity = await db.opportunity.create({ data: { name: uniqueName('Lifecycle closed opportunity'), stageId: closedStage.id, ownerId: sales.id, currencyCode: 'USD' } });
  await db.project.create({ data: { name: uniqueName('Lifecycle active project'), status: 'ACTIVE', ownerId: sales.id, createdById: admin.id, primaryAccountRole: 'END_CUSTOMER' } });
  const historicalProject = await db.project.create({ data: { name: uniqueName('Lifecycle completed project'), status: 'COMPLETED', ownerId: sales.id, createdById: admin.id, primaryAccountRole: 'END_CUSTOMER' } });
  await db.task.create({ data: { subject: uniqueName('Lifecycle open task'), status: 'OPEN', assignedToId: sales.id } });
  const historicalTask = await db.task.create({ data: { subject: uniqueName('Lifecycle completed task'), status: 'COMPLETED', assignedToId: sales.id } });
  const demo = await db.demoRequest.create({ data: { accountId: account.id, requestedAt: new Date(), status: 'PENDING', requestedById: sales.id, operationalOwnerId: sales.id } });
  const historicalDemo = await db.demoRequest.create({ data: { accountId: account.id, requestedAt: new Date(), status: 'CANCELLED', requestedById: sales.id, operationalOwnerId: sales.id } });
  for (const change of [{ role: 'EXECUTIVE' }, { role: 'READ_ONLY' }, { active: false }] as const) {
    await db.user.update({ where: { id: sales.id }, data: { role: 'SALES', active: true } });
    const before = await db.user.findUniqueOrThrow({ where: { id: sales.id } });
    const after = { ...before, ...change };
    const preview = await userChangeImpact(db, admin, before, after);
    await db.user.update({ where: { id: sales.id }, data: change });
    const cleanup = await ownershipCounts(db, admin, sales.id);
    for (const [area, group] of [['Accounts', 'Account'], ['Open Opportunities', 'Opportunity'], ['Active Projects', 'Project'], ['Open Sales Tasks', 'Task'], ['Outstanding Demos', 'Demo']] as const)
      expect(preview.find(item => item.area === area)?.count).toBe(cleanup[group]);
    expect(cleanup.Task).toBe(1);
    expect((await db.demoRequest.findUniqueOrThrow({ where: { id: demo.id } })).requestedById).toBe(sales.id);
  }
  expect((await db.opportunity.findUniqueOrThrow({ where: { id: historicalOpportunity.id } })).ownerId).toBe(sales.id);
  expect((await db.project.findUniqueOrThrow({ where: { id: historicalProject.id } })).ownerId).toBe(sales.id);
  expect((await db.task.findUniqueOrThrow({ where: { id: historicalTask.id } })).assignedToId).toBe(sales.id);
  expect((await db.demoRequest.findUniqueOrThrow({ where: { id: historicalDemo.id } })).requestedById).toBe(sales.id);
  const support = await db.user.create({ data: { email: `${Date.now()}-lifecycle-support@example.test`, firstName: 'Lifecycle', lastName: 'Support', role: 'SUPPORT' } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('LIFE-SUPPORT'), subject: 'Lifecycle Support case', description: 'Current work', customerNameText: 'Customer', source: 'PHONE', assignedToId: support.id, createdById: admin.id, updatedById: admin.id } });
  await db.task.create({ data: { subject: uniqueName('Lifecycle Support task'), status: 'OPEN', supportCaseId: supportCase.id, assignedToId: support.id } });
  const historicalCase = await db.supportCase.create({ data: { caseNumber: uniqueName('LIFE-CLOSED'), subject: 'Historical Support case', description: 'Resolved work', customerNameText: 'Customer', source: 'PHONE', status: 'CLOSED', assignedToId: support.id, createdById: admin.id, updatedById: admin.id } });
  const supportPreview = await userChangeImpact(db, admin, support, { ...support, role: 'SUPPORT_MANAGER' });
  await db.user.update({ where: { id: support.id }, data: { role: 'SUPPORT_MANAGER' } });
  expect(supportPreview.find(item => item.area === 'Unresolved Support Cases')).toBeUndefined();
  expect(supportPreview.find(item => item.area === 'Open Support Tasks')).toBeUndefined();
  expect((await ownershipCounts(db, admin, support.id))['Support Case']).toBe(0);
  expect((await ownershipCounts(db, admin, support.id)).Task).toBe(0);
  expect((await db.supportCase.findUniqueOrThrow({ where: { id: supportCase.id } })).assignedToId).toBe(support.id);
  expect((await db.supportCase.findUniqueOrThrow({ where: { id: historicalCase.id } })).assignedToId).toBe(support.id);
  const marketing = await db.user.create({ data: { email: `${Date.now()}-lifecycle-marketing@example.test`, firstName: 'Lifecycle', lastName: 'Marketing', role: 'MARKETING_MANAGER' } });
  await db.tradeShow.create({ data: { name: uniqueName('Lifecycle active Trade Show'), marketingOwnerId: marketing.id, createdById: admin.id, endDate: new Date('2027-12-31T00:00:00Z') } });
  const historicalShow = await db.tradeShow.create({ data: { name: uniqueName('Lifecycle past Trade Show'), marketingOwnerId: marketing.id, createdById: admin.id, endDate: new Date('2025-12-31T00:00:00Z') } });
  const marketingPreview = await userChangeImpact(db, admin, marketing, { ...marketing, role: 'EXECUTIVE' });
  await db.user.update({ where: { id: marketing.id }, data: { role: 'EXECUTIVE' } });
  expect(marketingPreview.find(item => item.area === 'Trade Show Marketing ownership')?.count).toBe((await ownershipCounts(db, admin, marketing.id))['Trade Show']);
  expect((await db.tradeShow.findUniqueOrThrow({ where: { id: historicalShow.id } })).marketingOwnerId).toBe(marketing.id);
});

test('module recovery transfers current work without rewriting source attribution or visibility', async () => {
  const [admin, sales, manager, marketing] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: emails.admin } }),
    db.user.findUniqueOrThrow({ where: { email: emails.sales } }),
    db.user.findUniqueOrThrow({ where: { email: emails.salesManager } }),
    db.user.findUniqueOrThrow({ where: { email: emails.marketing } }),
  ]);
  const oldSales = await db.user.create({ data: { email: `${Date.now()}-recovery-sales@example.test`, firstName: 'Past', lastName: 'Sales', role: 'SALES', active: false, archivedAt: new Date() } });
  const oldMarketing = await db.user.create({ data: { email: `${Date.now()}-recovery-marketing@example.test`, firstName: 'Past', lastName: 'Marketing', role: 'MARKETING_MANAGER', active: false } });
  const show = await db.tradeShow.create({ data: { name: uniqueName('Recovery show'), createdById: admin.id, marketingOwnerId: oldMarketing.id, endDate: new Date('2027-12-31T00:00:00Z') } });
  const source = await db.tradeShowImport.create({ data: { tradeShowId: show.id, format: 'CUSTOM_MAPPING', sourceFileName: 'recovery.csv', sourceSheet: 'Leads', fileSha256: 'a'.repeat(64), uploadedById: admin.id } });
  const lead = await db.tradeShowLead.create({ data: { tradeShowId: show.id, firstImportId: source.id, sourceKey: uniqueName('recovery-lead'), sourceFileName: 'recovery.csv', sourceSheet: 'Leads', sourceRow: 1, rawSourceData: {}, firstName: 'Active', lastName: 'Lead', status: 'NEW', routing: 'BIXOLON_SALES', assignedSalesRepUserId: oldSales.id } });
  const pe = await db.priceException.create({ data: { peCode: uniqueName('Recovery PE'), status: 'ACTIVE', sourceType: 'EXTERNAL_EXPORT', sourceKey: uniqueName('recovery-pe'), assignedSalesRepUserId: oldSales.id, followUp: { create: { ownerId: oldSales.id, status: 'IN_PROGRESS' } } }, include: { followUp: true } });
  const audience = await db.marketingAudience.create({ data: { name: uniqueName('Recovery audience'), ownerId: oldMarketing.id, createdById: admin.id, visibility: 'PERSONAL', filterConfig: {} } });
  const report = await db.reportDefinition.create({ data: { name: uniqueName('Recovery report'), reportType: 'PIPELINE', ownerId: oldSales.id, createdById: admin.id, visibility: 'PERSONAL', configuration: { filters: [], groupBy: null, sort: [], columns: ['opportunity'], metrics: [] } } });
  const before = await ownershipCounts(db, admin);
  for (const [type, id, target, version] of [
    ['Trade Show Lead', lead.id, sales.id, lead.updatedAt], ['Trade Show', show.id, marketing.id, show.updatedAt],
    ['Price Exception Follow-up', pe.id, sales.id, pe.followUp!.updatedAt], ['Audience', audience.id, marketing.id, audience.updatedAt],
    ['Saved Report', report.id, manager.id, report.updatedAt],
  ] as const) await reassignUnavailable(db, admin, type, id, target, version.toISOString());
  const after = await ownershipCounts(db, admin);
  for (const type of ['Trade Show Lead', 'Trade Show', 'Price Exception Follow-up', 'Audience', 'Saved Report'] as const) expect(before[type] - after[type]).toBe(1);
  const [savedLead, savedShow, savedPe, savedAudience, savedReport] = await Promise.all([
    db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } }), db.tradeShow.findUniqueOrThrow({ where: { id: show.id } }),
    db.priceException.findUniqueOrThrow({ where: { id: pe.id }, include: { followUp: true } }), db.marketingAudience.findUniqueOrThrow({ where: { id: audience.id } }),
    db.reportDefinition.findUniqueOrThrow({ where: { id: report.id } }),
  ]);
  expect([savedLead.assignedSalesRepUserId, savedLead.routing, savedShow.marketingOwnerId]).toEqual([sales.id, 'BIXOLON_SALES', marketing.id]);
  expect([savedPe.assignedSalesRepUserId, savedPe.followUp?.ownerId]).toEqual([oldSales.id, sales.id]);
  expect([savedAudience.ownerId, savedAudience.createdById, savedAudience.visibility]).toEqual([marketing.id, admin.id, 'PERSONAL']);
  expect([savedReport.ownerId, savedReport.createdById, savedReport.visibility]).toEqual([manager.id, admin.id, 'PERSONAL']);
  expect(await db.adminMaintenanceEvent.count({ where: { actorId: admin.id, action: 'Reassign', OR: [{ recordIds: { has: lead.id }, entityType: 'Trade Show Lead' }, { recordIds: { has: pe.id }, entityType: 'Price Exception Follow-up' }] } })).toBe(2);
});

test('disabled Demo module still exposes stranded work to Admin cleanup', async ({ page }) => {
  const [account, sales] = await Promise.all([
    db.account.findFirstOrThrow({ where: { name: 'E2E Acme Customer' } }),
    db.user.findUniqueOrThrow({ where: { email: emails.sales } }),
  ]);
  const old = await db.user.create({ data: { email: `${Date.now()}-disabled-demo@example.test`, firstName: 'Disabled', lastName: 'Owner', role: 'SALES', active: false } });
  const demo = await db.demoRequest.create({ data: { accountId: account.id, demoNumber: uniqueName('Disabled module Demo'), requestedAt: new Date(), status: 'PENDING', operationalOwnerId: old.id } });
  const previous = await db.deploymentModuleVisibility.findUniqueOrThrow({ where: { module: 'DEMOS' } });
  try {
    await db.deploymentModuleVisibility.update({ where: { module: 'DEMOS' }, data: { enabled: false } });
    await signInAs(page, 'admin');
    await page.goto('/administration/ownership?entity=Demo');
    await expect(page.getByText('Demos is currently disabled.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: demo.demoNumber! });
    await expect(row).toBeVisible();
    await row.getByLabel('Replacement user').selectOption(String(sales.id));
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Assign' }).click();
    await expect.poll(() => db.demoRequest.findUniqueOrThrow({ where: { id: demo.id } }).then(value => value.operationalOwnerId)).toBe(sales.id);
    await signInAs(page, 'sales');
    await page.goto(`/demos/${demo.id}`);
    await expect(page).toHaveURL(/module-unavailable/);
  } finally {
    await db.deploymentModuleVisibility.update({ where: { module: 'DEMOS' }, data: { enabled: previous.enabled } });
  }
});

test('reopening a closed Case rejects an unavailable historical assignee until replaced', async () => {
  const [admin, support] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: emails.admin } }),
    db.user.findUniqueOrThrow({ where: { email: emails.support } }),
  ]);
  const historical = await db.user.create({ data: { email: `${Date.now()}-closed-support@example.test`, firstName: 'Past', lastName: 'Support', role: 'SUPPORT', active: false } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('CLOSED-REOPEN'), subject: 'Closed case owner history', description: 'Closed work', customerNameText: 'Customer', source: 'PHONE', status: 'CLOSED', resolutionSummary: 'Resolved', assignedToId: historical.id, createdById: admin.id, updatedById: admin.id } });
  await expect(updateSupportCase(db, admin, supportCase.id, { status: 'OPEN' })).rejects.toThrow(/eligible Support assignee/);
  expect((await db.supportCase.findUniqueOrThrow({ where: { id: supportCase.id } })).assignedToId).toBe(historical.id);
  const reopened = await updateSupportCase(db, admin, supportCase.id, { status: 'OPEN', assignedToId: support.id });
  expect([reopened.status, reopened.assignedToId]).toEqual(['OPEN', support.id]);
});
