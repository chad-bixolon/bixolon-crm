import { PrismaClient, type User } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveOpportunity, type OpportunityInput } from '../lib/opportunities';
import { saveAccount } from '../lib/accounts';
import { parseAccountForm } from '../lib/account-validation';
import { saveTask, type TaskInput } from '../lib/work';
import { createSupportCase, updateSupportCase } from '../lib/support-cases';
import { bulkTasks, bulkSupportCases } from '../lib/bulk-actions';
import { resolveUserContext } from '../lib/dev-impersonation';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let admin: User, sales: User, manager: User, support: User;
let accountId: number, otherAccountId: number, productId: number, stageId: number;
const message = 'This record changed after you opened it. Review the latest version before saving again.';
test.beforeAll(async () => {
  [admin, sales, manager, support] = await Promise.all([emails.admin, emails.sales, emails.salesManager, emails.support].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  accountId = (await db.account.findFirstOrThrow({ where: { name: names.account } })).id;
  otherAccountId = (await db.account.findFirstOrThrow({ where: { name: names.otherAccount } })).id;
  productId = (await db.product.findUniqueOrThrow({ where: { sku: names.sku } })).id;
  stageId = (await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } })).id;
});
test.afterAll(() => db.$disconnect());
function accountInput(name = uniqueName('Concurrent Account')) {
  const form = new FormData(); form.set('name', name); form.set('ownerId', String(sales.id)); form.append('roles', 'END_USER');
  return parseAccountForm(form).value!;
}
function opportunityInput(): OpportunityInput {
  return { name: uniqueName('Concurrent Opportunity'), description: 'Original context', ownerId: sales.id, stageId, expectedCloseDate: new Date('2027-03-31T12:00:00Z'), probability: null, forecastCategory: 'PIPELINE', currencyCode: 'USD', projectIds: [], participants: [{ accountId, roles: ['END_USER'] }], contacts: [], lines: [{ productId, quantity: 1, price: '100.00' }] };
}
function taskInput(): TaskInput {
  return { subject: uniqueName('Concurrent Task'), description: 'Original task', accountId, opportunityId: null, projectId: null, assignedToId: sales.id, supportCaseId: null, contactId: null, status: 'OPEN', priority: 'NORMAL', dueDate: new Date('2026-11-01T12:00:00Z') };
}
async function caseFixture() {
  return createSupportCase(db, admin, { customerNameText: 'Concurrent customer', accountId, subject: uniqueName('Concurrent Case'), description: 'Original issue', source: 'PHONE', status: 'OPEN', priority: 'NORMAL', assignedToId: support.id });
}
const token = (row: { updatedAt: Date }) => row.updatedAt.toISOString();

test('Opportunity atomic saves cover participants, product/value, outcomes, Admin and effective impersonated users without extra history', async () => {
  const input = opportunityInput(), id = await saveOpportunity(db, input, undefined, admin);
  const opened = await db.opportunity.findUniqueOrThrow({ where: { id } });
  const newer = { ...input, name: 'Newer core field', participants: [...input.participants, { accountId: otherAccountId, roles: ['DISTRIBUTOR' as const] }], lines: [{ productId, quantity: 3, price: '125.00' }] };
  await saveOpportunity(db, newer, id, manager, token(opened));
  let saved = await db.opportunity.findUniqueOrThrow({ where: { id } });
  expect(saved.updatedAt.getTime()).toBeGreaterThan(opened.updatedAt.getTime());
  const count = await db.opportunityHistoryEvent.count({ where: { opportunityId: id } });
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  for (const actor of [admin, manager, sales, context.effective!]) {
    for (const attempted of [{ ...input, name: 'My core edit' }, { ...input, description: 'Old participant set' }, { ...input, lines: [{ productId, quantity: 1, price: '1.00' }], outcomeNotes: 'My outcome' }]) {
      await expect(saveOpportunity(db, attempted, id, actor, token(opened))).rejects.toThrow(message);
    }
  }
  expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: id } })).toBe(count);
  expect(await db.opportunityAccount.count({ where: { opportunityId: id } })).toBe(2);
  const products = await db.opportunityProduct.findMany({ where: { opportunityId: id, archivedAt: null } });
  expect(products).toHaveLength(1); expect(products[0].quantity).toBe(3); expect(products[0].estimatedUnitPrice.toString()).toBe('125');
  const won = await db.salesStage.upsert({ where: { name: 'E2E Concurrent Won' }, update: { active: true, isClosed: true, isWon: true }, create: { name: 'E2E Concurrent Won', active: true, isClosed: true, isWon: true, probability: 100, sortOrder: 950 } });
  const reason = await db.outcomeReason.findFirstOrThrow({ where: { active: true, isWon: true } });
  const close = { ...newer, stageId: won.id, actualCloseDate: new Date('2026-10-18T00:00:00Z'), outcomeReasonId: reason.id, outcomeNotes: 'Newer closure' };
  await saveOpportunity(db, close, id, sales, token(saved));
  saved = await db.opportunity.findUniqueOrThrow({ where: { id } });
  await expect(saveOpportunity(db, { ...close, outcomeNotes: 'Old closure' }, id, admin, token(opened))).rejects.toThrow(message);
  expect((await db.opportunity.findUniqueOrThrow({ where: { id } })).outcomeNotes).toBe('Newer closure');
  expect(saved.stageId).toBe(won.id);
});

