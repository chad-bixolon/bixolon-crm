import { PrismaClient, type Task, type SupportCase } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { bulkTasks, bulkSupportCases } from '../lib/bulk-actions';
import { resolveUserContext } from '../lib/dev-impersonation';
import type { BulkRequest } from '../lib/bulk-action-contract';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
const request = (rows: { id: number; updatedAt: Date }[], action: string, value = ''): BulkRequest => ({ records: rows.map(row => ({ id: row.id, updatedAt: row.updatedAt.toISOString() })), action, value, confirmed: true });
async function tasks(count = 2, assignedToId?: number) {
  const subject = uniqueName('E2E Bulk Tasks');
  const rows: Task[] = [];
  for (let i = 0; i < count; i++) rows.push(await db.task.create({ data: { subject: `${subject} ${i}`, assignedToId } }));
  return { subject, rows };
}
async function cases(count = 2) {
  const subject = uniqueName('E2E Bulk Cases');
  const rows: SupportCase[] = [];
  const admin = await user('admin');
  for (let i = 0; i < count; i++) rows.push(await db.supportCase.create({ data: { caseNumber: uniqueName('BULK'), subject: `${subject} ${i}`, customerNameText: 'Bulk queue customer', description: 'Bulk test', source: 'PHONE', createdById: admin.id, updatedById: admin.id } }));
  return { subject, rows };
}
test.afterAll(() => db.$disconnect());

