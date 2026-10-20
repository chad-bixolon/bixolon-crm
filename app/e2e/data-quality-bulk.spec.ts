import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { bulkQualityOwners } from '../lib/data-quality-bulk';
import { qualityCounts, qualityRows } from '../lib/data-quality';
import { adminAudit } from '../lib/admin-audit';
import { resolveUserContext } from '../lib/dev-impersonation';
import type { BulkRequest } from '../lib/bulk-action-contract';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
const request = (rows: { id: number; updatedAt: Date | string }[], ownerId: number): BulkRequest => ({ records: rows.map(row => ({ id: row.id, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString() })), action: 'assign', value: String(ownerId), confirmed: true });
async function fixture(issue: 'account-owner' | 'account-owner-inactive' | 'opportunity-owner', count = 2) {
  const q = uniqueName('E2E quality bulk');
  const scope = { issue, q, page: 1 };
  const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
  const former = issue === 'account-owner-inactive' ? await db.user.create({ data: { email: `${q.replaceAll(' ', '')}@example.test`, firstName: 'Former', lastName: 'Owner', role: 'SALES', active: false } }) : null;
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(issue !== 'opportunity-owner'
    ? await db.account.create({ data: { name: `${q} ${i}`, ownerId: former?.id } })
    : await db.opportunity.create({ data: { name: `${q} ${i}`, stageId: stage.id } }));
  return { scope, rows, priorOwnerId: former?.id ?? null };
}
test.afterAll(() => db.$disconnect());

test('unavailable-owner Accounts follow current eligibility, excluding unowned and noncurrent Accounts', async () => {
  const f = await fixture('account-owner-inactive', 1), valid = await user('sales');
  const unavailable = [f.rows[0]];
  for (const state of [{ active: false, archivedAt: new Date(), role: 'SALES' }, { active: true, archivedAt: null, role: 'SUPPORT' }] as const) {
    const former = await db.user.create({ data: { ...state, email: `${uniqueName('former').replaceAll(' ', '')}@example.test`, firstName: 'Former', lastName: 'Owner' } });
    unavailable.push(await db.account.create({ data: { name: `${f.scope.q} unavailable`, ownerId: former.id } }));
  }
  for (const data of [{ ownerId: valid.id }, { ownerId: null }, { ownerId: f.priorOwnerId, status: 'INACTIVE' }, { ownerId: f.priorOwnerId, archivedAt: new Date(), status: 'ARCHIVED' }] as const) {
    await db.account.create({ data: { name: `${f.scope.q} excluded`, ...data } });
  }
  const result = await qualityRows(db, 'account-owner-inactive', f.scope.q, 1);
  expect(result.count).toBe(3);
  expect(result.rows.map(row => row.id).sort()).toEqual(unavailable.map(row => row.id).sort());
  await bulkQualityOwners(db, await user('admin'), f.scope, request(result.rows.map(row => ({ id: row.id, updatedAt: row.updatedAt! })), valid.id));
  expect((await qualityRows(db, 'account-owner-inactive', f.scope.q, 1)).count).toBe(0);
});

test('restored current owner rejects reassignment even when Account version has not changed', async () => {
  const f = await fixture('account-owner-inactive'), admin = await user('admin'), owner = await user('sales');
  await db.user.update({ where: { id: f.priorOwnerId! }, data: { active: true } });
  expect((await db.account.findUniqueOrThrow({ where: { id: f.rows[0].id } })).updatedAt).toEqual(f.rows[0].updatedAt);
  await expect(bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id))).rejects.toThrow(/changed|unavailable/);
  expect(await db.account.count({ where: { id: { in: f.rows.map(row => row.id) }, ownerId: f.priorOwnerId } })).toBe(2);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Account', action: 'Reassign', recordIds: { has: f.rows[0].id } } })).toBe(0);
});

