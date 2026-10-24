import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { databaseUrl, emails } from './constants.mjs';
import { helpTopics } from '../lib/help/topics';
const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.afterAll(() => db.$disconnect());

test('account menu opens Help by keyboard, filter finds body text, and empty state recovers', async ({ page }) => {
  await signInAs(page, 'sales');
  const trigger = page.getByRole('button', { name: /^User account:/ });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  const help = page.getByRole('navigation', { name: 'User account', exact: true }).getByRole('link', { name: 'Help & Guide' });
  await expect(help).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/help');
  const filter = page.getByRole('searchbox', { name: 'Find a Help topic' });
  await filter.fill('minimum quantity');
  await expect(page.getByRole('main').getByRole('link', { name: /^Price Exceptions/ })).toBeVisible();
  await filter.fill('nothing-matches-this');
  await expect(page.getByText('No topics match.', { exact: false })).toBeVisible();
  await filter.fill('');
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
});

for (const role of ['admin', 'salesManager', 'sales', 'support', 'marketing', 'readOnly'] as const) {
  test(`${role} receives relevant topics and direct-link access follows permissions`, async ({ page }) => {
    await signInAs(page, role); await page.goto('/help');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Getting Started', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Administration', exact: true })).toHaveCount(role === 'admin' ? 1 : 0);
    await expect(main.locator('a[href="/help/support-inbox"]')).toHaveCount(['admin', 'support'].includes(role) ? 1 : 0);
    await expect(main.locator('a[href="/help/forecast-snapshots"]')).toHaveCount(['admin', 'salesManager'].includes(role) ? 1 : 0);
    await expect(main.locator('a[href="/help/marketing-attribution"]')).toHaveCount(['admin', 'marketing'].includes(role) ? 1 : 0);
    await expect(main.locator('a[href="/help/projects"]')).toHaveCount(role === 'support' ? 0 : 1);
    await expect(main.locator('a[href="/help/forecasting"]')).toHaveCount(['admin', 'salesManager', 'sales', 'readOnly'].includes(role) ? 1 : 0);
    await expect(main.locator('a[href="/help/opportunities"]')).toHaveCount(role === 'support' ? 0 : 1);
    await page.goto('/help/activities-tasks');
    await expect(page.getByRole('heading', { name: 'Activities & Tasks', exact: true })).toBeVisible();
    if (role === 'readOnly') {
      await expect(main.getByRole('heading', { name: 'Make the next handoff easy', exact: true })).toHaveCount(0);
      await expect(main.getByRole('button')).toHaveCount(0);
      await page.goto('/help/support-cases');
      await expect(main.getByRole('heading', { name: 'Working the Case', exact: true })).toHaveCount(0);
      await page.goto('/help/projects');
      await expect(main.getByRole('article')).toContainText('Primary Account is optional');
      await expect(main.getByRole('heading', { name: 'Keeping the Project current', exact: true })).toHaveCount(0);
      await page.goto('/help/opportunities');
      await expect(main.getByRole('article')).toContainText('Actual Close Date');
      await expect(main.getByRole('heading', { name: 'Closing an Opportunity', exact: true })).toHaveCount(0);
      await expect(main.getByRole('heading', { name: 'Reopening an Opportunity', exact: true })).toHaveCount(0);
    }
    const projectResponse = await page.request.get('/help/projects');
    expect(projectResponse.status()).toBe(role === 'support' ? 404 : 200);
    if (role !== 'admin') {
      const response = await page.request.get('/help/audit-history');
      expect(response.status()).toBe(404);
      const restricted = await page.request.get(role === 'support' ? '/help/opportunities' : role === 'salesManager' ? '/help/marketing-attribution' : '/help/support-inbox');
      expect(restricted.status()).toBe(404);
    }
  });
}

test('Admin can open every Help topic and every section link resolves', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin'); await page.goto('/help');
  const links = await page.getByRole('main').locator('a[href^="/help/"]').evaluateAll(elements => elements.map(el => el.getAttribute('href')!));
  expect(links.length).toBe(Object.keys(helpTopics).length);
  for (const href of links) {
    const response = await page.goto(href); expect(response?.status(), href).toBe(200);
    const id = href.split('/').at(-1)! as keyof typeof helpTopics;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(helpTopics[id].title);
    const anchors = await page.getByRole('navigation', { name: 'On this page' }).locator('a').evaluateAll(elements => elements.map(el => el.getAttribute('href')!));
    for (const anchor of anchors) await expect(page.locator(anchor)).toHaveCount(1);
    await expect(page.getByRole('link', { name: '← All Help topics' })).toHaveAttribute('href', '/help');
  }
});

