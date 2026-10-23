import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { databaseUrl } from './constants.mjs';
import { signInAs } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(() => db.$disconnect());

test('Admin can brand the deployment, manage trusted domains, and review history', async ({ page }) => {
  await signInAs(page, 'admin');
  const original = await db.deploymentBranding.findUnique({ where: { id: 1 } });
  const existingDomain = await db.trustedSignInDomain.findUnique({ where: { domain: 'bixolon.com' } });
  try {
    await page.goto('/administration/company-branding');
    await page.getByLabel('Company Name').fill('Acme Distribution');
    await page.getByLabel('Product Name').fill('Acme CRM');
    await page.getByRole('button', { name: 'Save names' }).click();
    await expect(page.getByRole('status')).toContainText('Branding saved.');
    await page.goto('/sign-in');
    await expect(page.getByText('Sign in to Acme CRM for Acme Distribution using your corporate account.')).toBeVisible();
    await page.goto('/administration/users/import');
    await expect(page.getByText('Review CSV changes before approving CRM access.')).toBeVisible();
    await page.goto('/administration/company-branding');
    await page.getByLabel('Choose logo').setInputFiles(resolve('public/brand/bixolon-logo.png'));
    await page.getByRole('button', { name: 'Upload logo' }).click();
    await expect(page.getByRole('status')).toContainText('Logo uploaded.');
    await expect.poll(() => db.deploymentBranding.findUnique({ where: { id: 1 } }).then(row => row?.logoMimeType)).toBe('image/png');
    const served = await page.request.get('/api/branding/logo', { maxRedirects: 0 });
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('image/png');
    expect(served.headers()['cache-control']).toContain('no-store');
    await page.getByRole('button', { name: 'Reset to default logo' }).click();
    await expect(page.getByRole('status')).toContainText('Default logo restored.');
    const svg = await page.request.post('/api/branding/logo', { multipart: { file: { name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') } } });
    expect(svg.status()).toBe(400);
    await page.goto('/administration/trusted-domains');
    if (!existingDomain) {
      await page.getByLabel('Add trusted domain').fill('BiXoLoN.CoM');
      await page.getByRole('button', { name: 'Add domain' }).click();
      await expect(page.getByRole('status')).toContainText('Domain added.');
    }
    await expect.poll(() => db.trustedSignInDomain.findUnique({ where: { domain: 'bixolon.com' } }).then(row => row?.active)).toBe(true);
    const row = page.locator('.panel > div').filter({ hasText: 'bixolon.com' });
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect.poll(() => db.trustedSignInDomain.findUnique({ where: { domain: 'bixolon.com' } }).then(value => value?.active)).toBe(false);
    await row.getByRole('button', { name: 'Activate' }).click();
    await expect.poll(() => db.trustedSignInDomain.findUnique({ where: { domain: 'bixolon.com' } }).then(value => value?.active)).toBe(true);
    await page.goto('/administration/maintenance-history?entity=Branding');
    const historyEntry = page.locator('article').filter({ hasText: 'Company Name changed' }).first();
    await expect(historyEntry).toBeVisible();
    await expect(historyEntry).toContainText('Acme Distribution');
  } finally {
    await db.deploymentBranding.upsert({ where: { id: 1 }, create: { id: 1, companyName: original?.companyName ?? 'BIXOLON America, Inc.', productName: original?.productName ?? 'SalesHub', logoStorageKey: original?.logoStorageKey ?? null, logoMimeType: original?.logoMimeType ?? null }, update: { companyName: original?.companyName ?? 'BIXOLON America, Inc.', productName: original?.productName ?? 'SalesHub', logoStorageKey: original?.logoStorageKey ?? null, logoMimeType: original?.logoMimeType ?? null } });
    if (!existingDomain) await db.trustedSignInDomain.deleteMany({ where: { domain: 'bixolon.com' } });
    else await db.trustedSignInDomain.update({ where: { domain: 'bixolon.com' }, data: { active: existingDomain.active } });
  }
});

test('sign-in and Admin configuration fit the five required widths', async ({ page }) => {
  await signInAs(page, 'admin');
  const original = await db.deploymentBranding.findUnique({ where: { id: 1 } });
  const companyName = 'Acme International Distribution and Technology Services Holdings Incorporated';
  const productName = 'A Very Long Customer Relationship Management Product Name for Regional and Global Teams';
  try {
    await db.deploymentBranding.upsert({ where: { id: 1 }, create: { id: 1, companyName, productName }, update: { companyName, productName } });
    for (const width of [1440, 1024, 820, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/sign-in', '/administration/company-branding', '/administration/trusted-domains']) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} at ${width}px`).toBe(true);
      }
    }
  } finally {
    await db.deploymentBranding.update({ where: { id: 1 }, data: { companyName: original?.companyName ?? 'BIXOLON America, Inc.', productName: original?.productName ?? 'SalesHub' } });
  }
});

test('delegated manager cannot open or mutate deployment configuration', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/administration/company-branding');
  await expect(page).toHaveURL(/access-denied/);
  const response = await page.request.post('/api/branding/logo', { multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('invalid') } } });
  expect(response.status()).toBe(403);
});