test('server Task operations preserve assignment history, notifications, completion and effective actor', async () => {
  const admin = await user('admin'), sales = await user('sales');
  const f = await tasks(2, admin.id);
  expect(await bulkTasks(db, admin, request(f.rows, 'assign', String(sales.id)))).toBe(2);
  expect(await db.taskAssignmentEvent.count({ where: { taskId: { in: f.rows.map(row => row.id) }, actorId: admin.id, fromUserId: admin.id, toUserId: sales.id } })).toBe(2);
  expect(await db.notification.count({ where: { entityType: 'TASK', entityId: { in: f.rows.map(row => row.id) }, userId: sales.id, type: 'TASK_ASSIGNED' } })).toBe(2);
  const real = { ...admin, name: 'Admin' };
  const context = await resolveUserContext(real, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  expect(context.impersonating).toBe(true);
  const assigned = await db.task.findMany({ where: { id: { in: f.rows.map(row => row.id) } } });
  await bulkTasks(db, context.effective!, request(assigned, 'dueDate', '2026-12-18'));
  const dated = await db.task.findMany({ where: { id: { in: assigned.map(row => row.id) } } });
  expect(dated.every(row => row.dueDate?.toISOString().startsWith('2026-12-18') && row.updatedById === sales.id)).toBe(true);
  await bulkTasks(db, context.effective!, request(dated, 'complete'));
  const done = await db.task.findMany({ where: { id: { in: assigned.map(row => row.id) } } });
  expect(done.every(row => row.status === 'COMPLETED' && row.completedAt && row.updatedById === sales.id)).toBe(true);
  await expect(bulkTasks(db, admin, request(dated, 'complete'))).rejects.toThrow(/changed|unavailable/);
});

test('server rejects mixed states, archived parents, inaccessible Project work, stale/deleted IDs and invalid targets atomically', async () => {
  const admin = await user('admin'), sales = await user('sales'), support = await user('support');
  const f = await tasks(2, sales.id);
  const a = f.rows[0], b = f.rows[1];
  const denied = async (actor = admin) => {
    await expect(bulkTasks(db, actor, request(f.rows, 'complete'))).rejects.toThrow(/changed|unavailable|Access denied/);
    expect((await db.task.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('OPEN');
  };
  for (const status of ['CANCELLED', 'COMPLETED'] as const) { await db.task.update({ where: { id: b.id }, data: { status } }); await denied(); }
  await db.task.update({ where: { id: b.id }, data: { status: 'OPEN', archivedAt: new Date() } }); await denied();
  const account = await db.account.create({ data: { name: uniqueName('Bulk archived parent'), status: 'ARCHIVED', archivedAt: new Date() } });
  await db.task.update({ where: { id: b.id }, data: { archivedAt: null, accountId: account.id } }); await denied();
  const project = await db.project.create({ data: { name: uniqueName('Bulk foreign Project'), ownerId: admin.id, createdById: admin.id, primaryAccountRole: 'PROGRAM_OWNER' } });
  const foreign = await db.task.update({ where: { id: b.id }, data: { accountId: null, projectId: project.id } });
  await expect(bulkTasks(db, sales, request([a, foreign], 'complete'))).rejects.toThrow(/changed|unavailable/);
  const reassigned = await db.task.update({ where: { id: b.id }, data: { projectId: null, assignedToId: admin.id } });
  await expect(bulkTasks(db, sales, request([a, reassigned], 'complete'))).rejects.toThrow(/changed|unavailable/);
  await denied(); // stale version even for Admin
  await expect(bulkTasks(db, admin, request([a], 'assign', String(support.id)))).rejects.toThrow(/eligible/);
  await expect(bulkTasks(db, admin, request([a], 'dueDate', '2026-02-30'))).rejects.toThrow(/valid due date/);
  await expect(bulkTasks(db, admin, request([a], 'archive'))).rejects.toThrow(/Invalid/);
  await db.task.delete({ where: { id: b.id } }); await denied();
  for (const role of ['readOnly', 'support'] as const) await expect(bulkTasks(db, await user(role), request([a], 'complete'))).rejects.toThrow(/Access denied/);
  const invalid = await db.task.create({ data: { subject: '' } });
  await expect(bulkTasks(db, admin, request([a, invalid], 'complete'))).rejects.toThrow(/individual review/);
  expect((await db.task.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('OPEN');
});

test('Task validation failure after an earlier write rolls back changes and assignment events', async () => {
  const admin = await user('admin'), sales = await user('sales');
  const f = await tasks(2, admin.id), c = await cases(1);
  const account = await db.account.create({ data: { name: uniqueName('Bulk mismatched case Account') } });
  f.rows[1] = await db.task.update({ where: { id: f.rows[1].id }, data: { supportCaseId: c.rows[0].id, accountId: account.id } });
  await expect(bulkTasks(db, admin, request(f.rows, 'assign', String(sales.id)))).rejects.toThrow(/Account does not match/);
  expect((await db.task.findUniqueOrThrow({ where: { id: f.rows[0].id } })).assignedToId).toBe(admin.id);
  expect(await db.taskAssignmentEvent.count({ where: { taskId: f.rows[0].id } })).toBe(0);
  expect(await db.notification.count({ where: { entityType: 'TASK', entityId: f.rows[0].id } })).toBe(0);
});

test('server Case assignment and priority retain per-record history and notifications; invalid selections roll back', async () => {
  const admin = await user('admin'), support = await user('support');
  const f = await cases();
  expect(await bulkSupportCases(db, support, request(f.rows, 'assign', String(support.id)))).toBe(2);
  const assigned = await db.supportCase.findMany({ where: { id: { in: f.rows.map(row => row.id) } } });
  expect(await bulkSupportCases(db, admin, request(assigned, 'priority', 'CRITICAL'))).toBe(2);
  for (const row of f.rows) {
    const events = await db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: row.id } });
    expect(events.find(event => event.field === 'assignedToId')).toMatchObject({ actorId: support.id, newValue: String(support.id) });
    expect(events.find(event => event.field === 'priority')).toMatchObject({ actorId: admin.id, newValue: 'CRITICAL' });
    expect(await db.notification.count({ where: { entityType: 'SUPPORT_CASE', entityId: row.id, type: 'SUPPORT_CRITICAL' } })).toBe(1);
  }
  await expect(bulkSupportCases(db, admin, request(f.rows, 'priority', 'LOW'))).rejects.toThrow(/changed/);
  const current = await db.supportCase.findMany({ where: { id: { in: f.rows.map(row => row.id) } } });
  await expect(bulkSupportCases(db, admin, request(current, 'assign', String((await user('sales')).id)))).rejects.toThrow(/eligible/);
  await expect(bulkSupportCases(db, admin, request(current, 'status', 'CLOSED'))).rejects.toThrow(/Invalid/);
  for (const role of ['readOnly', 'sales'] as const) await expect(bulkSupportCases(db, await user(role), request(current, 'priority', 'LOW'))).rejects.toThrow(/Access denied/);
  const eventsBefore = await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: current[0].id } });
  current[1] = await db.supportCase.update({ where: { id: current[1].id }, data: { status: 'RESOLVED', resolutionSummary: null } });
  await expect(bulkSupportCases(db, admin, request(current, 'priority', 'LOW'))).rejects.toThrow(/Resolution Summary/);
  expect((await db.supportCase.findUniqueOrThrow({ where: { id: current[0].id } })).priority).toBe('CRITICAL');
  expect(await db.supportCaseLifecycleEvent.count({ where: { supportCaseId: current[0].id } })).toBe(eventsBefore);
  current[1] = await db.supportCase.update({ where: { id: current[1].id }, data: { archivedAt: new Date() } });
  await expect(bulkSupportCases(db, admin, request(current, 'priority', 'LOW'))).rejects.toThrow(/unavailable/);
  const deleted = (await cases(1)).rows[0];
  await db.supportCase.delete({ where: { id: deleted.id } });
  await expect(bulkSupportCases(db, admin, request([current[0], deleted], 'priority', 'LOW'))).rejects.toThrow(/unavailable/);
});