test('reassignment advances the Account version and rejects an individual form opened before it', async () => {
  const { assertEditToken, recordChangedMessage } = await import('../lib/stale-edit');
  const f = await fixture('account-owner-inactive'), owner = await user('sales');
  await bulkQualityOwners(db, await user('admin'), f.scope, request(f.rows, owner.id));
  const current = await db.account.findUniqueOrThrow({ where: { id: f.rows[0].id } });
  expect(current.updatedAt.getTime()).toBeGreaterThan(f.rows[0].updatedAt.getTime());
  expect(() => assertEditToken(current.updatedAt, f.rows[0].updatedAt.toISOString())).toThrow(recordChangedMessage);
});

test('replacement owner deactivated after browser selection rejects the group and keeps confirmation open', async ({ page }) => {
  const f = await fixture('account-owner-inactive');
  const owner = await db.user.create({ data: { email: `${uniqueName('replacement').replaceAll(' ', '')}@example.test`, firstName: 'Available', lastName: 'At Load', role: 'SALES' } });
  await signInAs(page, 'admin');
  await page.goto(`/administration/data-quality?issue=account-owner-inactive&q=${encodeURIComponent(f.scope.q)}`);
  await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
  await page.getByLabel('New owner', { exact: true }).selectOption(String(owner.id));
  await page.getByRole('button', { name: 'Reassign owner', exact: true }).click();
  await db.user.update({ where: { id: owner.id }, data: { active: false } });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The chosen owner is no longer available. No records changed.');
  await expect(dialog).toBeVisible();
  expect(await db.account.count({ where: { id: { in: f.rows.map(row => row.id) }, ownerId: f.priorOwnerId } })).toBe(2);
});

