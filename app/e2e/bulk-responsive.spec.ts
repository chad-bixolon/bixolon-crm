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
    const actor = await db.user.findUniqueOrThrow({ where: { email: emails[kind === 'tasks' ? 'admin' : 'supportManager'] } });
    for (let i = 0; i < 2; i++) {
      if (kind === 'tasks') await db.task.create({ data: { subject: `${subject} ${i}`, assignedToId: actor.id } });
      else await db.supportCase.create({ data: { subject: `${subject} ${i}`, customerNameText: 'Responsive customer', description: 'Responsive test', caseNumber: uniqueName('BULK-RESP'), source: 'PHONE', createdById: actor.id, updatedById: actor.id } });
    }
    await signInAs(page, kind === 'tasks' ? 'admin' : 'supportManager');
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

for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner'] as const) {
  test(`Data Quality ${issue} touch selection and assignment fit the viewport`, async ({ page }, info) => {
    const name = uniqueName('E2E responsive owner cleanup');
    const owner = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
    const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
    const former = issue === 'account-owner-inactive' ? await db.user.create({ data: { email: `${name.replaceAll(' ', '')}@example.test`, firstName: 'Former', lastName: 'Rep', active: false, role: 'SALES' } }) : null;
    for (let i = 0; i < 2; i++) {
      if (issue !== 'opportunity-owner') await db.account.create({ data: { name: `${name} ${i}`, ownerId: former?.id } });
      else await db.opportunity.create({ data: { name: `${name} ${i}`, stageId: stage.id } });
    }
    await signInAs(page, 'admin');
    await page.goto(`/administration/data-quality?issue=${issue}&q=${encodeURIComponent(name)}`);
    const select = page.getByRole('checkbox', { name: 'Select eligible records on this page' });
    expect((await select.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (issue === 'account-owner-inactive') {
      await page.getByRole('checkbox', { name: `Select ${name} 0`, exact: true }).check();
      await page.getByRole('checkbox', { name: `Select ${name} 1`, exact: true }).check();
    } else await select.check();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.getByLabel('New owner', { exact: true }).selectOption(String(owner.id));
    const bar = await page.getByLabel('Bulk actions', { exact: true }).boundingBox();
    expect(bar!.x).toBeGreaterThanOrEqual(0);
    expect(bar!.x + bar!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole('button', { name: issue === 'account-owner-inactive' ? 'Reassign owner' : 'Assign owner', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm bulk update' });
    await expect(dialog).toContainText(`${owner.firstName} ${owner.lastName}`);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: info.outputPath(`quality-${issue}-confirm.png`) });
    await dialog.getByRole('button', { name: 'Confirm 2 updates' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /(?:re)?assigned successfully/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open record', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (issue === 'account-owner-inactive') {
      const event = await db.adminMaintenanceEvent.findFirstOrThrow({ where: { entityType: 'Account', action: 'Reassign', recordIds: { has: (await db.account.findFirstOrThrow({ where: { name: `${name} 0` } })).id } } });
      expect(event).toMatchObject({ newOwnerId: owner.id, newOwnerName: `${owner.firstName} ${owner.lastName}`, recordCount: 2 });
      await page.goto('/administration/maintenance-history?entity=Account&action=Reassign');
      const entry = page.locator('article').filter({ has: page.getByRole('link', { name: `Open record #${event.recordIds[0]}`, exact: true }) });
      await expect(entry).toContainText(`Reassigned 2 Accounts to ${owner.firstName} ${owner.lastName}`);
    }
  });
}
