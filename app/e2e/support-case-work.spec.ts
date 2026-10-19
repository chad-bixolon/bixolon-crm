import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(async () => { await db.$disconnect(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`Support Case without Account: Note and Task edit/complete/reopen at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await signInAs(page, 'support');
    await page.goto('/support/cases/new');
    await page.getByLabel('Customer / End User').fill('Case work customer without Account');
    await page.getByLabel('Subject').fill(uniqueName('E2E complete case work'));
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
    await page.getByLabel('Description').fill('Investigate printer diagnostics.');
    await page.getByRole('button', { name: 'Create case' }).click();
    await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
    const casePath = new URL(page.url()).pathname;
    const caseId = Number(casePath.split('/').at(-1));

    await page.getByRole('link', { name: 'Add Note', exact: true }).click();
    await expect(page.getByText('No linked Account', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Account', exact: true })).toHaveCount(0);
    await page.getByLabel('Note', { exact: true }).fill('Investigating logs without requiring an Account.');
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${casePath}$`));
    const note = await db.note.findFirstOrThrow({ where: { supportCaseId: caseId } });
    expect(note.accountId).toBeNull();
    const timeline = page.getByRole('region', { name: 'Case Timeline' });
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await expect(timeline.getByRole('heading', { name: 'Note added', exact: true })).toHaveCount(1);
    await expect(timeline).toContainText(note.body);

    await page.getByRole('link', { name: 'Create Task', exact: true }).click();
    const taskTitle = uniqueName('E2E case diagnostics');
    await page.getByLabel('Subject', { exact: true }).fill(taskTitle);
    await page.getByLabel('Description', { exact: true }).fill('Read the printer logs.');
    await page.getByLabel('Assignee', { exact: true }).selectOption({ label: 'E2E support' });
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/\d+(?:\?saved=created)?$/);
    const taskId = Number(new URL(page.url()).pathname.split('/').at(-1));
    await page.getByRole('link', { name: 'Edit / complete task', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Assignee', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive task' })).toHaveCount(0);
    await page.getByLabel('Subject', { exact: true }).fill(`${taskTitle} reviewed`);
    await page.getByLabel('Description', { exact: true }).fill('Reviewed diagnostics and verified firmware.');
    await page.getByLabel('Due date', { exact: true }).fill('2026-11-10');
    await page.getByLabel('Status', { exact: true }).selectOption('COMPLETED');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('COMPLETED');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    let task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('COMPLETED');
    expect(task.description).toBe('Reviewed diagnostics and verified firmware.');
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(task.completedAt).not.toBeNull();
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`case-task-${viewport.width}.png`), fullPage: true });

    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    const tasks = page.getByRole('region', { name: 'Case Tasks' });
    await expect(tasks).toContainText('COMPLETED');
    await expect(tasks.getByRole('link', { name: 'Edit / complete task' })).toBeVisible();
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await expect(timeline.getByRole('heading', { name: 'Task completed', exact: true })).toHaveCount(1);
    await tasks.getByRole('link', { name: 'Edit / complete task' }).click();
    await page.getByLabel('Status', { exact: true }).selectOption('OPEN');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('OPEN');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.completedAt).toBeNull();
    const events = await db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId, source: `TASK:${taskId}` }, orderBy: { id: 'asc' } });
    expect(events.map(event => event.field)).toEqual(['TASK_COMPLETED', 'TASK_REOPENED']);
    await page.goto(casePath);
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await expect(timeline.getByRole('heading', { name: 'Task completed', exact: true })).toHaveCount(1);
    await expect(timeline.getByRole('heading', { name: 'Task reopened', exact: true })).toHaveCount(1);

    // Adding Account context later must preserve the existing Note verbatim.
    const account = await db.account.findFirstOrThrow({ where: { archivedAt: null } });
    await db.supportCase.update({ where: { id: caseId }, data: { accountId: account.id } });
    expect(await db.note.findUniqueOrThrow({ where: { id: note.id } })).toEqual(note);
    await page.reload();
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await expect(timeline).toContainText(note.body);

    // Even a Task assigned to this Support user requires actual Case context.
    const support = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
    const unrelated = await db.task.create({ data: { subject: uniqueName('Protected Sales work'), assignedToId: support.id, createdById: support.id } });
    for (const url of [`/tasks/${unrelated.id}`, `/tasks/${unrelated.id}/edit`]) {
      const response = await page.request.get(url);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(unrelated.subject);
    }
    const denied = await page.request.get('/tasks');
    expect(denied.url()).toContain('/access-denied');
  });
}
