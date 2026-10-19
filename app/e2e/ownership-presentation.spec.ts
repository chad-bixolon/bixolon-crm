import { PrismaClient } from '@prisma/client';
import { devices } from '@playwright/test';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, watchApplicationErrors } from './helpers';

const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.afterAll(() => db.$disconnect());

for (const browserName of ['chromium', 'webkit'] as const) {
  test(`Ownership filters stay compact, aligned and bounded in ${browserName}`, async ({ playwright, baseURL }, info) => {
    test.setTimeout(120_000);
    const browser = await playwright[browserName].launch();
    const context = await browser.newContext({
      baseURL,
      ...(browserName === 'webkit' ? { userAgent: devices['iPad Pro 11'].userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const errors = watchApplicationErrors(page);
    try {
      await signInAs(page, 'admin');
      const viewports = browserName === 'webkit'
        ? [[768, 1024], [820, 1180], [1024, 768]]
        : [[1440, 900], [768, 1024], [820, 1180], [1024, 768], [390, 844]];
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await page.goto('/administration/ownership');
        await page.waitForLoadState('networkidle');
        const form = page.locator('form.responsive-filter-form');
        const disclosure = form.getByRole('button', { name: /^Show filters/ });
        if (await disclosure.isVisible()) {
          await page.screenshot({ path: info.outputPath(`ownership-${width}-collapsed.png`), fullPage: true, caret: 'initial' });
          await disclosure.click();
        }
        const entity = form.getByLabel('Record type');
        const owner = form.getByLabel('Current owner or assignee');
        const apply = form.getByRole('button', { name: 'Apply filters', exact: true });
        const clear = form.getByRole('link', { name: 'Clear filters', exact: true });
        const boxes = await Promise.all([entity, owner, apply, clear].map(async control => {
          await expect(control).toBeVisible();
          return (await control.boundingBox())!;
        }));
        const formBox = (await form.boundingBox())!;
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(formBox.x);
          expect(box.x + box.width).toBeLessThanOrEqual(formBox.x + formBox.width);
          expect(box.height).toBe(boxes[0].height);
        }
        if (width >= 640 && width < 1280) expect(boxes[0].height).toBe(44);
        for (const box of boxes.slice(2)) expect(box.width).toBeLessThan(140);
        expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThanOrEqual(1);
        if (width === 1440) {
          for (const box of boxes) expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
          for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await owner.focus();
        await page.keyboard.press('Tab');
        await expect(apply).toBeFocused();
        expect(await apply.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
        await page.screenshot({ path: info.outputPath(`ownership-${width}-expanded.png`), fullPage: true, caret: 'initial' });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}

test('Ownership copy, filter submission, clear and Help preserve their scope', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration/ownership');
  const main = page.getByRole('main');
  await expect(main).toContainText('Review records assigned to inactive or unavailable users and reassign them when needed.');
  await expect(main).toContainText('Unassigned records are reviewed in Data Quality. Contacts use their Account’s owner.');
  await expect(main).toContainText('Tasks and Support Cases can be reassigned here. Other records can be updated from their normal edit pages.');
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const form = page.locator('form.responsive-filter-form');
  await form.getByLabel('Record type').selectOption('Task');
  await form.getByLabel('Current owner or assignee').selectOption(String(admin.id));
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`entity=Task&owner=${admin.id}$`));
  await expect(main).toContainText('No records need reassignment for these filters.');
  await expect(form.getByLabel('Record type')).toHaveValue('Task');
  await expect(form.getByLabel('Current owner or assignee')).toHaveValue(String(admin.id));
  await expect(form.getByRole('link', { name: 'Data Quality', exact: true })).toHaveAttribute('href', '/administration/data-quality');
  await form.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL('/administration/ownership?entity=Task');
  await expect(form.getByLabel('Record type')).toHaveValue('Task');
  await expect(form.getByLabel('Current owner or assignee')).toHaveValue('');
  await main.getByRole('link', { name: 'Help with Ownership & Reassignment' }).click();
  await expect(page).toHaveURL('/help/ownership-reassignment');
  await expect(page.getByRole('article')).toContainText('Review your selection and confirm the new assignee');
  await expect(page.getByRole('article')).toContainText('Completed work is excluded.');
  await expect(page.getByRole('article')).toContainText('Support Cases are checked separately');
});