for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner'] as const) {
  const action = issue === 'account-owner-inactive' ? 'Reassign' : 'Assign owner';
  const verb = issue === 'account-owner-inactive' ? 'reassigned' : 'assigned';
  const button = issue === 'account-owner-inactive' ? 'Reassign owner' : 'Assign owner';
  test(`${issue}: assigns atomically, refreshes counts and captures destination, actor and record references`, async () => {
    const admin = await user('admin'), owner = await user('sales');
    const f = await fixture(issue);
    const contact = issue !== 'opportunity-owner' ? await db.contact.create({ data: { firstName: 'Inherited', lastName: 'Owner', accountId: f.rows[0].id } }) : null;
    const before = await qualityCounts(db);
    expect(await bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id))).toBe(2);
    expect((await qualityCounts(db))[issue]).toBe(before[issue] - 2);
    expect((await qualityRows(db, issue, f.scope.q, 1)).count).toBe(0);
    const ids = f.rows.map(row => row.id);
    const saved = issue !== 'opportunity-owner' ? await db.account.findMany({ where: { id: { in: ids } } }) : await db.opportunity.findMany({ where: { id: { in: ids } } });
    expect(saved.every(row => row.ownerId === owner.id && row.updatedById === admin.id)).toBe(true);
    const event = await db.adminMaintenanceEvent.findFirstOrThrow({ where: { entityType: issue !== 'opportunity-owner' ? 'Account' : 'Opportunity', action, recordIds: { equals: ids } } });
    expect(event).toMatchObject({ actorId: admin.id, recordCount: 2, newOwnerId: owner.id, newOwnerName: `${owner.firstName} ${owner.lastName}` });
    expect(event.occurredAt).toBeInstanceOf(Date);
    if (contact) {
      const inherited = await db.contact.findUniqueOrThrow({ where: { id: contact.id }, include: { account: true } });
      expect(inherited.account?.ownerId).toBe(owner.id);
      expect(inherited.updatedAt).toEqual(contact.updatedAt);
    }
    else {
      expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: { in: ids }, eventType: 'OWNER', actorId: admin.id, newOwnerId: owner.id } })).toBe(2);
      expect(await db.notification.count({ where: { entityType: 'OPPORTUNITY', entityId: { in: ids }, userId: owner.id, type: 'OPP_ASSIGNED' } })).toBe(2);
    }
    await expect(bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id))).rejects.toThrow(/changed|unavailable/);
  });

  test(`${issue}: stale, archived, deleted, closed or corrected selections reject the entire group`, async () => {
    const admin = await user('admin'), owner = await user('sales');
    for (const change of ['stale', 'archived', 'deleted', 'corrected', 'inactive-or-closed']) {
      const f = await fixture(issue);
      const second = f.rows[1];
      if (issue !== 'opportunity-owner') {
        if (change === 'deleted') await db.account.delete({ where: { id: second.id } });
        else await db.account.update({ where: { id: second.id }, data: change === 'stale' ? { name: 'Changed after loading' } : change === 'corrected' ? { ownerId: owner.id } : change === 'archived' ? { archivedAt: new Date(), status: 'ARCHIVED' } : { status: 'INACTIVE' } });
      } else {
        const closed = await db.salesStage.upsert({ where: { name: 'E2E Quality Closed' }, update: {}, create: { name: 'E2E Quality Closed', isClosed: true, probability: 0, sortOrder: 999 } });
        if (change === 'deleted') await db.opportunity.delete({ where: { id: second.id } });
        else await db.opportunity.update({ where: { id: second.id }, data: change === 'stale' ? { name: 'Changed after loading' } : change === 'corrected' ? { ownerId: owner.id } : change === 'archived' ? { archivedAt: new Date() } : { stageId: closed.id } });
      }
      // Fresh versions must still fail the issue predicate, not just the version check.
      if (change !== 'stale' && change !== 'deleted') {
        const current = await (issue !== 'opportunity-owner' ? db.account.findUniqueOrThrow({ where: { id: second.id } }) : db.opportunity.findUniqueOrThrow({ where: { id: second.id } }));
        f.rows[1] = current;
      }
      await expect(bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id))).rejects.toThrow(/changed|unavailable/);
      const untouched = await (issue !== 'opportunity-owner' ? db.account.findUniqueOrThrow({ where: { id: f.rows[0].id } }) : db.opportunity.findUniqueOrThrow({ where: { id: f.rows[0].id } }));
      expect(untouched.ownerId).toBe(f.priorOwnerId);
      expect(await db.adminMaintenanceEvent.count({ where: { action, recordIds: { has: f.rows[0].id }, entityType: issue !== 'opportunity-owner' ? 'Account' : 'Opportunity' } })).toBe(0);
    }
  });

  test(`${issue}: real confirmation refreshes results and history using business wording`, async ({ page }) => {
    const owner = await user('sales'), f = await fixture(issue);
    await signInAs(page, 'admin');
    const url = `/administration/data-quality?issue=${issue}&q=${encodeURIComponent(f.scope.q)}`;
    await page.goto(url);
    const card = page.getByRole('link', { name: issue === 'account-owner-inactive' ? /^Accounts assigned to unavailable owners/ : issue !== 'opportunity-owner' ? /^Accounts without a sales owner/ : /^Open Opportunities without an owner/ });
    const count = Number(await card.locator('span').first().textContent());
    await expect(page.getByRole('button', { name: button, exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: button, exact: true })).toBeDisabled();
    await page.getByLabel('New owner', { exact: true }).selectOption(String(owner.id));
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
    await expect(dialog).toContainText(`${owner.firstName} ${owner.lastName}`);
    if (issue === 'account-owner-inactive') await expect(dialog).toContainText(`Reassign 2 Accounts from unavailable owners to ${owner.firstName} ${owner.lastName}?`);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await qualityRows(db, issue, f.scope.q, 1)).count).toBe(2);
    await page.getByRole('button', { name: button, exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: `${verb} successfully` })).toHaveText(`2 ${issue !== 'opportunity-owner' ? 'Accounts' : 'Opportunities'} were ${verb} successfully.`);
    await expect(page.getByRole('link', { name: 'Open record', exact: true })).toHaveCount(0);
    await expect(card.locator('span').first()).toHaveText(String(count - 2));
    await expect(page.getByText(issue === 'account-owner-inactive' ? 'No Accounts need owner reassignment for these filters.' : `No ${issue !== 'opportunity-owner' ? 'Accounts' : 'Opportunities'} need an owner for these filters.`)).toBeVisible();
    await page.goto(`/administration/maintenance-history?entity=${issue !== 'opportunity-owner' ? 'Account' : 'Opportunity'}&action=${encodeURIComponent(action)}`);
    const entry = page.locator('article').filter({ has: page.getByRole('link', { name: `Open record #${f.rows[0].id}`, exact: true }) });
    await expect(entry).toContainText(`${issue === 'account-owner-inactive' ? 'Reassigned' : 'Assigned'} 2 ${issue !== 'opportunity-owner' ? 'Accounts' : 'Opportunities'} to ${owner.firstName} ${owner.lastName}`);
    await expect(entry.getByRole('link', { name: /^Open record #/ })).toHaveCount(2);
  });
}