// These tests use the real server actions through the browser, including effective-user resolution.
test('Task page selection, confirmation, filtering, pagination and all three mutations', async ({ page }) => {
  test.setTimeout(120_000);
  const f = await tasks(22), admin = await user('admin');
  await signInAs(page, 'admin');
  const url = `/tasks?q=${encodeURIComponent(f.subject)}&page=2&priority=NORMAL`;
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0);
  const selectPage = page.getByRole('checkbox', { name: 'Select eligible records on this page' });
  await selectPage.check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox', { name: `Select ${f.rows[0].subject}`, exact: true }).uncheck();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await selectPage.check();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await selectPage.check();
  for (const [button, field, value] of [['Change due date', 'Due date', '2026-12-20'], ['Assign', 'Assignee', String(admin.id)]] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
    if (field === 'Due date') await dialog.getByLabel(field, { exact: true }).fill(value); else await dialog.getByLabel(field).selectOption(value);
    await expect(dialog).toContainText('2 selected Tasks');
    await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('status').filter({ hasText: '2 Tasks updated.' })).toBeVisible();
    await selectPage.check();
  }
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await db.task.count({ where: { subject: { startsWith: f.subject }, status: 'COMPLETED' } })).toBe(0);
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm 2 updates' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await db.task.count({ where: { subject: { startsWith: f.subject }, status: 'COMPLETED' } })).toBe(2);
  await expect(page).toHaveURL(url);
  await page.getByRole('link', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
  await expect(page.getByText('20 selected', { exact: true })).toBeVisible();
});

test('Case UI assignment/priority and role filtering, including Test as user', async ({ page }) => {
  test.setTimeout(120_000);
  const f = await cases(), support = await user('support'), sales = await user('sales');
  await signInAs(page, 'support');
  const url = `/support/cases?q=${encodeURIComponent(f.subject)}&sort=oldest&page=1`;
  await page.goto(url);
  for (const [button, field, value] of [['Assign', 'Support Rep', String(support.id)], ['Change priority', 'Priority', 'HIGH']] as const) {
    await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('dialog').getByLabel(field, { exact: true }).selectOption(value);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm 2 updates' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page).toHaveURL(url);
  }
  for (const role of ['readOnly', 'sales', 'marketing'] as const) {
    await signInAs(page, role); await page.goto(url);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  }
  const t = await tasks(1, sales.id);
  await signInAs(page, 'readOnly'); await page.goto(`/tasks?q=${encodeURIComponent(t.subject)}`);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await signInAs(page, 'admin'); await page.goto('/dev/impersonation');
    await page.locator('main li').filter({ hasText: emails.sales }).getByRole('button', { name: 'Test as user' }).click();
    await page.goto(`/tasks?q=${encodeURIComponent(t.subject)}`);
    await page.getByRole('checkbox', { name: `Select ${t.rows[0].subject}`, exact: true }).check();
    await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm 1 updates' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((await db.task.findUniqueOrThrow({ where: { id: t.rows[0].id } })).updatedById).toBe(sales.id);
    await page.goto(url); await expect(page.getByRole('checkbox')).toHaveCount(0);
  }
});

test('a failed stale selection retains the confirmation target and changes no records', async ({ page }) => {
  const f = await tasks(), admin = await user('admin');
  await signInAs(page, 'admin');
  await page.goto(`/tasks?q=${encodeURIComponent(f.subject)}`);
  await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
  await dialog.getByLabel('Assignee', { exact: true }).selectOption(String(admin.id));
  await db.task.update({ where: { id: f.rows[1].id }, data: { priority: 'HIGH' } });
  await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
  await expect(dialog.getByRole('alert')).toContainText('No records changed');
  await expect(dialog.getByLabel('Assignee', { exact: true })).toHaveValue(String(admin.id));
  await expect(dialog).toContainText('Assign 2 selected Tasks');
  expect((await db.task.findUniqueOrThrow({ where: { id: f.rows[0].id } })).assignedToId).toBeNull();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
});