test('Account owner/profile/roles, Task dates/status/relationships and Case history reject old saves; existing bulk checks remain valid', async () => {
  const input = accountInput(), id = await saveAccount(db, input, undefined, admin.id);
  const opened = await db.account.findUniqueOrThrow({ where: { id } });
  await saveAccount(db, { ...input, ownerId: manager.id, phone: '555-0100', city: 'Atlanta', roles: ['VAR'] }, id, manager.id, token(opened));
  for (let n = 0; n < 2; n++) await expect(saveAccount(db, input, id, admin.id, token(opened))).rejects.toThrow(message);
  expect(await db.account.findUniqueOrThrow({ where: { id } })).toMatchObject({ ownerId: manager.id, phone: '555-0100', city: 'Atlanta' });
  expect((await db.accountBusinessRole.findMany({ where: { accountId: id } })).map(row => row.role)).toEqual(['VAR']);
  const task = taskInput(), taskRow = await saveTask(db, task, undefined, undefined, admin.id);
  const taskSaved = await saveTask(db, { ...task, status: 'IN_PROGRESS', dueDate: new Date('2026-12-01T12:00:00Z'), accountId: otherAccountId }, taskRow.id, undefined, manager.id, token(taskRow));
  expect(taskSaved.updatedAt.getTime()).toBeGreaterThan(taskRow.updatedAt.getTime());
  for (let n = 0; n < 2; n++) await expect(saveTask(db, task, taskRow.id, undefined, admin.id, token(taskRow))).rejects.toThrow(message);
  expect(await db.task.findUniqueOrThrow({ where: { id: taskRow.id } })).toMatchObject({ status: 'IN_PROGRESS', accountId: otherAccountId, dueDate: new Date('2026-12-01T12:00:00Z') });
  await expect(bulkTasks(db, admin, { confirmed: true, action: 'complete', value: '', records: [{ id: taskSaved.id, updatedAt: token(taskRow) }] })).rejects.toThrow(/changed/);
  expect(await bulkTasks(db, admin, { confirmed: true, action: 'complete', value: '', records: [{ id: taskSaved.id, updatedAt: token(taskSaved) }] })).toBe(1);
  const caseRow = await caseFixture();
  const caseSaved = await updateSupportCase(db, support, caseRow.id, { subject: 'Newer issue', status: 'RESOLVED', resolutionSummary: 'Fixed cable', priority: 'HIGH' }, token(caseRow));
  expect(caseSaved.updatedAt.getTime()).toBeGreaterThan(caseRow.updatedAt.getTime());
  const history = await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: caseRow.id } });
  for (const actor of [admin, support]) for (let n = 0; n < 2; n++) await expect(updateSupportCase(db, actor, caseRow.id, { status: 'OPEN', subject: 'Old issue', resolutionSummary: null }, token(caseRow))).rejects.toThrow(message);
  expect(await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: caseRow.id } })).toBe(history);
  expect(await db.supportCase.findUniqueOrThrow({ where: { id: caseRow.id } })).toMatchObject({ status: 'RESOLVED', resolutionSummary: 'Fixed cable', subject: 'Newer issue' });
  await expect(bulkSupportCases(db, admin, { confirmed: true, action: 'priority', value: 'CRITICAL', records: [{ id: caseSaved.id, updatedAt: token(caseRow) }] })).rejects.toThrow(/changed/);
  expect(await bulkSupportCases(db, admin, { confirmed: true, action: 'priority', value: 'CRITICAL', records: [{ id: caseSaved.id, updatedAt: token(caseSaved) }] })).toBe(1);
});