for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner'] as const) test(`${issue}: owner eligibility and live Admin permission are rechecked, including impersonation`, async () => {
  const admin = await user('admin'), sales = await user('sales');
  const f = await fixture(issue);
  const target = await db.user.create({ data: { email: `${uniqueName('target').replaceAll(' ', '')}@example.test`, firstName: 'Jane', lastName: 'Smith with a display name longer than forty characters', role: 'SALES' } });
  for (const state of [{ active: false, role: 'SALES' }, { active: true, role: 'SUPPORT' }, { active: false, role: 'SALES', archivedAt: new Date() }] as const) {
    await db.user.update({ where: { id: target.id }, data: state });
    await expect(bulkQualityOwners(db, admin, f.scope, request(f.rows, target.id))).rejects.toThrow(/no longer available/);
  }
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) await expect(bulkQualityOwners(db, await user(role), f.scope, request(f.rows, sales.id))).rejects.toThrow(/Access denied/);
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  expect(context.impersonating).toBe(true);
  await expect(bulkQualityOwners(db, context.effective!, f.scope, request(f.rows, sales.id))).rejects.toThrow(/Access denied/);
  const temporaryAdmin = await db.user.create({ data: { email: `${uniqueName('admin').replaceAll(' ', '')}@example.test`, firstName: 'Temporary', lastName: 'Admin', role: 'ADMIN' } });
  await db.user.update({ where: { id: temporaryAdmin.id }, data: { role: 'SALES' } });
  await expect(bulkQualityOwners(db, temporaryAdmin, f.scope, request(f.rows, sales.id))).rejects.toThrow(/Access denied/);
  expect((await (issue === 'opportunity-owner' ? db.opportunity.findUniqueOrThrow({ where: { id: f.rows[0].id } }) : db.account.findUniqueOrThrow({ where: { id: f.rows[0].id } }))).ownerId).toBe(f.priorOwnerId);
  await db.user.update({ where: { id: target.id }, data: { active: true, archivedAt: null } });
  await bulkQualityOwners(db, admin, f.scope, request(f.rows, target.id));
  await db.user.update({ where: { id: target.id }, data: { firstName: 'Renamed' } });
  const history = await adminAudit(db, admin, { entity: issue === 'opportunity-owner' ? 'Opportunity' : 'Account', action: issue === 'account-owner-inactive' ? 'Reassign' : 'Assign owner' }, true);
  expect(history.rows.some(row => row.name === `${issue === 'account-owner-inactive' ? 'Reassigned' : 'Assigned'} 2 ${issue === 'opportunity-owner' ? 'Opportunities' : 'Accounts'} to Jane ${target.lastName}`)).toBe(true);
});

