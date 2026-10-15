import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(() => db.$disconnect());
for (const kind of ['tasks', 'cases'] as const) {
  test(`bulk ${kind} controls and confirmation fit the viewport`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const subject = uniqueName(`E2E responsive bulk ${kind}`);
    const actor = await db.user.findUniqueOrThrow({ where: { email: emails[kind === 'tasks' ? 'admin' : 'support'] } });
    for (let i = 0; i < 2; i++) {
      if (kind === 'tasks') await db.task.create({ data: { subject: `${subject} ${i}`, assignedToId: actor.id } });
      else await db.supportCase.create({ data: { subject: `${subject} ${i}`, customerNameText: 'Responsive customer', description: 'Responsive test', caseNumber: uniqueName('BULK-RESP'), source: 'PHONE', createdById: actor.id, updatedById: actor.id } });
    }
    await signInAs(page, kind === 'tasks' ? 'admin' : 'support');
    const url = `${kind === 'tasks' ? '/tasks' : '/support/cases'}?q=${encodeURIComponent(subject)}&page=1`;
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    const toolbar = page.getByLabel('Bulk actions', { exact: true });
    const box = await toolbar.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await dialog.getByRole('combobox').selectOption(String(actor.id));
    await expect(dialog).toContainText(actor.firstName);
    await page.screenshot({ path: info.outputPath('bulk-confirm.png') });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('checkbox', { name: 'Select eligible records on this page' }).check();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  });
}