type Kind = 'Opportunity' | 'Support Case' | 'Account' | 'Task';
for (const width of [1440, 768, 390]) for (const kind of ['Opportunity', 'Support Case', 'Account', 'Task'] as Kind[]) {
  test(`${kind}: two browser users preserve rejected entries and show review controls at ${width}px`, async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    let id: number, path: string, label: string, button: string;
    if (kind === 'Opportunity') { id = await saveOpportunity(db, opportunityInput(), undefined, admin); path = `/opportunities/${id}`; label = 'Opportunity name *'; button = 'Save opportunity'; }
    else if (kind === 'Account') { id = await saveAccount(db, accountInput(), undefined, admin.id); path = `/accounts/${id}`; label = 'Account name'; button = 'Save changes'; }
    else if (kind === 'Task') { id = (await saveTask(db, taskInput(), undefined, undefined, admin.id)).id; path = `/tasks/${id}`; label = 'Subject'; button = 'Save changes'; }
    else { id = (await caseFixture()).id; path = `/support/cases/${id}`; label = 'Subject'; button = 'Save changes'; }
    const second = await browser.newContext({ baseURL });
    const newer = await second.newPage();
    try {
      await signInAs(page, kind === 'Support Case' ? 'support' : 'sales');
      await signInAs(newer, kind === 'Support Case' ? 'admin' : 'salesManager');
      await page.goto(`${path}/edit`); await newer.goto(`${path}/edit`);
      const firstToken = await page.locator('[name="editToken"]').inputValue();
      expect(await newer.locator('[name="editToken"]').inputValue()).toBe(firstToken);
      const myEntry = `My entered ${kind} ${width}`;
      await page.getByLabel(label, { exact: kind !== 'Account' }).fill(myEntry);
      if (kind !== 'Account') await page.locator('textarea[name="description"]').fill('Keep my entered details\nfor comparison.');
      if (kind === 'Opportunity') { await page.locator('[name="quantity"]').fill('7'); await page.getByLabel('OEM', { exact: true }).check(); await newer.locator('[name="quantity"]').fill('3'); await newer.getByLabel('Distributor', { exact: true }).check(); }
      await newer.getByLabel(label, { exact: kind !== 'Account' }).fill(`Newer saved ${kind} ${width}`);
      if (kind === 'Task') { await newer.getByLabel('Due date', { exact: true }).fill('2026-12-10'); await newer.getByLabel('Status', { exact: true }).selectOption('IN_PROGRESS'); }
      if (kind === 'Account') { await newer.getByLabel('Owner', { exact: true }).selectOption(String(manager.id)); await newer.getByLabel('Phone', { exact: true }).fill('555-0123'); }
      await newer.getByRole('button', { name: button, exact: true }).click();
      await expect(newer).toHaveURL(kind === 'Task' ? /\/tasks\/\d+\/edit(?:\?|$)/ : new RegExp(`${path}(\\?|$)`));
      if (kind === 'Task') await expect(newer.locator('[name="editToken"]')).not.toHaveValue(firstToken);
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(page.getByText(message, { exact: true })).toBeInViewport();
        await expect(page.getByLabel(label, { exact: kind !== 'Account' })).toHaveValue(myEntry);
        await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
      }
      if (kind === 'Opportunity') { await expect(page.locator('[name="quantity"]')).toHaveValue('7'); await expect(page.getByLabel('OEM', { exact: true })).toBeChecked(); expect((await db.opportunityProduct.findFirstOrThrow({ where: { opportunityId: id, archivedAt: null } })).quantity).toBe(3); expect(await db.opportunityAccountRole.count({ where: { opportunityId: id, role: 'DISTRIBUTOR' } })).toBe(1); }
      if (kind !== 'Account') await expect(page.locator('textarea[name="description"]')).toHaveValue('Keep my entered details\nfor comparison.');
      // A crafted browser request cannot skip the check by removing its hidden field.
      await page.locator('[name="editToken"]').evaluate(element => element.remove());
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
      const reviewLink = page.getByRole('link', { name: 'Review latest record', exact: true });
      await expect(reviewLink).toHaveAttribute('href', path); await expect(reviewLink).toHaveAttribute('target', '_blank');
      await expect(page.getByRole('button', { name: 'Reload latest form', exact: true })).toBeVisible();
      await expect(page.getByText(message, { exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`record-review-${width}.png`), fullPage: true });
      const row = kind === 'Opportunity' ? await db.opportunity.findUniqueOrThrow({ where: { id } }) : kind === 'Account' ? await db.account.findUniqueOrThrow({ where: { id } }) : kind === 'Task' ? await db.task.findUniqueOrThrow({ where: { id } }) : await db.supportCase.findUniqueOrThrow({ where: { id } });
      expect('name' in row ? row.name : row.subject).toBe(`Newer saved ${kind} ${width}`);
      expect(token(row)).not.toBe(firstToken);
    } finally { await second.close(); }
  });
}