test('Opportunities with unavailable owners retain before/after history; closed stages changed after load are rejected', async () => {
  const admin = await user('admin'), owner = await user('sales');
  const f = await fixture('opportunity-owner');
  const former = await db.user.create({ data: { email: `${uniqueName('former').replaceAll(' ', '')}@example.test`, firstName: 'Former', lastName: 'Rep', role: 'SALES', active: false } });
  f.rows[0] = await db.opportunity.update({ where: { id: f.rows[0].id }, data: { ownerId: former.id } });
  await bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id));
  expect(await db.opportunityHistoryEvent.findFirstOrThrow({ where: { opportunityId: f.rows[0].id, eventType: 'OWNER' } })).toMatchObject({ oldOwnerId: former.id, oldOwnerName: 'Former Rep', newOwnerId: owner.id });
  const stage = await db.salesStage.create({ data: { name: uniqueName('Stage changes'), sortOrder: 999, probability: 10 } });
  const g = await fixture('opportunity-owner');
  g.rows[1] = await db.opportunity.update({ where: { id: g.rows[1].id }, data: { stageId: stage.id } });
  await db.salesStage.update({ where: { id: stage.id }, data: { isClosed: true, probability: 0 } });
  await expect(bulkQualityOwners(db, admin, g.scope, request(g.rows, owner.id))).rejects.toThrow(/changed|unavailable/);
});

test('selection is bounded to 20 on one current page and search; failure after writes rolls back records, history and notifications', async () => {
  const admin = await user('admin'), owner = await user('sales');
  for (const issue of ['account-owner', 'account-owner-inactive'] as const) {
    const f = await fixture(issue, 21);
    await expect(bulkQualityOwners(db, admin, f.scope, request(f.rows, owner.id))).rejects.toThrow(/between 1 and 20/);
    await expect(bulkQualityOwners(db, admin, f.scope, request([f.rows[0]], owner.id))).rejects.toThrow(/current page changed/);
    await expect(bulkQualityOwners(db, admin, { ...f.scope, q: 'unrelated' }, request([f.rows[20]], owner.id))).rejects.toThrow(/current page changed/);
    await expect(bulkQualityOwners(db, admin, { ...f.scope, issue: 'opportunity-close' }, request([f.rows[20]], owner.id))).rejects.toThrow(/individual review/);
    await expect(bulkQualityOwners(db, admin, f.scope, { ...request([f.rows[20]], owner.id), confirmed: false })).rejects.toThrow(/confirmation/);
  }
  for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner'] as const) {
    const g = await fixture(issue);
    // Fail the final maintenance write after the real record/history/notification writes.
    const failing = db.$extends({ query: { adminMaintenanceEvent: { async create() { throw new Error('History write rejected'); } } } });
    await expect(bulkQualityOwners(failing as unknown as PrismaClient, admin, g.scope, request(g.rows, owner.id))).rejects.toThrow(/History write rejected/);
    const ids = g.rows.map(row => row.id);
    const saved = issue !== 'opportunity-owner' ? await db.account.findMany({ where: { id: { in: ids } } }) : await db.opportunity.findMany({ where: { id: { in: ids } } });
    expect(saved.every(row => row.ownerId === g.priorOwnerId)).toBe(true);
    if (issue === 'opportunity-owner') {
      expect(await db.opportunityHistoryEvent.count({ where: { opportunityId: { in: ids } } })).toBe(0);
      expect(await db.notification.count({ where: { entityType: 'OPPORTUNITY', entityId: { in: ids } } })).toBe(0);
    }
  }
});