test('contextual Help links open the right guide from complex pages and forms', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  for (const [path, id] of [
    ['/projects', 'projects'], ['/projects/new', 'projects'], ['/pipeline', 'forecasting'],
    ['/opportunities/new', 'opportunities'], ['/opportunities/new', 'forecast-categories'], ['/support/inbox', 'support-inbox'],
    ['/price-exceptions', 'price-exceptions'], ['/price-exceptions/lookup', 'price-exceptions'],
    ['/reports/forecast', 'forecasting'], ['/reports/opportunity-snapshots', 'opportunity-snapshots'],
    ['/reports/forecast-snapshots', 'forecast-snapshots'], ['/administration/opportunity-snapshots', 'opportunity-snapshots'],
    ['/administration/forecast-snapshots', 'forecast-snapshots'], ['/administration/audit-history', 'audit-history'],
    ['/administration/maintenance-history', 'maintenance-history'],
  ]) {
    await page.goto(path);
    const link = page.getByRole('main').locator(`a[href="/help/${id}"]`);
    await expect(link).toBeVisible(); await link.click(); await expect(page).toHaveURL(`/help/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const row = await db.supportCase.create({ data: { caseNumber: uniqueName('BXS-HELP'), subject: uniqueName('Help case'), customerNameText: 'Help test customer', description: 'Synthetic Help test.', source: 'PHONE', status: 'OPEN', createdById: user.id, updatedById: user.id } });
  await signInAs(page, 'support'); await page.goto(`/support/cases/${row.id}`);
  await page.getByRole('button', { name: 'Log Email Response', exact: true }).click();
  await page.getByRole('link', { name: 'Help with Log Email Response' }).click();
  await expect(page).toHaveURL('/help/log-email-response');
  await expect(page.getByRole('article')).toContainText('SalesHub does not send the email.');
  await signInAs(page, 'admin');
  await page.goto(`/support/cases?q=${encodeURIComponent(row.subject)}`);
  const selection = page.getByRole('checkbox', { name: `Select ${row.caseNumber}` });
  await expect(selection).toBeVisible(); await selection.check();
  await page.getByRole('link', { name: 'Help with Bulk Actions' }).click();
  await expect(page).toHaveURL('/help/bulk-actions');
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  test(`Help is readable and keyboard accessible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await signInAs(page, 'admin');
    await page.getByRole('button', { name: /^User account:/ }).click();
    await page.getByRole('navigation', { name: 'User account', exact: true }).getByRole('link', { name: 'Help & Guide' }).click();
    await expect(page).toHaveURL('/help');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`help-landing-${width}.png`), fullPage: true });
    const filter = page.getByRole('searchbox'); await filter.focus();
    expect(await filter.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await filter.fill('Support Inbox'); await filter.press('Tab');
    const first = page.getByRole('main').locator('a').first();
    await expect(first).toBeFocused();
    expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.goto('/help/support-inbox');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Support Inbox');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const article = page.getByRole('article');
    expect((await article.boundingBox())!.width).toBeLessThanOrEqual(750);
    await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Choose attachments' }).click();
    await expect(page.getByRole('heading', { name: 'Choose attachments', exact: true })).toBeInViewport();
    await page.getByRole('link', { name: '← All Help topics' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`help-topic-${width}.png`), fullPage: true });
    for (const [id, heading] of [['opportunities', 'Expected Close Date and Actual Close Date'], ['forecasting', 'My pipeline and salesperson filters'], ['projects', 'Updates and milestones']]) {
      await page.goto(`/help/${id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: heading, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeInViewport();
      expect((await page.getByRole('article').boundingBox())!.width).toBeLessThanOrEqual(750);
      await page.screenshot({ path: testInfo.outputPath(`help-${id}-${width}.png`), fullPage: true });
    }
  });
}

test('unknown Help topics return 404 and signed-out access requires sign-in', async ({ page, browser }) => {
  await signInAs(page, 'admin');
  const response = await page.request.get('/help/not-a-topic'); expect(response.status()).toBe(404);
  const context = await browser.newContext();
  const anonymous = await context.newPage(); await anonymous.goto('/help/support-inbox');
  await expect(anonymous).toHaveURL(/sign-in/); await context.close();
});

test('Sales onboarding finds outcome, Pipeline and Project concepts through Help search', async ({ page }) => {
  await signInAs(page, 'sales'); await page.goto('/help');
  const filter = page.getByRole('searchbox', { name: 'Find a Help topic' });
  for (const [query, id] of [['Actual Close Date', 'opportunities'], ['Outcome Reason', 'opportunities'], ['January 8', 'opportunities'], ['My pipeline', 'forecasting'], ['milestone', 'projects'], ['Additional Participants', 'projects']]) {
    await filter.fill(query);
    const link = page.getByRole('main').locator(`a[href="/help/${id}"]`);
    await expect(link).toBeVisible(); await link.click();
    await expect(page).toHaveURL(`/help/${id}`);
    await page.getByRole('link', { name: '← All Help topics' }).click();
  }
  await page.goto('/help/forecasting');
  await expect(page.getByRole('article')).toContainText(/default[\s\S]*Clear[\s\S]*apply that view/);
  await expect(page.getByRole('article')).toContainText('Owner to My pipeline');
});

test('Project detail/edit and Opportunity detail offer the right contextual Help for Sales', async ({ page }) => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
  const project = await db.project.create({ data: { name: uniqueName('Help rollout'), ownerId: user.id, createdById: user.id, primaryAccountRole: 'PROGRAM_OWNER' } });
  const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false, active: true } });
  const opportunity = await db.opportunity.create({ data: { name: uniqueName('Help opportunity'), stageId: stage.id, ownerId: user.id } });
  await signInAs(page, 'sales');
  for (const [path, id, label] of [[`/projects/${project.id}`, 'projects', 'Help with Projects'], [`/projects/${project.id}/edit`, 'projects', 'Help with Projects'], [`/opportunities/${opportunity.id}`, 'opportunities', 'Help with Opportunities']]) {
    await page.goto(path);
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`/help/${id}`);
  }
});