test('competing transactions using one form-open token allow exactly one successful save for each record type', async () => {
  const account = accountInput(), accountId = await saveAccount(db, account, undefined, admin.id);
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const opportunity = opportunityInput(), opportunityId = await saveOpportunity(db, opportunity, undefined, admin);
  const o = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const task = taskInput(), t = await saveTask(db, task, undefined, undefined, admin.id);
  const c = await caseFixture();
  const races = [
    () => [saveAccount(db, { ...account, city: 'Atlanta' }, a.id, admin.id, token(a)), saveAccount(db, { ...account, city: 'Boston' }, a.id, manager.id, token(a))],
    () => [saveOpportunity(db, { ...opportunity, probability: 30 }, o.id, admin, token(o)), saveOpportunity(db, { ...opportunity, probability: 40 }, o.id, manager, token(o))],
    () => [saveTask(db, { ...task, status: 'IN_PROGRESS' }, t.id, undefined, admin.id, token(t)), saveTask(db, { ...task, status: 'COMPLETED' }, t.id, undefined, manager.id, token(t))],
    () => [updateSupportCase(db, admin, c.id, { subject: 'First editor' }, token(c)), updateSupportCase(db, support, c.id, { subject: 'Second editor' }, token(c))],
  ];
  for (const race of races) {
    const results = await Promise.allSettled(race());
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  }
  expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: o.id, eventType: 'PROBABILITY' } })).toBe(1);
  expect(await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: c.id, field: 'subject' } })).toBe(2); // creation plus the winner
});

test('Opportunity reload opens the latest form while comparison leaves the entered draft available', async ({ page }) => {
  const input = opportunityInput(), id = await saveOpportunity(db, input, undefined, admin);
  const opened = await db.opportunity.findUniqueOrThrow({ where: { id } });
  await signInAs(page, 'sales'); await page.goto(`/opportunities/${id}/edit`);
  await page.getByLabel('Opportunity name *').fill('Keep this draft until I choose to reload');
  await saveOpportunity(db, { ...input, name: 'Latest saved details' }, id, manager, token(opened));
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Review latest record', exact: true }).click();
  const latest = await popup;
  await expect(latest.getByRole('heading', { name: 'Latest saved details', exact: true })).toBeVisible();
  await latest.close();
  await expect(page.getByLabel('Opportunity name *')).toHaveValue('Keep this draft until I choose to reload');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reload latest form', exact: true }).click();
  await expect(page.getByLabel('Opportunity name *')).toHaveValue('Latest saved details');
  await expect(page.getByRole('button', { name: 'Resume draft', exact: true })).toHaveCount(0);
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
});

test('Project-page relationship changes prevent an older Opportunity form from restoring its old collection', async ({ page, browser }) => {
  const input = opportunityInput(), id = await saveOpportunity(db, input, undefined, admin);
  const project = await db.project.create({ data: { name: uniqueName('Concurrent Project'), primaryAccountId: accountId, primaryAccountRole: 'END_CUSTOMER', ownerId: manager.id, createdById: manager.id } });
  await signInAs(page, 'sales'); await page.goto(`/opportunities/${id}/edit`);
  await page.getByLabel('Opportunity name *').fill('My older full form');
  const second = await browser.newContext({ baseURL });
  try {
    const projectPage = await second.newPage();
    await signInAs(projectPage, 'salesManager'); await projectPage.goto(`/projects/${project.id}?tab=opportunities`);
    await projectPage.getByLabel('Existing Opportunity').fill(input.name);
    await projectPage.getByRole('option', { name: new RegExp(input.name) }).first().click();
    await projectPage.getByRole('button', { name: 'Link Opportunity', exact: true }).click();
    await expect(projectPage.getByRole('link', { name: input.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Opportunity name *')).toHaveValue('My older full form');
    expect(await db.opportunityProject.count({ where: { opportunityId: id, projectId: project.id } })).toBe(1);
    expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: id, eventType: 'PROJECT_LINKED' } })).toBe(1);
    expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: id, eventType: 'PROJECT_UNLINKED' } })).toBe(0);
  } finally { await second.close(); }
});