for (const accountIssue of ['account-owner', 'account-owner-inactive'] as const) test(`${accountIssue}: current-page select all, clear, search and pagination reset selection; other checks remain individual review`, async ({ page }) => {
  const f = await fixture(accountIssue, 22);
  await signInAs(page, 'admin');
  await page.goto(`/administration/data-quality?issue=${accountIssue}&q=${encodeURIComponent(f.scope.q)}`);
  const select = page.getByRole('checkbox', { name: 'Select eligible records on this page' });
  await select.check();
  await expect(page.getByText('20 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(21);
  await page.getByRole('checkbox', { name: `Select ${f.rows[21].name}`, exact: true }).uncheck();
  await expect(page.getByText('19 selected', { exact: true })).toBeVisible();
  await select.check();
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Bulk actions', { exact: true })).toHaveCount(0);
  await select.check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByLabel('Bulk actions', { exact: true })).toHaveCount(0);
  await select.check();
  await page.getByRole('textbox', { name: 'Search Accounts' }).fill(f.rows[0].name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Bulk actions', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open record', exact: true })).toHaveCount(1);
  for (const issue of ['contact-account', 'project-account', 'duplicate-account', 'duplicate-contact', 'opportunity-close', 'task-archived-link']) {
    await page.goto(`/administration/data-quality?issue=${issue}`);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  }
});

test('browser denial and Test as user respect effective Admin rules', async ({ page }) => {
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) {
    await signInAs(page, role);
    await page.goto('/administration/data-quality?issue=account-owner-inactive');
    await expect(page).toHaveURL(/access-denied/);
  }
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await signInAs(page, 'admin');
    await page.goto('/dev/impersonation');
    await page.locator('main li').filter({ hasText: emails.sales }).getByRole('button', { name: 'Test as user' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Return to Admin' })).toBeVisible();
    await page.goto('/administration/data-quality?issue=account-owner-inactive');
    await expect(page).toHaveURL(/access-denied/);
  }
});

for (const issue of ['account-owner', 'account-owner-inactive'] as const) test(`${issue}: assigning the last page keeps the success message and shows the remaining page with accurate counts`, async ({ page }) => {
  const f = await fixture(issue, 22), owner = await user('sales');
  await signInAs(page, 'admin');
  await page.goto(`/administration/data-quality?issue=${issue}&q=${encodeURIComponent(f.scope.q)}&page=2`);
  await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
  await page.getByLabel('New owner', { exact: true }).selectOption(String(owner.id));
  await page.getByRole('button', { name: issue === 'account-owner-inactive' ? 'Reassign owner' : 'Assign owner', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm 2 updates' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /(?:re)?assigned successfully/ })).toHaveText(`2 Accounts were ${issue === 'account-owner-inactive' ? 'reassigned' : 'assigned'} successfully.`);
  await expect(page.getByRole('heading', { name: `${issue === 'account-owner-inactive' ? 'Accounts assigned to unavailable owners' : 'Accounts without a sales owner'} (20)` })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Issue results pages' })).toContainText('Page 1 of 1');
  await expect(page.getByRole('link', { name: 'Open record', exact: true })).toHaveCount(20);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

for (const width of [1440, 768, 820, 1024, 390]) for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner'] as const) {
  test(`${issue} selection, wrapped toolbar and confirmation fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const f = await fixture(issue), owner = await user('sales');
    await signInAs(page, 'admin');
    await page.goto(`/administration/data-quality?issue=${issue}&q=${encodeURIComponent(f.scope.q)}`);
    const select = page.getByRole('checkbox', { name: 'Select eligible records on this page' });
    const hit = await select.locator('..').boundingBox();
    expect(hit!.height).toBeGreaterThanOrEqual(44);
    await select.check();
    const toolbar = page.getByLabel('Bulk actions', { exact: true });
    await page.getByLabel('New owner', { exact: true }).selectOption(String(owner.id));
    const assign = page.getByRole('button', { name: issue === 'account-owner-inactive' ? 'Reassign owner' : 'Assign owner', exact: true });
    for (const control of [assign, page.getByRole('button', { name: 'Clear selection' }), page.getByLabel('New owner', { exact: true })]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(width < 1280 ? 44 : 40);
    }
    const bounds = await toolbar.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await assign.click();
    const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`quality-${issue}-${width}.png`) });
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(assign).toBeFocused();
    const scroll = page.locator('table').locator('..');
    expect(await scroll.evaluate(node => getComputedStyle(node).overflowX)).toBe('auto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Open record', exact: true })).toHaveCount(2);
  });
}
