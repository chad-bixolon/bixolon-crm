import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { databaseUrl, emails } from './constants.mjs';

const db = new PrismaClient({ datasourceUrl: databaseUrl });
test.afterAll(() => db.$disconnect());

async function appearance(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    preference: document.documentElement.dataset.appearance,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.panel') ?? document.body).backgroundColor,
  }));
}

async function textContrast(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => rgb(value).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const style = getComputedStyle(element);
    const background = getComputedStyle(element.closest('.panel') ?? document.body).backgroundColor;
    const first = luminance(style.color), second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
}

test('sign-in follows the device before hydration and keeps the configured logo', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const response = await page.goto('/sign-in');
  expect(await response?.text()).toContain('data-appearance="system"');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('img[alt="BIXOLON"]')).toBeVisible();
  expect((await appearance(page)).scheme).toContain('dark');
  expect((await appearance(page)).background).not.toBe('rgb(247, 248, 250)');
  await page.screenshot({ path: testInfo.outputPath('sign-in-dark-1440.png'), caret: 'initial' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('sign-in-dark-390.png'), caret: 'initial' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await appearance(page)).background).toBe('rgb(247, 248, 250)');
  await page.screenshot({ path: testInfo.outputPath('sign-in-light-390.png'), caret: 'initial' });
});

test('System tracks OS changes; forced Light and Dark override the OS and persist', async ({ page }) => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.sales }, select: { id: true, appearancePreference: true } });
  const hydrationErrors: string[] = [];
  page.on('console', message => { if (/hydration|did not match/i.test(message.text())) hydrationErrors.push(message.text()); });
  try {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: 'SYSTEM' } });
    await page.emulateMedia({ colorScheme: 'light' });
    await signInAs(page, 'sales');
    await page.goto('/my-integrations');
    const control = page.getByLabel('Appearance', { exact: true });
    await expect(control).toHaveValue('SYSTEM');
    expect((await appearance(page)).background).toBe('rgb(247, 248, 250)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await appearance(page)).background).not.toBe('rgb(247, 248, 250)');
    await control.selectOption('LIGHT');
    await expect(page.getByRole('status').filter({ hasText: 'Appearance saved.' })).toBeVisible();
    expect((await appearance(page)).background).toBe('rgb(247, 248, 250)');
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: user.id } })).appearancePreference).toBe('LIGHT');
    await page.reload();
    expect((await appearance(page)).preference).toBe('light');
    await page.emulateMedia({ colorScheme: 'light' });
    await control.selectOption('DARK');
    await expect(page.getByRole('status').filter({ hasText: 'Appearance saved.' })).toBeVisible();
    expect((await appearance(page)).background).not.toBe('rgb(247, 248, 250)');
    const darkResponse = await page.reload();
    expect(await darkResponse?.text()).toContain('data-appearance="dark"');
    expect((await appearance(page)).preference).toBe('dark');
    expect((await appearance(page)).scheme).toBe('dark');
    await control.selectOption('SYSTEM');
    await expect(page.getByRole('status').filter({ hasText: 'Appearance saved.' })).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).appearancePreference).toBe('SYSTEM');
    expect(hydrationErrors).toEqual([]);
  } finally {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: user.appearancePreference } });
  }
});

test('different users keep separate choices; appearance leaves module visibility intact', async ({ page }) => {
  const sales = await db.user.findUniqueOrThrow({ where: { email: emails.sales }, select: { id: true, appearancePreference: true } });
  const support = await db.user.findUniqueOrThrow({ where: { email: emails.support }, select: { id: true, appearancePreference: true } });
  try {
    await db.user.update({ where: { id: sales.id }, data: { appearancePreference: 'DARK' } });
    await db.user.update({ where: { id: support.id }, data: { appearancePreference: 'LIGHT' } });
    await signInAs(page, 'sales');
    expect((await appearance(page)).preference).toBe('dark');
    await signInAs(page, 'support');
    expect((await appearance(page)).preference).toBe('light');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Support Cases' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Opportunities' })).toHaveCount(0);
  } finally {
    await db.user.update({ where: { id: sales.id }, data: { appearancePreference: sales.appearancePreference } });
    await db.user.update({ where: { id: support.id }, data: { appearancePreference: support.appearancePreference } });
  }
});

test('generic deployment branding stays readable in Dark and Help uses Product Name', async ({ page }) => {
  const original = await db.deploymentBranding.findUnique({ where: { id: 1 } });
  try {
    await db.deploymentBranding.upsert({ where: { id: 1 }, create: { id: 1, companyName: 'Example Company', productName: 'Example CRM' }, update: { companyName: 'Example Company', productName: 'Example CRM' } });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/sign-in');
    await expect(page.locator('img[alt="Example Company"]')).toBeVisible();
    await expect(page.getByText('Example Company | Example CRM')).toBeVisible();
    expect((await appearance(page)).background).not.toBe('rgb(247, 248, 250)');
    await signInAs(page, 'admin');
    await page.goto('/help/appearance');
    await expect(page.getByRole('article')).toContainText('keep Example CRM in that mode');
  } finally {
    if (original) await db.deploymentBranding.update({ where: { id: 1 }, data: { companyName: original.companyName, productName: original.productName, logoStorageKey: original.logoStorageKey, logoMimeType: original.logoMimeType } });
    else await db.deploymentBranding.delete({ where: { id: 1 } });
  }
});

