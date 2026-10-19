import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails } from './constants.mjs';

test('Admin can open a Data Quality issue and return to its record', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration');
  await page.getByRole('link', { name: /Data Quality/ }).click();
  await expect(page).toHaveURL('/administration/data-quality', { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Data Quality', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible();
  await page.getByRole('link', { name: /Accounts without a sales owner/ }).click();
  await expect(page).toHaveURL(/issue=account-owner/);
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Issue results pages' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search Accounts' }).fill('E2E Acme Customer');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open record' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Data Quality' })).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await page.getByRole('link', { name: 'Open record' }).click();
  await expect(page).toHaveURL(/\/accounts\/\d+$/);
});

test('counts and lists include review candidates while excluding clean and archived records', async ({ page }) => {
  test.setTimeout(90000);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const marker = `E2E Quality ${Date.now()}`;
  const owner = await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } });
  const unowned = await db.account.create({ data: { name: `${marker} Unowned` } });
  const clean = await db.account.create({ data: { name: `${marker} Clean`, ownerId: owner.id } });
  const archived = await db.account.create({ data: { name: `${marker} Archived`, archivedAt: new Date(), status: 'ARCHIVED' } });
  const contact = await db.contact.create({ data: { firstName: marker, lastName: 'Contact', accountId: clean.id, email: `${marker.replaceAll(' ', '').toLowerCase()}@example.test` } });
  const affectedContact = await db.contact.create({ data: { firstName: marker, lastName: 'Needs review', accountId: archived.id } });
  const duplicate = await db.account.create({ data: { name: ` ${marker.toUpperCase()}   Unowned ` } });
  const stage = await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } });
  const affectedOpportunity = await db.opportunity.create({ data: { name: `${marker} Opportunity`, stageId: stage.id, currencyCode: 'USD', participants: { create: { accountId: archived.id } } } });
  try {
    await signInAs(page, 'admin');
    await page.goto('/administration/data-quality');
    const ownerCard = page.getByRole('link', { name: /Accounts without a sales owner/ });
    await expect(ownerCard).toContainText(/\d+/);
    await ownerCard.click();
    await page.getByRole('textbox', { name: 'Search Accounts' }).fill(marker);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts without a sales owner (2)' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Unowned`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Clean`) })).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Archived`) })).toHaveCount(0);
    await page.goto('/administration/data-quality?issue=contact-account');
    await page.getByRole('textbox', { name: 'Search Contacts' }).fill(marker);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Contact`) })).toHaveCount(0);
    await page.goto('/administration/data-quality?issue=opportunity-account-inactive');
    await page.getByRole('textbox', { name: 'Search Opportunities' }).fill(marker);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Opportunity`) })).toBeVisible();
    await page.goto('/administration/data-quality?issue=contact-account-inactive');
    await page.getByRole('textbox', { name: 'Search Contacts' }).fill(marker);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Needs review`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Contact`) })).toHaveCount(0);
    await page.goto('/administration/data-quality?issue=duplicate-account');
    await page.getByRole('textbox', { name: 'Search Accounts' }).fill(marker);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Possible duplicate Accounts (2)' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Unowned`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${marker} Clean`) })).toHaveCount(0);
  } finally {
    await db.opportunityAccount.delete({ where: { opportunityId_accountId: { opportunityId: affectedOpportunity.id, accountId: archived.id } } });
    await db.opportunity.delete({ where: { id: affectedOpportunity.id } });
    for (const id of [affectedContact.id, contact.id]) await db.contact.delete({ where: { id } });
    for (const id of [duplicate.id, archived.id, clean.id, unowned.id]) await db.account.delete({ where: { id } });
    await db.$disconnect();
  }
});

test('non Admin users cannot open Data Quality', async ({ page }) => {
  await signInAs(page, 'sales');
  await page.goto('/administration/data-quality?issue=account-owner');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});