test('a disabled optional module stays absent in both appearances', async ({ page }) => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin }, select: { id: true, appearancePreference: true } });
  const original = await db.deploymentModuleVisibility.findUnique({ where: { module: 'PROJECTS' } });
  try {
    await db.deploymentModuleVisibility.upsert({ where: { module: 'PROJECTS' }, create: { module: 'PROJECTS', enabled: false }, update: { enabled: false } });
    for (const choice of ['DARK', 'LIGHT'] as const) {
      await db.user.update({ where: { id: admin.id }, data: { appearancePreference: choice } });
      await signInAs(page, 'admin');
      await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Projects' })).toHaveCount(0);
      expect((await appearance(page)).preference).toBe(choice.toLowerCase());
    }
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { appearancePreference: admin.appearancePreference } });
    if (original) await db.deploymentModuleVisibility.update({ where: { module: 'PROJECTS' }, data: { enabled: original.enabled, updatedById: original.updatedById } });
    else await db.deploymentModuleVisibility.delete({ where: { module: 'PROJECTS' } });
  }
});

test('search dialog, recent items, and notifications use dark elevated surfaces', async ({ page }) => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin }, select: { id: true, appearancePreference: true } });
  try {
    await db.user.update({ where: { id: admin.id }, data: { appearancePreference: 'DARK' } });
    await signInAs(page, 'admin');
    await page.getByRole('button', { name: 'Search SalesHub' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search SalesHub' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(27, 38, 52)');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Recent Items' }).click();
    const recent = page.getByRole('region', { name: 'Recent Items' });
    await expect(recent).toBeVisible();
    expect(await recent.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(27, 38, 52)');
    await page.getByRole('button', { name: 'Recent Items' }).click();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const notificationPanel = page.locator('.bg-white').filter({ hasText: 'Notifications' }).last();
    await expect(notificationPanel).toBeVisible();
    expect(await notificationPanel.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(27, 38, 52)');
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { appearancePreference: admin.appearancePreference } });
  }
});

test('signing out returns the unauthenticated sign-in page to System', async ({ page }) => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.sales }, select: { id: true, appearancePreference: true } });
  try {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: 'DARK' } });
    await page.emulateMedia({ colorScheme: 'light' });
    await signInAs(page, 'sales');
    expect((await appearance(page)).preference).toBe('dark');
    await page.getByRole('button', { name: /^User account:/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/sign-in');
    expect((await appearance(page)).preference).toBe('system');
    expect((await appearance(page)).background).toBe('rgb(247, 248, 250)');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).appearancePreference).toBe('DARK');
  } finally {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: user.appearancePreference } });
  }
});

test('representative surfaces stay dark and fit five widths', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.admin }, select: { id: true, appearancePreference: true } });
  try {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: 'DARK' } });
    await signInAs(page, 'admin');
    const account = await db.account.findFirst({ select: { id: true } });
    const opportunity = await db.opportunity.findFirst({ select: { id: true } });
    const supportCase = await db.supportCase.findFirst({ select: { id: true } });
    const majorPaths = ['/tasks', '/administration', '/help', '/reports/pipeline-movement/history', ...(account ? [`/accounts/${account.id}`] : []), ...(opportunity ? [`/opportunities/${opportunity.id}`] : []), ...(supportCase ? [`/support/cases/${supportCase.id}`] : [])];
    const otherModules = ['/contacts', '/pipeline', '/projects', '/marketing/campaigns', '/trade-shows', '/demos', '/price-exceptions', '/products', '/sales-plan', '/reports/forecast', '/calendar-matches', '/my-day', '/notifications'];
    for (const width of [1440, 1024, 820, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const path of ['/', '/my-integrations', '/reports', ...(width === 1440 || width === 390 ? ['/support/inbox', ...majorPaths] : []), ...(width === 1440 ? otherModules : [])]) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        expect((await appearance(page)).preference, `${width} ${path}`).toBe('dark');
        expect((await appearance(page)).background, `${width} ${path}`).not.toBe('rgb(247, 248, 250)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${path}`).toBe(true);
        if (path === '/my-integrations') {
          expect(await textContrast(page, 'main h1'), `${width} primary text`).toBeGreaterThanOrEqual(4.5);
          expect(await textContrast(page, 'main .panel .label'), `${width} form label`).toBeGreaterThanOrEqual(4.5);
          expect(await textContrast(page, 'main .panel p.text-slate-600'), `${width} secondary text`).toBeGreaterThanOrEqual(4.5);
        }
        if (width === 1440 || ['/', '/my-integrations', '/support/inbox'].includes(path)) await page.screenshot({ path: testInfo.outputPath(`appearance-dark-${width}-${path.replaceAll('/', '-') || 'dashboard'}.png`), fullPage: false, caret: 'initial' });
      }
    }
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: 'LIGHT' } });
    for (const width of [1440, 1024, 820, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const path of ['/', '/my-integrations']) {
        await page.goto(path);
        expect((await appearance(page)).background, `${width} ${path}`).toBe('rgb(247, 248, 250)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${path}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`appearance-light-${width}-${path === '/' ? 'dashboard' : 'settings'}.png`), fullPage: false, caret: 'initial' });
      }
    }
  } finally {
    await db.user.update({ where: { id: user.id }, data: { appearancePreference: user.appearancePreference } });
  }
});
